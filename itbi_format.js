/**
 * EVA · converte as linhas da query (C1) no bloco "vendidos" do contrato do estudo.
 * Uso no n8n (Code node) ou no serviço de render:
 *   const { vendidosFromRows } = require("./itbi_format");
 *   data.vendidos = vendidosFromRows(rowsDaQuery);
 *
 * Espera linhas com: { data, unidade, area_m2, valor, valor_m2, is_ancora }
 */
const fmtMi  = v => "R$ " + (Number(v) / 1e6).toFixed(2).replace(".", ",") + " mi"; // 7400000 -> "R$ 7,40 mi"
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

module.exports = { vendidosFromRows, fmtMi, fmtM2, fmtNum, fmtDate, cleanUnidade };
