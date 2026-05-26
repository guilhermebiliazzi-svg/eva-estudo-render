/**
 * Gerador do Estudo de Mercado RE/MAX Ville (PPTX editável).
 *
 *   const { buildEstudo } = require("./estudo_generator");
 *   await buildEstudo(data, { assets: "/path/brand", out: "/path/estudo.pptx" });
 *
 * `data` segue o contrato em data_marquise.json.
 * `opts.assets` = pasta com os ativos FIXOS da marca
 *   (remax_white.png, remax_navy.png, remax_map_official.png, ciclo_vida.png).
 * Fotos do imóvel/corretor vêm por caminho/URL dentro de `data`.
 */
const pptxgen = require("pptxgenjs");

const NAVY="10243F", RED="E4002B", ICE="CADCFC", WHITE="FFFFFF",
      INK="1A2332", MUTED="6B7280", LINE="E2E8F0", PAPER="FBFBFC",
      REDTINT="FCEFF1", ICETINT="EAF1FB", LINK="185FA5";
const HEAD="Georgia", BODY="Calibri";
const H=5.625, MX=0.55;

function buildEstudo(data, opts={}){
  const A = (opts.assets || ".").replace(/\/$/,"") + "/";
  const out = opts.out || "Estudo_Mercado.pptx";
  const p = new pptxgen();
  p.layout="LAYOUT_16x9"; p.author=data.corretor?.unidade || "RE/MAX Ville";
  p.title="Estudo de Mercado — " + (data.imovel?.predio_curto || "");

  // ---------- helpers ----------
  const SH=()=>({type:"outer",color:"000000",blur:9,offset:3,angle:135,opacity:0.13});
  function eyebrow(s,txt,x=MX,y=0.42,color=RED){
    s.addShape(p.shapes.RECTANGLE,{x:x,y:y+0.02,w:0.13,h:0.13,fill:{color:RED},line:{type:"none"}});
    s.addText(txt.toUpperCase(),{x:x+0.22,y:y-0.05,w:7,h:0.28,fontFace:BODY,fontSize:11,
      color:color,bold:true,charSpacing:3,align:"left",valign:"middle",margin:0});
  }
  const eyebrow_w=(s,txt,x=MX,y=0.55)=>eyebrow(s,txt,x,y,WHITE) // white eyebrow keeps red square
    ; // note: square stays red; label white
  function eyebrowWhite(s,txt,x=MX,y=0.55){
    s.addShape(p.shapes.RECTANGLE,{x:x,y:y+0.02,w:0.13,h:0.13,fill:{color:RED},line:{type:"none"}});
    s.addText(txt.toUpperCase(),{x:x+0.22,y:y-0.05,w:6,h:0.28,fontFace:BODY,fontSize:11,
      color:WHITE,bold:true,charSpacing:3,align:"left",valign:"middle",margin:0});
  }
  function title(s,txt,y=0.72,color=NAVY,size=30){
    s.addText(txt,{x:MX,y:y,w:8.9,h:0.72,fontFace:HEAD,fontSize:size,color:color,
      bold:true,align:"left",valign:"middle",margin:0});
  }
  function footer(s,n,dark=false){
    const c = dark ? "7F94B5" : MUTED;
    s.addText((data.corretor?.unidade||"RE/MAX Ville")+" · Estudo de Mercado",
      {x:MX,y:5.28,w:5,h:0.25,fontFace:BODY,fontSize:8.5,color:c,align:"left",valign:"middle",margin:0});
    s.addText(String(n).padStart(2,"0"),{x:9.0,y:5.28,w:0.45,h:0.25,fontFace:BODY,
      fontSize:8.5,color:c,align:"right",valign:"middle",margin:0});
  }
  function statCard(s,x,y,w,big,small,bigColor=NAVY){
    s.addText(big,{x:x,y:y,w:w,h:0.62,fontFace:HEAD,fontSize:30,color:bigColor,bold:true,
      align:"left",valign:"middle",margin:0});
    s.addText(small.toUpperCase(),{x:x,y:y+0.6,w:w,h:0.34,fontFace:BODY,fontSize:10,
      color:MUTED,bold:true,charSpacing:1.5,align:"left",valign:"top",margin:0});
  }
  const yearOf=(d)=> (String(d).match(/(\d{4})/g)||[]).slice(-1)[0] || "";

  const im = data.imovel||{}, co = data.corretor||{}, val = data.valoracao||{};
  const edata = data.estudo_data || "";

  // ===== SLIDE 1 — CAPA =====
  { let s=p.addSlide(); s.background={color:NAVY};
    if(im.foto_fachada) s.addImage({path:im.foto_fachada,x:6.95,y:0,w:3.05,h:H,sizing:{type:"cover",w:3.05,h:H}});
    s.addShape(p.shapes.RECTANGLE,{x:6.95,y:0,w:0.05,h:H,fill:{color:RED},line:{type:"none"}});
    s.addImage({path:A+"remax_white.png",x:MX,y:0.5,w:2.15,h:2.15*1264/2673});
    eyebrowWhite(s,"Estudo de Mercado",MX,1.65);
    s.addText(im.titulo||"",{x:MX,y:2.0,w:6.5,h:1.4,fontFace:HEAD,fontSize:29,color:WHITE,bold:true,
      lineSpacingMultiple:1.05,align:"left",valign:"top",margin:0});
    s.addText(im.subtitulo||"",{x:MX,y:3.45,w:6.3,h:0.4,fontFace:BODY,fontSize:13,color:ICE,
      align:"left",valign:"middle",margin:0});
    s.addText([
      {text:"Preparado por "+(co.nome||""),options:{bold:true,color:WHITE,breakLine:true}},
      {text:`CRECI ${co.creci||""} · ${co.unidade||""} · ${edata}`,options:{color:ICE}}
    ],{x:MX,y:4.45,w:6,h:0.7,fontFace:BODY,fontSize:12,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.1});
  }

  // ===== SLIDE 2 — A RE/MAX (institucional / mapa fixo) =====
  { let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"01 · A Rede"); title(s,"A RE/MAX");
    s.addText("De Denver (1973) a mais de 115 países e regiões — uma das maiores redes imobiliárias do mundo.",
      {x:MX,y:1.35,w:8.9,h:0.34,fontFace:BODY,fontSize:13.5,color:INK,italic:true,align:"left",valign:"middle",margin:0});
    const stats=[["1973","Fundação",NAVY,0.6,1.98],["+145 mil","Corretores",RED,2.45,1.98],
                 ["+9.000","Escritórios",RED,0.6,3.2],["+115","Países",NAVY,2.45,3.2]];
    stats.forEach(([big,small,col,x,y])=>{
      s.addText(big,{x:x,y:y,w:1.78,h:0.55,fontFace:HEAD,fontSize:25,color:col,bold:true,align:"left",valign:"middle",margin:0});
      s.addText(small.toUpperCase(),{x:x,y:y+0.52,w:1.78,h:0.3,fontFace:BODY,fontSize:10,color:MUTED,bold:true,charSpacing:1.2,align:"left",valign:"top",margin:0});
    });
    s.addText("Maior volume de transações residenciais do setor — um profissional local respaldado por uma rede global.",
      {x:0.6,y:4.3,w:3.55,h:0.9,fontFace:BODY,fontSize:11.5,color:INK,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.18});
    s.addImage({path:A+"remax_map_official.png",x:4.45,y:1.95,w:5.3,h:5.3*432/1042});
    s.addShape(p.shapes.RECTANGLE,{x:4.45,y:1.95,w:5.3,h:5.3*432/1042,fill:{type:"none"},line:{color:NAVY,width:1}});
    s.addText("Em vermelho: países e regiões com presença RE/MAX",{x:4.45,y:4.32,w:5.3,h:0.25,fontFace:BODY,fontSize:9.5,color:MUTED,italic:true,align:"center",valign:"middle",margin:0});
    footer(s,2);
  }

  // ===== SLIDE 3 — A RE/MAX VILLE (institucional) =====
  { let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"02 · A Unidade"); title(s,"A "+(co.unidade||"RE/MAX Ville"));
    statCard(s,MX,1.75,2.5,(data.unidade_stats?.anos||"5 anos"),"de RE/MAX",NAVY);
    statCard(s,MX+2.7,1.75,2.5,(data.unidade_stats?.corretores||"30"),"corretores",RED);
    s.addText(data.unidade_texto || "A RE/MAX Ville traz esse modelo para uma das regiões mais valorizadas de São Paulo. São cinco anos dentro da rede e uma equipe de 30 corretores que conhece de perto a dinâmica de preço, liquidez e perfil de comprador de cada microrregião. Trabalhamos com captação qualificada e venda em parceria: o imóvel ganha exposição na rede inteira — e é essa inteligência local somada à força de uma rede global que sustenta estudos como este, ancorados em dados reais.",
      {x:MX,y:3.0,w:8.9,h:1.5,fontFace:BODY,fontSize:14.5,color:INK,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.22});
    const regs=data.unidade_regioes || ["Vila Mariana","Paraíso","Ibirapuera","Zona Sul"]; let rx=MX;
    regs.forEach(r=>{ const w=0.35+r.length*0.105;
      s.addShape(p.shapes.ROUNDED_RECTANGLE,{x:rx,y:4.55,w:w,h:0.38,fill:{color:"EEF3FB"},line:{color:ICE,width:1},rectRadius:0.19});
      s.addText(r,{x:rx,y:4.55,w:w,h:0.38,fontFace:BODY,fontSize:11,color:NAVY,bold:true,align:"center",valign:"middle",margin:0}); rx+=w+0.15; });
    footer(s,3);
  }

  // ===== SLIDE 4 — O CORRETOR =====
  { let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"03 · O Corretor"); title(s,"Quem conduz a venda");
    if(co.foto) s.addImage({path:co.foto,x:MX,y:1.7,w:3.0,h:3.0,sizing:{type:"cover",w:3.0,h:3.0}});
    s.addShape(p.shapes.RECTANGLE,{x:MX,y:1.7,w:3.0,h:3.0,fill:{type:"none"},line:{color:LINE,width:1}});
    const tx=4.05;
    s.addText(co.nome||"",{x:tx,y:1.8,w:5.4,h:0.6,fontFace:HEAD,fontSize:28,color:NAVY,bold:true,align:"left",valign:"middle",margin:0});
    s.addText(`CRECI ${co.creci||""} · ${co.unidade||""}`,{x:tx,y:2.42,w:5.4,h:0.34,fontFace:BODY,fontSize:12.5,color:RED,bold:true,charSpacing:1,align:"left",valign:"middle",margin:0});
    s.addText(co.bio||"",{x:tx,y:2.95,w:5.45,h:1.8,fontFace:BODY,fontSize:14,color:INK,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.22});
    footer(s,4);
  }

  // ===== SLIDE 5 — FORMA DE TRABALHO (institucional) =====
  { let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"04 · Forma de Trabalho"); title(s,"Como representamos você");
    const cards=[["Representação do vendedor","Trabalhamos pelo seu interesse — preço, exposição e negociação a seu favor, do começo ao fim."],
      ["Captação com exclusividade","Foco total no seu imóvel, com plano de divulgação dedicado e acompanhamento próximo."],
      ["Venda em parceria","Seu imóvel exposto a toda a rede de corretores, não a um só — mais alcance e venda mais rápida."]];
    const cw=2.85, gap=0.18, y0=1.85, ch=2.7;
    cards.forEach((c,i)=>{ const x=MX+i*(cw+gap);
      s.addShape(p.shapes.RECTANGLE,{x:x,y:y0,w:cw,h:ch,fill:{color:PAPER},line:{color:LINE,width:1},shadow:SH()});
      s.addShape(p.shapes.RECTANGLE,{x:x,y:y0,w:cw,h:0.09,fill:{color:RED},line:{type:"none"}});
      s.addText(String(i+1),{x:x+0.25,y:y0+0.3,w:0.8,h:0.7,fontFace:HEAD,fontSize:34,color:ICE,bold:true,align:"left",valign:"middle",margin:0});
      s.addText(c[0],{x:x+0.25,y:y0+1.0,w:cw-0.5,h:0.6,fontFace:HEAD,fontSize:15.5,color:NAVY,bold:true,align:"left",valign:"top",margin:0});
      s.addText(c[1],{x:x+0.25,y:y0+1.6,w:cw-0.5,h:1.0,fontFace:BODY,fontSize:12,color:INK,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.18});
    });
    footer(s,5);
  }

  // ===== SLIDE 6 — DIVULGAÇÃO (institucional) =====
  { let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"05 · Divulgação"); title(s,"Onde seu imóvel aparece");
    const hy=2.35;
    s.addShape(p.shapes.ROUNDED_RECTANGLE,{x:MX,y:hy,w:2.3,h:1.0,fill:{color:NAVY},line:{type:"none"},rectRadius:0.1,shadow:SH()});
    s.addText([{text:"NonStop",options:{bold:true,fontSize:17,color:WHITE,breakLine:true}},
      {text:"captação e gestão",options:{fontSize:10.5,color:ICE}}],
      {x:MX,y:hy,w:2.3,h:1.0,fontFace:HEAD,align:"center",valign:"middle",margin:0,lineSpacingMultiple:1.05});
    s.addShape(p.shapes.LINE,{x:MX+2.3,y:hy+0.5,w:0.55,h:0,line:{color:RED,width:2.5,endArrowType:"triangle"}});
    const portals=["Zap Imóveis","VivaReal","Chaves na Mão","RE/MAX.com","Instagram"];
    const px=3.5, pw=6.0, ph=0.62, pg=0.14;
    portals.forEach((pt,i)=>{ const col=i%2, row=Math.floor(i/2);
      const x=px+col*(pw/2), w=pw/2-0.1, y=hy-0.55+row*(ph+pg);
      if(i===4){
        s.addShape(p.shapes.ROUNDED_RECTANGLE,{x:px,y:hy-0.55+2*(ph+pg),w:pw-0.1,h:ph,fill:{color:PAPER},line:{color:LINE,width:1},rectRadius:0.08});
        s.addText(pt,{x:px,y:hy-0.55+2*(ph+pg),w:pw-0.1,h:ph,fontFace:BODY,fontSize:12.5,color:NAVY,bold:true,align:"center",valign:"middle",margin:0});
      } else {
        s.addShape(p.shapes.ROUNDED_RECTANGLE,{x:x,y:y,w:w,h:ph,fill:{color:PAPER},line:{color:LINE,width:1},rectRadius:0.08});
        s.addText(pt,{x:x,y:y,w:w,h:ph,fontFace:BODY,fontSize:12.5,color:NAVY,bold:true,align:"center",valign:"middle",margin:0});
      }
    });
    s.addText("Captação e gestão centralizadas no NonStop, com publicação nos principais portais e nas redes — máxima exposição qualificada do imóvel.",
      {x:MX,y:4.2,w:8.9,h:0.7,fontFace:BODY,fontSize:13,color:INK,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.2});
    footer(s,6);
  }

  // ===== SLIDE 7 — METODOLOGIA (institucional) =====
  { let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"06 · Metodologia"); title(s,"Como chegamos ao valor");
    const steps=[["1","Vendidos no mesmo prédio","Transações reais de ITBI do próprio condomínio são a base — não achismo."],
      ["2","Ajuste no tempo + depreciação","Âncora na venda recente, com correção monetária e depreciação."],
      ["3","Comparáveis ativos","Anúncios atuais semelhantes calibram o preço de pedido."]];
    const cw=2.85, gap=0.18, y0=1.8, ch=1.75;
    steps.forEach((c,i)=>{ const x=MX+i*(cw+gap);
      s.addShape(p.shapes.RECTANGLE,{x:x,y:y0,w:cw,h:ch,fill:{color:PAPER},line:{color:LINE,width:1},shadow:SH()});
      s.addShape(p.shapes.OVAL,{x:x+0.25,y:y0+0.25,w:0.5,h:0.5,fill:{color:NAVY},line:{type:"none"}});
      s.addText(c[0],{x:x+0.25,y:y0+0.25,w:0.5,h:0.5,fontFace:HEAD,fontSize:18,color:WHITE,bold:true,align:"center",valign:"middle",margin:0});
      s.addText(c[1],{x:x+0.25,y:y0+0.85,w:cw-0.5,h:0.5,fontFace:HEAD,fontSize:13.5,color:NAVY,bold:true,align:"left",valign:"top",margin:0});
      s.addText(c[2],{x:x+0.25,y:y0+1.28,w:cw-0.5,h:0.42,fontFace:BODY,fontSize:10.5,color:INK,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.12});
    });
    s.addText("FONTES",{x:MX,y:3.85,w:3,h:0.3,fontFace:BODY,fontSize:10.5,color:RED,bold:true,charSpacing:2,margin:0,valign:"middle"});
    const fontes=[["Portais + NonStop","anúncios ativos comparáveis"],["ITBI — Prefeitura de SP","transações efetivamente fechadas"],["IBGE — IPCA","correção monetária no tempo"]];
    fontes.forEach((f,i)=>{ const x=MX+i*(cw+gap);
      s.addText([{text:f[0],options:{bold:true,color:NAVY,fontSize:12,breakLine:true}},{text:f[1],options:{color:MUTED,fontSize:10.5}}],
        {x:x,y:4.2,w:cw,h:0.7,fontFace:BODY,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.1});
    });
    footer(s,7);
  }

  // ===== SLIDE 8 — O IMÓVEL =====
  { let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"07 · O Imóvel"); title(s,"O imóvel avaliado");
    if(im.foto_interior) s.addImage({path:im.foto_interior,x:MX,y:1.7,w:4.55,h:3.0,sizing:{type:"cover",w:4.55,h:3.0}});
    s.addShape(p.shapes.RECTANGLE,{x:MX,y:1.7,w:4.55,h:3.0,fill:{type:"none"},line:{color:LINE,width:1}});
    const tx=5.4, tw=4.05; let yy=1.7;
    const ficha = im.ficha||[];
    ficha.forEach((r,i)=>{
      s.addText(String(r[0]).toUpperCase(),{x:tx,y:yy,w:1.45,h:0.36,fontFace:BODY,fontSize:9.5,color:MUTED,bold:true,charSpacing:0.5,align:"left",valign:"middle",margin:0});
      s.addText(String(r[1]),{x:tx+1.45,y:yy,w:tw-1.45,h:0.36,fontFace:BODY,fontSize:12,color:INK,bold:true,align:"left",valign:"middle",margin:0});
      if(i<ficha.length-1) s.addShape(p.shapes.LINE,{x:tx,y:yy+0.375,w:tw,h:0,line:{color:LINE,width:0.75}});
      yy+=0.385;
    });
    footer(s,8);
  }

  // ===== SLIDE 9 — AMOSTRAS (PEDIDO) — data-driven =====
  { let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"08 · Amostras"); title(s,"Comparáveis ativos — preço pedido");
    const hdr=(t)=>({text:t,options:{fill:{color:NAVY},color:WHITE,bold:true,fontSize:11,align:"center",valign:"middle"}});
    const head=["Imóvel","Bairro","Área","Suítes","Vagas","Pedido","R$/m²"].map(hdr);
    const cell=(t,o={})=>({text:String(t),options:{fontSize:11,color:INK,align:o.align||"center",valign:"middle",fill:o.fill,bold:o.bold,...o}});
    const lk=(u)=>u?({hyperlink:{url:u,tooltip:"Abrir anúncio"},color:LINK,underline:true}):{};
    const amostras = data.amostras||[];
    const rows = amostras.map(a=>{
      const fill = a.tipo==="avaliando" ? {color:ICETINT} : a.tipo==="mesmo_predio" ? {color:REDTINT} : undefined;
      const boldName = a.tipo==="avaliando"||a.tipo==="mesmo_predio";
      const nameOpts = {align:"left", bold:boldName, ...(fill?{fill}:{}), ...(a.tipo!=="avaliando"?lk(a.link):{})};
      const c=(t)=> cell(t, fill?{fill}:{});
      return [cell(a.nome,nameOpts),c(a.bairro),c(a.area),c(a.suites),c(a.vagas),
        cell(a.pedido, {...(fill?{fill}:{}), bold:boldName}), c(a.valor_m2)];
    });
    s.addTable([head,...rows],{x:MX,y:1.75,w:8.9,colW:[2.5,1.25,0.95,0.85,0.85,1.3,1.2],
      border:{type:"solid",color:LINE,pt:0.75},rowH:0.5,valign:"middle",fontFace:BODY,autoPage:false});
    // nota: monta a partir das unidades do mesmo prédio
    const mp = amostras.filter(a=>a.tipo==="mesmo_predio");
    let nota;
    if(mp.length){
      const partes=[{text:"Mesmo prédio à venda: ",options:{color:INK}}];
      mp.forEach((a,i)=>{ partes.push({text:`${a.ref||a.nome} (${a.suites} suítes) ${a.pedido}`,options:{bold:true,color:RED}});
        if(i<mp.length-1) partes.push({text:" · ",options:{color:INK}}); });
      partes.push({text:".   ",options:{color:INK}});
      partes.push({text:"Azul",options:{color:LINK,bold:true}});
      partes.push({text:" = link do anúncio.",options:{color:INK}});
      nota=partes;
    } else {
      nota=[{text:data.amostras_nota||"Comparáveis ativos do mesmo perfil.",options:{color:INK}}];
    }
    s.addText(nota,{x:MX,y:4.8,w:8.9,h:0.5,fontFace:BODY,fontSize:11,align:"left",valign:"middle",margin:0});
    footer(s,9);
  }

  // ===== SLIDE 10 — VENDIDOS ITBI — data-driven =====
  { let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"09 · Vendidos"); title(s,"Transações reais — ITBI");
    s.addText("Mesmo prédio · Prefeitura de São Paulo",{x:MX,y:1.32,w:8,h:0.3,fontFace:BODY,fontSize:12,color:MUTED,italic:true,align:"left",valign:"middle",margin:0});
    const hdr=(t)=>({text:t,options:{fill:{color:NAVY},color:WHITE,bold:true,fontSize:11,align:"center",valign:"middle"}});
    const head=["Data","Unidade","Área constr.*","Valor","R$/m²"].map(hdr);
    const cell=(t,o={})=>({text:String(t),options:{fontSize:11,color:INK,align:o.align||"center",valign:"middle",fill:o.fill,bold:o.bold}});
    const HL={color:ICETINT};
    const allVend = data.vendidos||[];
    // cabe ~8 linhas no slide. Se passar, mantém a mais antiga (base da tendência)
    // + as mais recentes (inclui a âncora) e sinaliza o total no rodapé.
    const MAXFIT = 8;
    let vend = allVend, trunc = 0;
    if (allVend.length > MAXFIT) {
      vend = [allVend[0], ...allVend.slice(allVend.length-(MAXFIT-1))];
      trunc = allVend.length - vend.length;
    }
    const rowH = vend.length > 6 ? 0.33 : 0.42;
    const rows = vend.map(v=>{ const f=v.ancora?HL:undefined;
      return [cell(v.data,v.ancora?{fill:HL,bold:true}:{}),cell(v.unidade,v.ancora?{fill:HL,bold:true}:{}),
        cell(v.area,f?{fill:f}:{}),cell(v.valor,v.ancora?{fill:HL,bold:true}:{}),cell(v.valor_m2,f?{fill:f}:{})];
    });
    s.addTable([head,...rows],{x:MX,y:1.7,w:5.7,colW:[1.15,1.55,1.1,1.1,0.8],
      border:{type:"solid",color:LINE,pt:0.75},rowH,valign:"middle",fontFace:BODY,autoPage:false});
    // callout de tendência (primeiro -> âncora)
    const de = vend[0]||{}, ate = vend.find(v=>v.ancora) || vend[vend.length-1] || {};
    const cx=6.55, cw=2.9;
    s.addShape(p.shapes.RECTANGLE,{x:cx,y:1.7,w:cw,h:2.95,fill:{color:NAVY},line:{type:"none"},shadow:SH()});
    s.addText("TENDÊNCIA REAL DO PRÉDIO",{x:cx+0.25,y:1.95,w:cw-0.5,h:0.3,fontFace:BODY,fontSize:9.5,color:ICE,bold:true,charSpacing:1.5,margin:0,valign:"middle"});
    s.addText([{text:de.valor||"",options:{fontSize:20,bold:true,color:WHITE,breakLine:true}},
      {text:yearOf(de.data),options:{fontSize:11,color:ICE}}],
      {x:cx+0.25,y:2.3,w:cw-0.5,h:0.75,fontFace:HEAD,align:"left",valign:"top",margin:0});
    s.addText("→",{x:cx+0.25,y:3.0,w:cw-0.5,h:0.3,fontFace:BODY,fontSize:16,color:RED,bold:true,align:"left",valign:"middle",margin:0});
    s.addText([{text:ate.valor||"",options:{fontSize:20,bold:true,color:WHITE,breakLine:true}},
      {text:yearOf(ate.data)+" — alta acima do IPCA",options:{fontSize:11,color:ICE}}],
      {x:cx+0.25,y:3.35,w:cw-0.5,h:0.75,fontFace:HEAD,align:"left",valign:"top",margin:0});
    s.addText(`* Área construída (IPTU, inclui áreas comuns) — base diferente do m² útil dos anúncios; a comparação direta é pelo valor total.${trunc?`  ·  ${allVend.length} transações no total; exibindo a mais antiga e as ${MAXFIT-1} mais recentes.`:""}`,
      {x:MX,y:4.78,w:8.9,h:0.5,fontFace:BODY,fontSize:9.5,color:MUTED,italic:true,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.1});
    footer(s,10);
  }

  // ===== SLIDE 11 — CICLO DE VIDA (chart fixo + texto data-driven) =====
  { let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"10 · Ciclo de Vida"); title(s,"Por que o valor não é só inflação");
    s.addImage({path:A+"ciclo_vida.png",x:MX,y:1.55,w:6.55,h:6.55*5.0/10.6});
    // marcador dinâmico sobre o gráfico — posicionado pela idade real do imóvel.
    // geometria do plot dentro do PNG (precisa casar com o ciclo_vida.png): L/R/T/B
    if (im.idade_anos != null) {
      const imgX=MX, imgY=1.55, imgW=6.55, imgH=6.55*5.0/10.6;
      const PL=0.07, PR=0.97, PT=0.14, PB=0.76;
      const idadeM=Math.max(0, Math.min(40, Number(im.idade_anos)));
      const mx=imgX + (PL + (idadeM/40)*(PR-PL))*imgW;
      const yTop=imgY + PT*imgH, yBot=imgY + PB*imgH;
      s.addShape(p.shapes.LINE,{x:mx,y:yTop,w:0,h:yBot-yTop,line:{color:RED,width:1.5,dashType:"dash"}});
      const lblW=2.4, lx=Math.max(imgX, Math.min(mx-lblW/2, imgX+imgW-lblW));
      s.addText(`${im.predio_curto||"este imóvel"} · ~${idadeM} anos`,
        {x:lx,y:yTop-0.32,w:lblW,h:0.27,fontFace:BODY,fontSize:10.5,color:NAVY,bold:true,
         align:"center",valign:"middle",margin:0,fill:{color:ICETINT}});
    }
    const tx=7.3, tw=2.2;
    const predio=im.predio_curto||"imóvel";
    const idadeTxt = im.idade_anos!=null ? ` (~${im.idade_anos} anos)` : "";
    const vend=data.vendidos||[]; const de=vend[0]||{}, ate=vend.find(v=>v.ancora)||vend[vend.length-1]||{};
    s.addText([
      {text:"O valor de um imóvel é terreno (valoriza) + construção (deprecia).",options:{color:INK,breakLine:true,bold:true}},
      {text:"",options:{breakLine:true,fontSize:6}},
      {text:"O total sobe nos primeiros anos, atinge um platô e depois cede em termos reais.",options:{color:INK,breakLine:true}},
      {text:"",options:{breakLine:true,fontSize:6}},
      {text:`O ${predio}${idadeTxt} está entrando no platô — por isso projetar o boom para a frente seria um erro.`,options:{color:INK}},
    ],{x:tx,y:1.7,w:tw,h:2.9,fontFace:BODY,fontSize:12,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.2});
    s.addText(`A tabela do ITBI confirma: ${de.valor||""} (${yearOf(de.data)}) → ${ate.valor||""} (${yearOf(ate.data)}).`,
      {x:MX,y:4.85,w:8.9,h:0.4,fontFace:BODY,fontSize:12,color:NAVY,bold:true,align:"left",valign:"middle",margin:0});
    footer(s,11);
  }

  // ===== SLIDE 12 — PEDIDO x FECHADO + AJUSTE — data-driven =====
  { let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"11 · Pedido × Fechado"); title(s,"O ajuste no tempo e a depreciação");
    const cw=4.35, ch=1.4, y0=1.75;
    s.addShape(p.shapes.RECTANGLE,{x:MX,y:y0,w:cw,h:ch,fill:{color:PAPER},line:{color:LINE,width:1},shadow:SH()});
    s.addShape(p.shapes.RECTANGLE,{x:MX,y:y0,w:0.09,h:ch,fill:{color:RED},line:{type:"none"}});
    s.addText("CONCORRENTE DIRETO · MESMO PRÉDIO",{x:MX+0.28,y:y0+0.2,w:cw-0.45,h:0.3,fontFace:BODY,fontSize:9.5,color:MUTED,bold:true,charSpacing:1,margin:0});
    s.addText([{text:val.concorrente_valor||"",options:{fontSize:23,bold:true,color:NAVY,breakLine:true}},
      {text:val.concorrente_label||"",options:{fontSize:11.5,color:INK}}],
      {x:MX+0.28,y:y0+0.55,w:cw-0.45,h:0.8,fontFace:HEAD,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.1});
    const x2=MX+cw+0.2;
    s.addShape(p.shapes.RECTANGLE,{x:x2,y:y0,w:cw,h:ch,fill:{color:NAVY},line:{type:"none"},shadow:SH()});
    s.addText("ÚLTIMA VENDA REAL · ITBI",{x:x2+0.25,y:y0+0.2,w:cw-0.5,h:0.3,fontFace:BODY,fontSize:9.5,color:ICE,bold:true,charSpacing:1,margin:0});
    s.addText([{text:val.ancora_valor||"",options:{fontSize:23,bold:true,color:WHITE,breakLine:true}},
      {text:val.ancora_label||"",options:{fontSize:11.5,color:ICE}}],
      {x:x2+0.25,y:y0+0.55,w:cw-0.5,h:0.8,fontFace:HEAD,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.1});
    s.addText("COMO AJUSTAMOS",{x:MX,y:3.45,w:5,h:0.3,fontFace:BODY,fontSize:10.5,color:RED,bold:true,charSpacing:2,margin:0,valign:"middle"});
    const bul=(t)=>({text:t,options:{bullet:{code:"2022"},color:INK,breakLine:true}});
    s.addText([
      bul(`Concorrente direto no mesmo prédio anunciado por ${val.concorrente_valor||""} — teto prático do anúncio.`),
      bul(`Última venda real do prédio: ${val.ancora_valor||""} (${val.ancora_curto||""}) — base do valor de mercado.`),
      bul("Não se anuncia acima de uma unidade equivalente já disponível no mesmo condomínio."),
      {text:"Depreciação e platô do ciclo de vida reforçam o ajuste — projeção capada, sem extrapolar o boom.",options:{bullet:{code:"2022"},color:INK}},
    ],{x:MX,y:3.78,w:8.9,h:1.3,fontFace:BODY,fontSize:12.5,align:"left",valign:"top",margin:0,paraSpaceAfter:6});
    footer(s,12);
  }

  // ===== SLIDE 13 — CONCLUSÃO — data-driven =====
  { let s=p.addSlide(); s.background={color:NAVY};
    eyebrowWhite(s,"Conclusão",MX,0.55);
    s.addText("Valor de mercado estimado",{x:MX,y:1.15,w:9,h:0.5,fontFace:HEAD,fontSize:20,color:ICE,align:"left",valign:"middle",margin:0});
    s.addText(val.valor_mercado||"",{x:MX,y:1.7,w:9,h:1.1,fontFace:HEAD,fontSize:60,color:WHITE,bold:true,align:"left",valign:"middle",margin:0});
    s.addText("faixa de "+(val.faixa||""),{x:MX,y:2.85,w:9,h:0.4,fontFace:BODY,fontSize:15,color:ICE,align:"left",valign:"middle",margin:0});
    s.addShape(p.shapes.RECTANGLE,{x:MX,y:3.55,w:5.6,h:1.3,fill:{color:"15294A"},line:{color:"24395C",width:1}});
    s.addShape(p.shapes.RECTANGLE,{x:MX,y:3.55,w:0.09,h:1.3,fill:{color:RED},line:{type:"none"}});
    s.addText([{text:"Preço de anúncio sugerido",options:{fontSize:11,color:ICE,bold:true,charSpacing:1,breakLine:true}},
      {text:val.anuncio_sugerido||"",options:{fontSize:30,color:WHITE,bold:true,breakLine:true}},
      {text:val.anuncio_sub||"",options:{fontSize:11,color:ICE}}],
      {x:MX+0.3,y:3.7,w:5.2,h:1.05,fontFace:HEAD,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.05});
    s.addText(val.conclusao_apoio||"",{x:6.5,y:3.6,w:2.95,h:1.25,fontFace:BODY,fontSize:12,color:ICE,align:"left",valign:"middle",margin:0,lineSpacingMultiple:1.2});
    footer(s,13,true);
  }

  // ===== SLIDE 14 — RESSALVAS + CONTATO =====
  { let s=p.addSlide(); s.background={color:NAVY};
    eyebrowWhite(s,"Ressalvas e Contato",MX,0.55);
    s.addText("Sobre este estudo",{x:MX,y:1.05,w:9,h:0.55,fontFace:HEAD,fontSize:24,color:WHITE,bold:true,align:"left",valign:"middle",margin:0});
    s.addText(data.ressalvas || "Este documento é um parecer de valor de mercado para fins de precificação e estratégia de venda — não constitui laudo de avaliação formal (NBR 14653). Baseia-se em dados públicos de ITBI (Prefeitura de São Paulo), anúncios ativos comparáveis e índices do IBGE disponíveis na data de elaboração. Valores de mercado variam conforme as condições de negociação.",
      {x:MX,y:1.7,w:8.9,h:1.4,fontFace:BODY,fontSize:13,color:ICE,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.25});
    s.addShape(p.shapes.LINE,{x:MX,y:3.35,w:8.9,h:0,line:{color:"24395C",width:1}});
    s.addImage({path:A+"remax_white.png",x:MX,y:3.65,w:2.1,h:2.1*1264/2673});
    s.addText([{text:co.nome||"",options:{fontSize:20,bold:true,color:WHITE,breakLine:true}},
      {text:`CRECI ${co.creci||""} · ${co.unidade||""}`,options:{fontSize:13,color:ICE,breakLine:true}},
      {text:edata,options:{fontSize:11,color:"7F94B5"}}],
      {x:6.0,y:3.7,w:3.45,h:1.2,fontFace:HEAD,align:"left",valign:"middle",margin:0,lineSpacingMultiple:1.15});
  }

  return p.writeFile({fileName: out});
}

module.exports = { buildEstudo };
