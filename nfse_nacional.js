/**
 * nfse_nacional.js — Emissão de NFS-e pelo Sistema Nacional (Sefin Nacional / ADN).
 *
 * Desde 01/11/2026 (Resolução CGSN 191/2026) as ME/EPP do Simples Nacional
 * em São Paulo emitem pelo Emissor Nacional — o web service da Prefeitura
 * (nfse_sp.js) só serve para fatos geradores até 31/10/2026.
 *
 * Prestador: VILLE JARDINS NEGOCIOS IMOBILIARIOS LTDA
 *   CNPJ 41132782000108 · IM 69033951 · São Paulo (IBGE 3550308)
 *   Simples Nacional ME/EPP (opSimpNac 3), ISS apurado pelo SN (regApTribSN 1)
 *
 * Fluxo da emissão (manual da API, v1.2):
 *   1. monta a DPS (leiaute 1.01) com Id = "DPS" + cMun(7) + tpInsc(1) +
 *      CNPJ(14) + série(5) + nDPS(15)
 *   2. assina o <infDPS> (XMLDSig enveloped, C14N, RSA-SHA1, X509 no KeyInfo)
 *   3. comprime com gzip, codifica em base64 e manda em JSON
 *      { dpsXmlGZipB64 } para POST /nfse, com TLS mútuo (certificado A1)
 *   4. a resposta traz a chave de acesso (50 dígitos) e o XML da NFS-e
 *
 * Ambientes:
 *   produção          → tpAmb 1, sefin.nfse.gov.br               (leiaute 1.01)
 *   produção restrita → tpAmb 2, sefin.producaorestrita.nfse.gov.br (leiaute
 *                        1.01 de 20/10/2026: finNFSe dentro de infDPS)
 *   O "teste" do painel vai para a produção restrita: valida tudo e não tem
 *   efeito fiscal. Não existe "teste sem gerar nota" na produção.
 *
 * Variáveis de ambiente (as do certificado são as mesmas do nfse_sp.js):
 *   NFSE_SP_PFX_BASE64, NFSE_SP_PFX_SENHA, NFSE_SP_CNPJ, NFSE_SP_IM
 *   NFSE_NAC_PTOTTRIBSN   — % aproximado dos tributos do Simples (ex.: 6.00).
 *                           Sem ele vai pTotTrib zerado (Lei 12.741).
 *   NFSE_NAC_ENVIAR_IM    — "false" para não mandar a IM (padrão: manda).
 *   NFSE_NAC_REGAPTRIBSN  — regime de apuração do SN (padrão 1).
 *   NFSE_NAC_CTRIBMUN     — códigos municipais por serviço (padrão "171201=008;100501=001").
 *   NFSE_NAC_SEFIN_URL / NFSE_NAC_ADN_URL — override das URLs de produção.
 */

const https = require("https");
const zlib = require("zlib");
const { SignedXml } = require("xml-crypto");
const { lerCertificado } = require("./nfse_sp");
const { gerarDanfse } = require("./danfse_local");

const NS = "http://www.sped.fazenda.gov.br/nfse";
const VERSAO = "1.01";
const VER_APLIC = "VILLE-PAINEL-1.0";
const COD_MUN_SP = "3550308";

const AMBIENTES = {
  producao: {
    tpAmb: "1",
    sefin: process.env.NFSE_NAC_SEFIN_URL || "https://sefin.nfse.gov.br/sefinnacional",
    adn: process.env.NFSE_NAC_ADN_URL || "https://adn.nfse.gov.br",
    leiauteNovo: false,
  },
  homologacao: {
    tpAmb: "2",
    sefin: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional",
    adn: "https://adn.producaorestrita.nfse.gov.br",
    // a produção restrita só aceita o leiaute de 20/10/2026 (cStat 1235 no antigo)
    leiauteNovo: true,
  },
};

const amb = (homologacao) => (homologacao ? AMBIENTES.homologacao : AMBIENTES.producao);

/**
 * Código de serviço da Prefeitura (usado até 31/10) → código de tributação
 * nacional (item + subitem + desdobro da LC 116, 6 dígitos).
 */
