// recibo_repasse.js
// Gera o PDF do demonstrativo de repasse a partir do snapshot conferido
// (adm_repasses.itens_conferidos), sobe para o bucket "recibos" no
// Supabase Storage e grava a URL em adm_repasses.pdf_url.
//
// Registra as rotas no app Express (padrão require("./recibo_repasse")(app, pool)).
//
// Layout fiel ao demonstrativo antigo:
//   - cabeçalho azul #003DA5 "DEMONSTRATIVO DE REPASSE FINANCEIRO"
//   - proprietário / imóvel / competência
//   - Bloco 1: Recebimentos (cada item pela descrição)
//   - Bloco 2: Deduções (taxa adm + cada dedução pela categoria real + avulsas)
//   - Total líquido a repassar em vermelho #ED1C24

const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://nrgsutbwxysgzgaixlhe.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = "recibos";

const AZUL = rgb(0 / 255, 61 / 255, 165 / 255);
const VERMELHO = rgb(237 / 255, 28 / 255, 36 / 255);
const CINZA = rgb(0.35, 0.4, 0.5);
const PRETO = rgb(0.09, 0.14, 0.23);
const LINHA = rgb(0.9, 0.92, 0.95);

const MESES = ["janeiro","fevereiro","março","abril","maio","junho",
               "julho","agosto","setembro","outubro","novembro","dezembro"];

function brl(n) {
  const v = Number(n) || 0;
  return "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function competenciaTexto(comp) {
  // comp = 'YYYY-MM-DD' -> "julho de 2026"
  if (!comp) return "";
  const [y, m] = String(comp).split("-");
  const idx = parseInt(m, 10) - 1;
  return `${MESES[idx] || m} de ${y}`;
}

// ---- monta o PDF a partir do repasse + snapshot ----
async function montarPDF(repasse) {
  const snap = repasse.itens_conferidos || {};
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { width } = page.getSize();
  const M = 50;             // margem
  const W = width - M * 2;  // largura útil
  let y = 800;

  const text = (s, x, yy, { size = 10, f = font, color = PRETO } = {}) =>
    page.drawText(String(s ?? ""), { x, y: yy, size, font: f, color });
  const textR = (s, xRight, yy, opt = {}) => {
    const f = opt.f || font, size = opt.size || 10;
    const w = f.widthOfTextAtSize(String(s ?? ""), size);
    text(s, xRight - w, yy, opt);
  };
  const linha = (yy) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: M + W, y: yy }, thickness: 0.7, color: LINHA });

  // cabeçalho azul
  page.drawRectangle({ x: M, y: y - 6, width: W, height: 34, color: AZUL });
  text("DEMONSTRATIVO DE REPASSE FINANCEIRO", M + 14, y + 6, { size: 13, f: bold, color: rgb(1, 1, 1) });
  y -= 54;

  // dados do cabeçalho
  const cab = snap.cabecalho || {};
  text("PROPRIETÁRIO", M, y, { size: 8, f: bold, color: CINZA });
  text(cab.locador || repasse.locador_nome || "—", M, y - 14, { size: 11, f: bold });
  text("COMPETÊNCIA", M + W - 160, y, { size: 8, f: bold, color: CINZA });
  text(competenciaTexto(repasse.competencia), M + W - 160, y - 14, { size: 11, f: bold });
  y -= 34;
  text("IMÓVEL", M, y, { size: 8, f: bold, color: CINZA });
  text(cab.imovel || repasse.imovel || "—", M, y - 14, { size: 11 });
  y -= 40;

  // Bloco 1 — Recebimentos
  text("1. RECEBIMENTOS", M, y, { size: 11, f: bold, color: AZUL });
  y -= 8; linha(y); y -= 18;
  let totalReceb = 0;
  for (const it of (snap.recebimentos || [])) {
    text(it.descricao, M, y, { size: 10 });
    textR(brl(it.valor), M + W, y, { size: 10 });
    totalReceb += Number(it.valor) || 0;
    y -= 20;
  }
  y -= 2; linha(y); y -= 18;
  text("Total recebido", M, y, { size: 10, f: bold });
  textR(brl(snap.total_recebido != null ? snap.total_recebido : totalReceb), M + W, y, { size: 10, f: bold });
  y -= 36;

  // Bloco 2 — Deduções
  text("2. DEDUÇÕES", M, y, { size: 11, f: bold, color: AZUL });
  y -= 8; linha(y); y -= 18;

  // taxa de administração
  const taxa = snap.taxa_adm || {};
  if (taxa.valor != null) {
    text(taxa.descricao || "Taxa de administração", M, y, { size: 10 });
    textR(brl(taxa.valor), M + W, y, { size: 10 });
    y -= 20;
  }
  // deduções (condomínio, iptu, seguros, extraordinária) — pela descrição real
  for (const it of (snap.deducoes || [])) {
    text(it.descricao, M, y, { size: 10 });
    textR(brl(it.valor), M + W, y, { size: 10 });
    y -= 20;
  }
  // avulsas (manutenção, comissão, etc.)
  for (const it of (snap.avulsas || [])) {
    if (!it.descricao && !it.valor) continue;
    text(it.descricao || "Dedução", M, y, { size: 10 });
    textR(brl(it.valor), M + W, y, { size: 10 });
    y -= 20;
  }
  y -= 16;

  // Total líquido em vermelho
  page.drawRectangle({ x: M, y: y - 8, width: W, height: 32, color: rgb(0.99, 0.96, 0.96) });
  text("TOTAL LÍQUIDO A REPASSAR", M + 12, y + 4, { size: 12, f: bold, color: PRETO });
  textR(brl(snap.total_liquido != null ? snap.total_liquido : repasse.total_liquido), M + W - 12, y + 3, { size: 14, f: bold, color: VERMELHO });
  y -= 60;

  // rodapé
  text("RE/MAX Ville · Ville Jardins Negócios Imobiliários · CRECI J 37.196",
       M, 40, { size: 8, color: CINZA });

  return await doc.save();
}

