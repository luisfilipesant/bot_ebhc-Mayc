// BACKEND/src/index.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const store = require('./store');
const bot = require('./bot'); // aponta para sessionManager.js
const { pick } = require('./utils');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ---------- Middlewares ----------
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// ---------- Helpers ----------
const SESSION_FALLBACK = 'default';

const sanitizeSession = (s) => {
  const str = String(s || '').trim();
  // Nome de sala/dir seguro: letras, números, -, _ e .
  const safe = str.replace(/[^a-zA-Z0-9._-]/g, '');
  return safe || SESSION_FALLBACK;
};

const trimStr = (v) => (typeof v === 'string' ? v.trim() : '');
const cleanPath = (p) => {
  if (p === undefined || p === null) return null;
  const s = String(p).trim();
  return s ? s : null;
};

const sanitizeSnapshotMessages = (arr) => {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const m of arr) {
    const text = trimStr(m?.text);
    const image_path = cleanPath(m?.image_path);
    const audio_path = cleanPath(m?.audio_path);
    const video_path = cleanPath(m?.video_path);
    if (!text && !image_path && !audio_path && !video_path) continue;
    out.push({ text, image_path, audio_path, video_path });
  }
  return out;
};

// ---------- Uploads (dinâmico por sessão) ----------
const uploadBaseDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadBaseDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // se a rota for /api/:session/... teremos req.params.session; no alias legado, cai no fallback
    const session = sanitizeSession(req.params?.session || SESSION_FALLBACK);
    const dir = path.join(uploadBaseDir, session);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const orig = file?.originalname || '';
    const ext = path.extname(orig);
    const base = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${base}${ext || ''}`);
  }
});
const upload = multer({ storage });

// ---------- Socket.IO ----------
io.on('connection', (socket) => {
  // Lê a sessão do query (?session=foo) e entra na sala
  const raw = socket.handshake?.query?.session;
  const session = sanitizeSession(raw);
  socket.join(session);

  // Envia status/QR iniciais apenas para a sala da sessão
  try {
    const status = bot.getStatus(session);
    socket.emit('wpp:status', status);
    const qr = bot.getQR(session);
    if (qr) {
      socket.emit('wpp:qr', {
        session,
        base64: qr,
        base64Qr: qr,
        attempts: 0
      });
    }
  } catch {
    // sessão ainda não criada; tudo bem
  }

  // Também permitimos entrar em outra sessão dinamicamente
  socket.on('session:join', (s) => {
    const target = sanitizeSession(s);
    socket.join(target);
    const status = bot.getStatus(target);
    socket.emit('wpp:status', status);
    const qr = bot.getQR(target);
    if (qr) {
      socket.emit('wpp:qr', {
        session: target,
        base64: qr,
        base64Qr: qr,
        attempts: 0
      });
    }
  });
});

// ---------- Registrador de rotas (namespaced) ----------
function registerApi(prefix, resolveSession) {
  // STATUS
  app.get(`${prefix}/status`, async (req, res) => {
    const session = resolveSession(req);
    const s = store.forSession(session).getSettings();
    res.json({
      wpp: bot.getStatus(session),
      settings: s,
      counters: store.forSession(session).getAllCounters()
    });
  });

  // QR
  app.get(`${prefix}/qr`, (req, res) => {
    const session = resolveSession(req);
    const qr = bot.getQR(session);
    if (!qr) return res.status(404).json({ ok: false, error: 'QR indisponível' });
    res.json({ ok: true, session, base64: qr, base64Qr: qr });
  });

  // START
  app.post(`${prefix}/bot/start`, async (req, res) => {
    const session = resolveSession(req);
    const s = store.forSession(session).updateSettings({ enabled: true });

    if (!bot.isConnected(session)) {
      await bot.createSession(session, io);
    } else {
      io.to(session).emit('wpp:status', bot.getStatus(session));
      const qr = bot.getQR(session);
      if (qr) {
        io.to(session).emit('wpp:qr', {
          session,
          base64: qr,
          base64Qr: qr,
          attempts: 0
        });
      }
    }
    res.json({ ok: true, settings: s });
  });

  // STOP (apenas desabilita envios)
  app.post(`${prefix}/bot/stop`, async (req, res) => {
    const session = resolveSession(req);
    const s = store.forSession(session).updateSettings({ enabled: false });
    res.json({ ok: true, settings: s });
  });

  // DISCONNECT (encerra sessão WPP sem logout)
  app.post(`${prefix}/bot/disconnect`, async (req, res) => {
    const session = resolveSession(req);
    await bot.closeSession(session);
    io.to(session).emit('wpp:status', { session, status: 'DISCONNECTED' });
    res.json({ ok: true });
  });

  // GRUPOS
  app.get(`${prefix}/groups`, async (req, res) => {
    const session = resolveSession(req);
    try {
      let groups = await bot.ensureGroupsPersisted(session);
      if (!groups.length) {
        setTimeout(async () => {
          const g2 = await bot.ensureGroupsPersisted(session);
          io.to(session).emit('groups:refresh', { session, groups: g2 });
        }, 2000);
      }
      res.json(groups);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // SETTINGS globais
  app.post(`${prefix}/settings`, async (req, res) => {
    const session = resolveSession(req);
    const payload = pick(req.body, [
      'enabled',
      'threshold',
      'text_message',
      'send_to_all',
      'selected_groups',
      'random_mode',
      'global_template_id',
      'image_path',
      'audio_path',
      'video_path'
    ]);
    const updated = store.forSession(session).updateSettings(payload);
    res.json({ ok: true, settings: updated });
  });

  // MÍDIA GLOBAL (image/audio/video)
  app.post(
    `${prefix}/media`,
    upload.fields([
      { name: 'image', maxCount: 1 },
      { name: 'audio', maxCount: 1 },
      { name: 'video', maxCount: 1 }
    ]),
    (req, res) => {
      const session = resolveSession(req);
      const files = req.files || {};
      const image = (files.image && files.image[0]) ? files.image[0].path : undefined;
      const audio = (files.audio && files.audio[0]) ? files.audio[0].path : undefined;
      const video = (files.video && files.video[0]) ? files.video[0].path : undefined;

      const updated = store.forSession(session).updateSettings({
        image_path: image,
        audio_path: audio,
        video_path: video
      });

      res.json({ ok: true, settings: updated });
    }
  );

  // CATÁLOGO: upload de mídia por template (image/audio/video)
  app.post(
    `${prefix}/catalog-media`,
    upload.fields([
      { name: 'image', maxCount: 1 },
      { name: 'audio', maxCount: 1 },
      { name: 'video', maxCount: 1 }
    ]),
    (req, res) => {
      try {
        const session = resolveSession(req);
        const files = req.files || {};
        const img = (files.image && files.image[0]) || null;
        const aud = (files.audio && files.audio[0]) || null;
        const vid = (files.video && files.video[0]) || null;

        if (!img && !aud && !vid) {
          return res.status(400).json({ ok: false, error: 'Envie "image", "audio" ou "video".' });
        }

        const file = img || aud || vid;
        const abs = path.resolve(file.path);
        const rel = path
          .relative(path.join(__dirname, '..'), abs)
          .replace(/\\/g, '/');

        return res.json({
          ok: true,
          type: img ? 'image' : aud ? 'audio' : 'video',
          path: abs,
          rel,
          session
        });
      } catch (e) {
        console.error('catalog-media error', e);
        res.status(500).json({ ok: false, error: 'Falha no upload de mídia.' });
      }
    }
  );

  // ---------- Templates (CRUD) ----------
  app.get(`${prefix}/templates`, (req, res) => {
    const session = resolveSession(req);
    const list = store.forSession(session).getAllTemplates();
    res.json(list);
  });

  app.get(`${prefix}/templates/:id`, (req, res) => {
    const session = resolveSession(req);
    const tpl = store.forSession(session).getTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ ok: false, error: 'Template não encontrado' });
    res.json(tpl);
  });

  app.post(`${prefix}/templates`, (req, res) => {
    try {
      const session = resolveSession(req);
      const created = store.forSession(session).createTemplate(req.body || {});
      res.json({ ok: true, template: created });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || 'Falha ao criar template' });
    }
  });

  app.put(`${prefix}/templates/:id`, (req, res) => {
    try {
      const session = resolveSession(req);
      const updated = store.forSession(session).updateTemplate(req.params.id, req.body || {});
      res.json({ ok: true, template: updated });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || 'Falha ao atualizar template' });
    }
  });

  app.delete(`${prefix}/templates/:id`, (req, res) => {
    try {
      const session = resolveSession(req);
      const id = Number(req.params.id);

      // limpa template_id dos presets da sessão
      store.forSession(session).clearTemplateFromPresets(id);

      // se for o template global, limpa nas settings da sessão
      const s = store.forSession(session).getSettings();
      if (s.global_template_id === id) {
        store.forSession(session).updateSettings({ global_template_id: null });
      }

      // remove o template
      store.forSession(session).deleteTemplate(id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || 'Falha ao remover template' });
    }
  });

  // ---------- Presets por grupo ----------
  app.get(`${prefix}/group-presets`, (req, res) => {
    const session = resolveSession(req);
    res.json(store.forSession(session).getAllGroupPresets());
  });

  app.post(`${prefix}/group-presets`, (req, res) => {
    const session = resolveSession(req);
    const body = req.body || {};
    if (!body.group_id) return res.status(400).json({ ok:false, error:'group_id é obrigatório' });

    if (body.template_id != null && !store.forSession(session).templateExists(body.template_id)) {
      return res.status(400).json({ ok:false, error:'template_id inexistente' });
    }

    const sanitizedMessages = sanitizeSnapshotMessages(body.messages);

    const saved = store.forSession(session).setGroupPreset(body.group_id, {
      enabled: body.enabled,
      threshold: body.threshold,
      cooldown_sec: body.cooldown_sec,
      selected_index: body.selected_index,
      template_id: body.template_id != null ? Number(body.template_id) : null,
      messages: sanitizedMessages
    });

    res.json({ ok:true, preset: saved });
  });

  // ---------- BULK: ativar em todos ----------
  app.post(`${prefix}/groups/activate-all`, (req, res) => {
    const session = resolveSession(req);
    const body = req.body || {};
    const mode = (body.mode === 'random') ? 'random' : 'fixed';
    const enable = !!body.enable;

    if (mode === 'fixed') {
      if (body.template_id == null) {
        return res.status(400).json({ ok:false, error:'Informe template_id no modo fixo' });
      }
      if (!store.forSession(session).templateExists(body.template_id)) {
        return res.status(400).json({ ok:false, error:'template_id inexistente' });
      }
    }

    const presets = store.forSession(session).activateAllGroups({
      enable,
      mode,
      template_id: (body.template_id != null ? Number(body.template_id) : null),
      threshold: (body.threshold != null ? Number(body.threshold) : undefined),
      cooldown_sec: (body.cooldown_sec != null ? Number(body.cooldown_sec) : undefined)
    });

    res.json({ ok:true, presets, settings: store.forSession(session).getSettings() });
  });

  // Upload de mídia por grupo (se precisar)
  app.post(
    `${prefix}/group-media/:groupId`,
    upload.fields([
      { name: 'image', maxCount: 1 },
      { name: 'audio', maxCount: 1 },
      { name: 'video', maxCount: 1 }
    ]),
    (req, res) => {
      const session = resolveSession(req);
      const { groupId } = req.params;
      const files = req.files || {};
      const out = {
        image_path: (files.image && files.image[0]) ? path.resolve(files.image[0].path) : undefined,
        audio_path: (files.audio && files.audio[0]) ? path.resolve(files.audio[0].path) : undefined,
        video_path: (files.video && files.video[0]) ? path.resolve(files.video[0].path) : undefined
      };
      res.json({ ok:true, files: out, groupId, session });
    }
  );

  // ---------- Reset/Wipe tokens da sessão (pasta .wpp-data/<session>) ----------
  app.post(`${prefix}/session/wipe`, async (req, res) => {
    try {
      const session = resolveSession(req);
      // usa a função robusta do sessionManager (fecha + apaga com retries)
      await bot.wipeSession(session);
      io.to(session).emit('wpp:status', { session, status: 'DISCONNECTED' });
      return res.json({ ok: true, wiped: session });
    } catch (e) {
      console.error('wipe session error:', e);
      return res.status(500).json({ ok:false, error: e.message || 'Falha ao limpar sessão' });
    }
  });

  // TESTE: enviar preset manualmente a um grupo
  app.post(`${prefix}/test-send`, async (req, res) => {
    const session = resolveSession(req);
    const { groupId } = req.body || {};
    if (!groupId) return res.status(400).json({ ok: false, error: 'groupId é obrigatório' });
    await bot.sendPresetToGroup(session, groupId);
    res.json({ ok: true });
  });

  // Reset de contador do grupo
  app.post(`${prefix}/counters/reset/:groupId`, (req, res) => {
    const session = resolveSession(req);
    store.forSession(session).reset(req.params.groupId);
    const row = store.forSession(session).getCounter(req.params.groupId);
    io.to(session).emit('counter:update', { ...(row || {}), session });
    res.json({ ok: true, counter: row });
  });
}

// ---------- Montagem de rotas ----------
// Namespaced (recomendado)
registerApi('/api/:session', (req) => sanitizeSession(req.params.session));
// Alias legado → session = 'default'
registerApi('/api', () => SESSION_FALLBACK);

// ---------- Arquivos estáticos (uploads + front) ----------
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

const clientPath = path.resolve(__dirname, '..', '..', 'FRONTEND', 'dist');
app.use(express.static(clientPath, {
  index: 'index.html',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=utf-8');
  },
}));

// SPA fallback
app.get(/^\/(?!api\/|socket\.io\/).*/, (req, res) => {
  res.sendFile(path.join(clientPath, 'index.html'));
});

// ---------- Start ----------
server.listen(PORT, async () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  // sessões são criadas sob demanda via /api/:session/bot/start
});
