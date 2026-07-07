/**
 * EVA · Proxy da API Consulta CND (SERPRO).
 *
 * Motivo: o resolver de DNS do n8n Cloud está falhando (EAI_AGAIN) para
 * gateway.apiserpro.serpro.gov.br desde 06/07/2026, enquanto o domínio
 * resolve normalmente fora do n8n. Esta rota tira o resolver do n8n do
 * caminho: o WF-03 chama o Render, e o Render fala com a SERPRO.
 *
 * POST /serpro/cnd
 *   Header:  Authorization: Basic <credenciais SERPRO em base64>  (obrigatório;
 *            é o MESMO header que o WF-03 já usa hoje no nó "Obter Token SERPRO")
 *   Body:    JSON repassado como está para /consulta-cnd/v1/certidao, ex.:
 *            { "TipoContribuinte": 2, "ContribuinteConsulta": "12345678901",
 *              "CodigoIdentificacao": "9002", "GerarCertidaoPdf": true }
 *   Retorno: o JSON da SERPRO, com o MESMO status HTTP que a SERPRO devolveu.
 *            O nó "Processar CND" do WF-03 continua lendo Status/Certidao/Mensagem
 *            sem nenhuma mudança.
 *
 * Sem credencial nova no Render: a rota só repassa o Basic recebido.
 */

const TOKEN_URL = "https://gateway.apiserpro.serpro.gov.br/token";
const CND_URL = "https://gateway.apiserpro.serpro.gov.br/consulta-cnd/v1/certidao";
const TIMEOUT_MS = 60000;

async function fetchComTimeout(url, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

module.exports = function (app) {
  app.post("/serpro/cnd", async (req, res) => {
    try {
      const auth = req.headers["authorization"] || "";
      if (!/^Basic\s+\S+/i.test(auth)) {
        return res.status(401).json({
          error: "Header 'Authorization: Basic <credenciais SERPRO>' obrigatório"
        });
      }

      // 1) Token (client_credentials) — mesmo fluxo do nó "Obter Token SERPRO"
      const tokenResp = await fetchComTimeout(TOKEN_URL, {
        method: "POST",
        headers: {
          "Authorization": auth,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "grant_type=client_credentials"
      });
      const tokenJson = await tokenResp.json().catch(() => ({}));
      if (!tokenResp.ok || !tokenJson.access_token) {
        console.error("/serpro/cnd: falha no token SERPRO", tokenResp.status, tokenJson);
        return res.status(502).json({
          error: "Falha ao obter token SERPRO",
          httpSerpro: tokenResp.status,
          respostaSerpro: tokenJson
        });
      }

      // 2) Consulta CND — body do caller repassado como está
      const cndResp = await fetchComTimeout(CND_URL, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + tokenJson.access_token,
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(req.body || {})
      });
      const cndJson = await cndResp.json().catch(() => ({}));

      // repassa o status HTTP da SERPRO pro n8n decidir (200, 4xx, 5xx)
      res.status(cndResp.status).json(cndJson);
    } catch (e) {
      const msg = String((e && e.message) || e);
      console.error("erro /serpro/cnd:", msg);
      res.status(500).json({ error: msg });
    }
  });
};
