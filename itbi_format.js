/**
 * EVA · converte as linhas da query (C1) no bloco "vendidos" do contrato do estudo.
 * Uso no n8n (Code node) ou no serviço de render:
 *   const { vendidosFromRows } = require("./itbi_format");
 *   data.vendidos = vendidosFromRows(rowsDaQuery);
 *
 * Espera linhas com: { data, unidade, area_m2, valor, valor_m2, is_ancora }
 */
const milhar = n => String(Math.round(Math.abs(Number(n)))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
// >= R$1mi: "R$ 7,40 mi"  ·  < R$1mi: "R$ 470.000" (sem ",00" — o sufixo fazia a célula
// quebrar em 2 linhas e a tabela de vendidos estourar o slide em prédios sub-milhão)
const fmtMi  = v => Number(v) < 1e6
  ? "R$ " + milhar(Math.round(Number(v)/1000)*1000)
  : "R$ " + (Number(v) / 1e6).toFixed(2).replace(".", ",") + " mi";
const fmtM2  = a => Math.round(Number(a)) + " m²";                                  // 743 -> "743 m²"
const fmtNum = n => Math.round(Number(n)).toLocaleString("pt-BR");                  // 9959.62 -> "9.960"
const fmtDate = d => {                                                              // Date/ISO -> "dd/mm/aaaa"
  const x = new Date(d);
  return String(x.getUTCDate()).padStart(2, "0") + "/" +
         String(x.getUTCMonth() + 1).padStart(2, "0") + "/" + x.getUTCFullYear();
};

// "AP 231  1DEP 5VG" -> "AP 231 · 5 vagas" ; "AP 101  1DEP" -> "AP 101"
function cleanUnidade(c) {
  if (!c) return "";
  // 14/11: "AP 112 VG" (número da unidade + VG solto) virava "AP · 112 vagas" — o número antes do VG
  // só é quantidade quando NÃO é o número da unidade. Também trata "AP 81 E VG(S)".
  const s0 = String(c).replace(/\s+/g, " ").trim();
  const mq = s0.match(/(\d+)\s*VGS?\b/i);
  if (mq && mq.index === s0.search(/\d/) && !/\d+\s*DEP\b/i.test(s0.slice(0, mq.index + mq[0].length))) {
    const base = s0.slice(0, mq.index + mq[1].length).trim();
    return `${base} · com vaga`;
  }
  const mE = s0.match(/^(.*?\d+)\s+E\s+(?:(\d+)\s*)?VGS?\b/i);
  if (mE) return mE[2] ? `${mE[1]} · ${mE[2]} vaga${+mE[2] > 1 ? "s" : ""}` : `${mE[1]} · com vaga`;
  const vg = (String(c).match(/(\d+)\s*VG\b/i) || [])[1];
  c = String(c).replace(/\s*\d+\s*DEP\b/ig, "").replace(/\s*\d+\s*VG\b/ig, "")
               .replace(/\s+/g, " ").trim();
  return vg ? `${c} · ${vg} vagas` : c;
}

function vendidosFromRows(rows) {
  return (rows || []).map(r => {
    const it = {
      data:     fmtDate(r.data),
      unidade:  cleanUnidade(r.unidade || ""),
      area:     fmtM2(r.area_m2),
      valor:    fmtMi(r.valor),
      valor_m2: fmtNum(r.valor_m2),
    };
    if (r.is_ancora === true || r.is_ancora === "t" || r.is_ancora === 1) it.ancora = true;
    return it;
  });
}

// detecta vaga avulsa: prefixo da unidade OU área minúscula (<15 m² — vaga típica tem 9–13;
// o corte baixo evita engolir kitnet de 20-28 m²). v3.8: cobre "GAR"/"GARAGEM"/"ESTACIONAMENTO",
// que antes passavam como "apto" e quebravam o cruzamento apto+vaga (caso APTO 141, 10/09).
// v3.12 · 3º parâmetro: flag do USO do IPTU (GARAGEM) vinda do SQL — pega a vaga vendida como
// fração da garagem coletiva, cujo complemento não diz "vaga" ("G 16 A 22 T").
const isVaga = (u, area, usoGaragem) =>
  usoGaragem === true ||
  /^(VG|VAGA|BOX|GAR|GARAGEM|ESTACION)/i.test(String(u || "").trim()) ||
  (Number(area) > 0 && Number(area) < 15);

// agrega linhas CRUAS: apto + vagas do mesmo dia viram 1 linha com valor total.
// v3.8: vagas lançadas em dia PRÓXIMO (até 5 dias) do apto também são anexadas — a guia da
// vaga às vezes é paga dias depois; e com 2+ aptos no mesmo dia, nenhum é mais descartado.
function aggregateByDate(rawRows) {
  const dayOf = d => { const x = d instanceof Date ? d : new Date(String(d).slice(0,10)); return Math.floor(x.getTime() / 86400000); };
  const byKey = new Map();
  for (const r of (rawRows || [])) {
    const key = String(r.data instanceof Date ? r.data.toISOString().slice(0, 10) : r.data);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }
  const grupos = [];      // { apto, vagas: [], dia }
  const orfas  = [];      // vagas de dia sem apto
  for (const [, rows] of byKey) {
    const aptos = rows.filter(r => !isVaga(r.unidade, r.area_m2, r.is_vaga));
    const vagas = rows.filter(r =>  isVaga(r.unidade, r.area_m2, r.is_vaga));
    if (aptos.length === 0) { orfas.push(...vagas); continue; }
    aptos.forEach((apto, i) => grupos.push({ apto, vagas: i === 0 ? vagas.slice() : [], dia: dayOf(apto.data) }));
  }
  // vaga órfã → anexa ao apto mais próximo em até 5 dias (guia paga em dia diferente)
  for (const v of orfas) {
    const dv = dayOf(v.data);
    let alvo = null, melhor = 6;
    for (const g of grupos) { const d = Math.abs(g.dia - dv); if (d < melhor) { melhor = d; alvo = g; } }
    if (alvo) alvo.vagas.push(v);   // sem apto num raio de 5 dias → descarta (venda avulsa de vaga)
  }
  const out = grupos.map(({ apto, vagas }) => {
    const vagasValor = vagas.reduce((s, v) => s + Number(v.valor || 0), 0);
    const valorTotal = Number(apto.valor || 0) + vagasValor;
    const aptoArea = Number(apto.area_m2 || 0);
    return {
      data: apto.data,
      unidade: vagas.length > 0
        ? `${apto.unidade} + ${vagas.length} vaga${vagas.length > 1 ? "s" : ""}`
        : apto.unidade,
      area_m2: aptoArea,
      valor: valorTotal,
      valor_m2: aptoArea > 0 ? valorTotal / aptoArea : 0,
      // v3.9 (14/10) · componentes da transação — permitem comparar "sem vaga" com "sem vaga"
      valor_apto: Number(apto.valor || 0),
      vagas_qtd: vagas.length,
      valor_vagas: vagasValor,
      is_ancora: [apto, ...vagas].some(r => r.is_ancora === true || r.is_ancora === "t" || r.is_ancora === 1),
    };
  });
  // ordena por data ASC (mesma ordem que o SQL C1 produz)
  out.sort((a, b) => new Date(a.data) - new Date(b.data));
  return out;
}

// agregar + formatar em uma chamada (uso conveniente no gerador)
function vendidosAggregatedFromRows(rawRows) {
  return vendidosFromRows(aggregateByDate(rawRows));
}

module.exports = { vendidosFromRows, vendidosAggregatedFromRows, aggregateByDate, isVaga, fmtMi, fmtM2, fmtNum, fmtDate, cleanUnidade };
