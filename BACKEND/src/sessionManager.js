// BACKEND/src/sessionManager.js
/* eslint-disable no-console */
const wppconnect = require('@wppconnect-team/wppconnect');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');
const { isGroupId } = require('./utils');
const baseStore = require('./store');

/** =========================
 *  Config (via ENV)
 *  ========================= */
const WPP_DATA_DIR = process.env.WPP_DATA_DIR || '.wpp-data';
const SESSION_NAME_DEFAULT = process.env.SESSION_NAME || 'group-bot';
const PUPPETEER_EXECUTABLE_PATH =
  process.env.PUPPETEER_EXECUTABLE_PATH && String(process.env.PUPPETEER_EXECUTABLE_PATH).trim()
    ? process.env.PUPPETEER_EXECUTABLE_PATH
    : null;

// Timeouts (ms)
const WPP_DEVICE_SYNC_TIMEOUT = Number(process.env.WPP_DEVICE_SYNC_TIMEOUT || 300000); // 5 min
const WPP_PROTOCOL_TIMEOUT = Number(process.env.WPP_PROTOCOL_TIMEOUT || 300000);       // 5 min

// AutoClose (desliga com "false" string, ou 0/false)
const WPP_AUTO_CLOSE =
  process.env.WPP_AUTO_CLOSE === undefined
    ? 0
    : (String(process.env.WPP_AUTO_CLOSE).toLowerCase() === 'false'
        ? false
        : Number(process.env.WPP_AUTO_CLOSE) || 0);

// Limite prático do WhatsApp (~16MB)
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

/** =========================
 *  Estado
 *  ========================= */
/**
 * SessionState = {
 *   client,
 *   status: { status: string },
 *   qrBase64: string|null,
 *   hostWid: string|null,
 *   hostNumber: string|null,
 *   inFlight: Set<string>,
 *   _onMsgAttached: boolean,
 * }
 */
const sessions = new Map();
const creatingBySession = new Map(); // session -> Promise (lock start)
const closingBySession = new Map();  // session -> Promise (lock close)

let io = null;
function setIO(ioInstance) { io = ioInstance; }

// Store multi-sessão (fallback p/ legado single-session)
function getStore(session) {
  if (typeof baseStore.forSession === 'function') return baseStore.forSession(session);
  return baseStore;
}

/** =========================
 *  Helpers
 *  ========================= */
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
const nowISO = () => new Date().toISOString();
function normalizeStatus(s) { return String(s || '').trim().toLowerCase(); }
function textOf(x) { return String(x || '').trim(); }
function cleanMediaPath(p) { return (p && String(p).trim()) ? p : null; }
function safeBasename(p) { try { return path.basename(p); } catch { return 'file'; } }
function ensureDir(p) { try { fs.mkdirSync(p, { recursive: true }); } catch {} }
function fileSizeOK(fp) { try { return fs.statSync(fp).size <= MAX_MEDIA_BYTES; } catch { return false; } }
function emit(event, payload) { if (io) { try { io.emit(event, payload); } catch {} } }

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

/** =========================
 *  Conectividade/estados
 *  ========================= */
const CONNECTED_STATES = new Set([
  'islogged','inchat','qrreadsuccess','connected','logged','online','main','normal'
]);

function isConnectedSession(state) {
  if (!state?.client) return false;
  return CONNECTED_STATES.has(normalizeStatus(state?.status?.status));
}

function isReadyForGroups(state) {
  try {
    const st = (state?.status?.status || '').toString().toLowerCase().trim();
    return CONNECTED_STATES.has(st);
  } catch { return false; }
}

async function _isReallyLogged(state) {
  try {
    if (!state?.client) return false;
    return !!(await state.client.isLogged());
  } catch {
    return false;
  }
}

/** =========================
 *  Coleta de grupos (robusta)
 *  ========================= */
