// BACKEND/src/utils.js

/**
 * pick(obj, ['a','b']) -> retorna apenas as chaves definidas
 */
function pick(obj, keys) {
  const out = {};
  (keys || []).forEach((k) => {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined) {
      out[k] = obj[k];
    }
  });
  return out;
}

/**
 * Verifica se é um ID de grupo do WhatsApp.
 * Normalmente termina com '@g.us'
 */
function isGroupId(id) {
  return typeof id === 'string' && id.endsWith('@g.us');
}

/** Sessão padrão (fallback) */
const SESSION_FALLBACK = 'default';

/**
 * Normaliza o nome da sessão:
 * - trim()
 * - mantém apenas [A-Za-z0-9._-]
 * - limita a 64 chars
 * - se vazio após saneamento, retorna 'default'
 */
function normalizeSession(name = SESSION_FALLBACK) {
  const trimmed = String(name || '').trim();
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64);
  return safe || SESSION_FALLBACK;
}

/**
 * Retorna true se o nome ATUAL já está válido (ou seja,
 * não mudaria após normalizeSession) e não está vazio.
 */
function isValidSession(name) {
  if (typeof name !== 'string') return false;
  const norm = normalizeSession(name);
  return norm.length > 0 && norm === name;
}

/**
 * Lança erro se a sessão não for válida.
 * Útil para validar :session vindo de rota/cliente.
 */
function assertValidSession(name) {
  if (!isValidSession(name)) {
    throw new Error('Invalid session name');
  }
  return true;
}

module.exports = {
  pick,
  isGroupId,
  SESSION_FALLBACK,
  normalizeSession,
  isValidSession,
  assertValidSession,
};
