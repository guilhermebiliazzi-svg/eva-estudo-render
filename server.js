/**
 * EVA · Serviço de render do Estudo de Mercado (HTTP).
 * A EVA (n8n) faz POST /estudo com o input do imóvel e recebe o .pptx de volta.
 *
 * Env:
 *   PORT          (default 3000)
 *   ASSETS_DIR    (default ./assets — ativos fixos da marca)
 *   DATABASE_URL  (Supabase Postgres; necessário p/ buscar vendidos pela buildingKey
 *                  e p/ persistir amostras aprovadas por phone)
 *
 * Endpoints:
 *   POST /amostra   body = { url, subject }                          → 1 amostra
 *   POST /amostras  body = { avaliando, urls, subject, phone? }      → N amostras + msg aprovação
 *                   se phone vier, persiste em amostras_sessao
 *   POST /estudo    body = { buildingKey, imovel, corretor, amostras, estudo_data, ref, phone? }
 *                   se amostras vazio e phone presente, recupera de amostras_sessao
 *   POST /estudo    body = { vendidosRows, imovel, corretor, amostras, ... }  // sem DB
 *   POST /estudo-casa body = { rua, numero, raio?, tipo, area_terreno, area_construida?, testada?,
 *                              uso_atual?, bairro?, corretor, ref, estudo_data? }  // casa de rua/terreno
 *                   ou { ponto, raioMetros?, ... } (raio geográfico) | { comps, ... } (sem DB)
 */
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { gerarEstudo, gerarEstudoFromDB } = require("./orchestrator");
const { gerarEstudoCasa, gerarEstudoCasaFromDB } = require("./orchestrator_casa");

const PORT = process.env.PORT || 3000;
const ASSETS = process.env.ASSETS_DIR || path.join(__dirname, "assets");
let pool = null;
if (process.env.DATABASE_URL) {
  const { Pool } = require("pg");
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

const app = express();
app.use(express.json({ limit: "8mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

// extrai 1 anúncio (Jina /json) -> objeto amostra
app.post("/amostra", async (req, res) => {
  try {
    const { extractAmostra } = require("./amostra_extract");
    const { url, subject } = req.body || {};
    res.json(await extractAmostra(url, subject || {}));
  } catch (e) { res.status(500).json({ error: String(e && e.message || e) }); }
});

// extrai vários links + monta a mensagem de aprovação pro WhatsApp + persiste por phone
app.post("/amostras", async (req, res) => {
  try {
    const { montarAmostras, montarAprovacao } = require("./amostra_extract");
    const { saveAmostras } = require("./amostras_store");
    const { avaliando, urls, subject, phone } = req.body || {};
    // urls pode vir como string JSON (n8n $fromAI 'string'), string com URLs separadas por nova-linha/vírgula,
    // ou array. Normaliza tudo pra array antes de processar.
    let urlList = urls;
    if (typeof urls === "string") {
      const t = urls.trim();
      if (t.startsWith("[")) {
        try { urlList = JSON.parse(t); }
        catch { urlList = t.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean); }
      } else {
        urlList = t.split(/[\n,;]+/).map(s => s.trim()).filter(s => /^https?:\/\//.test(s));
      }
    }
    if (!Array.isArray(urlList)) urlList = [];
    const amostras = await montarAmostras(avaliando, urlList, subject || {});
    // persistência: agente costuma "esquecer" de repassar amostras no Gerar_Estudo_Mercado.
    // se o caller passar phone, salvamos por sessão; /estudo recupera quando amostras vier vazio.
    if (phone && pool) {
      try { await saveAmostras(pool, phone, amostras); }
      catch (e) { console.error("saveAmostras falhou (segue):", e.message); }
    }
    res.json({ amostras, aprovacao: montarAprovacao(amostras) });
  } catch (e) { res.status(500).json({ error: String(e && e.message || e) }); }
});

app.post("/estudo", async (req, res) => {
  const body = req.body || {};
  const out = path.join(os.tmpdir(), `estudo_${Date.now()}.pptx`);
  try {
    // recuperação de amostras: se vier vazio e tiver phone, busca persistência
    const amostrasVazias = !body.amostras
      || (Array.isArray(body.amostras) && body.amostras.length === 0);
    if (amostrasVazias && body.phone && pool) {
      const { getAmostras } = require("./amostras_store");
      const persistidas = await getAmostras(pool, body.phone);
      if (persistidas.length) {
        body.amostras = persistidas;
        console.log(`/estudo: recuperadas ${persistidas.length} amostras da sessão ${body.phone}`);
      }
    }
    if (body.buildingKey) {
      if (!pool) throw new Error("DATABASE_URL não configurada para buscar vendidos pela buildingKey");
      await gerarEstudoFromDB({ pool, ...body, assets: ASSETS, out });
    } else {
      await gerarEstudo({ ...body, assets: ASSETS, out });
    }
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    res.setHeader("Content-Disposition", 'attachment; filename="Estudo_Mercado.pptx"');
    fs.createReadStream(out).pipe(res).on("close", () => fs.unlink(out, () => {}));
  } catch (e) {
    console.error("erro /estudo:", e);
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

// estudo de CASA DE RUA / TERRENO (Método 2 — comparáveis por R$/m² de terreno)
app.post("/estudo-casa", async (req, res) => {
  const body = req.body || {};
  const out = path.join(os.tmpdir(), `estudo_casa_${Date.now()}.pptx`);
  try {
    if (Array.isArray(body.comps) && body.comps.length) {
      await gerarEstudoCasa({ comps: body.comps, body, assets: ASSETS, out }); // comps no body (sem DB)
    } else {
      if (!pool) throw new Error("DATABASE_URL não configurada para buscar comps de casa");
      await gerarEstudoCasaFromDB({ pool, ...body, assets: ASSETS, out });     // busca comps por rua+número (ou ponto/raio)
    }
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    res.setHeader("Content-Disposition", 'attachment; filename="Estudo_Casa.pptx"');
    fs.createReadStream(out).pipe(res).on("close", () => fs.unlink(out, () => {}));
  } catch (e) {
    console.error("erro /estudo-casa:", e);
    const code = e.code || null;
    // 422 na trava de comps insuficientes -> o n8n distingue de erro real e responde honesto ao corretor
    res.status(code === "COMPS_INSUFICIENTES" ? 422 : 500).json({ error: String(e && e.message || e), code });
  }
});

app.listen(PORT, () => console.log(`EVA estudo render service on :${PORT}`));
