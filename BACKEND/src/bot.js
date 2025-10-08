// src/bot.js
const wppconnect = require('@wppconnect-team/wppconnect');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');
const store = require('./store');
const { isGroupId } = require('./utils');

let client = null;
let io = null;
let statusCache = { status: 'DISCONNECTED' };
let qrCacheBase64 = null;
let hostWid = null;     // ex.: 559999999999@c.us
let hostNumber = null;  // ex.: 559999999999
const inFlight = new Set(); // evita disparo duplicado por corrida

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
const nowISO = () => new Date().toISOString();

function normalizeStatus(s) {
  if (!s) return '';
  return String(s).trim().toLowerCase();
}

function isConnected() {
  if (!client) return false;
  const s = normalizeStatus(statusCache.status);
  const ok = ['islogged', 'inchat', 'qrreadsuccess', 'connected', 'logged', 'online', 'main', 'normal'];
  return ok.includes(s);
}

function getStatus() {
  return { ...statusCache, hasClient: !!client, hasQR: !!qrCacheBase64 };
}

function getQR() {
  return qrCacheBase64;
}

/** Helpers */
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
  return !txt && !img && !aud;
}

/** Busca grupos de forma estável usando listChats() e retries */
async function getGroupsSafe(maxRetries = 3) {
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
  console.warn('getGroupsSafe falhou após retries:', lastErr?.message);
  return [];
}

async function ensureGroupsPersisted() {
  const groups = await getGroupsSafe();
  groups.forEach((g) => store.upsertGroup(g));
  return groups;
}

function shouldTargetGroup(groupId) {
  const settings = store.getSettings();
  const selected = settings.selected_groups || [];
  if (settings.send_to_all) return true;
  if (!selected.length) return true; // fallback: se nada selecionado, enviar para todos
  return selected.includes(groupId);
}

/**
 * Mensagem efetiva (prioridade):
 *  1) Snapshot do PRESET (se existir e NÃO for vazio)
 *  2) Template por template_id (se existir)
 *  3) Global
 *
 * "Snapshot vazio" = texto em branco E sem image/audio -> ignora e cai para próximos.
 * Isso evita que um snapshot obsoleto com conteúdo vazio "vença" do template.
 */
async function resolveEffectiveMessage(groupId) {
  const settings = store.getSettings();
  const preset =
    (typeof store.getGroupPreset === 'function' && store.getGroupPreset(groupId)) ||
    (typeof store.getAllGroupPresets === 'function' &&
      (store.getAllGroupPresets() || []).find((p) => p.group_id === groupId)) ||
    null;

  if (preset) {
    const msgs = Array.isArray(preset.messages) ? preset.messages : [];
    const idx = Number.isFinite(preset.rotate_index) ? Number(preset.rotate_index) : 0;

    let msg = null;
    if (msgs.length > 0) {
      // escolhe a mensagem respeitando rotate_index
      const cand = msgs[(idx % msgs.length + msgs.length) % msgs.length] || null;
      // se a escolhida for "vazia", tratamos como inexistente para cair no template
      if (cand && !isEmptySnapshotMessage(cand)) {
        msg = cand;
      }
    }

    if (msg) {
      return {
        text: textOf(msg.text),
        image_path: cleanMediaPath(msg.image_path),
        audio_path: cleanMediaPath(msg.audio_path),
        threshold: preset.threshold ?? settings.threshold ?? 10,
      };
    }

    // Fallback: template_id (se houver e válido)
    if (preset.template_id) {
      const tpl = store.getTemplate(preset.template_id);
      if (tpl) {
        const txt = textOf(tpl.text);
        const img = cleanMediaPath(tpl.image_path);
        const aud = cleanMediaPath(tpl.audio_path);
        return {
          text: txt,
          image_path: img,
          audio_path: aud,
          threshold: preset.threshold ?? settings.threshold ?? 10,
        };
      }
    }

    // Fallback final: global
    return {
      text: textOf(settings.text_message),
      image_path: cleanMediaPath(settings.image_path),
      audio_path: cleanMediaPath(settings.audio_path),
      threshold: preset.threshold ?? settings.threshold ?? 10,
    };
  }

  // Sem preset -> usa global
  return {
    text: textOf(settings.text_message),
    image_path: cleanMediaPath(settings.image_path),
    audio_path: cleanMediaPath(settings.audio_path),
    threshold: settings.threshold ?? 10,
  };
}

/**
 * Envia a mensagem resolvida para o grupo.
 * Se não houver texto e nem mídias, não envia nada (log informativo).
 */
async function sendPresetToGroup(groupId) {
  if (!client) return;

  try {
    const msg = await resolveEffectiveMessage(groupId);

    const files = [];
    if (msg.image_path) files.push(msg.image_path);
    if (msg.audio_path) files.push(msg.audio_path);

    const text = textOf(msg.text);

    if (files.length === 0) {
      if (text) {
        await client.sendText(groupId, text);
      } else {
        console.log('[sendPresetToGroup] Nada a enviar (texto e mídias vazios).', groupId);
      }
    } else {
      for (let i = 0; i < files.length; i++) {
        const filePath = files[i];
        if (!fs.existsSync(filePath)) continue;
        const filename = safeBasename(filePath);
        const mimeType = mime.lookup(filename) || 'application/octet-stream';
        const caption = i === 0 ? text : undefined;
        await client.sendFile(groupId, filePath, filename, caption, mimeType);
      }
    }

    store.setLastSent(groupId);
    store.reset(groupId);
    io.emit('counter:update', store.getCounter(groupId));
  } catch (err) {
    console.error('Erro ao enviar preset:', err.message);
  }
}

