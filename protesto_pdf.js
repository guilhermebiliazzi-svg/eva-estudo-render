// protesto_pdf.js
// Relatório em PDF da consulta de protestos (DirectD "Protestos Nacional - IEPTB Online").
// Substitui o comprovante do CENPROT-SP, que o Infosimples deixou de oferecer (set/2026).
//
// POST /protesto-pdf
//   body: { titular, documento, envelope }   // envelope = resposta da DirectD { metaDados, retorno }
//   resp: { ok, pdf_base64, constam, total, valor_total, mensagem }
//
// Só formata o que a DirectD devolveu: não consulta nada e não guarda nada.

const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const AZUL = rgb(0 / 255, 61 / 255, 165 / 255);
const VERMELHO = rgb(190 / 255, 18 / 255, 28 / 255);
const VERDE = rgb(16 / 255, 120 / 255, 72 / 255);
const CINZA = rgb(0.35, 0.4, 0.5);
const PRETO = rgb(0.09, 0.14, 0.23);
const LINHA = rgb(0.88, 0.9, 0.94);

// Helvetica padrão só tem WinAnsi: troca o que não existe nela
function win(s) {
  return String(s ?? "")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-").replace(/…/g, "...")
    .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ]/g, "?");
}
const pick = (o, ...ks) => { for (const k of ks) { if (o && o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k]; } return undefined; };
// "valorTotalProtestos" -> "Valor total protestos"
function rotulo(k) {
  const s = String(k).replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function valorTxt(v) {
  if (v === true) return "Sim";
  if (v === false) return "Não";
  return String(v);
}

async function montarPDF({ titular, documento, envelope }) {
  const env = envelope || {};
  const meta = env.metaDados || env.MetaDados || {};
  const ret = env.retorno || env.Retorno || {};
  const constamRaw = pick(ret, "constamProtestos", "ConstamProtestos");
  const total = Number(pick(ret, "numeroTotalProtestos", "NumeroTotalProtestos") || 0);
  const constam = constamRaw === true || String(constamRaw).toLowerCase() === "true" || total > 0;
  const valorTotal = pick(ret, "valorTotalProtestos", "ValorTotalProtestos");
  const protestos = pick(ret, "protestos", "Protestos") || [];

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const M = 50, PW = 595.28, PH = 841.89, W = PW - M * 2;
  let page, y;
  const nova = () => { page = doc.addPage([PW, PH]); y = PH - 50; };
  const precisa = (h) => { if (y - h < 60) nova(); };
  const text = (s, x, yy, { size = 10, f = font, color = PRETO } = {}) =>
    page.drawText(win(s), { x, y: yy, size, font: f, color });
  // quebra de linha por largura
  const quebra = (s, size, f, largura) => {
    const out = []; let cur = "";
    for (const w of win(s).split(/\s+/)) {
      const t = cur ? cur + " " + w : w;
      if (f.widthOfTextAtSize(t, size) > largura && cur) { out.push(cur); cur = w; } else cur = t;
    }
    if (cur) out.push(cur);
    return out.length ? out : [""];
  };
  const par = (s, { size = 10, f = font, color = PRETO, x = M, largura = W, gap = 3 } = {}) => {
    for (const l of quebra(s, size, f, largura)) { precisa(size + gap); text(l, x, y, { size, f, color }); y -= size + gap; }
  };
  const linha = () => { page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.7, color: LINHA }); };

  nova();
  page.drawRectangle({ x: M, y: y - 8, width: W, height: 36, color: AZUL });
  text("CONSULTA DE PROTESTOS - CENPROT / IEPTB", M + 14, y + 6, { size: 13, f: bold, color: rgb(1, 1, 1) });
  y -= 50;

  text("TITULAR", M, y, { size: 8, f: bold, color: CINZA });
  text("CPF / CNPJ", M + W - 170, y, { size: 8, f: bold, color: CINZA });
  y -= 14;
  const linhasTit = quebra(titular || "-", 11, bold, W - 190);
  text(documento || pick(ret, "documentoConsultado") || "-", M + W - 170, y, { size: 11, f: bold });
  for (const l of linhasTit) { text(l, M, y, { size: 11, f: bold }); y -= 14; }
  y -= 10;
  text("DATA DA CONSULTA", M, y, { size: 8, f: bold, color: CINZA });
  text("PROTOCOLO DIRECTD", M + W - 170, y, { size: 8, f: bold, color: CINZA });
  y -= 14;
  text(pick(meta, "data", "Data") || pick(ret, "dataConsulta") || "-", M, y, { size: 10 });
  text(pick(meta, "consultaUid", "ConsultaUid") || "-", M + W - 170, y, { size: 7 });
  y -= 30;

  // resultado
  const caixaCor = constam ? rgb(0.99, 0.94, 0.94) : rgb(0.93, 0.98, 0.95);
  page.drawRectangle({ x: M, y: y - 14, width: W, height: 40, color: caixaCor });
  text(constam ? "CONSTAM PROTESTOS" : "NÃO CONSTAM PROTESTOS", M + 14, y + 6,
       { size: 14, f: bold, color: constam ? VERMELHO : VERDE });
  if (constam) {
    text(`${total || "?"} protesto(s)` + (valorTotal ? `  ·  valor total ${valorTotal}` : ""), M + 14, y - 8, { size: 10, color: PRETO });
  } else {
    text("Nenhum protesto encontrado em nome do titular na base nacional do CENPROT.", M + 14, y - 8, { size: 9, color: PRETO });
  }
  y -= 44;

  const obs = pick(ret, "observacoes", "Observacoes");
  if (obs) { par("Observações: " + obs, { size: 9, color: CINZA }); y -= 6; }

  // detalhe: percorre a estrutura que vier (estado -> cartório -> títulos)
  const escalares = (o) => Object.entries(o || {}).filter(([, v]) => v !== null && v !== undefined && v !== "" && typeof v !== "object");
  const listas = (o) => Object.entries(o || {}).filter(([, v]) => Array.isArray(v) && v.length);
  function bloco(o, nivel, titulo) {
    const x = M + nivel * 14, larg = W - nivel * 14;
    if (titulo) { precisa(30); y -= 4; text(titulo, x, y, { size: 10, f: bold, color: AZUL }); y -= 14; }
    for (const [k, v] of escalares(o)) par(rotulo(k) + ": " + valorTxt(v), { size: 9, x, largura: larg, gap: 2 });
    for (const [k, arr] of listas(o)) {
      arr.forEach((it, i) => {
        if (it && typeof it === "object") bloco(it, nivel + 1, rotulo(k) + " " + (i + 1));
        else par(rotulo(k) + ": " + valorTxt(it), { size: 9, x: x + 14, largura: larg - 14, gap: 2 });
      });
    }
    y -= 4;
  }
  if (constam && Array.isArray(protestos) && protestos.length) {
    precisa(40); text("DETALHAMENTO", M, y, { size: 11, f: bold, color: AZUL }); y -= 8; linha(); y -= 16;
    protestos.forEach((p, i) => bloco(p, 0, "Protesto " + (i + 1)));
  }

  // rodapé em todas as páginas
  const pags = doc.getPages();
  pags.forEach((p, i) => {
    p.drawText(win("Fonte: DirectD - Protestos Nacional (IEPTB/CENPROT), consulta online. Relatório gerado pela Ville Jardins a partir do retorno da consulta; não substitui a certidão oficial do tabelionato."),
      { x: M, y: 38, size: 7, font, color: CINZA, maxWidth: W, lineHeight: 9 });
    p.drawText(win(`Página ${i + 1} de ${pags.length}`), { x: M + W - 60, y: 22, size: 7, font, color: CINZA });
  });

  return { bytes: await doc.save(), constam, total, valorTotal: valorTotal || null };
}

module.exports = function registrar(app) {
  app.post("/protesto-pdf", async (req, res) => {
    try {
      const { titular, documento, envelope } = req.body || {};
      if (!envelope || !(envelope.retorno || envelope.Retorno)) {
        return res.status(400).json({ ok: false, mensagem: "envelope da DirectD sem retorno" });
      }
      const r = await montarPDF({ titular, documento, envelope });
      res.json({ ok: true, pdf_base64: Buffer.from(r.bytes).toString("base64"),
                 constam: r.constam, total: r.total, valor_total: r.valorTotal });
    } catch (e) {
      res.status(500).json({ ok: false, mensagem: String(e && e.message || e) });
    }
  });
};
module.exports.montarPDF = montarPDF;