async function getGroupsSafe(session, maxRetries = 8) {
  const state = sessions.get(session);
  if (!state?.client) return [];
  let lastErr = null;
  let lastGateReason = '';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const logged = await _isReallyLogged(state);
      const readyByState = isReadyForGroups(state);

      if (!(logged || readyByState)) {
        lastGateReason = `gate:not-ready (isLogged=${logged}, status=${state?.status?.status || '-'})`;
        await sleep(800 + attempt * 250);
        continue;
      }

      // Preferência 1: getAllChats (WA-JS)
      if (typeof state.client.getAllChats === 'function') {
        const chats = await state.client.getAllChats();
        const out = (chats || [])
          .map(c => {
            const id =
              c?.id?._serialized || c?.id ||
              c?.wid?._serialized || c?.wid || '';
            const name =
              c?.name || c?.formattedTitle || c?.subject ||
              c?.groupMetadata?.subject || 'Grupo';
            const isGroup = c?.isGroup === true || (typeof id === 'string' && id.endsWith('@g.us'));
            return isGroup ? { id, name } : null;
          })
          .filter(Boolean)
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        if (out.length) return out;
      }

      // Preferência 2: listChats (WPPConnect wrapper antigo)
      if (typeof state.client.listChats === 'function') {
        const chats = await state.client.listChats();
        const out = (chats || [])
          .map(c => {
            const id = c?.id?._serialized || c?.id || '';
            const name = c?.name || c?.formattedTitle || c?.groupMetadata?.subject || 'Grupo';
            return (typeof id === 'string' && id.endsWith('@g.us')) ? { id, name } : null;
          })
          .filter(Boolean)
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        if (out.length) return out;
      }

      // Preferência 3: getAllGroups (depende da versão)
      if (typeof state.client.getAllGroups === 'function') {
        let groups = [];
        try { groups = await state.client.getAllGroups(); } catch {
          try { groups = await state.client.getAllGroups(true); } catch {}
        }
        const out = (groups || [])
          .map(g => ({
            id: g?.id?._serialized || g?.id || g?.wid?._serialized || g?.wid || '',
            name: g?.name || g?.subject || g?.formattedTitle || g?.groupMetadata?.subject || 'Grupo',
          }))
          .filter(x => typeof x.id === 'string' && x.id.endsWith('@g.us'))
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        if (out.length) return out;
      }

      // Nenhuma API trouxe grupos — esperar sync
      await sleep(1000 + attempt * 300);
    } catch (e) {
      lastErr = e;
      await sleep(1000 + attempt * 500); // backoff
    }
  }

  if (lastErr) {
    console.warn(`[${session}] getGroupsSafe falhou após retries (err):`, lastErr?.message || lastErr);
  } else {
    console.warn(
      `[${session}] getGroupsSafe falhou após retries (gate):`,
      lastGateReason || 'unknown'
    );
  }
  return [];
}

async function ensureGroupsPersisted(session) {
  const st = getStore(session);
  const groups = await getGroupsSafe(session);
  groups.forEach((g) => st.upsertGroup(g));
  return groups;
}

// refresh com múltiplas passadas (espera sync do WA-Web)
async function refreshGroups(session, { emitSocket = true, delaySeries = [0, 2000, 7000, 15000, 30000] } = {}) {
  let last = [];
  for (const d of delaySeries) {
    if (d > 0) await sleep(d);
    last = await ensureGroupsPersisted(session);
  }
  if (emitSocket) emit('groups:refresh', { session, groups: last });
  return last;
}

function shouldTargetGroup(session, groupId) {
  const st = getStore(session);
  const settings = st.getSettings();
  const selected = settings.selected_groups || [];
  if (settings.send_to_all) return true;
  if (!selected.length) return true;
  return selected.includes(groupId);
}

/** =========================
 *  Resolução de mensagem
 *  ========================= */