async function onIncomingMessage(msg) {
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
      (hostWid && (authorId === hostWid || authorId === hostWid?._serialized)) ||
      (hostNumber && typeof authorId === 'string' && authorId.includes(hostNumber));

    if (fromMeFlag) return;

    // upsert grupo
    store.upsertGroup({
      id: groupId,
      name: msg.chat?.name || msg.sender?.shortName || msg.sender?.pushname || 'Grupo',
    });

    // se o grupo não é alvo, não conta e não envia
    if (!shouldTargetGroup(groupId)) return;

    // contador
    store.increment(groupId);
    const current = store.getCounter(groupId);
    io.emit('counter:update', current);

    // threshold (grupo > global)
    const grpCfg = (typeof store.getGroupPreset === 'function' && store.getGroupPreset(groupId)) || null;
    const global = store.getSettings();

    const enabled =
      grpCfg && grpCfg.enabled !== undefined ? grpCfg.enabled : global.enabled;
    if (!enabled) return;

    const th = Number(grpCfg?.threshold ?? global.threshold ?? 10);

    // cooldown por grupo (se definido e > 0)
    const cdSec = Number(grpCfg?.cooldown_sec || 0);
    if (cdSec > 0 && current?.last_sent) {
      const last = parseSqliteTs(current.last_sent);
      if (last) {
        const diffSec = (Date.now() - last.getTime()) / 1000;
        if (diffSec < cdSec) {
          return; // em cooldown
        }
      }
    }

    if (current.count >= th) {
      if (inFlight.has(groupId)) return;
      inFlight.add(groupId);
      console.log(`[trigger] Grupo atingiu meta: ${groupId} -> ${current.count}/${th}`);
      sendPresetToGroup(groupId)
        .catch(() => {})
        .finally(() => inFlight.delete(groupId));
    }
  } catch (e) {
    console.error('onIncomingMessage error:', e.message);
  }
}

async function createSession(ioInstance) {
  io = ioInstance;

  if (client && isConnected()) {
    io.emit('wpp:status', statusCache);
    if (qrCacheBase64) io.emit('wpp:qr', { base64: qrCacheBase64, base64Qr: qrCacheBase64, attempts: 0 });
    return client;
  }

  const sessionName = process.env.SESSION_NAME || 'group-bot';
  const WPP_DATA_DIR = process.env.WPP_DATA_DIR || '.wpp-data';

  statusCache = { status: 'STARTING' };
  io.emit('wpp:status', statusCache);

  client = await wppconnect.create({
    session: sessionName,
    mkdirFolderToken: true,
    folderNameToken: path.join(WPP_DATA_DIR, sessionName),
    createPathFileToken: true,
    autoClose: 0,
    puppeteerOptions: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
    catchQR: (base64Qr, asciiQR, attempts /*, urlCode */) => {
      // Normaliza para guardar APENAS o base64 cru, sem prefixo nem espaços/quebras de linha
      const raw = String(base64Qr || '')
        .replace(/^data:image\/png;base64,?/i, '')
        .replace(/\s+/g, '');

      qrCacheBase64 = raw || null;

      // status auxiliar opcional
      if (!isConnected()) {
        statusCache = { status: 'QR' };
        io.emit('wpp:status', statusCache);
      }

      // Emite em ambos os nomes para compatibilidade (base64 e base64Qr)
      io.emit('wpp:qr', { base64: qrCacheBase64, base64Qr: qrCacheBase64, attempts: Number(attempts) || 0 });
    },
    statusFind: (statusSession) => {
      statusCache = { status: statusSession };
      io.emit('wpp:status', statusCache);
    },
  });

  try {
    hostWid = await client.getWid?.();
  } catch {}
  try {
    hostNumber = await client.getHostNumber?.();
  } catch {}

  client.onMessage(onIncomingMessage);

  (async () => {
    for (const ms of [2000, 5000, 10000]) {
      await sleep(ms);
      const groups = await ensureGroupsPersisted();
      if (groups.length > 0) break;
    }
    io.emit('groups:refresh');
  })();

  return client;
}

async function closeSession() {
  try {
    if (client) {
      await client.logout?.();
      await client.close?.();
      client = null;
    }
    statusCache = { status: 'DISCONNECTED' };
    qrCacheBase64 = null;
    io.emit('wpp:status', statusCache);
  } catch (e) {
    console.error('Erro ao encerrar sessão:', e.message);
  }
}

module.exports = {
  createSession,
  closeSession,
  getStatus,
  getQR,
  getGroupsSafe,
  ensureGroupsPersisted,
  sendPresetToGroup,
  isConnected,
};
