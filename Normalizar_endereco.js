const items = $input.all();
const out = [];

const stripAccents = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const clean = (s) => stripAccents(s).toUpperCase().replace(/\s+/g, ' ').trim();
const coreStreet = (street) =>
  clean(street).replace(/^(RUA|R|AV|AVENIDA|AL|ALAMEDA|TRAVESSA|TV|PRACA|ESTRADA|ESTR|RODOVIA|ROD|LARGO|VIELA|VILA)\s+/, '').trim();
const esc = (s) => String(s).replace(/'/g, "''");

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
    data = j; // fallback: agente mandou rua/numero soltos
  }

  const enderecoRaw = data.endereco || data.rua || data.logradouro || data.address ||
    [data.rua, data.numero].filter(Boolean).join(' ') || '';

  const flat = String(enderecoRaw).replace(/\s+/g, ' ').trim();
  // corta os specs (m², quartos, vagas, etc.) pra isolar a parte do endereço
  const head = flat.split(/,?\s*(?:\d+\s*)?(?:m²|m2|metros|área|area|quart|dorm|su[ií]te|vaga|banheir|vendas)/i)[0].trim();

  // numero: campo explícito vence; senão, o ÚLTIMO número da parte do endereço
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

  // O título do logradouro costuma vir ABREVIADO no ITBI (CAP/Capitão, DR/Doutor, CEL/Coronel...).
  // Além do núcleo completo, casamos também pelos últimos 2 tokens (que sobrevivem à abreviação),
  // e pegamos o building_key do prédio DOMINANTE. O fetchVendidos casa por número+CEP dessa chave.
  const toks = nucleo.split(' ').filter(Boolean);
  const tail = toks.length >= 3 ? toks.slice(1).join(' ') : nucleo;
  const ruaClause = (tail && tail !== nucleo)
    ? `(logradouro ILIKE '%${esc(nucleo)}%' OR logradouro ILIKE '%${esc(tail)}%')`
    : `logradouro ILIKE '%${esc(nucleo)}%'`;
  const sql = (nucleo && numero)
    ? `SELECT building_key, count(*) AS n FROM vendidos_itbi_usados WHERE ${ruaClause} AND numero::text = '${esc(numero)}' GROUP BY building_key ORDER BY n DESC LIMIT 1`
    : '';

  out.push({ json: { ...j, endereco_in: enderecoRaw, nucleo, numero, sql, _parse_ok: Boolean(nucleo && numero) } });
}

return out;