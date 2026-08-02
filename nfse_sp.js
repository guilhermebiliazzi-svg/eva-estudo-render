/**
 * nfse_sp.js — Emissão de NFS-e no web service da Prefeitura de São Paulo.
 *
 * Layout 1 (Simples Nacional). Manual de Utilização Web Service v3.3.7.
 *
 * Prestador: VILLE JARDINS NEGOCIOS IMOBILIARIOS LTDA
 *   CNPJ 41132782000108 · IM 69033951 · Código de serviço 03212
 *
 * Variáveis de ambiente necessárias no Render:
 *   NFSE_SP_PFX_BASE64   — certificado A1 (.pfx) em base64
 *   NFSE_SP_PFX_SENHA    — senha do certificado
 *   NFSE_SP_CNPJ         — 41132782000108
 *   NFSE_SP_IM           — 69033951
 *   NFSE_SP_CODIGO_SERV  — 03212
 *   NFSE_SP_ALIQUOTA     — ex.: 0.05  (alerta 208: se divergir, a Prefeitura adota a vigente)
 *
 * O certificado NUNCA fica no repositório. Só nas variáveis de ambiente.
 */

const https = require("https");
const crypto = require("crypto");
const forge = require("node-forge");
const { SignedXml } = require("xml-crypto");

const WS_HOST = "nfews.prefeitura.sp.gov.br";
const WS_PATH = "/lotenfe.asmx";
const NS = "http://www.prefeitura.sp.gov.br/nfe";

/**
 * SOAPAction de cada operação, lidos do WSDL do próprio serviço
 * (GET /lotenfe.asmx?WSDL, em 02/08/2026).
 *
 * Não são deriváveis do nome do método: o caminho é /nfe/ws/, a inicial é
 * minúscula e o teste se chama "testeenvio". Deduzir do manual dá
 * "Server did not recognize the value of HTTP Header SOAPAction".
 * A rota GET /nfse-sp/wsdl relê essa lista se a Prefeitura mudar algo.
 */
const SOAP_ACTIONS = {
  EnvioRPS:                "http://www.prefeitura.sp.gov.br/nfe/ws/envioRPS",
  EnvioLoteRPS:            "http://www.prefeitura.sp.gov.br/nfe/ws/envioLoteRPS",
  TesteEnvioLoteRPS:       "http://www.prefeitura.sp.gov.br/nfe/ws/testeenvio",
  CancelamentoNFe:         "http://www.prefeitura.sp.gov.br/nfe/ws/cancelamentoNFe",
  ConsultaNFe:             "http://www.prefeitura.sp.gov.br/nfe/ws/consultaNFe",
  ConsultaNFeRecebidas:    "http://www.prefeitura.sp.gov.br/nfe/ws/consultaNFeRecebidas",
  ConsultaNFeEmitidas:     "http://www.prefeitura.sp.gov.br/nfe/ws/consultaNFeEmitidas",
  ConsultaLote:            "http://www.prefeitura.sp.gov.br/nfe/ws/consultaLote",
  ConsultaInformacoesLote: "http://www.prefeitura.sp.gov.br/nfe/ws/consultaInformacoesLote",
  ConsultaCNPJ:            "http://www.prefeitura.sp.gov.br/nfe/ws/consultaCNPJ",
};

/* ------------------------------------------------------------------ */
/* Certificado                                                         */
/* ------------------------------------------------------------------ */

let _cache = null;

/**
 * Extrai chave privada e certificado do .pfx.
 * O resultado é cacheado — abrir PKCS#12 é caro e o certificado não muda
 * durante a vida do processo.
 */
