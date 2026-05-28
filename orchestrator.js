/**
 * EVA · orchestrator do Estudo de Mercado.
 *
 * Caminho de dados:
 *   1. Linhas CRUAS do ITBI (vagas + aptos como rows separadas, vindas do db.js ou direto do body)
 *   2. agregação por data: apto + vagas do mesmo dia viram 1 transação consolidada (valor somado)
 *      — esse é o dado correto para AMBOS: valoração (âncora real) e tabela do slide 09
 *   3. valoração chamada com as linhas AGREGADAS (filtra vagas-only internamente; usa o apto + vagas)
 *   4. generator recebe vendidos JÁ formatados (strings) — não precisa fazer outra rodada de agregação
 *
 * Por que aqui e não no generator? Porque o generator não sabe a origem dos dados; o orchestrator
 * conhece o pipeline e centraliza a regra metodológica.
 */
const { fetchVendidos } = require("./db");
const { vendidosFromRows, aggregateByDate } = require("./itbi_format");
const { buildValoracao } = require("./valoracao");
const { buildEstudo } = require("./estudo_generator");

async function gerarEstudo({ vendidosRows, imovel, corretor, amostras, estudo_data, ref, assets, out }) {
  const rawRows = Array.isArray(vendidosRows) ? vendidosRows : [];

  // (2) agrega por data: apto + vagas mesmo dia → 1 transação real
  const aggRows = aggregateByDate(rawRows);

  // (3) valoração sobre dados agregados — âncora vira "apto + vagas" (valor real)
  const valoracao = buildValoracao({
    vendidos: aggRows,
    amostras: Array.isArray(amostras) ? amostras : [],
    ref,
  });

  // (4) tabela do slide: formata as agregadas
  const vendidosFmt = vendidosFromRows(aggRows);

  return buildEstudo({
    imovel: imovel || {},
    corretor: corretor || {},
    amostras: Array.isArray(amostras) ? amostras : [],
    vendidos: vendidosFmt,
    valoracao,
    estudo_data: estudo_data || "",
  }, { assets, out });
}

async function gerarEstudoFromDB({ pool, buildingKey, imovel, corretor, amostras, estudo_data, ref, assets, out }) {
  if (!buildingKey) throw new Error("buildingKey ausente");
  if (!pool)        throw new Error("pool Postgres ausente");
  const rawRows = await fetchVendidos(pool, buildingKey);
  return gerarEstudo({ vendidosRows: rawRows, imovel, corretor, amostras, estudo_data, ref, assets, out });
}

module.exports = { gerarEstudo, gerarEstudoFromDB };
