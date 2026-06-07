// valoracao_casa.js — Avaliação de CASA/TERRENO pelo MÉTODO DO CUSTO.
// Exporta buildValoracaoCasa({ comps, avaliando, ref, opts }) — assinatura usada pelo orchestrator_casa.js.
// Separa terreno (valoriza) de construção (deprecia), em vez de dividir o preço TOTAL
// pela área de terreno (que embute a construção e infla o R$/m²).
//
//   1) p/ cada comparável: corrige o valor pelo IPCA até `ref`;
//      valor_construção = CUB × área_constr × depreciação(idade);
//      valor_terreno    = valor_corrigido − valor_construção (com piso de segurança);
//      R$/m²_terreno_limpo = valor_terreno / área_terreno.
//   1b) SELEÇÃO DE COMPARÁVEIS (evita super-avaliação por comp ruim):
//       TRAVA 1  faixa de tamanho de lote: mantém só lotes parecidos com o avaliando
//                (descarta micro-lotes que inflam o R$/m² e lotes grandes demais).
//       TRAVA 2  trim de outlier (cerca IQR) sobre o R$/m² de terreno limpo
//                (corta vendas de luxo / atípicas que puxam a mediana).
//       TRAVA 3  (opcional) ajuste de plottage: leva o R$/m² do comparável à escala
//                do lote alvo (lote grande tem R$/m² menor). Default DESLIGADA.
//   2) mediana / p25 / p75 sobre o R$/m²_terreno_limpo JÁ SELECIONADO (robusto a outlier).
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

  // DEBUG opcional: dumpa os comparáveis recebidos (só quando LOG_COMPS_CASA=1).
  if (process.env.LOG_COMPS_CASA === "1") {
    const enxuto = comps.map(c => ({
      data: c.data, area_terreno: Number(c.area_terreno),
      area_construida: Number(c.area_construida || 0), valor: Number(c.valor),
    }));
    console.log(`[valoracao_casa] comparaveis recebidos (${enxuto.length}): ` + JSON.stringify(enxuto));
  }

  const dOpts = {
    vidaUtil:   opts.vidaUtil   ?? 60,
    estadoCoef: opts.estadoCoef ?? 0,
    deprPadrao: opts.deprPadrao ?? 0.80,
  };
  const pisoTerrenoFrac = opts.pisoTerrenoFrac ?? 0.30;

  // ---- parâmetros das travas (ajustáveis via opts) ----
  const loteBandLo    = opts.loteBandLo    ?? 0.4;   // TRAVA 1: lote >= 0,4× o alvo
  const loteBandHi    = opts.loteBandHi    ?? 2.5;   //          ...e <= 2,5× o alvo
  const minCompsBanda = opts.minCompsBanda ?? 8;     //          se a faixa deixar < isto, relaxa (usa todos)
  const iqrK          = opts.iqrK          ?? 1.5;   // TRAVA 2: largura da cerca IQR (Tukey)
  const minCompsTrim  = opts.minCompsTrim  ?? 6;     //          se o trim deixar < isto, não aplica
  const plottageExp   = opts.plottageExp   ?? 0;     // TRAVA 3: 0 = desligada
  const tetoMediana   = opts.tetoMediana   ?? 1.6;   // TRAVA 4: descarta comps com R$/m² acima de N× a mediana local (corta luxo vizinho)

  const hoje   = new Date();
  const r      = ref ? parseDataBR(ref) : null;
  const anoRef = (r && Number.isFinite(r.ano)) ? r.ano : hoje.getFullYear();
  const mesRef = (r && Number.isFinite(r.mes)) ? r.mes : hoje.getMonth() + 1;

  const areaTerr   = Number(avaliando.area_terreno);
  const areaConstr = Number(avaliando.area_construida || 0);
  if (!(areaTerr > 0)) {
    const err = new Error("buildValoracaoCasa: avaliando.area_terreno é obrigatório.");
    err.code = "AREA_TERRENO_AUSENTE";
    throw err;
  }

  // 1) R$/m² de TERRENO LIMPO (corrigido IPCA) de cada comparável — ainda SEM seleção
  let semIdadeComp = false;
  const todos = [];
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

    todos.push({ ...c, valor: valorOrig, terreno, rs_num: rs });
  }
  if (!todos.length) {
    const err = new Error("buildValoracaoCasa: nenhum comparável válido (terreno e valor > 0).");
    err.code = "COMPS_INSUFICIENTES";
    throw err;
  }

  // ---- TRAVA 1: faixa de tamanho de lote ----
  const loLote = loteBandLo * areaTerr, hiLote = loteBandHi * areaTerr;
  let usados = todos.filter(x => x.terreno >= loLote && x.terreno <= hiLote);
  let faixaLoteRelaxada = false;
  if (usados.length < minCompsBanda) { usados = todos.slice(); faixaLoteRelaxada = true; }
  const nPosBanda = usados.length;

  // ---- TRAVA 3 (opcional): plottage — escala o R$/m² do comp para o lote alvo ----
  if (plottageExp > 0) {
    usados = usados.map(x => ({ ...x, rs_bruto: x.rs_num, rs_num: x.rs_num * Math.pow(x.terreno / areaTerr, plottageExp) }));
  }

  // ---- TRAVA 2: trim de outlier (cerca IQR) sobre o R$/m² limpo ----
  const rsParaTrim = usados.map(x => x.rs_num).sort((a, b) => a - b);
  const q1 = quantil(rsParaTrim, 0.25), q3 = quantil(rsParaTrim, 0.75);
  const iqr = q3 - q1;
  const cercaLo = q1 - iqrK * iqr, cercaHi = q3 + iqrK * iqr;
  const trimmed = usados.filter(x => x.rs_num >= cercaLo && x.rs_num <= cercaHi);
  let trimRelaxado = false;
  if (trimmed.length >= minCompsTrim) { usados = trimmed; } else { trimRelaxado = true; }

  // ---- TRAVA 4: teto relativo — descarta comps com R$/m² muito acima da mediana local ----
  // (vendas de luxo/atípicas que sobrevivem ao IQR quando a amostra tem cauda larga;
  //  é o que segura o valor estável independente do raio/ponto da busca)
  let tetoRelaxado = false;
  if (tetoMediana > 0 && usados.length >= minCompsTrim) {
    const arrTeto = usados.map(x => x.rs_num).sort((a, b) => a - b);
    const medLocal = quantil(arrTeto, 0.50);
    const semLuxo = usados.filter(x => x.rs_num <= tetoMediana * medLocal);
    if (semLuxo.length >= minCompsTrim) { usados = semLuxo; } else { tetoRelaxado = true; }
  }

  const removidos = todos.length - usados.length;

  // 2) mediana / p25 / p75 sobre o conjunto JÁ SELECIONADO
  const rsLimpo = usados.map(x => x.rs_num).sort((a, b) => a - b);
  const mediana = quantil(rsLimpo, 0.50);
  const p25     = quantil(rsLimpo, 0.25);
  const p75     = quantil(rsLimpo, 0.75);

  // comps enriquecidos p/ a tabela (só os SELECIONADOS, p/ casar com o headline)
  const enriched = usados.map(({ rs_num, terreno, ...rest }) => ({ ...rest, rs_m2_terreno: Math.round(rs_num) }));

  // 3) avaliando: terreno (faixa) + construção depreciada (ponto fixo)
  const valConstrAval = cub * areaConstr * fatorDepreciacao(avaliando.idade, dOpts);
  const valorTerreno  = mediana * areaTerr;
  const valor         = valorTerreno + valConstrAval;
  const piso          = p25 * areaTerr + valConstrAval;
  const teto          = p75 * areaTerr + valConstrAval;

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
    // comps enriquecidos p/ a tabela (orchestrator pode usar estes no lugar dos crus)
    comps: enriched,
    // metadados p/ Ressalvas / debug
    metodo: "custo (terreno + construção depreciada)",
    cub, vida_util: dOpts.vidaUtil,
    depr_uniforme_usada: semIdade ? dOpts.deprPadrao : null,
    // diagnóstico da seleção (novo — não quebra consumidores existentes)
    selecao: {
      n_total: todos.length,
      faixa_lote_m2: [Math.round(loLote), Math.round(hiLote)],
      n_pos_faixa_lote: nPosBanda,
      faixa_lote_relaxada: faixaLoteRelaxada,
      cerca_iqr: [Math.round(cercaLo), Math.round(cercaHi)],
      trim_relaxado: trimRelaxado,
      plottage_exp: plottageExp,
      teto_mediana: tetoMediana,
      teto_relaxado: tetoRelaxado,
      n_final: usados.length,
      removidos,
    },
    _debug: {
      rs_m2_terreno: { mediana:+mediana.toFixed(0), p25:+p25.toFixed(0), p75:+p75.toFixed(0) },
      valor_terreno:+valorTerreno.toFixed(0), valor_construcao:+valConstrAval.toFixed(0),
      valor:+valor.toFixed(0), piso:+piso.toFixed(0), teto:+teto.toFixed(0),
    },
  };
}

module.exports = { buildValoracaoCasa, fatorDepreciacao, ipcaFactor, quantil };
