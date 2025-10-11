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

// Limite de vídeo: default 16 MB (ajuste via env WPP_VIDEO_MAX_MB, ex.: 100 para ~100MB)
const MAX_VIDEO_MB = Number(process.env.WPP_VIDEO_MAX_MB || 16);
const MAX_VIDEO_BYTES = Math.max(1, Math.floor(MAX_VIDEO_MB)) * 1024 * 1024;

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
  const vid = cleanMediaPath(m.video_path); // <- vídeo considerado
  return !txt && !img && !aud && !vid;
}

function isVideoMime(m) {
  if (!m) return false;
  return String(m).toLowerCase().startsWith('video/');
}
function fileTooLarge(filePath, mimeType) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return false;
    // Só aplicamos limite rígido para vídeo
    if (!isVideoMime(mimeType)) return false;
    const { size } = fs.statSync(filePath);
    return size > MAX_VIDEO_BYTES;
  } catch {
    return false;
  }
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
 * Resolve a mensagem efetiva a ser enviada ao grupo, com cascata:
 *  1) PRESET do grupo:
 *      1.1) snapshot messages (com rotate_index) — se não-vazias
 *      1.2) template do grupo (template_id), se existir
 *  2) GLOBAL:
 *      2.1) template global fixo (global_template_id), se existir
 *      2.2) modo randômico (random_mode) => pickRandomTemplate()
 *      2.3) texto/mídia globais (text_message/image_path/audio_path)
 *
 * Regras:
 * - Snapshot válido NÃO herda mídia global.
 * - Template inexistente é ignorado (e logado).
 */
