/**
 * EVA · acesso ao Postgres/Supabase — busca os vendidos do mesmo prédio (query C1).
 * `pg` é carregado sob demanda pra não obrigar a dependência no caminho puro/teste.
 *
 * IMPORTANTE: traz TODAS as linhas (apês E vagas) — as vagas têm que aparecer na
 * tabela pro corretor correlacionar pela data. NADA é excluído aqui.
 * O `is_ancora` marca UMA linha: o APARTAMENTO mais recente (nunca uma vaga avulsa),
 * pra valoração e o destaque do slide não caírem numa vaga.
 *
 * Casamos por NÚMERO + CEP — não pelo texto do logradouro. O ITBI grava o nome da rua
 * de forma inconsistente ("R CAP PINTO FERREIRA" vs "R CAPITAO PINTO FERREIRA"), o que
 * antes quebrava o prédio em building_keys diferentes e trazia só parte das vendas.
 * Número + CEP identifica o prédio de forma estável (CEP já codifica o logradouro).
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
  WHERE regexp_replace(numero::text, '\\D', '', 'g') = $1
    AND regexp_replace(cep::text,    '\\D', '', 'g') = $2
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

// pool = instância de pg.Pool ; buildingKey = 'LOGRADOURO|NUMERO|CEP'
// Extraímos NUMERO e CEP da chave e casamos por eles (logradouro é ignorado de propósito).
async function fetchVendidos(pool, buildingKey) {
  const parts  = String(buildingKey || '').split('|');
  const numero = (parts[1] || '').replace(/\D/g, '');
  const cep    = (parts[2] || '').replace(/\D/g, '');
  if (!numero || !cep) {
    throw new Error(`fetchVendidos: building_key sem numero/cep utilizáveis: "${buildingKey}"`);
  }
  const { rows } = await pool.query(SQL, [numero, cep]);
  return rows.map(r => ({
    data: r.data, unidade: r.unidade, area_m2: r.area_m2,
    valor: r.valor, valor_m2: r.valor_m2, is_ancora: r.is_ancora,
  }));
}

module.exports = { fetchVendidos, SQL };
