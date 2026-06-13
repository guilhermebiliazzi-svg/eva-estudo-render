// ============================================================
// preencher_pdf.js — endpoint /preencher-pdf
// Recebe um PDF de formulário (multipart, campo "pdf") + payload JSON
// (campo "payload") e devolve o PDF preenchido.
//
// COMO INSTALAR NO RENDER (eva-estudo-render):
// 1) Criar este arquivo na raiz do repositório (mesmo nível do server.js)
// 2) No package.json, adicionar em "dependencies":
//      "pdf-lib": "^1.17.1",
//      "multer": "^1.4.5-lts.1"
// 3) No server.js, depois da criação do `app` (const app = express()),
//    adicionar UMA linha:
//      require('./preencher_pdf')(app);
// 4) Commit nos 3 arquivos → o Render faz o deploy sozinho.
//
// Payload esperado (campo "payload", string JSON):
// {
//   "campos":     { "contratante1_nome": "João Silva", ... },   // do corretor
//   "mapeamento": {                                              // da tabela base_conhecimento
//     "campos":   { "contratante1_nome": "07GggA", ... },        // semântico -> nome do campo no PDF
//     "padroes":  { "imobiliaria_cnpj": "...", ... }             // valores fixos da imobiliária
//   }
// }
// Prioridade de preenchimento: campos (corretor) > padroes.
// Valores vazios ou contendo "<<" (placeholder não configurado) são ignorados.
// ============================================================

const multer = require('multer');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

module.exports = function (app) {
  app.post('/preencher-pdf', upload.single('pdf'), async (req, res) => {
    try {
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ erro: 'PDF não recebido (campo multipart "pdf").' });
      }

      let payload = {};
      try {
        payload = JSON.parse(req.body.payload || '{}');
      } catch (e) {
        return res.status(400).json({ erro: 'Campo "payload" não é um JSON válido.' });
      }

      const mapeamento = (payload.mapeamento && payload.mapeamento.campos) || {};
      const padroes = (payload.mapeamento && payload.mapeamento.padroes) || {};
      const campos = payload.campos || {};

      // padroes primeiro, campos do corretor por cima
      const valores = { ...padroes, ...campos };

      const doc = await PDFDocument.load(req.file.buffer);
      const form = doc.getForm();

      const preenchidos = [];
      const ignorados = [];

      for (const [semantico, valor] of Object.entries(valores)) {
        const v = valor == null ? '' : String(valor).trim();
        if (!v || v.includes('<<')) continue; // vazio ou placeholder não configurado

        const nomeCampoPdf = mapeamento[semantico];
        if (!nomeCampoPdf) {
          ignorados.push(semantico); // campo informado que não existe neste modelo
          continue;
        }
        try {
          form.getTextField(nomeCampoPdf).setText(v);
          preenchidos.push(semantico);
        } catch (e) {
          // não é campo de texto — tenta caixa de seleção (checkbox)
          try {
            const cb = form.getCheckBox(nomeCampoPdf);
            const marcar = ['sim', 's', 'x', 'true', '1', 'yes', 'marcar', 'ok'].includes(v.toLowerCase());
            if (marcar) cb.check(); else cb.uncheck();
            preenchidos.push(semantico);
          } catch (e2) {
            ignorados.push(semantico);
          }
        }
      }

      // Atualiza a aparência dos campos para o valor ficar visível em
      // qualquer visualizador (WhatsApp, celular, navegador)
      const helv = await doc.embedFont(StandardFonts.Helvetica);
      form.updateFieldAppearances(helv);

      const bytes = await doc.save();

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="contrato_preenchido.pdf"',
        'X-Campos-Preenchidos': String(preenchidos.length),
        'X-Campos-Ignorados': ignorados.join(',').slice(0, 900),
      });
      return res.send(Buffer.from(bytes));
    } catch (e) {
      console.error('[preencher-pdf] erro:', e.message);
      return res.status(500).json({ erro: 'Falha ao preencher o PDF: ' + e.message });
    }
  });
};
