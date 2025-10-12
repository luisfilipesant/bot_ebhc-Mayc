// BACKEND/src/sessionManager.js
const wppconnect = require('@wppconnect-team/wppconnect');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');
const { isGroupId } = require('./utils');
const baseStore = require('./store');

// ===== Config =====
const WPP_DATA_DIR = process.env.WPP_DATA_DIR || '.wpp-data';
const SESSION_NAME_DEFAULT = process.env.SESSION_NAME || 'group-bot';
const PUPPETEER_EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || null;

// ~16 MB (limite prático do WhatsApp).
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

// ===== Estado por sessão =====
// sessions: Map<string, SessionState>
/**
 * SessionState = {
 *   client,
 *   status: { status: string },
 *   qrBase64: string|null,
 *   hostWid: string|null,
 *   hostNumber: string|null,
 *   inFlight: Set<string>, // groupId em envio para evitar duplicatas
 *   _onMsgAttached: boolean, // evita listeners duplicados
 * }
 */
const sessions = new Map();

let io = null;
function setIO(ioInstance) { io = ioInstance; }

// Helper para pegar o store (com fallback se ainda não houver forSession)
function getStore(session) {
  if (typeof baseStore.forSession === 'function') return baseStore.forSession(session);
  // fallback: store single-session (compat enquanto migramos)
  return baseStore;
}

// ===== Utilitários =====
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const nowISO = () => new Date().toISOString();

function normalizeStatus(s) {
  if (!s) return '';
  return String(s).trim().toLowerCase();
}
function isConnectedSession(state) {
  if (!state?.client) return false;
  const s = normalizeStatus(state?.status?.status);
  const ok = ['islogged', 'inchat', 'qrreadsuccess', 'connected', 'logged', 'online', 'main', 'normal'];
  return ok.includes(s);
}
function cleanMediaPath(p) {
  return (p && String(p).trim()) ? p : null;
}
function textOf(x) {
  return String(x || '').trim();
}
function safeBasename(p) {
  try { return path.basename(p); } catch { return 'file'; }
}
function parseSqliteTs(ts) {
  if (!ts) return null;
  const hasTZ = /[+-]\d{2}:\d{2}|Z$/i.test(ts);
  const isoish = ts.includes('T') ? ts : ts.replace(' ', 'T');
  const parsed = new Date(hasTZ ? isoish : `${isoish}Z`);
  return isNaN(parsed) ? null : parsed;
}
function isEmptySnapshotMessage(m) {
  if (!m) return true;
  const txt = textOf(m.text);
  const img = cleanMediaPath(m.image_path);
  const aud = cleanMediaPath(m.audio_path);
  const vid = cleanMediaPath(m.video_path);
  return !txt && !img && !aud && !vid;
}
function fileSizeOK(fp) {
  try {
    const { size } = fs.statSync(fp);
    return size <= MAX_MEDIA_BYTES;
  } catch { return false; }
}
function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch {}
}

// Emite com o nome clássico e inclui {session} no payload para compat.
function emit(event, payload) {
  if (!io) return;
  try { io.emit(event, payload); } catch {}
}

// ===== Grupos (por sessão) =====
async function getGroupsSafe(session, maxRetries = 3) {
  const state = sessions.get(session);
  if (!state?.client) return [];
  let lastErr = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const out = [];
      if (typeof state.client.listChats === 'function') {
        const chats = await state.client.listChats();
        for (const c of (chats || [])) {
          const id = c?.id?._serialized || c?.id;
          if (typeof id === 'string' && id.endsWith('@g.us')) {
            const name = c.name || c.formattedTitle || c.groupMetadata?.subject || 'Grupo';
            out.push({ id, name });
          }
        }
      }
      out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      return out;
    } catch (e) {
      lastErr = e;
      await sleep(1500);
    }
  }
  console.warn(`[${session}] getGroupsSafe falhou após retries:`, lastErr?.message);
  return [];
}

async function ensureGroupsPersisted(session) {
  const st = getStore(session);
  const groups = await getGroupsSafe(session);
  groups.forEach((g) => st.upsertGroup(g));
  return groups;
}

function shouldTargetGroup(session, groupId) {
  const st = getStore(session);
  const settings = st.getSettings();
  const selected = settings.selected_groups || [];
  if (settings.send_to_all) return true;
  if (!selected.length) return true;
  return selected.includes(groupId);
}

