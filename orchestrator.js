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
const { fetchVendidos, excluirVendidos, manterVendidos } = require("./db");
const { vendidosFromRows, aggregateByDate } = require("./itbi_format");
const { buildValoracao, areaIdentica } = require("./valoracao");
const { buildEstudo } = require("./estudo_generator");
const { buildDecisaoTempo } = require("./decisao_tempo");

async function gerarEstudo({ vendidosRows, imovel, corretor, amostras, estudo_data, ref, assets, out,
                             tipo, area_util, area_total, itbi_excluir, itbi_manter,
                             condominio_mensal, iptu_anual, aluguel_mensal, reside, aluga, preco_alvo,
                             reforma_ano, reforma_padrao, estado, mobilia_valor, vagas }) {
  let rawRows = Array.isArray(vendidosRows) ? vendidosRows : [];

  // (1b) curadoria do corretor (PASSO 3.5 da EVA) — v3: itbi_manter (lista de APROVADAS) tem
  //      precedência: o estudo usa SOMENTE o que o corretor viu e manteve. itbi_excluir continua
  //      aceito para compatibilidade. Idempotente nos dois caminhos.
  const asList = x => { if (Array.isArray(x)) return x;
    if (typeof x === "string" && x.trim().startsWith("[")) { try { return JSON.parse(x); } catch (e) { return []; } }
    return []; };
  const manterList = asList(itbi_manter);
  if (manterList.length) rawRows = manterVendidos(rawRows, manterList);
  else rawRows = excluirVendidos(rawRows, asList(itbi_excluir));

  // (2) agrega por data: apto + vagas mesmo dia → 1 transação real
  let aggRows = aggregateByDate(rawRows);

  // (2b) v3.9 (14/10) · VAGAS: compara igual com igual. Se a venda levou mais vagas (matrícula
  //      própria, linha separada no ITBI) do que o avaliado tem, a vaga a mais sai pelo valor que
  //      a própria transação declarou para ela. Caso Estudo 80 (Gaivota 665, ap sem vaga): todas
  //      as vendas do prédio eram "apto + 1 vaga" (vaga declarada R$ 85–111 mil) e entravam cheias.
  //      Vagas embutidas na matrícula do apto ("1DEP 2VG") não têm valor separado — ficam como estão.
  const vagasAval = (vagas === 0 || vagas === "0" || Number(vagas) > 0) ? Math.floor(Number(vagas)) : null;
  if (vagasAval != null) {
    aggRows = aggRows.map(r => {
      const q = Number(r.vagas_qtd || 0);
      if (!(q > vagasAval) || !(Number(r.valor_apto) > 0)) return r;
      const porVaga = Number(r.valor_vagas || 0) / q;
      const retirado = (q - vagasAval) * porVaga;
      const valor = Number(r.valor) - retirado;
      const base = String(r.unidade || "").replace(/\s*\+\s*\d+\s*vagas?$/i, "");
      return { ...r, valor, valor_m2: Number(r.area_m2) > 0 ? valor / Number(r.area_m2) : 0,
        unidade: vagasAval > 0 ? `${base} + ${vagasAval} vaga${vagasAval > 1 ? "s" : ""}` : `${base} (sem a vaga)`,
        valor_original: Number(r.valor), vaga_retirada_valor: retirado, vagas_retiradas: q - vagasAval };
    });
  }

  // (2c) v3.9 · amostras de tamanho incompatível NÃO entram no estudo (nem na tabela, nem na conta).
  //      Fora de ±30% da área útil não é comparável — 43 m² não se compara com 124 m².
  const numA = v => { const m = String(v ?? "").match(/\d+(?:[.,]\d+)?/); return m ? parseFloat(m[0].replace(",", ".")) : 0; };
  const au = Number(area_util) > 0 ? Number(area_util) : 0;
  let amostrasOk = Array.isArray(amostras) ? amostras : [];
  if (au > 0) {
    const fora = amostrasOk.filter(a => a && a.tipo !== "avaliando" && numA(a.area) > 0 && Math.abs(numA(a.area) - au) > au * 0.30);
    if (fora.length) console.log(`estudo: ${fora.length} amostra(s) descartada(s) por área incompatível com ${au} m²: ` + fora.map(a => a.area).join(", "));
    amostrasOk = amostrasOk.filter(a => !fora.includes(a));
    // avaliando salvo de OUTRO imóvel (área muito diferente) também sai
    amostrasOk = amostrasOk.filter(a => !(a && a.tipo === "avaliando" && numA(a.area) > 0 && Math.abs(numA(a.area) - au) > au * 0.15));
  }

  // (3) valoração sobre dados agregados — âncora vira "apto + vagas" (valor real)
  //     v2: com area_total, só vendas de unidade de ÁREA IDÊNTICA podem ancorar
  const valoracao = buildValoracao({
    vendidos: aggRows,
    amostras: amostrasOk,
    ref,
    opts: {
      area_total: area_total != null ? Number(area_total) : undefined,
      area_util:  area_util  != null ? Number(area_util)  : undefined,
      tipo,
      // v3 · estado/reforma (prêmio depreciado 10 anos / desconto p/ original) — ver valoracao.js
      reforma_ano:   reforma_ano   != null && reforma_ano   !== "" ? Number(reforma_ano) : undefined,
      reforma_padrao: reforma_padrao || undefined,
      estado:         estado || undefined,
      mobilia_valor:  Number(mobilia_valor) > 0 ? Number(mobilia_valor) : undefined,   // v3.6 porteira fechada
      vagas: vagasAval,
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
      if (vendidosFmt[i] && areaIdentica(Number(r.area_m2 || 0), at)) vendidosFmt[i].equivalente = true;
    });
  }

  return buildEstudo({
    imovel: imovel || {},
    corretor: corretor || {},
    amostras: amostrasOk,
    vendidos: vendidosFmt,
    vagas_retiradas: aggRows.some(r => r.vagas_retiradas > 0) ? vagasAval : null,
    valoracao,
    decisao_tempo,
    estudo_data: estudo_data || "",
    tipo: tipo || (imovel && imovel.tipo) || "",
    area_total: at > 0 ? at : undefined,
    area_util: Number(area_util) > 0 ? Number(area_util) : undefined,
  }, { assets, out });
}

async function gerarEstudoFromDB({ pool, buildingKey, imovel, corretor, amostras, estudo_data, ref, assets, out,
                                   tipo, area_util, area_total, itbi_excluir, itbi_manter,
                                   condominio_mensal, iptu_anual, aluguel_mensal, reside, aluga, preco_alvo,
                                   reforma_ano, reforma_padrao, estado, mobilia_valor, vagas }) {
  if (!buildingKey) throw new Error("buildingKey ausente");
  if (!pool)        throw new Error("pool Postgres ausente");
  const rawRows = await fetchVendidos(pool, buildingKey, { excluir: itbi_excluir });
  return gerarEstudo({ vendidosRows: rawRows, imovel, corretor, amostras, estudo_data, ref, assets, out,
                       tipo, area_util, area_total, itbi_manter, /* exclusão já aplicada no fetch */
                       condominio_mensal, iptu_anual, aluguel_mensal, reside, aluga, preco_alvo,
                       reforma_ano, reforma_padrao, estado, mobilia_valor, vagas });
}

module.exports = { gerarEstudo, gerarEstudoFromDB };
