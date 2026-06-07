// valoracao_casa.js — Avaliação de CASA/TERRENO pelo MÉTODO DO CUSTO.
// Separa terreno (valoriza) de construção (deprecia), em vez de dividir o
// preço TOTAL pela área de terreno (que embute a construção e infla o R$/m²).
//
// Fluxo:
//   1) p/ cada comparável: valor_construção = CUB × área_constr × depreciação(idade)
//                          valor_terreno   = valor_venda − valor_construção  (com piso de segurança)
//                          R$/m²_terreno_limpo = valor_terreno / área_terreno
//   1b) SELEÇÃO DE COMPARÁVEIS (novo — evita super-avaliação por comp ruim):
//       TRAVA 1  faixa de tamanho de lote: mantém só lotes parecidos com o avaliando
//                (descarta micro-lotes que inflam o R$/m² e lotes grandes demais).
//       TRAVA 2  trim de outlier (cerca IQR) sobre o R$/m² de terreno limpo
//                (corta vendas de luxo / atípicas que puxam a mediana).
//       TRAVA 3  (opcional) ajuste de plottage: leva o R$/m² do comparável à escala
//                do lote alvo (lote grande tem R$/m² menor). Default DESLIGADA.
//   2) mediana / p25 / p75 sobre o R$/m²_terreno_limpo JÁ SELECIONADO (robusto a outlier)
//   3) avaliando: valor = mediana × área_terreno + CUB × área_constr × depreciação(idade)
//
// REQUER, além do payload atual:
//   opts.cub          — R$/m² construído (CUB-SP por padrão construtivo). SEM DEFAULT CONFIÁVEL: defina.
//   idade (anos)      — por comparável e do avaliando. Se ausente, usa opts.deprPadrao (assunção uniforme → Ressalvas).
//
// Mantém o IPCA fora daqui: passe `valor` já corrigido a hoje (como hoje a mediana é "corrigida a hoje").

// ---------- depreciação (Ross + coeficiente de estado opcional, à la Heidecke) ----------
function fatorDepreciacao(idade, { vidaUtil = 60, estadoCoef = 0, deprPadrao = 0.80 } = {}) {
  if (!Number.isFinite(idade) || idade < 0) return deprPadrao;            // sem idade → fallback uniforme
  const k = Math.min(idade / vidaUtil, 1);
  const dRoss = 0.5 * (k + k * k);                                        // depreciação por idade (Ross)
  const d = dRoss + (1 - dRoss) * estadoCoef;                            // + estado de conservação (0 = novo/ótimo)
  return Math.min(Math.max(1 - d, 0.20), 1);                            // piso de 20% de valor residual
}

