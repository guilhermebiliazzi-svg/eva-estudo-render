/**
 * EVA · orchestrator do Estudo de CASA DE RUA / TERRENO.
 *
 * Caminho de dados (espelha o orchestrator.js do apartamento, mas para casa):
 *   1. comps CRUS do ITBI (casas vendidas perto, via db_casa) — por rua+número (hoje)
 *      ou por raio geográfico ST_DWithin (depois do backfill de coordenada).
 *   2. valoração Método 2: R$/m² de terreno corrigido pelo IPCA -> mediana/p25/p75 -> faixa.
 *   3. formata comps (strings) e monta a ficha do imóvel.
 *   4. gera o PPTX (buildEstudoCasa).
 *
 * O `corretor` chega PRONTO no body (resolvido no n8n pelo phone), igual ao apartamento —
 * o orchestrator só repassa.
 */
const { fetchCompsByStreet, fetchCompsByRadius } = require("./db_casa");
const { buildValoracaoCasa } = require("./valoracao_casa");
const { buildEstudoCasa } = require("./estudo_casa_generator");

// CUB — custo de reposição da construção (R$/m² construído) p/ o método do custo.
// >>> PLACEHOLDER: ajuste ao CUB-SP (SINDUSCON-SP) do padrão construtivo real. <<<
// Override por requisição via body.cub.
// CUB R1 (residência unifamiliar), R$/m² construído, SEM desoneração — fallback se a tabela cub_sp falhar.
// Valor de referência: Fev/2026 R1-Normal (SindusCon-SP). Atualizado mensalmente na tabela cub_sp pelo cron.
const CUB_PADRAO_SP = 2562.62;

// padrão construtivo (body.padrao) -> coluna da tabela cub_sp
const PADRAO_COL = { baixo: "r1_baixo", normal: "r1_normal", alto: "r1_alto" };

// Resolve o CUB na ordem: 1) override explícito body.cub; 2) tabela cub_sp pelo padrão; 3) fallback constante.
async function resolverCub(pool, body) {
  if (Number(body.cub) > 0) return Number(body.cub);                 // override explícito
  const padrao = String(body.padrao || "normal").toLowerCase();
  const col = PADRAO_COL[padrao] || PADRAO_COL.normal;               // whitelist (não interpola input cru)
  if (pool) {
    try {
      const { rows } = await pool.query(`SELECT ${col} AS cub FROM cub_sp ORDER BY mes_ref DESC LIMIT 1`);
      const v = rows[0] && Number(rows[0].cub);
      if (v > 0) return v;
    } catch (e) { console.error("resolverCub: falha lendo cub_sp (usando fallback):", e.message); }
  }
  return CUB_PADRAO_SP;                                              // fallback
}

// ---- formatadores de exibição ----
const milhar = n => String(Math.round(Math.abs(Number(n)))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const reais  = v => "R$ " + milhar(Math.round(Number(v) / 1000) * 1000) + ",00";
const rsM2   = v => v == null ? "—" : "R$ " + milhar(v) + "/m²";
const m2     = v => v == null || v === "" ? "—" : milhar(v) + " m²";
function dataBR(d) {
  if (!d) return "";
  const iso = String(d).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const x = new Date(d);
  return isNaN(x) ? String(d) : x.toLocaleDateString("pt-BR");
}
const capWords = s => String(s||"").toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());

// comps crus (db_casa) -> linhas formatadas pra tabela do slide
function formatComps(rows, ruaBusca) {
  return rows.map(c => {
    const rua = c.logradouro ? capWords(c.logradouro) : (ruaBusca ? capWords(ruaBusca) : "");
    const endereco = rua ? `${rua}, ${c.numero}` : `nº ${c.numero}`;
    return {
      data: dataBR(c.data),
      endereco,
      area_terreno: m2(c.area_terreno),
      area_construida: m2(c.area_construida),
      valor: reais(c.valor),
      rs_m2_terreno: rsM2(c.rs_m2_terreno != null ? c.rs_m2_terreno : (c.area_terreno > 0 ? Math.round(c.valor / c.area_terreno) : null)),
      dist: c.dist,
    };
  });
}

// monta o objeto imovel (titulo/subtitulo/predio_curto/ficha) a partir dos campos da casa,
// permitindo override por body.imovel
function montarImovel(body) {
  if (body.imovel && body.imovel.ficha) return body.imovel; // já veio pronto do n8n
  const tipo   = (body.tipo || "casa").toLowerCase() === "terreno" ? "Terreno" : "Casa";
  const rua    = capWords(body.rua_exibicao || body.rua || "");
  const numero = body.numero != null ? String(body.numero) : "";
  const endereco = [rua, numero].filter(Boolean).join(", ");
  const ficha = [
    ["Tipo", tipo],
    ["Endereço", endereco || "—"],
    ["Área de terreno", m2(body.area_terreno)],
    ["Área construída", m2(body.area_construida)],
    ["Testada", body.testada ? `${milhar(body.testada)} m` : "—"],
    ["Uso atual", body.uso_atual ? capWords(body.uso_atual) : "—"],
  ];
  return {
    titulo: `${tipo}${endereco ? " — " + endereco : ""}`,
    subtitulo: body.bairro ? `${capWords(body.bairro)}, São Paulo` : "São Paulo",
    predio_curto: endereco || tipo,
    ficha,
    foto_fachada: body.foto_fachada || (body.imovel && body.imovel.foto_fachada) || null,
    idade_anos: body.idade_anos != null ? body.idade_anos : (body.imovel && body.imovel.idade_anos),
  };
}

// núcleo: recebe comps já buscados + dados do imóvel -> PPTX
async function gerarEstudoCasa({ comps, body, assets, out, pool }) {
  const imovel = montarImovel(body);
  const cub = await resolverCub(pool, body);
  const valoracao = buildValoracaoCasa({
    comps,
    avaliando: { area_terreno: body.area_terreno, area_construida: body.area_construida, idade: imovel.idade_anos },
    ref: body.ref || body.estudo_data,
    opts: { cub },
  });
  // tabela do slide 9 usa os comps ENRIQUECIDOS (R$/m² de terreno LIMPO) p/ casar com o headline
  const compsFmt = formatComps(valoracao.comps || comps, body.rua);
  return buildEstudoCasa({
    imovel,
    corretor: body.corretor || {},
    comps: compsFmt,
    valoracao,
    estudo_data: body.estudo_data || "",
    unidade_stats: body.unidade_stats,
    unidade_regioes: body.unidade_regioes,
    unidade_texto: body.unidade_texto,
    ressalvas: body.ressalvas,
  }, { assets, out });
}

// a partir do DB: busca os comps (rua+número hoje; ponto/raio depois) e gera
async function gerarEstudoCasaFromDB({ pool, assets, out, ...body }) {
  if (!pool) throw new Error("pool Postgres ausente");
  let comps;
  if (body.ponto) {
    // modo raio geográfico (pós-backfill): body.ponto = 'SRID=4326;POINT(lng lat)'
    comps = await fetchCompsByRadius(pool, body.ponto, { raioMetros: body.raioMetros, janelaMeses: body.janelaMeses });
  } else {
    if (!body.rua || body.numero == null) throw new Error("rua e numero são obrigatórios (modo rua+número)");
    comps = await fetchCompsByStreet(pool, body.rua, body.numero, { raio: body.raio, janelaMeses: body.janelaMeses });
  }
  return gerarEstudoCasa({ comps, body, assets, out, pool });
}

module.exports = { gerarEstudoCasa, gerarEstudoCasaFromDB, formatComps, montarImovel };
