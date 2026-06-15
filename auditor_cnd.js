/**
 * EVA · Leitor de certidão (CND) via Claude — fallback da auditoria automática.
 *
 * O WF-07 audita o PDF com Gemini 2.5 Pro. Quando o Gemini falha (HTTP != 200,
 * bloqueio, ou JSON inválido), o WF-07 chama POST /auditar-certidao neste serviço,
 * que manda o arquivo pro Claude (PDF como bloco `document`, ou HTML como texto)
 * e devolve EXATAMENTE o mesmo formato de JSON que o nó do Gemini devolveria —
 * para ser um drop-in, sem quebrar o restante do fluxo.
 *
 * Env (Render):
 *   ANTHROPIC_API_KEY  (obrigatória)
 *   AUDITOR_MODEL      (opcional) — default "claude-sonnet-4-6"
 */

const MODEL = process.env.AUDITOR_MODEL || "claude-sonnet-4-6";

// Detecta se o base64 é PDF ou HTML (mesma heurística do WF-07).
function detectarTipo(b64) {
  try {
    const head = Buffer.from(String(b64).slice(0, 400), "base64").toString("utf8", 0, 200);
    if (head.startsWith("%PDF-")) return "pdf";
    if (/<\s*(!DOCTYPE|html|head|body|base|meta|title|script|style|div|table|h[1-6]|p\s)/i.test(head)) return "html";
    return "desconhecido";
  } catch (e) { return "desconhecido"; }
}

function extrairTextoHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}

function extrairJSON(texto) {
  if (!texto) throw new Error("resposta vazia do modelo");
  let t = String(texto).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const i = t.indexOf("{"), j = t.lastIndexOf("}");
  if (i === -1 || j === -1) throw new Error("não encontrei JSON na resposta do modelo");
  return JSON.parse(t.slice(i, j + 1));
}

// Monta o prompt do auditor (espelha as regras do nó Gemini do WF-07).
function montarPrompt({ tipo, titular, documento, candidatas, nome, dataAtual }) {
  const ctxCandidatas = Array.isArray(candidatas) && candidatas.length
    ? "CERTIDÕES PENDENTES para este documento (identifique a qual o arquivo corresponde):\n" +
      candidatas.map((c, i) => `${i + 1}. id=${c.certidao_id || ""} tipo=${c.tipo || ""} titular=${c.titular || ""} doc=${c.documento || ""}`).join("\n") + "\n\n"
    : "";

  return (
    "Você é um Auditor Jurídico Sênior. HOJE é " + dataAtual + ".\n" +
    "Recebeu o arquivo de uma certidão para classificar e conferir.\n\n" +
    "CONTEXTO (gabarito esperado):\n" +
    "- Tipo esperado: " + (tipo || "(não informado)") + "\n" +
    "- Titular esperado: " + (titular || "(não informado)") + "\n" +
    "- Documento esperado (CPF/CNPJ): " + (documento || "(não informado)") + "\n" +
    "- Nome do arquivo (pista de tipo): " + (nome || "(sem nome)") + "\n\n" +
    ctxCandidatas +
    "==== REGRAS DE MATCHING (qual tipo o arquivo representa) ====\n" +
    "- 'UNIFICADA' (TRF/CJF): NÃO colapse tudo em trf_civel. Classifique pelo TÍTULO do documento: título com CRIMINAL -> trf_criminal; título com CÍVEL/CIVIL -> trf_civel. Desempate pelo nome do arquivo (TRF_CRIMINAL_ -> trf_criminal; TRF_CIVEL_ -> trf_civel). Escolha a candidata do tipo correspondente.\n" +
    "- Trabalhista TRT2: 'PJe'/'eletrônica'/'Processo Eletrônico' -> trt2_digital; 'PROCESSOS FÍSICOS' -> trt2_fisico. São candidatas DISTINTAS — não troque uma pela outra.\n" +
    "- TJSP cível tem DOIS tipos: (a) tjsp_civel_1g (sistema EPROC, 1º grau) — contém 'Comarcas e Turmas Recursais', 'Primeiro Grau', '1º Grau' ou 'sistema eproc'; (b) tjsp_civeis (e-SAJ/SAJ SGC) — menciona 'SAJ' ou é certidão geral sem os marcadores de eproc.\n" +
    "- Diferença ortográfica pequena (LTDA vs EIRELI) NÃO é divergência. CENPROT normalmente não traz o nome do titular.\n" +
    "- Pesquisa pela raiz do CNPJ quando o esperado tinha sufixo de filial NÃO é divergência.\n" +
    (Array.isArray(candidatas) && candidatas.length
      ? "- Quando há candidatas acima: devolva em 'certidao_id' o id EXATO da candidata que corresponde a este arquivo. Se NENHUMA corresponder, certidao_id=null e divergencia=true.\n"
      : "") +
    "\n" +
    "==== CRITÉRIO DE RESULTADO ====\n" +
    "- negativa: a certidão diz NADA CONSTA / NÃO CONSTA / REGULAR / ATIVA / NEGATIVA / 'sem pendências' / 'sem débitos' / 'inexistência de débitos' / 'não constam débitos'. Disclaimers de escopo (ressalva no rodapé, validade de 30/90 dias, menção a CCM cancelado historicamente) NÃO alteram isso.\n" +
    "- positiva: a certidão EXPLICITAMENTE lista débitos, processos em curso, restrições, irregularidades ou pendências REAIS.\n" +
    "- com_pendencias: pendência REAL com modulação (parcelamento ativo, suspensão de exigibilidade, débito sub judice). NÃO é 'tem ressalva de escopo' — é 'tem débito mas com regime especial'.\n\n" +
    "==== DIVERGÊNCIA ====\n" +
    "- divergencia=true se o arquivo NÃO corresponde ao gabarito (tipo/titular/documento claramente diferentes).\n" +
    "- Se resultado=negativa E titular/documento batem, divergencia=false.\n\n" +
    "==== PADRÃO CONSERVADOR ====\n" +
    "Na dúvida -> divergencia=false, resultado=negativa. Marcar como divergência algo que está correto é PIOR que o oposto neste contexto.\n\n" +
    "Datas: confie em " + dataAtual + " como hoje; datas de emissão iguais ou anteriores são válidas (nunca classifique como 'futuro suspeito').\n\n" +
    "RETORNE APENAS UM OBJETO JSON VÁLIDO, sem texto fora dele e sem cercas de código:\n" +
    '{"certidao_id":"id da candidata correspondente (string) ou null","tipo_detectado":"string","titular_detectado":"string ou null","documento_detectado":"string ou null","divergencia":true,"resultado":"negativa|positiva|com_pendencias","data_emissao":"YYYY-MM-DD ou null","numero_certidao":"string ou null","observacao":"até 300 caracteres"}'
  );
}

