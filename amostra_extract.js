/**
 * EVA · passo F — amostras (anúncios ativos).
 * Lê o link do anúncio via r.jina.ai (que renderiza SPAs e devolve markdown
 * limpo), extrai os campos com regex e monta o objeto `amostra` do contrato.
 * Classifica como "mesmo_predio" quando bate com o prédio do avaliando.
 *
 * HISTÓRICO: a versão anterior usava Cloudflare Browser Rendering (/json)
 * com Workers AI, que retornava HTTP 422 em SPAs pesadas como o QuintoAndar
 * mesmo com schema simplificado. r.jina.ai já é o que o Ler_Link_Imovel
 * usa e comprovadamente lê QuintoAndar/Zap/Viva sem problema.
 *
 *   const { extractAmostra, montarAmostras, montarAprovacao } = require("./amostra_extract");
 *   const cand = await montarAmostras(avaliando, urls, subject);
 *   // -> manda `montarAprovacao(cand)` no WhatsApp; após aprovar, vira data.amostras
 *
 * ENV: JINA_API_KEY (token Bearer pra r.jina.ai — mesmo do Ler_Link_Imovel).
 */

const JINA_BASE = "https://r.jina.ai/";

// --- fetch markdown via Jina (SPA-ready) ---
async function fetchJinaMarkdown(url) {
  const apiKey = process.env.JINA_API_KEY;
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const resp = await fetch(JINA_BASE + url, { headers });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Jina ${resp.status}: ${body.slice(0, 200)}`);
  }
  return await resp.text();
}

// --- helpers numéricos / texto ---
const parseN = v => {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[^\d,.\-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
};

const norm = s => (s || "").toString().toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

function fmtMi(v) { let s = (v / 1e6).toFixed(2); if (s.endsWith("0")) s = s.slice(0, -1); return "R$ " + s.replace(".", ",") + " mi"; }
const fmtNum = n => Math.round(n).toLocaleString("pt-BR");

function refFromUrl(u) {
  try { const p = new URL(u); return (p.pathname.split("/").filter(Boolean).pop() || p.hostname).toUpperCase().slice(0, 20); }
  catch { return "ANÚNCIO"; }
}

// --- EXTRAÇÃO POR REGEX DO MARKDOWN DA JINA ---
// QuintoAndar/Zap/Viva via Jina vêm com texto como:
//   "Valor: R$720.000\n56 m²\n1 quarto, 1 suíte\n2 vagas\nCondomínio: R$2.530\nIPTU: R$393/mês"
// Estratégia:
//   - preço de venda = MAIOR R$ na página (afasta condomínio/IPTU que são menores)
//   - área útil = primeira ocorrência de "<n> m²"
//   - suítes/vagas = "<n> suíte/vaga"
//   - endereço = padrão "Rua/Av./Alameda <nome>, <num>"
function extractFromMarkdown(md) {
  const ext = {};

  // 1) PREÇO — o maior R$ vence (preço > condomínio > IPTU)
  const monies = [...md.matchAll(/R\$\s*([\d][\d.,]*)/g)]
    .map(m => parseN(m[1]))
    .filter(n => n > 1000); // descarta valores muito pequenos (provavelmente não é preço)
  if (monies.length) ext.preco_total = String(Math.max(...monies));

  // 2) ÁREA ÚTIL — primeira ocorrência de "<n> m²" (² não é word char, então sem \b)
  const areaMatch = md.match(/(\d{2,4}(?:[.,]\d+)?)\s*m[²2]/i);
  if (areaMatch) ext.area_util_m2 = areaMatch[1].replace(",", ".");

  // 3) SUÍTES
  const suitesMatch = md.match(/(\d+)\s*su[íi]te/i);
  if (suitesMatch) ext.suites = suitesMatch[1];

  // 4) VAGAS
  const vagasMatch = md.match(/(\d+)\s*vaga/i);
  if (vagasMatch) ext.vagas = vagasMatch[1];

  // 5) ENDEREÇO — tenta primeiro com número (mais útil pra mesmo_predio); senão, sem número.
  let endMatch = md.match(/\b(Rua|Av(?:enida)?\.?|Alameda|Al\.|Travessa|Pra[çc]a)\s+([^\n,]{3,60}?),\s*(\d{1,5})\b/i);
  if (endMatch) {
    ext.endereco = `${endMatch[1]} ${endMatch[2].trim()}, ${endMatch[3]}`;
  } else {
    endMatch = md.match(/\b(Rua|Av(?:enida)?\.?|Alameda|Al\.|Travessa|Pra[çc]a)\s+([^\n,]{3,60})/i);
    if (endMatch) ext.endereco = `${endMatch[1]} ${endMatch[2].trim()}`;
  }

  // 6) CONDOMÍNIO/EDIFÍCIO — tenta padrões "Edifício/Cond. <Nome>" (mais raro no QuintoAndar)
  const condMatch = md.match(/(?:Edif[íi]cio|Cond[oô]m[íi]nio)\s+([A-Z][\w\s.'-]{2,40})/);
  if (condMatch && !condMatch[1].match(/^R\$/i)) ext.condominio = condMatch[1].trim();

  // 7) BAIRRO — extrai de "<Bairro>, São Paulo" ou padrão similar
  const bairroMatch = md.match(/([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇa-záéíóúâêôãõç]+){0,2}),\s*S[ãa]o\s*Paulo/);
  if (bairroMatch) ext.bairro = bairroMatch[1].trim();

  return ext;
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

// PURA: converte extração em objeto `amostra` do contrato (testável sem rede)
function mapExtraction(ext, url, subject = {}) {
  const preco  = parseN(ext.preco_total);
  const area   = parseN(ext.area_util_m2);
  const suites = parseN(ext.suites);
  const vagas  = parseN(ext.vagas);
  const tipo = classify(ext, subject);
  const ref = refFromUrl(url);
  return {
    tipo, ref,
    nome: tipo === "mesmo_predio"
      ? `Mesmo prédio (${ref})`
      : (ext.condominio || `${ext.bairro || "Imóvel"} ${area ? Math.round(area) + "m²" : ""}`.trim()),
    bairro: ext.bairro || subject.bairro || "",
    area: area ? `${Math.round(area)} m²` : "",
    suites: suites ? String(suites) : "",
    vagas:  vagas  ? String(vagas)  : "",
    pedido: preco ? fmtMi(preco) : "sob consulta",
    valor: preco,
    valor_m2: (preco && area) ? fmtNum(preco / area) : "—",
    link: url,
    _raw: ext,
  };
}

async function extractAmostra(url, subject = {}, _legacy = {}) {
  const md = await fetchJinaMarkdown(url);
  const ext = extractFromMarkdown(md);
  return mapExtraction(ext, url, subject);
}

// extrai vários links e devolve [avaliando, ...candidatos]
async function montarAmostras(avaliando, urls = [], subject = {}, _legacy = {}) {
  const out = [];
  if (avaliando && typeof avaliando === "object") {
    out.push({ ...avaliando, tipo: avaliando.tipo || "avaliando" });
  }
  const list = Array.isArray(urls) ? urls : [];
  for (const u of list) {
    if (!u) continue;
    try { out.push(await extractAmostra(u, subject)); }
    catch (e) { out.push({ tipo: "comparavel", nome: "(falha ao ler anúncio)", link: u, _erro: String(e.message || e) }); }
  }
  return out;
}

// mensagem de aprovação pro WhatsApp (o "gate" antes de entrar no estudo)
function montarAprovacao(amostras = []) {
  const cand = (Array.isArray(amostras) ? amostras : [])
    .filter(a => a && a.tipo !== "avaliando");
  let txt = "Encontrei estas amostras para o estudo. Confirme, remova ou me mande outros links:\n";
  cand.forEach((a, i) => {
    txt += `\n${i + 1}. ${a.nome} — ${a.area || "?"}, ${a.suites || "?"} suítes, ${a.vagas || "?"} vagas — ${a.pedido}\n${a.link}\n`;
  });
  txt += "\nResponda *ok* para aprovar todas, *remover N* para tirar uma, ou cole novos links.";
  return txt;
}

module.exports = { extractAmostra, montarAmostras, montarAprovacao, mapExtraction, extractFromMarkdown, fetchJinaMarkdown };