// ---------- quantil com interpolação linear ----------
function quantil(arrOrdenado, q) {
  const n = arrOrdenado.length;
  if (!n) return NaN;
  if (n === 1) return arrOrdenado[0];
  const pos = (n - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return arrOrdenado[lo];
  return arrOrdenado[lo] + (arrOrdenado[hi] - arrOrdenado[lo]) * (pos - lo);
}

function valorarCasa({ avaliando = {}, comparaveis = [], opts = {} }) {
  const {
    cub,                                  // OBRIGATÓRIO: R$/m² de reposição da construção
    vidaUtil = 60,
    estadoCoef = 0,                       // 0 = ótimo; aumente p/ imóveis mais deteriorados
    deprPadrao = 0.80,                    // usado só quando falta idade
    pisoTerrenoFrac = 0.30,               // terreno nunca < 30% do valor da venda (guard anti-construção-cara)

    // ---- TRAVA 1: faixa de tamanho de lote (relativa ao lote do avaliando) ----
    loteBandLo = 0.4,                     // mantém comps com terreno >= 0,4× o lote alvo
    loteBandHi = 2.5,                     // ...e <= 2,5× o lote alvo
    minCompsBanda = 8,                    // se a faixa deixar menos que isto, relaxa (usa todos)
    // ---- TRAVA 2: trim de outlier (cerca IQR) sobre o R$/m² limpo ----
    iqrK = 1.5,                           // largura da cerca (1,5 = padrão Tukey)
    minCompsTrim = 6,                     // se o trim deixar menos que isto, não aplica
    // ---- TRAVA 3: ajuste de plottage (opcional, default off) ----
    plottageExp = 0,                      // 0 = desligado. ~0,15–0,25 reduz o R$/m² de lotes menores que o alvo
  } = opts;

  if (!Number.isFinite(cub) || cub <= 0) {
    throw new Error("valorarCasa: opts.cub (R$/m² de construção) é obrigatório no método do custo.");
  }

  // DEBUG opcional: dumpa os comparáveis recebidos (só quando LOG_COMPS_CASA=1 no ambiente).
  // Serve pra capturar os 60 comps de um estudo nos logs do Render e calibrar as travas.
  if (process.env.LOG_COMPS_CASA === "1") {
    const enxuto = comparaveis.map(c => ({
      data: c.data,
      area_terreno: Number(c.terreno || c.area_terreno),
      area_construida: Number(c.constr || c.area_construida || 0),
      valor: Number(c.valor),
    }));
    console.log(`[valoracao_casa] comparaveis recebidos (${enxuto.length}): ` + JSON.stringify(enxuto));
  }

  const dOpts = { vidaUtil, estadoCoef, deprPadrao };

  const areaTerr   = Number(avaliando.area_terreno);
  const areaConstr = Number(avaliando.area_construida || 0);
  if (!(areaTerr > 0)) throw new Error("valorarCasa: avaliando.area_terreno é obrigatório.");

  // 1) R$/m² de TERRENO LIMPO de cada comparável (ainda SEM seleção)
  const todos = [];
  for (const c of comparaveis) {
    const terreno = Number(c.terreno || c.area_terreno);
    const constr  = Number(c.constr  || c.area_construida || 0);
    const valor   = Number(c.valor); // já corrigido a hoje (IPCA aplicado a montante)
    if (!(terreno > 0) || !(valor > 0)) continue;

    const valConstr = cub * constr * fatorDepreciacao(c.idade, dOpts);
    // guard: construção não pode comer o terreno inteiro
    const valTerreno = Math.max(valor - valConstr, valor * pisoTerrenoFrac);
    const rs = valTerreno / terreno;
    todos.push({ ...c, terreno, constr, valor, valConstr, valTerreno, rs_m2_terreno: rs });
  }
  if (!todos.length) throw new Error("valorarCasa: nenhum comparável válido (terreno e valor > 0).");

  // ---- TRAVA 1: faixa de tamanho de lote ----
  const loLote = loteBandLo * areaTerr, hiLote = loteBandHi * areaTerr;
  let usados = todos.filter(x => x.terreno >= loLote && x.terreno <= hiLote);
  let faixaLoteRelaxada = false;
  if (usados.length < minCompsBanda) { usados = todos.slice(); faixaLoteRelaxada = true; }
  const nPosBanda = usados.length;

  // ---- TRAVA 3 (opcional): plottage — escala o R$/m² do comp para o lote alvo ----
  if (plottageExp > 0) {
    usados = usados.map(x => ({
      ...x,
      rs_bruto: x.rs_m2_terreno,
      rs_m2_terreno: x.rs_m2_terreno * Math.pow(x.terreno / areaTerr, plottageExp),
    }));
  }

  // ---- TRAVA 2: trim de outlier (cerca IQR) sobre o R$/m² limpo ----
  const rsOrdParaTrim = usados.map(x => x.rs_m2_terreno).sort((a, b) => a - b);
  const q1 = quantil(rsOrdParaTrim, 0.25), q3 = quantil(rsOrdParaTrim, 0.75);
  const iqr = q3 - q1;
  const cercaLo = q1 - iqrK * iqr, cercaHi = q3 + iqrK * iqr;
  const trimmed = usados.filter(x => x.rs_m2_terreno >= cercaLo && x.rs_m2_terreno <= cercaHi);
  let trimRelaxado = false;
  if (trimmed.length >= minCompsTrim) { usados = trimmed; } else { trimRelaxado = true; }

  const removidos = todos.length - usados.length;

  // 2) mediana / p25 / p75 sobre o conjunto JÁ SELECIONADO
  const rsTerreno = usados.map(x => x.rs_m2_terreno).sort((a, b) => a - b);
  const mediana = quantil(rsTerreno, 0.50);
  const p25     = quantil(rsTerreno, 0.25);
  const p75     = quantil(rsTerreno, 0.75);

  // 3) avaliando: terreno (faixa) + construção depreciada (ponto fixo)
  const valConstrAvaliando = cub * areaConstr * fatorDepreciacao(avaliando.idade, dOpts);

  const valorTerrenoAlvo = mediana * areaTerr;
  const valor = valorTerrenoAlvo + valConstrAvaliando;
  const piso  = p25 * areaTerr   + valConstrAvaliando;
  const teto  = p75 * areaTerr   + valConstrAvaliando;

  const idadeFaltando = !Number.isFinite(avaliando.idade) ||
                        usados.some(c => !Number.isFinite(c.idade));

  return {
    // base terreno limpo
    rs_m2_terreno: { mediana, p25, p75 },
    n_comparaveis: rsTerreno.length,
    // decomposição do avaliando
    valor_terreno: valorTerrenoAlvo,
    valor_construcao: valConstrAvaliando,
    // resultado
    valor, piso, teto,
    // metadados p/ Ressalvas e slides
    metodo: "custo (terreno + construção depreciada)",
    cub, vida_util: vidaUtil, depr_uniforme_usada: idadeFaltando ? deprPadrao : null,
    comparaveis_usados: usados,
    // diagnóstico da seleção (novo — não quebra consumidores existentes)
    selecao: {
      n_total: todos.length,
      faixa_lote_m2: [Math.round(loLote), Math.round(hiLote)],
      n_pos_faixa_lote: nPosBanda,
      faixa_lote_relaxada: faixaLoteRelaxada,
      cerca_iqr: [Math.round(cercaLo), Math.round(cercaHi)],
      trim_relaxado: trimRelaxado,
      plottage_exp: plottageExp,
      n_final: usados.length,
      removidos,
    },
  };
}

module.exports = { valorarCasa, fatorDepreciacao, quantil };

// ---------- self-test (node valoracao_casa.js) — usa os 6 comparáveis exibidos no estudo da Clóvis ----------
if (require.main === module) {
  // valores JÁ corrigidos a hoje pelo IPCA (≈ como o estudo exibe), p/ casar com a mediana "corrigida a hoje"
  const comps = [
    { data: "11/06/24", end: "Jose Jannarelli, 597",      area_terreno: 200, area_construida: 194, valor: 3_780_000 },
    { data: "01/10/25", end: "Jose Jannarelli, 466",      area_terreno: 500, area_construida: 228, valor: 5_700_000 },
    { data: "17/09/25", end: "Jose Jannarelli, 452",      area_terreno: 500, area_construida:  85, valor: 7_100_000 },
    { data: "05/11/24", end: "Prof Oswaldo Teixeira, 340", area_terreno:  70, area_construida: 102, valor:   795_000 },
    { data: "21/06/24", end: "Dos Tres Irmaos, 514",      area_terreno:  68, area_construida:  85, valor: 1_050_000 },
    { data: "20/01/25", end: "Guihei Vatanabe, 89",       area_terreno: 125, area_construida: 111, valor: 1_360_000 },
  ];
  const avaliando = { area_terreno: 500, area_construida: 270 }; // Clóvis 601, sem idade → depr uniforme 0,80
  const baseOpts = { cub: 2562.62, deprPadrao: 0.80 };
  const fmt = v => "R$ " + Math.round(v).toLocaleString("pt-BR");

  // SEM travas (replica o comportamento atual)
  const semTravas = valorarCasa({ avaliando, comparaveis: comps,
    opts: { ...baseOpts, loteBandLo: 0, loteBandHi: 9999, minCompsBanda: 0, iqrK: 1e9, minCompsTrim: 0 } });

  // COM travas — para 6 comps relaxa a faixa de lote (precisa de >=8); ilustra o IQR.
  const comTravas = valorarCasa({ avaliando, comparaveis: comps, opts: { ...baseOpts, minCompsBanda: 3, minCompsTrim: 3 } });

  const linha = (rotulo, r) => console.log(
    rotulo.padEnd(14),
    "n=" + r.n_comparaveis,
    "| mediana R$/m² terr=" + Math.round(r.rs_m2_terreno.mediana),
    "| faixa " + Math.round(r.rs_m2_terreno.p25) + "-" + Math.round(r.rs_m2_terreno.p75),
    "| VALOR " + fmt(r.valor),
    "(terreno " + fmt(r.valor_terreno) + " + constr " + fmt(r.valor_construcao) + ")"
  );

  console.log("=== Clovis 601 · lote 500 m² · constr 270 m² · CUB 2.562,62 (6 comps exibidos) ===");
  linha("SEM travas", semTravas);
  linha("COM travas", comTravas);
  console.log("selecao:", JSON.stringify(comTravas.selecao));
  console.log("mantidos:", comTravas.comparaveis_usados.map(c => `${c.end} (${c.terreno}m², R$/m²=${Math.round(c.rs_m2_terreno)})`));
}