const CTRIBNAC_POR_CODIGO_SP = {
  "03212": "171201", // administração de bens imóveis → 17.12.01 administração em geral
  "06297": "100501", // corretagem de imóveis → 10.05.01 agenciamento/corretagem de bens imóveis
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const soDigitos = (v) => String(v == null ? "" : v).replace(/\D/g, "");

const escaparXml = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const TROCAS = {
  "\u2013": "-", "\u2014": "-", "\u2212": "-",
  "\u2018": "'", "\u2019": "'", "\u201A": "'",
  "\u201C": '"', "\u201D": '"', "\u201E": '"',
  "\u2026": "...", "\u2022": "-", "\u00A0": " ",
  "\u20AC": "EUR", "\u2122": "TM",
  "\u0141": "L", "\u0142": "l", "\u0110": "D", "\u0111": "d",
  "\u0152": "OE", "\u0153": "oe", "\u0131": "i",
};

/**
 * O leiaute aceita só caracteres de ! a ÿ (Latin-1) e espaço, sem espaço nas
 * pontas. Travessão, aspas curvas e emoji são rejeitados com E1235 — aqui
 * viram o equivalente ASCII ou somem.
 */
function textoNFSe(valor, max, { quebras = false } = {}) {
  let s = String(valor == null ? "" : valor).normalize("NFC");
  let out = "";
  for (const ch of s) {
    if (ch === "\r") continue;
    if (ch === "\n") { out += quebras ? "\n" : " "; continue; }
    if (ch === "\t") { out += " "; continue; }
    const cp = ch.codePointAt(0);
    if (cp >= 0x20 && cp <= 0x7e) { out += ch; continue; }
    if (cp >= 0xa1 && cp <= 0xff) { out += ch; continue; }
    if (TROCAS[ch] !== undefined) { out += TROCAS[ch]; continue; }
    // letra acentuada fora do Latin-1: tira o acento
    const base = ch.normalize("NFD").replace(/[\u0300-\u036F]/g, "");
    if (base && [...base].every((c) => c.codePointAt(0) <= 0xff)) out += base;
  }
  out = out
    .split("\n")
    .map((l) => l.replace(/ {2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (max && out.length > max) out = out.slice(0, max).trim();
  return out;
}

const dec2 = (v) => (Math.round((Number(v) || 0) * 100) / 100).toFixed(2);

/** Data/hora em São Paulo (UTC-3, sem horário de verão desde 2019). */
function agoraSP(margemSegundos = 60) {
  const d = new Date(Date.now() - margemSegundos * 1000 - 3 * 3600 * 1000);
  const iso = d.toISOString().slice(0, 19);
  return { dhEmi: `${iso}-03:00`, data: iso.slice(0, 10) };
}

// Códigos municipais de São Paulo, lidos das notas da Ville que a Prefeitura
// compartilhou com o ADN (17.12.01 → 008; 10.05.01 → 001).
const CTRIBMUN_SP = { "171201": "008", "100501": "001" };

function cTribMunDe(cTribNac) {
  const mapa = process.env.NFSE_NAC_CTRIBMUN || Object.entries(CTRIBMUN_SP).map(([k, v]) => `${k}=${v}`).join(";");
  for (const par of mapa.split(";")) {
    const [k, v] = par.split("=").map((x) => (x || "").trim());
    if (k === cTribNac && /^\d{3}$/.test(v || "") && v !== "000") return v;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Montagem da DPS                                                     */
/* ------------------------------------------------------------------ */

function idDps({ cMun, cnpj, serie, numero }) {
  return (
    "DPS" +
    cMun +
    "2" + // 2 = CNPJ
    soDigitos(cnpj).padStart(14, "0") +
    String(serie).padStart(5, "0") +
    String(numero).padStart(15, "0")
  );
}

function blocoEnderecoTomador(end) {
  if (!end || typeof end !== "object") return "";
  const cMun = soDigitos(end.cidadeIbge || end.cMun || end.codigoMunicipio);
  const cep = soDigitos(end.cep);
  const lgr = textoNFSe(
    [end.tipoLogradouro, end.logradouro].filter(Boolean).join(" "),
    255
  );
  const bairro = textoNFSe(end.bairro, 60);
  // endNac exige município IBGE e CEP; sem isso o endereço é omitido
  // (é opcional no leiaute) em vez de mandar algo inválido.
  if (cMun.length !== 7 || cep.length !== 8 || !lgr || !bairro) return "";
  const nro = textoNFSe(end.numero, 60) || "S/N";
  const cpl = textoNFSe(end.complemento, 156);
  return (
    `<end>` +
    `<endNac><cMun>${cMun}</cMun><CEP>${cep}</CEP></endNac>` +
    `<xLgr>${escaparXml(lgr)}</xLgr>` +
    `<nro>${escaparXml(nro)}</nro>` +
    (cpl ? `<xCpl>${escaparXml(cpl)}</xCpl>` : "") +
    `<xBairro>${escaparXml(bairro)}</xBairro>` +
    `</end>`
  );
}

/**
 * Monta o XML da DPS (sem assinatura).
 *
 * @param {object} d
 *   serie, numero, dataCompetencia?("AAAA-MM-DD"), valorServicos,
 *   tomadorDoc, tomadorNome, tomadorEmail?, tomadorEndereco?,
 *   discriminacao, codigoServico? (código SP) ou cTribNac?, issRetido?, aliquota?
 * @param {object} o  { homologacao }
 */
function montarDps(d, o = {}) {
  const A = amb(o.homologacao);
  const cnpj = soDigitos(process.env.NFSE_SP_CNPJ || "41132782000108");
  const im = soDigitos(process.env.NFSE_SP_IM || "69033951");
  const enviarIm =
    o.enviarIm !== undefined ? !!o.enviarIm : String(process.env.NFSE_NAC_ENVIAR_IM || "true") !== "false";
  const regApTribSN = String(process.env.NFSE_NAC_REGAPTRIBSN || "1");

  const serie = soDigitos(d.serie);
  const numero = soDigitos(d.numero);
  if (!serie || serie.length > 5 || Number(serie) < 1 || Number(serie) > 49999) {
    throw new Error(`Série da DPS inválida: "${d.serie}" (aplicativo próprio usa 1 a 49999).`);
  }
  if (!numero || numero.length > 15 || Number(numero) < 1) {
    throw new Error(`Número da DPS inválido: "${d.numero}".`);
  }

  const valor = Number(d.valorServicos);
  if (!(valor > 0)) throw new Error("valorServicos deve ser maior que zero.");

  const cTribNac =
    soDigitos(d.cTribNac) ||
    CTRIBNAC_POR_CODIGO_SP[soDigitos(d.codigoServico).padStart(5, "0")] ||
    (d.codigoServico ? null : "171201");
  if (!cTribNac || cTribNac.length !== 6) {
    throw new Error(
      `Código de serviço "${d.codigoServico}" sem correspondente na lista nacional. ` +
        `Informe cTribNac (6 dígitos).`
    );
  }
  const cTribMun = soDigitos(d.cTribMun) || cTribMunDe(cTribNac);

  const tomDoc = soDigitos(d.tomadorDoc);
  if (tomDoc.length !== 11 && tomDoc.length !== 14) {
    throw new Error("CPF/CNPJ do tomador inválido.");
  }
  const tomNome = textoNFSe(d.tomadorNome, 300);
  if (!tomNome) throw new Error("Nome do tomador é obrigatório.");
  const email = String(d.tomadorEmail || "").trim();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 80;

  const desc = textoNFSe(d.discriminacao, 2000, { quebras: true });
  if (!desc) throw new Error("Discriminação do serviço é obrigatória.");

  const { dhEmi, data: hoje } = agoraSP();
  // dCompet não pode passar do dia do dhEmi (E0015)
  let dCompet = /^\d{4}-\d{2}-\d{2}$/.test(String(d.dataCompetencia || ""))
    ? String(d.dataCompetencia)
    : hoje;
  if (dCompet > hoje) dCompet = hoje;

  const id = idDps({ cMun: COD_MUN_SP, cnpj, serie, numero });

  // ISS retido pelo tomador: ME/EPP no SN precisa informar a alíquota (E0625);
  // sem retenção, a alíquota NÃO pode ir (E0626).
  const retido = d.issRetido === true || d.issRetido === "true";
  let pAliq = "";
  if (retido) {
    const a = Number(d.aliquota);
    if (!(a > 0)) throw new Error("ISS retido exige a alíquota do Simples (aliquota, em %).");
    pAliq = `<pAliq>${dec2(a <= 1 ? a * 100 : a)}</pAliq>`;
  }

  // ME/EPP não pode usar indTotTrib (E0712). Com o % do Simples configurado
  // vai pTotTribSN; sem ele, pTotTrib zerado.
  const pSN = Number(process.env.NFSE_NAC_PTOTTRIBSN);
  const totTrib =
    pSN > 0
      ? `<totTrib><pTotTribSN>${dec2(pSN)}</pTotTribSN></totTrib>`
      : `<totTrib><pTotTrib><pTotTribFed>0.00</pTotTribFed><pTotTribEst>0.00</pTotTribEst>` +
        `<pTotTribMun>0.00</pTotTribMun></pTotTrib></totTrib>`;

  // sem cNBS a ordem do <cServ> é a mesma nos dois leiautes
  const cServ =
    `<cServ><cTribNac>${cTribNac}</cTribNac>` +
    (cTribMun ? `<cTribMun>${cTribMun}</cTribMun>` : "") +
    `<xDescServ>${escaparXml(desc)}</xDescServ></cServ>`;

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<DPS xmlns="${NS}" versao="${VERSAO}">` +
    `<infDPS Id="${id}">` +
    `<tpAmb>${A.tpAmb}</tpAmb>` +
    `<dhEmi>${dhEmi}</dhEmi>` +
    `<verAplic>${VER_APLIC}</verAplic>` +
    `<serie>${serie}</serie>` +
    `<nDPS>${Number(numero)}</nDPS>` +
    `<dCompet>${dCompet}</dCompet>` +
    `<tpEmit>1</tpEmit>` +
    (A.leiauteNovo ? `<finNFSe>0</finNFSe>` : "") +
    `<cLocEmi>${COD_MUN_SP}</cLocEmi>` +
    `<prest>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    (enviarIm && im ? `<IM>${im}</IM>` : "") +
    `<regTrib>` +
    `<opSimpNac>3</opSimpNac>` +
    `<regApTribSN>${regApTribSN}</regApTribSN>` +
    `<regEspTrib>0</regEspTrib>` +
    `</regTrib>` +
    `</prest>` +
    `<toma>` +
    (tomDoc.length === 11 ? `<CPF>${tomDoc}</CPF>` : `<CNPJ>${tomDoc}</CNPJ>`) +
    `<xNome>${escaparXml(tomNome)}</xNome>` +
    blocoEnderecoTomador(d.tomadorEndereco) +
    (emailOk ? `<email>${escaparXml(email)}</email>` : "") +
    `</toma>` +
    `<serv>` +
    `<locPrest><cLocPrestacao>${COD_MUN_SP}</cLocPrestacao></locPrest>` +
    cServ +
    `</serv>` +
    `<valores>` +
    `<vServPrest><vServ>${dec2(valor)}</vServ></vServPrest>` +
    `<trib>` +
    `<tribMun>` +
    `<tribISSQN>1</tribISSQN>` +
    `<tpRetISSQN>${retido ? "2" : "1"}</tpRetISSQN>` +
    pAliq +
    `</tribMun>` +
    totTrib +
    `</trib>` +
    `</valores>` +
    `</infDPS>` +
    `</DPS>`;

  return { xml, id, dhEmi, dCompet, cTribNac, cTribMun };
}

/* ------------------------------------------------------------------ */
/* Assinatura                                                          */
/* ------------------------------------------------------------------ */

/**
 * Assina o elemento com atributo Id (infDPS ou infPedReg).
 * A <Signature> fica irmã do elemento assinado, como exige o leiaute.
 */
function assinarElemento(xml, nomeElemento) {
  const { privateKeyPem, certPem } = lerCertificado();
  const xpath = `//*[local-name(.)='${nomeElemento}']`;
  const sig = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certPem,
    signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
    canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
  });
  sig.addReference({
    xpath,
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
    ],
    digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
  });
  sig.computeSignature(xml, { location: { reference: xpath, action: "after" } });
  return sig.getSignedXml();
}

/* ------------------------------------------------------------------ */
/* Transporte (TLS mútuo)                                              */
/* ------------------------------------------------------------------ */

let _agent = null;
function agente() {
  if (_agent) return _agent;
  const { pfxBuffer, senha } = lerCertificado();
  _agent = new https.Agent({ pfx: pfxBuffer, passphrase: senha, minVersion: "TLSv1.2", keepAlive: true });
  return _agent;
}

function requisicao(metodo, url, { corpo = null, aceitar = "application/json", timeoutMs = 45000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = corpo == null ? null : Buffer.from(JSON.stringify(corpo), "utf8");
    const req = https.request(
      {
        host: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: metodo,
        agent: agente(),
        headers: {
          Accept: aceitar,
          ...(body ? { "Content-Type": "application/json", "Content-Length": body.length } : {}),
        },
      },
      (res) => {
        const partes = [];
        res.on("data", (c) => partes.push(c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, corpo: Buffer.concat(partes) }));
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Tempo esgotado (${timeoutMs / 1000}s) em ${metodo} ${u.pathname}`)));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const gzipB64 = (xml) => zlib.gzipSync(Buffer.from(xml, "utf8")).toString("base64");
const deGzipB64 = (b64) => zlib.gunzipSync(Buffer.from(b64, "base64")).toString("utf8");

function lerJson(buf) {
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    return null;
  }
}

/** Erros vêm como `erros` ou `erro`, com Codigo/Descricao em maiúscula ou não. */
function errosDe(json, status, buf) {
  const lista = (json && (json.erros || json.erro || json.Erros || json.Erro)) || null;
  const arr = Array.isArray(lista) ? lista : lista ? [lista] : [];
  const erros = arr.map((e) => ({
    codigo: String(e.Codigo || e.codigo || "").trim() || null,
    descricao: [e.Descricao || e.descricao, e.Complemento || e.complemento]
      .filter(Boolean)
      .join(" — ")
      .slice(0, 600),
  }));
  if (!erros.length) {
    const msg =
      (json && (json.mensagem || json.message || json.title || json.detail)) ||
      buf.toString("utf8").slice(0, 300) ||
      "sem corpo";
    erros.push({ codigo: `HTTP ${status}`, descricao: String(msg) });
  }
  return erros;
}

const pegar = (xml, tag) => {
  const m = String(xml || "").match(
    new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`)
  );
  return m ? m[1].trim() : null;
};

function resumoNFSe(xml) {
  const idInf = (String(xml).match(/<infNFSe[^>]*\sId="([^"]+)"/) || [])[1] || "";
  return {
    chaveAcesso: idInf.replace(/^NFS/, "") || null,
    numeroNota: pegar(xml, "nNFSe"),
    dataProcessamento: pegar(xml, "dhProc"),
    cStat: pegar(xml, "cStat"),
    serie: pegar(xml, "serie"),
    nDPS: pegar(xml, "nDPS"),
    dCompet: pegar(xml, "dCompet"),
    valor: pegar(xml, "vServ"),
    tomador: pegar(pegar(xml, "toma") || "", "xNome"),
  };
}

/* ------------------------------------------------------------------ */
/* API do módulo                                                       */
/* ------------------------------------------------------------------ */

/**
 * Emite uma NFS-e. Com { homologacao: true } vai para a produção restrita
 * (valida tudo, sem efeito fiscal) — é o "teste" do painel.
 *
 * Devolve no mesmo formato do nfse_sp.emitirNFSe, para o painel não mudar:
 *   { sucesso, teste, numeroNota, codigoVerificacao, chaveAcesso, idDps,
 *     erros:[{codigo,descricao}], alertas:[...] }
 */
async function emitirNacional(dados, opcoes = {}) {
  const homologacao = !!opcoes.homologacao;
  const A = amb(homologacao);

  // A IM só pode ir se houver cadastro complementar no CNC do município
  // (E0120 quando não há; obrigatória quando há). Começa pelo padrão e, se a
  // Sefin recusar só por isso, reenvia a mesma DPS com o ajuste — a DPS
  // rejeitada não ocupa o número.
  let dps, assinado, r, json;
  let enviarIm;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    dps = montarDps(dados, { homologacao, enviarIm });
    assinado = assinarElemento(dps.xml, "infDPS");
    r = await requisicao("POST", `${A.sefin}/nfse`, { corpo: { dpsXmlGZipB64: gzipB64(assinado) } });
    json = lerJson(r.corpo);
    if (r.status < 400) break;
    const codigos = errosDe(json, r.status, r.corpo).map((e) => String(e.codigo || ""));
    const temIm = /<prest><CNPJ>\d+<\/CNPJ><IM>/.test(dps.xml);
    if (codigos.length === 1 && codigos[0] === "E0120" && temIm) enviarIm = false;
    else if (codigos.length === 1 && codigos[0] === "E0116" && !temIm) enviarIm = true;
    else break;
  }
  const base = {
    teste: homologacao,
    ambiente: homologacao ? "producao_restrita" : "producao",
    idDps: dps.id,
    dCompet: dps.dCompet,
    cTribNac: dps.cTribNac,
    cTribMun: dps.cTribMun || null,
    xmlEnvio: assinado,
  };

  if (r.status >= 200 && r.status < 300 && json && json.nfseXmlGZipB64) {
    const xmlNfse = deGzipB64(json.nfseXmlGZipB64);
    const s = resumoNFSe(xmlNfse);
    return {
      ...base,
      sucesso: true,
      chaveAcesso: json.chaveAcesso || s.chaveAcesso,
      numeroNota: s.numeroNota,
      codigoVerificacao: null,
      dataProcessamento: json.dataHoraProcessamento || s.dataProcessamento,
      erros: [],
      alertas: (json.alertas || []).map((a) => ({
        codigo: a.Codigo || a.codigo || null,
        descricao: a.Descricao || a.descricao || JSON.stringify(a),
      })),
      xmlRetorno: xmlNfse,
    };
  }

  return {
    ...base,
    sucesso: false,
    httpStatus: r.status,
    erros: errosDe(json, r.status, r.corpo),
    alertas: [],
    xmlRetorno: r.corpo.toString("utf8").slice(0, 4000),
  };
}

/** Consulta a NFS-e pela chave de acesso (50 dígitos). */
async function consultarNfse(chave, { homologacao = false } = {}) {
  const A = amb(homologacao);
  const r = await requisicao("GET", `${A.sefin}/nfse/${soDigitos(chave)}`);
  const json = lerJson(r.corpo);
  if (r.status === 200 && json && json.nfseXmlGZipB64) {
    const xml = deGzipB64(json.nfseXmlGZipB64);
    return { ok: true, ...resumoNFSe(xml), xml };
  }
  return { ok: false, httpStatus: r.status, erros: errosDe(json, r.status, r.corpo) };
}

/**
 * Conciliação: para cada {serie, numero}, pergunta se a DPS virou NFS-e
 * (GET /dps/{id} devolve a chave) e lê a nota. Formato de retorno igual ao
 * nfse_sp.consultarPorRPS.
 */
async function consultarPorDps(chaves, { homologacao = false } = {}) {
  const A = amb(homologacao);
  const cnpj = soDigitos(process.env.NFSE_SP_CNPJ || "41132782000108");
  if (!Array.isArray(chaves) || chaves.length === 0) return { sucesso: false, notas: [], erros: [] };
  if (chaves.length > 50) throw new Error("Máximo de 50 DPS por consulta.");

  const notas = [];
  const erros = [];
  for (const c of chaves) {
    const id = idDps({ cMun: COD_MUN_SP, cnpj, serie: soDigitos(c.serie), numero: soDigitos(c.numero) });
    try {
      const r = await requisicao("GET", `${A.sefin}/dps/${id}`);
      const json = lerJson(r.corpo);
      if (r.status === 404) continue; // DPS não virou nota
      const chave = json && (json.chaveAcesso || json.ChaveAcesso);
      if (r.status !== 200 || !chave) {
        erros.push({ codigo: `HTTP ${r.status}`, descricao: `${id}: ${errosDe(json, r.status, r.corpo)[0].descricao}` });
        continue;
      }
      const nf = await consultarNfse(chave, { homologacao });
      const ev = await requisicao("GET", `${A.sefin}/nfse/${chave}/eventos/101101`).catch(() => null);
      const cancelada = !!(ev && ev.status === 200);
      notas.push({
        serie: String(c.serie),
        numeroRps: String(c.numero),
        chaveAcesso: chave,
        numeroNota: nf.ok ? nf.numeroNota : null,
        codigoVerificacao: null,
        dataEmissao: nf.ok ? nf.dataProcessamento : null,
        status: cancelada ? "C" : "N",
        valorServicos: nf.ok ? nf.valor : null,
      });
    } catch (e) {
      erros.push({ codigo: "rede", descricao: `${id}: ${e.message}` });
    }
  }
  return { sucesso: erros.length === 0, notas, erros };
}

/**
 * PDF da nota (DANFSe). Tenta o oficial do ADN uma vez; ele responde 503 em
 * produção desde ago/2026, e aí o PDF é montado aqui a partir do XML
 * autorizado (danfse_local.js), com a marca CANCELADA se houver o evento.
 */
async function baixarDanfse(chave, { homologacao = false } = {}) {
  const A = amb(homologacao);
  const ch = soDigitos(chave);
  try {
    const r = await requisicao("GET", `${A.adn}/danfse/${ch}`, { aceitar: "application/pdf", timeoutMs: 10000 });
    if (r.status === 200 && r.corpo.slice(0, 4).toString() === "%PDF") return r.corpo;
  } catch {
    /* segue para o PDF local */
  }
  const nf = await consultarNfse(ch, { homologacao });
  if (!nf.ok) {
    throw new Error(`NFS-e não encontrada na Sefin (${(nf.erros && nf.erros[0] && nf.erros[0].descricao) || "HTTP " + nf.httpStatus}).`);
  }
  let cancelada = false;
  try {
    const ev = await requisicao("GET", `${A.sefin}/nfse/${ch}/eventos/101101`, { timeoutMs: 10000 });
    cancelada = ev.status === 200;
  } catch {
    /* sem a consulta de eventos, sai sem a marca */
  }
  return gerarDanfse(nf.xml, { cancelada });
}

/**
 * Documentos fiscais em que o CNPJ aparece (emitidas, recebidas, eventos),
 * a partir de um NSU. Serve para conferir notas feitas no Emissor web.
 */
async function distribuicaoDfe(nsu = 0, { homologacao = false } = {}) {
  const A = amb(homologacao);
  const cnpj = soDigitos(process.env.NFSE_SP_CNPJ || "41132782000108");
  const r = await requisicao(
    "GET",
    `${A.adn}/contribuintes/DFe/${Number(nsu) || 0}?cnpjConsulta=${cnpj}&lote=true`
  );
  const json = lerJson(r.corpo);
  if (!json) return { ok: false, httpStatus: r.status, corpo: r.corpo.toString("utf8").slice(0, 500) };
  const lote = json.LoteDFe || json.loteDFe || [];
  return {
    ok: r.status === 200,
    httpStatus: r.status,
    status: json.StatusProcessamento || json.statusProcessamento || null,
    erros: json.Erros || json.erros || null,
    documentos: lote.map((x) => {
      const b64 = x.ArquivoXml || x.arquivoXml;
      let xml = null;
      try {
        xml = b64 ? deGzipB64(b64) : null;
      } catch {
        xml = null;
      }
      return {
        nsu: x.NSU || x.nsu,
        chaveAcesso: x.ChaveAcesso || x.chaveAcesso,
        tipo: x.TipoDocumento || x.tipoDocumento,
        geradoEm: x.DataHoraGeracao || x.dataHoraGeracao,
        xml,
      };
    }),
  };
}

/** Parâmetros do município (convênio, alíquotas, regimes) — diagnóstico. */
async function parametrosMunicipais(caminho, { homologacao = false } = {}) {
  if (!/^[0-9]{7}(\/[0-9A-Za-z]{1,20}){1,2}$/.test(String(caminho))) {
    throw new Error("caminho inválido (ex.: 3550308/convenio ou 3550308/171201)");
  }
  const A = amb(homologacao);
  const tentativas = [
    `${A.sefin}/parametros_municipais/${caminho}`,
    `${A.adn}/parametrizacao/${caminho}`,
  ];
  const saida = [];
  for (const url of tentativas) {
    try {
      const r = await requisicao("GET", url);
      saida.push({ url, httpStatus: r.status, corpo: lerJson(r.corpo) || r.corpo.toString("utf8").slice(0, 1500) });
    } catch (e) {
      saida.push({ url, erro: e.message });
    }
  }
  return saida;
}

module.exports = {
  AMBIENTES,
  CTRIBNAC_POR_CODIGO_SP,
  textoNFSe,
  idDps,
  montarDps,
  assinarElemento,
  emitirNacional,
  consultarNfse,
  consultarPorDps,
  baixarDanfse,
  distribuicaoDfe,
  parametrosMunicipais,
  resumoNFSe,
};
