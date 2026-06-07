/**
 * EVA · Valoração de CASA DE RUA / TERRENO — Método 2 (Comparáveis por R$/m² de terreno).
 *
 * Lógica:
 *   - cada comp tem valor e area_terreno -> R$/m² de terreno (recomputado aqui, não do SQL);
 *   - corrige cada R$/m² da data da venda até a data de referência pelo IPCA (mesma máquina do
 *     valoracao.js do apartamento — importada, não duplicada);
 *   - usa MEDIANA (resiste a outlier; nunca média) e p25/p75 da distribuição corrigida;
 *   - aplica ao terreno do avaliando: alvo = mediana × area_terreno; piso = p25 × …; teto = p75 × …
 *
 * Trava honesta: abaixo de `min_comps` (default 5) NÃO precifica — lança erro COMPS_INSUFICIENTES.
 * É de propósito: em avenida/área esparsa o Método 2 sozinho não sustenta um valor, e inventar
 * faixa em cima de 1–2 pontos seria pior que dizer "preciso de raio geográfico" (Fase 3).
 *
 *   const { buildValoracaoCasa } = require("./valoracao_casa");
 *   data.valoracao = buildValoracaoCasa({ comps, avaliando, ref:{ano,mes} });
 */
const { ipcaFactor } = require("./valoracao"); // reusa IPCA_ANUAL / IPCA_YTD / fator

// ---- formatadores (mesmas convenções do valoracao.js; pequenos e puros, replicados p/ autossuficiência) ----
const milhar  = n => String(Math.round(Math.abs(Number(n)))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const decs    = v => (v / 1e6) < 10 ? 2 : 1;
const reaisN  = v => milhar(Math.round(Number(v) / 1000) * 1000) + ",00";
const reais   = v => "R$ " + reaisN(v);
const milhoes = v => Number(v) < 1e6 ? reais(v) : "R$ " + (v / 1e6).toFixed(decs(v)).replace(".", ",") + " milhões";
const rsM2    = v => "R$ " + milhar(v) + "/m²";

function parseDataBR(d) { // "2025-10-14" | "14/10/2025" | Date -> {ano,mes}
  if (d instanceof Date) return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 };
  const br = String(d).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return { ano: +br[3], mes: +br[2] };
  const iso = String(d).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { ano: +iso[1], mes: +iso[2] };
  const x = new Date(d); return { ano: x.getUTCFullYear(), mes: x.getUTCMonth() + 1 };
}

// percentil por interpolação linear sobre array JÁ ordenado asc
function percentil(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function buildValoracaoCasa({ comps = [], avaliando = {}, ref, opts = {} }) {
  const minComps = opts.min_comps ?? 5;
  const hoje     = new Date();
  const anoRef   = ref?.ano ?? hoje.getFullYear();
  const mesRef   = ref?.mes ?? (hoje.getMonth() + 1);

  const areaTerreno = Number(avaliando.area_terreno);
  if (!(areaTerreno > 0)) {
    const err = new Error("Área de terreno do avaliando ausente ou inválida — obrigatória no Método 2.");
    err.code = "AVALIANDO_SEM_TERRENO";
    throw err;
  }

  // 1) R$/m² de terreno corrigido pelo IPCA, por comp
  const corrigidos = comps
    .map(c => {
      const area = Number(c.area_terreno), valor = Number(c.valor);
      if (!(area > 0) || !(valor > 0)) return null;
      const d = parseDataBR(c.data);
      const f = ipcaFactor(d.ano, d.mes, anoRef, mesRef);
      return (valor / area) * f; // R$/m² de terreno trazido a hoje
    })
    .filter(v => v != null && isFinite(v) && v > 0)
    .sort((a, b) => a - b);

  // 2) trava honesta
  if (corrigidos.length < minComps) {
    const err = new Error(
      `Comparáveis insuficientes (${corrigidos.length} de ${minComps} mínimos) para o Método 2 ` +
      `nesta via. Recomendado ampliar o raio ou usar busca geográfica (transversais).`
    );
    err.code = "COMPS_INSUFICIENTES";
    err.n_comps = corrigidos.length;
    throw err;
  }

  // 3) estatística robusta
  const p25 = percentil(corrigidos, 0.25);
  const med = percentil(corrigidos, 0.50);
  const p75 = percentil(corrigidos, 0.75);

  // 4) aplica ao terreno do avaliando
  const valorAlvo = med * areaTerreno;
  const faixaPiso = p25 * areaTerreno;
  const faixaTeto = p75 * areaTerreno;

  const faixaLabel = (faixaPiso >= 1e6 && faixaTeto >= 1e6)
    ? `R$ ${(faixaPiso / 1e6).toFixed(decs(faixaPiso)).replace(".", ",")} a ${(faixaTeto / 1e6).toFixed(decs(faixaTeto)).replace(".", ",")} milhões`
    : `${reais(faixaPiso)} a ${reaisN(faixaTeto)}`;

  return {
    metodo: "comparaveis_terreno",
    n_comps: corrigidos.length,
    area_terreno: areaTerreno,

    // R$/m² de terreno (corrigido a hoje)
    rs_m2_terreno_alvo: rsM2(med),
    rs_m2_terreno_p25: rsM2(p25),
    rs_m2_terreno_p75: rsM2(p75),

    // valores totais (terreno × R$/m²)
    valor_mercado: milhoes(valorAlvo),
    faixa: faixaLabel,

    conclusao_apoio:
      `Valor do terreno estimado por ${corrigidos.length} casas comparáveis vendidas (ITBI), ` +
      `a ${rsM2(med)} de terreno (mediana, corrigida pelo IPCA). Aplicado aos ${milhar(areaTerreno)} m² do lote. ` +
      `A construção e o uso específico do imóvel ajustam o valor final.`,

    _debug: {
      n_comps: corrigidos.length,
      rs_m2_p25: Math.round(p25), rs_m2_mediana: Math.round(med), rs_m2_p75: Math.round(p75),
      area_terreno: areaTerreno,
      valor_piso: Math.round(faixaPiso), valor_alvo: Math.round(valorAlvo), valor_teto: Math.round(faixaTeto),
      ref: { ano: anoRef, mes: mesRef },
    },
  };
}

module.exports = { buildValoracaoCasa, percentil };
