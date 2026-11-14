/**
 * EVA · orchestrator do Estudo de CASA DE RUA / TERRENO.
 *
 * Caminho de dados (espelha o orchestrator.js do apartamento, mas para casa):
 *   1. comps CRUS do ITBI (casas vendidas perto, via db_casa) — por rua+número (hoje)
 *      ou por raio geográfico ST_DWithin (depois do backfill de coordenada).
 *   2. valoração Método 2: R$/m² de terreno corrigido pelo IPCA -> mediana/p25/p75 -> faixa.
 *   3. formata comps (strings) e monta a ficha do imóvel.
 *   4. gera o PPTX (buildEstudoCasa).
 *
 * O `corretor` chega PRONTO no body (resolvido no n8n pelo phone), igual ao apartamento —
 * o orchestrator só repassa.
 */
const { fetchCompsByStreet, fetchCompsByRadius, fetchCompsByCondominio } = require("./db_casa");
const { buildValoracaoCasa } = require("./valoracao_casa");
const { buildEstudoCasa } = require("./estudo_casa_generator");
const { buildDecisaoTempo, cdiLiquido } = require("./decisao_tempo");
const { passoPara } = require("./valoracao");

// CUB — custo de reposição da construção (R$/m² construído) p/ o método do custo.
// >>> PLACEHOLDER: ajuste ao CUB-SP (SINDUSCON-SP) do padrão construtivo real. <<<
// Override por requisição via body.cub.
// CUB R1 (residência unifamiliar), R$/m² construído, SEM desoneração — fallback se a tabela cub_sp falhar.
// Valor de referência: Fev/2026 R1-Normal (SindusCon-SP). Atualizado mensalmente na tabela cub_sp pelo cron.
const CUB_PADRAO_SP = 2697.79;   // 14/11: R1-Normal out/2026 (SindusCon-SP) — o normal é vir da tabela cub_sp

// padrão construtivo (body.padrao) -> coluna da tabela cub_sp
const PADRAO_COL = { baixo: "r1_baixo", normal: "r1_normal", alto: "r1_alto" };

// Resolve o CUB na ordem: 1) override explícito body.cub; 2) tabela cub_sp pelo padrão; 3) fallback constante.
async function resolverCub(pool, body) {
  if (Number(body.cub) > 0) return Number(body.cub);                 // override explícito
  const padrao = String(body.padrao || "normal").toLowerCase();
  const col = PADRAO_COL[padrao] || PADRAO_COL.normal;               // whitelist (não interpola input cru)
  if (pool) {
    try {
      const { rows } = await pool.query(`SELECT ${col} AS cub FROM cub_sp ORDER BY mes_ref DESC LIMIT 1`);
      const v = rows[0] && Number(rows[0].cub);
      if (v > 0) return v;
    } catch (e) { console.error("resolverCub: falha lendo cub_sp (usando fallback):", e.message); }
  }
  return CUB_PADRAO_SP;                                              // fallback
}

// ---- formatadores de exibição ----
const milhar = n => String(Math.round(Math.abs(Number(n)))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const reais  = v => "R$ " + milhar(Math.round(Number(v) / 1000) * 1000) + ",00";
const rsM2   = v => v == null ? "—" : "R$ " + milhar(v) + "/m²";
const m2     = v => v == null || v === "" ? "—" : milhar(v) + " m²";
function dataBR(d) {
  if (!d) return "";
  const iso = String(d).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const x = new Date(d);
  return isNaN(x) ? String(d) : x.toLocaleDateString("pt-BR");
}
const capWords = s => String(s||"").toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());

// comps crus (db_casa) -> linhas formatadas pra tabela do slide
// 14/11: link do Google Maps de cada venda (ponto do lote quando há; senão, busca pelo endereço)
function mapsUrl(c, ruaBusca) {
  if (c && c.lat != null && c.lng != null && isFinite(c.lat) && isFinite(c.lng))
    return `https://www.google.com/maps/search/?api=1&query=${Number(c.lat).toFixed(6)},${Number(c.lng).toFixed(6)}`;
  const rua = (c && c.logradouro) || ruaBusca;
  if (!rua) return null;
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(`${rua}, ${c.numero || ""}, São Paulo - SP`);
}

