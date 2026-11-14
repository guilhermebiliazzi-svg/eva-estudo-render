// 14/11 · foto de capa dos anúncios comparáveis (estudo de apartamento/sala).
// Abre a página do anúncio, pega a og:image e baixa uma miniatura JPEG/PNG. No villejardins.com.br
// usa o otimizador de imagens do próprio site (640 px, ~35 KB). Sem foto, o cartão sai com "sem foto".
// Nunca derruba o estudo: qualquer falha só deixa o anúncio sem foto.

const VJ = /^https?:\/\/(www\.)?villejardins\.com\.br\//i;
const UA = "Mozilla/5.0 (compatible; REMAX-Ville-estudo)";

async function baixar(url, ms, accept) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept }, signal: ctl.signal, redirect: "follow" });
    if (!r.ok) return null;
    return r;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// largura × altura de um JPEG/PNG (para recortar a foto no cartão sem distorcer)
function dimensoes(b, tipo) {
  if (tipo === "png" && b.length > 24) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xFF) { i++; continue; }
    const mk = b[i + 1], len = b.readUInt16BE(i + 2);
    if (mk >= 0xC0 && mk <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(mk)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return { w: null, h: null };
}

const ogImage = html => {
  const m = html.match(/<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/i)
         || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::url)?["']/i);
  return m ? m[1].replace(/&amp;/g, "&") : null;
};

async function fotoDoAnuncio(link, ms = 8000) {
  if (!/^https?:\/\//i.test(String(link || ""))) return null;
  const pg = await baixar(link, ms, "text/html");
  if (!pg) return null;
  const html = await pg.text().catch(() => "");
  let img = ogImage(html);
  if (!img) return null;
  if (img.startsWith("/")) img = new URL(img, link).href;
  // villejardins: miniatura pelo otimizador do site (só aceita w=640/828 com q=70)
  const alvo = VJ.test(link) && !/\/_next\/image/.test(img)
    ? "https://www.villejardins.com.br/_next/image?url=" + encodeURIComponent(img) + "&w=640&q=70"
    : img;
  const r = await baixar(alvo, ms, "image/jpeg,image/png;q=0.9");
  if (!r) return null;
  const ct = String(r.headers.get("content-type") || "");
  const tipo = /jpe?g/i.test(ct) ? "jpeg" : /png/i.test(ct) ? "png" : null;
  if (!tipo) return null;                      // webp/avif: o PowerPoint antigo não abre
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length < 2000 || b.length > 450000) return null;
  const { w, h } = dimensoes(b, tipo);
  return { foto: `image/${tipo};base64,${b.toString("base64")}`, foto_w: w, foto_h: h };
}

/** Coloca `foto` nas amostras com link (até `max`, em paralelo). Altera a lista e devolve quantas ganharam foto. */
async function anexarFotos(amostras, { max = 12, ms = 8000 } = {}) {
  if (!Array.isArray(amostras)) return 0;
  const alvo = amostras.filter(a => a && a.link && !a.foto && a.tipo !== "avaliando").slice(0, max);
  const res = await Promise.all(alvo.map(a => fotoDoAnuncio(a.link, ms).catch(() => null)));
  let n = 0;
  res.forEach((f, i) => { if (f) { Object.assign(alvo[i], f); n++; } });
  return n;
}

module.exports = { anexarFotos, fotoDoAnuncio };
