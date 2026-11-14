/**
 * Gerador do Estudo de CASA DE RUA / TERRENO — REMAX Ville (PPTX editável).
 *
 *   const { buildEstudoCasa } = require("./estudo_casa_generator");
 *   await buildEstudoCasa(data, { assets: "/path/brand", out: "/path/estudo.pptx" });
 *
 * Espelha o estudo_generator.js do apartamento (mesma marca/helpers/slides institucionais).
 * O que muda na casa:
 *   - metodologia: comparáveis por R$/m² de TERRENO (não "mesmo prédio");
 *   - ficha: terreno / construída / testada / uso;
 *   - slide de dados: tabela de casas comparáveis vendidas (ITBI) por R$/m² de terreno;
 *   - método/conclusão: faixa piso/alvo/teto do Método 2 (mediana ± p25/p75).
 *
 * `data` = { imovel, corretor, comps[], valoracao, estudo_data,
 *            unidade_stats?, unidade_regioes?, unidade_texto?, ressalvas? }
 * comps[] já formatados (strings): { data, endereco, area_terreno, area_construida, valor, rs_m2_terreno, dist }
 */
const pptxgen = require("pptxgenjs");
const { addDecisaoTempoSlides } = require("./decisao_tempo_slide");

// v4 · identidade REMAX 2026 — cores/fonte em brand.js
const { C:B, FONT, TAN, marca, barra, tresBarras } = require("./brand");
const { ASSET } = require("./brand_assets");
const NAVY=B.NAVY, RED=B.RED, ICE=B.SKY, WHITE=B.WHITE,
      INK=B.INK, MUTED=B.MUTED, LINE=B.LINE, PAPER=B.CREAM,
      REDTINT=B.REDTINT, ICETINT=B.SKYTINT, LINK=B.BLUE;
const LOGO_W=1200, LOGO_H=523;
const HEAD=FONT, BODY=FONT;
const H=5.625, MX=0.55;

