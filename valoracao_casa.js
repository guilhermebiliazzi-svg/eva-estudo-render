// valoracao_casa.js — Avaliação de CASA/TERRENO pelo MÉTODO DO CUSTO.
// Separa terreno (valoriza) de construção (deprecia), em vez de dividir o
// preço TOTAL pela área de terreno (que embute a construção e infla o R$/m²).
//
// Fluxo:
//   1) p/ cada comparável: valor_construção = CUB × área_constr × depreciação(idade)
//                          valor_terreno   = valor_venda − valor_construção  (com piso de segurança)
//                          R$/m²_terreno_limpo = valor_terreno / área_terreno
//   2) mediana / p25 / p75 sobre o R$/m²_terreno_limpo (robusto a outlier)
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
  } = opts;

  if (!Number.isFinite(cub) || cub <= 0) {
    throw new Error("valorarCasa: opts.cub (R$/m² de construção) é obrigatório no método do custo.");
  }

  const dOpts = { vidaUtil, estadoCoef, deprPadrao };

  // 1) R$/m² de TERRENO LIMPO de cada comparável
  const rsTerreno = [];
  const usados = [];
  for (const c of comparaveis) {
    const terreno = Number(c.terreno || c.area_terreno);
    const constr  = Number(c.constr  || c.area_construida || 0);
    const valor   = Number(c.valor); // já corrigido a hoje (IPCA)
    if (!(terreno > 0) || !(valor > 0)) continue;

    const valConstr = cub * constr * fatorDepreciacao(c.idade, dOpts);
    // guard: construção não pode comer o terreno inteiro
    const valTerreno = Math.max(valor - valConstr, valor * pisoTerrenoFrac);
    const rs = valTerreno / terreno;
    rsTerreno.push(rs);
    usados.push({ ...c, valConstr, valTerreno, rs_m2_terreno: rs });
  }

  if (!rsTerreno.length) throw new Error("valorarCasa: nenhum comparável válido (terreno e valor > 0).");

  rsTerreno.sort((a, b) => a - b);
  const mediana = quantil(rsTerreno, 0.50);
  const p25     = quantil(rsTerreno, 0.25);
  const p75     = quantil(rsTerreno, 0.75);

  // 2) avaliando: terreno (faixa) + construção depreciada (ponto fixo)
  const areaTerr   = Number(avaliando.area_terreno);
  const areaConstr = Number(avaliando.area_construida || 0);
  if (!(areaTerr > 0)) throw new Error("valorarCasa: avaliando.area_terreno é obrigatório.");

  const valConstrAvaliando = cub * areaConstr * fatorDepreciacao(avaliando.idade, dOpts);

  const valorTerrenoAlvo = mediana * areaTerr;
  const valor = valorTerrenoAlvo + valConstrAvaliando;
  const piso  = p25 * areaTerr   + valConstrAvaliando;
  const teto  = p75 * areaTerr   + valConstrAvaliando;

  const idadeFaltando = !Number.isFinite(avaliando.idade) ||
                        comparaveis.some(c => !Number.isFinite(c.idade));

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
  };
}

module.exports = { valorarCasa, fatorDepreciacao, quantil };
