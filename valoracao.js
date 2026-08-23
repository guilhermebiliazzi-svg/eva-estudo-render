/**
 * EVA · Função de valoração (passo D) — produz o bloco "valoracao" do contrato.
 *
 * v2 — UNIDADES IDÊNTICAS EM ÁREA + m² GLOBAL:
 *  - O corretor informa a ÁREA TOTAL do IPTU (mesma base do ITBI). Só vendas de
 *    unidades com área construída IDÊNTICA (match exato, tolerância numérica mínima)
 *    são comparáveis à unidade avaliada — unidades de tamanho diferente NÃO ancoram.
 *  - âncora = venda mais recente ENTRE AS UNIDADES IDÊNTICAS (modo "equivalente");
 *  - R$/m² das unidades idênticas calculado sobre a ÁREA ÚTIL informada (não a área ITBI);
 *  - R$/m² global do condomínio calculado aí sim sobre a área construída do ITBI;
 *  - sem venda idêntica (modo "global"): NÃO produz valor fechado da unidade — o estudo
 *    apresenta o m² global do condomínio (base ITBI) com aviso explícito;
 *  - sem area_total (modo "legado"): comportamento anterior preservado, intocado.
 *
 * Regras travadas mantidas:
 *  - teto por correção monetária = âncora corrigida pelo IPCA até hoje;
 *  - teto de concorrência = menor anúncio equivalente no mesmo prédio;
 *  - preço de anúncio sugerido = min(teto_concorrencia, teto_correcao)  [override possível];
 *  - fechamento esperado = anúncio × (1 − deságio);
 *  - valor de mercado e faixa derivados (arredondados p/ leitura).
 *
 * Roda sobre valores NUMÉRICOS (R$), não sobre as strings do contrato — na prática,
 * sobre as linhas AGREGADAS por data (apto + vagas do dia) que o orchestrator monta.
 *   const { buildValoracao } = require("./valoracao");
 *   data.valoracao = buildValoracao({ vendidos, amostras, ref: {ano:2026, mes:8},
 *                                     opts: { area_total: 98, area_util: 83, tipo: "sala" } });
 */

// IPCA anual (%) — atualizar / ou puxar do BCB série 433 (IPCA mensal).
const IPCA_ANUAL = { 2018:3.75, 2019:4.31, 2020:4.52, 2021:10.06, 2022:5.79, 2023:4.62, 2024:4.83, 2025:4.26 };
// Acumulado do ano corrente até o mês de referência (ex.: jan→abr/2026 = 2,60%).
const IPCA_YTD = { 2026: 2.60 };

const MESES = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];

// fator de correção do IPCA de (anoDe/mesDe) até (anoRef/mesRef)
function ipcaFactor(anoDe, mesDe, anoRef, mesRef){
  let f = Math.pow(1 + (IPCA_ANUAL[anoDe]||0)/100, (12 - mesDe)/12); // resto do ano da venda
  for (let y = anoDe + 1; y < anoRef; y++) f *= 1 + (IPCA_ANUAL[y]||0)/100;
  f *= 1 + (IPCA_YTD[anoRef]||0)/100; // parcial do ano de referência
  return f;
}

