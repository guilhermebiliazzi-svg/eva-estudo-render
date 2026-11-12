/**
 * Identidade visual REMAX (Guia de Execução e Liderança de Marca — REMAX Brasil, V_OUT_26).
 * Fonte única de cores, tipografia e grafismos para os PowerPoints gerados aqui.
 *
 *  - Cores oficiais: Primary Red #FF1200, Bridge Blue #0C2749, Cream #F7F5EE, Primary Blue #0043FF,
 *    Dark Blue #000E35, Sky Blue #A3D4F2, Dark Charcoal Gray #232323 (p. 201).
 *  - Tipografia: Gotham (primária) / Montserrat (web). Em documento que circula como arquivo
 *    (PowerPoint aberto no computador ou celular do cliente) o próprio guia autoriza a Arial
 *    quando Gotham/Akzidenz não estão disponíveis (p. 202) — é a que usamos nos PPTX.
 *  - Barra REMAX: paralelogramo inclinado a 27,5° da vertical, cor sólida oficial (p. 209-210).
 *  - Escrita da marca: "REMAX" (sem a barra).
 */
const C = {
  NAVY: "0C2749",      // Bridge Blue
  RED: "FF1200",       // REMAX Primary Red
  CREAM: "F7F5EE",     // Cream
  WHITE: "FFFFFF",
  BLUE: "0043FF",      // REMAX Primary Blue
  DARKBLUE: "000E35",  // Dark Blue
  DARKRED: "660000",   // Dark Red
  BRIDGERED: "AA1120", // Bridge Red
  SKY: "A3D4F2",       // Sky Blue
  INK: "232323",       // Dark Charcoal Gray
  MUTED: "6B6B6B",
  LINE: "E2DFD6",
  // tintas de apoio (derivadas das oficiais, só para fundo de célula/destaque)
  SKYTINT: "E6F1FA",
  REDTINT: "FFE9E6",
  NAVYLINE: "23406B",  // filete sobre o Bridge Blue
  NAVYMUTED: "8EA3C2", // texto secundário sobre o Bridge Blue
};
const FONT = "Arial";
const TAN = Math.tan(27.5 * Math.PI / 180); // inclinação da Barra REMAX

/** "RE/MAX" -> "REMAX" (nome correto da marca). */
const marca = s => String(s == null ? "" : s).replace(/RE\s*\/\s*MAX/gi, "REMAX");

/**
 * Barra REMAX (paralelogramo "/"), x/y = canto superior esquerdo da caixa, h = altura,
 * w = espessura horizontal. Vetorial e editável no PowerPoint.
 */
function barra(p, s, { x, y, h, w, color = C.RED }) {
  const dx = h * TAN;
  s.addShape(p.shapes.CUSTOM_GEOMETRY || "custGeom", {
    x, y, w: dx + w, h,
    fill: { color }, line: { type: "none" },
    points: [
      { x: dx, y: 0 }, { x: dx + w, y: 0 }, { x: w, y: h }, { x: 0, y: h }, { close: true },
    ],
  });
  return dx + w; // largura total ocupada
}

/** Padrão com 3 barras (p. 210) — ritmo/direcionamento. */
function tresBarras(p, s, { x, y, h, w, gap, cores }) {
  const cs = cores || [C.NAVYLINE, "1C3A66", C.RED];
  let cx = x;
  cs.forEach(color => { barra(p, s, { x: cx, y, h, w, color }); cx += w + gap; });
}

module.exports = { C, FONT, TAN, marca, barra, tresBarras };
