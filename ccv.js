/**
 * EVA · Motor do Compromisso de Compra e Venda (CCV).
 * Espelha o parecer.js: recebe os FATOS (montados pelo n8n em /webhook/gerar-ccv),
 * chama o Claude (Opus) com o prompt do CCV, faz o passe de validação aritmética
 * e devolve a saída estruturada — com o documento pronto em `documento_md`.
 *
 * Variáveis de ambiente (configurar no Render):
 *   ANTHROPIC_API_KEY  (obrigatória) — chave da API da Anthropic
 *   CCV_MODEL          (opcional)    — default "claude-opus-4-8"
 *   PROMPT_CCV         (opcional)    — caminho do prompt; default ./prompt_ccv.md
 */
const fs = require("fs");
const path = require("path");

const MODEL = process.env.CCV_MODEL || "claude-opus-4-8";
const PROMPT_PATH = process.env.PROMPT_CCV || path.join(__dirname, "prompt_ccv.md");

function lerPrompt() {
  try { return fs.readFileSync(PROMPT_PATH, "utf8"); }
  catch (e) { throw new Error("prompt do CCV não encontrado em " + PROMPT_PATH); }
}

// O modelo deve devolver só JSON; mesmo assim, blindamos a extração.
function extrairJSON(texto) {
  if (!texto) throw new Error("resposta vazia do modelo");
  let t = String(texto).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const i = t.indexOf("{"), j = t.lastIndexOf("}");
  if (i === -1 || j === -1) throw new Error("não encontrei JSON na resposta do modelo");
  return JSON.parse(t.slice(i, j + 1));
}

async function chamarClaude(fatos) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY não configurada no Render");

  const system = lerPrompt();

  // Documentos PDF anexados (ex.: matrícula) — o modelo lê o conteúdo direto,
  // igual ao parecer.js. Não despejamos o base64 no texto dos FATOS.
  const docs = Array.isArray(fatos.documentos_pdf) ? fatos.documentos_pdf.filter(d => d && d.base64) : [];
  const fatosTexto = Object.assign({}, fatos);
  delete fatosTexto.documentos_pdf;

  const listaDocs = docs.length
    ? "\n\nDOCUMENTOS ANEXADOS (leia o conteúdo destes PDFs e use-os como fonte). " +
      "Se houver matrícula entre eles, transcreva dela a descrição registral completa do imóvel no Item 1 " +
      "(unidade, andar, bloco, edifício, subdistrito, áreas e fração ideal) e, se constarem, o CNS do RI, " +
      "o número de contribuinte e o CEP — substituindo os respectivos [a completar]. Documentos: " +
      docs.map(d => d.label || "documento").join("; ") + "."
    : "";

  const userMsg =
    "FATOS da transação (JSON):\n" + JSON.stringify(fatosTexto, null, 2) +
    listaDocs +
    "\n\nRedija o CCV completo e responda APENAS com o objeto JSON conforme o schema do §7. " +
    "Sem texto fora do JSON e sem cercas de código.";

  const content = [];
  for (const d of docs) {
    content.push({
      type: "document",
      source: { type: "base64", media_type: d.media_type || "application/pdf", data: d.base64 },
      title: d.label || "documento",
      citations: { enabled: false },
    });
  }
  content.push({ type: "text", text: userMsg });

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content }],
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error("Anthropic HTTP " + resp.status + ": " + txt.slice(0, 600));
  }
  const data = await resp.json();
  const texto = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  return extrairJSON(texto);
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function soma(arr, campo) {
  return round2((Array.isArray(arr) ? arr : []).reduce((a, x) => a + (Number(x && x[campo]) || 0), 0));
}

/**
 * Passe de validação: a aritmética do CCV é REFEITA em código (não confiamos
 * na conta do modelo). Confere que a soma das parcelas = preço e que a soma do
 * split = comissão total. Também sinaliza [a completar] remanescentes no corpo.
 * Divergências viram alertas — não reprovam, mas chamam atenção na revisão.
 */
function validar(saida) {
  const alertas = [];
  const n = saida && saida.numeros;

  if (n && typeof n.preco === "number") {
    const somaParcelas = soma(n.parcelas, "valor");
    if (Math.abs(somaParcelas - n.preco) > 0.5)
      alertas.push("Soma das parcelas (" + somaParcelas + ") difere do preço informado (" + n.preco + ").");
  }

  if (n && typeof n.comissao_total === "number") {
    const somaSplit = soma(n.split, "valor");
    if (Math.abs(somaSplit - n.comissao_total) > 0.5)
      alertas.push("Soma do split (" + somaSplit + ") difere da comissão total (" + n.comissao_total + ").");

    if (typeof n.comissao_percentual === "number" && typeof n.preco === "number") {
      const calc = round2(n.preco * n.comissao_percentual / 100);
      if (Math.abs(calc - n.comissao_total) > 0.5)
        alertas.push("Comissão recalculada (" + calc + " = " + n.comissao_percentual +
                     "% de " + n.preco + ") difere da informada (" + n.comissao_total + ").");
    }
  }

  // [a completar] remanescentes no corpo: cada um deveria estar listado em pendencias.
  const corpo = String((saida && saida.documento_md) || "");
  const marcadores = (corpo.match(/\[a completar\]/gi) || []).length;
  const pend = Array.isArray(saida && saida.pendencias_preenchimento)
    ? saida.pendencias_preenchimento.length : 0;
  if (marcadores > 0 && pend === 0)
    alertas.push("Há " + marcadores + " marcador(es) [a completar] no corpo sem item correspondente em pendencias_preenchimento.");

  return { ok: alertas.length === 0, alertas };
}

async function gerarCCV(fatos) {
  if (!fatos || typeof fatos !== "object") throw new Error("FATOS ausentes ou inválidos");
  const saida = await chamarClaude(fatos);
  saida._validacao = validar(saida);
  return saida;
}

module.exports = { gerarCCV };
