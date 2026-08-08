const items = $input.all();
const out = [];

const stripAccents = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const clean = (s) => stripAccents(s).toUpperCase().replace(/\s+/g, ' ').trim();
// ALTERAÇÃO 1: adicionado \.? para remover o prefixo mesmo quando vem com ponto ("AV.", "R.", "AL.")
const coreStreet = (street) =>
  clean(street).replace(/^(RUA|R|AV|AVENIDA|AL|ALAMEDA|TRAVESSA|TV|PRACA|ESTRADA|ESTR|RODOVIA|ROD|LARGO|VIELA|VILA)\.?\s+/, '').trim();
const esc = (s) => String(s).replace(/'/g, "''");
// v2: \b não é Unicode-aware — "paraíso" virava "ParaÍSo". Capitaliza só após início/espaço.
const cap = (s) => String(s||'').toLowerCase().replace(/(^|[\s\-])(\p{L})/gu, (m,a,b) => a + b.toUpperCase());
// v2: número tolerante a "98,5" / "98 m²"
const num = (v) => { const n = Number(String(v ?? '').replace(',', '.').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };

for (const it of items) {
  const j = it.json || {};
  let raw = j.query;

  // query pode vir: objeto, string JSON, prosa, ou campos soltos no próprio item
  let data = {};
  if (raw && typeof raw === 'object') {
    data = raw;
  } else if (typeof raw === 'string') {
    const t = raw.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      try { data = JSON.parse(t); } catch (e) { data = { endereco: t }; }
    } else {
      data = { endereco: t };
    }
  } else {
    data = j;
  }

  const enderecoRaw = data.endereco || data.rua || data.logradouro || data.address ||
    [data.rua, data.numero].filter(Boolean).join(' ') || '';

  const flat = String(enderecoRaw).replace(/\s+/g, ' ').trim();
  let head = flat.split(/,?\s*(?:\d+\s*)?(?:m²|m2|metros|área|area|quart|dorm|su[ií]te|vaga|banheir|vendas)/i)[0].trim();
  // v2: remove sufixo de UNIDADE ("apto 91", "cj 112", "sala 131") antes de extrair o número do prédio —
  // senão o último número do texto (a unidade) era tomado como número do prédio.
  head = head.replace(/[,\s]*\b(?:apto|apt|ap|apartamento|cj|conj|conjunto|sala|loja|unid|unidade|casa)\.?\s*n?[ºo°]?\s*\d+[a-z]?\b/gi, ' ').replace(/\s+/g, ' ').trim();
  // v2: remove o TIPO no início do endereço ("Conjunto comercial Av. Paulista..." → "Av. Paulista...")
  // para o tipo não vazar pro nome da rua/título (o tipo é inferido de `flat`, que fica intacto).
  head = head.replace(/^(?:apartamento|apto|casa|cobertura|studio|kitnet|flat|terreno|loja|laje(?:\s+corporativa)?|sala(?:\s+comercial)?|conjunto(?:\s+comercial)?|cj)\s+(?=(?:rua|r|av|avenida|al|alameda|travessa|tv|praca|praça|estrada|estr|rodovia|rod|largo|viela|vila)\b\.?)/i, '').trim();

  let numero = data.numero != null ? String(data.numero).trim() : '';
  let beforeNum = head;
  if (!numero) {
    const nums = [...head.matchAll(/\d{1,6}/g)];
    if (nums.length) {
      const last = nums[nums.length - 1];
      numero = last[0];
      beforeNum = head.slice(0, last.index);
    }
  }

  let streetRaw = data.rua || data.logradouro || beforeNum;
  streetRaw = String(streetRaw).replace(/[,\-–\s]+$/, '');
  const nucleo = coreStreet(streetRaw);

  // ALTERAÇÃO 2: normaliza o lado do banco também — remove acentos/cedilha e força maiúsculas
  // antes de comparar, para que "REBOUÇAS" no banco case com "REBOUCAS" do JS.
  const sql = (nucleo && numero)
    ? `SELECT building_key, count(*) AS n FROM vendidos_itbi_usados WHERE translate(upper(logradouro), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC') LIKE '%${esc(nucleo)}%' AND numero::text = '${esc(numero)}' GROUP BY building_key ORDER BY n DESC LIMIT 1`
    : '';

  // ============ CONSTRÓI O `imovel` PARA O HANDLER ============
  // (independe do agente passar — quase nunca passa completo)
  const ruaPretty = cap(streetRaw).replace(/\s+/g, ' ').trim();
  const bairro = data.bairro ? cap(data.bairro) : '';
  const cidade = data.cidade ? cap(data.cidade) : 'São Paulo';
  const condominio = data.condominio || data.predio || data.empreendimento || '';

  // v2 · ALTERAÇÃO 3: mapa de tipos ampliado + inferência por texto
  // (fix melhoria 1: sala comercial saía como "Apartamento" quando o agente não passava tipo)
  const tipoMap = {
    ap:'Apartamento', apto:'Apartamento', apartamento:'Apartamento',
    casa:'Casa', cobertura:'Cobertura', studio:'Studio', kitnet:'Kitnet', flat:'Flat',
    sala:'Sala comercial', 'sala comercial':'Sala comercial', escritorio:'Sala comercial',
    conjunto:'Conjunto comercial', 'conjunto comercial':'Conjunto comercial', cj:'Conjunto comercial',
    laje:'Laje corporativa', 'laje corporativa':'Laje corporativa', loja:'Loja'
  };
  const tipoKey = stripAccents(String(data.tipo||'').toLowerCase().trim());
  let tipo = tipoMap[tipoKey] || null;
  if (!tipo) {
    const texto = stripAccents((String(data.tipo||'') + ' ' + flat).toLowerCase());
    if (/\b(conjunto|cj)\b/.test(texto)) tipo = 'Conjunto comercial';
    else if (/\bsala\b|escritorio|\bcomercial\b/.test(texto)) tipo = 'Sala comercial';
    else if (/\blaje\b/.test(texto)) tipo = 'Laje corporativa';
    else if (/\bloja\b/.test(texto)) tipo = 'Loja';
    else tipo = 'Apartamento';
  }
  const isComercial = tipo === 'Sala comercial' || tipo === 'Conjunto comercial' ||
                      tipo === 'Laje corporativa' || tipo === 'Loja';

  const titulo = `${tipo} ${ruaPretty}${numero ? ', '+numero : ''}`;
  const subtitulo = [bairro, cidade].filter(Boolean).join(', ');
  const predio_curto = condominio || `${ruaPretty.split(' ').slice(-1)[0]} ${numero}`.trim();

  const area = num(data.area_util ?? data.area ?? data.metragem);
  // v2 · ALTERAÇÃO 4: área total do IPTU (obrigatória no prompt; base do match com o ITBI)
  const areaTotal = num(data.area_total ?? data.area_iptu ?? data.area_construida);
  const quartos = data.quartos ?? data.dormitorios ?? data.dorms;
  const banheiros = data.banheiros ?? data.wc ?? data.wcs;
  const suites = data.suites;
  const vagas = data.vagas;

  const ficha = [];
  ficha.push(['Endereço', `${ruaPretty}${numero?', '+numero:''}${bairro?' - '+bairro:''}`]);
  if (condominio) ficha.push([isComercial ? 'Edifício' : 'Condomínio', condominio]);
  if (area != null) ficha.push(['Área útil', `${area} m²`]);
  if (areaTotal != null) ficha.push(['Área total (IPTU)', `${areaTotal} m²`]);
  if (isComercial) {
    // v2 · ALTERAÇÃO 5: ficha comercial — banheiros no lugar de dormitórios/suítes
    if (banheiros != null) ficha.push(['Banheiros', String(banheiros)]);
  } else {
    if (quartos != null) ficha.push(['Dormitórios', String(quartos) + (suites!=null ? ` — sendo ${suites} suíte${suites>1?'s':''}` : '')]);
    else if (suites != null) ficha.push(['Suítes', String(suites)]);
  }
  if (vagas != null) ficha.push(['Vagas', String(vagas)]);
  if (data.posicao) ficha.push(['Posição', String(data.posicao)]);
  if (data.estado) ficha.push(['Estado', String(data.estado)]);

  // monta imovel sempre — sobrescreve o que o agente passou (que vinha incompleto/vazio)
  const imovel = {
    titulo,
    subtitulo,
    predio_curto,
    ficha,
    tipo,
    // idade_anos só se o agente/corretor informou — senão fica undefined e o slide 10 não inventa
    ...(data.idade_anos != null ? { idade_anos: Number(data.idade_anos) } : {}),
  };

  // amostras dentro do query (se o agente colocou; senão fica []; handler do /estudo pode buscar por phone)
  const amostrasFromQuery = Array.isArray(data.amostras) ? data.amostras : [];

  // v2 · ALTERAÇÃO 6: itbi_excluir — chaves "DD/MM/YYYY|UNIDADE" retiradas pelo corretor (PASSO 3.5)
  let itbiExcluir = j.itbi_excluir ?? data.itbi_excluir ?? [];
  if (typeof itbiExcluir === 'string') {
    const t = itbiExcluir.trim();
    if (!t || t === '[]') itbiExcluir = [];
    else if (t.startsWith('[')) { try { itbiExcluir = JSON.parse(t); } catch { itbiExcluir = []; } }
    else itbiExcluir = t.split(/[\n;]+/).map(s=>s.trim()).filter(Boolean);
  }
  if (!Array.isArray(itbiExcluir)) itbiExcluir = [];
  itbiExcluir = itbiExcluir.map(s => String(s).trim()).filter(Boolean);

  out.push({ json: {
    ...j,
    endereco_in: enderecoRaw,
    nucleo, numero, sql,
    _parse_ok: Boolean(nucleo && numero),
    imovel,
    tipo,                              // <-- v2
    is_comercial: isComercial,         // <-- v2
    area_util: area,                   // <-- v2
    area_total: areaTotal,             // <-- v2
    itbi_excluir: itbiExcluir,         // <-- v2
    amostras_from_query: amostrasFromQuery,
  }});
}

return out;
