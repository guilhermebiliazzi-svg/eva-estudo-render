/**
 * EVA · acesso ao Postgres/Supabase — comparáveis de CASA DE RUA / TERRENO (Método 2).
 *
 * Diferente de db.js (apartamento), aqui NÃO existe "mesmo prédio". O comparável é
 * geográfico: outras casas de rua vendidas perto do avaliando, medidas por R$/m² de
 * TERRENO (não de área construída). O valor da casa é puxado pelo terreno.
 *
 * Duas formas de pegar os comps, na mesma assinatura de saída:
 *   - fetchCompsByStreet : por logradouro + faixa de número (FUNCIONA HOJE, sem geo).
 *                          Bom em rua residencial densa; fraco em avenida longa.
 *   - fetchCompsByRadius : por raio geográfico real via ST_DWithin (DEPOIS do backfill
 *                          de coordenada — pega transversais). Drop-in: mesma saída.
 *
 * Saída (cada comp): { data, numero, area_terreno, area_construida, valor, rs_m2_terreno, dist }
 *   - rs_m2_terreno é recomputado em JS (valor/area_terreno) na valoração, pra não herdar
 *     o arredondamento do SQL. O campo aqui é só conveniência/debug.
 *   - `dist` = distância pro avaliando: nº de casas de diferença (street) ou metros (radius).
 *
 * Filtros travados (casa de rua de verdade):
 *   descricao_uso LIKE 'RESID%'  ·  fracao_ideal = 1 (lote inteiro, não unidade de condomínio)
 *   area_terreno > 0  ·  valor_transacao > 0  ·  janela de tempo (default 36 meses).
 */

// ---- Método 2 por logradouro + faixa de número (sem geo) ----
const SQL_STREET = `
SELECT
  data_transacao::date                                        AS data,
  logradouro,
  numero,
  area_terreno::numeric                                       AS area_terreno,
  area_construida::numeric                                    AS area_construida,
  valor_transacao::numeric                                    AS valor,
  round(valor_transacao::numeric / NULLIF(area_terreno::numeric, 0)) AS rs_m2_terreno,
  abs((numero::text)::int - $2::int)                          AS dist
FROM vendidos_itbi_usados
WHERE logradouro ILIKE '%' || $1 || '%'
  AND numero::text ~ '^[0-9]+$'
  AND (numero::text)::int BETWEEN ($2::int - $3::int) AND ($2::int + $3::int)
  AND descricao_uso  LIKE 'RESID%'
  AND fracao_ideal    = 1
  AND area_terreno::numeric    > 0
  AND valor_transacao::numeric > 0
  AND data_transacao >= (CURRENT_DATE - ($4::int || ' months')::interval)
ORDER BY abs((numero::text)::int - $2::int), data_transacao DESC
LIMIT $5;`;

// ---- Método 2 por raio geográfico real (após backfill de geom) ----
// $1 = ponto do avaliando (geometry/geography 4326), $2 = raio em METROS, $3 = janela meses, $4 = limit
const SQL_RADIUS = `
SELECT
  data_transacao::date                                        AS data,
  logradouro,
  numero,
  area_terreno::numeric                                       AS area_terreno,
  area_construida::numeric                                    AS area_construida,
  valor_transacao::numeric                                    AS valor,
  round(valor_transacao::numeric / NULLIF(area_terreno::numeric, 0)) AS rs_m2_terreno,
  round(ST_Distance(geom::geography, $1::geography))          AS dist
FROM vendidos_itbi_usados
WHERE geom IS NOT NULL
  AND ST_DWithin(geom::geography, $1::geography, $2::int)
  AND descricao_uso  LIKE 'RESID%'
  AND fracao_ideal    = 1
  AND area_terreno::numeric    > 0
  AND valor_transacao::numeric > 0
  AND data_transacao >= (CURRENT_DATE - ($3::int || ' months')::interval)
ORDER BY dist, data_transacao DESC
LIMIT $4;`;

