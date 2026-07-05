/**
 * EVA · Motor do parecer de diligência (tijolo C).
 * Recebe os FATOS (montados pelo n8n em /webhook/gerar-parecer), chama o Claude,
 * faz o passe de validação e devolve a saída estruturada do parecer.
 *
 * Variáveis de ambiente (configurar no Render):
 *   ANTHROPIC_API_KEY  (obrigatória) — chave da API da Anthropic
 *   PARECER_MODEL      (opcional)    — default "claude-opus-4-8"
 *   PROMPT_PARECER     (opcional)    — caminho do prompt; default ./prompt_parecer.md
 */
const fs = require("fs");
const path = require("path");

const MODEL = process.env.PARECER_MODEL || "claude-opus-4-8";
const PROMPT_PATH = process.env.PROMPT_PARECER || path.join(__dirname, "prompt_parecer.md");

function lerPrompt() {
  try { return fs.readFileSync(PROMPT_PATH, "utf8"); }
  catch (e) { throw new Error("prompt do parecer não encontrado em " + PROMPT_PATH); }
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

  // Documentos PDF anexados — o modelo lê o conteúdo direto (blocos "document").
  // PDFs individuais acima de ~6 MB em base64 (ex.: atas escaneadas) são pulados
  // para não estourar os limites da API; ficam listados como não anexados.
  const todos = Array.isArray(fatos.documentos_pdf) ? fatos.documentos_pdf.filter(d => d && d.base64) : [];
  const ehPdf = (d) => String(d.base64).slice(0, 6) === "JVBERi"; // "%PDF" em base64
  const docs = todos.filter(d => ehPdf(d) && d.base64.length <= 6 * 1024 * 1024);
  const pulados = todos.filter(d => ehPdf(d) && d.base64.length > 6 * 1024 * 1024);
  // Arquivos que não são PDF de verdade (ex.: certidões TRT2 emitidas como HTML):
  // extrai o texto e injeta na mensagem para o modelo ler mesmo assim.
  const naoPdf = todos.filter(d => !ehPdf(d));
  const textosExtraidos = naoPdf.map(d => {
    let t = "";
    try {
      t = Buffer.from(d.base64, "base64").toString("utf8")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 20000);
    } catch (e) { t = "(conteúdo ilegível)"; }
    return "### " + (d.label || "documento") + "\n" + t;
  });
  const fatosTexto = Object.assign({}, fatos);
  delete fatosTexto.documentos_pdf;

  const listaDocs = docs.length
    ? "\n\nDOCUMENTOS ANEXADOS (leia o conteúdo destes PDFs): " +
      docs.map(d => d.label || "documento").join("; ") + "."
    : "";
  const listaPulados = pulados.length
    ? "\n\nDOCUMENTOS NÃO ANEXADOS POR TAMANHO (considere-os presentes no dossiê, sem ler o conteúdo): " +
      pulados.map(d => d.label || "documento").join("; ") + "."
    : "";

  const listaTextos = textosExtraidos.length
    ? "\n\nDOCUMENTOS RECEBIDOS EM FORMATO TEXTO/HTML (conteúdo extraído abaixo):\n\n" +
      textosExtraidos.join("\n\n")
    : "";

  const userMsg =
    "FATOS da diligência (JSON):\n" + JSON.stringify(fatosTexto, null, 2) +
    listaDocs + listaPulados + listaTextos +
    "\n\nGere o parecer e responda APENAS com o objeto JSON conforme o schema. " +
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

/**
 * Passe de validação: a aritmética da solvência é REFEITA em código (não confiamos
 * na conta do modelo) e conferimos que apontamentos e condicionantes citam fonte.
 * Divergências viram alertas — não reprovam, mas chamam atenção na revisão.
 */
function validar(saida) {
  const alertas = [];
  const s = saida && saida.solvencia;

  if (s && s.forma === "dirpf" &&
      typeof s.bens_declarados === "number" && typeof s.dividas_declaradas === "number") {
    const pl = round2(s.bens_declarados - s.dividas_declaradas);
    if (typeof s.patrimonio_liquido === "number" && Math.abs(pl - s.patrimonio_liquido) > 0.5)
      alertas.push("Patrimônio líquido recalculado (" + pl + ") difere do informado (" + s.patrimonio_liquido + ").");
    const solventeCalc = pl > 0;
    if (typeof s.solvente === "boolean" && s.solvente !== solventeCalc)
      alertas.push("Solvência (DIRPF) recalculada como " + solventeCalc + "; o modelo disse " + s.solvente + ".");
  }

  if (s && s.forma === "imoveis_livres") {
    const soma = round2((s.imoveis_livres || [])
      .filter(i => i && i.livre_de_gravame !== false)
      .reduce((a, i) => a + (Number(i.valor_mercado) || 0), 0));
    const passivo = round2(s.passivo_total);
    const solventeCalc = soma > passivo;
    if (typeof s.solvente === "boolean" && s.solvente !== solventeCalc)
      alertas.push("Solvência (imóveis livres) recalculada: soma " + soma + " vs passivo " + passivo +
                   " => " + solventeCalc + "; o modelo disse " + s.solvente + ".");
  }

  const checaFonte = (arr, nome) => {
    if (Array.isArray(arr)) arr.forEach((x, i) => {
      if (!x || !(x.fonte || x.fonte_certidao || x.referencia))
        alertas.push(nome + "[" + i + "] sem fonte citada.");
    });
  };
  checaFonte(saida && saida.apontamentos, "apontamento");
  checaFonte(saida && saida.condicionantes, "condicionante");

  return { ok: alertas.length === 0, alertas };
}