// ===== Resolução de mensagem efetiva (inclui video_path) =====
async function resolveEffectiveMessage(session, groupId) {
  const st = getStore(session);
  const settings = st.getSettings(); // pode ou não ter video_path global (compat)
  const preset = st.getGroupPreset(groupId) || null;

  // 1) PRESET
  if (preset) {
    const msgs = Array.isArray(preset.messages) ? preset.messages : [];
    const rIdx = Number.isFinite(preset.rotate_index) ? Number(preset.rotate_index) : 0;

    // 1.1) Snapshot (rotate)
    if (msgs.length > 0) {
      const safeIndex = ((rIdx % msgs.length) + msgs.length) % msgs.length;
      const cand = msgs[safeIndex] || null;
      if (cand && !isEmptySnapshotMessage(cand)) {
        const nextIdx = (safeIndex + 1) % msgs.length;
        return {
          text: textOf(cand.text),
          image_path: cleanMediaPath(cand.image_path),
          audio_path: cleanMediaPath(cand.audio_path),
          video_path: cleanMediaPath(cand.video_path),
          threshold: preset.threshold ?? settings.threshold ?? 10,
          _meta: { source: 'preset:snapshot', nextRotateIndex: nextIdx }
        };
      }
    }

    // 1.2) Template por grupo
    if (preset.template_id != null) {
      if (st.templateExists(preset.template_id)) {
        const tpl = st.getTemplate(preset.template_id);
        const txt = textOf(tpl?.text);
        const img = cleanMediaPath(tpl?.image_path);
        const aud = cleanMediaPath(tpl?.audio_path);
        const vid = cleanMediaPath(tpl?.video_path);
        if (txt || img || aud || vid) {
          return {
            text: txt,
            image_path: img,
            audio_path: aud,
            video_path: vid,
            threshold: preset.threshold ?? settings.threshold ?? 10,
            _meta: { source: `preset:template#${preset.template_id}` }
          };
        }
      } else {
        console.warn(`[${session}] template_id órfão no preset de ${groupId}: ${preset.template_id}`);
      }
    }
  }

  // 2) GLOBAL (template fixo / modo randômico / plain)
  if (settings.global_template_id != null && getStore(session).templateExists(settings.global_template_id)) {
    const tpl = getStore(session).getTemplate(settings.global_template_id);
    const txt = textOf(tpl?.text);
    const img = cleanMediaPath(tpl?.image_path);
    const aud = cleanMediaPath(tpl?.audio_path);
    const vid = cleanMediaPath(tpl?.video_path);
    if (txt || img || aud || vid) {
      return {
        text: txt, image_path: img, audio_path: aud, video_path: vid,
        threshold: settings.threshold ?? 10,
        _meta: { source: `global:template#${settings.global_template_id}` }
      };
    }
  }

  if (settings.random_mode) {
    const rtpl = getStore(session).pickRandomTemplate(); // já filtra vazio
    if (rtpl) {
      return {
        text: textOf(rtpl.text),
        image_path: cleanMediaPath(rtpl.image_path),
        audio_path: cleanMediaPath(rtpl.audio_path),
        video_path: cleanMediaPath(rtpl.video_path),
        threshold: settings.threshold ?? 10,
        _meta: { source: `global:random#${rtpl.id}` }
      };
    }
  }

  // Texto/mídia globais (compat — video_path pode nem existir no settings antigo)
  return {
    text: textOf(settings.text_message),
    image_path: cleanMediaPath(settings.image_path),
    audio_path: cleanMediaPath(settings.audio_path),
    video_path: cleanMediaPath(settings.video_path), // ok se undefined
    threshold: settings.threshold ?? 10,
    _meta: { source: 'global:plain' }
  };
}

// ===== Envio de preset (com .mp4 até 16MB) =====
async function sendPresetToGroup(session, groupId) {
  const state = sessions.get(session);
  if (!state?.client) return;

  try {
    const msg = await resolveEffectiveMessage(session, groupId);
    const files = [];
    const pushIf = (p) => { if (p && fs.existsSync(p)) files.push(p); };
    pushIf(msg.image_path);
    pushIf(msg.audio_path);
    pushIf(msg.video_path);
    const text = textOf(msg.text);

    if (!text && files.length === 0) {
      console.log(`[${session}] [sendPresetToGroup] Nada a enviar.`, groupId, msg?._meta);
      return;
    }

    // marca last_sent no início (protege cooldown em rajada)
    getStore(session).setLastSent(groupId, nowISO());

    if (files.length === 0) {
      await state.client.sendText(groupId, text);
    } else {
      for (let i = 0; i < files.length; i++) {
        const filePath = files[i];
        const filename = safeBasename(filePath);
        const mimeType = mime.lookup(filename) || 'application/octet-stream';

        // Tamanho máx. 16MB para qualquer mídia (especialmente vídeo)
        if (!fileSizeOK(filePath)) {
          console.warn(`[${session}] Skip media > 16MB: ${filename}`);
          continue;
        }

        const caption = i === 0 ? text : undefined;
        // WPPConnect: client.sendFile(to, filePath, filename, caption, mimeType)
        await state.client.sendFile(groupId, filePath, filename, caption, mimeType);
      }
    }

    // snapshot: avança rotate_index após envio OK
    if (msg?._meta?.source === 'preset:snapshot' && Number.isFinite(msg?._meta?.nextRotateIndex)) {
      getStore(session).bumpPresetRotateIndex(groupId, msg._meta.nextRotateIndex);
    }

    // zera contador e emite atualização
    getStore(session).reset(groupId);
    emit('counter:update', { ...(getStore(session).getCounter(groupId) || {}), session });
  } catch (err) {
    console.error(`[${session}] Erro ao enviar preset:`, err.message);
  }
}

