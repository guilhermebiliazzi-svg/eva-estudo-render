const input = $input.first().json || {};
let d = { ...input };
if (input.query) { try { Object.assign(d, JSON.parse(input.query)); } catch (e) {} }
const num = v => {
  if (v == null || v === '') return null;
  const m = String(v).match(/[\d.,]+/); if (!m) return null;
  let s = m[0]; s = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = parseFloat(s); return isFinite(n) ? n : null;
};
const stripPrefix = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
  .replace(/^(RUA|R|AV|AVENIDA|AL|ALAMEDA|TRAVESSA|TV|PRACA|PCA|ESTRADA|ESTR|RODOVIA|ROD|LARGO|VIELA|VILA)\s+/, '')
  .replace(/'/g, '').replace(/\s+/g, ' ').trim();
const phoneDigits = String(d.phone || '').replace(/\D/g, '');
const tail = phoneDigits.slice(-8);
const sql_corretor = `SELECT nome, apelido, creci, foto_url, instagram_handle FROM corretores_associados WHERE regexp_replace(phone,'[^0-9]','','g') LIKE '%${tail}' LIMIT 1`;
return [{ json: {
  phone: String(d.phone || ''),
  phone_e164: phoneDigits,
  tipo: String(d.tipo || 'casa').toLowerCase().includes('terreno') ? 'terreno' : 'casa',
  rua: stripPrefix(d.rua || d.logradouro || ''),
  numero: d.numero != null ? String(d.numero).replace(/[^0-9]/g, '') : '',
  area_terreno: num(d.area_terreno),
  area_construida: num(d.area_construida),
  testada: num(d.testada),
  uso_atual: d.uso_atual ? String(d.uso_atual) : '',
  padrao: ['baixo','normal','alto'].includes(String(d.padrao||'').toLowerCase().trim())
            ? String(d.padrao).toLowerCase().trim() : 'normal',
  renda_mensal: num(d.renda_mensal),
  sql_corretor,
}}];