/**
 * Coerência §5→§6 (DETERMINÍSTICA, em código — não confiamos no humor do modelo):
 * toda pendência apontada (apontamento com situação pendente) e todo item do
 * inventário não concluído viram condicionante. Se já houver condicionante que
 * cobre o item, não duplica. Resultado: §6 NUNCA fica vazio havendo pendência.
 */
const _PEND = /(pendente|n[aã]o\s+verificad|aguardando|sem\s+resultado|n[aã]o\s+emitid|em\s+aberto|n[aã]o\s+obtid|n[aã]o\s+lid|n[aã]o\s+conclu|erro\s+na\s+consulta)/i;

function _textoDe(x) {
  if (!x) return "";
  if (typeof x === "string") return x;
  return [x.item, x.apontamento, x.descricao, x.situacao, x.situacao_certidao,
          x.label, x.titulo, x.texto, x.tipo, x.titular].filter(Boolean).join(" ");
}

function garantirCondicionantes(saida, fatos) {
  if (!saida || typeof saida !== "object") return;
  if (!Array.isArray(saida.condicionantes)) saida.condicionantes = [];

  const chaves = (txt) => (String(txt).toLowerCase().match(/[a-zà-ú]{4,}/gi) || []);
  const jaCobre = (txt) => {
    const ch = chaves(txt);
    if (!ch.length) return false;
    return saida.condicionantes.some(c => {
      const ct = _textoDe(c).toLowerCase();
      return ch.filter(k => ct.includes(k)).length >= Math.min(2, ch.length);
    });
  };
  const add = (desc, fonte) => {
    if (!desc) return;
    saida.condicionantes.push({
      item: desc,
      prazo: "antes do título definitivo",
      fonte: fonte || "coerência automática: pendência sem condicionante"
    });
  };

  // (a) apontamentos com situação pendente
  (Array.isArray(saida.apontamentos) ? saida.apontamentos : []).forEach(ap => {
    const t = _textoDe(ap);
    if (_PEND.test(t) && !jaCobre(t)) {
      const nome = (ap && (ap.item || ap.apontamento || ap.descricao)) || t;
      add("Concluir/obter: " + nome, ap && (ap.fonte || ap.fonte_certidao || ap.referencia));
    }
  });

  // (b) itens do inventário de certidões — por status (whitelist explícita).
  // SÓ os status abaixo geram condicionante. concluido, cancelada e qualquer
  // status não listado NÃO geram nada — evita falso-positivo silencioso.
  const STATUS_OBTER = new Set([
    "pendente", "aguardando_email", "aguardando_match",
    "em_processamento", "erro_infosimples"
  ]);
  const STATUS_SANEAR = new Set(["com_pendencias"]);

  const inv = (fatos && Array.isArray(fatos.inventario_certidoes)) ? fatos.inventario_certidoes : [];
  inv.forEach(it => {
    const st = String((it && it.status) || "").toLowerCase();
    const nome = (it && (it.item || it.tipo)) || "certidão";
    const tit = it && it.titular ? (" — " + it.titular) : "";
    const chaveDedup = nome + " " + ((it && it.titular) || "");

    if (STATUS_OBTER.has(st)) {
      if (!jaCobre(chaveDedup))
        add("Concluir/obter " + nome + tit, "inventário (status: " + (it.status || "pendente") + ")");
    } else if (STATUS_SANEAR.has(st)) {
      if (!jaCobre(chaveDedup))
        add("Verificar e sanear a pendência apontada em " + nome + tit,
            "inventário (status: " + (it.status || "com_pendencias") + ")");
    }
    // concluido, cancelada e status desconhecido: não gera condicionante.
  });
}

async function gerarParecer(fatos) {
  if (!fatos || typeof fatos !== "object") throw new Error("FATOS ausentes ou inválidos");
  const saida = await chamarClaude(fatos);
  garantirCondicionantes(saida, fatos);   // <-- trava determinística: §6 espelha as pendências
  saida._validacao = validar(saida);
  return saida;
}

module.exports = { gerarParecer };
