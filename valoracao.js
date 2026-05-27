/**
 * EVA · Função de valoração (passo D) — produz o bloco "valoracao" do contrato.
 *
 * Aplica as regras travadas:
 *  - âncora = venda real mais recente do MESMO prédio (ITBI);
 *  - teto por correção monetária = âncora corrigida pelo IPCA até hoje;
 *  - teto de concorrência = menor anúncio equivalente no mesmo prédio;
 *  - preço de anúncio sugerido = min(teto_concorrencia, teto_correcao)  [override possível];
 *  - fechamento esperado = anúncio × (1 − deságio);
 *  - valor de mercado e faixa derivados (arredondados p/ leitura).
 *
 * Roda sobre valores NUMÉRICOS (R$), não sobre as strings do contrato.
 *   const { buildValoracao } = require("./valoracao");
 *   data.valoracao = buildValoracao({ vendidos, amostras, ref: {ano:2026, mes:4} });
 */

// IPCA anual (%) — atualizar / ou puxar do BCB série 433 (IPCA mensal).
const IPCA_ANUAL = { 2018:3.75, 2019:4.31, 2020:4.52, 2021:10.06, 2022:5.79, 2023:4.62, 2024:4.83, 2025:4.26 };
// Acumulado do ano corrente até o mês de referência (ex.: jan→abr/2026 = 2,60%).
const IPCA_YTD = { 2026: 2.60 };

const MESES = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];

// fator de correção do IPCA de (anoDe/mesDe) até (anoRef/mesRef)
function ipcaFactor(anoDe, mesDe, anoRef, mesRef){
  let f = Math.pow(1 + (IPCA_ANUAL[anoDe]||0)/100, (12 - mesDe)/12); // resto do ano da venda
  for (let y = anoDe + 1; y < anoRef; y++) f *= 1 + (IPCA_ANUAL[y]||0)/100;
  f *= 1 + (IPCA_YTD[anoRef]||0)/100; // parcial do ano de referência
  return f;
}