function formatComps(rows, ruaBusca) {
  return rows.map(c => {
    const rua = c.logradouro ? capWords(c.logradouro) : (ruaBusca ? capWords(ruaBusca) : "");
    let endereco = rua ? `${rua}, ${c.numero}` : `nº ${c.numero}`;
    if (c.unidade) endereco = `${capWords(c.unidade)} · ${endereco}`;   // casa em condomínio: "Casa 12 · Al. Anapurus, 120"
    return {
      data: dataBR(c.data),
      endereco,
      area_terreno: m2(c.area_terreno),
      area_construida: m2(c.area_construida),
      valor: reais(c.valor),
      rs_m2_terreno: rsM2(c.rs_m2_terreno != null ? c.rs_m2_terreno : (c.area_terreno > 0 ? Math.round(c.valor / c.area_terreno) : null)),
      dist: c.dist,
      maps: mapsUrl(c, ruaBusca),
    };
  });
}

// monta o objeto imovel (titulo/subtitulo/predio_curto/ficha) a partir dos campos da casa,
// permitindo override por body.imovel
function montarImovel(body) {
  if (body.imovel && body.imovel.ficha) return body.imovel; // já veio pronto do n8n
  const tipo   = (body.tipo || "casa").toLowerCase() === "terreno" ? "Terreno" : "Casa";
  const rua    = capWords(body.rua_exibicao || body.rua || "");
  const numero = body.numero != null ? String(body.numero) : "";
  const endereco = [rua, numero].filter(Boolean).join(", ");
  // 14/11: idade da casa — body.idade_anos ou body.ano_construcao (a EVA passa o ano da ficha de captação)
  const anoC = parseInt(String(body.ano_construcao ?? "").replace(/\D/g, "").slice(0, 4), 10);
  const anoHoje = new Date().getFullYear();
  const idade = (body.idade_anos != null && body.idade_anos !== "" && Number.isFinite(Number(body.idade_anos)))
    ? Number(body.idade_anos)
    : (anoC >= 1850 && anoC <= anoHoje ? anoHoje - anoC : null);
  const ficha = [
    ["Tipo", tipo],
    ["Endereço", endereco || "—"],
    ["Área de terreno", m2(body.area_terreno)],
    ["Área construída", m2(body.area_construida)],
    ["Testada", body.testada ? `${milhar(body.testada)} m` : "—"],
    ["Uso atual", body.uso_atual ? capWords(body.uso_atual) : "—"],
  ];
  if (idade != null) ficha.push(["Ano de construção", anoC >= 1850 ? `${anoC} (${idade} anos)` : `${idade} anos`]);
  if (body.estado) ficha.push(["Estado", String(body.estado).charAt(0).toUpperCase() + String(body.estado).slice(1)]);
  return {
    titulo: `${tipo}${endereco ? " — " + endereco : ""}`,
    subtitulo: body.bairro ? `${capWords(body.bairro)}, São Paulo` : "São Paulo",
    predio_curto: endereco || tipo,
    ficha,
    foto_fachada: body.foto_fachada || (body.imovel && body.imovel.foto_fachada) || null,
    idade_anos: idade != null ? idade : (body.imovel && body.imovel.idade_anos),
  };
}

