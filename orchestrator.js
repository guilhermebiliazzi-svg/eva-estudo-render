/**
 * EVA · Orquestrador do Estudo de Mercado — núcleo do serviço de render.
 *
 * Encadeia: vendidos (ITBI) -> formatação -> valoração -> contrato -> gerador PPTX.
 *
 *   const { gerarEstudo, gerarEstudoFromDB, montarContrato } = require("./orchestrator");
 *
 * Entrada (input do serviço), por imóvel:
 *   { imovel, corretor, amostras, estudo_data, ref, buildingKey }
 * onde `amostras` carrega tanto os campos de exibição (nome, area, pedido, link, tipo…)
 * quanto o `valor` numérico (R$) que a valoração usa.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildEstudo } = require("./estudo_generator");
const { vendidosFromRows } = require("./itbi_format");
const { buildValoracao } = require("./valoracao");

// monta o contrato completo a partir das partes (puro, sem I/O de imagem)
function montarContrato({ imovel, corretor, amostras = [], vendidosRows = [], estudo_data, ref, ressalvas }) {
  const vendidos = vendidosFromRows(vendidosRows); // bloco de exibição
  const vendidosNum = vendidosRows.map(r => ({     // números crus p/ a régua
    data: r.data, valor: Number(r.valor), unidade: r.unidade,
    ancora: r.is_ancora === true || r.is_ancora === "t" || r.is_ancora === 1,
  }));
  const valoracao = buildValoracao({ vendidos: vendidosNum, amostras, ref });
  return { estudo_data, corretor, imovel, amostras, vendidos, valoracao, ressalvas };
}

// baixa imagens http(s) para arquivos locais (EVA passa URLs do Supabase Storage/portais)
async function localizeImage(p, tmpdir) {
  if (!p || !/^https?:\/\//i.test(p)) return p;
  const res = await fetch(p);
  if (!res.ok) throw new Error("falha ao baixar imagem: " + p + " (" + res.status + ")");
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = (p.split("?")[0].match(/\.(png|jpe?g|webp)$/i) || [".png"])[0];
  const f = path.join(tmpdir, "img_" + Math.random().toString(36).slice(2) + ext);
  fs.writeFileSync(f, buf);
  return f;
}
async function prepareImages(contrato, tmpdir) {
  if (contrato.imovel) {
    contrato.imovel.foto_fachada = await localizeImage(contrato.imovel.foto_fachada, tmpdir);
    contrato.imovel.foto_interior = await localizeImage(contrato.imovel.foto_interior, tmpdir);
  }
  if (contrato.corretor) contrato.corretor.foto = await localizeImage(contrato.corretor.foto, tmpdir);
}

// caminho puro: recebe as linhas de vendidos já buscadas
async function gerarEstudo({ imovel, corretor, amostras, vendidosRows, estudo_data, ref, ressalvas, assets, out }) {
  const contrato = montarContrato({ imovel, corretor, amostras, vendidosRows, estudo_data, ref, ressalvas });
  await prepareImages(contrato, os.tmpdir());
  await buildEstudo(contrato, { assets, out });
  return { out, contrato };
}

// caminho de produção: busca os vendidos no Postgres pela building_key
async function gerarEstudoFromDB({ pool, buildingKey, ...rest }) {
  const { fetchVendidos } = require("./db");
  const vendidosRows = await fetchVendidos(pool, buildingKey);
  return gerarEstudo({ ...rest, vendidosRows });
}

module.exports = { montarContrato, gerarEstudo, gerarEstudoFromDB };
