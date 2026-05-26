/**
 * EVA · acesso ao Postgres/Supabase — busca os vendidos do mesmo prédio (query C1).
 * `pg` é carregado sob demanda pra não obrigar a dependência no caminho puro/teste.
 *
 * Filtros (NÃO comparar apê com vaga/box — senão a âncora cai numa vaga):
 *  - area_construida >= MIN_AREA_M2  → vagas/boxes (~20 m²) ficam de fora;
 *  - complemento não começa com VG / VAGA / BOX.
 * Âncora: exatamente UMA linha — a venda mais recente (desempate pelo maior valor),
 *  evitando o caso de várias transações na mesma data marcarem todas como âncora.
 */
const MIN_AREA_M2 = 30; // piso p/ excluir vaga/box; suba/baixe se o prédio tiver kitnets < 30 m²

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
    AND area_construida::numeric >= ${MIN_AREA_M2}
    AND ( complemento IS NULL
          OR btrim(complemento) !~* '^(VG|VAGA|BOX)([^A-Za-z]|$)' )
)
SELECT data, unidade, area_m2, valor, valor_m2,
       (ROW_NUMBER() OVER (ORDER BY data DESC, valor DESC) = 1) AS is_ancora
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
