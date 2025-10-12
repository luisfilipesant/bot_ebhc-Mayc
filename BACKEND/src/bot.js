// BACKEND/src/bot.js
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');

const sessionManager = require('./sessionManager');
const store = require('./store');
const { isGroupId } = require('./utils');

// ======= Config / helpers gerais =======
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
const nowISO = () => new Date().toISOString();

const MAX_VIDEO_MB = Number(process.env.WPP_VIDEO_MAX_MB || 16);
const MAX_VIDEO_BYTES = Math.max(1, Math.floor(MAX_VIDEO_MB)) * 1024 * 1024;

// um único io (todos os sockets). As sessões compartilham a mesma instância.
let io = null;

// controle de corrida por sessão
const inFlightBySession = new Map(); // session -> Set(groupId)
function getInFlightSet(session) {
  let set = inFlightBySession.get(session);
  if (!set) {
    set = new Set();
    inFlightBySession.set(session, set);
  }
  return set;
}

// ======= Utils locais =======
function cleanMediaPath(p) {
  return (p && String(p).trim()) ? p : null;
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
function textOf(x) {
  return String(x || '').trim();
}
function isEmptySnapshotMessage(m) {
  if (!m) return true;
  const txt = textOf(m.text);
  const img = cleanMediaPath(m.image_path);
  const aud = cleanMediaPath(m.audio_path);
  const vid = cleanMediaPath(m.video_path);
  return !txt && !img && !aud && !vid;
}
function isVideoMime(m) {
  if (!m) return false;
  return String(m).toLowerCase().startsWith('video/');
}
function fileTooLarge(filePath, mimeType) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return false;
    if (!isVideoMime(mimeType)) return false; // limite só para vídeo
    const { size } = fs.statSync(filePath);
    return size > MAX_VIDEO_BYTES;
  } catch {
    return false;
  }
}

// ======= Status/QR/Cliente por sessão (delegando ao manager) =======
function isConnected(session) {
  return sessionManager.isConnected(session);
}
function getStatus(session) {
  return sessionManager.getStatus(session);
}
function getQR(session) {
  return sessionManager.getQR(session);
}
function getClient(session) {
  return sessionManager.getClient(session);
}

// ======= Grupos (por sessão) =======
async function getGroupsSafe(session, maxRetries = 3) {
  const client = getClient(session);
  if (!client) return [];
  let lastErr = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const out = [];
      if (typeof client.listChats === 'function') {
        const chats = await client.listChats();
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
  const groups = await getGroupsSafe(session);
  const s = store.forSession(session);
  groups.forEach((g) => s.upsertGroup(g));
  return groups;
}

function shouldTargetGroup(session, groupId) {
  const s = store.forSession(session);
  const settings = s.getSettings();
  const selected = settings.selected_groups || [];
  if (settings.send_to_all) return true;
  if (!selected.length) return true;
  return selected.includes(groupId);
}

// ======= Resolvedor de mensagem efetiva (por sessão) =======
async function resolveEffectiveMessage(session, groupId) {
  const s = store.forSession(session);
  const settings = s.getSettings();
  const preset = s.getGroupPreset(groupId) || null;

  // 1) PRESET
  if (preset) {
    const msgs = Array.isArray(preset.messages) ? preset.messages : [];
    const rIdx = Number.isFinite(preset.rotate_index) ? Number(preset.rotate_index) : 0;

    // 1.1) Snapshot
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

    // 1.2) Template do grupo
    if (preset.template_id != null) {
      if (s.templateExists(preset.template_id)) {
        const tpl = s.getTemplate(preset.template_id);
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
        console.warn(`[${session}] [resolve] template_id órfão no preset de ${groupId}: ${preset.template_id}`);
      }
    }
  }

  // 2) GLOBAL
  // 2.1) Template global fixo
  if (settings.global_template_id != null && store.forSession(session).templateExists(settings.global_template_id)) {
    const tpl = s.getTemplate(settings.global_template_id);
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
        threshold: settings.threshold ?? 10,
        _meta: { source: `global:template#${settings.global_template_id}` }
      };
    }
  }

  // 2.2) Randômico
  if (settings.random_mode) {
    const rtpl = s.pickRandomTemplate();
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

  // 2.3) Texto/mídia globais (agora com video_path também)
  return {
    text: textOf(settings.text_message),
    image_path: cleanMediaPath(settings.image_path),
    audio_path: cleanMediaPath(settings.audio_path),
    video_path: cleanMediaPath(settings.video_path),
    threshold: settings.threshold ?? 10,
    _meta: { source: 'global:plain' }
  };
}

