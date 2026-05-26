-- =====================================================================
-- EVA · Estudo de Mercado — Camada de dados ITBI (passo C)
-- Validado contra a base real: retorna as 6 vendas do Marquise
-- (R$ 7,40 mi/2018 → R$ 13,80 mi/2023), âncora detectada sozinha.
--
-- Tabela no Supabase: vendidos_itbi_usados
-- building_key tem o formato 'LOGRADOURO|NUMERO|CEP'
--   ex.: 'R HERMANO RIBEIRO DA SILVA|155|4008080'
-- No n8n: node Postgres → "Query Parameters" preenche $1, $2, $3.
-- A saída crua vira o bloco "vendidos" do contrato via itbi_format.js.
-- =====================================================================


-- (C1) VENDIDOS DO MESMO PRÉDIO  — núcleo do estudo (camada N1)
-- $1 = building_key
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
SELECT
  data, unidade, area_m2, valor, valor_m2,
  (data = max(data) OVER ()) AS is_ancora   -- âncora = venda mais recente
FROM base
ORDER BY data ASC;


-- (C1b) Mesmo prédio A PARTIR DO ENDEREÇO (quando não se tem o building_key)
-- $1 = trecho do logradouro já normalizado (maiúsc., sem acento), ex.: 'HERMANO RIBEIRO'
-- $2 = numero, ex.: '155'
WITH base AS (
  SELECT
    data_transacao::date            AS data,
    NULLIF(btrim(complemento), '')  AS unidade,
    area_construida::numeric        AS area_m2,
    valor_transacao::numeric        AS valor,
    valor_m2::numeric               AS valor_m2
  FROM vendidos_itbi_usados
  WHERE logradouro ILIKE '%' || $1 || '%'
    AND numero::text = $2
    AND valor_transacao::numeric > 0
    AND area_construida::numeric  > 0
)
SELECT data, unidade, area_m2, valor, valor_m2,
       (data = max(data) OVER ()) AS is_ancora
FROM base
ORDER BY data ASC;


-- (C0) Resolver o building_key a partir do endereço (passo opcional anterior ao C1)
-- $1 = trecho do logradouro, $2 = numero
SELECT building_key, count(*) AS n_vendas
FROM vendidos_itbi_usados
WHERE logradouro ILIKE '%' || $1 || '%'
  AND numero::text = $2
GROUP BY building_key
ORDER BY n_vendas DESC;


-- (C2) VIZINHANÇA (camada N3) — comparáveis de PRÉDIOS DIFERENTES.
-- Usar como reforço quando o N1 (mesmo prédio) tem poucas vendas.
-- $1 = bairro (ex.: 'VILA MARIANA'),  $2 = área alvo em m² construída (ex.: 745),
-- $3 = building_key do avaliando (para excluí-lo)
SELECT
  logradouro, numero, NULLIF(btrim(complemento), '') AS unidade,
  data_transacao::date     AS data,
  area_construida::numeric AS area_m2,
  valor_transacao::numeric AS valor,
  valor_m2::numeric        AS valor_m2,
  building_key
FROM vendidos_itbi_usados
WHERE bairro ILIKE '%' || $1 || '%'
  AND area_construida::numeric BETWEEN $2 * 0.80 AND $2 * 1.20
  AND data_transacao::date >= current_date - interval '4 years'
  AND building_key <> $3
  AND valor_transacao::numeric > 0
ORDER BY data_transacao DESC
LIMIT 12;
