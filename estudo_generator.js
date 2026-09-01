/**
 * Gerador do Estudo de Mercado RE/MAX Ville (PPTX editável).
 *
 * v2:
 *  - Suporte a SALA/CONJUNTO COMERCIAL (tipo em data.tipo / imovel.tipo): coluna "Banheiros"
 *    no lugar de "Suítes" nas amostras e linguagem neutra ("unidade"/"edifício").
 *  - Slide de Vendidos ITBI destaca as UNIDADES IDÊNTICAS em área (mesma área total IPTU
 *    da unidade avaliada) e traz o painel de m²: R$/m² das unidades idênticas (sobre a
 *    área útil informada) e R$/m² global do condomínio (base área construída ITBI).
 *  - Modo "global" (sem venda de unidade idêntica): conclusão apresenta o m² global do
 *    condomínio, sem valor fechado da unidade, com aviso explícito.
 *
 *   const { buildEstudo } = require("./estudo_generator");
 *   await buildEstudo(data, { assets: "/path/brand", out: "/path/estudo.pptx" });
 *
 * `data` segue o contrato em data_marquise.json (+ campos v2: tipo, area_total, area_util).
 */
const pptxgen = require("pptxgenjs");
const { vendidosAggregatedFromRows } = require("./itbi_format");
const { addDecisaoTempoSlides } = require("./decisao_tempo_slide");

const NAVY="10243F", RED="E4002B", ICE="CADCFC", WHITE="FFFFFF",
      INK="1A2332", MUTED="6B7280", LINE="E2E8F0", PAPER="FBFBFC",
      REDTINT="FCEFF1", ICETINT="EAF1FB", LINK="185FA5";
const HEAD="Georgia", BODY="Calibri";
const H=5.625, MX=0.55;