// ---- v3.7 · CASA EM CONDOMÍNIO FECHADO: comps do PRÓPRIO condomínio (fração ideal < 1) ----
// A quota de terreno da unidade (terreno total × fração ideal) vem registrada no próprio ITBI
// como area_terreno — por isso o método do custo funciona igual: R$/m² de terreno-limpo sobre
// a quota. Janela maior (72 meses) porque um condomínio tem poucas vendas; o IPCA corrige.
// $1 = núcleo do logradouro · $2 = número do condomínio (exato) · $3 = janela meses · $4 = limit
const SQL_CONDO = `
SELECT
  data_transacao::date                                        AS data,
  logradouro,
  numero,
  NULLIF(btrim(complemento), '')                              AS unidade,
  area_terreno::numeric                                       AS area_terreno,
  area_construida::numeric                                    AS area_construida,
  valor_transacao::numeric                                    AS valor,
  round(valor_transacao::numeric / NULLIF(area_terreno::numeric, 0)) AS rs_m2_terreno,
  0                                                           AS dist
FROM vendidos_itbi_usados
WHERE logradouro ILIKE '%' || $1 || '%'
  AND regexp_replace(numero::text, '\\D', '', 'g') = regexp_replace($2::text, '\\D', '', 'g')
  AND descricao_uso  LIKE 'RESID%'
  AND fracao_ideal    < 1
  AND fracao_ideal    > 0
  AND area_terreno::numeric    > 0
  AND area_construida::numeric > 0
  AND valor_transacao::numeric > 0
  AND data_transacao >= (CURRENT_DATE - ($3::int || ' months')::interval)
ORDER BY data_transacao DESC
LIMIT $4;`;

const mapRow = r => ({
  data: r.data,
  logradouro: r.logradouro || null,
  numero: r.numero,
  unidade: r.unidade || null,   // casa em condomínio: complemento do ITBI (ex.: "CASA 12")
  area_terreno: Number(r.area_terreno),
  area_construida: r.area_construida == null ? null : Number(r.area_construida),
  valor: Number(r.valor),
  rs_m2_terreno: r.rs_m2_terreno == null ? null : Number(r.rs_m2_terreno),
  dist: r.dist == null ? null : Number(r.dist),
});

/**
 * Comps por logradouro + faixa de número. FUNCIONA SEM o backfill de coordenada.
 * @param rua   núcleo do logradouro em MAIÚSCULAS, sem acento, sem "Rua/Av/Alameda" (ex.: "TABAPUA")
 * @param numero número de referência do avaliando
 * @param opts  { raio=500, janelaMeses=36, limit=60 }
 */
async function fetchCompsByStreet(pool, rua, numero, opts = {}) {
  const raio        = opts.raio        ?? 500;
  const janelaMeses = opts.janelaMeses ?? 36;
  const limit       = opts.limit       ?? 60;
  const { rows } = await pool.query(SQL_STREET, [rua, numero, raio, janelaMeses, limit]);
  return rows.map(mapRow);
}

/**
 * Comps por raio geográfico real (ST_DWithin). Requer geom preenchido (backfill GeoSampa).
 * @param ponto WKT/EWKT do avaliando em 4326, ex.: 'SRID=4326;POINT(-46.63 -23.55)'
 * @param opts  { raioMetros=800, janelaMeses=36, limit=60 }
 */
async function fetchCompsByRadius(pool, ponto, opts = {}) {
  // RAIO DA BUSCA: ~800 m. Raio pequeno (ex.: 500 m) fica dominado pelo bolso de
  // alto padrão imediatamente vizinho (que infla a mediana); 700–900 m traz uma
  // amostra representativa do entorno. Piso 700, teto 1000.
  const raioMetros  = Math.min(Math.max(opts.raioMetros ?? 800, 700), 1000);
  const janelaMeses = opts.janelaMeses ?? 36;
  // LIMITE 120 (não 60): em bairro denso, 60 casas cabem em ~600 m — só o bolsão de
  // luxo vizinho. 120 alcança ~800-1000 m e traz casas de padrão normal, que diluem
  // a mediana. É o limite, não o raio, que define o quão longe a busca chega.
  const limit       = opts.limit       ?? 120;
  const { rows } = await pool.query(SQL_RADIUS, [ponto, raioMetros, janelaMeses, limit]);
  return rows.map(mapRow);
}

/**
 * v3.7 · Comps do PRÓPRIO condomínio fechado (fração ideal < 1) — casa em condomínio.
 * @param rua    núcleo do logradouro em MAIÚSCULAS, sem acento (ex.: "ANAPURUS")
 * @param numero número do condomínio (exato)
 * @param opts   { janelaMeses=72, limit=40 }
 */
async function fetchCompsByCondominio(pool, rua, numero, opts = {}) {
  const janelaMeses = opts.janelaMeses ?? 72;
  const limit       = opts.limit       ?? 40;
  const { rows } = await pool.query(SQL_CONDO, [rua, numero, janelaMeses, limit]);
  return rows.map(mapRow);
}

module.exports = { fetchCompsByStreet, fetchCompsByRadius, fetchCompsByCondominio, SQL_STREET, SQL_RADIUS, SQL_CONDO };
