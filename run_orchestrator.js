/**
 * Teste do orquestrador no caminho puro: input do imóvel + vendidos (simulando o
 * retorno do Postgres) -> gera o .pptx completo. Prova C + D + B integrados.
 *
 *   node run_orchestrator.js
 */
const fs = require("fs");
const { gerarEstudo } = require("./orchestrator");

const input = JSON.parse(fs.readFileSync(__dirname + "/input_marquise.json", "utf8"));
const vendidosRows = JSON.parse(fs.readFileSync(__dirname + "/vendidos_rows_marquise.json", "utf8"));
const out = __dirname + "/Estudo_Orquestrado.pptx";

gerarEstudo({ ...input, vendidosRows, assets: "./assets", out })
  .then(({ contrato }) => {
    console.log("OK:", out);
    console.log("valoracao computada:", JSON.stringify(contrato.valoracao, null, 2));
  })
  .catch(e => { console.error("ERRO:", e); process.exit(1); });