// 14/11 · anúncios à venda informados pelo corretor (links do site expandidos no n8n).
// Preço PEDIDO não entra na conta das vendas; serve de alerta. Só limita o valor recomendado quando
// o anúncio é parecido E informa o lote (dá para comparar casa com casa).
function analisarAnuncios(body, valorMercado) {
  const brutos = Array.isArray(body.anuncios) ? body.anuncios : [];
  const ac = Number(body.area_construida) || 0, lt = Number(body.area_terreno) || 0;
  const lista = brutos.map(a => ({
    titulo: a.titulo || a.codigo || "anúncio", codigo: a.codigo || "", url: a.url || "",
    valor: Number(a.valor) || 0, area_construida: Number(a.area_construida) || 0,
    area_terreno: Number(a.area_terreno) || 0, quartos: a.quartos != null ? Number(a.quartos) : null,
    idade: a.idade != null && a.idade !== "" ? Number(a.idade) : null,
  })).filter(a => a.valor > 0);
  if (!lista.length) return null;
  const constr = ac ? [Math.round(ac * 0.7), Math.round(ac * 1.45)] : null;
  const lote = lt ? [Math.round(lt * 0.75), Math.round(lt * 1.3)] : null;
  for (const a of lista) {
    const okC = constr && a.area_construida && a.area_construida >= constr[0] && a.area_construida <= constr[1];
    const okL = !a.area_terreno || !lote || (a.area_terreno >= lote[0] && a.area_terreno <= lote[1]);
    a.parecida = !!(okC && okL);
    a.lote_conhecido = !!(a.area_terreno && lote);
  }
  const par = lista.filter(a => a.parecida);
  const menor = par.length ? Math.min(...par.map(a => a.valor)) : null;
  const comLote = par.filter(a => a.lote_conhecido);
  const tetoLote = comLote.length ? Math.min(...comLote.map(a => a.valor)) : null;
  const mi = v => "R$ " + (v / 1e6).toFixed(2).replace(/\.?0+$/, "").replace(".", ",") + " mi";
  let mensagem = "", limite = null;
  if (valorMercado > 0 && menor != null) {
    const abaixo = par.filter(a => a.valor < valorMercado).length;
    if (tetoLote != null && tetoLote < valorMercado) {
      limite = tetoLote;
      mensagem = `Uma casa parecida, com lote parecido, pede ${mi(tetoLote)}. O valor de mercado do estudo foi limitado a esse pedido.`;
    } else if (abaixo) {
      mensagem = `${abaixo} de ${par.length} parecida${par.length > 1 ? "s" : ""} pede${abaixo > 1 ? "m" : ""} menos que o valor de mercado do estudo (${mi(valorMercado)}). O comprador vai comparar: veja idade, estado e lote antes de fixar o preço.`;
    } else {
      mensagem = `Todas as parecidas pedem mais que o valor de mercado do estudo (${mi(valorMercado)}): o preço fica competitivo na vitrine.`;
    }
  }
  return { lista, constr, lote, parecidas_n: par.length, menor_parecida: menor, limite, mensagem };
}

