/**
 * EVA · persistência de amostras aprovadas, por sessão (chave = phone).
 *
 * Resolve um problema concreto: o agente (LLM) frequentemente "esquece" de repassar
 * o array de amostras coletadas quando chama Gerar_Estudo_Mercado. A persistência
 * desacopla a coleta da geração: /amostras salva por phone, /estudo recupera por phone
 * quando o caller passou amostras vazias.
 *
 * Sem DATABASE_URL configurada, as funções viram no-op (não quebram o fluxo).
 * A tabela é criada on-demand; nada precisa rodar em separado.
 */
const TABLE = `
  CREATE TABLE IF NOT EXISTS amostras_sessao (
    phone TEXT PRIMARY KEY,
    amostras JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

const normPhone = p => String(p || "").replace(/\D/g, "");
let ensured = false;

async function ensure(pool) {
  if (!pool || ensured) return;
  await pool.query(TABLE);
  ensured = true;
}

async function saveAmostras(pool, phone, amostras) {
  const ph = normPhone(phone);
  if (!pool || !ph) return false;
  await ensure(pool);
  await pool.query(
    `INSERT INTO amostras_sessao (phone, amostras, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (phone) DO UPDATE SET amostras = EXCLUDED.amostras, updated_at = NOW()`,
    [ph, JSON.stringify(Array.isArray(amostras) ? amostras : [])]
  );
  return true;
}

async function getAmostras(pool, phone) {
  const ph = normPhone(phone);
  if (!pool || !ph) return [];
  try {
    await ensure(pool);
    const { rows } = await pool.query(
      `SELECT amostras FROM amostras_sessao WHERE phone = $1 LIMIT 1`,
      [ph]
    );
    return Array.isArray(rows[0]?.amostras) ? rows[0].amostras : [];
  } catch (e) {
    console.error("getAmostras error:", e.message);
    return [];
  }
}

async function clearAmostras(pool, phone) {
  const ph = normPhone(phone);
  if (!pool || !ph) return;
  await pool.query(`DELETE FROM amostras_sessao WHERE phone = $1`, [ph]);
}

module.exports = { saveAmostras, getAmostras, clearAmostras };