async function resolveEffectiveMessage(session, groupId) {
  const st = getStore(session);
  const settings = st.getSettings();
  const preset = st.getGroupPreset(groupId) || null;

  // 1) PRESET snapshot (com rotação)
  if (preset) {
    const msgs = Array.isArray(preset.messages) ? preset.messages : [];
    const rIdx = Number.isFinite(preset.rotate_index) ? Number(preset.rotate_index) : 0;

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

    // 1.2) PRESET por template
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

  // 2) GLOBAL template
  if (settings.global_template_id != null && st.templateExists(settings.global_template_id)) {
    const tpl = st.getTemplate(settings.global_template_id);
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

  // 3) GLOBAL random
  if (settings.random_mode) {
    const rtpl = st.pickRandomTemplate();
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

  // 4) Plain global
  return {
    text: textOf(settings.text_message),
    image_path: cleanMediaPath(settings.image_path),
    audio_path: cleanMediaPath(settings.audio_path),
    video_path: cleanMediaPath(settings.video_path),
    threshold: settings.threshold ?? 10,
    _meta: { source: 'global:plain' }
  };
}

/** =========================
 *  Envio (texto/imagem/áudio/vídeo)
 *  ========================= */
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

    // marca last_sent no início
    getStore(session).setLastSent(groupId, nowISO());

    if (files.length === 0) {
      await state.client.sendText(groupId, text);
    } else {
      for (let i = 0; i < files.length; i++) {
        const filePath = files[i];
        const filename = safeBasename(filePath);
        const mimeType = mime.lookup(filename) || 'application/octet-stream';

        if (!fileSizeOK(filePath)) {
          console.warn(`[${session}] Skip media > 16MB: ${filename}`);
          continue;
        }

        const caption = i === 0 ? text : undefined;
        await state.client.sendFile(groupId, filePath, filename, caption, mimeType);
      }
    }

    if (msg?._meta?.source === 'preset:snapshot' && Number.isFinite(msg?._meta?.nextRotateIndex)) {
      getStore(session).bumpPresetRotateIndex(groupId, msg._meta.nextRotateIndex);
    }

    getStore(session).reset(groupId);
    emit('counter:update', { ...(getStore(session).getCounter(groupId) || {}), session });
  } catch (err) {
    console.error(`[${session}] Erro ao enviar preset:`, err.message);
  }
}

/** =========================
 *  Handler de mensagens
 *  ========================= */
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

    // upsert grupo
    getStore(session).upsertGroup({
      id: groupId,
      name: msg.chat?.name || msg.sender?.shortName || msg.sender?.pushname || 'Grupo',
    });

    if (!shouldTargetGroup(session, groupId)) return;

    // contador + socket
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

/** =========================
 *  Lifecycle / criação da sessão
 *  ========================= */
function scheduleRefreshOnConnect(session, statusStr) {
  const st = normalizeStatus(statusStr);
  if (!CONNECTED_STATES.has(st)) return;
  // janela maior para completar sync de chats/grupos
  refreshGroups(session, { emitSocket: true, delaySeries: [0, 2000, 7000, 15000, 30000] })
    .catch((e) => console.warn(`[${session}] refresh pós-conexão falhou:`, e?.message));
}

async function _reallyStartSession(session = SESSION_NAME_DEFAULT, hooks = {}) {
  // Se já conectado, apenas reemite status/QR
  let state = sessions.get(session);
  if (state && isConnectedSession(state)) {
    emit('wpp:status', { ...(state.status || {}), session, hasClient: !!state.client, hasQR: !!state.qrBase64 });
    if (state.qrBase64) emit('wpp:qr', { session, base64: state.qrBase64, base64Qr: state.qrBase64, attempts: 0 });
    return state.client;
  }

  // Fecha cliente zumbi (sem logout)
  if (state?.client) {
    try { await state.client.close?.(); } catch {}
  }

  // Novo estado
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

  // Estrutura de pastas persistentes por sessão
  ensureDir(path.join(__dirname, '..', WPP_DATA_DIR, session));
  const sessionRoot = path.join(WPP_DATA_DIR, session);
  const tokenDir = path.join(sessionRoot, 'tokens');     // tokens
  const profileDir = path.join(sessionRoot, 'profile');  // perfil Chromium
  ensureDir(path.join(__dirname, '..', tokenDir));
  ensureDir(path.join(__dirname, '..', profileDir));

  // Opções de criação
  const createOpts = {
    session,

    tokenStore: 'file',
    folderNameToken: tokenDir,

    waitForLogin: true,
    autoClose: WPP_AUTO_CLOSE,
    deviceSyncTimeout: WPP_DEVICE_SYNC_TIMEOUT,

    useChrome: false,
    headless: true,
    logQR: false,
    updatesLog: true,
    debug: false,

    puppeteerOptions: {
      headless: true,
      userDataDir: path.join(__dirname, '..', profileDir),
      protocolTimeout: WPP_PROTOCOL_TIMEOUT,
      ...(PUPPETEER_EXECUTABLE_PATH ? { executablePath: PUPPETEER_EXECUTABLE_PATH } : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
      ],
    },

    catchQR: (base64Qr, _ascii, attempts) => {
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
      scheduleRefreshOnConnect(session, statusSession);
    },

    onLoadingScreen: (percent, message) => {
      emit('wpp:loading', { session, percent, message });
    },
  };

  // Cria cliente com 1 fallback limpando tokens, se necessário
  try {
    state.client = await wppconnect.create(createOpts);
  } catch (err) {
    console.warn(`[${session}] create() falhou: ${err?.message || err}`);
    try { cleanupSessionData(session); } catch {}
    await sleep(700);
    state.client = await wppconnect.create(createOpts);
  }

  try { state.hostWid = await state.client.getWid?.(); } catch {}
  try { state.hostNumber = await state.client.getHostNumber?.(); } catch {}

  // listeners
  if (typeof state.client?.onMessage === 'function' && !state._onMsgAttached) {
    if (hooks?.onMessage && typeof hooks.onMessage === 'function') {
      state.client.onMessage((m) => hooks.onMessage(m));
    } else {
      state.client.onMessage((m) => onIncomingMessage(session, m));
    }
    state._onMsgAttached = true;
  }

  try {
    if (typeof state.client?.onStateChange === 'function') {
      state.client.onStateChange((st) => {
        emit('wpp:state', { session, state: st });
        scheduleRefreshOnConnect(session, st);
      });
    }
  } catch {}

  // carga inicial de grupos após login “frio” (várias tentativas com backoff)
  (async () => {
    for (const ms of [2000, 5000, 10000, 20000]) {
      await sleep(ms);
      const groups = await ensureGroupsPersisted(session);
      if (groups.length > 0 && ms >= 5000) break;
    }
    emit('groups:refresh', { session, groups: await getGroupsSafe(session) });
  })();

  return state.client;
}

async function startSession(session = SESSION_NAME_DEFAULT, hooks = {}) {
  if (creatingBySession.has(session)) return creatingBySession.get(session);
  const p = (async () => _reallyStartSession(session, hooks))()
    .finally(() => creatingBySession.delete(session));
  creatingBySession.set(session, p);
  return p;
}

async function createSession(session = SESSION_NAME_DEFAULT, ioInstance = null, hooks = {}) {
  if (ioInstance) setIO(ioInstance);
  return startSession(session, hooks);
}

/** =========================
 *  Encerramento / Reset
 *  ========================= */
async function _closeOnly(session) {
  const state = sessions.get(session);
  try {
    if (state?.client) {
      // NÃO deslogar — só fecha o browser p/ manter tokens válidos
      await state.client.close?.();
    }
  } catch (e) {
    console.error(`[${session}] closeSession error:`, e.message);
  } finally {
    if (state) {
      state.client = null;
      state.status = { status: 'DISCONNECTED' };
      state.qrBase64 = null;
      state.inFlight?.clear?.();
      state._onMsgAttached = false;
      emit('wpp:status', { ...(state.status), session });
    }
  }
}

async function closeSession(session = SESSION_NAME_DEFAULT) {
  if (closingBySession.has(session)) return closingBySession.get(session);
  const p = (async () => _closeOnly(session))()
    .finally(() => closingBySession.delete(session));
  closingBySession.set(session, p);
  return p;
}

/**
 * wipeSession:
 * - Fecha o cliente (sem logout)
 * - Remove .wpp-data/<session> (tokens + profile)
 * - Faz retries com backoff
 */
async function wipeSession(session = SESSION_NAME_DEFAULT) {
  await closeSession(session);

  const base = path.resolve(path.join(__dirname, '..', WPP_DATA_DIR));
  const target = path.resolve(path.join(base, session));
  if (!target.startsWith(base)) throw new Error('Alvo inválido para wipe.');

  let lastErr = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      if (!fs.existsSync(target)) break;
    } catch (e) { lastErr = e; }
    await sleep(250 * (attempt + 1));
  }
  if (fs.existsSync(target)) {
    try { forceRemoveDir(target); } catch (e) { lastErr = e; }
  }
  if (fs.existsSync(target)) throw lastErr || new Error('Falha ao limpar sessão: arquivos ainda em uso.');

  const state = sessions.get(session);
  if (state) {
    state.client = null;
    state.qrBase64 = null;
    state.status = { status: 'DISCONNECTED' };
    state.inFlight?.clear?.();
    state._onMsgAttached = false;
  }
  emit('wpp:status', { session, status: 'DISCONNECTED' });
  return true;
}

function forceRemoveDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    let stat;
    try { stat = fs.lstatSync(p); } catch { continue; }
    try { fs.chmodSync(p, 0o666); } catch {}
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      forceRemoveDir(p);
    } else {
      try { fs.rmSync(p, { force: true }); } catch {}
    }
  }
  try { fs.rmdirSync(dir); } catch {}
}

/** =========================
 *  Getters / utilidades
 *  ========================= */
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

// Remove somente a pasta da sessão (reset do login)
function cleanupSessionData(session = SESSION_NAME_DEFAULT) {
  try {
    const target = path.join(__dirname, '..', WPP_DATA_DIR, session);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
      return true;
    }
    return false;
  } catch (e) {
    console.error(`[${session}] cleanupSessionData error:`, e.message);
    return false;
  }
}

/** =========================
 *  Exports
 *  ========================= */
module.exports = {
  // IO
  setIO,

  // Sessão
  startSession,
  createSession,
  closeSession,
  wipeSession,
  getClient,
  isConnected,
  getStatus,
  getQR,
  listSessions,
  cleanupSessionData,

  // Grupos
  getGroupsSafe,
  ensureGroupsPersisted,
  refreshGroups,

  // Envio
  sendPresetToGroup,

  // Debug
  _sessions: sessions,
  _getStore: getStore,
};
