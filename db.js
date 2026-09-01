/**
 * EVA · acesso ao Postgres/Supabase — busca os vendidos do mesmo prédio (query C1).
 * `pg` é carregado sob demanda pra não obrigar a dependência no caminho puro/teste.
 *
 * IMPORTANTE: traz TODAS as linhas (apês E vagas) — as vagas têm que aparecer na
 * tabela pro corretor correlacionar pela data. NADA é excluído aqui por padrão.
 * O `is_ancora` marca UMA linha: o APARTAMENTO mais recente (nunca uma vaga avulsa),
 * pra valoração e o destaque do slide não caírem numa vaga.
 * (Obs.: em modo "unidade idêntica", a valoração v2 re-escolhe a âncora entre as
 *  vendas de MESMA área total — o is_ancora vira fallback do modo legado.)
 *
 * Casamos por NÚMERO + CEP — não pelo texto do logradouro. O ITBI grava o nome da rua
 * de forma inconsistente ("R CAP PINTO FERREIRA" vs "R CAPITAO PINTO FERREIRA"), o que
 * antes quebrava o prédio em building_keys diferentes e trazia só parte das vendas.
 * Número + CEP identifica o prédio de forma estável (CEP já codifica o logradouro).
 *
 * v2 — EXCLUSÃO PELO CORRETOR (PASSO 3.5 da EVA):
 *  fetchVendidos(pool, buildingKey, { excluir: ["12/05/2024|AP 74 1DEP 2VG", ...] })
 *  remove as linhas cuja chave (DD/MM/YYYY|COMPLEMENTO, a mesma gerada pela tool
 *  Consultar_Vendas_ITBI_Estudo no n8n) o corretor mandou retirar.
 */
const SQL = `
WITH base AS (
  SELECT
    data_transacao::date            AS data,
    NULLIF(btrim(complemento), '')  AS unidade,
    area_construida::numeric        AS area_m2,
    valor_transacao::numeric        AS valor,
    valor_m2::numeric               AS valor_m2
  FROM vendidos_itbi_usados
  WHERE regexp_replace(split_part(numero::text, '.', 1), '\\D', '', 'g') = $1
    AND regexp_replace(split_part(cep::text,    '.', 1), '\\D', '', 'g') = $2
    AND valor_transacao::numeric > 0
    AND area_construida::numeric  > 0
),
flagged AS (
  SELECT *,
    -- "é apartamento" (não vaga/box avulsa): usado só p/ ESCOLHER a âncora; nada é excluído
    ( area_m2 >= 30
      AND (unidade IS NULL OR unidade !~* '^(VG|VAGA|BOX)([^A-Za-z]|$)') ) AS is_apto
  FROM base
)
SELECT data, unidade, area_m2, valor, valor_m2,
       ( ROW_NUMBER() OVER (ORDER BY is_apto DESC, data DESC, valor DESC) = 1 ) AS is_ancora
FROM flagged
ORDER BY data ASC;`;

// chave estável de uma venda: "DD/MM/YYYY|UNIDADE" (unidade vazia -> "-")
// mesma regra do SQL da tool Consultar_Vendas_ITBI_Estudo (n8n): data + complemento btrim.
function chaveVendido(v) {
  let d = v.data;
  if (d instanceof Date) {
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    d = `${dd}/${mm}/${d.getUTCFullYear()}`;
  } else {
    const m = String(d || "").match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) d = `${m[3]}/${m[2]}/${m[1]}`;
    else d = String(d || "").trim();
  }
  const u = String(v.unidade || "").trim().toUpperCase() || "-";
  return `${d}|${u}`;
}