function lerCertificado() {
  if (_cache) return _cache;

  const b64 = process.env.NFSE_SP_PFX_BASE64;
  const senha = process.env.NFSE_SP_PFX_SENHA;
  if (!b64 || !senha) {
    throw new Error("NFSE_SP_PFX_BASE64 e NFSE_SP_PFX_SENHA são obrigatórias.");
  }

  const pfxDer = forge.util.decode64(b64.replace(/\s/g, ""));
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(pfxDer), senha);

  let privateKeyPem = null;
  let certPem = null;
  let notAfter = null;

  for (const sc of p12.safeContents) {
    for (const bag of sc.safeBags) {
      if (bag.key && !privateKeyPem) privateKeyPem = forge.pki.privateKeyToPem(bag.key);
      if (bag.cert && !certPem) {
        certPem = forge.pki.certificateToPem(bag.cert);
        notAfter = bag.cert.validity.notAfter;
      }
    }
  }
  if (!privateKeyPem || !certPem) {
    throw new Error("Não foi possível extrair chave e certificado do .pfx (senha errada?).");
  }
  if (notAfter && notAfter < new Date()) {
    throw new Error(`Certificado vencido em ${notAfter.toISOString().slice(0, 10)}.`);
  }

  _cache = { privateKeyPem, certPem, pfxBuffer: Buffer.from(pfxDer, "binary"), senha, notAfter };
  return _cache;
}

/* ------------------------------------------------------------------ */
/* Helpers de formatação                                               */
/* ------------------------------------------------------------------ */

const soDigitos = (v) => String(v || "").replace(/\D/g, "");
const zeroEsq = (v, n) => soDigitos(v).padStart(n, "0").slice(-n);

/** Valor em centavos, 15 posições, sem ponto e sem R$. */
const valor15 = (v) => String(Math.round((Number(v) || 0) * 100)).padStart(15, "0");

/** Série alinhada à esquerda, completada com espaços à direita, 5 posições. */
const serie5 = (s) => String(s || "").slice(0, 5).padEnd(5, " ");

const escaparXml = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * Discriminação: CR/LF viram pipe (item tpDiscriminacao do manual), máx 2000.
 */
function discriminacao(texto) {
  return escaparXml(
    String(texto || "").replace(/\r\n|\r|\n/g, "|").trim().slice(0, 2000)
  );
}

/* ------------------------------------------------------------------ */
/* Assinatura do RPS — string de 86 posições (layout 1, item 4.3.2)     */
/* ------------------------------------------------------------------ */

/**
 * Monta a cadeia de caracteres do RPS. As 86 posições são:
 *   8  IM do prestador
 *   5  série (esquerda, espaços à direita)
 *  12  número do RPS
 *   8  data de emissão AAAAMMDD
 *   1  tipo de tributação
 *   1  status
 *   1  ISS retido (S/N)
 *  15  valor dos serviços
 *  15  valor das deduções
 *   5  código de serviço
 *   1  indicador do documento do tomador (1=CPF, 2=CNPJ, 3=não informado)
 *  14  CPF/CNPJ do tomador
 * Sem intermediário, não se informam os campos 13 a 15.
 */
function montarStringAssinatura(rps) {
  const doc = soDigitos(rps.tomadorDoc);
  const indicador = doc.length === 11 ? "1" : doc.length === 14 ? "2" : "3";
  const docPad = indicador === "3" ? "0".repeat(14) : zeroEsq(doc, 14);

  const s =
    zeroEsq(rps.inscricaoPrestador, 8) +
    serie5(rps.serie) +
    zeroEsq(rps.numero, 12) +
    String(rps.dataEmissao).replace(/-/g, "") +
    rps.tributacao +
    rps.status +
    (rps.issRetido ? "S" : "N") +
    valor15(rps.valorServicos) +
    valor15(rps.valorDeducoes || 0) +
    zeroEsq(rps.codigoServico, 5) +
    indicador +
    docPad;

  if (s.length !== 86) {
    throw new Error(`String de assinatura com ${s.length} posições (esperado 86): "${s}"`);
  }
  return s;
}

/** SHA-1 + RSA da string, em base64. Uma função só — não assinar hash de hash. */
function assinarRPS(rps) {
  const { privateKeyPem } = lerCertificado();
  return crypto
    .createSign("RSA-SHA1")
    .update(montarStringAssinatura(rps), "ascii")
    .sign(privateKeyPem, "base64");
}

