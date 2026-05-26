/**
 * EVA · cliente do Cloudflare Browser Rendering (REST API).
 * Doc: https://developers.cloudflare.com/browser-rendering/rest-api/
 * Env: CF_ACCOUNT_ID, CF_API_TOKEN (token com permissão "Browser Rendering - Edit").
 *
 * Obs.: o /json usa Workers AI por baixo (custo por chamada, monitorável no dashboard).
 * Para SPAs/portais (CF, ZAP, etc.) usar waitUntil "networkidle0".
 */
const BASE = "https://api.cloudflare.com/client/v4/accounts";

function creds(cf = {}) {
  const accountId = cf.accountId || process.env.CF_ACCOUNT_ID;
  const apiToken = cf.apiToken || process.env.CF_API_TOKEN;
  if (!accountId || !apiToken) throw new Error("Faltam CF_ACCOUNT_ID / CF_API_TOKEN");
  return { accountId, apiToken };
}

async function call(endpoint, body, cf = {}) {
  const { accountId, apiToken } = creds(cf);
  const r = await fetch(`${BASE}/${accountId}/browser-rendering/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.success === false) {
    throw new Error(`CF /${endpoint} falhou (${r.status}): ${JSON.stringify(data.errors || data)}`);
  }
  return data.result;
}

// extrai dados estruturados de uma URL via schema + prompt (espera o JS renderizar)
function cfJson(url, { schema, prompt, waitUntil = "networkidle0", html, ...cf } = {}) {
  const body = { gotoOptions: { waitUntil } };
  if (html) body.html = html; else body.url = url;
  if (prompt) body.prompt = prompt;
  if (schema) body.response_format = { type: "json_schema", schema };
  return call("json", body, cf);
}

// pega os links de uma página (ex.: página de busca de um portal) — para o modo automático
function cfLinks(url, { waitUntil = "networkidle0", ...cf } = {}) {
  return call("links", { url, gotoOptions: { waitUntil } }, cf);
}

module.exports = { cfJson, cfLinks };