async function resolveEffectiveMessage(groupId) {
  const settings = store.getSettings(); // tem random_mode / global_template_id / text_message / image_path / audio_path
  const preset = store.getGroupPreset(groupId) || null;

  // 1) PRESET
  if (preset) {
    const msgs = Array.isArray(preset.messages) ? preset.messages : [];
    const rIdx = Number.isFinite(preset.rotate_index) ? Number(preset.rotate_index) : 0;

    // 1.1) Snapshot
    if (msgs.length > 0) {
      const safeIndex = ((rIdx % msgs.length) + msgs.length) % msgs.length;
      const cand = msgs[safeIndex] || null;
      if (cand && !isEmptySnapshotMessage(cand)) {
        // Próximo índice (persistimos depois do envio OK)
        const nextIdx = (safeIndex + 1) % msgs.length;
        return {
          text: textOf(cand.text),
          image_path: cleanMediaPath(cand.image_path),
          audio_path: cleanMediaPath(cand.audio_path),
          video_path: cleanMediaPath(cand.video_path), // <- vídeo no snapshot
          threshold: preset.threshold ?? settings.threshold ?? 10,
          _meta: { source: 'preset:snapshot', nextRotateIndex: nextIdx }
        };
      }
    }

    // 1.2) Template do grupo
    if (preset.template_id != null) {
      if (store.templateExists(preset.template_id)) {
        const tpl = store.getTemplate(preset.template_id);
        const txt = textOf(tpl?.text);
        const img = cleanMediaPath(tpl?.image_path);
        const aud = cleanMediaPath(tpl?.audio_path);
        const vid = cleanMediaPath(tpl?.video_path); // <- vídeo no template
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
        console.warn(`[resolve] template_id órfão no preset de ${groupId}: ${preset.template_id}`);
      }
    }
  }

  // 2) GLOBAL
  // 2.1) Template global fixo
  if (settings.global_template_id != null && store.templateExists(settings.global_template_id)) {
    const tpl = store.getTemplate(settings.global_template_id);
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

  // 2.2) Randômico (catálogo de templates)
  if (settings.random_mode) {
    const rtpl = store.pickRandomTemplate(); // só retorna template com conteúdo válido
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

  // 2.3) Texto/mídia globais (atenção: settings não tem video_path por design)
  return {
    text: textOf(settings.text_message),
    image_path: cleanMediaPath(settings.image_path),
    audio_path: cleanMediaPath(settings.audio_path),
    video_path: null,
    threshold: settings.threshold ?? 10,
    _meta: { source: 'global:plain' }
  };
}

/**
 * Envia a mensagem resolvida para o grupo.
 * - Marca last_sent no início para respeitar cooldown mesmo sob corrida (inFlight protege duplicatas).
 * - Se for snapshot, avança rotate_index após envio OK.
 * - Se não houver texto nem mídia, apenas loga e não reseta contador.
 * - Para vídeos, aplica limite de tamanho (default 16MB; ajuste via WPP_VIDEO_MAX_MB).
 */
async function sendPresetToGroup(groupId) {
  if (!client) return;

  try {
    const msg = await resolveEffectiveMessage(groupId);

    // Monta a lista de mídias a enviar (ordem: vídeo, imagem, áudio — caption só no primeiro envio)
    const mediaList = [];
    if (msg.video_path) mediaList.push({ path: msg.video_path });
    if (msg.image_path) mediaList.push({ path: msg.image_path });
    if (msg.audio_path) mediaList.push({ path: msg.audio_path });

    const text = textOf(msg.text);

    // Se nada a enviar (nem texto nem mídia válida)
    const hasAnyMedia = mediaList.some(m => m.path && fs.existsSync(m.path));
    if (!text && !hasAnyMedia) {
      console.log('[sendPresetToGroup] Nada a enviar (texto e mídias vazios).', groupId, msg?._meta);
      return;
    }

    // marca last_sent já para segurar cooldown em caso de rajada
    store.setLastSent(groupId, nowISO());

    if (!hasAnyMedia) {
      // só texto
      await client.sendText(groupId, text);
    } else {
      // envia mídias (caption só na primeira)
      let usedCaption = false;
      for (const item of mediaList) {
        const filePath = item.path;
        if (!filePath || !fs.existsSync(filePath)) continue;

        const filename = safeBasename(filePath);
        const mimeType = mime.lookup(filename) || 'application/octet-stream';

        // Checagem de tamanho para vídeo
        if (isVideoMime(mimeType) && fileTooLarge(filePath, mimeType)) {
          console.warn(
            `[sendPresetToGroup] Vídeo acima do limite (${MAX_VIDEO_MB}MB). Pulado: ${filename}`
          );
          continue;
        }

        const caption = !usedCaption ? text : undefined;
        await client.sendFile(groupId, filePath, filename, caption, mimeType);
        usedCaption = true;
      }

      // Se todas as mídias foram ignoradas por tamanho e não havia texto, nada foi enviado
      if (!usedCaption && !text) {
        console.log('[sendPresetToGroup] Todas as mídias foram ignoradas ou inexistentes e não havia texto.');
        return;
      }

      // Se mídias foram puladas mas ainda havia texto e não foi usado como caption (nenhuma mídia enviada), envia texto
      if (!usedCaption && text) {
        await client.sendText(groupId, text);
      }
    }

    // snapshot: avança rotate_index se necessário
    if (msg?._meta?.source === 'preset:snapshot' && Number.isFinite(msg?._meta?.nextRotateIndex)) {
      store.bumpPresetRotateIndex(groupId, msg._meta.nextRotateIndex);
    }

    // zera contador e emite atualização
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
      (grpCfg && grpCfg.enabled !== undefined) ? grpCfg.enabled : global.enabled;
    if (!enabled) return;

    const th = Number(grpCfg?.threshold ?? global.threshold ?? 10);

    // cooldown por grupo (se definido e > 0)
    const cdSec = Number(grpCfg?.cooldown_sec || 0);
    if (cdSec > 0 && current?.last_sent) {
      const last = parseSqliteTs(current.last_sent);
      if (last) {
        const diffSec = (Date.now() - last.getTime()) / 1000;
        if (diffSec < cdSec) {
          // console.log(`[cooldown] ${groupId} faltam ${(cdSec - diffSec).toFixed(1)}s`);
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

      if (!isConnected()) {
        statusCache = { status: 'QR' };
        io.emit('wpp:status', statusCache);
      }

      io.emit('wpp:qr', { base64: qrCacheBase64, base64Qr: qrCacheBase64, attempts: Number(attempts) || 0 });
    },
    statusFind: (statusSession) => {
      statusCache = { status: statusSession };
      io.emit('wpp:status', statusCache);
    },
  });

  try { hostWid = await client.getWid?.(); } catch {}
  try { hostNumber = await client.getHostNumber?.(); } catch {}

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