// aplica a lista de exclusão do corretor (case-insensitive; espaços internos normalizados)
function excluirVendidos(rows, excluir) {
  if (!Array.isArray(rows) || !rows.length) return rows || [];
  if (!Array.isArray(excluir) || !excluir.length) return rows;
  const norm = s => String(s).trim().toUpperCase().replace(/\s+/g, " ");
  const set = new Set(excluir.map(norm).filter(Boolean));
  const kept = rows.filter(r => !set.has(norm(chaveVendido(r))));
  // se a âncora do SQL foi excluída, promove a venda "apto" mais recente restante
  if (kept.length && !kept.some(r => r.is_ancora === true || r.is_ancora === "t" || r.is_ancora === 1)) {
    const ehVaga = r => /^(VG|VAGA|BOX)\b/i.test(String(r.unidade || "").trim()) || Number(r.area_m2) < 30;
    const pool = kept.filter(r => !ehVaga(r));
    const alvo = (pool.length ? pool : kept).reduce((m, r) =>
      (!m || new Date(r.data) > new Date(m.data)) ? r : m, null);
    if (alvo) alvo.is_ancora = true;
  }
  return kept;
}

// v3 · LISTA DE APROVADAS do corretor (PASSO 3.5) — o contrato correto: o estudo usa SOMENTE
// as vendas que o corretor viu e manteve. Substitui a lógica de exclusão, que era furada:
// a conferência mostrava um subconjunto, o estudo reconsultava o prédio inteiro e entravam
// vendas que o corretor nunca viu (caso Vila Ibirapuera, 01/09/2026).
// Vagas avulsas da MESMA DATA de uma venda mantida acompanham (são a mesma transação —
// a agregação por data soma apto + vagas).
function manterVendidos(rows, manter) {
  if (!Array.isArray(rows) || !rows.length) return rows || [];
  if (!Array.isArray(manter) || !manter.length) return rows;   // [] = sem curadoria → tudo
  const norm = s => String(s).trim().toUpperCase().replace(/\s+/g, " ");
  const set = new Set(manter.map(norm).filter(Boolean));
  const ehVaga = r => /^(VG|VAGA|BOX)([^A-Za-z]|$)/i.test(String(r.unidade || "").trim()) || Number(r.area_m2) < 30;
  const aprovadas = rows.filter(r => set.has(norm(chaveVendido(r))));
  const datasOk = new Set(aprovadas.map(r => norm(chaveVendido(r)).split("|")[0]));
  const kept = rows.filter(r => set.has(norm(chaveVendido(r))) ||
    (ehVaga(r) && datasOk.has(norm(chaveVendido(r)).split("|")[0])));
  if (!kept.length) return rows;                                // chaves não bateram → não zera o estudo
  // âncora do SQL pode ter ficado de fora → promove a venda "apto" mais recente mantida
  if (!kept.some(r => r.is_ancora === true || r.is_ancora === "t" || r.is_ancora === 1)) {
    const pool = kept.filter(r => !ehVaga(r));
    const alvo = (pool.length ? pool : kept).reduce((m, r) =>
      (!m || new Date(r.data) > new Date(m.data)) ? r : m, null);
    if (alvo) alvo.is_ancora = true;
  }
  return kept;
}

// pool = instância de pg.Pool ; buildingKey = 'LOGRADOURO|NUMERO|CEP'
// Extraímos NUMERO e CEP da chave e casamos por eles (logradouro é ignorado de propósito).
// opts.excluir = array de chaves "DD/MM/YYYY|UNIDADE" retiradas pelo corretor (itbi_excluir)
async function fetchVendidos(pool, buildingKey, opts = {}) {
  const parts  = String(buildingKey || '').split('|');
  const numero = (parts[1] || '').replace(/\D/g, '');
  const cep    = (parts[2] || '').replace(/\D/g, '');
  if (!numero || !cep) {
    throw new Error(`fetchVendidos: building_key sem numero/cep utilizáveis: "${buildingKey}"`);
  }
  const { rows } = await pool.query(SQL, [numero, cep]);
  const mapped = rows.map(r => ({
    data: r.data, unidade: r.unidade, area_m2: r.area_m2,
    valor: r.valor, valor_m2: r.valor_m2, is_ancora: r.is_ancora,
  }));
  return excluirVendidos(mapped, opts.excluir);
}

module.exports = { fetchVendidos, excluirVendidos, manterVendidos, chaveVendido, SQL };
