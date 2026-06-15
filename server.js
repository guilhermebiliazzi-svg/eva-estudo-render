/**
 * EVA · Serviço de render do Estudo de Mercado (HTTP).
 * A EVA (n8n) faz POST /estudo com o input do imóvel e recebe o .pptx de volta.
 *
 * Env:
 *   PORT          (default 3000)
 *   ASSETS_DIR    (default ./assets — ativos fixos da marca)
 *   DATABASE_URL  (Supabase Postgres; necessário p/ buscar vendidos pela buildingKey
 *                  e p/ persistir amostras aprovadas por phone)
 *   ANTHROPIC_API_KEY  (necessário p/ /parecer)
 *   PARECER_TOKEN      (recomendado p/ /parecer — segredo compartilhado com o n8n)
 *   SELF_URL           (opcional; default https://eva-estudo-render.onrender.com — base do link do parecer)
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
const crypto = require("crypto");
const { gerarEstudo, gerarEstudoFromDB } = require("./orchestrator");
const { gerarEstudoCasa, gerarEstudoCasaFromDB } = require("./orchestrator_casa");
const { runBackfillBatch } = require("./backfill_geo");
const { gerarParecer } = require("./parecer");
const { auditarCertidao } = require("./auditor_cnd");

const PORT = process.env.PORT || 3000;
const ASSETS = process.env.ASSETS_DIR || path.join(__dirname, "assets");
// URL pública deste serviço (usada para montar o link do parecer servido pelo Render)
const SELF_URL = (process.env.SELF_URL || "https://eva-estudo-render.onrender.com").replace(/\/+$/, "");
let pool = null;
if (process.env.DATABASE_URL) {
  const { Pool } = require("pg");
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

// --- Link de download e-SAJ montado pelo PRÓPRIO Render (independe do n8n) ---
// Espelha o nó "Montar URL eSAJ" do WF-15: numero_pedido + pedido_data + CPF/CNPJ.
function _maskCpf(d){const s=String(d).replace(/\D/g,"").padStart(11,"0");return s.slice(0,3)+"."+s.slice(3,6)+"."+s.slice(6,9)+"-"+s.slice(9,11);}
function _maskCnpj(d){const s=String(d).replace(/\D/g,"").padStart(14,"0");return s.slice(0,2)+"."+s.slice(2,5)+"."+s.slice(5,8)+"/"+s.slice(8,12)+"-"+s.slice(12,14);}
function _brDate(v){
  if (!v) return "";
  // Data pura YYYY-MM-DD (sem hora): usa direto, sem conversão de fuso.
  const pure = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (pure) return pure[3] + "/" + pure[2] + "/" + pure[1];
  // timestamptz vem em UTC; o TJSP registra a data em horário LOCAL de SP.
  // Sem converter o fuso, pedidos feitos à noite em SP (madrugada UTC) caem no dia seguinte.
  const norm = String(v).replace(" ", "T").replace(/(\.\d{3})\d+/, "$1").replace(/([+-]\d\d)$/, "$1:00");
  const d = (v instanceof Date) ? v : new Date(norm);
  if (isNaN(d.getTime())) {
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[3] + "/" + m[2] + "/" + m[1] : "";
  }
  const p = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(d);
  const g = t => (p.find(x => x.type === t) || {}).value || "";
  const dd = g("day"), mm = g("month"), yy = g("year");
  return (dd && mm && yy) ? dd + "/" + mm + "/" + yy : "";
}
function _esajUrl(numero_pedido, pedido_data, documento){
  const np = numero_pedido ? String(numero_pedido).trim() : "";
  const pd = _brDate(pedido_data);
  const dig = String(documento || "").replace(/\D/g, "");
  if (!np || !pd || !(dig.length === 11 || dig.length === 14)) return null;
  const parts = ["entity.nuPedido=" + encodeURIComponent(np), "entity.dtPedido=" + encodeURIComponent(pd)];
  if (dig.length === 11) { parts.push("entity.tpPessoa=F"); parts.push("entity.nuCpf=" + encodeURIComponent(_maskCpf(dig))); }
  else { parts.push("entity.tpPessoa=J"); parts.push("entity.nuCnpj=" + encodeURIComponent(_maskCnpj(dig))); }
  return "https://esaj.tjsp.jus.br/sco/realizarDownload.do?" + parts.join("&");
}
const _ESAJ_TIPOS = ["tjsp_civeis","tjsp_falencia","tjsp_inventarios","tjsp_criminais","tjsp_exec_crim"];

// Preenche url_download das distribuições e-SAJ ainda em aguardando_email, lendo o
// protocolo direto do banco. Escopa pela diligência quando o fatos traz diligencia_id.
// Casa cada item do inventário por (documento + rótulo) e, na falta de documento, por
// (titular + rótulo). Nunca lança: em erro, deixa o inventário como veio.
async function injetarLinksEsaj(pool, fatos){
  if (!pool || !fatos || !Array.isArray(fatos.inventario_certidoes) || !fatos.inventario_certidoes.length) return;
  const params = [_ESAJ_TIPOS];
  let sql = "SELECT sheet_label, documento, titular, numero_pedido, pedido_data " +
            "FROM certidoes_status WHERE tipo = ANY($1) AND status = 'aguardando_email' " +
            "AND numero_pedido IS NOT NULL AND numero_pedido <> '' AND pedido_data IS NOT NULL";
  if (fatos.diligencia_id) { sql += " AND diligencia_id = $2"; params.push(fatos.diligencia_id); }
  sql += " ORDER BY atualizado_em DESC";
  const { rows } = await pool.query(sql, params);
  const normDoc = d => String(d || "").replace(/\D/g, "");
  const normTit = t => String(t || "").trim().toUpperCase().replace(/\s+/g, " ");
  const byDoc = new Map();   // documento||rótulo -> url (mais recente vence)
  const byTit = new Map();   // titular||rótulo  -> url (mais recente vence)
  for (const r of rows) {
    const url = _esajUrl(r.numero_pedido, r.pedido_data, r.documento);
    if (!url) continue;
    const kd = normDoc(r.documento) + "||" + (r.sheet_label || "");
    const kt = normTit(r.titular) + "||" + (r.sheet_label || "");
    if (normDoc(r.documento) && !byDoc.has(kd)) byDoc.set(kd, url);
    if (normTit(r.titular) && !byTit.has(kt)) byTit.set(kt, url);
  }
  for (const it of fatos.inventario_certidoes) {
    if (it.url) continue;                            // já tem PDF no Drive: não mexe
    const rotulo = it.item || it.sheet_label || "";
    let url = byDoc.get(normDoc(it.documento) + "||" + rotulo);
    if (!url) url = byTit.get(normTit(it.titular) + "||" + rotulo);
    if (url) it.url_download = url;                  // SOBRESCREVE: Render tem a palavra final (data em fuso SP)
  }
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

// === Parecer de diligência (tijolo C) ===
// O HTML do parecer é SERVIDO pelo próprio Render (Content-Type fixado no Express),
// porque o bucket público do Supabase serve arquivos com content-type travado e não
// renderiza HTML. A fonte do HTML é a coluna `saida._html` da tabela `pareceres`.
app.get("/parecer-view/:id", async (req, res) => {
  try {
    if (!pool) return res.status(500).type("text/plain").send("DB indisponível");
    const { rows } = await pool.query(
      "SELECT saida, status, aprovado_em FROM pareceres WHERE id = ($1)::uuid LIMIT 1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).type("text/plain").send("Parecer não encontrado");
    let saida = rows[0].saida;
    if (typeof saida === "string") { try { saida = JSON.parse(saida); } catch (_) {} }
    let html = saida && saida._html;
    if (!html) return res.status(404).type("text/plain").send("HTML do parecer indisponível");

    // Aprovado/liberado: remove a tarja RASCUNHO e o painel de revisão (interno),
    // e carimba "PARECER LIBERADO" com a data. Funciona para qualquer parecer.
    if (rows[0].status === "aprovado") {
      let dataLib = "";
      const ae = rows[0].aprovado_em;
      if (ae) {
        const d = new Date(ae);
        if (!isNaN(d.getTime())) {
          dataLib = String(d.getDate()).padStart(2, "0") + "/" +
                    String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
        }
      }
      const stamp = '<div class="draft" style="background:#e8f5e9;border-color:#43a047;color:#1b5e20">' +
        '<span class="dot" style="background:#43a047"></span><b>PARECER LIBERADO</b>&nbsp;— versão final aprovada' +
        (dataLib ? (" em " + dataLib) : "") + ".</div>";
      html = html
        .replace(/<div class="draft">[\s\S]*?<\/div>/, stamp)
        .replace(/<div class="review">[\s\S]*?<\/ul><\/div>/, "");
    }

    res.set("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (e) {
    return res.status(500).type("text/plain").send("erro: " + String((e && e.message) || e));
  }
});

// Recebe os FATOS montados pelo n8n, chama o Claude, valida e devolve
// { ...saida, parecer_id, pdf_url }. O HTML é guardado em saida._html (persistido no DB
// pelo n8n) e servido por GET /parecer-view/:id. pdf_url já aponta para essa rota.
app.post("/parecer", async (req, res) => {
  // segredo compartilhado com o n8n (só exige se PARECER_TOKEN estiver configurada)
  const token = process.env.PARECER_TOKEN;
  if (token && req.headers["x-parecer-token"] !== token) {
    return res.status(401).json({ error: "nao autorizado" });
  }
  try {
    const fatos = req.body || {};
    // Render monta o link e-SAJ das distribuições pendentes (não depende do n8n).
    if (pool) { try { await injetarLinksEsaj(pool, fatos); } catch (e) { console.error("injetarLinksEsaj:", e && e.message); } }
    const saida = await gerarParecer(fatos);
    const parecer_id = crypto.randomUUID();
    const pdf_url = `${SELF_URL}/parecer-view/${parecer_id}`;
    res.json({ ...saida, parecer_id, pdf_url });
  } catch (e) {
    console.error("erro /parecer:", e);
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

// Fallback de leitura de CND via Claude. O WF-07 chama isto quando o Gemini falha.
// Body: { pdfBase64 | fileBase64, tipo, titular, documento, candidatas?, nome? }
// Devolve o mesmo formato de JSON da auditoria do WF-07 (drop-in).
app.post("/auditar-certidao", async (req, res) => {
  const token = process.env.PARECER_TOKEN;
  if (token && req.headers["x-parecer-token"] !== token) {
    return res.status(401).json({ error: "nao autorizado" });
  }
  try {
    const b = req.body || {};
    const fileBase64 = b.pdfBase64 || b.fileBase64 || b.base64 || null;
    if (!fileBase64) return res.status(400).json({ error: "pdfBase64/fileBase64 ausente" });
    const out = await auditarCertidao({
      fileBase64,
      tipo: b.tipo || null,
      titular: b.titular || null,
      documento: b.documento || null,
      candidatas: Array.isArray(b.candidatas) ? b.candidatas : null,
      nome: b.nome || null,
    });
    res.json(out);
  } catch (e) {
    console.error("erro /auditar-certidao:", e && e.message);
    res.status(500).json({ error: String((e && e.message) || e) });
  }
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

// backfill de coordenada (geom) via GeoSampa — uso único/administrativo, em lote.
// Chame repetido (POST {"limit":50}) até "restantes" = 0. Resumível.
app.post("/backfill-geo", async (req, res) => {
  if (!pool) return res.status(500).json({ error: "DATABASE_URL ausente" });
  try {
    const limit = Number((req.body && req.body.limit) || 50);
    res.json(await runBackfillBatch(pool, { limit }));
  } catch (e) {
    console.error("erro /backfill-geo:", e);
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

app.listen(PORT, () => console.log(`EVA estudo render service on :${PORT}`));