/* ------------------------------------------------------------------ */
/* Montagem do XML                                                     */
/* ------------------------------------------------------------------ */

/**
 * Bloco <RPS> no layout 1. A ORDEM DOS ELEMENTOS IMPORTA — o XSD valida
 * a sequência. Campos opcionais zerados são omitidos (item 3.4.4).
 */
function blocoRPS(rps) {
  const doc = soDigitos(rps.tomadorDoc);
  const tagDoc =
    doc.length === 11
      ? `<CPF>${doc}</CPF>`
      : doc.length === 14
      ? `<CNPJ>${doc}</CNPJ>`
      : null;

  const partes = [];
  partes.push(`<RPS xmlns="${NS}">`);
  partes.push(`<Assinatura>${rps.assinatura}</Assinatura>`);
  partes.push(`<ChaveRPS>`);
  partes.push(`<InscricaoPrestador>${zeroEsq(rps.inscricaoPrestador, 8)}</InscricaoPrestador>`);
  partes.push(`<SerieRPS>${escaparXml(rps.serie)}</SerieRPS>`);
  partes.push(`<NumeroRPS>${Number(rps.numero)}</NumeroRPS>`);
  partes.push(`</ChaveRPS>`);
  partes.push(`<TipoRPS>RPS</TipoRPS>`);
  partes.push(`<DataEmissao>${rps.dataEmissao}</DataEmissao>`);
  partes.push(`<StatusRPS>${rps.status}</StatusRPS>`);
  partes.push(`<TributacaoRPS>${rps.tributacao}</TributacaoRPS>`);
  partes.push(`<ValorServicos>${Number(rps.valorServicos).toFixed(2)}</ValorServicos>`);
  partes.push(`<ValorDeducoes>${Number(rps.valorDeducoes || 0).toFixed(2)}</ValorDeducoes>`);
  partes.push(`<CodigoServico>${zeroEsq(rps.codigoServico, 5)}</CodigoServico>`);
  partes.push(`<AliquotaServicos>${Number(rps.aliquota).toFixed(4)}</AliquotaServicos>`);
  partes.push(`<ISSRetido>${rps.issRetido ? "true" : "false"}</ISSRetido>`);

  if (tagDoc) partes.push(`<CPFCNPJTomador>${tagDoc}</CPFCNPJTomador>`);
  if (rps.tomadorNome) {
    partes.push(`<RazaoSocialTomador>${escaparXml(rps.tomadorNome).slice(0, 75)}</RazaoSocialTomador>`);
  }

  // Endereço: obrigatório para tomador PJ (erros 317 e 318).
  const e = rps.tomadorEndereco;
  if (e && e.logradouro) {
    partes.push(`<EnderecoTomador>`);
    if (e.tipoLogradouro) partes.push(`<TipoLogradouro>${escaparXml(e.tipoLogradouro).slice(0, 3)}</TipoLogradouro>`);
    partes.push(`<Logradouro>${escaparXml(e.logradouro).slice(0, 50)}</Logradouro>`);
    if (e.numero) partes.push(`<NumeroEndereco>${escaparXml(e.numero).slice(0, 10)}</NumeroEndereco>`);
    if (e.complemento) partes.push(`<ComplementoEndereco>${escaparXml(e.complemento).slice(0, 30)}</ComplementoEndereco>`);
    if (e.bairro) partes.push(`<Bairro>${escaparXml(e.bairro).slice(0, 30)}</Bairro>`);
    if (e.cidadeIbge) partes.push(`<Cidade>${soDigitos(e.cidadeIbge)}</Cidade>`);
    if (e.uf) partes.push(`<UF>${escaparXml(e.uf).slice(0, 2)}</UF>`);
    if (e.cep) partes.push(`<CEP>${soDigitos(e.cep)}</CEP>`);
    partes.push(`</EnderecoTomador>`);
  }

  if (rps.tomadorEmail) {
    partes.push(`<EmailTomador>${escaparXml(rps.tomadorEmail).slice(0, 75)}</EmailTomador>`);
  }
  partes.push(`<Discriminacao>${discriminacao(rps.discriminacao)}</Discriminacao>`);
  partes.push(`</RPS>`);
  return partes.join("");
}