// ---- upload para o Supabase Storage ----
async function subirStorage(nomeArquivo, bytes) {
  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${nomeArquivo}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/pdf",
      "x-upsert": "true",
    },
    body: Buffer.from(bytes),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Falha no upload (${res.status}): ${t}`);
  }
  // URL pública (bucket privado -> usaremos signed URL na leitura, mas guardamos o path)
  return `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${nomeArquivo}`;
}

module.exports = function (app, pool) {
  // POST /recibo-repasse  { repasse_id }  ou  { contrato_id, competencia }
  app.post("/recibo-repasse", async (req, res) => {
    try {
      const { repasse_id, contrato_id, competencia } = req.body || {};

      // busca o repasse (por id, ou por contrato+competência)
      let q, params;
      if (repasse_id) {
        q = `select r.*, lc.nome as locador_nome,
                    concat_ws(', ', im.rua, im.numero, im.complemento, im.bairro) as imovel
               from adm_repasses r
               join adm_contratos ct on ct.id = r.contrato_id
               join adm_imoveis im on im.id = ct.imovel_id
               join adm_locadores lc on lc.id = im.locador_id
              where r.id = $1 limit 1`;
        params = [repasse_id];
      } else if (contrato_id && competencia) {
        q = `select r.*, lc.nome as locador_nome,
                    concat_ws(', ', im.rua, im.numero, im.complemento, im.bairro) as imovel
               from adm_repasses r
               join adm_contratos ct on ct.id = r.contrato_id
               join adm_imoveis im on im.id = ct.imovel_id
               join adm_locadores lc on lc.id = im.locador_id
              where r.contrato_id = $1 and r.competencia = $2 limit 1`;
        params = [contrato_id, competencia];
      } else {
        return res.status(400).json({ error: "Informe repasse_id ou (contrato_id e competencia)." });
      }

      const { rows } = await pool.query(q, params);
      if (!rows.length) return res.status(404).json({ error: "Repasse não encontrado." });
      const repasse = rows[0];
      if (!repasse.itens_conferidos) {
        return res.status(400).json({ error: "Repasse ainda não foi conferido/gravado (sem snapshot)." });
      }

      const bytes = await montarPDF(repasse);
      const nome = `repasse-${repasse.contrato_id}-${String(repasse.competencia).slice(0, 7)}.pdf`;
      const pdfUrl = await subirStorage(nome, bytes);

      await pool.query(`update adm_repasses set pdf_url = $1, updated_at = now() where id = $2`,
                       [pdfUrl, repasse.id]);

      res.json({ ok: true, repasse_id: repasse.id, pdf_url: pdfUrl, arquivo: nome });
    } catch (e) {
      res.status(500).json({ error: String(e && e.message || e) });
    }
  });

  // GET /recibo-repasse/:id/url  -> gera signed URL temporária (bucket privado)
  app.get("/recibo-repasse/:id/url", async (req, res) => {
    try {
      const { rows } = await pool.query(`select pdf_url from adm_repasses where id = $1`, [req.params.id]);
      if (!rows.length || !rows[0].pdf_url) return res.status(404).json({ error: "Sem recibo gerado." });
      const nome = String(rows[0].pdf_url).split(`/${BUCKET}/`)[1];
      const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${nome}`, {
        method: "POST",
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: 3600 }),
      });
      const d = await r.json();
      if (!r.ok) return res.status(502).json({ error: "Falha ao assinar URL", detail: d });
      res.json({ url: `${SUPABASE_URL}/storage/v1${d.signedURL}` });
    } catch (e) {
      res.status(500).json({ error: String(e && e.message || e) });
    }
  });
};
