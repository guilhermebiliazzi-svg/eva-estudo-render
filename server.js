/**
 * EVA · Serviço de render do Estudo de Mercado (HTTP).
 * A EVA (n8n) faz POST /estudo com o input do imóvel e recebe o .pptx de volta.
 *
 * Env:
 *   PORT          (default 3000)
 *   ASSETS_DIR    (default ./assets — ativos fixos da marca)
 *   DATABASE_URL  (Supabase Postgres; necessário p/ buscar vendidos pela buildingKey)
 *
 * Exemplos:
 *   POST /estudo   body = { buildingKey, imovel, corretor, amostras, estudo_data, ref }
 *   POST /estudo   body = { vendidosRows, imovel, corretor, amostras, ... }  // sem DB
 */
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { gerarEstudo, gerarEstudoFromDB } = require("./orchestrator");

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

// extrai 1 anúncio (Cloudflare /json) -> objeto amostra
app.post("/amostra", async (req, res) => {
  try {
    const { extractAmostra } = require("./amostra_extract");
    const { url, subject } = req.body || {};
    res.json(await extractAmostra(url, subject || {}));
  } catch (e) { res.status(500).json({ error: String(e && e.message || e) }); }
});

// extrai vários links + monta a mensagem de aprovação pro WhatsApp
app.post("/amostras", async (req, res) => {
  try {
    const { montarAmostras, montarAprovacao } = require("./amostra_extract");
    const { avaliando, urls, subject } = req.body || {};
    const amostras = await montarAmostras(avaliando, urls || [], subject || {});
    res.json({ amostras, aprovacao: montarAprovacao(amostras) });
  } catch (e) { res.status(500).json({ error: String(e && e.message || e) }); }
});

app.post("/estudo", async (req, res) => {
  const body = req.body || {};
  const out = path.join(os.tmpdir(), `estudo_${Date.now()}.pptx`);
  try {
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

app.listen(PORT, () => console.log(`EVA estudo render service on :${PORT}`));