// núcleo: recebe comps já buscados + dados do imóvel -> PPTX
async function gerarEstudoCasa({ comps, body, assets, out, pool }) {
  const imovel = montarImovel(body);
  const cub = await resolverCub(pool, body);
  const valoracao = buildValoracaoCasa({
    comps,
    avaliando: { area_terreno: body.area_terreno, area_construida: body.area_construida, idade: imovel.idade_anos },
    ref: body.ref || body.estudo_data,
    opts: { cub },
  });
  const anuncios = analisarAnuncios(body, valoracao?._debug?.valor);
  if (anuncios && anuncios.limite && valoracao && valoracao._debug && valoracao._debug.valor > anuncios.limite) {
    valoracao.valor_mercado = "R$ " + (anuncios.limite / 1e6).toFixed(2).replace(".", ",") + " milhões";
    valoracao.valor_mercado_limitado = true;
  }
  // decisão no tempo (passo E) — piso da faixa (p25) como valor competitivo de venda rápida.
  // Casa de rua: sem condomínio por padrão (aceita body.condominio_mensal se houver, ex. vila fechada).
  const decisao_tempo = buildDecisaoTempo({
    piso:          valoracao?._debug?.piso,
    valor_mercado: valoracao?._debug?.valor,
    i_anual: cdiLiquido(0.139), // CDI (ago/2026) líquido de IR — manter em sincronia com orchestrator.js
    condominio_mensal: Number(body.condominio_mensal) || 0,
    iptu_anual:        Number(body.iptu_anual) || 0,
    aluguel_mensal:    Number(body.aluguel_mensal) || 0,
    aluguel_moradia:   Number(body.aluguel_moradia) || 0,   // 14/11: quem mora deixa de pagar este aluguel enquanto espera
    reside: body.reside === true || /^(sim|true|1|reside|mora)$/i.test(String(body.reside||"")),
    aluga:  body.aluga  === true || /^(sim|true|1|alugad)/i.test(String(body.aluga||"")) || Number(body.aluguel_mensal) > 0,
    preco_alvo: Number(body.preco_alvo) || null,
  });

  // 14/11 · CASA: a faixa (p25 · mediana · p75) é larga, então os cards de "esperar" usam o VALOR DE
  // MERCADO (mediana) e o TETO (p75) da própria faixa. A régua do apartamento (+5% / +15% sobre o piso)
  // dava cenários "otimistas" ABAIXO do valor de mercado (ex.: Lomas Valentinas 305: 1,47 mi < 1,53 mi).
  if (decisao_tempo && decisao_tempo.aplicavel !== false && decisao_tempo._debug) {
    const arred = v => Math.round(v / passoPara(v)) * passoPara(v);
    let vm = valoracao?._debug?.valor; const vt = valoracao?._debug?.teto;
    if (anuncios && anuncios.limite && vm > anuncios.limite) vm = anuncios.limite;   // 14/11: só com lote dos dois conhecido
    if (vm > 0) decisao_tempo._debug.valor_intermediario = arred(vm);
    if (vt > 0) decisao_tempo._debug.valor_superotimista = arred(vt);
    // 14/11: raridade de cada preço entre as casas parecidas vendidas (valores de hoje)
    const par = valoracao?.parecidas;
    if (par && par.n >= 3) {
      const rar = v => `${par.acima(v)} de ${par.n} casas parecidas venderam por isso ou mais`;
      if (vm > 0) decisao_tempo._debug.raridade_inter = `${par.acima(arred(vm))} de ${par.n} parecidas venderam por isso ou mais`;
      if (vt > 0) decisao_tempo._debug.raridade_otim = rar(arred(vt));
    }
  }

  // tabela do slide 9 usa os comps ENRIQUECIDOS (R$/m² de terreno LIMPO) p/ casar com o headline
  const compsFmt = formatComps(valoracao.comps || comps, body.rua);
  return buildEstudoCasa({
    imovel,
    corretor: body.corretor || {},
    comps: compsFmt,
    valoracao,
    decisao_tempo,
    estudo_data: body.estudo_data || "",
    unidade_stats: body.unidade_stats,
    unidade_regioes: body.unidade_regioes,
    unidade_texto: body.unidade_texto,
    ressalvas: body.ressalvas,
    anuncios,
  }, { assets, out });
}

// a partir do DB: busca os comps (rua+número hoje; ponto/raio depois) e gera
async function gerarEstudoCasaFromDB({ pool, assets, out, ...body }) {
  if (!pool) throw new Error("pool Postgres ausente");
  let comps;
  const condoFechado = body.condominio_fechado === true || /^(sim|true|1)$/i.test(String(body.condominio_fechado || ""));
  if (condoFechado) {
    // v3.7 · casa em CONDOMÍNIO FECHADO: comps só do próprio condomínio (fração ideal < 1);
    // a quota de terreno da avaliada (area_terreno do body) vem do carnê do IPTU.
    if (!body.rua || body.numero == null) throw new Error("rua e numero são obrigatórios (condomínio fechado)");
    comps = await fetchCompsByCondominio(pool, body.rua, body.numero, { janelaMeses: body.janelaMeses ?? 72 });
  } else if (body.ponto) {
    // modo raio geográfico (pós-backfill): body.ponto = 'SRID=4326;POINT(lng lat)'
    comps = await fetchCompsByRadius(pool, body.ponto, { raioMetros: body.raioMetros, janelaMeses: body.janelaMeses });
  } else {
    if (!body.rua || body.numero == null) throw new Error("rua e numero são obrigatórios (modo rua+número)");
    comps = await fetchCompsByStreet(pool, body.rua, body.numero, { raio: body.raio, janelaMeses: body.janelaMeses });
  }
  return gerarEstudoCasa({ comps, body, assets, out, pool });
}

module.exports = { mapsUrl, gerarEstudoCasa, gerarEstudoCasaFromDB, formatComps, montarImovel, analisarAnuncios };
