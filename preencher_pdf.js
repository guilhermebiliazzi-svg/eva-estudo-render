// ============================================================
// preencher_pdf.js — endpoint POST /preencher-pdf
// Versão SEM multer: recebe JSON (mesmo padrão das outras rotas
// do server.js). O PDF chega em base64 no corpo. Devolve o PDF
// preenchido também em base64.
//
// INSTALAÇÃO NO RENDER (eva-estudo-render):
// 1) Criar este arquivo na raiz do repo (ao lado de server.js).
// 2) package.json -> em "dependencies" adicionar APENAS:
//        "pdf-lib": "^1.17.1"
//    (NAO precisa de multer nesta versao)
// 3) server.js -> logo depois da linha  const app = express();
//    (ou logo apos o app.use(express.json(...)))  adicionar UMA linha:
//        require("./preencher_pdf")(app);
// 4) Commit -> deploy automatico.
//
// Corpo esperado (application/json):
// {
//   "pdf_base64": "JVBERi0xLj...",
//   "campos":     { "campo_semantico": "valor", ... },
//   "mapeamento": { "campos": {...}, "padroes": {...} }
// }
// Resposta: { "ok": true, "pdf_base64": "...", "preenchidos": N, "ignorados": [...] }
// ============================================================

const { PDFDocument, StandardFonts } = require("pdf-lib");

module.exports = function (app) {
  app.post("/preencher-pdf", async (req, res) => {
    try {
      const body = req.body || {};
      const pdfB64 = body.pdf_base64;
      if (!pdfB64) {
        return res.status(400).json({ ok: false, erro: 'Campo "pdf_base64" ausente.' });
      }

      const mapeamento = (body.mapeamento && body.mapeamento.campos) || {};
      const padroes = (body.mapeamento && body.mapeamento.padroes) || {};
      const campos = body.campos || {};

      const valores = { ...padroes, ...campos };

      const pdfBytes = Buffer.from(pdfB64, "base64");
      const doc = await PDFDocument.load(pdfBytes);
      const form = doc.getForm();

      const preenchidos = [];
      const ignorados = [];

      for (const [semantico, valor] of Object.entries(valores)) {
        const v = valor == null ? "" : String(valor).trim();
        if (!v || v.includes("<<")) continue;

        const nomeCampoPdf = mapeamento[semantico];
        if (!nomeCampoPdf) {
          ignorados.push(semantico);
          continue;
        }
        try {
          form.getTextField(nomeCampoPdf).setText(v);
          preenchidos.push(semantico);
        } catch (e) {
          try {
            const cb = form.getCheckBox(nomeCampoPdf);
            const marcar = ["sim", "s", "x", "true", "1", "yes", "marcar", "ok"].includes(v.toLowerCase());
            if (marcar) cb.check(); else cb.uncheck();
            preenchidos.push(semantico);
          } catch (e2) {
            ignorados.push(semantico);
          }
        }
      }

      const helv = await doc.embedFont(StandardFonts.Helvetica);
      form.updateFieldAppearances(helv);

      // ACHATA o formulário: "queima" os valores como conteúdo fixo da página.
      // Sem isso, visualizadores simples (WhatsApp/celular) mostram os campos
      // em branco. Depois de achatar, o texto aparece em qualquer leitor e o
      // documento não pode mais ser editado nos campos.
      try { form.flatten(); } catch (e) { console.error('flatten falhou (segue):', e.message); }

      const out = await doc.save();
      const outB64 = Buffer.from(out).toString("base64");

      return res.json({
        ok: true,
        pdf_base64: outB64,
        preenchidos: preenchidos.length,
        ignorados,
      });
    } catch (e) {
      console.error("erro /preencher-pdf:", e);
      return res.status(500).json({ ok: false, erro: String((e && e.message) || e) });
    }
  });
};
