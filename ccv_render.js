/**
 * EVA · Render do CCV em HTML (espelha o parecer_render.js).
 * Recebe a saída do motor (com `documento_md`) e devolve um HTML pronto para
 * visualização/impressão, no estilo da casa. NÃO reescreve o texto jurídico:
 * apenas envolve as palavras exatas produzidas pelo motor em marcação HTML.
 */

const { LOGO } = require('./parecer_render'); // mesma logo RE/MAX Ville do parecer

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Aplica negrito/itálico inline sobre texto já escapado.
function inline(s) {
  let t = esc(s);
  t = t.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*])\*([^*]+?)\*(?!\*)/g, "$1<em>$2</em>");
  return t;
}

// Converte o documento_md (markdown leve do motor) em HTML, preservando o texto.
function corpoToHtml(md) {
  const blocos = String(md || "").replace(/\r\n/g, "\n").split(/\n{2,}/);
  const out = [];
  for (const raw of blocos) {
    const b = raw.trim();
    if (!b) continue;

    // Linha de assinatura (sublinhados) — sozinha no bloco
    if (/^_{5,}$/.test(b)) {
      out.push('<div class="sig"></div>');
      continue;
    }

    // Bloco de assinatura completo: linha de sublinhados + nome + cargo (quebras simples).
    // O motor às vezes emite tudo junto; aqui desmontamos para o layout correto.
    if (/^\s*(?:\d+\)\s*)?_{5,}\s*(?:\n|$)/.test(b) && b.indexOf("\n") !== -1) {
      const linhas = b.split("\n").map(x => x.trim()).filter(Boolean);
      out.push('<div class="sigblock">');
      out.push('<div class="sig"></div>');
      for (let k = 1; k < linhas.length; k++) {
        const L = linhas[k].replace(/^\*\*|\*\*$/g, "");
        const ehPapel = /^(Testemunha|Nome:|PARTE |Intermediador|Cônjuge)/i.test(L) || /Nome:\s*/.test(L);
        out.push('<p class="' + (k === 1 && !ehPapel ? "signame" : "sigrole") + '">' + inline(esc(L)) + "</p>");
      }
      out.push("</div>");
      continue;
    }

    // Assinatura com sublinhados e conteúdo na MESMA linha:
    //   "______ **NOME**\nPARTE VENDEDORA — CPF nº ..."  ou  "______ Testemunha 1 — Nome: ..."
    const mTest = b.match(/^\s*(?:\d+\)\s*)?_{5,}[ \t]*(.+)$/s);
    if (mTest) {
      const linhas = mTest[1].split("\n").map(x => x.trim()).filter(Boolean);
      out.push('<div class="sigblock">');
      out.push('<div class="sig"></div>');
      for (let k = 0; k < linhas.length; k++) {
        const bruto = linhas[k];
        // "**NOME** resto"  ->  nome em negrito + papel na linha seguinte
        const mNome = (k === 0) ? bruto.match(/^\*\*(.+?)\*\*[ \t]*(.*)$/) : null;
        if (mNome) {
          out.push('<p class="signame">' + inline(esc(mNome[1].trim())) + "</p>");
          if (mNome[2] && mNome[2].trim()) {
            out.push('<p class="sigrole">' + inline(esc(mNome[2].trim())) + "</p>");
          }
          continue;
        }
        out.push('<p class="sigrole">' + inline(esc(bruto.replace(/\*\*/g, ""))) + "</p>");
      }
      out.push("</div>");
      continue;
    }

    // Bloco que é só um trecho em negrito: título de cláusula OU nome de signatário
    const soNegrito = /^\*\*[^*]+\*\*$/.test(b);
    if (soNegrito) {
      const txt = b.replace(/^\*\*|\*\*$/g, "");
      const ehSecao = /^(\d+\.|Das Partes|Testemunhas)/.test(txt.trim());
      if (ehSecao) {
        out.push('<h3 class="cl">' + esc(txt) + "</h3>");
      } else {
        // nome de parte/intermediador/testemunha — centralizado sob a linha
        out.push('<p class="signame">' + esc(txt) + "</p>");
      }
      continue;
    }

    // Parágrafo comum (pode começar com rótulo em negrito, ex.: "**1.1. **...")
    const html = inline(b).replace(/\n/g, "<br>");
    out.push("<p>" + html + "</p>");
  }
  return out.join("\n");
}

const CSS = `:root{
  --navy:#0e2545; --ink:#1b2740; --muted:#5d6e89; --red:#d8222f;
  --line:#dde5f0; --paper:#fff; --bg:#eef2f8;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font-family:'Spectral',Georgia,'Times New Roman',serif;
  font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}
.sheet{max-width:820px;margin:28px auto;background:var(--paper);
  box-shadow:0 6px 28px rgba(14,37,69,.12);border-radius:4px;overflow:hidden}
.pad{padding:40px 60px 64px}
.lh{display:flex;justify-content:space-between;align-items:flex-start;
  padding:22px 60px;border-bottom:2px solid var(--navy)}
.mark{font-weight:700;font-size:20px;letter-spacing:.5px;color:var(--navy)}
.mark span{display:block;font-family:'Inter',-apple-system,'Segoe UI',sans-serif;
  font-weight:600;font-size:10px;letter-spacing:3px;color:var(--muted);margin-top:2px}
.lh .meta{text-align:right;font-size:11px;color:var(--muted);line-height:1.7}
.draft{display:flex;align-items:center;gap:12px;background:var(--navy);
  color:#fff;padding:11px 60px;font-size:13px;
  font-family:'Inter',-apple-system,'Segoe UI',sans-serif}
.draft .dot{width:9px;height:9px;border-radius:50%;background:var(--red);flex:none}
.cl{font-size:16px;color:var(--navy);font-weight:700;margin:26px 0 8px}
.pad p{margin:0 0 11px;text-align:justify;text-justify:inter-word}
.pad p strong{color:var(--ink)}
.sig{height:0;border-top:1px solid #111;width:62%;margin:26px 0 4px}
.signame{text-align:left;font-weight:700;margin:0 0 1px;text-transform:none}
.sigrole{text-align:left;margin:0 0 2px;font-size:13.5px;color:var(--muted)}
.sigblock{margin:0 0 22px;break-inside:avoid;page-break-inside:avoid}
.sigblock p{text-align:left !important;text-justify:auto !important;margin:0 0 2px}
@media print{body{background:#fff}.sheet{box-shadow:none;margin:0;max-width:none}}
`;

function renderCcvHTML(saida, fatos) {
  saida = saida || {};
  fatos = fatos || {};
  const rascunho = saida.status !== "aprovado";
  const imovel = (fatos.imovel || {});
  const endereco = imovel.endereco || "";
  const draft = rascunho
    ? `<div class="draft"><span class="dot"></span><b>RASCUNHO</b>&nbsp;— gerado automaticamente; aguarda revisão e liberação. Não é documento final até a aprovação.</div>`
    : "";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><style>${CSS}</style></head><body>
<div class="sheet">
  <div class="lh">
    <img src="${LOGO}" alt="RE/MAX Ville — CRECI J 37.196" style="height:72px;width:auto;display:block">
    <div class="meta"><b>Compromisso de Compra e Venda</b><br>${esc(endereco)}</div>
  </div>
  ${draft}
  <div class="pad">
    ${corpoToHtml(saida.documento_md)}
  </div>
</div></body></html>`;
}

module.exports = { renderCcvHTML };
