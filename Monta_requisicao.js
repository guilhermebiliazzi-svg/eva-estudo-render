const t = $json || {};
const lng = t.lng, lat = t.lat;
const achou = (lng != null && lat != null);
const e = $('Ler entrada').first().json;
let cor = {};
try { cor = $('Buscar corretor').first().json || {}; } catch (err) { cor = {}; }
const corretor = {
  nome: cor.nome || '', apelido: cor.apelido || '', creci: cor.creci || '',
  foto_url: cor.foto_url || null, instagram_handle: cor.instagram_handle || '',
  unidade: 'RE/MAX Ville'
};
const body = {
  ponto: achou ? `SRID=4326;POINT(${lng} ${lat})` : null,
  raioMetros: 1500, janelaMeses: 36,
  tipo: e.tipo, rua: e.rua, numero: e.numero,
  area_terreno: e.area_terreno, area_construida: e.area_construida,
  testada: e.testada, uso_atual: e.uso_atual, padrao: e.padrao,
  corretor,
  estudo_data: new Date().toLocaleDateString('pt-BR')
};
return [{ json: { jsonBody: JSON.stringify(body), achou, phone: e.phone } }];
