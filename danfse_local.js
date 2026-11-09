/**
 * danfse_local.js — DANFSe (PDF da NFS-e) gerado a partir do XML oficial.
 *
 * O download oficial do ADN (GET /danfse/{chave}) responde HTTP 503 em
 * produção desde agosto/2026, o que outros integradores também registram.
 * Este módulo monta o documento auxiliar com os dados do XML autorizado
 * (consultado na Sefin com o certificado), no padrão de blocos do DANFSe.
 * A autenticidade se confere pela chave de acesso no portal nacional.
 */

const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const A4 = [595.28, 841.89];
const M = 28; // margem
const CINZA = rgb(0.92, 0.93, 0.95);
const LINHA = rgb(0.55, 0.58, 0.63);
const TEXTO = rgb(0.08, 0.1, 0.14);
const SUAVE = rgb(0.35, 0.38, 0.43);

/* ------------------------------------------------------------------ */
/* Leitura do XML                                                      */
/* ------------------------------------------------------------------ */

function bloco(xml, tag) {
  const m = String(xml || "").match(
    new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`)
  );
  return m ? m[1] : "";
}
function campo(xml, tag) {
  const v = bloco(xml, tag);
  return v
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Formatação                                                          */
/* ------------------------------------------------------------------ */

const dig = (v) => String(v || "").replace(/\D/g, "");

function fmtDoc(v) {
  const d = dig(v);
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return v || "";
}
function fmtCep(v) {
  const d = dig(v).padStart(8, "0");
  return d.length === 8 && Number(d) > 0 ? d.replace(/^(\d{5})(\d{3})$/, "$1-$2") : "";
}
function fmtFone(v) {
  const d = dig(v);
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2-$3");
  return v || "";
}
function fmtMoeda(v) {
  if (v === "" || v == null) return "-";
  const n = Number(v);
  if (!isFinite(n)) return String(v);
  return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtData(v) {
  const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v || "";
}
function fmtDataHora(v) {
  const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}:${m[6]}` : v || "";
}
function fmtTribNac(v) {
  const d = dig(v);
  return d.length === 6 ? d.replace(/^(\d{2})(\d{2})(\d{2})$/, "$1.$2.$3") : v || "";
}
function fmtChave(v) {
  return dig(v).replace(/(\d{4})(?=\d)/g, "$1 ");
}

const SIMPLES = {
  "1": "Não optante",
  "2": "Optante - Microempreendedor Individual (MEI)",
  "3": "Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)",
};
const REG_AP = {
  "1": "Tributos federais e municipal apurados pelo Simples Nacional",
  "2": "Federais pelo SN; ISSQN pela legislação municipal",
  "3": "Federais e municipal pelas respectivas legislações",
};
const TRIB_ISSQN = { "1": "Operação tributável", "2": "Imunidade", "3": "Exportação de serviço", "4": "Não incidência" };
const RET_ISSQN = { "1": "Não retido", "2": "Retido pelo tomador", "3": "Retido pelo intermediário" };

/* ------------------------------------------------------------------ */
/* Desenho                                                             */
/* ------------------------------------------------------------------ */

/** Helvetica só tem WinAnsi; o que não couber vira "?" em vez de quebrar. */
function seguro(fonte, t) {
  let out = "";
  for (const ch of String(t == null ? "" : t)) {
    if (ch === "\n" || ch === "\r" || ch === "\t") { out += " "; continue; }
    try {
      fonte.encodeText(ch);
      out += ch;
    } catch {
      const base = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      try {
        fonte.encodeText(base);
        out += base;
      } catch {
        out += "?";
      }
    }
  }
  return out;
}

function quebrar(fonte, texto, tamanho, largura) {
  const linhas = [];
  for (const paragrafo of String(texto || "").replace(/\r/g, "").split("\n")) {
    const palavras = seguro(fonte, paragrafo).split(/ +/);
    let atual = "";
    for (const p of palavras) {
      const tenta = atual ? atual + " " + p : p;
      if (fonte.widthOfTextAtSize(tenta, tamanho) <= largura) {
        atual = tenta;
      } else {
        if (atual) linhas.push(atual);
        // palavra maior que a linha: corta
        let resto = p;
        while (fonte.widthOfTextAtSize(resto, tamanho) > largura) {
          let i = resto.length;
          while (i > 1 && fonte.widthOfTextAtSize(resto.slice(0, i), tamanho) > largura) i--;
          linhas.push(resto.slice(0, i));
          resto = resto.slice(i);
        }
        atual = resto;
      }
    }
    linhas.push(atual);
  }
  return linhas;
}

/**
 * Gera o PDF.
 * @param {string} xml   XML da NFS-e (como devolvido por GET /nfse/{chave})
 * @param {object} op    { cancelada?: boolean }
 * @returns {Promise<Buffer>}
 */
async function gerarDanfse(xml, op = {}) {
  const inf = bloco(xml, "infNFSe");
  const dps = bloco(inf, "infDPS");
  const emit = bloco(inf, "emit");
  const endEmit = bloco(emit, "enderNac");
  const prest = bloco(dps, "prest");
  const toma = bloco(dps, "toma");
  const endToma = bloco(toma, "end");
  const valNfse = bloco(inf, "valores");
  const valDps = bloco(dps, "valores");
  const tribMun = bloco(valDps, "tribMun");

  const chave = (String(xml).match(/<infNFSe[^>]*\sId="NFS(\d+)"/) || [])[1] || "";
  const tpAmb = campo(dps, "tpAmb");

  const doc = await PDFDocument.create();
  doc.setTitle(`NFS-e ${campo(inf, "nNFSe")} - ${campo(emit, "xNome")}`);
  doc.setProducer("Painel REMAX Ville");
  const page = doc.addPage(A4);
  const F = await doc.embedFont(StandardFonts.Helvetica);
  const B = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = A4[0] - 2 * M;
  let y = A4[1] - M;

  const txt = (t, x, yy, { f = F, s = 8, c = TEXTO } = {}) =>
    page.drawText(seguro(f, t), { x, y: yy, size: s, font: f, color: c });

  const caixa = (altura) => {
    page.drawRectangle({ x: M, y: y - altura, width: W, height: altura, borderColor: LINHA, borderWidth: 0.6 });
  };

  /** Título cinza de bloco. */
  const titulo = (t) => {
    page.drawRectangle({ x: M, y: y - 13, width: W, height: 13, color: CINZA, borderColor: LINHA, borderWidth: 0.6 });
    txt(t, M + 5, y - 9.5, { f: B, s: 7.5 });
    y -= 13;
  };

  /**
   * Linha de campos rótulo/valor, em colunas de larguras relativas.
   * Cada campo: [rótulo, valor, peso]
   */
  const linhaCampos = (campos, { altura = 22 } = {}) => {
    const total = campos.reduce((a, c) => a + (c[2] || 1), 0);
    if (altura === "auto") {
      const maxLinhas = Math.max(
        ...campos.map(([, val, peso]) => quebrar(F, val || "-", 8, (W * (peso || 1)) / total - 8).length)
      );
      altura = 13 + maxLinhas * 9;
    }
    let x = M;
    caixa(altura);
    campos.forEach(([rot, val, peso], i) => {
      const w = (W * (peso || 1)) / total;
      if (i > 0) page.drawLine({ start: { x, y }, end: { x, y: y - altura }, thickness: 0.4, color: LINHA });
      txt(rot, x + 4, y - 8, { s: 6, c: SUAVE });
      const linhas = quebrar(F, val || "-", 8, w - 8);
      linhas.slice(0, Math.max(1, Math.floor((altura - 10) / 9))).forEach((l, k) => txt(l, x + 4, y - 17 - k * 9, { s: 8 }));
      x += w;
    });
    y -= altura;
  };

  /* ---------- cabeçalho ---------- */
  const hCab = 58;
  caixa(hCab);
  txt("DANFSe", M + 8, y - 22, { f: B, s: 18 });
  txt("Documento Auxiliar da NFS-e", M + 8, y - 34, { s: 8, c: SUAVE });
  txt("Nota Fiscal de Serviço eletrônica - Sistema Nacional", M + 8, y - 45, { s: 7, c: SUAVE });
  const xd = M + W * 0.52;
  page.drawLine({ start: { x: xd, y }, end: { x: xd, y: y - hCab }, thickness: 0.4, color: LINHA });
  txt("Número da NFS-e", xd + 6, y - 11, { s: 6, c: SUAVE });
  txt(campo(inf, "nNFSe"), xd + 6, y - 24, { f: B, s: 14 });
  txt("Competência", xd + 110, y - 11, { s: 6, c: SUAVE });
  txt(fmtData(campo(dps, "dCompet")), xd + 110, y - 22, { s: 8.5 });
  txt("Data e hora da emissão", xd + 6, y - 35, { s: 6, c: SUAVE });
  txt(fmtDataHora(campo(inf, "dhProc")), xd + 6, y - 45, { s: 8.5 });
  txt("Série / Nº da DPS", xd + 110, y - 35, { s: 6, c: SUAVE });
  txt(`${campo(dps, "serie")} / ${campo(dps, "nDPS")}`, xd + 110, y - 45, { s: 8.5 });
  y -= hCab;

  linhaCampos([["CHAVE DE ACESSO DA NFS-e", fmtChave(chave), 1]], { altura: 22 });
  if (tpAmb === "2") {
    linhaCampos([["AMBIENTE", "PRODUÇÃO RESTRITA - SEM VALOR FISCAL", 1]]);
  }
  y -= 6;

  /* ---------- prestador ---------- */
  titulo("PRESTADOR DO SERVIÇO / EMITENTE");
  linhaCampos([
    ["CNPJ / CPF", fmtDoc(campo(emit, "CNPJ") || campo(emit, "CPF")), 1],
    ["Inscrição municipal", campo(prest, "IM") || campo(emit, "IM"), 0.8],
    ["Telefone", fmtFone(campo(emit, "fone")), 0.8],
  ]);
  linhaCampos([
    ["Nome / Razão social", campo(emit, "xNome"), 1.6],
    ["E-mail", campo(emit, "email").toLowerCase(), 1],
  ]);
  linhaCampos([
    [
      "Endereço",
      [campo(endEmit, "xLgr"), campo(endEmit, "nro"), campo(endEmit, "xCpl"), campo(endEmit, "xBairro")]
        .filter(Boolean)
        .join(", "),
      1.6,
    ],
    ["Município", `${campo(inf, "xLocEmi")}${campo(endEmit, "UF") ? " - " + campo(endEmit, "UF") : ""}`, 0.7],
    ["CEP", fmtCep(campo(endEmit, "CEP")), 0.4],
  ]);
  linhaCampos([
    ["Simples Nacional na data de competência", SIMPLES[campo(prest, "opSimpNac")] || "-", 1],
    ["Regime de apuração tributária pelo SN", REG_AP[campo(prest, "regApTribSN")] || "-", 1],
  ]);
  y -= 6;

  /* ---------- tomador ---------- */
  titulo("TOMADOR DO SERVIÇO");
  linhaCampos([
    ["CNPJ / CPF", fmtDoc(campo(toma, "CNPJ") || campo(toma, "CPF")), 0.7],
    ["Nome / Razão social", campo(toma, "xNome"), 1.6],
  ]);
  const endT = [campo(endToma, "xLgr"), campo(endToma, "nro"), campo(endToma, "xCpl"), campo(endToma, "xBairro")]
    .filter(Boolean)
    .join(", ");
  linhaCampos([
    ["Endereço", endT || "-", 1.6],
    ["CEP", fmtCep(campo(endToma, "CEP")) || "-", 0.4],
    ["E-mail", campo(toma, "email") || "-", 0.9],
  ]);
  y -= 6;

  /* ---------- serviço ---------- */
  titulo("SERVIÇO PRESTADO");
  linhaCampos(
    [
      ["Código de tributação nacional", `${fmtTribNac(campo(dps, "cTribNac"))} - ${campo(inf, "xTribNac")}`, 1.5],
      ["Local da prestação", campo(inf, "xLocPrestacao"), 0.5],
    ],
    { altura: "auto" }
  );
  if (campo(dps, "cTribMun")) {
    linhaCampos([["Código de tributação municipal", `${campo(dps, "cTribMun")} - ${campo(inf, "xTribMun")}`, 1]], {
      altura: "auto",
    });
  }
  // descrição: altura conforme o texto
  const linhasDesc = quebrar(F, campo(dps, "xDescServ"), 8.5, W - 10);
  const hDesc = Math.min(14 + linhasDesc.length * 10.5 + 4, 260);
  caixa(hDesc);
  txt("Descrição do serviço", M + 4, y - 8, { s: 6, c: SUAVE });
  linhasDesc.slice(0, Math.floor((hDesc - 18) / 10.5)).forEach((l, k) => txt(l, M + 5, y - 19 - k * 10.5, { s: 8.5 }));
  y -= hDesc + 6;

  /* ---------- tributação municipal ---------- */
  titulo("TRIBUTAÇÃO MUNICIPAL (ISSQN)");
  linhaCampos([
    ["Tributação do ISSQN", TRIB_ISSQN[campo(tribMun, "tribISSQN")] || "-", 1],
    ["Município de incidência", campo(inf, "xLocIncid") || "-", 1],
    ["Retenção do ISSQN", RET_ISSQN[campo(tribMun, "tpRetISSQN")] || "-", 1],
  ]);
  y -= 6;

  /* ---------- valores ---------- */
  titulo("VALORES DA NFS-e");
  const vServ = campo(valDps, "vServ");
  const pAliq = campo(valNfse, "pAliqAplic") || campo(tribMun, "pAliq");
  linhaCampos([
    ["Valor do serviço", fmtMoeda(vServ), 1],
    ["Desconto incondicionado", fmtMoeda(campo(valDps, "vDescIncond") || "0"), 1],
    ["Base de cálculo do ISSQN", campo(valNfse, "vBC") ? fmtMoeda(campo(valNfse, "vBC")) : "-", 1],
    ["Alíquota aplicada", pAliq ? `${Number(pAliq).toFixed(2).replace(".", ",")}%` : "-", 0.8],
    ["ISSQN apurado", campo(valNfse, "vISSQN") ? fmtMoeda(campo(valNfse, "vISSQN")) : "-", 0.9],
  ]);
  caixa(26);
  txt("VALOR LÍQUIDO DA NFS-e", M + 6, y - 16, { f: B, s: 9 });
  const vLiq = fmtMoeda(campo(valNfse, "vLiq") || vServ);
  txt(vLiq, M + W - 6 - B.widthOfTextAtSize(seguro(B, vLiq), 13), y - 18, { f: B, s: 13 });
  y -= 26;
  if (campo(prest, "opSimpNac") === "3" && campo(prest, "regApTribSN") === "1") {
    y -= 4;
    txt(
      "Prestador optante pelo Simples Nacional: o ISSQN e os tributos federais são recolhidos no DAS.",
      M + 2,
      y - 8,
      { s: 7, c: SUAVE }
    );
    y -= 12;
  }

  /* ---------- rodapé ---------- */
  y -= 6;
  titulo("INFORMAÇÕES COMPLEMENTARES");
  const notas = [
    "Documento auxiliar gerado a partir do XML autorizado da NFS-e no Sistema Nacional (Ambiente Gerador: Sistema Próprio).",
    "A autenticidade pode ser conferida em https://www.nfse.gov.br/ConsultaPublica informando a chave de acesso acima.",
  ];
  const linhasN = notas.flatMap((n) => quebrar(F, n, 7.5, W - 10));
  caixa(8 + linhasN.length * 10);
  linhasN.forEach((l, k) => txt(l, M + 5, y - 11 - k * 10, { s: 7.5, c: SUAVE }));
  y -= 8 + linhasN.length * 10;

  if (op.cancelada) {
    page.drawText("CANCELADA", {
      x: 110,
      y: 330,
      size: 90,
      font: B,
      color: rgb(0.85, 0.1, 0.1),
      opacity: 0.25,
      rotate: { type: "degrees", angle: 35 },
    });
  }

  return Buffer.from(await doc.save());
}

module.exports = { gerarDanfse };