/** PedidoEnvioRPS — envio individual, síncrono (método EnvioRPS). */
function xmlPedidoEnvioRPS(rps, cnpjRemetente) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<PedidoEnvioRPS xmlns="${NS}" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">` +
    `<Cabecalho xmlns="" Versao="1">` +
    `<CPFCNPJRemetente><CNPJ>${soDigitos(cnpjRemetente)}</CNPJ></CPFCNPJRemetente>` +
    `</Cabecalho>` +
    blocoRPS(rps).replace(` xmlns="${NS}"`, ` xmlns=""`) +
    `</PedidoEnvioRPS>`
  );
}

/** PedidoEnvioLoteRPS — usado pelo TesteEnvioLoteRPS (valida sem gerar NF-e). */
function xmlPedidoLoteRPS(rps, cnpjRemetente) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<PedidoEnvioLoteRPS xmlns="${NS}" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">` +
    `<Cabecalho xmlns="" Versao="1">` +
    `<CPFCNPJRemetente><CNPJ>${soDigitos(cnpjRemetente)}</CNPJ></CPFCNPJRemetente>` +
    `<transacao>true</transacao>` +
    `<dtInicio>${rps.dataEmissao}</dtInicio>` +
    `<dtFim>${rps.dataEmissao}</dtFim>` +
    `<QtdRPS>1</QtdRPS>` +
    `<ValorTotalServicos>${Number(rps.valorServicos).toFixed(2)}</ValorTotalServicos>` +
    `<ValorTotalDeducoes>${Number(rps.valorDeducoes || 0).toFixed(2)}</ValorTotalDeducoes>` +
    `</Cabecalho>` +
    blocoRPS(rps).replace(` xmlns="${NS}"`, ` xmlns=""`) +
    `</PedidoEnvioLoteRPS>`
  );
}

/**
 * Assinatura XML da mensagem: enveloped + C14N, digest SHA-1, RSA-SHA1.
 * O certificado vai no KeyInfo; KeyValue/RSAKeyValue e X509SubjectName
 * NÃO devem ir (item 3.2.3 do manual).
 */
function assinarXml(xml) {
  const { privateKeyPem, certPem } = lerCertificado();
  const sig = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certPem,
    signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
    canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
  });
  sig.addReference({
    xpath: "/*",
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
    ],
    digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
  });
  sig.computeSignature(xml);
  return sig.getSignedXml();
}

/* ------------------------------------------------------------------ */
/* Transporte SOAP (mTLS)                                              */
/* ------------------------------------------------------------------ */

