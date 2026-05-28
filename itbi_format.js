/**
 * EVA · converte as linhas da query (C1) no bloco "vendidos" do contrato do estudo.
 * Uso no n8n (Code node) ou no serviço de render:
 *   const { vendidosFromRows } = require("./itbi_format");
 *   data.vendidos = vendidosFromRows(rowsDaQuery);
 *
 * Espera linhas com: { data, unidade, area_m2, valor, valor_m2, is_ancora }
 */
const milhar = n => String(Math.round(Math.abs(Number(n)))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
// >= R$1mi: "R$ 7,40 mi"  ·  < R$1mi: "R$ 470.000,00"
const fmtMi  = v => Number(v) < 1e6
  ? "R$ " + milhar(Math.round(Number(v)/1000)*1000) + ",00"
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

// detecta vaga avulsa pelo prefixo da unidade (mesmo critério da valoracao.js)
const isVaga = u => /^(VG|VAGA|BOX)\b/i.test(String(u || "").trim());

// agrega linhas CRUAS por data: apto + vagas do mesmo dia viram 1 linha com valor total.
// Dias só de vagas (sem apto) são descartados. Útil quando o ITBI registra apto e
// vagas avulsas como transações separadas — caso comum em prédios novos / paulistas.
// Resultado: cada linha = 1 transação completa, comparável e coerente para o estudo.
function aggregateByDate(rawRows) {
  const byKey = new Map();
  for (const r of (rawRows || [])) {
    const key = String(r.data instanceof Date ? r.data.toISOString().slice(0, 10) : r.data);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }
  const out = [];
  for (const [, rows] of byKey) {
    const aptos = rows.filter(r => !isVaga(r.unidade));
    const vagas = rows.filter(r =>  isVaga(r.unidade));
    if (aptos.length === 0) continue; // só vagas no dia → ignora (não é venda de unidade)
    const apto = aptos[0]; // 1 apto por dia é o caso dominante em prédios pequenos
    const vagasValor = vagas.reduce((s, v) => s + Number(v.valor || 0), 0);
    const valorTotal = Number(apto.valor || 0) + vagasValor;
    const aptoArea = Number(apto.area_m2 || 0);
    out.push({
      data: apto.data,
      unidade: vagas.length > 0
        ? `${apto.unidade} + ${vagas.length} vaga${vagas.length > 1 ? "s" : ""}`
        : apto.unidade,
      area_m2: aptoArea,
      valor: valorTotal,
      valor_m2: aptoArea > 0 ? valorTotal / aptoArea : 0,
      is_ancora: rows.some(r => r.is_ancora === true || r.is_ancora === "t" || r.is_ancora === 1),
    });
  }
  // ordena por data ASC (mesma ordem que o SQL C1 produz)
  out.sort((a, b) => new Date(a.data) - new Date(b.data));
  return out;
}

// agregar + formatar em uma chamada (uso conveniente no gerador)
function vendidosAggregatedFromRows(rawRows) {
  return vendidosFromRows(aggregateByDate(rawRows));
}

module.exports = { vendidosFromRows, vendidosAggregatedFromRows, aggregateByDate, isVaga, fmtMi, fmtM2, fmtNum, fmtDate, cleanUnidade };
