/**
 * EVA · passo F — amostras (anúncios ativos).
 * Dado o link de um anúncio, o Cloudflare Browser Rendering (/json) abre a página
 * (mesmo SPA), extrai os campos e a gente monta o objeto `amostra` do contrato.
 * Classifica como "mesmo_predio" quando bate com o prédio do avaliando.
 *
 *   const { extractAmostra, montarAmostras, montarAprovacao } = require("./amostra_extract");
 *   const cand = await montarAmostras(avaliando, urls, subject, { accountId, apiToken });
 *   // -> manda `montarAprovacao(cand)` no WhatsApp; após aprovar, vira data.amostras
 */
const { cfJson } = require("./cloudflare");

const SCHEMA = {
  type: "object",
  properties: {
    preco_total: { type: "number" },   // R$ (apenas número)
    area_util_m2: { type: "number" },
    dormitorios: { type: "number" },
    suites: { type: "number" },
    vagas: { type: "number" },
    bairro: { type: "string" },
    condominio: { type: "string" },
    endereco: { type: "string" },
  },
  required: ["preco_total", "area_util_m2"],
};
const PROMPT =
  "Extraia os dados deste anúncio de apartamento à venda: preço total de venda em reais " +
  "(somente número, sem R$ nem pontos), área útil/privativa em m², número de dormitórios, " +
  "suítes e vagas de garagem, bairro, nome do condomínio/edifício e endereço (rua e número). " +
  "Se algum campo não existir no anúncio, omita-o.";

const norm = s => (s || "").toString().toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

function fmtMi(v) { let s = (v / 1e6).toFixed(2); if (s.endsWith("0")) s = s.slice(0, -1); return "R$ " + s.replace(".", ",") + " mi"; }
const fmtNum = n => Math.round(n).toLocaleString("pt-BR");

function refFromUrl(u) {
  try { const p = new URL(u); return (p.pathname.split("/").filter(Boolean).pop() || p.hostname).toUpperCase().slice(0, 20); }
  catch { return "ANÚNCIO"; }
}

// mesmo prédio? bate condomínio/endereço extraído com o do avaliando
function classify(ext, subject = {}) {
  const hay = norm(`${ext.condominio || ""} ${ext.endereco || ""}`);
  const predio = norm(subject.predio_curto || "");
  const rua = norm(subject.logradouro || subject.endereco || "");
  const num = String(subject.numero || "");
  if (predio && hay.includes(predio)) return "mesmo_predio";
  if (rua && hay.includes(rua) && (!num || hay.includes(num))) return "mesmo_predio";
  return "comparavel";
}

// PURA: converte a extração do CF num objeto `amostra` do contrato (testável sem rede)
function mapExtraction(ext, url, subject = {}) {
  const preco = Number(ext.preco_total) || 0;
  const area = Number(ext.area_util_m2) || 0;
  const tipo = classify(ext, subject);
  const ref = refFromUrl(url);
  return {
    tipo, ref,
    nome: tipo === "mesmo_predio"
      ? `Mesmo prédio (${ref})`
      : (ext.condominio || `${ext.bairro || "Imóvel"} ${area ? Math.round(area) + "m²" : ""}`.trim()),
    bairro: ext.bairro || "",
    area: area ? `${Math.round(area)} m²` : "",
    suites: ext.suites != null ? String(ext.suites) : "",
    vagas: ext.vagas != null ? String(ext.vagas) : "",
    pedido: preco ? fmtMi(preco) : "sob consulta",
    valor: preco,
    valor_m2: (preco && area) ? fmtNum(preco / area) : "—",
    link: url,
    _raw: ext,
  };
}

async function extractAmostra(url, subject = {}, cf = {}) {
  const ext = await cfJson(url, { schema: SCHEMA, prompt: PROMPT, ...cf });
  return mapExtraction(ext, url, subject);
}

// extrai vários links e devolve [avaliando, ...candidatos] (pronto p/ a aprovação)
async function montarAmostras(avaliando, urls = [], subject = {}, cf = {}) {
  const out = [avaliando];
  for (const u of urls) {
    try { out.push(await extractAmostra(u, subject, cf)); }
    catch (e) { out.push({ tipo: "comparavel", nome: "(falha ao ler anúncio)", link: u, _erro: String(e.message || e) }); }
  }
  return out;
}

// mensagem de aprovação pro WhatsApp (o "gate" antes de entrar no estudo)
function montarAprovacao(amostras = []) {
  const cand = amostras.filter(a => a.tipo !== "avaliando");
  let txt = "Encontrei estas amostras para o estudo. Confirme, remova ou me mande outros links:\n";
  cand.forEach((a, i) => {
    txt += `\n${i + 1}. ${a.nome} — ${a.area || "?"}, ${a.suites || "?"} suítes, ${a.vagas || "?"} vagas — ${a.pedido}` +
           (a.tipo === "mesmo_predio" ? "  ⟵ mesmo prédio" : "") + `\n${a.link}`;
  });
  txt += "\n\nResponda *ok* para aprovar todas, *remover N* para tirar uma, ou cole novos links.";
  return txt;
}

module.exports = { extractAmostra, montarAmostras, montarAprovacao, mapExtraction, SCHEMA, PROMPT };
