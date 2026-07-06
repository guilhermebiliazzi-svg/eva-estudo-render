/**
 * EVA · Serviço de render do Estudo de Mercado (HTTP).
 * A EVA (n8n) faz POST /estudo com o input do imóvel e recebe o .pptx de volta.
 *
 * Env:
 *   PORT          (default 3000)
 *   ASSETS_DIR    (default ./assets — ativos fixos da marca)
 *   DATABASE_URL  (Supabase Postgres; necessário p/ buscar vendidos pela buildingKey
 *                  e p/ persistir amostras aprovadas por phone)
 *   ANTHROPIC_API_KEY  (necessário p/ a rota /parecer)
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
const { runBackfillBatch } = require("./backfill_geo");
const { gerarParecer } = require("./parecer");
const { renderParecerHTML } = require("./parecer_render");
const { gerarCCV } = require("./ccv");

const PORT = process.env.PORT || 3000;
const ASSETS = process.env.ASSETS_DIR || path.join(__dirname, "assets");
let pool = null;
if (process.env.DATABASE_URL) {
  const { Pool } = require("pg");
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

const app = express();
app.use(express.json({ limit: "50mb" }));
require("./preencher_pdf")(app);

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
// Recebe os FATOS montados pelo n8n, chama o Claude, valida e devolve o JSON do parecer.
app.post("/parecer", async (req, res) => {
  try {
    const saida = await gerarParecer(req.body || {});
    saida._html = renderParecerHTML(saida, req.body || {});
    res.json(saida);
  } catch (e) {
    console.error("erro /parecer:", e);
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});

// === Compromisso de Compra e Venda (CCV) ===
// Recebe os FATOS montados pelo n8n, chama o Claude (Opus), valida a aritmética
// e devolve o JSON com o documento pronto em `documento_md`.
app.post("/ccv", async (req, res) => {
  try {
    const saida = await gerarCCV(req.body || {});
    res.json(saida);
  } catch (e) {
    console.error("erro /ccv:", e);
    res.status(500).json({ error: String((e && e.message) || e) });
  }
});
// ===================================================================
// TEMP — Smoke test do motor de CCV com DADOS REAIS da diligência Grumixamas.
// Vendedor: Marcos (divorciado/comunhão parcial, ressalva de partilha).
// Comprador: Adecarlos (solteiro, sem cônjuge).
// Pagamento: sinal 20k + recursos próprios 100k + FGTS 54k + financiamento 106k = 280k.
// Pendências: as 5 reais do certidoes_status.
// Campos não informados ficam como [a completar] (NÃO inventar).
// Cole no server.js no lugar da rota /ccv-teste anterior. Remover após o teste.
// ===================================================================
app.get("/ccv-teste", async (req, res) => {
  const fatos = {
    imovel: {
      endereco: "Rua das Grumixamas, nº 530, apartamento nº 1304, Vila Parque Jabaquara, São Paulo/SP",
      cep: "[a completar]",
      matricula: "226.651",
      ri_numero: "8º",
      cns: "[a completar]",
      contribuinte: "[a completar]",
      descricao_registral: "[a completar] (transcrever a descrição completa da matrícula nº 226.651 do 8º RI/SP)"
    },
    preco: 280000,
    vendedor: {
      nome: "Marcos Docampo Ferrari",
      nacionalidade: "brasileiro",
      profissao: "[a completar]",
      rg: "[a completar]",
      rg_orgao: "[a completar]",
      cpf: "279.074.448-37",
      email: "[a completar]",
      endereco: "[a completar]",
      estado_civil: "divorciado",
      regime_bens: "comunhao_parcial",
      data_casamento: "06/09/2003",
      obs: "Divorciado por escritura de divórcio consensual com partilha lavrada em 28/04/2025 perante o 4º Tabelião de Notas de São Bernardo do Campo. A titularidade integral depende de o imóvel ter cabido ao vendedor na partilha (verificar)."
    },
    comprador: {
      nome: "Adecarlos Evangelista dos Santos Junior",
      nacionalidade: "brasileiro",
      profissao: "Analista de Qualidade",
      rg: "37.184.064-8",
      rg_orgao: "[a completar]",
      cpf: "396.623.268-55",
      email: "adecarlos.evangelista@gmail.com",
      endereco: "Rua Duarte de Brito, nº 129, Vila Capela, São Paulo/SP, CEP [a completar]",
      estado_civil: "solteiro"
    },
    pagamento: {
      tem_sinal: true,
      parcelas: [
        { tipo: "sinal", rotulo: "sinal e princípio de pagamento", valor: 20000, momento: "neste ato, na assinatura deste compromisso, por transferência bancária" },
        { tipo: "recursos_proprios", rotulo: "recursos próprios da parte compradora", valor: 100000, momento: "na data da assinatura do instrumento definitivo" },
        { tipo: "fgts", rotulo: "recursos do FGTS da parte compradora", valor: 54000, momento: "mediante liberação pela Caixa Econômica Federal" },
        { tipo: "financiamento", rotulo: "financiamento bancário com garantia de alienação fiduciária", valor: 106000, momento: "mediante liberação pelo agente financeiro" }
      ],
      conta_vendedora: { banco: "[a completar]", agencia: "[a completar]", conta: "[a completar]" }
    },
    comissao: {
      total: null,
      percentual: null,
      condicao_pagamento: "[a completar]",
      split: []
    },
    certidoes_pendentes: [
      "Ata de assembleia / instrumento de nomeação do síndico",
      "Certidão simplificada da JUCESP (vendedor)",
      "Certidão negativa de débitos condominiais (declaração do condomínio)",
      "Comprovante de residência do vendedor",
      "Dados cadastrais do imóvel (Prefeitura de São Paulo)"
    ],
    prazo_pendentes: null,
    prazos: { lavratura_dias: null },
    data: "[a completar]",
    testemunhas: []
  };

  try {
    const saida = await gerarCCV(fatos);
    const L = [];
    L.push("===== VALIDACAO (aritmetica refeita em codigo) =====");
    L.push(JSON.stringify(saida._validacao, null, 2));
    L.push("\n===== NUMEROS =====");
    L.push(JSON.stringify(saida.numeros, null, 2));
    L.push("\n===== FLAGS =====");
    L.push("tem_financiamento=" + saida.tem_financiamento +
           " | tem_sinal=" + saida.tem_sinal +
           " | outorga_conjugal_exigida=" + saida.outorga_conjugal_exigida);
    L.push("\n===== PENDENCIAS DE PREENCHIMENTO =====");
    L.push(JSON.stringify(saida.pendencias_preenchimento, null, 2));
    L.push("\n===== ALERTAS =====");
    L.push(JSON.stringify(saida.alertas, null, 2));
    L.push("\n\n===== DOCUMENTO (markdown) =====\n");
    L.push(saida.documento_md || "(documento_md vazio)");
    res.type("text/plain; charset=utf-8").send(L.join("\n"));
  } catch (e) {
    res.status(500).type("text/plain; charset=utf-8").send("ERRO /ccv-teste: " + String((e && e.message) || e));
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
    const code = e.code || null;
    // 422 quando não há ITBI -> o n8n distingue de erro real e responde honesto ao corretor
    res.status(code === "NO_ITBI_DATA" ? 422 : 500).json({ error: String(e && e.message || e), code });
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