function chamarWs(metodo, mensagemXml) {
  const { pfxBuffer, senha } = lerCertificado();

  const envelope =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
    `xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body>` +
    `<${metodo}Request xmlns="${NS}">` +
    `<VersaoSchema>1</VersaoSchema>` +
    `<MensagemXML><![CDATA[${mensagemXml}]]></MensagemXML>` +
    `</${metodo}Request>` +
    `</soap:Body>` +
    `</soap:Envelope>`;

  // override por env só para emergência (ex.: a Prefeitura mudar o WSDL
  // fora de um deploy). Formato: "Metodo=url;Metodo2=url2".
  let soapAction = SOAP_ACTIONS[metodo];
  const override = process.env.NFSE_SP_SOAPACTIONS;
  if (override) {
    for (const par of override.split(";")) {
      const [k, v] = par.split("=");
      if (k && k.trim() === metodo && v) soapAction = v.trim();
    }
  }
  if (!soapAction) throw new Error(`SOAPAction desconhecido para o método "${metodo}".`);

  const body = Buffer.from(envelope, "utf8");
  if (body.length > 500 * 1024) {
    throw new Error("Mensagem XML acima de 500 KB (erro 1101).");
  }

  const opcoes = {
    host: WS_HOST,
    path: WS_PATH,
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "Content-Length": body.length,
      SOAPAction: soapAction,
    },
    agent: new https.Agent({
      pfx: pfxBuffer,
      passphrase: senha,
      minVersion: "TLSv1.2", // erro 426/1000: TLS 1.0 e 1.1 desativados
      keepAlive: false,
    }),
    timeout: 60000,
  };

  return new Promise((resolve, reject) => {
    const req = https.request(opcoes, (res) => {
      let dados = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (dados += d));
      res.on("end", () => resolve({ status: res.statusCode, corpo: dados }));
    });
    req.on("timeout", () => req.destroy(new Error("Timeout no web service da Prefeitura.")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/* ------------------------------------------------------------------ */
/* Diagnóstico do WSDL                                                 */
/* ------------------------------------------------------------------ */

/**
 * Baixa o WSDL usando o mesmo certificado e devolve os soapAction que o
 * serviço realmente declara. Existe porque o header SOAPAction precisa
 * bater exatamente — deduzir do manual não é confiável.
 */
function baixarWsdl() {
  const { pfxBuffer, senha } = lerCertificado();
  const opcoes = {
    host: WS_HOST,
    path: WS_PATH + "?WSDL",
    method: "GET",
    agent: new https.Agent({
      pfx: pfxBuffer,
      passphrase: senha,
      minVersion: "TLSv1.2",
      keepAlive: false,
    }),
    timeout: 45000,
  };
  return new Promise((resolve, reject) => {
    const req = https.request(opcoes, (res) => {
      let d = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve({ status: res.statusCode, corpo: d }));
    });
    req.on("timeout", () => req.destroy(new Error("Timeout ao baixar o WSDL.")));
    req.on("error", reject);
    req.end();
  });
}

/** Lista { operacao, soapAction } a partir do WSDL. */
async function listarSoapActions() {
  const r = await baixarWsdl();
  if (r.status !== 200) return { ok: false, status: r.status, trecho: r.corpo.slice(0, 500) };

  const acoes = [];
  const re = /<(?:\w+:)?operation[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?operation>/gi;
  let m;
  while ((m = re.exec(r.corpo))) {
    const sa = m[2].match(/soapAction="([^"]*)"/i);
    if (sa) acoes.push({ operacao: m[1], soapAction: sa[1] });
  }
  // fallback: pega todos os soapAction soltos
  if (!acoes.length) {
    const re2 = /soapAction="([^"]*)"/gi;
    let m2;
    while ((m2 = re2.exec(r.corpo))) acoes.push({ operacao: null, soapAction: m2[1] });
  }
  const vistos = new Set();
  const unicas = acoes.filter((a) => {
    const k = a.operacao + "|" + a.soapAction;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  return { ok: true, total: unicas.length, acoes: unicas, tamanhoWsdl: r.corpo.length };
}

/* ------------------------------------------------------------------ */
/* Leitura do retorno                                                  */
/* ------------------------------------------------------------------ */

const pegar = (xml, tag) => {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "i"));
  return m ? m[1].trim() : null;
};

const pegarTodos = (xml, tag) => {
  const re = new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "gi");
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
};

function interpretarRetorno(corpo) {
  // o retorno vem escapado dentro de <RetornoXML>
  let interno = pegar(corpo, "RetornoXML") || corpo;
  interno = interno
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

  const sucesso = /<(?:\w+:)?Sucesso[^>]*>\s*true\s*</i.test(interno);

  const erros = pegarTodos(interno, "Erro").map((b) => ({
    codigo: pegar(b, "Codigo"),
    descricao: pegar(b, "Descricao"),
  }));
  const alertas = pegarTodos(interno, "Alerta").map((b) => ({
    codigo: pegar(b, "Codigo"),
    descricao: pegar(b, "Descricao"),
  }));

  const chave = pegarTodos(interno, "ChaveNFe")[0] || "";
  const numeroNota = chave ? pegar(chave, "Numero") : null;
  const codigoVerificacao = chave ? pegar(chave, "CodigoVerificacao") : null;

  return { sucesso, erros, alertas, numeroNota, codigoVerificacao, xml: interno };
}