function buildEstudoCasa(data, opts={}){
  const A = (opts.assets || ".").replace(/\/$/,"") + "/";
  const out = opts.out || "Estudo_Casa.pptx";
  const p = new pptxgen();
  p.layout="LAYOUT_16x9"; p.author=marca(data.corretor?.unidade || "REMAX Ville");
  p.title="Estudo de Mercado — " + (data.imovel?.predio_curto || "");

  // ---------- helpers (mesmos do estudo_generator.js) ----------
  const SH=()=>({type:"outer",color:"000000",blur:9,offset:3,angle:135,opacity:0.13});
  function eyebrow(s,txt,x=MX,y=0.42,color=RED){
    barra(p,s,{x:x,y:y-0.03,h:0.22,w:0.075,color:RED});
    s.addText(txt.toUpperCase(),{x:x+0.27,y:y-0.05,w:7,h:0.28,fontFace:BODY,fontSize:11,
      color:color,bold:true,charSpacing:3,align:"left",valign:"middle",margin:0});
  }
  function eyebrowWhite(s,txt,x=MX,y=0.55){
    barra(p,s,{x:x,y:y-0.03,h:0.22,w:0.075,color:RED});
    s.addText(txt.toUpperCase(),{x:x+0.27,y:y-0.05,w:6,h:0.28,fontFace:BODY,fontSize:11,
      color:WHITE,bold:true,charSpacing:3,align:"left",valign:"middle",margin:0});
  }
  function title(s,txt,y=0.72,color=NAVY,size=30){
    s.addText(txt,{x:MX,y:y,w:8.9,h:0.72,fontFace:HEAD,fontSize:size,color:color,
      bold:true,align:"left",valign:"middle",margin:0});
  }
  function footer(s,n,dark=false){
    const c = dark ? B.NAVYMUTED : MUTED;
    s.addText(marca(data.corretor?.unidade||"REMAX Ville")+" · Estudo de Mercado",
      {x:MX,y:5.28,w:5,h:0.25,fontFace:BODY,fontSize:8.5,color:c,align:"left",valign:"middle",margin:0});
    s.addText(String(n).padStart(2,"0"),{x:9.0,y:5.28,w:0.45,h:0.25,fontFace:BODY,
      fontSize:8.5,color:c,align:"right",valign:"middle",margin:0});
  }
  function statCard(s,x,y,w,big,small,bigColor=NAVY){
    s.addText(big,{x:x,y:y,w:w,h:0.62,fontFace:HEAD,fontSize:30,color:bigColor,bold:true,align:"left",valign:"middle",margin:0});
    s.addText(small.toUpperCase(),{x:x,y:y+0.6,w:w,h:0.34,fontFace:BODY,fontSize:10,color:MUTED,bold:true,charSpacing:1.5,align:"left",valign:"top",margin:0});
  }

  const im = data.imovel||{}, val = data.valoracao||{};
  const co = { ...(data.corretor||{}), unidade: marca((data.corretor||{}).unidade || "REMAX Ville") };
  const edata = (typeof data.estudo_data === "string" && data.estudo_data.trim())
              || new Date().toLocaleDateString("pt-BR");

  // ===== SLIDE 1 — CAPA (modelo ACM do Guia de Marca, p. 172) =====
  { let s=p.addSlide(); s.background={color:NAVY};
    const PX=6.05, dxCorte=H*TAN;
    if(im.foto_fachada){
      s.addImage({path:im.foto_fachada,x:PX,y:0,w:10-PX,h:H,sizing:{type:"cover",w:10-PX,h:H}});
      s.addShape(p.shapes.CUSTOM_GEOMETRY,{x:PX,y:0,w:dxCorte,h:H,fill:{color:NAVY},line:{type:"none"},
        points:[{x:0,y:0},{x:dxCorte,y:0},{x:0,y:H},{close:true}]});
      barra(p,s,{x:PX-0.01,y:0,h:H,w:0.13,color:RED});
    } else {
      tresBarras(p,s,{x:7.2,y:4.55,h:0.55,w:0.42,gap:0.16});
    }
    barra(p,s,{x:MX,y:0,h:0.95,w:1.25,color:RED});
    s.addText("ESTUDO DE MERCADO",{x:MX,y:1.32,w:5.3,h:0.3,fontFace:BODY,fontSize:12,color:ICE,bold:true,
      charSpacing:3,align:"left",valign:"middle",margin:0});
    s.addText(im.titulo||"",{x:MX,y:1.68,w:5.1,h:1.42,fontFace:HEAD,fontSize:27,color:WHITE,bold:true,
      lineSpacingMultiple:1.02,align:"left",valign:"top",margin:0,fit:"shrink"});
    s.addText(im.subtitulo||"",{x:MX,y:3.12,w:5.1,h:0.42,fontFace:BODY,fontSize:12.5,color:ICE,
      align:"left",valign:"top",margin:0});
    s.addText([
      {text:"Preparado por "+(co.nome||""),options:{bold:true,color:WHITE,breakLine:true}},
      {text:`CRECI ${co.creci||""} · ${edata}`,options:{color:ICE}}
    ],{x:MX,y:3.72,w:5.1,h:0.55,fontFace:BODY,fontSize:11.5,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.1});
    s.addImage({data:ASSET.logoBranco,x:MX,y:4.45,w:1.65,h:1.65*LOGO_H/LOGO_W});
  }

  // ===== SLIDE 2 — A REMAX (institucional, fixo) =====
  { let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"01 · A Rede"); title(s,"A REMAX");
    s.addText("A marca que mais vende imóveis no Brasil — com a força de uma rede presente em mais de 120 países.",
      {x:MX,y:1.35,w:8.9,h:0.34,fontFace:BODY,fontSize:13.5,color:INK,italic:true,align:"left",valign:"middle",margin:0});
    const stats=[["50 anos","de história",NAVY,0.6,1.98],["+120","países",RED,2.45,1.98],
                 ["+600","imobiliárias no Brasil",RED,0.6,3.2],["+11 mil","profissionais no Brasil",NAVY,2.45,3.2]];
    stats.forEach(([big,small,col,x,y])=>{
      s.addText(big,{x:x,y:y,w:1.78,h:0.55,fontFace:HEAD,fontSize:25,color:col,bold:true,align:"left",valign:"middle",margin:0});
      s.addText(small.toUpperCase(),{x:x,y:y+0.52,w:1.78,h:0.3,fontFace:BODY,fontSize:10,color:MUTED,bold:true,charSpacing:1.2,align:"left",valign:"top",margin:0});
    });
    s.addText("Nº 1 do Brasil em vendas: R$ 14,3 bilhões em VGV em 2025, com 60% dos negócios fechados em rede.",
      {x:0.6,y:4.3,w:3.55,h:0.9,fontFace:BODY,fontSize:11.5,color:INK,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.18});
    s.addImage({data:ASSET.mapa,x:4.45,y:1.95,w:5.3,h:5.3*432/1042});
    s.addShape(p.shapes.RECTANGLE,{x:4.45,y:1.95,w:5.3,h:5.3*432/1042,fill:{type:"none"},line:{color:NAVY,width:1}});
    s.addText("Em vermelho: países e regiões com presença REMAX",{x:4.45,y:4.32,w:5.3,h:0.25,fontFace:BODY,fontSize:9.5,color:MUTED,italic:true,align:"center",valign:"middle",margin:0});
    footer(s,2);
  }

  // ===== SLIDE 3 — A REMAX VILLE (institucional) =====
  { let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"02 · A Unidade"); title(s,"A "+co.unidade);
    statCard(s,MX,1.75,2.5,(data.unidade_stats?.anos||"5 anos"),"de REMAX",NAVY);
    statCard(s,MX+2.7,1.75,2.5,(data.unidade_stats?.corretores||"30"),"corretores",RED);
    s.addText(marca(data.unidade_texto) || "A REMAX Ville traz esse modelo para uma das regiões mais valorizadas de São Paulo. São cinco anos dentro da rede e uma equipe de 30 corretores que conhece de perto a dinâmica de preço, liquidez e perfil de comprador de cada microrregião. Trabalhamos com captação qualificada e venda em parceria: o imóvel ganha exposição na rede inteira — e é essa inteligência local somada à força de uma rede global que sustenta estudos como este, ancorados em dados reais.",
      {x:MX,y:3.0,w:8.9,h:1.5,fontFace:BODY,fontSize:14.5,color:INK,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.22});
    const regs=data.unidade_regioes || ["Vila Mariana","Paraíso","Ibirapuera","Zona Sul"]; let rx=MX;
    regs.forEach(r=>{ const w=0.35+r.length*0.105;
      s.addShape(p.shapes.ROUNDED_RECTANGLE,{x:rx,y:4.55,w:w,h:0.38,fill:{color:B.SKYTINT},line:{color:B.SKY,width:1},rectRadius:0.19});
      s.addText(r,{x:rx,y:4.55,w:w,h:0.38,fontFace:BODY,fontSize:11,color:NAVY,bold:true,align:"center",valign:"middle",margin:0}); rx+=w+0.15; });
    footer(s,3);
  }

  // ===== SLIDE 4 — O CORRETOR =====
  { let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"03 · O Corretor"); title(s,"Quem conduz a venda");
    const fotoCorretor = co.foto || co.foto_url;   // EVA envia foto_url
    if(fotoCorretor) s.addImage({path:fotoCorretor,x:MX,y:1.7,w:3.0,h:3.0,sizing:{type:"cover",w:3.0,h:3.0}});
    s.addShape(p.shapes.RECTANGLE,{x:MX,y:1.7,w:3.0,h:3.0,fill:{type:"none"},line:{color:LINE,width:1}});
    const tx=4.05;
    s.addText(co.nome||"",{x:tx,y:1.8,w:5.4,h:0.6,fontFace:HEAD,fontSize:28,color:NAVY,bold:true,align:"left",valign:"middle",margin:0});
    s.addText(`CRECI ${co.creci||""} · ${co.unidade||""}`,{x:tx,y:2.42,w:5.4,h:0.34,fontFace:BODY,fontSize:12.5,color:RED,bold:true,charSpacing:1,align:"left",valign:"middle",margin:0});
    const bioFallback = `Atua representando vendedores em ${co.unidade}, com método: precificação fundamentada em dados de ITBI, exposição na rede REMAX e negociação conduzida com discrição e transparência — para anunciar pelo valor certo e vender no tempo certo.`;
    s.addText(marca(co.bio)||bioFallback,{x:tx,y:2.95,w:5.45,h:1.8,fontFace:BODY,fontSize:14,color:INK,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.22});
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
      s.addText(String(i+1),{x:x+0.25,y:y0+0.3,w:0.8,h:0.7,fontFace:HEAD,fontSize:34,color:RED,bold:true,align:"left",valign:"middle",margin:0});
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
    const portals=["Zap Imóveis","VivaReal","Chaves na Mão","remax.com.br","Instagram"];
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

  // ===== SLIDE 7 — METODOLOGIA (CASA: comparáveis de terreno) =====
  { let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"06 · Metodologia"); title(s,"Como chegamos ao valor");
    const steps=[["1","Vendas reais na região","Transações de casas vendidas perto do imóvel (ITBI) — base factual, não achismo."],
      ["2","Valor pelo terreno","Casa é terreno (valoriza) + construção (deprecia). A referência é o R$/m² de terreno."],
      ["3","Correção no tempo","Cada venda é trazida a hoje pelo IPCA; usamos a mediana, que resiste a extremos."]];
    const cw=2.85, gap=0.18, y0=1.8, ch=1.75;
    steps.forEach((c,i)=>{ const x=MX+i*(cw+gap);
      s.addShape(p.shapes.RECTANGLE,{x:x,y:y0,w:cw,h:ch,fill:{color:PAPER},line:{color:LINE,width:1},shadow:SH()});
      s.addShape(p.shapes.OVAL,{x:x+0.25,y:y0+0.25,w:0.5,h:0.5,fill:{color:NAVY},line:{type:"none"}});
      s.addText(c[0],{x:x+0.25,y:y0+0.25,w:0.5,h:0.5,fontFace:HEAD,fontSize:18,color:WHITE,bold:true,align:"center",valign:"middle",margin:0});
      s.addText(c[1],{x:x+0.25,y:y0+0.85,w:cw-0.5,h:0.5,fontFace:HEAD,fontSize:13.5,color:NAVY,bold:true,align:"left",valign:"top",margin:0});
      s.addText(c[2],{x:x+0.25,y:y0+1.28,w:cw-0.5,h:0.42,fontFace:BODY,fontSize:10.5,color:INK,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.12});
    });
    s.addText("FONTES",{x:MX,y:3.85,w:3,h:0.3,fontFace:BODY,fontSize:10.5,color:RED,bold:true,charSpacing:2,margin:0,valign:"middle"});
    const fontes=[["ITBI — Prefeitura de SP","casas efetivamente vendidas na região"],["Cadastro Fiscal (SQL)","área de terreno oficial de cada lote"],["IBGE — IPCA","correção monetária no tempo"]];
    fontes.forEach((f,i)=>{ const x=MX+i*(cw+gap);
      s.addText([{text:f[0],options:{bold:true,color:NAVY,fontSize:12,breakLine:true}},{text:f[1],options:{color:MUTED,fontSize:10.5}}],
        {x:x,y:4.2,w:cw,h:0.7,fontFace:BODY,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.1});
    });
    footer(s,7);
  }

  // ===== SLIDE 8 — O IMÓVEL (ficha terreno/construída/testada/uso) =====
  { let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"07 · O Imóvel"); title(s,"O imóvel avaliado");
    const ficha = Array.isArray(im.ficha) ? im.ficha : [];
    const gridX = MX, gridY = 1.85, colW = 4.35, gap = 0.2, rowH = ficha.length > 6 ? 0.78 : 0.95;   // 14/11: até 8 itens (ano de construção, estado)
    if (ficha.length === 0) {
      s.addText("Ficha técnica não fornecida pelo corretor.",
        {x:gridX,y:gridY+0.3,w:8.9,h:0.4,fontFace:BODY,fontSize:12,color:MUTED,italic:true,align:"left",valign:"middle",margin:0});
    } else {
      ficha.forEach((par, i) => {
        const col = i % 2, row = Math.floor(i / 2);
        const x = gridX + col * (colW + gap), y = gridY + row * rowH;
        s.addText(String(par[0]||"").toUpperCase(),{x:x,y:y,w:colW,h:0.30,fontFace:BODY,fontSize:10,color:MUTED,bold:true,charSpacing:1.2,align:"left",valign:"top",margin:0});
        s.addText(String(par[1]||"—"),{x:x,y:y+0.28,w:colW,h:rowH>0.9?0.55:0.44,fontFace:HEAD,fontSize:rowH>0.9?19:17,color:NAVY,bold:true,align:"left",valign:"middle",margin:0});
        const lastRow = Math.floor((ficha.length-1)/2);
        if (row < lastRow) s.addShape(p.shapes.LINE,{x, y:y+rowH-0.05, w:colW, h:0, line:{color:LINE,width:0.5}});
      });
    }
    footer(s,8);
  }

  // ===== SLIDE 9 — COMPARÁVEIS VENDIDOS (ITBI, por R$/m² de terreno) =====
  { let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"08 · Comparáveis"); title(s,"Casas vendidas na região — ITBI");
    s.addText("Vendas reais próximas · Prefeitura de São Paulo",{x:MX,y:1.32,w:8,h:0.3,fontFace:BODY,fontSize:12,color:MUTED,italic:true,align:"left",valign:"middle",margin:0});
    const hdr=(t)=>({text:t,options:{fill:{color:NAVY},color:WHITE,bold:true,fontSize:10,align:"center",valign:"middle"}});
    const head=["Data","Endereço","Terreno","Constr.","Valor","R$/m² terr."].map(hdr);
    const cell=(t,o={})=>({text:String(t),options:{fontSize:9.5,color:INK,align:o.align||"center",valign:"middle",fill:o.fill,bold:o.bold}});
    // 09/08/2023 -> 09/08/23: evita a coluna Data quebrar em 2 linhas
    const shortData = d => String(d||"").replace(/^(\d{2}\/\d{2}\/)\d{2}(\d{2})$/, "$1$2");
    const allComps = data.comps||[];
    const RG = val.regua && val.regua.min && val.regua.max && val.regua.pontos && val.regua.pontos.length >= 3 ? val.regua : null;
    // 14/11: com a régua embaixo, a tabela mostra as 4 vendas mais próximas
    const MAXFIT = RG ? 4 : 6;                 // 6 linhas cabem entre y=1.7 e o caption (y=4.78); 8 estourava
    let comps = allComps, trunc = 0;
    if (allComps.length > MAXFIT) { comps = allComps.slice(0, MAXFIT); trunc = allComps.length - MAXFIT; }
    const rowH = RG ? 0.33 : 0.40;              // altura fixa e determinística (antes 0.33 p/ >6 linhas estourava)
    const TY = RG ? 1.62 : 1.7;
    const rows = comps.map(c=>[
      cell(shortData(c.data)),
      cell(c.endereco,{align:"left"}),
      cell(c.area_terreno),
      cell(c.area_construida),
      cell(String(c.valor||"").replace(/,00$/,"")),
      cell(c.rs_m2_terreno,{bold:true}),
    ]);
    s.addTable([head,...rows],{x:MX,y:TY,w:5.95,colW:[1.0,1.85,0.95,0.85,1.15,1.15].map(w=>w*5.95/(1.0+1.85+0.95+0.85+1.15+1.15)),
      border:{type:"solid",color:LINE,pt:0.75},rowH,valign:"middle",fontFace:BODY,autoPage:false,margin:0.03});
    // callout: estatística do R$/m² de terreno (o que sustenta a faixa)
    const cx=6.75, cw=2.7;
    if (RG) {
      const ch = rowH * (comps.length + 1);
      s.addShape(p.shapes.RECTANGLE,{x:cx,y:TY,w:cw,h:ch,fill:{color:NAVY},line:{type:"none"},shadow:SH()});
      s.addText("R$/m² DE TERRENO",{x:cx+0.22,y:TY+0.12,w:cw-0.44,h:0.24,fontFace:BODY,fontSize:9,color:ICE,bold:true,charSpacing:1.5,margin:0,valign:"middle"});
      s.addText([
        {text:val.rs_m2_terreno_alvo||"",options:{fontSize:24,bold:true,color:WHITE,breakLine:true}},
        {text:"mediana (corrigida a hoje)",options:{fontSize:10,color:ICE,breakLine:true}},
        {text:`${RG.n_final} casas consideradas`,options:{fontSize:10,color:ICE,italic:true}},
      ],{x:cx+0.22,y:TY+0.42,w:cw-0.44,h:ch-0.5,fontFace:HEAD,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.05});

      // ---- RÉGUA: menor venda · faixa típica · este imóvel · maior venda ----
      const milharR = n => String(Math.round(Math.abs(Number(n)))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
      const rsTxt = v => "R$ " + milharR(v) + "/m²";
      const miTxt = v => v >= 995e3 ? "R$ " + (v/1e6).toFixed(2).replace(".", ",") + " mi" : "R$ " + Math.round(v/1e3) + " mil";
      const cap = t => String(t||"").toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
      const endTxt = x => [x.logradouro ? cap(x.logradouro) : "", x.numero != null ? String(x.numero) : ""].filter(Boolean).join(", ");
      const ry = TY + rowH*(comps.length+1) + 0.2;          // topo do bloco
      s.addText("ONDE ESTE IMÓVEL SE ENCAIXA",{x:MX,y:ry,w:5,h:0.22,fontFace:BODY,fontSize:9,color:RED,bold:true,charSpacing:1.5,margin:0,valign:"middle"});
      const bx0 = MX + 0.9, bx1 = MX + 8.9 - 0.9, by = ry + 0.86;   // linha da régua
      const lo = RG.min.rs, hi = RG.max.rs, span = Math.max(hi - lo, 1);
      const X = v => bx0 + (bx1 - bx0) * (Math.min(Math.max(v, lo), hi) - lo) / span;
      // trilho + faixa típica (p25–p75)
      s.addShape(p.shapes.RECTANGLE,{x:bx0,y:by-0.03,w:bx1-bx0,h:0.06,fill:{color:LINE},line:{type:"none"}});
      s.addShape(p.shapes.RECTANGLE,{x:X(RG.p25),y:by-0.11,w:Math.max(X(RG.p75)-X(RG.p25),0.05),h:0.22,fill:{color:ICETINT},line:{color:ICE,width:0.75}});
      // cada venda considerada = um ponto
      RG.pontos.forEach(v => s.addShape(p.shapes.OVAL,{x:X(v)-0.035,y:by-0.035,w:0.07,h:0.07,fill:{color:NAVY,transparency:35},line:{type:"none"}}));
      // este imóvel (mediana)
      const xm = X(RG.mediana);
      s.addShape(p.shapes.LINE,{x:xm,y:by-0.3,w:0,h:0.42,line:{color:RED,width:2}});
      s.addText([{text:"este imóvel  ",options:{color:RED,bold:true}},{text:miTxt(RG.eq_mediana),options:{color:NAVY,bold:true}}],
        {x:xm-1.3,y:by-0.52,w:2.6,h:0.2,fontFace:BODY,fontSize:10,align:"center",valign:"middle",margin:0});
      // faixa típica (abaixo da faixa)
      s.addText(`faixa típica (metade das vendas): ${miTxt(RG.eq_p25)} a ${miTxt(RG.eq_p75)}`,
        {x:(X(RG.p25)+X(RG.p75))/2-1.7,y:by+0.14,w:3.4,h:0.2,fontFace:BODY,fontSize:8.5,color:MUTED,align:"center",valign:"middle",margin:0});
      // pontas: vendas reais
      const pontaTxt = (x, rot, al, xx) => s.addText([
          {text:rot+"  ",options:{color:MUTED,breakLine:false}},{text:rsTxt(x.rs),options:{color:NAVY,bold:true,breakLine:true}},
          {text:`${endTxt(x)} · vendida por ${miTxt(x.valor)}`,options:{color:MUTED,breakLine:true}},
          {text:`lote ${milharR(x.area_terreno)} m²${x.area_construida ? ` · casa ${milharR(x.area_construida)} m²` : ""}`,options:{color:MUTED}},
        ],{x:xx,y:by-0.66,w:2.9,h:0.52,fontFace:BODY,fontSize:8,align:al,valign:"bottom",margin:0,lineSpacingMultiple:1.0});
      s.addShape(p.shapes.LINE,{x:bx0,y:by-0.1,w:0,h:0.2,line:{color:NAVY,width:1}});
      s.addShape(p.shapes.LINE,{x:bx1,y:by-0.1,w:0,h:0.2,line:{color:NAVY,width:1}});
      pontaTxt(RG.min, "menor R$/m²", "left", MX);
      pontaTxt(RG.max, "maior R$/m²", "right", MX + 8.9 - 2.9);
      // de onde vieram as vendas
      const lote = RG.faixa_lote_relaxada ? "" : ` (fora de ${milharR(RG.lote_min)} a ${milharR(RG.lote_max)} m²)`;
      s.addText(`${RG.n_total} vendas encontradas na região · ${RG.n_final} consideradas · descartadas: ${RG.desc_lote} por lote de tamanho muito diferente${lote} e ${RG.desc_curva} com valor fora da curva (40% acima ou abaixo do centro). Terreno e construção: Cadastro Fiscal/ITBI.${trunc?` Tabela: as ${MAXFIT} mais próximas.`:""}`,
        {x:MX,y:by+0.42,w:8.9,h:0.36,fontFace:BODY,fontSize:8.5,color:MUTED,italic:true,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.05});
    } else {
      s.addShape(p.shapes.RECTANGLE,{x:cx,y:1.7,w:cw,h:2.95,fill:{color:NAVY},line:{type:"none"},shadow:SH()});
      s.addText("R$/m² DE TERRENO",{x:cx+0.25,y:1.95,w:cw-0.5,h:0.3,fontFace:BODY,fontSize:9.5,color:ICE,bold:true,charSpacing:1.5,margin:0,valign:"middle"});
      s.addText([
        {text:val.rs_m2_terreno_alvo||"",options:{fontSize:26,bold:true,color:WHITE,breakLine:true}},
        {text:"mediana (corrigida a hoje)",options:{fontSize:11,color:ICE,breakLine:true}},
        {text:"",options:{breakLine:true,fontSize:8}},
        {text:`faixa típica: ${val.rs_m2_terreno_p25||""} a ${val.rs_m2_terreno_p75||""}`,options:{fontSize:11,color:ICE,breakLine:true}},
        {text:"",options:{breakLine:true,fontSize:6}},
        {text:`${val.n_comps||comps.length} casas comparáveis`,options:{fontSize:10.5,color:ICE,italic:true}},
      ],{x:cx+0.25,y:2.35,w:cw-0.5,h:2.2,fontFace:HEAD,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.05});
      s.addText(`Terreno e construção em m² (Cadastro Fiscal/ITBI). O comparável é o R$/m² de terreno — o que define o valor da casa.${trunc?`  ·  ${allComps.length} comparáveis no total; exibindo as ${MAXFIT} mais próximas.`:""}`,
        {x:MX,y:4.78,w:8.9,h:0.5,fontFace:BODY,fontSize:9.5,color:MUTED,italic:true,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.1});
    }
    footer(s,9);
  }

  // ===== SLIDE 10 — AMOSTRAS (anúncios ativos · preço pedido) — data-driven =====
  const PAR = (!(data.amostras||[]).length && val.parecidas && val.parecidas.n >= 3) ? val.parecidas : null;
  // 14/11 · sem anúncios informados, o slide 10 mostra as CASAS PARECIDAS vendidas (preço real pago)
  if (PAR) { let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"09 · Casas parecidas"); title(s,"Casas parecidas com a sua — vendas reais");
    const milharP = n => String(Math.round(Math.abs(Number(n)))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const miP = v => v >= 995e3 ? "R$ " + (v/1e6).toFixed(2).replace(/\.?0+$/,"").replace(".", ",") + " mi" : "R$ " + Math.round(v/1e3) + " mil";
    const nMi = v => (v/1e6).toFixed(2).replace(/\.?0+$/,"").replace(".", ",");
    const faixaMi = (a,b) => `R$ ${nMi(a)} a ${nMi(b)} mi`;
    const capP = t => String(t||"").toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
    // o banco devolve a data como Date (no teste local vinha texto)
    const mesAno = d => { const m = (d instanceof Date ? d.toISOString() : String(d||"")).match(/(\d{4})-(\d{2})/); const M=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"]; return m ? `${M[+m[2]-1]}/${m[1].slice(2)}` : String(d||""); };
    const chave = x => [x.data,x.logradouro,x.numero,x.valor].join("|");
    const mp = PAR.mais_parecida;
    s.addText(`Lote de ${milharP(PAR.lote[0])} a ${milharP(PAR.lote[1])} m² e casa de ${milharP(PAR.constr[0])} a ${milharP(PAR.constr[1])} m², vendidas nos últimos 3 anos · preço efetivamente pago (ITBI)`,
      {x:MX,y:1.32,w:8.9,h:0.3,fontFace:BODY,fontSize:11,color:MUTED,italic:true,align:"left",valign:"middle",margin:0});
    // até 9 linhas: as mais caras e as mais baratas sempre entram, e a mais parecida
    let lista = PAR.lista.slice();
    if (lista.length > 9) {
      const keep = new Set([0,1,2, lista.length-1, lista.length-2].map(i => chave(lista[i])));
      if (mp) keep.add(chave(mp));
      const meio = lista.filter(x => !keep.has(chave(x)));
      while (keep.size < 9 && meio.length) keep.add(chave(meio.shift()));
      lista = lista.filter(x => keep.has(chave(x)));
    }
    const hdrP=(t)=>({text:t,options:{fill:{color:NAVY},color:WHITE,bold:true,fontSize:9.5,align:"center",valign:"middle"}});
    const cellP=(t,o={})=>({text:String(t==null||t===""?"—":t),options:{fontSize:9,color:o.color||INK,align:o.align||"center",valign:"middle",fill:o.fill,bold:o.bold,italic:o.italic}});
    const rowsP = lista.map(x => {
      const eMp = mp && chave(x) === chave(mp);
      const f = eMp ? {color:ICETINT} : undefined;
      return [
        cellP(`${capP(x.logradouro)}, ${x.numero}${eMp ? "  ★ mais parecida" : ""}`,{align:"left",fill:f,bold:eMp}),
        cellP(`${milharP(x.area_terreno)} m²`,{fill:f}), cellP(`${milharP(x.area_construida)} m²`,{fill:f}),
        cellP(x.ano_construcao ? String(x.ano_construcao).slice(0,4) : "—",{fill:f}),
        cellP(mesAno(x.data),{fill:f}),
        cellP(miP(x.valor),{fill:f,bold:true}),
        cellP(x.na_conta ? " " : "fora da curva",{fill:f,color:MUTED,italic:true}),
      ];
    });
    s.addTable([["Endereço","Lote","Casa","Ano","Venda","Vendida por",""].map(hdrP), ...rowsP],{x:MX,y:1.68,w:6.1,colW:[2.1,0.65,0.65,0.5,0.6,0.85,0.75],
      border:{type:"solid",color:LINE,pt:0.75},rowH:0.3,valign:"middle",fontFace:BODY,autoPage:false,margin:0.03});
    // callout
    const vc = PAR.valores_corr, q = (a,b)=>a;  // valores de hoje, ordenados
    const qt = f => { const n=vc.length, pos=(n-1)*f, lo=Math.floor(pos), hi=Math.ceil(pos); return vc[lo] + (vc[hi]-vc[lo])*(pos-lo); };
    const cx=6.9, cw=2.55;
    s.addShape(p.shapes.RECTANGLE,{x:cx,y:1.68,w:cw,h:3.0,fill:{color:NAVY},line:{type:"none"},shadow:SH()});
    s.addText([
      {text:`${PAR.n} CASAS PARECIDAS`,options:{fontSize:9,color:ICE,bold:true,charSpacing:1.5,breakLine:true}},
      {text:"",options:{fontSize:5,breakLine:true}},
      {text:faixaMi(vc[0], vc[vc.length-1]),options:{fontSize:17,color:WHITE,bold:true,breakLine:true}},
      {text:"menor e maior, em valores de hoje",options:{fontSize:9,color:ICE,breakLine:true}},
      {text:"",options:{fontSize:6,breakLine:true}},
      {text:`metade entre ${faixaMi(qt(0.25), qt(0.75)).replace(" a ", " e ")}`,options:{fontSize:10,color:WHITE,bold:true,breakLine:true}},
      {text:"",options:{fontSize:6,breakLine:true}},
      ...(mp ? [{text:"A mais parecida com a sua",options:{fontSize:9,color:ICE,bold:true,breakLine:true}},
               {text:`${capP(mp.logradouro)}, ${mp.numero}: lote ${milharP(mp.area_terreno)} m², casa ${milharP(mp.area_construida)} m², vendida por ${miP(mp.valor)} em ${mesAno(mp.data)}.`,options:{fontSize:10,color:WHITE}}] : []),
    ],{x:cx+0.2,y:1.82,w:cw-0.4,h:2.8,fontFace:BODY,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.05});
    const nFora = PAR.lista.filter(x => !x.na_conta).length;
    s.addText(`Valores de hoje = preço pago corrigido pelo IPCA. ${nFora ? `"Fora da curva": venda real, mas com R$/m² de terreno mais de 40% acima ou abaixo do centro da região — aparece aqui, não entra no cálculo do valor. ` : ""}${PAR.descartadas_erro ? `${PAR.descartadas_erro} registro${PAR.descartadas_erro>1?"s":""} com valor incompatível (provável erro de cadastro ou venda de parte) ficou de fora.` : ""}`,
      {x:MX,y:4.78,w:8.9,h:0.42,fontFace:BODY,fontSize:8.5,color:MUTED,italic:true,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.05});
    footer(s,10);
  }
  else { let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"09 · Amostras"); title(s,"Comparáveis ativos — preço pedido");
    s.addText("Anúncios atuais semelhantes · calibram a estratégia de anúncio",{x:MX,y:1.32,w:8,h:0.3,fontFace:BODY,fontSize:12,color:MUTED,italic:true,align:"left",valign:"middle",margin:0});
    const amostras = data.amostras||[];
    if (amostras.length) {
      const hdrA=(t)=>({text:t,options:{fill:{color:NAVY},color:WHITE,bold:true,fontSize:11,align:"center",valign:"middle"}});
      const headA=["Imóvel","Bairro","Área","Pedido","R$/m²"].map(hdrA);
      const cellA=(t,o={})=>({text:String(t==null||t===""?"—":t),options:{fontSize:10.5,color:o.color||INK,align:o.align||"center",valign:"middle",fill:o.fill,bold:o.bold,hyperlink:o.hyperlink,underline:o.underline}});
      const MAXFIT=6;
      let src=amostras, truncA=0;
      if (amostras.length>MAXFIT){ src=amostras.slice(0,MAXFIT); truncA=amostras.length-MAXFIT; }
      const rowsA=src.map(a=>[
        cellA(a.nome||a.ref||a.titulo||"anúncio",{align:"left",
          ...(a.link?{hyperlink:{url:a.link,tooltip:"Abrir anúncio"},color:LINK,underline:true}:{})}),
        cellA(a.bairro),
        cellA(a.area),
        cellA(a.pedido,{bold:true}),
        cellA(a.valor_m2),
      ]);
      s.addTable([headA,...rowsA],{x:MX,y:1.7,w:5.95,
        colW:[1.95,1.35,0.9,1.0,0.95].map(w=>w*5.95/(1.95+1.35+0.9+1.0+0.95)),
        border:{type:"solid",color:LINE,pt:0.75},rowH:0.40,valign:"middle",fontFace:BODY,autoPage:false});
      const cx=6.75, cw=2.7;
      s.addShape(p.shapes.RECTANGLE,{x:cx,y:1.7,w:cw,h:2.95,fill:{color:NAVY},line:{type:"none"},shadow:SH()});
      s.addText("PREÇO PEDIDO",{x:cx+0.25,y:1.95,w:cw-0.5,h:0.3,fontFace:BODY,fontSize:9.5,color:ICE,bold:true,charSpacing:1.5,margin:0,valign:"middle"});
      s.addText([
        {text:`${amostras.length} anúncio${amostras.length>1?"s":""} ativo${amostras.length>1?"s":""}`,options:{fontSize:24,bold:true,color:WHITE,breakLine:true}},
        {text:"",options:{breakLine:true,fontSize:8}},
        {text:"O preço pedido calibra a estratégia de anúncio — não é valor fechado.",options:{fontSize:11,color:ICE,breakLine:true}},
        {text:"",options:{breakLine:true,fontSize:6}},
        {text:"O valor de mercado deste estudo vem das vendas reais (ITBI).",options:{fontSize:11,color:ICE}},
      ],{x:cx+0.25,y:2.4,w:cw-0.5,h:2.1,fontFace:HEAD,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.1});
      s.addText(`Anúncios ativos comparáveis (portais).${truncA?`  ·  ${amostras.length} no total; exibindo os ${MAXFIT} mais aderentes.`:""}  Preço pedido ≠ valor fechado.`,
        {x:MX,y:4.78,w:8.9,h:0.5,fontFace:BODY,fontSize:9.5,color:MUTED,italic:true,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.1});
    } else {
      s.addShape(p.shapes.RECTANGLE,{x:MX,y:1.95,w:8.9,h:1.5,fill:{color:PAPER},line:{color:LINE,width:1},shadow:SH()});
      s.addShape(p.shapes.RECTANGLE,{x:MX,y:1.95,w:0.09,h:1.5,fill:{color:RED},line:{type:"none"}});
      s.addText([
        {text:"Sem anúncios ativos comparáveis informados.",options:{fontSize:15,bold:true,color:NAVY,breakLine:true}},
        {text:"",options:{breakLine:true,fontSize:6}},
        {text:"Este estudo se baseia nas vendas reais (ITBI). Para incluir o preço pedido de casas concorrentes à venda, envie os links dos anúncios à EVA antes de gerar o estudo.",options:{fontSize:12.5,color:INK}},
      ],{x:MX+0.35,y:2.15,w:8.3,h:1.1,fontFace:BODY,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.25});
    }
    footer(s,10);
  }

  // ===== SLIDE 11 — CICLO DE VIDA (fixo + marcador de idade) =====
  { let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"10 · Ciclo de Vida"); title(s,"Por que o valor não é só inflação");
    s.addImage({data:ASSET.cicloVida,x:MX,y:1.55,w:6.55,h:6.55*5.0/10.6});
    if (im.idade_anos != null) {
      const imgX=MX, imgY=1.55, imgW=6.55, imgH=6.55*5.0/10.6;
      const PL=0.07, PR=0.97, PT=0.14, PB=0.76;
      const idadeM=Math.max(0, Math.min(40, Number(im.idade_anos)));
      const mx=imgX + (PL + (idadeM/40)*(PR-PL))*imgW;
      const yTop=imgY + PT*imgH, yBot=imgY + PB*imgH;
      s.addShape(p.shapes.LINE,{x:mx,y:yTop,w:0,h:yBot-yTop,line:{color:RED,width:1.5,dashType:"dash"}});
      const lblW=2.4, lx=Math.max(imgX, Math.min(mx-lblW/2, imgX+imgW-lblW));
      s.addText(`${im.predio_curto||"esta casa"} · ${Math.round(Number(im.idade_anos))} anos`,   // 14/11: idade real (o gráfico vai até 40; o marcador fica no fim)
        {x:lx,y:yTop-0.32,w:lblW,h:0.27,fontFace:BODY,fontSize:10.5,color:NAVY,bold:true,align:"center",valign:"middle",margin:0,fill:{color:ICETINT}});
    }
    const tx=7.3, tw=2.2;
    s.addText([
      {text:"O valor de uma casa é terreno (valoriza) + construção (deprecia).",options:{color:INK,breakLine:true,bold:true}},
      {text:"",options:{breakLine:true,fontSize:6}},
      {text:"O terreno é avaliado pelo R$/m² de casas vendidas na região; a construção, pelo custo de reposição.",options:{color:INK,breakLine:true}},
      {text:"",options:{breakLine:true,fontSize:6}},
      {text:"A construção entra somada e depreciada: quanto mais antiga, menos agrega ao valor final.",options:{color:INK}},
    ],{x:tx,y:1.7,w:tw,h:2.9,fontFace:BODY,fontSize:12,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.2});
    footer(s,11);
  }

  // ===== SLIDE 12 — MÉTODO DE AVALIAÇÃO (R$/m² terreno -> faixa) =====
  { let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"11 · Método"); title(s,"Do R$/m² de terreno ao valor");
    const cw=2.85, gap=0.2, y0=1.85, ch=1.5;
    const cards=[
      ["PISO · p25", val.rs_m2_terreno_p25||"", "comparáveis mais conservadores", NAVY],
      ["ALVO · mediana", val.rs_m2_terreno_alvo||"", "referência central da região", RED],
      ["TETO · p75", val.rs_m2_terreno_p75||"", "comparáveis mais valorizados", NAVY],
    ];
    cards.forEach((c,i)=>{ const x=MX+i*(cw+gap);
      s.addShape(p.shapes.RECTANGLE,{x:x,y:y0,w:cw,h:ch,fill:{color:PAPER},line:{color:LINE,width:1},shadow:SH()});
      s.addShape(p.shapes.RECTANGLE,{x:x,y:y0,w:0.09,h:ch,fill:{color:c[3]},line:{type:"none"}});
      s.addText(c[0],{x:x+0.28,y:y0+0.2,w:cw-0.45,h:0.3,fontFace:BODY,fontSize:9.5,color:MUTED,bold:true,charSpacing:1,margin:0});
      s.addText(c[1],{x:x+0.28,y:y0+0.5,w:cw-0.45,h:0.55,fontFace:HEAD,fontSize:23,bold:true,color:NAVY,align:"left",valign:"middle",margin:0});
      s.addText(c[2],{x:x+0.28,y:y0+1.05,w:cw-0.45,h:0.35,fontFace:BODY,fontSize:10.5,color:INK,align:"left",valign:"top",margin:0});
    });
    s.addText("COMO APLICAMOS",{x:MX,y:3.6,w:5,h:0.3,fontFace:BODY,fontSize:10.5,color:RED,bold:true,charSpacing:2,margin:0,valign:"middle"});
    const bul=(t)=>({text:t,options:{bullet:{code:"2022"},color:INK,breakLine:true}});
    s.addText([
      bul(`O terreno = R$/m² mediano × área do lote (${val.area_terreno?val.area_terreno+" m²":"do imóvel"}) — com piso, alvo e teto.`),
      bul("Usamos a mediana (não a média): uma venda atípica não distorce o resultado."),
      {text:"A construção é somada à parte, pelo custo de reposição depreciado conforme a idade.",options:{bullet:{code:"2022"},color:INK}},
    ],{x:MX,y:3.92,w:8.9,h:1.2,fontFace:BODY,fontSize:12.5,align:"left",valign:"top",margin:0,paraSpaceAfter:6});
    footer(s,12);
  }

  // ===== SLIDE 13 — CONCLUSÃO (valor de mercado + faixa) =====
  { let s=p.addSlide(); s.background={color:NAVY};
    barra(p,s,{x:8.05,y:0,h:0.8,w:1.05,color:RED});
    eyebrowWhite(s,"Conclusão",MX,0.55);
    s.addText("Valor de mercado estimado",{x:MX,y:1.15,w:9,h:0.5,fontFace:HEAD,fontSize:20,color:ICE,align:"left",valign:"middle",margin:0});
    s.addText(val.valor_mercado||"",{x:MX,y:1.7,w:9,h:1.1,fontFace:HEAD,fontSize:60,color:WHITE,bold:true,align:"left",valign:"middle",margin:0});
    s.addText("faixa de "+(val.faixa||""),{x:MX,y:2.85,w:9,h:0.4,fontFace:BODY,fontSize:15,color:ICE,align:"left",valign:"middle",margin:0});
    s.addShape(p.shapes.RECTANGLE,{x:MX,y:3.55,w:5.6,h:1.3,fill:{color:B.DARKBLUE},line:{color:B.NAVYLINE,width:1}});
    s.addShape(p.shapes.RECTANGLE,{x:MX,y:3.55,w:0.09,h:1.3,fill:{color:RED},line:{type:"none"}});
    s.addText([{text:"Valor do terreno (mediana)",options:{fontSize:11,color:ICE,bold:true,charSpacing:1,breakLine:true}},
      {text:val.rs_m2_terreno_alvo||"",options:{fontSize:30,color:WHITE,bold:true,breakLine:true}},
      {text:`× ${val.area_terreno?val.area_terreno+" m² de terreno":"área do lote"}`,options:{fontSize:11,color:ICE}}],
      {x:MX+0.3,y:3.7,w:5.2,h:1.05,fontFace:HEAD,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.05});
    s.addText(val.conclusao_apoio||"",{x:6.5,y:3.6,w:2.95,h:1.25,fontFace:BODY,fontSize:12,color:ICE,align:"left",valign:"middle",margin:0,lineSpacingMultiple:1.2});
    footer(s,13,true);
  }

  // ===== DECISÃO NO TEMPO (mesmos 3 slides do apartamento; no-op sem decisao_tempo) =====
  addDecisaoTempoSlides(p, data, { num: 12, footerStart: 14 });

  // ===== SLIDE 14 — RESSALVAS + CONTATO =====
  { let s=p.addSlide(); s.background={color:NAVY};
    barra(p,s,{x:8.05,y:0,h:0.8,w:1.05,color:RED});
    eyebrowWhite(s,"Ressalvas e Contato",MX,0.55);
    s.addText("Sobre este estudo",{x:MX,y:1.05,w:9,h:0.55,fontFace:HEAD,fontSize:24,color:WHITE,bold:true,align:"left",valign:"middle",margin:0});
    s.addText(marca(data.ressalvas) || "Este documento é um parecer de valor de mercado para fins de precificação e estratégia de venda — não constitui laudo de avaliação formal (NBR 14653). Baseia-se em dados públicos de ITBI (Prefeitura de São Paulo), no cadastro fiscal de lotes e em índices do IBGE disponíveis na data de elaboração. A avaliação separa terreno e construção (método do custo): o terreno pelo R$/m² de casas comparáveis vendidas na região (corrigido pelo IPCA), e a construção pelo custo de reposição depreciado conforme a idade (ano de construção do cadastro)" + (val.idade_avaliando_estimada ? `. A idade desta casa não foi informada: usamos a idade mediana das casas vendidas na região (${val.idade_avaliando} anos) — informe o ano de construção para refinar.` : "."),
      {x:MX,y:1.7,w:8.9,h:1.4,fontFace:BODY,fontSize:13,color:ICE,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.25});
    s.addShape(p.shapes.LINE,{x:MX,y:3.35,w:8.9,h:0,line:{color:B.NAVYLINE,width:1}});
    s.addImage({data:ASSET.logoBranco,x:MX,y:3.7,w:2.2,h:2.2*LOGO_H/LOGO_W});
    s.addText([{text:co.nome||"",options:{fontSize:20,bold:true,color:WHITE,breakLine:true}},
      {text:`CRECI ${co.creci||""} · ${co.unidade||""}`,options:{fontSize:13,color:ICE,breakLine:true}},
      {text:edata,options:{fontSize:11,color:B.NAVYMUTED}}],
      {x:6.0,y:3.7,w:3.45,h:1.2,fontFace:HEAD,align:"left",valign:"middle",margin:0,lineSpacingMultiple:1.15});
  }

  return p.writeFile({fileName: out});
}

module.exports = { buildEstudoCasa };
