// valoracao_casa.js — Avaliação de CASA/TERRENO pelo MÉTODO DO CUSTO.
// Exporta buildValoracaoCasa({ comps, avaliando, ref, opts }) — assinatura usada pelo orchestrator_casa.js.
//
// Separa terreno (valoriza) de construção (deprecia), em vez de dividir o preço TOTAL
// pela área de terreno (que embute a construção e infla o R$/m²).
//
//   1) p/ cada comparável: corrige o valor pelo IPCA até `ref`;
//      valor_construção = CUB × área_constr × depreciação(idade);
//      valor_terreno    = valor_corrigido − valor_construção (com piso de segurança);
//      R$/m²_terreno_limpo = valor_terreno / área_terreno.
//   2) mediana / p25 / p75 sobre o R$/m²_terreno_limpo (robusto a outlier).
//   3) avaliando: valor = mediana × área_terreno + CUB × área_constr × depreciação(idade).
//
// REQUER opts.cub (R$/m² construído, CUB-SP por padrão). idade por comparável/avaliando é opcional
// (sem ela → fator uniforme opts.deprPadrao, sinalizado em depr_uniforme_usada p/ as Ressalvas).

// ---------- IPCA (mesmas tabelas do valoracao.js do apto — manter em sincronia) ----------
const IPCA_ANUAL = { 2018:3.75, 2019:4.31, 2020:4.52, 2021:10.06, 2022:5.79, 2023:4.62, 2024:4.83, 2025:4.26 };
const IPCA_YTD   = { 2026: 2.60 };
function ipcaFactor(anoDe, mesDe, anoRef, mesRef){
  if (!Number.isFinite(anoDe) || !Number.isFinite(mesDe)) return 1;
  let f = Math.pow(1 + (IPCA_ANUAL[anoDe]||0)/100, (12 - mesDe)/12);
  for (let y = anoDe + 1; y < anoRef; y++) f *= 1 + (IPCA_ANUAL[y]||0)/100;
  f *= 1 + (IPCA_YTD[anoRef]||0)/100;
  return Number.isFinite(f) && f > 0 ? f : 1;
}
function parseDataBR(d){ // "19/12/2023" | "2023-12-19" | Date -> {ano,mes}
  if (d instanceof Date) return { ano:d.getUTCFullYear(), mes:d.getUTCMonth()+1 };
  const br = String(d).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return { ano:+br[3], mes:+br[2] };
  const iso = String(d).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { ano:+iso[1], mes:+iso[2] };
  const x = new Date(d); return { ano:x.getUTCFullYear(), mes:x.getUTCMonth()+1 };
}