/* ------------------------------------------------------------------ */
/* API do módulo                                                       */
/* ------------------------------------------------------------------ */

/**
 * Emite (ou testa) uma NFS-e.
 *
 * @param {object} dados
 *   serie, numero            — reservados via adm_proximo_rps
 *   dataEmissao              — "AAAA-MM-DD"
 *   valorServicos            — taxa de administração
 *   tomadorDoc, tomadorNome, tomadorEmail, tomadorEndereco
 *   discriminacao            — texto; quebras de linha viram pipe
 * @param {object} opcoes
 *   teste: true → TesteEnvioLoteRPS (valida tudo, NÃO gera nota)
 */
async function emitirNFSe(dados, opcoes = {}) {
  const cnpj = process.env.NFSE_SP_CNPJ || "41132782000108";
  const im = process.env.NFSE_SP_IM || "69033951";

  const rps = {
    inscricaoPrestador: im,
    serie: dados.serie,
    numero: dados.numero,
    dataEmissao: dados.dataEmissao,
    status: "N",              // Normal
    tributacao: "T",          // Tributado em São Paulo
    issRetido: false,
    valorServicos: dados.valorServicos,
    valorDeducoes: 0,
    codigoServico: process.env.NFSE_SP_CODIGO_SERV || "03212",
    aliquota: Number(process.env.NFSE_SP_ALIQUOTA || 0.05),
    tomadorDoc: dados.tomadorDoc,
    tomadorNome: dados.tomadorNome,
    tomadorEmail: dados.tomadorEmail,
    tomadorEndereco: dados.tomadorEndereco,
    discriminacao: dados.discriminacao,
  };

  rps.assinatura = assinarRPS(rps);

  const teste = !!opcoes.teste;
  const metodo = teste ? "TesteEnvioLoteRPS" : "EnvioRPS";
  const mensagem = teste
    ? assinarXml(xmlPedidoLoteRPS(rps, cnpj))
    : assinarXml(xmlPedidoEnvioRPS(rps, cnpj));

  const resposta = await chamarWs(metodo, mensagem);

  if (resposta.status !== 200) {
    return {
      sucesso: false,
      erros: [{ codigo: String(resposta.status), descricao: "HTTP " + resposta.status }],
      alertas: [],
      metodo,
      xmlEnvio: mensagem,
      xmlRetorno: resposta.corpo,
    };
  }

  const r = interpretarRetorno(resposta.corpo);
  return {
    sucesso: r.sucesso,
    teste,
    metodo,
    numeroNota: r.numeroNota,
    codigoVerificacao: r.codigoVerificacao,
    erros: r.erros,
    alertas: r.alertas,
    stringAssinatura: montarStringAssinatura(rps),
    xmlEnvio: mensagem,
    xmlRetorno: resposta.corpo,
  };
}

/** Diagnóstico: confirma que o certificado carrega, sem tocar na Prefeitura. */
function statusCertificado() {
  try {
    const c = lerCertificado();
    return {
      ok: true,
      validoAte: c.notAfter ? c.notAfter.toISOString().slice(0, 10) : null,
      diasRestantes: c.notAfter
        ? Math.floor((c.notAfter - new Date()) / 86400000)
        : null,
    };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

module.exports = {
  SOAP_ACTIONS,
  emitirNFSe,
  statusCertificado,
  listarSoapActions,
  baixarWsdl,
  montarStringAssinatura,
  assinarRPS,
  assinarXml,
  xmlPedidoEnvioRPS,
  xmlPedidoLoteRPS,
  interpretarRetorno,
};
