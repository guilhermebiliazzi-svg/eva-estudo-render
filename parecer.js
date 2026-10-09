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

// O texto `txt` cobre o item `nome` (do titular `titular`)? Exige as palavras
// distintivas do NOME do item — o nome do titular sozinho não basta (antes,
// "JAIRO LESSA CREPALDI" casava qualquer condicionante do Jairo).
const _GENERICAS = new Set(["certidao","certidão","estadual","distribuicoes","distribuições","civeis","cíveis","negativa","debitos","débitos","tributos","concluir","obter","antes","titulo","título","definitivo","pesquisa","consulta","nacional","abrangencia","abrangência","judicial","eletronica","eletrônica","acoes","ações","processos","comprovante"]);
function cobreItem(txt, nome, titular) {
  const t = String(txt || "").toLowerCase();
  const ks = (String(nome || "").toLowerCase().match(/[a-zà-ú0-9]{3,}/gi) || []).filter(k => !_GENERICAS.has(k));
  const alvo = ks.length ? ks : (String(nome || "").toLowerCase().match(/[a-zà-ú0-9]{3,}/gi) || []);
  if (!alvo.length) return false;
  const hit = alvo.filter(k => t.includes(k)).length;
  if (hit < Math.max(1, Math.ceil(alvo.length / 2))) return false;
  if (titular && !/^(rua|r\.|av|avenida|alameda|al\.|travessa|pra[cç]a|estrada|rodovia)\b/i.test(String(titular).trim())) {
    const tl = String(titular).toLowerCase();
    const p1 = tl.split(/\s+/)[0];
    const ehPJ = /\b(ltda|s\/?a|eireli|me|epp|cia)\b/i.test(tl);
    if (p1 && !t.includes(p1) && !(ehPJ && /empresa/.test(t))) return false;
  }
  return true;
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
  if (!Array.isArray(saida.pendencias)) saida.pendencias = [];
  const add = (desc, fonte, nomeItem, titularItem) => {
    if (!desc) return;
    const f = fonte || "coerência automática: pendência sem condicionante";
    saida.condicionantes.push({
      titulo: tituloCurto(desc),
      descricao: desc + " antes do título definitivo.",
      item: desc,
      prazo: "antes do título definitivo",
      fonte: f
    });
    // a mesma lista alimenta a cláusula 5.3 do CCV (fonte única — §4 do prompt)
    const itemPend = desc.replace(/^Concluir\/obter:?\s*/i, "");
    if (!saida.pendencias.some(p => cobreItem(_textoDe(p), nomeItem || itemPend, titularItem))) saida.pendencias.push({ item: itemPend, fonte: f, classe: "diferivel" });
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
    "em_processamento", "erro_infosimples", "baixando_esaj"
  ]);
  const STATUS_SANEAR = new Set(["com_pendencias"]);

  const inv = (fatos && Array.isArray(fatos.inventario_certidoes)) ? fatos.inventario_certidoes : [];
  inv.forEach(it => {
    const st = String((it && it.status) || "").toLowerCase();
    const nome = (it && (it.item || it.tipo)) || "certidão";
    const tit = it && it.titular ? (" — " + it.titular) : "";
    const chaveDedup = nome + " " + ((it && it.titular) || "");

    if (STATUS_OBTER.has(st)) {
      if (!saida.condicionantes.some(c => cobreItem(_textoDe(c) + " " + ((c && c.descricao) || ""), nome, it && it.titular)))
        add("Concluir/obter " + nome + tit, "inventário (status: " + (it.status || "pendente") + ")", nome, it && it.titular);
    } else if (STATUS_SANEAR.has(st)) {
      if (!saida.condicionantes.some(c => cobreItem(_textoDe(c) + " " + ((c && c.descricao) || ""), nome, it && it.titular)))
        add("Verificar e sanear a pendência apontada em " + nome + tit,
            "inventário (status: " + (it.status || "com_pendencias") + ")", nome, it && it.titular);
    }
    // concluido, cancelada e status desconhecido: não gera condicionante.
  });
}

