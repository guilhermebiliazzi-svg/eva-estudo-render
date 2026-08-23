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
 * Retorna quantos slides foram adicionados (0 ou 2), p/ o gerador renumerar o resto.
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

  // ================= SLIDE A — RECOMENDAÇÃO + GRÁFICO =================
  { const s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s, `${String(num).padStart(2,"0")} · Decisão no tempo`);
    title(s, "Vender agora ou segurar?");
    s.addText([
      {text:"Valor competitivo de mercado = venda em até 3 meses por ", options:{color:MUTED}},
      {text:dt.p3, options:{color:INK,bold:true}},
      {text:".  Segurar por mais custa os meses a mais (9 e 21).", options:{color:MUTED}},
    ],{x:MX,y:1.24,w:8.9,h:0.28,fontFace:BODY,fontSize:11.5,align:"left",valign:"middle",margin:0});

    // faixa de recomendação (verde)
    const tY=1.5, tH=0.56;
    s.addShape(p.shapes.RECTANGLE,{x:MX,y:tY,w:8.9,h:tH,fill:{color:GREENTINT},line:{type:"none"}});
    s.addShape(p.shapes.RECTANGLE,{x:MX,y:tY,w:0.08,h:tH,fill:{color:GREEN},line:{type:"none"}});
    s.addShape(p.shapes.OVAL,{x:MX+0.22,y:tY+0.15,w:0.26,h:0.26,fill:{color:GREEN},line:{type:"none"}});
    s.addText("✓",{x:MX+0.22,y:tY+0.15,w:0.26,h:0.26,fontFace:BODY,fontSize:13,color:WHITE,bold:true,align:"center",valign:"middle",margin:0});
    const bannerRuns = holdBeats
      ? [
          {text:"Vender pelo valor competitivo é o caminho de MENOR RISCO. ",options:{color:GREEN,bold:true}},
          {text:`Segurar só compensa SE o fechamento realmente sair pelo ${alvoDono?"preço do proprietário":"valor potencial"} — um preço que o mercado ainda não pagou. Se encalhar, a perda é certa e cresce a cada mês.`,options:{color:NAVY}},
        ]
      : [
          {text:"Vender pelo valor competitivo é o que deixa mais dinheiro no seu bolso. ",options:{color:GREEN,bold:true}},
          {text:"Segurar para tentar um valor maior entrega menos — mesmo no melhor cenário — porque o dinheiro deixa de render e os custos correm.",options:{color:NAVY}},
        ];
    s.addText(bannerRuns,{x:MX+0.62,y:tY,w:8.15,h:tH,fontFace:BODY,fontSize:12,align:"left",valign:"middle",margin:0,lineSpacingMultiple:1.05});

    // ---- gráfico ----
    s.addText(holdBeats
      ? "O QUE SOBRA PRA VOCÊ, EM DINHEIRO DE HOJE  ·  BARRAS ROSAS DEPENDEM DE FECHAR O PREÇO"
      : "O QUE SOBRA PRA VOCÊ, EM DINHEIRO DE HOJE  ·  BARRA MAIOR = MELHOR ESCOLHA",
      {x:MX,y:2.2,w:8.9,h:0.26,fontFace:BODY,fontSize:10,color:NAVY,bold:true,charSpacing:1.2,align:"left",valign:"middle",margin:0});

    const labX=MX, labW=2.35;          // rótulo (dir.)
    const barX=3.05, maxW=5.05;        // barras
    const barH=0.28;
    const scale = v => Math.max(0.04, Math.min(maxW, maxW * (v / maxVp)));

    function bar(y, {vpNum, vpStr, labelMain, labelSub, fill, delta, badge}){
      // rótulo à direita
      s.addText([
        {text:labelMain, options:{bold:true, color:(fill===GREEN?GREEN:NAVY), breakLine:true}},
        {text:labelSub||"", options:{color:INK}},
      ],{x:labX,y:y-0.03,w:labW,h:barH+0.06,fontFace:BODY,fontSize:9.5,align:"right",valign:"middle",margin:0,lineSpacingMultiple:0.95});
      // barra
      const w=scale(vpNum);
      s.addShape(p.shapes.RECTANGLE,{x:barX,y:y,w:w,h:barH,fill:{color:fill},line:{type:"none"}});
      s.addText(vpStr,{x:barX,y:y,w:w-0.1,h:barH,fontFace:BODY,fontSize:12,color:WHITE,bold:true,align:"right",valign:"middle",margin:0});
      // delta ou selo
      if (badge){
        s.addShape(p.shapes.ROUNDED_RECTANGLE,{x:barX+w+0.1,y:y+0.02,w:1.35,h:barH-0.04,fill:{color:GREEN},line:{type:"none"},rectRadius:0.11});
        s.addText(badge,{x:barX+w+0.1,y:y+0.02,w:1.35,h:barH-0.04,fontFace:BODY,fontSize:9,color:WHITE,bold:true,charSpacing:1,align:"center",valign:"middle",margin:0});
      } else if (delta){
        const dc = delta.startsWith("+") ? GREEN : MUTED;
        s.addText(delta,{x:barX+w+0.1,y:y,w:1.4,h:barH,fontFace:BODY,fontSize:10.5,color:dc,bold:true,align:"left",valign:"middle",margin:0});
      }
    }
    function grouplab(y, txt){
      s.addText(txt.toUpperCase(),{x:barX,y:y,w:maxW+1.4,h:0.2,fontFace:BODY,fontSize:9,color:MUTED,bold:true,charSpacing:1,align:"left",valign:"middle",margin:0});
    }

    // vender agora (verde) — selo honesto: melhor opção OU menor risco
    bar(2.5, {vpNum:P3, vpStr:dt.vender_agora_vp, labelMain:"VALOR COMPETITIVO", labelSub:`venda em até 3 meses · ${dt.p3}`, fill:GREEN, badge: holdBeats ? "MENOR RISCO" : "MELHOR OPÇÃO"});

    let y=2.98;
    cenarios.slice(0,2).forEach((c,i)=>{
      const mesesMais = c.meses - 3;
      grouplab(y, `Segurar ${c.meses} meses (${mesesMais} a mais) para tentar um preço maior`);
      y+=0.24;
      const {best,worst}=pick(c);
      const bestExtra = ((best._dvp||0) > 0) ? " (se fechar)" : "";
      bar(y, {vpNum:best._vp, vpStr:best.vp, labelMain:`melhor caso — ${alvoShort}${bestExtra}`, labelSub:best.preco, fill:ROSE, delta:dstr(best)});
      y+=0.4;
      bar(y, {vpNum:worst._vp, vpStr:worst.vp, labelMain:"se encalhar e baixar 10%", labelSub:worst.preco, fill:RED, delta:dstr(worst)});
      y+=0.46;
    });

    // eixo
    s.addShape(p.shapes.LINE,{x:barX,y:y-0.04,w:maxW,h:0,line:{color:LINE,width:1}});
    s.addText("R$ 0",{x:barX,y:y,w:0.6,h:0.2,fontFace:BODY,fontSize:9,color:MUTED,align:"left",valign:"middle",margin:0});
    s.addText("valor de hoje — líquido do rendimento do dinheiro e dos custos de segurar",
      {x:barX+0.6,y:y,w:maxW-0.6,h:0.2,fontFace:BODY,fontSize:9,color:MUTED,italic:true,align:"right",valign:"middle",margin:0});

    footer(s, footerStart);
  }

  // ================= SLIDE B — MATRIZ COMPLETA =================
  { const s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s, "Decisão no tempo · a conta completa");
    title(s, "Dinheiro de hoje, cenário a cenário", 0.72, 24);

    const hdr=t=>({text:t,options:{fill:{color:NAVY},color:WHITE,bold:true,fontSize:11,align:(t==="Estratégia"?"left":"right"),valign:"middle"}});
    const cell=(t,o={})=>({text:String(t),options:{fontSize:11,color:INK,align:o.align||"right",valign:"middle",fill:o.fill,bold:o.bold,color:o.color||INK}});
    const head=["Estratégia","Fecha por","Dinheiro de hoje","vs valor competitivo"].map(hdr);

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
          cell(`Segurar ${c.meses}m — ${shortByKey(pd.key)}`,{align:"left",fill:f}),
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
      {text:"Para compensar segurar em vez do valor competitivo, o fechamento precisaria passar de  ",options:{color:INK}},
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

  return 2;
}

module.exports = { addDecisaoTempoSlides };
