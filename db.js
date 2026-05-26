/**
 * EVA · acesso ao Postgres/Supabase — busca os vendidos do mesmo prédio (query C1).
 * `pg` é carregado sob demanda pra não obrigar a dependência no caminho puro/teste.
 */
const SQL = `
WITH base AS (
  SELECT
    data_transacao::date            AS data,
    NULLIF(btrim(complemento), '')  AS unidade,
    area_construida::numeric        AS area_m2,
    valor_transacao::numeric        AS valor,
    valor_m2::numeric               AS valor_m2
  FROM vendidos_itbi_usados
  WHERE building_key = $1
    AND valor_transacao::numeric > 0
    AND area_construida::numeric  > 0
)
SELECT data, unidade, area_m2, valor, valor_m2,
       (data = max(data) OVER ()) AS is_ancora
FROM base
ORDER BY data ASC;`;

// pool = instância de pg.Pool ; buildingKey = 'LOGRADOURO|NUMERO|CEP'
async function fetchVendidos(pool, buildingKey) {
  const { rows } = await pool.query(SQL, [buildingKey]);
  return rows.map(r => ({
    data: r.data, unidade: r.unidade, area_m2: r.area_m2,
    valor: r.valor, valor_m2: r.valor_m2, is_ancora: r.is_ancora,
  }));
}

module.exports = { fetchVendidos, SQL };