// Título curto para o cabeçalho da condicionante (o renderizador mostra `titulo`).
function tituloCurto(txt) {
  const s = String(txt || "").replace(/\s+/g, " ").trim()
    .replace(/\s+antes do título definitivo\.?$/i, "");
  const curto = s.split(/[—(:;,.]/)[0].trim();
  const base = curto.length >= 8 ? curto : s;
  return base.length > 80 ? base.slice(0, 77).trim() + "…" : base;
}

function _dataBR(s) {
  const m = String(s || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null;
}

/**
 * Pós-processamento determinístico (não depende do humor do modelo):
 *  - condicionante sem `titulo` ganha um (o HTML mostra o título em destaque);
 *  - matrícula de consulta / antiga / indeterminada => exige certidão atualizada;
 *  - empresa relacionada (papel empresa_relacionada) nunca vira "aptidão p/ alienar";
 *  - Seção 1 (Imóvel e operação) é completada com os FATOS se o modelo omitir.
 */
function posProcessar(saida, fatos) {
  if (!saida || typeof saida !== "object") return;
  saida.condicionantes = (Array.isArray(saida.condicionantes) ? saida.condicionantes : []).map(c => {
    if (typeof c === "string") return { titulo: tituloCurto(c), descricao: c, fonte: "modelo" };
    if (c && !c.titulo) c.titulo = tituloCurto(c.item || c.descricao || c.texto || "");
    if (c && !c.descricao) c.descricao = c.item || c.texto || c.titulo;
    return c;
  });
  if (!Array.isArray(saida.alertas)) saida.alertas = [];
  if (!Array.isArray(saida.pendencias)) saida.pendencias = [];

  // (1) matrícula: só certidão recente dispensa a condicionante
  const sr = saida.situacao_registral || {};
  const md = sr.matricula_documento || {};
  const tipo = String(md.tipo || "indeterminado").toLowerCase();
  const emissao = _dataBR(md.data_emissao);
  const velha = emissao ? (Date.now() - emissao.getTime()) / 86400000 > 30 : false;
  if (tipo !== "certidao" || velha) {
    const motivo = tipo === "consulta" ? "a matrícula anexada é cópia para simples consulta (não vale como certidão)"
      : (velha ? "a matrícula anexada foi emitida há mais de 30 dias" : "não foi possível confirmar que a matrícula anexada é certidão");
    const desc = "Obter certidão de matrícula atualizada (com valor de certidão, emitida há no máximo 30 dias) — " + motivo;
    const cobre = saida.condicionantes.some(c => /certid[aã]o de matr[ií]cula|matr[ií]cula atualizada/i.test(_textoDe(c) + " " + (c.descricao || "")));
    if (!cobre) {
      saida.condicionantes.unshift({ titulo: "Certidão de matrícula atualizada", descricao: desc + ", antes do título definitivo.", prazo: "antes do título definitivo", fonte: "situacao_registral.matricula_documento" });
    }
    if (!saida.pendencias.some(p => /matr[ií]cula/i.test(_textoDe(p)))) {
      saida.pendencias.unshift({ item: "Certidão de matrícula atualizada (com valor de certidão)", fonte: "situacao_registral.matricula_documento", classe: "diferivel" });
    }
    if (!saida.alertas.some(a => /matr[ií]cula/i.test(String(a && a.descricao)) && /consulta|certid/i.test(String(a && a.descricao)))) {
      saida.alertas.push({ campo: "situacao_registral.matricula_documento", descricao: "Análise registral feita sobre documento que não é certidão atualizada: " + motivo + ".", severidade: "media" });
    }
  }

  // (1b) cadeia dominial montada dos atos (o modelo às vezes junta "R.3/R.4")
  if (Array.isArray(sr.atos) && sr.atos.length) {
    const regs = sr.atos.filter(a => a && /^R\.?\s*\d/i.test(String(a.ato || "")));
    if (regs.length) {
      sr.cadeia_dominial = regs.map(a => {
        const partes = [a.transmitentes, a.adquirentes].filter(Boolean).join(" → ");
        return String(a.ato).trim() + (a.data ? " (" + a.data + ")" : "") + " — " + (a.natureza || "ato") +
          (partes ? ": " + partes : "") + (a.fracao ? " [" + a.fracao + "]" : "");
      }).join("; ") + ".";
    }
  }
  // (1c) aquisição gratuita: a conclusão sobre fraude contra credores do doador vai para a análise
  const ag = sr.aquisicao_gratuita;
  if (ag && ag.titulo) {
    const reg = _dataBR(ag.data_registro);
    const anos = reg ? (Date.now() - reg.getTime()) / (365.25 * 86400000) : null;
    let frase = "Aquisição a título gratuito (" + ag.titulo + (ag.ato ? ", " + ag.ato : "") + (ag.data_registro ? ", registrada em " + ag.data_registro : "") + "): ";
    if (anos !== null && anos >= 4) frase += "já decorrido o prazo decadencial de 4 anos (art. 178, II, do Código Civil), está superado o risco de anulação por fraude contra credores do doador.";
    else if (anos !== null) frase += "ainda corre o prazo decadencial de 4 anos (art. 178, II, do Código Civil) para eventual anulação por fraude contra credores do doador — recomendam-se certidões dos doadores.";
    else frase += "data do registro não identificada; verificar o prazo de 4 anos (art. 178, II, do Código Civil) para fraude contra credores do doador.";
    if (ag.observacao) frase += " " + ag.observacao;
    if (!String(sr.analise || "").includes("178")) sr.analise = (sr.analise ? sr.analise + " " : "") + frase;
    if (anos !== null && anos < 4 && !saida.alertas.some(a => /doa[cç][aã]o|doador/i.test(String(a && a.descricao)))) {
      saida.alertas.push({ campo: "situacao_registral.aquisicao_gratuita", descricao: frase, severidade: "media" });
    }
  }
  // (1d) certidão de estado civil com mais de 90 dias (ou sem data) => atualizar para a escritura
  (Array.isArray(saida.legitimacao_vendedores) ? saida.legitimacao_vendedores : []).forEach(l => {
    if (!l || !l.nome) return;
    if (/solteir/i.test(String(l.estado_civil || "")) && !l.data_certidao_estado_civil) return; // nascimento: segue a regra geral abaixo só se houver data
    const dc = _dataBR(l.data_certidao_estado_civil);
    const velha = !dc || (Date.now() - dc.getTime()) / 86400000 > 90;
    if (!velha) return;
    const nome = String(l.nome).trim();
    const ja = saida.condicionantes.some(c => /estado civil|casamento|nascimento/i.test((c.titulo || "") + " " + (c.descricao || "")) && String((c.titulo || "") + " " + (c.descricao || "")).toUpperCase().includes(nome.split(/\s+/)[0].toUpperCase()));
    if (ja) return;
    const motivo = dc ? "a certidão apresentada é de " + l.data_certidao_estado_civil : "a certidão apresentada não tem data identificada";
    saida.condicionantes.push({ titulo: "Certidão de estado civil atualizada — " + nome.split(/\s+/)[0], descricao: "Apresentar certidão de " + (/solteir/i.test(String(l.estado_civil || "")) ? "nascimento" : "casamento") + " atualizada (emitida há no máximo 90 dias) de " + nome + " para a escritura — " + motivo + ".", prazo: "antes do título definitivo", fonte: "legitimacao_vendedores" });
    saida.pendencias.push({ item: "Certidão de estado civil atualizada (até 90 dias) — " + nome, fonte: "legitimacao_vendedores", classe: "diferivel" });
  });

  // (2) empresa relacionada: fora de alertas/pendências/condicionantes de legitimação
  const relac = (Array.isArray(fatos && fatos.partes) ? fatos.partes : [])
    .filter(p => p && p.papel === "empresa_relacionada" && p.nome)
    .map(p => String(p.nome).toUpperCase());
  if (relac.length) {
    const indevido = /(aptid|sucess[aã]o|papel d[ae]|papel na|alienant|alienar|titular(idade)? registral|consta como|como vendedor|titular\/vendedor|esclarecer o papel)/i;
    const ehIndevido = x => {
      if (!x) return false;
      const t = [_textoDe(x), x.descricao, x.campo, x.fonte].filter(Boolean).join(" ");
      return relac.some(n => t.toUpperCase().includes(n)) && indevido.test(t);
    };
    saida.condicionantes = saida.condicionantes.filter(c => !ehIndevido(c));
    saida.pendencias = saida.pendencias.filter(p => !ehIndevido(p));
    saida.alertas = saida.alertas.filter(a => !ehIndevido(a));
  }

  // (3) Seção 1 sempre presente
  const im = fatos && fatos.imovel || {};
  const nomes = arr => (Array.isArray(arr) ? arr : []).map(p => p && p.nome).filter(Boolean).join("; ");
  saida.imovel = Object.assign({
    descricao: im.descricao || null,
    matricula: im.matricula || null,
    ri: im.ri || null,
    vendedor: nomes(fatos && fatos.vendedores) || null,
    comprador: (fatos && fatos.comprador) || nomes(fatos && fatos.compradores) || null,
    preco: (fatos && fatos.negocio && fatos.negocio.preco) ? ("R$ " + Number(fatos.negocio.preco).toLocaleString("pt-BR", { minimumFractionDigits: 2 })) : null,
    forma_pagamento: (fatos && fatos.negocio && fatos.negocio.forma_pagamento) || null
  }, Object.fromEntries(Object.entries(saida.imovel || {}).filter(([, v]) => v)));
}

async function gerarParecer(fatos) {
  if (!fatos || typeof fatos !== "object") throw new Error("FATOS ausentes ou inválidos");
  const saida = await chamarClaude(fatos);
  garantirCondicionantes(saida, fatos);   // <-- trava determinística: §6 espelha as pendências
  posProcessar(saida, fatos);             // <-- matrícula, empresa relacionada, títulos, Seção 1
  saida._validacao = validar(saida);
  return saida;
}

module.exports = { gerarParecer };