/**
 * Lê a certidão (PDF ou HTML em base64) com o Claude e devolve o JSON da auditoria.
 * Em erro, devolve o mesmo formato de falha do WF-07 (divergencia=true, resultado=null),
 * para nunca travar o fluxo de quem chama.
 */
async function auditarCertidao({ fileBase64, tipo, titular, documento, candidatas, nome }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY não configurada no Render");
  if (!fileBase64) throw new Error("fileBase64 ausente");

  const dataAtual = new Date().toISOString().slice(0, 10);
  const tipoArquivo = detectarTipo(fileBase64);
  const prompt = montarPrompt({ tipo, titular, documento, candidatas, nome, dataAtual });

  const content = [];
  if (tipoArquivo === "pdf") {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: fileBase64 },
      title: nome || "certidao.pdf",
      citations: { enabled: false },
    });
    content.push({ type: "text", text: prompt });
  } else if (tipoArquivo === "html") {
    const html = Buffer.from(fileBase64, "base64").toString("utf8");
    const texto = extrairTextoHtml(html).slice(0, 30000);
    content.push({ type: "text", text: prompt + "\n\nCONTEÚDO DA CERTIDÃO (extraído de HTML):\n\n" + texto });
  } else {
    // Tipo desconhecido: não dá pra ler — sinaliza falha sem travar.
    return {
      certidao_id: null, tipo_detectado: null, titular_detectado: null, documento_detectado: null,
      divergencia: true, resultado: null, data_emissao: null, numero_certidao: null,
      observacao: "Leitor Claude: tipo de arquivo desconhecido (não é PDF nem HTML).",
      _fonte: "claude", _erro: "tipo_desconhecido",
    };
  }

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content }],
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error("Anthropic HTTP " + resp.status + ": " + txt.slice(0, 600));
  }
  const data = await resp.json();
  const texto = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");

  let parsed;
  try { parsed = extrairJSON(texto); }
  catch (e) {
    return {
      certidao_id: null, tipo_detectado: null, titular_detectado: null, documento_detectado: null,
      divergencia: true, resultado: null, data_emissao: null, numero_certidao: null,
      observacao: "Leitor Claude não devolveu JSON válido: " + String(texto || "").slice(0, 200),
      _fonte: "claude", _erro: "json_invalido",
    };
  }

  // Normaliza para o formato esperado pelo WF-07 + marca a fonte.
  return {
    certidao_id: parsed.certidao_id || null,
    tipo_detectado: parsed.tipo_detectado || null,
    titular_detectado: parsed.titular_detectado || null,
    documento_detectado: parsed.documento_detectado || null,
    divergencia: parsed.divergencia === true,
    resultado: parsed.resultado || null,
    data_emissao: parsed.data_emissao || null,
    numero_certidao: parsed.numero_certidao || null,
    observacao: (parsed.observacao || "").slice(0, 1000),
    _fonte: "claude",
    _tipo_arquivo: tipoArquivo,
  };
}

module.exports = { auditarCertidao, detectarTipo, extrairTextoHtml };
