const items = $input.all();
const out = [];

const stripAccents = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const clean = (s) => stripAccents(s).toUpperCase().replace(/\s+/g, ' ').trim();
// ALTERAÇÃO 1: adicionado \.? para remover o prefixo mesmo quando vem com ponto ("AV.", "R.", "AL.")
const coreStreet = (street) =>
  clean(street).replace(/^(RUA|R|AV|AVENIDA|AL|ALAMEDA|TRAVESSA|TV|PRACA|ESTRADA|ESTR|RODOVIA|ROD|LARGO|VIELA|VILA)\.?\s+/, '').trim();
const esc = (s) => String(s).replace(/'/g, "''");
const cap = (s) => String(s||'').toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase());

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
  const head = flat.split(/,?\s*(?:\d+\s*)?(?:m²|m2|metros|área|area|quart|dorm|su[ií]te|vaga|banheir|vendas)/i)[0].trim();

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

  const tipoMap = { ap:'Apartamento', apto:'Apartamento', apartamento:'Apartamento',
                    casa:'Casa', cobertura:'Cobertura', sala:'Sala comercial', studio:'Studio', kitnet:'Kitnet' };
  const tipo = tipoMap[(data.tipo||'').toLowerCase()] || 'Apartamento';

  const titulo = `${tipo} ${ruaPretty}${numero ? ', '+numero : ''}`;
  const subtitulo = [bairro, cidade].filter(Boolean).join(', ');
  const predio_curto = condominio || `${ruaPretty.split(' ').slice(-1)[0]} ${numero}`.trim();

  const area = data.area_util ?? data.area ?? data.metragem;
  const quartos = data.quartos ?? data.dormitorios ?? data.dorms;
  const suites = data.suites;
  const vagas = data.vagas;

  const ficha = [];
  ficha.push(['Endereço', `${ruaPretty}${numero?', '+numero:''}${bairro?' - '+bairro:''}`]);
  if (condominio) ficha.push(['Condomínio', condominio]);
  if (area != null) ficha.push(['Área útil', `${area} m²`]);
  if (quartos != null) ficha.push(['Dormitórios', String(quartos) + (suites!=null ? ` — sendo ${suites} suíte${suites>1?'s':''}` : '')]);
  else if (suites != null) ficha.push(['Suítes', String(suites)]);
  if (vagas != null) ficha.push(['Vagas', String(vagas)]);
  if (data.posicao) ficha.push(['Posição', String(data.posicao)]);
  if (data.estado) ficha.push(['Estado', String(data.estado)]);

  // monta imovel sempre — sobrescreve o que o agente passou (que vinha incompleto/vazio)
  const imovel = {
    titulo,
    subtitulo,
    predio_curto,
    ficha,
    // idade_anos só se o agente/corretor informou — senão fica undefined e o slide 10 não inventa
    ...(data.idade_anos != null ? { idade_anos: Number(data.idade_anos) } : {}),
  };

  // amostras dentro do query (se o agente colocou; senão fica []; handler do /estudo pode buscar por phone)
  const amostrasFromQuery = Array.isArray(data.amostras) ? data.amostras : [];

  out.push({ json: {
    ...j,
    endereco_in: enderecoRaw,
    nucleo, numero, sql,
    _parse_ok: Boolean(nucleo && numero),
    imovel,                          // <-- novo
    amostras_from_query: amostrasFromQuery,  // <-- novo
  }});
}

return out;