const roundTo = (v, step) => Math.round(v/step)*step;
const floorTo = (v, step) => Math.floor(v/step)*step;
const decs    = v => (v/1e6) < 10 ? 2 : 1;   // <R$10mi: 2 casas; senão 1
const milhar  = n => String(Math.round(Math.abs(Number(n)))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const reaisN  = v => milhar(Math.round(Number(v)/1000)*1000) + ",00"; // arredonda p/ milhar: "461.000,00"
const reais   = v => "R$ " + reaisN(v);                               // < R$1mi: "R$ 461.000,00"
const milhoes = v => Number(v) < 1e6 ? reais(v) : "R$ " + (v/1e6).toFixed(decs(v)).replace(".", ",") + " milhões";
const mi      = v => Number(v) < 1e6 ? reais(v) : "R$ " + (v/1e6).toFixed(decs(v)).replace(".", ",") + " mi";
const pct     = f => "+" + ((f-1)*100).toFixed(1).replace(".", ",") + "%";

function parseDataBR(d){ // "19/12/2023" ou Date/ISO -> {ano,mes}
  if (d instanceof Date) return { ano:d.getUTCFullYear(), mes:d.getUTCMonth()+1 };
  const m = String(d).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return { ano:+m[3], mes:+m[2] };
  const x = new Date(d); return { ano:x.getUTCFullYear(), mes:x.getUTCMonth()+1 };
}

function buildValoracao({ vendidos = [], amostras = [], ref, opts = {} }){
  const desagio   = opts.desagio ?? 0.05;   // pedido -> fechamento
  const hoje      = new Date();
  const anoRef    = ref?.ano ?? hoje.getFullYear();
  const mesRef    = ref?.mes ?? (hoje.getMonth()+1);

  // 1) âncora = venda real mais recente do mesmo prédio — porém de APARTAMENTO.
  //    Vaga avulsa NUNCA ancora (uma vaga não precifica um apê). As vagas continuam
  //    no conjunto/tabela (o corretor correlaciona pela data); só não viram âncora.
  const ehVagaAvulsa = v => {
    const u = String(v.unidade || "").trim();
    const a = Number(v.area_m2 ?? v.area ?? 0);
    return /^(VG|VAGA|BOX)\b/i.test(u) || (a > 0 && a < 30);
  };
  const aptos = vendidos.filter(v => !ehVagaAvulsa(v));
  const pool  = aptos.length ? aptos : vendidos; // fallback raro: só houver vaga
  const dKey  = v => parseDataBR(v.data).ano*12 + parseDataBR(v.data).mes;
  const anchor = pool.find(v => v.is_ancora === true || v.ancora === true) ||
    [...pool].sort((a,b)=> dKey(b) - dKey(a))[0];
  const aV = Number(anchor.valor);
  const aD = parseDataBR(anchor.data);

  // passo de arredondamento adaptativo à magnitude — R$1mi não pode arredondar em R$0,5mi
  const passo = opts.passo ?? (aV < 3e6 ? 50e3 : aV < 8e6 ? 250e3 : 0.5e6);

  // 2) teto por correção monetária (IPCA)
  const fator = ipcaFactor(aD.ano, aD.mes, anoRef, mesRef);
  const tetoCorrecao = aV * fator;

  // 3) teto de concorrência = menor anúncio equivalente NO MESMO prédio
  const mesmoPredio = amostras.filter(a => a.tipo === "mesmo_predio" && Number(a.valor) > 0);
  const tetoConc = mesmoPredio.length ? Math.min(...mesmoPredio.map(a => Number(a.valor))) : Infinity;
  const concorrente = mesmoPredio.length
    ? mesmoPredio.reduce((m,a)=> Number(a.valor) < Number(m.valor) ? a : m)
    : null;

  // 4) preço de anúncio sugerido
  const anuncio = opts.anuncio_override ?? Math.min(tetoConc, tetoCorrecao);

  // 5) fechamento, valor de mercado e faixa
  const fechamento  = anuncio * (1 - desagio);
  const valorMerc   = roundTo((fechamento + anuncio)/2, passo);
  const faixaMin    = floorTo(fechamento, passo);
  const faixaMax    = anuncio;

  // labels
  const vagasAnchor = (String(anchor.unidade||"").match(/(\d+)\s*vagas?/i)||[])[1]
                   || (String(anchor.unidade||"").match(/(\d+)\s*VG/i)||[])[1];
  const ancoraCurto = `${MESES[aD.mes-1]}/${aD.ano}`;

  return {
    concorrente_valor: concorrente ? milhoes(Number(concorrente.valor)) : milhoes(anuncio),
    concorrente_label: concorrente
      ? `unidade equivalente${concorrente.vagas?`, ${concorrente.vagas} vagas`:""}, já anunciada`
      : "anúncio equivalente no mesmo prédio",
    ancora_valor: milhoes(aV),
    ancora_label: `${ancoraCurto} · mesmo prédio${vagasAnchor?` · ${vagasAnchor} vagas`:""}`,
    ancora_curto: ancoraCurto,
    ipca_pct: pct(fator),
    valor_mercado: milhoes(valorMerc),
    faixa: (faixaMin >= 1e6 && faixaMax >= 1e6)
      ? `R$ ${(faixaMin/1e6).toFixed(decs(faixaMin)).replace(".",",")} a ${(faixaMax/1e6).toFixed(decs(faixaMax)).replace(".",",")} milhões`
      : `${reais(faixaMin)} a ${reaisN(faixaMax)}`,
    anuncio_sugerido: milhoes(anuncio),
    anuncio_sub: `alinhado ao concorrente direto · fechamento esperado ~${mi(fechamento)}`,
    conclusao_apoio: `Ancorado na venda real do próprio prédio (ITBI) e limitado pela unidade equivalente já anunciada no mesmo condomínio (${milhoes(anuncio)}).`,
    _debug: {
      anchor: aV, fator: +fator.toFixed(4), teto_correcao: Math.round(tetoCorrecao),
      teto_concorrencia: isFinite(tetoConc)?tetoConc:null, anuncio, fechamento: Math.round(fechamento),
      valor_mercado: valorMerc, faixa: [faixaMin, faixaMax]
    }
  };
}

module.exports = { buildValoracao, ipcaFactor };