// ===== Handler de mensagens recebidas (padrão interno) =====
async function onIncomingMessage(session, msg) {
  const state = sessions.get(session);
  if (!state?.client) return;

  try {
    const groupId = msg.chatId || msg.from || msg.to;
    const isGroup = msg.isGroupMsg || (groupId && isGroupId(groupId));
    if (!isGroup) return;

    // detectar mensagens próprias
    const authorId =
      msg.author ||
      msg.participant ||
      msg.sender?.id?._serialized ||
      msg.sender?._serialized ||
      msg.sender?.id;

    const fromMeFlag =
      msg.fromMe === true ||
      msg.sender?.isMe === true ||
      (state.hostWid && (authorId === state.hostWid || authorId === state.hostWid?._serialized)) ||
      (state.hostNumber && typeof authorId === 'string' && authorId.includes(state.hostNumber));

    if (fromMeFlag) return;

    // upsert grupo (nome amigável)
    getStore(session).upsertGroup({
      id: groupId,
      name: msg.chat?.name || msg.sender?.shortName || msg.sender?.pushname || 'Grupo',
    });

    if (!shouldTargetGroup(session, groupId)) return;

    // contador + broadcast
    getStore(session).increment(groupId);
    emit('counter:update', { ...(getStore(session).getCounter(groupId) || {}), session });

    // threshold + cooldown
    const grpCfg = getStore(session).getGroupPreset(groupId) || null;
    const global = getStore(session).getSettings();

    const enabled = (grpCfg && grpCfg.enabled !== undefined) ? grpCfg.enabled : global.enabled;
    if (!enabled) return;

    const th = Number(grpCfg?.threshold ?? global.threshold ?? 10);
    const cdSec = Number(grpCfg?.cooldown_sec || 0);
    const current = getStore(session).getCounter(groupId);

    if (cdSec > 0 && current?.last_sent) {
      const last = parseSqliteTs(current.last_sent);
      if (last) {
        const diffSec = (Date.now() - last.getTime()) / 1000;
        if (diffSec < cdSec) return; // em cooldown
      }
    }

    if (current.count >= th) {
      if (state.inFlight.has(groupId)) return;
      state.inFlight.add(groupId);
      console.log(`[${session}] [trigger] ${groupId} -> ${current.count}/${th}`);
      sendPresetToGroup(session, groupId)
        .catch(() => {})
        .finally(() => state.inFlight.delete(groupId));
    }
  } catch (e) {
    console.error(`[${session}] onIncomingMessage error:`, e.message);
  }
}