const roundTo = (v, step) => Math.round(v/step)*step;
const floorTo = (v, step) => Math.floor(v/step)*step;
const decs    = v => (v/1e6) < 10 ? 2 : 1;   // <R$10mi: 2 casas; senão 1
const milhar  = n => String(Math.round(Math.abs(Number(n)))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const reaisN  = v => milhar(Math.round(Number(v)/1000)*1000) + ",00"; // arredonda p/ milhar: "461.000,00"
const reais   = v => "R$ " + reaisN(v);                               // < R$1mi: "R$ 461.000,00"
const milhoes = v => Number(v) < 1e6 ? reais(v) : "R$ " + (v/1e6).toFixed(decs(v)).replace(".", ",") + " milhões";
const mi      = v => Number(v) < 1e6 ? reais(v) : "R$ " + (v/1e6).toFixed(decs(v)).replace(".", ",") + " mi";
const pct     = f => "+" + ((f-1)*100).toFixed(1).replace(".", ",") + "%";
const m2fmt   = v => "R$ " + milhar(Math.round(Number(v))) + "/m²";
const areaFmt = v => String(Number(v)).replace(".", ",");

function parseDataBR(d){ // "19/12/2023" ou Date/ISO -> {ano,mes}
  if (d instanceof Date) return { ano:d.getUTCFullYear(), mes:d.getUTCMonth()+1 };
  const m = String(d).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return { ano:+m[3], mes:+m[2] };
  const x = new Date(d); return { ano:x.getUTCFullYear(), mes:x.getUTCMonth()+1 };
}

// ===== v3 · ESTADO/REFORMA — custo de obra por m² (área útil), valores de hoje =====
// Calibração travada com o Guilherme (ago/2026): reforma completa/alto padrão não sai
// por menos de R$3.000/m². Depreciação LINEAR EM 10 ANOS (uso consome a reforma).
const CUSTO_REFORMA_M2 = { simples: 1400, media: 2300, completa: 3000 };
const DEPRECIACAO_ANOS = 10;

function ajusteEstado({ reforma_ano, reforma_padrao, estado, areaUtil, anoRef }){
  // retorna { valor, frase } — valor >0 (prêmio de reforma) ou <0 (desconto de estado original)
  if (!areaUtil) return { valor: 0, frase: "" };
  const padrao = String(reforma_padrao||"").toLowerCase();
  const custoM2 = CUSTO_REFORMA_M2[padrao] ?? null;
  const anoRf = Number(reforma_ano) || null;
  if (anoRf && custoM2) {
    const idade = Math.max(0, anoRef - anoRf);
    const fator = Math.max(0, 1 - idade/DEPRECIACAO_ANOS);
    if (fator <= 0) return { valor: 0, frase: "" };
    const premio = custoM2 * areaUtil * fator;
    return {
      valor: premio,
      frase: `Reforma ${padrao} (${anoRf}) incorporada: +${mi(premio)} — custo de obra ~R$ ${milhar(custoM2)}/m² sobre ${areaFmt(areaUtil)} m² úteis, depreciado pelo uso (${Math.round(fator*100)}% após ${idade} ano${idade===1?"":"s"}).`
    };
  }
  if (String(estado||"").toLowerCase() === "original") {
    // 10+ anos sem reforma / estado datado: comprador precifica a obra (60% do custo de atualização padrão médio)
    const desconto = CUSTO_REFORMA_M2.media * areaUtil * 0.6;
    return {
      valor: -desconto,
      frase: `Estado original/datado: desconto de ${mi(desconto)} (~60% do custo de atualização de R$ ${milhar(CUSTO_REFORMA_M2.media)}/m² sobre ${areaFmt(areaUtil)} m² úteis) — o comprador precifica a obra.`
    };
  }
  return { valor: 0, frase: "" }; // "bom"/conservado/sem info → estado típico da âncora (neutro)
}

function buildValoracao({ vendidos = [], amostras = [], ref, opts = {} }){
  const desagio   = opts.desagio ?? 0.05;   // pedido -> fechamento
  const hoje      = new Date();
  const anoRef    = ref?.ano ?? hoje.getFullYear();
  const mesRef    = ref?.mes ?? (hoje.getMonth()+1);
  const areaTotal = Number(opts.area_total) > 0 ? Number(opts.area_total) : null; // área IPTU/ITBI da unidade avaliada
  const areaUtil  = Number(opts.area_util)  > 0 ? Number(opts.area_util)  : null; // área útil informada

  // 1) vaga avulsa NUNCA compara nem ancora (uma vaga não precifica uma unidade).
  //    As vagas continuam no conjunto/tabela; só não entram na régua.
  const ehVagaAvulsa = v => {
    const u = String(v.unidade || "").trim();
    const a = Number(v.area_m2 ?? v.area ?? 0);
    return /^(VG|VAGA|BOX)\b/i.test(u) || (a > 0 && a < 30);
  };
  const unidades = vendidos.filter(v => !ehVagaAvulsa(v));
  const pool  = unidades.length ? unidades : vendidos; // fallback raro: só houver vaga
  // Guard: sem nada no pool → mensagem clara em vez de "Cannot read properties of undefined (reading 'valor')"
  if (!pool.length) {
    const err = new Error(
      "Nenhuma venda registrada no ITBI para este endereço. " +
      "Verifique se o número e CEP estão corretos, ou se o prédio existe na base ITBI consolidada."
    );
    err.code = "NO_ITBI_DATA";
    throw err;
  }

  // ===== v2 · UNIDADES IDÊNTICAS EM ÁREA (área construída ITBI === área total IPTU informada) =====
  const areaOf = v => Number(v.area_m2 ?? v.area ?? 0);
  const EPS = 0.05; // tolerância só para ruído de ponto flutuante — o match é exato (IPTU = ITBI)
  const equivalentes = areaTotal ? unidades.filter(v => Math.abs(areaOf(v) - areaTotal) < EPS) : [];
  // modo: "equivalente" (há venda de unidade idêntica) | "global" (área informada, sem idêntica) | "legado" (sem area_total)
  const modo = !areaTotal ? "legado" : (equivalentes.length ? "equivalente" : "global");

  const dKey  = v => parseDataBR(v.data).ano*12 + parseDataBR(v.data).mes;

  // ===== v2 · m² GLOBAL DO CONDOMÍNIO — base área construída ITBI (todas as unidades, sem vagas) =====
  const somaValor = unidades.reduce((s,v)=> s + Number(v.valor||0), 0);
  const somaArea  = unidades.reduce((s,v)=> s + areaOf(v), 0);
  const m2GlobalN = somaArea > 0 ? somaValor/somaArea : null;

  // ===== v2 · m² DAS UNIDADES IDÊNTICAS =====
  // sobre a ÁREA ÚTIL informada (planta idêntica ⇒ mesma área útil da avaliada) — NÃO sobre a área ITBI
  const m2EqUtilN = (modo === "equivalente" && areaUtil)
    ? equivalentes.reduce((s,v)=> s + Number(v.valor||0), 0) / (equivalentes.length * areaUtil)
    : null;
  // referência das idênticas na base ITBI (área total), para leitura lado a lado com o global
  const m2EqItbiN = (modo === "equivalente")
    ? equivalentes.reduce((s,v)=> s + Number(v.valor||0), 0) / (equivalentes.length * areaTotal)
    : null;

  const blocoM2 = {
    modo,
    area_total_ref: areaTotal,
    area_util_ref: areaUtil,
    equivalentes_qtd: equivalentes.length,
    m2_global: m2GlobalN != null ? m2fmt(m2GlobalN) : "",
    m2_global_label: "condomínio · área construída ITBI",
    m2_equivalente_util: m2EqUtilN != null ? m2fmt(m2EqUtilN) : "",
    m2_equivalente_util_label: (modo === "equivalente" && areaUtil)
      ? `unidades idênticas (${areaFmt(areaTotal)} m² IPTU) · sobre a área útil de ${areaFmt(areaUtil)} m²`
      : "",
    m2_equivalente_itbi: m2EqItbiN != null ? m2fmt(m2EqItbiN) : "",
  };

  // ===== v2 · MODO GLOBAL: sem venda de unidade idêntica → NÃO precifica a unidade =====
  if (modo === "global") {
    return {
      ...blocoM2,
      valor_mercado: "",
      faixa: "",
      anuncio_sugerido: "",
      anuncio_sub: "",
      aviso_sem_identica:
        `Nenhuma venda de unidade com ${areaFmt(areaTotal)} m² de área total (IPTU) registrada no ITBI deste condomínio. ` +
        `Unidades de tamanhos diferentes não são comparáveis entre si — por isso este estudo apresenta o valor do m² GLOBAL do condomínio ` +
        `(base: área construída do ITBI), e não um valor fechado para a unidade.`,
      conclusao_apoio:
        `Referência de leitura: m² global do condomínio (${m2GlobalN != null ? m2fmt(m2GlobalN) : "—"}) aplicado sobre a área total da unidade ` +
        `(${areaFmt(areaTotal)} m² IPTU). A precificação fechada depende de venda de unidade idêntica ou de análise complementar do corretor.`,
      _debug: {
        modo, area_total: areaTotal, area_util: areaUtil,
        m2_global: m2GlobalN != null ? Math.round(m2GlobalN) : null,
        vendas_consideradas: unidades.length,
      }
    };
  }

  // ===== âncora =====
  // modo "equivalente": SÓ a venda mais recente ENTRE AS UNIDADES IDÊNTICAS pode ancorar.
  // modo "legado": comportamento atual (is_ancora do SQL/agregação ou a mais recente do pool).
  const anchor = (modo === "equivalente")
    ? [...equivalentes].sort((a,b)=> dKey(b) - dKey(a))[0]
    : (pool.find(v => v.is_ancora === true || v.ancora === true) ||
       [...pool].sort((a,b)=> dKey(b) - dKey(a))[0]);
  const aV = Number(anchor.valor);
  const aD = parseDataBR(anchor.data);

  // passo de arredondamento adaptativo à magnitude — R$1mi não pode arredondar em R$0,5mi
  const passo = opts.passo ?? (aV < 3e6 ? 50e3 : aV < 8e6 ? 250e3 : 0.5e6);

  // 2) teto por correção monetária (IPCA)
  const fator = ipcaFactor(aD.ano, aD.mes, anoRef, mesRef);
  const tetoCorrecao = aV * fator;

  // 3) teto de concorrência = menor anúncio equivalente NO MESMO prédio
  const mesmoPredio = amostras.filter(a => a.tipo === "mesmo_predio" && Number(a.valor) > 0);
  const tetoConc = mesmoPredio.length ? Math.min(...mesmoPredio.map(a => Number(a.valor))) : Infinity;
  const concorrente = mesmoPredio.length
    ? mesmoPredio.reduce((m,a)=> Number(a.valor) < Number(m.valor) ? a : m)
    : null;

  // 4) preço de anúncio sugerido (base, estado típico)
  const anuncioBase = opts.anuncio_override ?? Math.min(tetoConc, tetoCorrecao);
  // quem realmente travou o preço: concorrência só limita se estiver <= teto de correção
  const limitadoPorConc = isFinite(tetoConc) && tetoConc <= tetoCorrecao;

  // 4b) v3 · ajuste de ESTADO/REFORMA sobre a base + travas de mercado (não descola)
  const estadoAdj = ajusteEstado({
    reforma_ano: opts.reforma_ano, reforma_padrao: opts.reforma_padrao,
    estado: opts.estado, areaUtil, anoRef,
  });
  // v3.1 · teto de mercado: menor PEDIDO entre anúncios de ÁREA SIMILAR (±10% da área útil).
  // Comparar preço ABSOLUTO com unidade menor derruba o valor indevidamente (ex.: 84 m² vs 92 m²).
  // Reformado pode encostar no menor pedido; caso contrário fica 5% abaixo dele.
  const areaNumDe = a => { const m = String(a.area ?? "").match(/[\d.,]+/); return m ? parseFloat(m[0].replace(",", ".")) : 0; };
  const similares = amostras.filter(a => {
    if (!(Number(a.valor) > 0) || a.tipo === "avaliando") return false;
    if (!areaUtil) return true;               // sem área útil: mantém comportamento amplo
    const ar = areaNumDe(a);
    return ar > 0 && Math.abs(ar - areaUtil) <= areaUtil * 0.10;
  });
  const pedidosAtivos = similares.map(a => Number(a.valor));
  const menorPedido   = pedidosAtivos.length ? Math.min(...pedidosAtivos) : Infinity;
  const capMercado    = isFinite(menorPedido) ? (estadoAdj.valor > 0 ? menorPedido : menorPedido * 0.95) : Infinity;
  const pisoSanidade  = anuncioBase * 0.8; // desconto de estado nunca derruba mais de 20% da base
  let   anuncio       = Math.max(pisoSanidade, Math.min(anuncioBase + estadoAdj.valor, capMercado));
  const travadoPorPedido = isFinite(capMercado) && (anuncioBase + estadoAdj.valor) > capMercado;

  // v3.1 · PISO PELAS VENDAS RECENTES: se unidades IDÊNTICAS fecharam nos últimos 12 meses,
  // o anúncio nunca cai abaixo da média das 2 mais recentes × 0,90 — fechamento real (ITBI)
  // é evidência mais forte que preço pedido de concorrente.
  const mesesDesde = v => { const d = parseDataBR(v.data); return (anoRef - d.ano) * 12 + (mesRef - d.mes); };
  const vendasRecentes = (modo === "equivalente")
    ? [...equivalentes].filter(v => mesesDesde(v) <= 12).sort((a,b) => dKey(b) - dKey(a)).slice(0, 2)
    : [];
  const pisoVendas = vendasRecentes.length
    ? (vendasRecentes.reduce((s,v) => s + Number(v.valor), 0) / vendasRecentes.length) * 0.90
    : 0;
  const elevadoPorVendas = pisoVendas > anuncio;
  anuncio = Math.max(anuncio, pisoVendas);

  // 5) fechamento, valor de mercado e faixa
  const fechamento  = anuncio * (1 - desagio);
  const valorMerc   = roundTo((fechamento + anuncio)/2, passo);
  const faixaMin    = floorTo(fechamento, passo);
  const faixaMax    = anuncio;

  // labels
  const vagasAnchor = (String(anchor.unidade||"").match(/(\d+)\s*vagas?/i)||[])[1]
                   || (String(anchor.unidade||"").match(/(\d+)\s*VG/i)||[])[1];
  const ancoraCurto = `${MESES[aD.mes-1]}/${aD.ano}`;
  const identicaTag = (modo === "equivalente") ? ` · unidade idêntica (${areaFmt(areaTotal)} m²)` : "";
  const ancoraFrase = (modo === "equivalente")
    ? `Ancorado na venda real de unidade IDÊNTICA em área (${areaFmt(areaTotal)} m² IPTU) do próprio prédio (ITBI)`
    : `Ancorado na venda real do próprio prédio (ITBI)`;

  return {
    ...blocoM2,
    concorrente_valor: concorrente ? milhoes(Number(concorrente.valor)) : milhoes(tetoCorrecao),
    concorrente_label: concorrente
      ? `unidade equivalente${concorrente.vagas?`, ${concorrente.vagas} vagas`:""}, já anunciada`
      : `teto pela correção monetária · IPCA ${pct(fator)}`,
    concorrente_origem: concorrente ? "anuncio" : "calculado",
    ancora_valor: milhoes(aV),
    ancora_label: `${ancoraCurto} · mesmo prédio${identicaTag}${vagasAnchor?` · ${vagasAnchor} vagas`:""}`,
    ancora_curto: ancoraCurto,
    ipca_pct: pct(fator),
    valor_mercado: milhoes(valorMerc),
    faixa: (faixaMin >= 1e6 && faixaMax >= 1e6)
      ? `R$ ${(faixaMin/1e6).toFixed(decs(faixaMin)).replace(".",",")} a ${(faixaMax/1e6).toFixed(decs(faixaMax)).replace(".",",")} milhões`
      : `${reais(faixaMin)} a ${reaisN(faixaMax)}`,
    anuncio_sugerido: milhoes(anuncio),
    anuncio_sub: `${limitadoPorConc ? "alinhado ao concorrente direto" : "ancorado no ITBI corrigido pelo IPCA"} · fechamento esperado ~${mi(fechamento)}`,
    conclusao_apoio: (limitadoPorConc
      ? `${ancoraFrase} e limitado pela unidade equivalente já anunciada no mesmo condomínio (${milhoes(tetoConc)}).`
      : (concorrente
          ? `${ancoraFrase} corrigida pelo IPCA (${pct(fator)}); a unidade equivalente anunciada no mesmo prédio (${milhoes(Number(concorrente.valor))}) está acima e serve só de teto de referência.`
          : `${ancoraFrase} corrigida pelo IPCA (${pct(fator)}); não há anúncio equivalente no prédio para calibrar o teto.`))
      + (estadoAdj.frase ? ` ${estadoAdj.frase}` : "")
      + (travadoPorPedido && !elevadoPorVendas ? ` Valor limitado pelo menor anúncio concorrente de área similar (${milhoes(menorPedido)}) para manter a competitividade.` : "")
      + (elevadoPorVendas ? ` Sustentado pelas vendas reais recentes de unidades idênticas (média das ${vendasRecentes.length === 1 ? "última" : "2 últimas"} × 0,90 = ${milhoes(pisoVendas)}) — fechamentos do ITBI valem mais que preços pedidos.` : ""),
    estado_frase: estadoAdj.frase,
    _debug: {
      modo, area_total: areaTotal, area_util: areaUtil, equivalentes: equivalentes.length,
      anchor: aV, fator: +fator.toFixed(4), teto_correcao: Math.round(tetoCorrecao),
      teto_concorrencia: isFinite(tetoConc)?tetoConc:null,
      anuncio_base: Math.round(anuncioBase),
      estado_ajuste: Math.round(estadoAdj.valor),
      menor_pedido_similar: isFinite(menorPedido)?menorPedido:null,
      amostras_similares: similares.length,
      travado_por_pedido: travadoPorPedido,
      piso_vendas: Math.round(pisoVendas),
      elevado_por_vendas: elevadoPorVendas,
      anuncio, fechamento: Math.round(fechamento),
      valor_mercado: valorMerc, faixa: [faixaMin, faixaMax],
      m2_global: m2GlobalN != null ? Math.round(m2GlobalN) : null,
      m2_equivalente_util: m2EqUtilN != null ? Math.round(m2EqUtilN) : null,
    }
  };
}

module.exports = { buildValoracao, ipcaFactor };
