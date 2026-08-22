/**
 * EVA · Decisão de precificação no tempo (passo E) — "Vender em 3 meses ou em 12/24?"
 *
 * Camada NOVA que roda EM CIMA da valoração (valoracao.js). Não altera a régua atual.
 * Responde às três perguntas que o proprietário faz:
 *   1) qual o PREÇO DE EQUILÍBRIO que aumenta a probabilidade de vender em ~3 meses (P3);
 *   2) quanto custa SEGURAR o imóvel por 12 ou 24 meses para tentar vender mais caro;
 *   3) qual a PERDA FINANCEIRA CAPITALIZADA se insistir num preço-alvo maior e demorar.
 *
 * MODELO (tudo capitalizado até o mês T, à taxa mensal i):
 *   custo de esperar(T) = P3·[(1+i)^T − 1]                      (custo de oportunidade do capital)
 *                       + custoCarregLiq·[(1+i)^T − 1]/i        (condô+IPTU acumulados, líquidos de aluguel)
 *   preço de equilíbrio(T) = P3 + custo de esperar(T)
 *   perda capitalizada(T | alvo) = preço de equilíbrio(T) − alvo   (>0 ⇒ prejuízo em segurar)
 *
 * REGRAS (decididas pelo Guilherme, 20/08/2026):
 *   - P3 = PISO DA FAIXA do estudo (venda mais ágil).
 *   - i  = CDI vigente (ago/2026 ≈ 13,90% a.a.), convertido para mensal; configurável/override.
 *   - custo de OPORTUNIDADE DO CAPITAL: SEMPRE aplica (inclusive se o proprietário reside).
 *   - custos de CARREGAMENTO (condô + IPTU/12): só entram se o imóvel está DESOCUPADO e SEM aluguel.
 *       · reside            → carregamento = 0 (usa o bem; só custo de capital)
 *       · alugado           → carregamento = (condô + IPTU/12) − aluguel   (aluguel abate)
 *       · desocupado s/ alug → carregamento = condô + IPTU/12               (custo cheio)
 *
 *   const { buildDecisaoTempo } = require("./decisao_tempo");
 *   data.decisao_tempo = buildDecisaoTempo({
 *     piso: 1150000, i_anual: 0.139,
 *     condominio_mensal: 1800, iptu_anual: 9600, aluguel_mensal: 0,
 *     reside: false, aluga: false, horizontes: [12, 24], preco_alvo: 1350000
 *   });
 */

