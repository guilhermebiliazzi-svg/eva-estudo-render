/**
 * EVA · Backfill de coordenada (geom) em vendidos_itbi_usados a partir do GeoSampa.
 *
 * Casa o sql_key (setor+quadra+lote) com a camada oficial geoportal:lote_cidadao (WFS),
 * pega o CENTROIDE do polígono do lote (EPSG:31983) e grava como ponto 4326 em `geom`.
 * Campos GeoSampa: cd_setor_fiscal (3) · cd_quadra_fiscal (3) · cd_lote (4) -> sql_key.
 *
 * EM LOTE por (setor, quadra): uma chamada WFS traz todos os lotes do quarteirão.
 * Idempotente e resumível (só processa quadras com casas sem geom).
 *
 * ROBUSTEZ: timeout curto e TETO DE TEMPO por chamada (maxSeconds) — a chamada HTTP
 * SEMPRE retorna em ~maxSeconds, nunca fica pendurada, mesmo se o GeoSampa estiver lento.
 * Chame /backfill-geo repetido até restantes = 0.
 *
 * Requer Node 18+ (fetch global), PostGIS, e a coluna geom geometry(Point,4326).
 */

const WFS = "http://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/ows";
const COMP_FILTER = `descricao_uso LIKE 'RESID%' AND fracao_ideal = 1 AND area_terreno::numeric > 0`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// busca os lotes de uma quadra fiscal (GeoJSON, EPSG:31983). Falha rápido: 1 tentativa, timeout curto.
async function fetchQuadra(setor, quadra, { timeoutMs = 10000 } = {}) {
  const cql = `cd_setor_fiscal='${setor}' AND cd_quadra_fiscal='${quadra}'`;
  const url = `${WFS}?service=WFS&version=1.0.0&request=GetFeature&typeName=geoportal:lote_cidadao`
            + `&outputFormat=application/json&srsName=EPSG:31983&CQL_FILTER=${encodeURIComponent(cql)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  return j.features || [];
}

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
 * Processa quadras até estourar o limite OU o teto de tempo. Sempre retorna rápido.
 * @param opts { limit=200, sleepMs=120, maxSeconds=20, timeoutMs=10000 }
 * @returns { processadas, carimbadas, erros, restantes, parou_por_tempo, amostra_erro }
 */
async function runBackfillBatch(pool, opts = {}) {
  const limit     = opts.limit     ?? 200;
  const sleepMs   = opts.sleepMs   ?? 120;
  const maxMs     = (opts.maxSeconds ?? 20) * 1000;
  const timeoutMs = opts.timeoutMs ?? 10000;
  const t0 = Date.now();

  const { rows: quadras } = await pool.query(
    `SELECT DISTINCT setor, quadra FROM vendidos_itbi_usados
      WHERE ${COMP_FILTER} AND geom IS NULL
      ORDER BY setor, quadra
      LIMIT $1`, [limit]
  );

  let processadas = 0, carimbadas = 0, erros = 0, amostraErro = null, parouPorTempo = false;
  for (const { setor, quadra } of quadras) {
    if (Date.now() - t0 > maxMs) { parouPorTempo = true; break; }
    processadas++;
    let feats;
    try { feats = await fetchQuadra(setor, quadra, { timeoutMs }); }
    catch (e) { erros++; if (!amostraErro) amostraErro = `${setor}/${quadra}: ${e.message}`; continue; }

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

  return { processadas, carimbadas, erros, restantes: await restantes(pool), parou_por_tempo: parouPorTempo, amostra_erro: amostraErro };
}

module.exports = { runBackfillBatch, restantes, fetchQuadra };