// ===== Lifecycle de sessão =====
// ATENÇÃO: agora aceita hooks com onMessage; se não vier, usa handler interno.
async function startSession(session = SESSION_NAME_DEFAULT, hooks = {}) {
  let state = sessions.get(session);
  if (state && isConnectedSession(state)) {
    // já existe/está logado — reemite status/QR
    emit('wpp:status', { ...(state.status || {}), session, hasClient: !!state.client, hasQR: !!state.qrBase64 });
    if (state.qrBase64) emit('wpp:qr', { session, base64: state.qrBase64, base64Qr: state.qrBase64, attempts: 0 });
    return state.client;
  }

  // cria estado novo
  state = {
    client: null,
    status: { status: 'STARTING' },
    qrBase64: null,
    hostWid: null,
    hostNumber: null,
    inFlight: new Set(),
    _onMsgAttached: false,
  };
  sessions.set(session, state);
  emit('wpp:status', { ...(state.status), session });

  // Garante pastas no volume persistido
  ensureDir(path.join(__dirname, '..', WPP_DATA_DIR, session));

  const createOpts = {
    session,
    // isola o perfil por sessão — evita lock do Chromium quando múltiplos containers/processos
    mkdirFolderToken: true,
    folderNameToken: path.join(WPP_DATA_DIR, session),
    createPathFileToken: true,
    autoClose: 0,
    puppeteerOptions: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      ...(PUPPETEER_EXECUTABLE_PATH ? { executablePath: PUPPETEER_EXECUTABLE_PATH } : {}),
    },
    catchQR: (base64Qr, /* asciiQR */ _ascii, attempts /* , urlCode */) => {
      // Guarda APENAS o base64 cru (sem prefixo), compat com front atual
      const raw = String(base64Qr || '')
        .replace(/^data:image\/png;base64,?/i, '')
        .replace(/\s+/g, '');
      state.qrBase64 = raw || null;
      if (!isConnectedSession(state)) {
        state.status = { status: 'QR' };
        emit('wpp:status', { ...(state.status), session });
      }
      emit('wpp:qr', { session, base64: state.qrBase64, base64Qr: state.qrBase64, attempts: Number(attempts) || 0 });
    },
    statusFind: (statusSession) => {
      state.status = { status: statusSession };
      emit('wpp:status', { ...(state.status), session });
    },
  };

  state.client = await wppconnect.create(createOpts);

  try { state.hostWid = await state.client.getWid?.(); } catch {}
  try { state.hostNumber = await state.client.getHostNumber?.(); } catch {}

  // Listener por sessão: usa hooks.onMessage se fornecido; senão o handler interno
  if (typeof state.client?.onMessage === 'function' && !state._onMsgAttached) {
    if (hooks?.onMessage && typeof hooks.onMessage === 'function') {
      state.client.onMessage((m) => hooks.onMessage(m));
    } else {
      state.client.onMessage((m) => onIncomingMessage(session, m));
    }
    state._onMsgAttached = true;
  }

  // Primeira carga de grupos (tentativas)
  (async () => {
    for (const ms of [2000, 5000, 10000]) {
      await sleep(ms);
      const groups = await ensureGroupsPersisted(session);
      if (groups.length > 0) break;
    }
    emit('groups:refresh', { session, groups: await getGroupsSafe(session) });
  })();

  return state.client;
}

// Wrapper compatível com o seu bot.js
async function createSession(session = SESSION_NAME_DEFAULT, ioInstance = null, hooks = {}) {
  if (ioInstance) setIO(ioInstance);
  return startSession(session, hooks);
}

async function closeSession(session = SESSION_NAME_DEFAULT) {
  const state = sessions.get(session);
  try {
    if (state?.client) {
      await state.client.logout?.();
      await state.client.close?.();
    }
  } catch (e) {
    console.error(`[${session}] closeSession error:`, e.message);
  } finally {
    if (state) {
      state.client = null;
      state.status = { status: 'DISCONNECTED' };
      state.qrBase64 = null;
      state.inFlight.clear();
      state._onMsgAttached = false;
      emit('wpp:status', { ...(state.status), session });
    }
    // mantemos no Map com status = DISCONNECTED (útil para UI)
  }
}

// ===== Acesso/estado (para o bot.js) =====
function getClient(session = SESSION_NAME_DEFAULT) {
  const st = sessions.get(session);
  return st?.client || null;
}

function isConnected(session = SESSION_NAME_DEFAULT) {
  return isConnectedSession(sessions.get(session));
}

function getStatus(session = SESSION_NAME_DEFAULT) {
  const state = sessions.get(session);
  if (!state) return { session, status: 'DISCONNECTED', hasClient: false, hasQR: false };
  return { session, ...(state.status || {}), hasClient: !!state.client, hasQR: !!state.qrBase64 };
}
function getQR(session = SESSION_NAME_DEFAULT) {
  const state = sessions.get(session);
  return state?.qrBase64 || null;
}

function listSessions() {
  const out = [];
  for (const [name, st] of sessions) {
    out.push({
      session: name,
      status: st?.status?.status || 'DISCONNECTED',
      hasClient: !!st?.client,
      hasQR: !!st?.qrBase64,
    });
  }
  return out;
}

// Remove somente a pasta da sessão (para "resetar" o login)
// Retorna true/false
function cleanupSessionData(session = SESSION_NAME_DEFAULT) {
  try {
    const tokenPath = path.join(__dirname, '..', WPP_DATA_DIR, session);
    if (fs.existsSync(tokenPath)) {
      fs.rmSync(tokenPath, { recursive: true, force: true });
      return true;
    }
    return false;
  } catch (e) {
    console.error(`[${session}] cleanupSessionData error:`, e.message);
    return false;
  }
}

module.exports = {
  // IO
  setIO,

  // Sessão
  startSession,        // ainda exposto (agora aceita hooks)
  createSession,       // compat com bot.js
  closeSession,
  getClient,           // compat com bot.js
  isConnected,         // compat com bot.js
  getStatus,
  getQR,
  listSessions,
  cleanupSessionData,

  // Grupos
  getGroupsSafe,
  ensureGroupsPersisted,

  // Envio
  sendPresetToGroup,

  // Acesso direto (se precisar)
  _sessions: sessions,
  _getStore: getStore,
};
