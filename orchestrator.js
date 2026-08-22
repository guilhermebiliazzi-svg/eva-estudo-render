/**
 * EVA · orchestrator do Estudo de Mercado.
 *
 * Caminho de dados:
 *   1. Linhas CRUAS do ITBI (vagas + aptos como rows separadas, vindas do db.js ou direto do body)
 *      — v2: linhas que o corretor mandou retirar (itbi_excluir, chaves "DD/MM/YYYY|UNIDADE")
 *        são filtradas AQUI, antes de qualquer agregação/valoração.
 *   2. agregação por data: apto + vagas do mesmo dia viram 1 transação consolidada (valor somado)
 *      — esse é o dado correto para AMBOS: valoração (âncora real) e tabela do slide 09
 *   3. valoração chamada com as linhas AGREGADAS (filtra vagas-only internamente; usa o apto + vagas)
 *      — v2: recebe também area_total (IPTU), area_util e tipo para o corte de UNIDADE IDÊNTICA
 *   4. generator recebe vendidos JÁ formatados (strings) — com flag `equivalente` nas linhas de
 *      área idêntica à avaliada — e o tipo/área para linguagem e painel de m².
 *
 * Por que aqui e não no generator? Porque o generator não sabe a origem dos dados; o orchestrator
 * conhece o pipeline e centraliza a regra metodológica.
 */
const { fetchVendidos, excluirVendidos } = require("./db");
const { vendidosFromRows, aggregateByDate } = require("./itbi_format");
const { buildValoracao } = require("./valoracao");
const { buildEstudo } = require("./estudo_generator");
const { buildDecisaoTempo } = require("./decisao_tempo");

async function gerarEstudo({ vendidosRows, imovel, corretor, amostras, estudo_data, ref, assets, out,
                             tipo, area_util, area_total, itbi_excluir,
                             condominio_mensal, iptu_anual, aluguel_mensal, reside, aluga, preco_alvo }) {
  let rawRows = Array.isArray(vendidosRows) ? vendidosRows : [];

  // (1b) exclusão pelo corretor (PASSO 3.5 da EVA) — no caminho "puro" (vendidosRows no body)
  //      o filtro ainda não foi aplicado pelo db.js, então aplica aqui. Idempotente.
  rawRows = excluirVendidos(rawRows, itbi_excluir);

  // (2) agrega por data: apto + vagas mesmo dia → 1 transação real
  const aggRows = aggregateByDate(rawRows);

  // (3) valoração sobre dados agregados — âncora vira "apto + vagas" (valor real)
  //     v2: com area_total, só vendas de unidade de ÁREA IDÊNTICA podem ancorar
  const valoracao = buildValoracao({
    vendidos: aggRows,
    amostras: Array.isArray(amostras) ? amostras : [],
    ref,
    opts: {
      area_total: area_total != null ? Number(area_total) : undefined,
      area_util:  area_util  != null ? Number(area_util)  : undefined,
      tipo,
    },
  });

  // (3b) decisão no tempo (passo E): valor competitivo (venda em ~3 meses) vs segurar 12/24 meses.
  const decisao_tempo = buildDecisaoTempo({
    piso:          valoracao?._debug?.faixa?.[0],
    valor_mercado: valoracao?._debug?.valor_mercado,
    i_anual: 0.139, // CDI (ago/2026). Atualizar quando a Selic mudar (ou puxar da série do BCB).
    condominio_mensal: Number(condominio_mensal) || 0,
    iptu_anual:        Number(iptu_anual) || 0,
    aluguel_mensal:    Number(aluguel_mensal) || 0,
    reside: reside === true || /^(sim|true|1|reside|mora)$/i.test(String(reside||"")),
    aluga:  aluga  === true || /^(sim|true|1|alugad)/i.test(String(aluga||"")) || Number(aluguel_mensal) > 0,
    preco_alvo: Number(preco_alvo) || null,
  });

  // (4) tabela do slide: formata as agregadas + marca as unidades idênticas (área IPTU exata)
  const vendidosFmt = vendidosFromRows(aggRows);
  const at = Number(area_total);
  if (at > 0) {
    aggRows.forEach((r, i) => {
      if (vendidosFmt[i] && Math.abs(Number(r.area_m2 || 0) - at) < 0.05) vendidosFmt[i].equivalente = true;
    });
  }

  return buildEstudo({
    imovel: imovel || {},
    corretor: corretor || {},
    amostras: Array.isArray(amostras) ? amostras : [],
    vendidos: vendidosFmt,
    valoracao,
    decisao_tempo,
    estudo_data: estudo_data || "",
    tipo: tipo || (imovel && imovel.tipo) || "",
    area_total: at > 0 ? at : undefined,
    area_util: Number(area_util) > 0 ? Number(area_util) : undefined,
  }, { assets, out });
}

async function gerarEstudoFromDB({ pool, buildingKey, imovel, corretor, amostras, estudo_data, ref, assets, out,
                                   tipo, area_util, area_total, itbi_excluir,
                                   condominio_mensal, iptu_anual, aluguel_mensal, reside, aluga, preco_alvo }) {
  if (!buildingKey) throw new Error("buildingKey ausente");
  if (!pool)        throw new Error("pool Postgres ausente");
  const rawRows = await fetchVendidos(pool, buildingKey, { excluir: itbi_excluir });
  return gerarEstudo({ vendidosRows: rawRows, imovel, corretor, amostras, estudo_data, ref, assets, out,
                       tipo, area_util, area_total, /* exclusão já aplicada no fetch; reaplicar é inócuo */
                       condominio_mensal, iptu_anual, aluguel_mensal, reside, aluga, preco_alvo });
}

module.exports = { gerarEstudo, gerarEstudoFromDB };
