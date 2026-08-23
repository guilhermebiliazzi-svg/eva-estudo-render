/**
 * EVA · Slide(s) "Decisão no tempo" para o Estudo de Mercado (pptxgenjs).
 *
 * Renderiza, na MESMA identidade do estudo (NAVY/RED/ICE, Georgia+Calibri):
 *   Slide A — faixa de recomendação + gráfico de barras horizontais "quanto sobra
 *             pra você em dinheiro de hoje" (vender agora = maior barra, verde);
 *   Slide B — matriz completa (dinheiro de hoje por cenário) + equilíbrio + método.
 *
 * É data-driven do objeto `data.decisao_tempo` produzido por buildDecisaoTempo().
 * Se não for aplicável (ex.: modo global da valoração), NÃO adiciona slides.
 *
 *   const { addDecisaoTempoSlides } = require("./decisao_tempo_slide");
 *   addDecisaoTempoSlides(p, data, { startNum: 12 });   // p = instância pptxgen
 *
 * Retorna quantos slides foram adicionados (0 ou 3), p/ o gerador renumerar o resto.
 */

const NAVY="10243F", RED="E4002B", ICE="CADCFC", WHITE="FFFFFF",
      INK="1A2332", MUTED="6B7280", LINE="E2E8F0", PAPER="FBFBFC",
      REDTINT="FCEFF1", ICETINT="EAF1FB",
      GREEN="157347", GREENTINT="E6F4EC", ROSE="E8677E";
const HEAD="Georgia", BODY="Calibri";
const MX=0.55;