// ---- formatação (mesma linguagem de valoracao.js) ----
const decs    = v => (v/1e6) < 10 ? 2 : 1;
const milhar  = n => String(Math.round(Math.abs(Number(n)))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const reaisN  = v => milhar(Math.round(Number(v)/1000)*1000) + ",00";
const reais   = v => "R$ " + reaisN(v);
const milhoes = v => Number(v) < 1e6 ? reais(v) : "R$ " + (v/1e6).toFixed(decs(v)).replace(".", ",") + " milhões";
const mi      = v => Number(v) < 1e6 ? reais(v) : "R$ " + (v/1e6).toFixed(decs(v)).replace(".", ",") + " mi";
const reaisEx = v => "R$ " + milhar(v) + ",00";                       // sem arredondar p/ milhar (custos)
const pctBR   = f => (f*100).toFixed(1).replace(".", ",") + "%";
const CDI_ANUAL_PADRAO = 0.139;                                       // ago/2026 · atualizar quando a Selic mudar

/**
 * @returns objeto do bloco "decisao_tempo" (strings prontas + _debug numérico), ou
 *          { aplicavel:false, motivo } quando não há piso (ex.: modo "global" da valoração).
 */
function buildDecisaoTempo({
  piso,                       // R$ numérico — P3 (piso da faixa)
  i_anual = CDI_ANUAL_PADRAO, // custo de oportunidade a.a. (CDI). Ignorado se i_mensal vier.
  i_mensal = null,            // override direto da taxa mensal (ex.: 0.0109)
  condominio_mensal = 0,
  iptu_anual = 0,
  aluguel_mensal = 0,
  reside = false,             // proprietário mora no imóvel
  aluga = false,              // imóvel gera renda de aluguel
  horizontes = [12, 24],      // meses adicionais (além do marco de 3m)
  preco_alvo = null,          // preço que o DONO quer segurar (informado pelo corretor)
  valor_mercado = null,       // fallback: preço médio de mercado do estudo (quando o dono não sabe o alvo)
  descontos_encalhe = [-0.05, -0.10], // cenários de "encalhou e baixou" (relativos ao piso)
  meses_rapida = 3,           // rótulo do cenário de venda ágil
} = {}) {

  const P3 = Number(piso);
  if (!(P3 > 0)) {
    return { aplicavel: false, motivo: "Sem piso de faixa definido (ex.: modo global da valoração) — seção de decisão no tempo não se aplica." };
  }

  // taxa mensal efetiva
  const im = (i_mensal != null && i_mensal > 0)
    ? Number(i_mensal)
    : Math.pow(1 + Number(i_anual), 1/12) - 1;
  const iaEff = Math.pow(1 + im, 12) - 1;   // anual efetiva coerente com a mensal usada

  // custo de carregamento mensal (condô + IPTU/12), líquido de aluguel, condicionado ao uso
  const custoBrutoMensal = Number(condominio_mensal) + Number(iptu_anual) / 12;
  let custoCarregMensal, regime;
  if (reside) {
    custoCarregMensal = 0;                                  regime = "reside";       // usa o bem; só capital
  } else if (aluga) {
    custoCarregMensal = custoBrutoMensal - Number(aluguel_mensal); regime = "alugado"; // aluguel abate
  } else {
    custoCarregMensal = custoBrutoMensal;                   regime = "desocupado";   // custo cheio
  }

  const fvCap = T => Math.pow(1 + im, T) - 1;               // fator de capitalização do capital
  const sfv   = T => (Math.pow(1 + im, T) - 1) / im;        // fator de anuidade futura (FV annuity)

  // Cenários de PREÇO REALMENTE FECHADO no futuro (a perda depende do que ele fecha, não do que sonha):
  //   perda capitalizada = preço de equilíbrio(T) − preço fechado.
  //   - "alvo": melhor caso, consegue o preço maior;
  //   - "piso": encalhou e voltou ao preço de venda rápida (perda = custo de esperar cheio);
  //   - descontos: encalhou e teve de vender ABAIXO do piso (perda ainda maior).
  // ALVO = preço que o dono quer segurar (informado pelo corretor);
  // se o dono não sabe, cai para o valor médio de mercado do estudo.
  const alvoEff = (preco_alvo != null && Number(preco_alvo) > 0)
    ? Number(preco_alvo)
    : ((valor_mercado != null && Number(valor_mercado) > 0) ? Number(valor_mercado) : null);
  const alvoOrigem = (preco_alvo != null && Number(preco_alvo) > 0) ? "informado_dono" : (alvoEff != null ? "media_mercado" : "nao_definido");

  const fechamentos = [];
  if (alvoEff != null) {
    const alvoTag = alvoOrigem === "informado_dono" ? "alvo do proprietário" : "preço médio de mercado";
    fechamentos.push({ key: "alvo", cenario: "otimista",
      label: `Vende pelo ${alvoTag} (${milhoes(alvoEff)})`, preco: alvoEff });
  }
  fechamentos.push({ key: "piso", cenario: "neutro",
    label: `Encalha e volta ao piso (${milhoes(P3)})`, preco: P3 });
  for (const d of descontos_encalhe) {
    const pf = P3 * (1 + d);
    fechamentos.push({ key: `enc${Math.round(Math.abs(d)*100)}`, cenario: "pessimista",
      label: `Encalha e fecha ${pctBR(Math.abs(d))} abaixo do piso (${milhoes(pf)})`, preco: pf });
  }

  const cenarios = horizontes.map(T => {
    // custo de esperar corre só sobre os MESES A MAIS além da venda rápida (T − meses_rapida):
    // vender em 3 meses vs em 12 = 9 meses extras; vs em 24 = 21 meses extras.
    const dt = Math.max(0, T - meses_rapida);
    const comp_capital = P3 * fvCap(dt);
    const comp_custos  = custoCarregMensal * sfv(dt);
    const custo_esperar = comp_capital + comp_custos;
    const preco_equilibrio = P3 + custo_esperar;
    const sobrepreco = custo_esperar / P3;                  // % acima do piso p/ empatar
    const perda = (alvoEff != null) ? (preco_equilibrio - alvoEff) : null;

    // matriz de sensibilidade: perda por preço realmente fechado
    // + VALOR PRESENTE (dinheiro de hoje) de cada estratégia de esperar:
    //   vp_esperar = P3 − perda_em_VF/(1+i)^T   (sempre ≤ P3 quando há perda ⇒ vender agora ganha)
    const disc = Math.pow(1 + im, dt);   // traz o preço futuro ao ponto da venda rápida (delta de meses)
    const perdas = fechamentos.map(f => {
      const valorFV = preco_equilibrio - f.preco;           // perda capitalizada (valor futuro), >0 ⇒ prejuízo
      const vp = P3 - valorFV / disc;                        // o que sobra, em dinheiro de HOJE
      return {
        key: f.key, cenario: f.cenario, label: f.label, preco: milhoes(f.preco),
        perda: valorFV > 0 ? milhoes(valorFV) : "sem perda",
        vp: milhoes(vp),                                     // valor presente da estratégia de esperar
        vp_vs_agora: milhoes(P3 - vp),                       // quanto a menos que vender agora (em R$ de hoje)
        _perda: Math.round(valorFV), _vp: Math.round(vp),
      };
    });

    return {
      perdas,
      meses: T,
      // strings prontas p/ o slide
      preco_equilibrio: milhoes(preco_equilibrio),
      custo_esperar: milhoes(custo_esperar),
      componente_capital: milhoes(comp_capital),
      componente_custos: (custoCarregMensal === 0) ? "—" : (comp_custos < 0 ? "−" + milhoes(-comp_custos) : milhoes(comp_custos)),
      sobrepreco_pct: pctBR(sobrepreco),
      perda_capitalizada: perda == null ? "" : (perda > 0 ? milhoes(perda) : "sem perda"),
      ganho_ao_esperar: (perda != null && perda < 0) ? milhoes(-perda) : "",
      veredito: perda == null
        ? `Para compensar segurar ${T} meses, o fechamento precisa passar de ${milhoes(preco_equilibrio)}.`
        : (perda > 0
            ? `Vender por ${milhoes(alvoEff)} em ${T} meses equivale a PERDER ${milhoes(perda)} frente a vender já por ${milhoes(P3)}.`
            : `Só compensa segurar ${T} meses se o alvo (${milhoes(alvoEff)}) for realista — nesse caso o ganho líquido é ~${milhoes(-perda)}.`),
      _n: { comp_capital, comp_custos, custo_esperar, preco_equilibrio, sobrepreco, perda },
    };
  });

  // texto-âncora do slide
  const alvoTxt = alvoEff != null
    ? ` O alvo considerado é ${milhoes(alvoEff)} (${alvoOrigem === "informado_dono" ? "preço do proprietário" : "preço médio de mercado"}) — só se paga se o mercado o absorver no prazo.`
    : "";
  const regimeTxt = regime === "reside"
    ? "Como o proprietário reside no imóvel, os custos de condomínio/IPTU não entram (uso do bem), mas o capital segue imobilizado — por isso o custo de oportunidade permanece."
    : regime === "alugado"
      ? "Como o imóvel gera aluguel, a renda abate os custos de carregamento no período."
      : "Imóvel desocupado e sem aluguel: condomínio e IPTU correm como custo cheio enquanto não vende, somados ao custo de oportunidade do capital.";

  return {
    aplicavel: true,
    regime,
    p3: milhoes(P3),
    p3_label: `piso da faixa · venda em ~${meses_rapida} meses`,
    vender_agora_vp: milhoes(P3),          // referência: vender agora = ter P3 em dinheiro de hoje (a maior barra)
    vender_agora_label: `Vender agora por ${milhoes(P3)} — e já com o dinheiro rendendo`,
    alvo: alvoEff != null ? milhoes(alvoEff) : "",
    alvo_origem: alvoOrigem,               // "informado_dono" | "media_mercado" | "nao_definido"
    alvo_label: alvoEff == null ? "" : (alvoOrigem === "informado_dono"
      ? `preço que o proprietário quer (${milhoes(alvoEff)})`
      : `preço médio de mercado do estudo (${milhoes(alvoEff)}) — proprietário sem alvo definido`),
    i_mensal_pct: pctBR(im),
    i_anual_pct: pctBR(iaEff),
    taxa_label: `custo de oportunidade ${pctBR(iaEff)} a.a. (CDI) · ${pctBR(im)} a.m.`,
    custo_carreg_mensal: custoCarregMensal > 0 ? reaisEx(Math.round(custoCarregMensal)) : (custoCarregMensal < 0 ? "renda líquida " + reaisEx(Math.round(-custoCarregMensal)) : "—"),
    custo_carreg_label: `condomínio ${reaisEx(Math.round(condominio_mensal))}/mês + IPTU ${reaisEx(Math.round(iptu_anual/12))}/mês${aluga ? ` − aluguel ${reaisEx(Math.round(aluguel_mensal))}/mês` : ""}`,
    regime_texto: regimeTxt,
    cenarios,
    chamada: `Vender por ${milhoes(P3)} em ~${meses_rapida} meses, ou segurar por um valor maior?` + alvoTxt,
    didatico:
      "Atenção: os valores de perda acima assumem que o imóvel É VENDIDO pelo preço maior no prazo. " +
      "Na prática, imóvel anunciado acima do mercado tende a encalhar — e quem encalha costuma baixar o preço para vender. " +
      "Nesse caso a perda não some: ela aumenta. Mesmo voltando ao preço de venda rápida depois de 12/24 meses, " +
      "o proprietário já perdeu todo o custo de esperar; se fechar abaixo do piso, a perda cresce na mesma proporção do desconto.",
    _debug: {
      regime, P3, im: +im.toFixed(6), i_anual_efetiva: +iaEff.toFixed(4),
      custo_carreg_mensal: Math.round(custoCarregMensal),
      cenarios: cenarios.map(c => ({ meses: c.meses, ...Object.fromEntries(Object.entries(c._n).map(([k,v]) => [k, v==null?null:Math.round(v)])) })),
    }
  };
}

module.exports = { buildDecisaoTempo, CDI_ANUAL_PADRAO };
