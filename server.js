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
const { gerarCCV } = require("./ccv");

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

// === Parecer de diligência (tijolo C) ===
// Recebe os FATOS montados pelo n8n, chama o Claude, valida e devolve o JSON do parecer.
app.post("/parecer", async (req, res) => {
  try {
    const saida = await gerarParecer(req.body || {});
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
// TEMP — Smoke test do motor de CCV (cenário: financiamento + FGTS + sinal)
// Cole este bloco no server.js LOGO DEPOIS da rota app.post("/ccv", ...).
// Abra https://eva-estudo-render.onrender.com/ccv-teste no navegador.
// Pode REMOVER depois do teste. Não grava nem envia nada — só gera e mostra.
// ===================================================================
app.get("/ccv-teste", async (req, res) => {
  const fatos = {
    imovel: {
      endereco: "Rua das Grumixamas, nº 530, apartamento nº 1304, Torre B, bairro Jabaquara, São Paulo/SP",
      cep: "04321-000",
      matricula: "226.651",
      ri_numero: "8º",
      cns: "[a completar]",
      contribuinte: "[a completar]",
      descricao_registral: "Apartamento nº 1304, no 13º pavimento da Torre B do Condomínio Aplauso Jabaquara, área privativa de 64,000 m², área comum de 41,000 m² (incluída 1 vaga de garagem indeterminada), área total de 105,000 m², fração ideal de 0,8234% no terreno e demais partes comuns, situado na Rua das Grumixamas nº 530, 28º Subdistrito - Jabaquara."
    },
    preco: 850000,
    vendedor: {
      nome: "Marcos Docampo Ferrari", nacionalidade: "brasileiro", profissao: "engenheiro",
      rg: "[a completar]", rg_orgao: "[a completar]", cpf: "279.074.448-37",
      email: "[a completar]", endereco: "[a completar]",
      estado_civil: "divorciado", regime_bens: "comunhao_parcial", data_casamento: "06/09/2003",
      obs: "Divorciado por escritura de divórcio consensual com partilha lavrada em 28/04/2025 perante o 4º Tabelião de São Bernardo do Campo."
    },
    comprador: {
      nome: "Ana Carolina Souza Lima", nacionalidade: "brasileira", profissao: "médica",
      rg: "32.456.789-0", rg_orgao: "SSP/SP", cpf: "345.678.912-00",
      email: "ana.lima@exemplo.com",
      endereco: "Rua Joaquim Floriano, nº 100, apto 52, Itaim Bibi, São Paulo/SP, CEP 04534-010",
      estado_civil: "casada", regime_bens: "comunhao_parcial", data_casamento: "12/05/2018",
      conjuge: { nome: "Rafael Augusto Pereira", nacionalidade: "brasileiro", profissao: "advogado", rg: "28.123.456-7", rg_orgao: "SSP/SP", cpf: "298.765.432-11" }
    },
    pagamento: {
      tem_sinal: true,
      parcelas: [
        { tipo: "sinal", rotulo: "sinal e princípio de pagamento", valor: 50000, momento: "neste ato, por transferência bancária" },
        { tipo: "fgts", rotulo: "recursos do FGTS da parte compradora", valor: 80000, momento: "mediante liberação pela Caixa Econômica Federal" },
        { tipo: "financiamento", rotulo: "financiamento bancário com garantia de alienação fiduciária", valor: 720000, momento: "mediante liberação pelo agente financeiro" }
      ],
      conta_vendedora: { banco: "Banco Itaú Unibanco (341)", agencia: "1234", conta: "56789-0" }
    },
    comissao: {
      total: 51000, percentual: 6,
      condicao_pagamento: "devida e exigível na assinatura deste instrumento, mediante cobrança bancária única emitida pela intermediadora",
      split: [
        { credor: "Ville Jardins Negócios Imobiliários Ltda (RE/MAX Ville)", documento: "41.132.782/0001-08", creci: "CRECI J 37.196", valor: 30600 },
        { credor: "João Pedro Almeida", documento: "123.456.789-00", creci: "CRECI-SP 123.456-F", valor: 20400 }
      ]
    },
    certidoes_pendentes: [
      "Certidão de distribuição de ações e execuções cíveis estaduais (1º grau) - em obtenção",
      "Certidão negativa de protesto - 2º ao 5º Tabelionatos da Capital - em obtenção"
    ],
    prazo_pendentes: 15,
    prazos: { lavratura_dias: 60, apresentacao_certidoes_dias: 15 },
    data: "São Paulo, 21 de junho de 2026.",
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