// ---------- formatadores (mesma régua do apto) ----------
const decs    = v => (v/1e6) < 10 ? 2 : 1;
const milhar  = n => String(Math.round(Math.abs(Number(n)))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const reaisN  = v => milhar(Math.round(Number(v)/1000)*1000) + ",00";
const reais   = v => "R$ " + reaisN(v);
const milhoes = v => Number(v) < 1e6 ? reais(v) : "R$ " + (v/1e6).toFixed(decs(v)).replace(".", ",") + " milhões";
const rsM2fmt = v => "R$ " + milhar(Math.round(v)) + "/m²";
const faixaFmt = (a,b) => (a >= 1e6 && b >= 1e6)
  ? `R$ ${(a/1e6).toFixed(decs(a)).replace(".",",")} a ${(b/1e6).toFixed(decs(b)).replace(".",",")} milhões`
  : `${reais(a)} a ${reaisN(b)}`;

// ---------- depreciação (Ross por idade + coef. de estado opcional) ----------
function fatorDepreciacao(idade, { vidaUtil = 60, estadoCoef = 0, deprPadrao = 0.80 } = {}) {
  if (!Number.isFinite(idade) || idade < 0) return deprPadrao;
  const k = Math.min(idade / vidaUtil, 1);
  const dRoss = 0.5 * (k + k * k);
  const d = dRoss + (1 - dRoss) * estadoCoef;
  return Math.min(Math.max(1 - d, 0.20), 1);
}

// ---------- quantil (interpolação linear) ----------
function quantil(arrOrdenado, q) {
  const n = arrOrdenado.length;
  if (!n) return NaN;
  if (n === 1) return arrOrdenado[0];
  const pos = (n - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? arrOrdenado[lo] : arrOrdenado[lo] + (arrOrdenado[hi] - arrOrdenado[lo]) * (pos - lo);
}

function buildValoracaoCasa({ comps = [], avaliando = {}, ref, opts = {} }) {
  const cub = Number(opts.cub);
  if (!Number.isFinite(cub) || cub <= 0) {
    throw new Error("buildValoracaoCasa: opts.cub (R$/m² de construção) é obrigatório no método do custo.");
  }
  const dOpts = {
    vidaUtil:   opts.vidaUtil   ?? 60,
    estadoCoef: opts.estadoCoef ?? 0,
    deprPadrao: opts.deprPadrao ?? 0.80,
  };
  const pisoTerrenoFrac = opts.pisoTerrenoFrac ?? 0.30;

  const hoje   = new Date();
  const r      = ref ? parseDataBR(ref) : null;
  const anoRef = (r && Number.isFinite(r.ano)) ? r.ano : hoje.getFullYear();
  const mesRef = (r && Number.isFinite(r.mes)) ? r.mes : hoje.getMonth() + 1;

  const rsLimpo = [];           // R$/m² de terreno limpo, CORRIGIDO (base da mediana/faixa)
  const enriched = [];          // comps p/ a tabela do slide 9 (rs limpo, p/ casar com o headline)
  let semIdadeComp = false;

  for (const c of comps) {
    const terreno   = Number(c.area_terreno);
    const constr    = Number(c.area_construida || 0);
    const valorOrig = Number(c.valor);
    if (!(terreno > 0) || !(valorOrig > 0)) continue;
    if (!Number.isFinite(c.idade)) semIdadeComp = true;

    const fator      = ipcaFactor(...Object.values(parseDataBR(c.data)), anoRef, mesRef);
    const valorCorr  = valorOrig * fator;
    const valConstr  = cub * constr * fatorDepreciacao(c.idade, dOpts);
    const valTerreno = Math.max(valorCorr - valConstr, valorCorr * pisoTerrenoFrac);
    const rs         = valTerreno / terreno;

    rsLimpo.push(rs);
    // tabela: mostra o R$/m² LIMPO (corrigido) e mantém o Valor de venda original
    enriched.push({ ...c, valor: valorOrig, rs_m2_terreno: Math.round(rs) });
  }

  if (!rsLimpo.length) {
    const err = new Error("buildValoracaoCasa: nenhum comparável válido (terreno e valor > 0).");
    err.code = "COMPS_INSUFICIENTES";
    throw err;
  }

  rsLimpo.sort((a, b) => a - b);
  const mediana = quantil(rsLimpo, 0.50);
  const p25     = quantil(rsLimpo, 0.25);
  const p75     = quantil(rsLimpo, 0.75);

  const areaTerr   = Number(avaliando.area_terreno);
  const areaConstr = Number(avaliando.area_construida || 0);
  if (!(areaTerr > 0)) throw new Error("buildValoracaoCasa: avaliando.area_terreno é obrigatório.");

  const valConstrAval  = cub * areaConstr * fatorDepreciacao(avaliando.idade, dOpts);
  const valorTerreno   = mediana * areaTerr;
  const valor          = valorTerreno + valConstrAval;
  const piso           = p25 * areaTerr + valConstrAval;
  const teto           = p75 * areaTerr + valConstrAval;

  const semIdade = semIdadeComp || !Number.isFinite(avaliando.idade);

  return {
    // contrato consumido pelo estudo_casa_generator.js
    rs_m2_terreno_alvo: rsM2fmt(mediana),
    rs_m2_terreno_p25:  rsM2fmt(p25),
    rs_m2_terreno_p75:  rsM2fmt(p75),
    valor_mercado:      milhoes(valor),
    faixa:              faixaFmt(piso, teto),
    area_terreno:       areaTerr,
    n_comps:            rsLimpo.length,
    conclusao_apoio:    `Valor = terreno (${milhoes(valorTerreno)}) + construção depreciada (${reais(valConstrAval)}). `
                      + `Terreno pela mediana de ${rsLimpo.length} casas vendidas (ITBI), corrigida pelo IPCA.`,
    // comps enriquecidos p/ a tabela (orchestrator usa estes no lugar dos crus)
    comps: enriched,
    // metadados p/ Ressalvas / debug
    metodo: "custo (terreno + construção depreciada)",
    cub, vida_util: dOpts.vidaUtil,
    depr_uniforme_usada: semIdade ? dOpts.deprPadrao : null,
    _debug: {
      rs_m2_terreno: { mediana:+mediana.toFixed(0), p25:+p25.toFixed(0), p75:+p75.toFixed(0) },
      valor_terreno:+valorTerreno.toFixed(0), valor_construcao:+valConstrAval.toFixed(0),
      valor:+valor.toFixed(0), piso:+piso.toFixed(0), teto:+teto.toFixed(0),
    },
  };
}

module.exports = { buildValoracaoCasa, fatorDepreciacao, ipcaFactor, quantil };
