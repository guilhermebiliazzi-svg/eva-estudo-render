/**
 * EVA · Backfill de coordenada (geom) em vendidos_itbi_usados a partir do GeoSampa.
 *
 * Casa o sql_key (setor+quadra+lote) com a camada oficial geoportal:lote_cidadao (WFS),
 * pega o CENTROIDE do polígono do lote (EPSG:31983) e grava como ponto 4326 em `geom`.
 * Campos do GeoSampa: cd_setor_fiscal (3) · cd_quadra_fiscal (3) · cd_lote (4) -> sql_key.
 *
 * Roda EM LOTE por (setor, quadra): uma chamada WFS por quadra traz TODOS os lotes do
 * quarteirão de uma vez (muito menos requisições que 1-por-lote). Idempotente e resumível:
 * só processa quadras que ainda têm casas sem geom (geom IS NULL).
 *
 * Universo: casas de rua residenciais com terreno (o universo de comparáveis do Método 2).
 * Exposto via rota /backfill-geo (ver server.js) — chame repetido até restantes = 0.
 *
 * Requer Node 18+ (fetch global). Requer PostGIS habilitado e a coluna geom geometry(Point,4326).
 */

const WFS = "http://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/ows";
const COMP_FILTER = `descricao_uso LIKE 'RESID%' AND fracao_ideal = 1 AND area_terreno::numeric > 0`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// busca todos os lotes de uma quadra fiscal no GeoSampa (GeoJSON, EPSG:31983)
async function fetchQuadra(setor, quadra, { timeoutMs = 30000, tries = 4 } = {}) {
  const cql = `cd_setor_fiscal='${setor}' AND cd_quadra_fiscal='${quadra}'`;
  const url = `${WFS}?service=WFS&version=1.0.0&request=GetFeature&typeName=geoportal:lote_cidadao`
            + `&outputFormat=application/json&srsName=EPSG:31983&CQL_FILTER=${encodeURIComponent(cql)}`;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      return j.features || [];
    } catch (e) {
      if (attempt === tries) throw e;
      await sleep(1000 * attempt);
    }
  }
  return [];
}

// quantas quadras (setor+quadra) ainda têm casas sem geom
async function restantes(pool) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM (
       SELECT DISTINCT setor, quadra FROM vendidos_itbi_usados
       WHERE ${COMP_FILTER} AND geom IS NULL
     ) q`
  );
  return rows[0].n;
}

/**
 * Processa um lote de quadras. Retorna { processadas, carimbadas, restantes, erros }.
 * @param opts { limit=100, sleepMs=250 }
 */
async function runBackfillBatch(pool, opts = {}) {
  const limit   = opts.limit   ?? 100;
  const sleepMs = opts.sleepMs ?? 250;

  const { rows: quadras } = await pool.query(
    `SELECT DISTINCT setor, quadra FROM vendidos_itbi_usados
      WHERE ${COMP_FILTER} AND geom IS NULL
      ORDER BY setor, quadra
      LIMIT $1`, [limit]
  );

  let carimbadas = 0, erros = 0;
  for (const { setor, quadra } of quadras) {
    let feats;
    try { feats = await fetchQuadra(setor, quadra); }
    catch (e) { erros++; await sleep(sleepMs); continue; }

    for (const f of feats) {
      const p = f.properties || {};
      if (!p.cd_lote || !f.geometry) continue;
      const sqlKey = String(p.cd_setor_fiscal) + String(p.cd_quadra_fiscal) + String(p.cd_lote);
      try {
        const { rowCount } = await pool.query(
          `UPDATE vendidos_itbi_usados
              SET geom = ST_Transform(ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON($1), 31983)), 4326)
            WHERE sql_key = $2 AND geom IS NULL`,
          [JSON.stringify(f.geometry), sqlKey]
        );
        carimbadas += rowCount;
      } catch (e) { /* geometria inválida / sem casa correspondente — ignora */ }
    }
    await sleep(sleepMs);
  }

  return { processadas: quadras.length, carimbadas, erros, restantes: await restantes(pool) };
}

module.exports = { runBackfillBatch, restantes, fetchQuadra };