// ======= Envio por grupo (por sessão) =======
async function sendPresetToGroup(session, groupId) {
  const client = getClient(session);
  if (!client) return;

  const s = store.forSession(session);

  try {
    const msg = await resolveEffectiveMessage(session, groupId);

    const mediaList = [];
    if (msg.video_path) mediaList.push({ path: msg.video_path });
    if (msg.image_path) mediaList.push({ path: msg.image_path });
    if (msg.audio_path) mediaList.push({ path: msg.audio_path });

    const text = textOf(msg.text);
    const hasAnyMedia = mediaList.some(m => m.path && fs.existsSync(m.path));
    if (!text && !hasAnyMedia) {
      console.log(`[${session}] [sendPresetToGroup] Nada a enviar.`, groupId, msg?._meta);
      return;
    }

    // marca last_sent no início para respeitar cooldown em rajada
    s.setLastSent(groupId, nowISO());

    if (!hasAnyMedia) {
      await client.sendText(groupId, text);
    } else {
      let usedCaption = false;
      for (const item of mediaList) {
        const filePath = item.path;
        if (!filePath || !fs.existsSync(filePath)) continue;

        const filename = safeBasename(filePath);
        const mimeType = mime.lookup(filename) || 'application/octet-stream';

        if (isVideoMime(mimeType) && fileTooLarge(filePath, mimeType)) {
          console.warn(
            `[${session}] [sendPresetToGroup] Vídeo acima do limite (${MAX_VIDEO_MB}MB). Pulado: ${filename}`
          );
          continue;
        }

        const caption = !usedCaption ? text : undefined;
        // wppconnect aceita: sendFile(to, filePath, filename, caption)
        await client.sendFile(groupId, filePath, filename, caption);
        usedCaption = true;
      }

      if (!usedCaption && !text) {
        console.log(`[${session}] [sendPresetToGroup] Todas as mídias ignoradas e sem texto.`);
        return;
      }
      if (!usedCaption && text) {
        await client.sendText(groupId, text);
      }
    }

    if (msg?._meta?.source === 'preset:snapshot' && Number.isFinite(msg?._meta?.nextRotateIndex)) {
      s.bumpPresetRotateIndex(groupId, msg._meta.nextRotateIndex);
    }

    s.reset(groupId);
    if (io) io.emit('counter:update', s.getCounter(groupId));
  } catch (err) {
    console.error(`[${session}] Erro ao enviar preset:`, err.message);
  }
}

// ======= Handler de mensagens recebidas (por sessão) =======
async function onIncomingMessage(session, msg) {
  try {
    const s = store.forSession(session);
    const groupId = msg.chatId || msg.from || msg.to;
    const isGroup = msg.isGroupMsg || (groupId && isGroupId(groupId));
    if (!isGroup) return;

    // detectar mensagens próprias
    const client = getClient(session);
    let hostWid = null;
    let hostNumber = null;
    try { hostWid = await client.getWid?.(); } catch {}
    try { hostNumber = await client.getHostNumber?.(); } catch {}

    const authorId =
      msg.author ||
      msg.participant ||
      msg.sender?.id?._serialized ||
      msg.sender?._serialized ||
      msg.sender?.id;

    const fromMeFlag =
      msg.fromMe === true ||
      msg.sender?.isMe === true ||
      (hostWid && (authorId === hostWid || authorId === hostWid?._serialized)) ||
      (hostNumber && typeof authorId === 'string' && authorId.includes(hostNumber));

    if (fromMeFlag) return;

    // upsert grupo
    s.upsertGroup({
      id: groupId,
      name: msg.chat?.name || msg.sender?.shortName || msg.sender?.pushname || 'Grupo',
    });

    if (!shouldTargetGroup(session, groupId)) return;

    // contador
    s.increment(groupId);
    if (io) io.emit('counter:update', s.getCounter(groupId));

    // threshold (grupo > global)
    const grpCfg = s.getGroupPreset(groupId) || null;
    const global = s.getSettings();

    const enabled =
      (grpCfg && grpCfg.enabled !== undefined) ? grpCfg.enabled : global.enabled;
    if (!enabled) return;

    const th = Number(grpCfg?.threshold ?? global.threshold ?? 10);

    // cooldown por grupo
    const current = s.getCounter(groupId);
    const cdSec = Number(grpCfg?.cooldown_sec || 0);
    if (cdSec > 0 && current?.last_sent) {
      const last = parseSqliteTs(current.last_sent);
      if (last) {
        const diffSec = (Date.now() - last.getTime()) / 1000;
        if (diffSec < cdSec) return; // em cooldown
      }
    }

    if (current.count >= th) {
      const inFlight = getInFlightSet(session);
      if (inFlight.has(groupId)) return;
      inFlight.add(groupId);
      console.log(`[${session}] [trigger] Grupo atingiu meta: ${groupId} -> ${current.count}/${th}`);
      sendPresetToGroup(session, groupId)
        .catch(() => {})
        .finally(() => inFlight.delete(groupId));
    }
  } catch (e) {
    console.error(`[${session}] onIncomingMessage error:`, e.message);
  }
}

// ======= Ciclo de vida da sessão =======
async function createSession(session, ioInstance) {
  if (ioInstance) io = ioInstance;

  // Cria (ou recupera) a sessão no manager e injeta handlers
  const client = await sessionManager.createSession(session, io, {
    onMessage: (msg) => onIncomingMessage(session, msg),
  });

  // Tenta povoar os grupos nos primeiros segundos
  (async () => {
    for (const ms of [2000, 5000, 10000]) {
      await sleep(ms);
      const groups = await ensureGroupsPersisted(session);
      if (groups.length > 0) break;
    }
    if (io) io.emit('groups:refresh'); // frontend puxa /api/groups da sessão atual
  })();

  return client;
}

async function closeSession(session) {
  try {
    await sessionManager.closeSession(session);
    // não limpamos io; múltiplas sessões compartilham
    // counters/status/qr por sessão são atualizados pelo manager
  } catch (e) {
    console.error(`[${session}] Erro ao encerrar sessão:`, e.message);
  }
}

// ======= Exports =======
module.exports = {
  // ciclo de vida
  createSession,
  closeSession,

  // estado
  getStatus,
  getQR,
  isConnected,

  // grupos
  getGroupsSafe,
  ensureGroupsPersisted,

  // envio
  sendPresetToGroup,
};