function addDecisaoTempoSlides(p, data, opts={}){
  const dt = data && data.decisao_tempo;
  if (!dt || dt.aplicavel === false) return 0;
  const num = opts.num || 12;                 // número da seção no eyebrow
  const footerStart = opts.footerStart || 13; // nº da página do 1º slide da seção
  const unidade = (data.corretor && data.corretor.unidade) || "RE/MAX Ville";

  // ---- helpers de identidade (iguais ao estudo_generator) ----
  const SH=()=>({type:"outer",color:"000000",blur:9,offset:3,angle:135,opacity:0.13});
  function eyebrow(s,txt,y=0.42){
    s.addShape(p.shapes.RECTANGLE,{x:MX,y:y+0.02,w:0.13,h:0.13,fill:{color:RED},line:{type:"none"}});
    s.addText(String(txt).toUpperCase(),{x:MX+0.22,y:y-0.05,w:8,h:0.28,fontFace:BODY,fontSize:11,
      color:RED,bold:true,charSpacing:3,align:"left",valign:"middle",margin:0});
  }
  function title(s,txt,y=0.72,size=28){
    s.addText(txt,{x:MX,y:y,w:8.9,h:0.6,fontFace:HEAD,fontSize:size,color:NAVY,bold:true,align:"left",valign:"middle",margin:0});
  }
  function footer(s,n){
    s.addText(unidade+" · Estudo de Mercado",{x:MX,y:5.28,w:5,h:0.25,fontFace:BODY,fontSize:8.5,color:MUTED,align:"left",valign:"middle",margin:0});
    s.addText(String(n).padStart(2,"0"),{x:9.0,y:5.28,w:0.45,h:0.25,fontFace:BODY,fontSize:8.5,color:MUTED,align:"right",valign:"middle",margin:0});
  }

  const P3 = dt._debug && dt._debug.P3;
  const cenarios = Array.isArray(dt.cenarios) ? dt.cenarios : [];
  const alvoDono = dt.alvo_origem === "informado_dono";
  const alvoShort = alvoDono ? "atinge o preço do proprietário" : "atinge o valor potencial";

  // seleciona, por horizonte, o melhor caso (alvo) e o pior (último desconto)
  const pick = c => {
    const best = c.perdas.find(x=>x.key==="alvo") || c.perdas[0];
    const worst = c.perdas[c.perdas.length-1];
    return { best, worst };
  };
  // v2 · matemática honesta: se algum "melhor caso" supera vender agora, o slide não pode mentir
  const shown = cenarios.slice(0,2).flatMap(c=>{ const {best,worst}=pick(c); return [best,worst]; });
  const maxVp = Math.max(P3, ...shown.map(x=>x._vp||0));
  const holdBeats = shown.some(x=>(x._dvp||((x._vp||0)-P3)) > 0);   // melhor caso paga mais que vender agora
  const dstr = x => x.vp_vs_agora_signed || ((((x._vp||0)-P3)>=0?"+":"−") + x.vp_vs_agora);

  // ================= SLIDE A — CARDS "VENDER AGORA × ESPERAR MAIS" =================
  // 3 estratégias de preço, lado a lado: valor de venda EM CIMA, tempo médio de venda
  // esperado para aquele preço, e o equivalente em VALOR PRESENTE (base: venda em até
  // 3 meses) centralizado. Sem gráfico para interpretar.
  { const s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s, `${String(num).padStart(2,"0")} · Decisão no tempo`);
    s.addText([
      {text:"Tempo é dinheiro", options:{color:NAVY}},
      {text:" — e, dependendo de onde ele está, é o ", options:{color:NAVY}},
      {text:"seu", options:{color:RED, italic:true}},
      {text:" dinheiro indo embora.", options:{color:NAVY}},
    ],{x:MX,y:0.70,w:8.9,h:0.62,fontFace:HEAD,fontSize:22,bold:true,align:"left",valign:"middle",margin:0,lineSpacingMultiple:1.0});

    const D = dt._debug || {};
    const im = D.im || 0.011;
    const custoM = D.custo_carreg_mensal || 0;
    const mRap = D.meses_rapida || 3;
    const hzs = D.horizontes || [12, 24];
    const T12 = hzs[0] || 12, T24 = hzs[1] || 24;
    // régua dos cards: intermediário = competitivo +5%, superotimista = +15% (passo R$ 25 mil)
    const vInter = D.valor_intermediario || Math.round(P3 * 1.05 / 25e3) * 25e3;
    const vOtim  = D.valor_superotimista || Math.round(P3 * 1.15 / 25e3) * 25e3;
    const fmtCurto = v => { const a = Math.abs(Number(v)||0);
      return a >= 995e3 ? "R$ " + (a/1e6).toFixed(2).replace(/0$/,"").replace(".", ",") + " mi"
                        : "R$ " + Math.round(a/1e3) + " mil"; };
    // preço de venda: até 3 casas, sem zeros à direita (1,35 · 1,425 · 1,55)
    const fmtPreco = v => { const a = Math.abs(Number(v)||0);
      return a >= 995e3 ? "R$ " + (a/1e6).toFixed(3).replace(/0+$/,"").replace(/\.$/,"").replace(".", ",") + " mi"
                        : "R$ " + Math.round(a/1e3) + " mil"; };
    // valor presente de fechar por `preco` no mês T (base: venda rápida em mRap meses)
    const vpAt = (preco, T) => {
      const dtm = Math.max(0, T - mRap);
      const disc = Math.pow(1 + im, dtm);
      const pvCustos = custoM !== 0 ? custoM * ((1 - 1/disc) / im) : 0;
      return preco / disc - pvCustos;
    };
    const vp12 = vInter != null ? vpAt(vInter, T12) : null;
    const vp24 = vOtim  != null ? vpAt(vOtim,  T24) : null;
    const beats = [vp12, vp24].some(v => v != null && v > P3);

    // conceito, em uma frase
    const expY=1.36, expH=0.56;
    s.addShape(p.shapes.RECTANGLE,{x:MX,y:expY,w:8.9,h:expH,fill:{color:ICETINT},line:{type:"none"}});
    s.addText([
      {text:"A comparação justa é em VALOR PRESENTE:  ", options:{color:NAVY,bold:true}},
      {text:`receber daqui a ${T12} ou ${T24} meses vale menos que receber agora — enquanto espera, o dinheiro parado no imóvel deixa de render (${dt.i_anual_pct||"CDI"} ao ano)${custoM>0?" e os custos do imóvel correm":""}.`, options:{color:INK}},
    ],{x:MX+0.22,y:expY,w:8.5,h:expH,fontFace:BODY,fontSize:11,align:"left",valign:"middle",margin:0,lineSpacingMultiple:1.1});

    // ---- cards ----
    const cardY=2.04, cardH=2.72, gap=0.25, cardW=(8.9-2*gap)/3;
    const cardX = i => MX + i*(cardW+gap);

    // corpo comum: valor de venda em cima, tempo, e valor presente centralizado
    const cardCorpo = (x, {tag, tagColor, preco, tempoTxt, vp, isRef}) => {
      s.addText(tag,{x:x,y:cardY+0.14,w:cardW,h:0.22,fontFace:BODY,fontSize:11.5,color:tagColor,bold:true,charSpacing:1.5,align:"center",valign:"middle",margin:0});
      s.addText("VALOR DE VENDA",{x:x,y:cardY+0.38,w:cardW,h:0.15,fontFace:BODY,fontSize:8,color:MUTED,charSpacing:1.5,align:"center",valign:"middle",margin:0});
      s.addText(fmtPreco(preco),{x:x,y:cardY+0.53,w:cardW,h:0.46,fontFace:HEAD,fontSize:26,color:NAVY,bold:true,align:"center",valign:"middle",margin:0});
      s.addText(tempoTxt,{x:x,y:cardY+1.01,w:cardW,h:0.2,fontFace:BODY,fontSize:9,color:MUTED,align:"center",valign:"middle",margin:0});
      s.addShape(p.shapes.LINE,{x:x+0.35,y:cardY+1.28,w:cardW-0.7,h:0,line:{color:LINE,width:0.75}});
      s.addText("em valor presente (venda em até 3 meses)",{x:x,y:cardY+1.36,w:cardW,h:0.2,fontFace:BODY,fontSize:8.5,color:MUTED,align:"center",valign:"middle",margin:0});
      s.addText(fmtCurto(vp),{x:x,y:cardY+1.56,w:cardW,h:0.36,fontFace:HEAD,fontSize:19,color:(isRef?GREEN:NAVY),bold:true,align:"center",valign:"middle",margin:0});
    };

    // CARD 1 — VENDER AGORA (verde)
    { const x=cardX(0);
      s.addShape(p.shapes.ROUNDED_RECTANGLE,{x:x,y:cardY,w:cardW,h:cardH,fill:{color:GREENTINT},line:{color:GREEN,width:1.5},rectRadius:0.06,shadow:SH()});
      cardCorpo(x,{tag:"VENDER AGORA", tagColor:GREEN, preco:P3, tempoTxt:`80% de chance de vender em até ${mRap*2} meses`, vp:P3, isRef:true});
      s.addText("no seu bolso — garantido, e rendendo",{x:x,y:cardY+1.94,w:cardW,h:0.2,fontFace:BODY,fontSize:9,color:INK,align:"center",valign:"middle",margin:0});
      const chipW=1.9, chipTxt = beats ? "✓ MENOR RISCO" : "✓ MELHOR ESCOLHA";
      s.addShape(p.shapes.ROUNDED_RECTANGLE,{x:x+(cardW-chipW)/2,y:cardY+2.22,w:chipW,h:0.34,fill:{color:GREEN},line:{type:"none"},rectRadius:0.17});
      s.addText(chipTxt,{x:x+(cardW-chipW)/2,y:cardY+2.22,w:chipW,h:0.34,fontFace:BODY,fontSize:10.5,color:WHITE,bold:true,charSpacing:1,align:"center",valign:"middle",margin:0});
    }

    // CARDS 2 e 3 — esperar mais, por um preço maior
    const cardEspera = (i, {tag, preco, T, vp, tempoTxt}) => {
      const x=cardX(i);
      s.addShape(p.shapes.ROUNDED_RECTANGLE,{x:x,y:cardY,w:cardW,h:cardH,fill:{color:PAPER},line:{color:LINE,width:1},rectRadius:0.06,shadow:SH()});
      cardCorpo(x,{tag:tag, tagColor:NAVY, preco:preco, tempoTxt:tempoTxt, vp:vp});
      const dvp = vp - P3, pos = dvp > 0;
      s.addText([
        {text:(pos?"▲ ":"▼ ")+fmtCurto(dvp)+" ", options:{color:(pos?GREEN:RED),bold:true}},
        {text:(pos?"a mais":"a menos")+" que vender agora"+(pos?" (se fechar)":""), options:{color:MUTED}},
      ],{x:x,y:cardY+1.94,w:cardW,h:0.2,fontFace:BODY,fontSize:9.5,align:"center",valign:"middle",margin:0});
      const bandY=cardY+2.24, bandH=0.34;
      s.addShape(p.shapes.RECTANGLE,{x:x+0.1,y:bandY,w:cardW-0.2,h:bandH,fill:{color:REDTINT},line:{type:"none"}});
      s.addText([
        {text:"e depende de aparecer comprador ", options:{color:INK}},
        {text:"a esse preço", options:{color:RED,bold:true}},
      ],{x:x+0.16,y:bandY,w:cardW-0.32,h:bandH,fontFace:BODY,fontSize:8.5,align:"center",valign:"middle",margin:0});
    };
    if (vInter != null) cardEspera(1,{tag:"VALOR INTERMEDIÁRIO", preco:vInter, T:T12, vp:vp12, tempoTxt:`80% de chance de vender em mais de ${T12} meses`});
    if (vOtim  != null) cardEspera(2,{tag:"VALOR SUPEROTIMISTA", preco:vOtim, T:T24, vp:vp24, tempoTxt:`80% de chance de vender depois de ${T24} meses`});

    // faixa de recomendação (verde)
    const tY=4.88, tH=0.4;
    s.addShape(p.shapes.RECTANGLE,{x:MX,y:tY,w:8.9,h:tH,fill:{color:GREENTINT},line:{type:"none"}});
    s.addShape(p.shapes.RECTANGLE,{x:MX,y:tY,w:0.08,h:tH,fill:{color:GREEN},line:{type:"none"}});
    const bannerRuns = beats
      ? [
          {text:"Vender pelo valor competitivo é o caminho de MENOR RISCO. ",options:{color:GREEN,bold:true}},
          {text:"Esperar só compensa SE o fechamento realmente sair pelo preço maior — que o mercado ainda não pagou. Se encalhar, a perda é certa e cresce a cada mês.",options:{color:NAVY}},
        ]
      : [
          {text:"Vender pelo valor competitivo é o que deixa mais dinheiro no seu bolso. ",options:{color:GREEN,bold:true}},
          {text:"Mesmo vendendo mais caro lá na frente, o que entra vale menos em valor presente — e ainda depende de o comprador aparecer.",options:{color:NAVY}},
        ];
    s.addText(bannerRuns,{x:MX+0.25,y:tY,w:8.55,h:tH,fontFace:BODY,fontSize:10.5,align:"left",valign:"middle",margin:0,lineSpacingMultiple:1.02});

    footer(s, footerStart);
  }

  // ================= SLIDE B — MATRIZ COMPLETA =================
  { const s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s, "Decisão no tempo · a conta completa");
    title(s, "Dinheiro de hoje, cenário a cenário", 0.72, 24);

    const hdr=t=>({text:t,options:{fill:{color:NAVY},color:WHITE,bold:true,fontSize:11,align:(t==="Estratégia"?"left":"right"),valign:"middle"}});
    const cell=(t,o={})=>({text:String(t),options:{fontSize:11,color:INK,align:o.align||"right",valign:"middle",fill:o.fill,bold:o.bold,color:o.color||INK}});
    const head=["Estratégia","Valor de venda","Dinheiro de hoje","vs valor competitivo"].map(hdr);

    const rows=[];
    rows.push([
      cell("✓ Vender ao valor competitivo (até 3 meses)",{align:"left",bold:true,fill:{color:GREENTINT},color:GREEN}),
      cell(dt.p3,{fill:{color:GREENTINT},color:GREEN,bold:true}),
      cell(dt.vender_agora_vp,{fill:{color:GREENTINT},color:GREEN,bold:true}),
      cell("referência",{fill:{color:GREENTINT},color:GREEN}),
    ]);
    const shortByKey = k => k==="alvo" ? (alvoDono?"atinge o preço do proprietário":"atinge o valor potencial")
      : k==="piso" ? "volta ao valor competitivo" : k.replace(/^enc/,"encalha −")+"%";
    cenarios.forEach(c=>{
      c.perdas.forEach(pd=>{
        const pior = pd.key === c.perdas[c.perdas.length-1].key;
        const f = pior ? {color:REDTINT} : undefined;
        rows.push([
          cell(`Vender em ${c.meses}m — ${shortByKey(pd.key)}`,{align:"left",fill:f}),
          cell(pd.preco,{fill:f}),
          cell(pd.vp,{fill:f,bold:true}),
          cell((pd.vp_vs_agora_signed || "−"+pd.vp_vs_agora),
               {fill:f,color:((pd._dvp||0)>0 ? GREEN : RED),bold:pior}),
        ]);
      });
    });

    s.addTable([head,...rows],{x:MX,y:1.32,w:8.9,colW:[3.5,1.7,1.9,1.8],
      border:{type:"solid",color:LINE,pt:0.75},rowH:0.25,valign:"middle",fontFace:BODY,autoPage:false});

    // equilíbrio (abaixo da tabela)
    const eqs = cenarios.map(c=>`${c.meses}m: ${c.preco_equilibrio}`).join("  ·  ");
    s.addText([
      {text:"Para compensar esperar em vez de vender pelo valor competitivo, o fechamento precisaria passar de  ",options:{color:INK}},
      {text:eqs,options:{color:NAVY,bold:true}},
      {text:".",options:{color:INK}},
    ],{x:MX,y:4.16,w:8.9,h:0.26,fontFace:BODY,fontSize:10.5,align:"left",valign:"middle",margin:0});

    // AVISO DE ESTIMATIVAS + fatores fora de controle + competitividade
    const dbY=4.5, dbH=0.76;
    s.addShape(p.shapes.RECTANGLE,{x:MX,y:dbY,w:8.9,h:dbH,fill:{color:PAPER},line:{color:LINE,width:1}});
    s.addShape(p.shapes.RECTANGLE,{x:MX,y:dbY,w:0.09,h:dbH,fill:{color:RED},line:{type:"none"}});
    s.addText([
      {text:"IMPORTANTE — SÃO ESTIMATIVAS.  ",options:{color:RED,bold:true,charSpacing:0.5}},
      {text:"Os valores orientam a decisão de preço, mas as condições reais de venda dependem de fatores macro e microeconômicos fora do nosso controle: ",options:{color:INK}},
      {text:"oferta e demanda no momento, taxa de juros e crédito imobiliário, cenário político e eleições, inflação e câmbio, sazonalidade do mercado e mudanças regulatórias/tributárias",options:{color:NAVY,bold:true}},
      {text:".  Por isso o preço de anúncio precisa ser ",options:{color:INK}},
      {text:"competitivo desde o início",options:{color:RED,bold:true}},
      {text:" para viabilizar a venda em até 3 meses.",options:{color:INK}},
    ],{x:MX+0.28,y:dbY+0.08,w:8.5,h:dbH-0.16,fontFace:BODY,fontSize:10,align:"left",valign:"middle",margin:0,lineSpacingMultiple:1.12});

    footer(s, footerStart+1);
  }

  // ================= SLIDE C — MEMÓRIA DE CÁLCULO (prova dos números) =================
  { const s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s, "Decisão no tempo · memória de cálculo");
    title(s, "Despesas e valor capitalizado — a prova", 0.70, 23);

    const D = dt._debug || {};
    const im = D.im || 0.011;
    const custoM = D.custo_carreg_mensal || 0;
    const mRap = D.meses_rapida || 3;
    const hzs = D.horizontes || [12, 24];
    const T12 = hzs[0] || 12, T24 = hzs[1] || 24;
    const vInter = D.valor_intermediario || Math.round(P3 * 1.05 / 25e3) * 25e3;
    const vOtim  = D.valor_superotimista || Math.round(P3 * 1.15 / 25e3) * 25e3;
    const milharL = n => String(Math.round(Math.abs(Number(n)))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const rEx = v => (v < 0 ? "−R$ " : "R$ ") + milharL(v) + ",00";
    const fat = T => Math.pow(1 + im, Math.max(0, T - mRap));
    const sfvL = T => { const d = Math.max(0, T - mRap); return (Math.pow(1 + im, d) - 1) / im; };
    const pvDesp = T => { const f = fat(T); return custoM !== 0 ? custoM * ((1 - 1/f) / im) : 0; };
    const vpDe = (preco, T) => preco / fat(T) - pvDesp(T);
    const pctM = ((im * 100).toFixed(2)).replace(".", ",") + "% a.m.";

    s.addText([
      {text:"Base do cálculo:  ", options:{color:NAVY,bold:true}},
      {text:`custo de oportunidade ${dt.i_anual_pct||""} ao ano (CDI) = ${pctM} · marco da venda rápida: ${mRap} meses · `, options:{color:INK}},
      {text: custoM > 0 ? `despesas de ${rEx(custoM)}/mês (${dt.custo_carreg_label||"condomínio + IPTU"})`
            : (custoM < 0 ? `renda líquida de ${rEx(-custoM)}/mês (aluguel cobre os custos)`
            : (dt.regime === "reside" ? "condomínio e IPTU não entram — o proprietário usa o imóvel no período"
            : dt.regime === "alugado" ? "condomínio e IPTU cobertos pelo aluguel no período"
            : "condomínio e IPTU não informados — informe os valores para incluí-los no cálculo")), options:{color:INK}},
    ],{x:MX,y:1.26,w:8.9,h:0.34,fontFace:BODY,fontSize:10,align:"left",valign:"middle",margin:0,lineSpacingMultiple:1.05});

    const hdr = t => ({text:t,options:{fill:{color:NAVY},color:WHITE,bold:true,fontSize:10.5,align:(t?"right":"left"),valign:"middle"}});
    const cel = (t,o={}) => ({text:String(t),options:{fontSize:10.5,align:o.align||"right",valign:"middle",fill:o.fill,bold:o.bold,color:o.color||INK}});

    // ---- Tabela 1 · quanto custa esperar (capitalizado até o fechamento) ----
    s.addText("1 · QUANTO CUSTA ESPERAR — VALORES CAPITALIZADOS ATÉ O FECHAMENTO",
      {x:MX,y:1.64,w:8.9,h:0.22,fontFace:BODY,fontSize:9.5,color:RED,bold:true,charSpacing:1,align:"left",valign:"middle",margin:0});
    const capT = T => P3 * (fat(T) - 1);
    const despT = T => custoM * sfvL(T);
    const t1 = [
      [hdr(""), hdr(`vender em ${T12} meses (${T12-mRap} a mais)`), hdr(`vender em ${T24} meses (${T24-mRap} a mais)`)],
      [cel(`capital parado — ${rEx(P3)} deixando de render ${pctM}`,{align:"left"}), cel(rEx(capT(T12))), cel(rEx(capT(T24)))],
      [cel("despesas do período (condomínio + IPTU), capitalizadas",{align:"left"}), cel(custoM===0?"—":rEx(despT(T12))), cel(custoM===0?"—":rEx(despT(T24)))],
      [cel("custo total de esperar",{align:"left",bold:true,fill:{color:PAPER}}), cel(rEx(capT(T12)+despT(T12)),{bold:true,fill:{color:PAPER}}), cel(rEx(capT(T24)+despT(T24)),{bold:true,fill:{color:PAPER}})],
      [cel("preço de equilíbrio — só empata vendendo acima de",{align:"left",bold:true,fill:{color:REDTINT},color:RED}),
       cel(rEx(P3+capT(T12)+despT(T12)),{bold:true,fill:{color:REDTINT},color:RED}),
       cel(rEx(P3+capT(T24)+despT(T24)),{bold:true,fill:{color:REDTINT},color:RED})],
    ];
    s.addTable(t1,{x:MX,y:1.9,w:8.9,colW:[4.5,2.2,2.2],border:{type:"solid",color:LINE,pt:0.75},rowH:0.24,valign:"middle",fontFace:BODY,autoPage:false});

    // ---- Tabela 2 · prova dos cards: do valor de venda ao valor presente ----
    s.addText("2 · PROVA DOS CARDS — DO VALOR DE VENDA AO VALOR PRESENTE",
      {x:MX,y:3.30,w:8.9,h:0.22,fontFace:BODY,fontSize:9.5,color:RED,bold:true,charSpacing:1,align:"left",valign:"middle",margin:0});
    const f12 = fat(T12), f24 = fat(T24);
    const t2 = [
      [hdr(""), hdr(`valor intermediário (${T12} meses)`), hdr(`valor superotimista (${T24} meses)`)],
      [cel("valor de venda",{align:"left"}), cel(rEx(vInter)), cel(rEx(vOtim))],
      [cel(`fator do dinheiro no tempo — (1 + ${pctM.replace(" a.m.","")})^meses a mais`,{align:"left"}), cel("÷ " + f12.toFixed(4).replace(".", ",")), cel("÷ " + f24.toFixed(4).replace(".", ","))],
      ...(custoM !== 0 ? [[cel("(−) despesas do período, em valor presente",{align:"left"}), cel(rEx(-pvDesp(T12))), cel(rEx(-pvDesp(T24)))]] : []),
      [cel("valor presente (equivale a vender em até 3 meses por)",{align:"left",bold:true,fill:{color:PAPER}}), cel(rEx(vpDe(vInter,T12)),{bold:true,fill:{color:PAPER}}), cel(rEx(vpDe(vOtim,T24)),{bold:true,fill:{color:PAPER}})],
      [cel(`diferença vs vender agora por ${rEx(P3)}`,{align:"left",bold:true}),
       cel(rEx(vpDe(vInter,T12)-P3),{bold:true,color:(vpDe(vInter,T12)-P3>=0?GREEN:RED)}),
       cel(rEx(vpDe(vOtim,T24)-P3),{bold:true,color:(vpDe(vOtim,T24)-P3>=0?GREEN:RED)})],
    ];
    s.addTable(t2,{x:MX,y:3.56,w:8.9,colW:[4.5,2.2,2.2],border:{type:"solid",color:LINE,pt:0.75},rowH:0.24,valign:"middle",fontFace:BODY,autoPage:false});

    if (t2.length <= 5) s.addText("Leitura: o preço de equilíbrio mostra quanto o fechamento futuro precisaria superar para empatar com a venda rápida; o valor presente converte cada valor de venda para o equivalente em dinheiro de hoje, na mesma taxa.",
      {x:MX,y:3.56 + t2.length*0.28 + 0.06,w:8.9,h:0.24,fontFace:BODY,fontSize:8,color:MUTED,italic:true,align:"left",valign:"middle",margin:0,lineSpacingMultiple:1.05});

    footer(s, footerStart+2);
  }

  return 3;
}

module.exports = { addDecisaoTempoSlides };