function buildEstudo(data, opts={}){
  // BLINDAGEM + AGREGAÇÃO: se vendidos vier cru do SQL (valor numérico / campo area_m2 / is_ancora),
  // AGREGA por data (apto + vagas mesmo dia somados em 1 linha) e formata. Idempotente.
  if (Array.isArray(data.vendidos) && data.vendidos.length &&
      (typeof data.vendidos[0].valor === "number" || "area_m2" in data.vendidos[0] || "is_ancora" in data.vendidos[0])) {
    data.vendidos = vendidosAggregatedFromRows(data.vendidos);
  }
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
  // ---- v2: tipo do imóvel / modo da valoração
  const tipoStr = String(data.tipo || im.tipo || im.titulo || "");
  const isComercial = /sala|conjunto|comercial|loja|laje|escrit/i.test(tipoStr) && !/apartamento/i.test(tipoStr);
  const modoGlobal = val.modo === "global";
  // área total de referência (IPTU) — vem do body (data.area_total) ou da própria valoração
  const areaTotalRef = Number(data.area_total) > 0 ? Number(data.area_total) : (Number(val.area_total_ref) > 0 ? Number(val.area_total_ref) : null);
  const areaFmt = v => String(Number(v)).replace(".", ",");
  // extrai número de "98,5 m²" / "R$ 700.000,00" formatados
  const numOf = v => {
    const m = String(v||"").match(/[\d.,]+/);
    if (!m) return 0;
    return Number(m[0].replace(/\./g,"").replace(",","."));
  };
  // preferência: flag `equivalente` marcada pelo orchestrator sobre os números CRUS (exata);
  // fallback: comparação sobre a área formatada (caminho blindagem, linhas cruas no body)
  const ehAreaIdentica = v => v.equivalente === true ||
    (areaTotalRef != null && Math.abs(numOf(v.area) - areaTotalRef) < 0.05);

  const edata = (typeof data.estudo_data === "string" && data.estudo_data.trim())
              || new Date().toLocaleDateString("pt-BR");

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
    const bioFallback = `Atua representando vendedores em ${co.unidade||"RE/MAX Ville"}, com método: precificação fundamentada em dados de ITBI, exposição na rede RE/MAX e negociação conduzida com discrição e transparência — para anunciar pelo valor certo e vender no tempo certo.`;
    s.addText(co.bio||bioFallback,{x:tx,y:2.95,w:5.45,h:1.8,fontFace:BODY,fontSize:14,color:INK,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.22});
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
    const steps=[["1","Vendidos no mesmo prédio","Transações reais de ITBI do próprio condomínio — só unidades de área idêntica à avaliada ancoram o valor."],
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

  // ===== SLIDE 8 — O IMÓVEL — grade dupla label/value =====
  { let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"07 · O Imóvel"); title(s,"O imóvel avaliado");
    const ficha = Array.isArray(im.ficha) ? im.ficha : [];
    const gridX = MX, gridY = 1.85;
    const colW  = 4.35, gap = 0.2, rowH = 0.95;
    const labelH = 0.30, valueH = 0.55;
    if (ficha.length === 0) {
      s.addText("Ficha técnica não fornecida pelo corretor.",
        {x:gridX,y:gridY+0.3,w:8.9,h:0.4,fontFace:BODY,fontSize:12,color:MUTED,italic:true,align:"left",valign:"middle",margin:0});
    } else {
      ficha.forEach((par, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = gridX + col * (colW + gap);
        const y = gridY + row * rowH;
        s.addText(String(par[0]||"").toUpperCase(),
          {x, y, w:colW, h:labelH, fontFace:BODY, fontSize:10, color:RED, bold:true, charSpacing:1.5, align:"left", valign:"top", margin:0});
        s.addText(String(par[1]||""),
          {x, y:y+labelH, w:colW, h:valueH, fontFace:HEAD, fontSize:17, color:NAVY, bold:true, align:"left", valign:"top", margin:0, lineSpacingMultiple:1.05});
        const lastRow = Math.floor((ficha.length-1)/2);
        if (row < lastRow) s.addShape(p.shapes.LINE,{x, y:y+rowH-0.05, w:colW, h:0, line:{color:LINE,width:0.5}});
      });
    }
    footer(s,8);
  }

  // ===== SLIDE 9 — AMOSTRAS (PEDIDO) — data-driven =====
  { let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"08 · Amostras"); title(s,"Comparáveis ativos — preço pedido");
    const hdr=(t)=>({text:t,options:{fill:{color:NAVY},color:WHITE,bold:true,fontSize:11,align:"center",valign:"middle"}});
    // v2: em imóvel comercial a coluna de suítes vira banheiros
    const head=["Imóvel","Bairro","Área",(isComercial?"Banh.":"Suítes"),"Vagas","Pedido","R$/m²"].map(hdr);
    const cell=(t,o={})=>({text:String(t),options:{fontSize:11,color:INK,align:o.align||"center",valign:"middle",fill:o.fill,bold:o.bold,...o}});
    const lk=(u)=>u?({hyperlink:{url:u,tooltip:"Abrir anúncio"},color:LINK,underline:true}):{};
    const amostrasRaw = data.amostras||[];
    // v3 · saneamento: o "avaliando" pode chegar com pedido numérico cru e sem R$/m² —
    // formata dinheiro, calcula R$/m² quando possível e nunca imprime "undefined".
    const brl = n => { n=Number(n); if(!(n>0)) return "";
      if(n>=1e6){ let s=(n/1e6).toFixed(2); if(s.endsWith("0")) s=s.slice(0,-1); return "R$ "+s.replace(".",",")+" mi"; }
      return "R$ "+String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,"."); };
    const digits = v => { const m=String(v==null?"":v).replace(/[^\d]/g,""); return m?Number(m):0; };
    // dinheiro em qualquer formato: 700000 · "R$ 700.000" · "R$ 1,45 mi" · "1,45 milhões"
    const money = v => {
      if (typeof v === "number") return v;
      const s = String(v ?? "");
      const mm = s.match(/([\d.,]+)\s*(mi|milh)/i);
      if (mm) return Math.round(parseFloat(mm[1].replace(/\./g,"").replace(",",".")) * 1e6);
      return digits(s);
    };
    const amostras = amostrasRaw.map(a=>{
      const out={...a};
      if (/^\s*\d+([.,]\d+)?\s*$/.test(String(out.pedido??""))) out.pedido = brl(out.pedido);
      if (out.pedido==null || out.pedido==="" || out.pedido==="undefined") out.pedido = "sob consulta";
      const vm = String(out.valor_m2??"");
      if (!vm || vm==="undefined" || vm==="null" || vm==="NaN"){
        const val = Number(out.valor) || money(out.pedido);
        const ar  = digits(out.area);
        const pm2 = (val>0 && ar>0) ? val/ar : 0;
        out.valor_m2 = (pm2 >= 1000 && pm2 <= 100000)
          ? String(Math.round(pm2)).replace(/\B(?=(\d{3})+(?!\d))/g,".") : "—";
      }
      if (out.area!=null && /^\s*\d+([.,]\d+)?\s*$/.test(String(out.area))) out.area = String(out.area)+" m²";
      return out;
    });
    const rows = amostras.map(a=>{
      const fill = a.tipo==="avaliando" ? {color:ICETINT} : a.tipo==="mesmo_predio" ? {color:REDTINT} : undefined;
      const boldName = a.tipo==="avaliando"||a.tipo==="mesmo_predio";
      const nameOpts = {align:"left", bold:boldName, ...(fill?{fill}:{}), ...(a.tipo!=="avaliando"?lk(a.link):{})};
      const c=(t)=> cell(t, fill?{fill}:{});
      return [cell(a.nome,nameOpts),c(a.bairro),c(a.area),c(a.suites),c(a.vagas),
        cell(a.pedido, {...(fill?{fill}:{}), bold:boldName}), c(a.valor_m2)];
    });
    // v3 · altura adaptativa: com muitas amostras a tabela encolhe em vez de invadir o rodapé
    const nRows = rows.length + 1; // + header
    const rowHAd = nRows <= 6 ? 0.5 : nRows <= 8 ? 0.38 : 0.3;
    s.addTable([head,...rows],{x:MX,y:1.75,w:8.9,colW:[2.5,1.25,0.95,0.85,0.85,1.3,1.2],
      border:{type:"solid",color:LINE,pt:0.75},rowH:rowHAd,valign:"middle",fontFace:BODY,autoPage:false});
    const tabelaFim = 1.75 + nRows*rowHAd;
    const mp = amostras.filter(a=>a.tipo==="mesmo_predio");
    let nota;
    if(mp.length){
      const partes=[{text:"Mesmo prédio à venda: ",options:{color:INK}}];
      mp.forEach((a,i)=>{ partes.push({text:`${a.ref||a.nome} (${a.suites} ${isComercial?"banh.":"suítes"}) ${a.pedido}`,options:{bold:true,color:RED}});
        if(i<mp.length-1) partes.push({text:" · ",options:{color:INK}}); });
      partes.push({text:".   ",options:{color:INK}});
      partes.push({text:"Azul",options:{color:LINK,bold:true}});
      partes.push({text:" = link do anúncio.",options:{color:INK}});
      nota=partes;
    } else {
      nota=[{text:data.amostras_nota||"Comparáveis ativos do mesmo perfil.",options:{color:INK}}];
    }
    const notaY = Math.max(4.55, Math.min(4.85, tabelaFim + 0.08));
    if (tabelaFim <= 4.85) s.addText(nota,{x:MX,y:notaY,w:8.9,h:0.42,fontFace:BODY,fontSize:10,align:"left",valign:"middle",margin:0});
    footer(s,9);
  }

  // ===== SLIDE 10 — VENDIDOS ITBI — data-driven (v2: unidades idênticas + painel de m²) =====
  { let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"09 · Vendidos"); title(s,"Transações reais — ITBI");
    s.addText("Mesmo prédio · Prefeitura de São Paulo",{x:MX,y:1.32,w:8,h:0.3,fontFace:BODY,fontSize:12,color:MUTED,italic:true,align:"left",valign:"middle",margin:0});
    const hdr=(t)=>({text:t,options:{fill:{color:NAVY},color:WHITE,bold:true,fontSize:11,align:"center",valign:"middle"}});
    const head=["Data","Unidade","Área constr.*","Valor","R$/m²"].map(hdr);
    const cell=(t,o={})=>({text:String(t),options:{fontSize:11,color:INK,align:o.align||"center",valign:"middle",fill:o.fill,bold:o.bold}});
    const HL={color:ICETINT};   // âncora
    const EQ={color:REDTINT};   // unidade idêntica em área (não-âncora)
    const allVend = data.vendidos||[];
    const MAXFIT = 8;
    let vend = allVend, trunc = 0;
    if (allVend.length > MAXFIT) {
      // prioriza: mais antiga (base da tendência) + unidades idênticas + mais recentes
      const primeiro = allVend[0];
      const prior = [...allVend.slice(1)].reverse()   // mais recentes primeiro
        .sort((a,b)=> (ehAreaIdentica(b)?1:0) - (ehAreaIdentica(a)?1:0)); // idênticas na frente (sort estável)
      const escolhidos = new Set([primeiro, ...prior.slice(0, MAXFIT-1)]);
      vend = allVend.filter(v => escolhidos.has(v)); // reexibe em ordem cronológica
      trunc = allVend.length - vend.length;
    }
    const rowH = vend.length > 6 ? 0.33 : 0.42;
    const rows = vend.map(v=>{
      const eq = ehAreaIdentica(v);
      const f = v.ancora ? HL : (eq ? EQ : undefined);
      const b = Boolean(v.ancora || eq);
      return [cell(v.data,{fill:f,bold:b}),cell(v.unidade,{fill:f,bold:b}),
        cell(v.area,{fill:f,bold:eq}),cell(v.valor,{fill:f,bold:b}),cell(v.valor_m2,{fill:f})];
    });
    s.addTable([head,...rows],{x:MX,y:1.7,w:5.7,colW:[1.15,1.55,1.1,1.1,0.8],
      border:{type:"solid",color:LINE,pt:0.75},rowH,valign:"middle",fontFace:BODY,autoPage:false});

    // ---- callout à direita: painel de m² (v2) ou tendência (legado)
    const cx=6.55, cw=2.9;
    s.addShape(p.shapes.RECTANGLE,{x:cx,y:1.7,w:cw,h:2.95,fill:{color:NAVY},line:{type:"none"},shadow:SH()});
    const temPainelM2 = Boolean(val.m2_equivalente_util || val.m2_global);
    if (temPainelM2 && !modoGlobal && val.m2_equivalente_util) {
      // modo equivalente: m² das idênticas (área útil) + m² global (área ITBI)
      s.addText("R$/M² — UNIDADES IDÊNTICAS",{x:cx+0.25,y:1.9,w:cw-0.5,h:0.28,fontFace:BODY,fontSize:9.5,color:ICE,bold:true,charSpacing:1.2,margin:0,valign:"middle"});
      s.addText([{text:val.m2_equivalente_util,options:{fontSize:21,bold:true,color:WHITE,breakLine:true}},
        {text:`sobre a área útil de ${val.area_util_ref?areaFmt(val.area_util_ref):"—"} m² · ${val.equivalentes_qtd} venda${val.equivalentes_qtd>1?"s":""} de ${areaFmt(areaTotalRef)} m² (IPTU)`,options:{fontSize:9.5,color:ICE}}],
        {x:cx+0.25,y:2.18,w:cw-0.5,h:0.85,fontFace:HEAD,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.08});
      s.addShape(p.shapes.LINE,{x:cx+0.25,y:3.12,w:cw-0.5,h:0,line:{color:"24395C",width:1}});
      s.addText("R$/M² GLOBAL DO CONDOMÍNIO",{x:cx+0.25,y:3.2,w:cw-0.5,h:0.28,fontFace:BODY,fontSize:9.5,color:ICE,bold:true,charSpacing:1.2,margin:0,valign:"middle"});
      s.addText([{text:val.m2_global||"",options:{fontSize:21,bold:true,color:WHITE,breakLine:true}},
        {text:"todas as vendas · área construída do ITBI",options:{fontSize:9.5,color:ICE}}],
        {x:cx+0.25,y:3.48,w:cw-0.5,h:0.85,fontFace:HEAD,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.08});
    } else if (temPainelM2 && modoGlobal) {
      // modo global: sem venda idêntica
      s.addText("SEM VENDA DE UNIDADE IDÊNTICA",{x:cx+0.25,y:1.9,w:cw-0.5,h:0.28,fontFace:BODY,fontSize:9.5,color:ICE,bold:true,charSpacing:1.2,margin:0,valign:"middle"});
      s.addText([{text:val.m2_global||"",options:{fontSize:24,bold:true,color:WHITE,breakLine:true}},
        {text:"R$/m² global do condomínio · área construída ITBI",options:{fontSize:10,color:ICE,breakLine:true}},
        {text:"",options:{breakLine:true,fontSize:6}},
        {text:`Nenhuma venda com ${areaFmt(areaTotalRef)} m² de área total — a referência é o m² global, não um valor fechado da unidade.`,options:{fontSize:9.5,color:ICE,italic:true}}],
        {x:cx+0.25,y:2.25,w:cw-0.5,h:2.2,fontFace:HEAD,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.12});
    } else {
      // legado: tendência (sem area_total informada)
      const de = vend[0]||{}, ate = vend.find(v=>v.ancora) || vend[vend.length-1] || {};
      const ehMesmoPonto = de && ate && de.data === ate.data && numOf(de.valor) === numOf(ate.valor);
      const dV = numOf(de.valor), aV = numOf(ate.valor);
      const diffPct = dV > 0 ? ((aV - dV) / dV) * 100 : 0;
      if (vend.length <= 1 || ehMesmoPonto) {
        s.addText("ÚNICA VENDA REGISTRADA",{x:cx+0.25,y:1.95,w:cw-0.5,h:0.3,fontFace:BODY,fontSize:9.5,color:ICE,bold:true,charSpacing:1.5,margin:0,valign:"middle"});
        s.addText([{text:String(ate.valor||de.valor||""),options:{fontSize:24,bold:true,color:WHITE,breakLine:true}},
          {text:yearOf(ate.data||de.data),options:{fontSize:12,color:ICE,breakLine:true}},
          {text:"",options:{breakLine:true,fontSize:6}},
          {text:"Histórico insuficiente para inferir tendência — apenas 1 transação na base.",options:{fontSize:10,color:ICE,italic:true}}],
          {x:cx+0.25,y:2.4,w:cw-0.5,h:2.0,fontFace:HEAD,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.1});
      } else {
        let direcao;
        if (Math.abs(diffPct) < 1)        direcao = "estabilidade em termos nominais";
        else if (diffPct > 0)              direcao = (diffPct > 20 ? "alta acima do IPCA" : "alta moderada");
        else                                direcao = (diffPct < -10 ? "queda em termos reais" : "queda leve");
        s.addText("TENDÊNCIA REAL DO PRÉDIO",{x:cx+0.25,y:1.95,w:cw-0.5,h:0.3,fontFace:BODY,fontSize:9.5,color:ICE,bold:true,charSpacing:1.5,margin:0,valign:"middle"});
        s.addText([{text:String(de.valor||""),options:{fontSize:20,bold:true,color:WHITE,breakLine:true}},
          {text:yearOf(de.data),options:{fontSize:11,color:ICE}}],
          {x:cx+0.25,y:2.3,w:cw-0.5,h:0.75,fontFace:HEAD,align:"left",valign:"top",margin:0});
        s.addText("→",{x:cx+0.25,y:3.0,w:cw-0.5,h:0.3,fontFace:BODY,fontSize:16,color:RED,bold:true,align:"left",valign:"middle",margin:0});
        s.addText([{text:String(ate.valor||""),options:{fontSize:20,bold:true,color:WHITE,breakLine:true}},
          {text:yearOf(ate.data)+" — "+direcao,options:{fontSize:11,color:ICE}}],
          {x:cx+0.25,y:3.35,w:cw-0.5,h:0.75,fontFace:HEAD,align:"left",valign:"top",margin:0});
      }
    }
    const notaIdenticas = areaTotalRef != null
      ? `  ·  Destaque: unidades com a MESMA área total da avaliada (${areaFmt(areaTotalRef)} m² IPTU) — só elas se comparam diretamente; o m² útil delas usa a área útil informada.`
      : "";
    s.addText(`* Área construída (IPTU, inclui áreas comuns) — base diferente do m² útil dos anúncios.${notaIdenticas}${trunc?`  ·  ${allVend.length} transações no total; exibindo ${vend.length}.`:""}`,
      {x:MX,y:4.78,w:8.9,h:0.5,fontFace:BODY,fontSize:9.5,color:MUTED,italic:true,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.1});
    footer(s,10);
  }

  // ===== SLIDE 11 — CICLO DE VIDA (chart fixo + texto data-driven) =====
  { let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"10 · Ciclo de Vida"); title(s,"Por que o valor não é só inflação");
    s.addImage({path:A+"ciclo_vida.png",x:MX,y:1.55,w:6.55,h:6.55*5.0/10.6});
    if (im.idade_anos != null) {
      const imgX=MX, imgY=1.55, imgW=6.55, imgH=6.55*5.0/10.6;
      const PL=0.07, PR=0.97, PT=0.14, PB=0.76;
      const idadeM=Math.max(0, Math.min(40, Number(im.idade_anos)));
      const mx=imgX + (PL + (idadeM/40)*(PR-PL))*imgW;
      const yTop=imgY + PT*imgH, yBot=imgY + PB*imgH;
      s.addShape(p.shapes.LINE,{x:mx,y:yTop,w:0,h:yBot-yTop,line:{color:RED,width:1.5,dashType:"dash"}});
      const lblW=2.4, lx=Math.max(imgX, Math.min(mx-lblW/2, imgX+imgW-lblW));
      s.addText(`${im.predio_curto||"este imóvel"} · ~${Number(im.idade_anos)} anos`,
        {x:lx,y:yTop-0.32,w:lblW,h:0.27,fontFace:BODY,fontSize:10.5,color:NAVY,bold:true,
         align:"center",valign:"middle",margin:0,fill:{color:ICETINT}});
    }
    const tx=7.3, tw=2.2;
    const predio=im.predio_curto||"imóvel";
    const idadeTxt = im.idade_anos!=null ? ` (~${im.idade_anos} anos)` : "";
    const vend=data.vendidos||[]; const de=vend[0]||{}, ate=vend.find(v=>v.ancora)||vend[vend.length-1]||{};
    // fase do ciclo pela idade real (mesmas faixas do gráfico): <12 maturação · 12–25 platô · >25 declínio real
    const idadeN = Number(im.idade_anos);
    const faseTxt = !(idadeN >= 0) ? "" : (idadeN < 12
      ? `ainda está na fase de maturação — o valor cresce, mas o ritmo do boom inicial não se projeta para a frente.`
      : (idadeN <= 25
        ? `está no platô — por isso projetar o boom para a frente seria um erro.`
        : `já passou do platô: a construção está em declínio real e o valor é sustentado pelo terreno e pela localização — não pela inflação.`));
    const terceiroParag = (im.idade_anos != null)
      ? `O ${predio}${idadeTxt} ${faseTxt}`
      : `Em prédios com histórico de venda forte como este, a fase do ciclo importa: o boom não se projeta linearmente para a frente.`;
    s.addText([
      {text:"O valor de um imóvel é terreno (valoriza) + construção (deprecia).",options:{color:INK,breakLine:true,bold:true}},
      {text:"",options:{breakLine:true,fontSize:6}},
      {text:"O total sobe nos primeiros anos, atinge um platô e depois cede em termos reais.",options:{color:INK,breakLine:true}},
      {text:"",options:{breakLine:true,fontSize:6}},
      {text:terceiroParag,options:{color:INK}},
    ],{x:tx,y:1.7,w:tw,h:2.9,fontFace:BODY,fontSize:12,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.2});
    const temPontas = de && de.valor && de.data && ate && ate.valor && ate.data;
    if (temPontas) {
      s.addText(`A tabela do ITBI confirma: ${de.valor} (${yearOf(de.data)}) → ${ate.valor} (${yearOf(ate.data)}).`,
        {x:MX,y:4.85,w:8.9,h:0.4,fontFace:BODY,fontSize:12,color:NAVY,bold:true,align:"left",valign:"middle",margin:0});
    }
    footer(s,11);
  }

  // ===== SLIDE 12 — PEDIDO x FECHADO + AJUSTE — data-driven =====
  if (!modoGlobal) { let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"11 · Pedido × Fechado"); title(s,"O ajuste no tempo e a depreciação");
    const cw=4.35, ch=1.4, y0=1.75;
    const concRealAd = val.concorrente_origem === "anuncio";
    const concEyebrow = concRealAd ? "CONCORRENTE DIRETO · MESMO PRÉDIO" : "TETO CALCULADO · IPCA";
    const concBullet  = concRealAd
      ? `Concorrente direto no mesmo prédio anunciado por ${val.concorrente_valor||""} — teto prático do anúncio.`
      : `Teto pela correção monetária da última venda real: ${val.concorrente_valor||""} (âncora × IPCA).`;
    s.addShape(p.shapes.RECTANGLE,{x:MX,y:y0,w:cw,h:ch,fill:{color:PAPER},line:{color:LINE,width:1},shadow:SH()});
    s.addShape(p.shapes.RECTANGLE,{x:MX,y:y0,w:0.09,h:ch,fill:{color:RED},line:{type:"none"}});
    s.addText(concEyebrow,{x:MX+0.28,y:y0+0.2,w:cw-0.45,h:0.3,fontFace:BODY,fontSize:9.5,color:MUTED,bold:true,charSpacing:1,margin:0});
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
    const passos = Array.isArray(val.passos_ajuste) ? val.passos_ajuste : [];
    if (passos.length) {
      // conta aberta, passo a passo (v3.5.1) — números que batem com a conclusão
      s.addText(passos.map((t,i)=>({text:t,options:{bullet:{code:"2022"},color:INK,breakLine:i<passos.length-1}})),
        {x:MX,y:3.78,w:8.9,h:1.4,fontFace:BODY,fontSize:11,align:"left",valign:"top",margin:0,paraSpaceAfter:4});
    } else {
      s.addText([
        bul(concBullet),
        bul(`Última venda real do prédio: ${val.ancora_valor||""} (${val.ancora_curto||""}) — base do valor de mercado.`),
        bul(concRealAd
          ? "Não se anuncia acima de uma unidade equivalente já disponível no mesmo condomínio."
          : "Sem concorrente direto no condomínio — ajuste se ancora apenas na venda real corrigida."),
        {text:"Depreciação e platô do ciclo de vida reforçam o ajuste — projeção capada, sem extrapolar o boom.",options:{bullet:{code:"2022"},color:INK}},
      ],{x:MX,y:3.78,w:8.9,h:1.3,fontFace:BODY,fontSize:12.5,align:"left",valign:"top",margin:0,paraSpaceAfter:6});
    }
    footer(s,12);
  } else {
    // ===== SLIDE 12 (MODO GLOBAL) — base de comparação pelo m² do condomínio =====
    let s=p.addSlide(); s.background={color:WHITE};
    eyebrow(s,"11 · Base de Comparação"); title(s,"Comparação pelo m² do condomínio");
    const cw=4.35, ch=1.4, y0=1.75;
    s.addShape(p.shapes.RECTANGLE,{x:MX,y:y0,w:cw,h:ch,fill:{color:NAVY},line:{type:"none"},shadow:SH()});
    s.addText("R$/M² GLOBAL DO CONDOMÍNIO · ITBI",{x:MX+0.25,y:y0+0.2,w:cw-0.5,h:0.3,fontFace:BODY,fontSize:9.5,color:ICE,bold:true,charSpacing:1,margin:0});
    s.addText([{text:val.m2_global||"",options:{fontSize:23,bold:true,color:WHITE,breakLine:true}},
      {text:"todas as vendas do prédio · área construída (IPTU)",options:{fontSize:11.5,color:ICE}}],
      {x:MX+0.25,y:y0+0.55,w:cw-0.5,h:0.8,fontFace:HEAD,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.1});
    const x2=MX+cw+0.2;
    s.addShape(p.shapes.RECTANGLE,{x:x2,y:y0,w:cw,h:ch,fill:{color:PAPER},line:{color:LINE,width:1},shadow:SH()});
    s.addShape(p.shapes.RECTANGLE,{x:x2,y:y0,w:0.09,h:ch,fill:{color:RED},line:{type:"none"}});
    s.addText("ÁREA TOTAL DA UNIDADE AVALIADA · IPTU",{x:x2+0.28,y:y0+0.2,w:cw-0.45,h:0.3,fontFace:BODY,fontSize:9.5,color:MUTED,bold:true,charSpacing:1,margin:0});
    s.addText([{text:(areaTotalRef!=null?`${areaFmt(areaTotalRef)} m²`:"—"),options:{fontSize:23,bold:true,color:NAVY,breakLine:true}},
      {text:"mesma base de área das vendas do ITBI",options:{fontSize:11.5,color:INK}}],
      {x:x2+0.28,y:y0+0.55,w:cw-0.45,h:0.8,fontFace:HEAD,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.1});
    s.addText("POR QUE NÃO HÁ VALOR FECHADO",{x:MX,y:3.45,w:5,h:0.3,fontFace:BODY,fontSize:10.5,color:RED,bold:true,charSpacing:2,margin:0,valign:"middle"});
    s.addText(val.aviso_sem_identica||"",
      {x:MX,y:3.78,w:8.9,h:1.3,fontFace:BODY,fontSize:12.5,color:INK,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.2});
    footer(s,12);
  }

  // ===== SLIDE 13 — CONCLUSÃO — data-driven =====
  { let s=p.addSlide(); s.background={color:NAVY};
    eyebrowWhite(s,"Conclusão",MX,0.55);
    if (modoGlobal) {
      s.addText("Valor do m² — condomínio (área construída ITBI)",{x:MX,y:1.15,w:9,h:0.5,fontFace:HEAD,fontSize:20,color:ICE,align:"left",valign:"middle",margin:0});
      s.addText(val.m2_global||"",{x:MX,y:1.7,w:9,h:1.1,fontFace:HEAD,fontSize:60,color:WHITE,bold:true,align:"left",valign:"middle",margin:0});
      s.addText(`sem venda de unidade idêntica (${areaTotalRef!=null?areaFmt(areaTotalRef):"—"} m² IPTU) — este estudo não fecha um valor para a unidade`,
        {x:MX,y:2.85,w:9,h:0.4,fontFace:BODY,fontSize:14,color:ICE,align:"left",valign:"middle",margin:0});
      s.addShape(p.shapes.RECTANGLE,{x:MX,y:3.55,w:5.6,h:1.3,fill:{color:"15294A"},line:{color:"24395C",width:1}});
      s.addShape(p.shapes.RECTANGLE,{x:MX,y:3.55,w:0.09,h:1.3,fill:{color:RED},line:{type:"none"}});
      s.addText([{text:"Como usar esta referência",options:{fontSize:11,color:ICE,bold:true,charSpacing:1,breakLine:true}},
        {text:`m² global × ${areaTotalRef!=null?areaFmt(areaTotalRef):"—"} m² (área total IPTU)`,options:{fontSize:18,color:WHITE,bold:true,breakLine:true}},
        {text:"leitura de referência — não é preço sugerido",options:{fontSize:11,color:ICE}}],
        {x:MX+0.3,y:3.7,w:5.2,h:1.05,fontFace:HEAD,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.05});
      s.addText(val.conclusao_apoio||"",{x:6.5,y:3.32,w:2.95,h:1.95,fontFace:BODY,fontSize:((val.conclusao_apoio||"").length>520?9:(val.conclusao_apoio||"").length>420?10:11.5),color:ICE,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.18});
    } else {
      const dtc = (data.decisao_tempo && data.decisao_tempo.aplicavel !== false) ? data.decisao_tempo : null;
      s.addText("Valor competitivo de mercado",{x:MX,y:1.15,w:9,h:0.5,fontFace:HEAD,fontSize:20,color:ICE,align:"left",valign:"middle",margin:0});
      s.addText((dtc ? dtc.p3 : (val.valor_mercado||"")),{x:MX,y:1.7,w:9,h:1.1,fontFace:HEAD,fontSize:60,color:WHITE,bold:true,align:"left",valign:"middle",margin:0});
      const subLinha = "recomendado para vender em até 3 meses"
        + (val.m2_equivalente_util ? `   ·   ${val.m2_equivalente_util} útil — unidades idênticas` : "");
      s.addText(subLinha,{x:MX,y:2.85,w:9,h:0.4,fontFace:BODY,fontSize:15,color:ICE,align:"left",valign:"middle",margin:0});
      s.addShape(p.shapes.RECTANGLE,{x:MX,y:3.55,w:5.6,h:1.3,fill:{color:"15294A"},line:{color:"24395C",width:1}});
      s.addShape(p.shapes.RECTANGLE,{x:MX,y:3.55,w:0.09,h:1.3,fill:{color:RED},line:{type:"none"}});
      s.addText([{text:"Valor potencial de mercado",options:{fontSize:11,color:ICE,bold:true,charSpacing:1,breakLine:true}},
        {text:val.valor_mercado||"",options:{fontSize:30,color:WHITE,bold:true,breakLine:true}},
        {text:"tempo médio de venda ~12 meses — sujeito aos riscos da próxima página",options:{fontSize:11,color:ICE}}],
        {x:MX+0.3,y:3.7,w:5.2,h:1.05,fontFace:HEAD,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.05});
      s.addText(val.conclusao_apoio||"",{x:6.5,y:3.32,w:2.95,h:1.95,fontFace:BODY,fontSize:((val.conclusao_apoio||"").length>520?9:(val.conclusao_apoio||"").length>420?10:11.5),color:ICE,align:"left",valign:"top",margin:0,lineSpacingMultiple:1.18});
    }
    footer(s,13,true);
  }

  // ===== DECISÃO NO TEMPO (após a Conclusão, no fim da apresentação) =====
  addDecisaoTempoSlides(p, data, { num: 12, footerStart: 14 });

  // ===== SLIDE 14 — RESSALVAS + CONTATO =====
  { let s=p.addSlide(); s.background={color:NAVY};
    eyebrowWhite(s,"Ressalvas e Contato",MX,0.55);
    s.addText("Sobre este estudo",{x:MX,y:1.05,w:9,h:0.55,fontFace:HEAD,fontSize:24,color:WHITE,bold:true,align:"left",valign:"middle",margin:0});
    s.addText(data.ressalvas || "Este documento é um parecer de valor de mercado para fins de precificação e estratégia de venda — não constitui laudo de avaliação formal (NBR 14653). Baseia-se em dados públicos de ITBI (Prefeitura de São Paulo), anúncios ativos comparáveis e índices do IBGE disponíveis na data de elaboração. A comparação entre unidades usa a área total construída (IPTU/ITBI); valores de mercado variam conforme as condições de negociação.",
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
