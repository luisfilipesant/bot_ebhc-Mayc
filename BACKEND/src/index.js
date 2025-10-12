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
const bot = require('./bot');
const { pick } = require('./utils');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Uploads
const uploadDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

// --- helpers de saneamento (evitam snapshot "vazio") ---
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

// --- Socket.IO ---
io.on('connection', (socket) => {
  socket.emit('wpp:status', bot.getStatus());
  const qr = bot.getQR();
  if (qr) socket.emit('wpp:qr', { base64Qr: qr, attempts: 0 });
});

// --- API ---
app.get('/api/status', async (req, res) => {
  const s = store.getSettings();
  res.json({
    wpp: bot.getStatus(),
    settings: s,
    counters: store.getAllCounters()
  });
});

// Fallback QR
app.get('/api/qr', (req, res) => {
  const qr = bot.getQR();
  if (!qr) return res.status(404).json({ ok: false, error: 'QR indisponível' });
  res.json({ ok: true, base64Qr: qr });
});

app.post('/api/bot/start', async (req, res) => {
  const s = store.updateSettings({ enabled: true });
  if (!bot.isConnected()) {
    await bot.createSession(io);
  } else {
    io.emit('wpp:status', bot.getStatus());
    const qr = bot.getQR();
    if (qr) io.emit('wpp:qr', { base64Qr: qr, attempts: 0 });
  }
  res.json({ ok: true, settings: s });
});

app.post('/api/bot/stop', async (req, res) => {
  const s = store.updateSettings({ enabled: false });
  res.json({ ok: true, settings: s });
});

app.post('/api/bot/disconnect', async (req, res) => {
  await bot.closeSession();
  res.json({ ok: true });
});

app.get('/api/groups', async (req, res) => {
  try {
    let groups = await bot.ensureGroupsPersisted();
    if (!groups.length) {
      setTimeout(async () => {
        const g2 = await bot.ensureGroupsPersisted();
        io.emit('groups:refresh', g2);
      }, 2000);
    }
    res.json(groups);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// settings globais
app.post('/api/settings', async (req, res) => {
  const payload = pick(req.body, ['enabled','threshold','text_message','send_to_all','selected_groups','random_mode','global_template_id']);
  const updated = store.updateSettings(payload);
  res.json({ ok: true, settings: updated });
});

// mídia global
app.post('/api/media',
  upload.fields([{ name: 'image', maxCount: 1 }, { name: 'audio', maxCount: 1 }, { name: 'video', maxCount: 1 }]),
  (req, res) => {
    const files = req.files || {};
    const image = (files.image && files.image[0]) ? files.image[0].path : undefined;
    const audio = (files.audio && files.audio[0]) ? files.audio[0].path : undefined;
    const video = (files.video && files.video[0]) ? files.video[0].path : undefined;
    const updated = store.updateSettings({ image_path: image, audio_path: audio, video_path: video });
    res.json({ ok: true, settings: updated });
  }
);

// ---------- Mídia por TEMPLATE ----------
app.post('/api/catalog-media',
  upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'audio', maxCount: 1 },
    { name: 'video', maxCount: 1 }
  ]),
  (req, res) => {
    try {
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
        rel
      });
    } catch (e) {
      console.error('catalog-media error', e);
      res.status(500).json({ ok: false, error: 'Falha no upload de mídia.' });
    }
  }
);

// ---------- Templates (CRUD) ----------
app.get('/api/templates', (req, res) => {
  const list = store.getAllTemplates();
  res.json(list);
});

app.get('/api/templates/:id', (req, res) => {
  const tpl = store.getTemplate(req.params.id);
  if (!tpl) return res.status(404).json({ ok: false, error: 'Template não encontrado' });
  res.json(tpl);
});

app.post('/api/templates', (req, res) => {
  try {
    const created = store.createTemplate(req.body || {});
    res.json({ ok: true, template: created });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'Falha ao criar template' });
  }
});

app.put('/api/templates/:id', (req, res) => {
  try {
    const updated = store.updateTemplate(req.params.id, req.body || {});
    res.json({ ok: true, template: updated });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'Falha ao atualizar template' });
  }
});

app.delete('/api/templates/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    // limpa template_id dos presets
    store.clearTemplateFromPresets(id);
    // se for o template global, limpa nas settings
    const s = store.getSettings();
    if (s.global_template_id === id) {
      store.updateSettings({ global_template_id: null });
    }
    // remove o template
    store.deleteTemplate(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || 'Falha ao remover template' });
  }
});

// ---------- Presets por grupo ----------
app.get('/api/group-presets', (req, res) => {
  res.json(store.getAllGroupPresets());
});

app.post('/api/group-presets', (req, res) => {
  const body = req.body || {};
  if (!body.group_id) return res.status(400).json({ ok:false, error:'group_id é obrigatório' });

  // valida template (se informado)
  if (body.template_id != null && !store.templateExists(body.template_id)) {
    return res.status(400).json({ ok:false, error:'template_id inexistente' });
  }

  const sanitizedMessages = sanitizeSnapshotMessages(body.messages);

  const saved = store.setGroupPreset(body.group_id, {
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
app.post('/api/groups/activate-all', (req, res) => {
  const body = req.body || {};
  const mode = (body.mode === 'random') ? 'random' : 'fixed';
  const enable = !!body.enable;

  if (mode === 'fixed') {
    if (body.template_id == null) {
      return res.status(400).json({ ok:false, error:'Informe template_id no modo fixo' });
    }
    if (!store.templateExists(body.template_id)) {
      return res.status(400).json({ ok:false, error:'template_id inexistente' });
    }
  }

  const presets = store.activateAllGroups({
    enable,
    mode,
    template_id: (body.template_id != null ? Number(body.template_id) : null),
    threshold: (body.threshold != null ? Number(body.threshold) : undefined),
    cooldown_sec: (body.cooldown_sec != null ? Number(body.cooldown_sec) : undefined)
  });

  res.json({ ok:true, presets, settings: store.getSettings() });
});

// upload de mídia por grupo (se precisar)
app.post('/api/group-media/:groupId',
  upload.fields([{ name: 'image', maxCount: 1 }, { name: 'audio', maxCount: 1 }, { name: 'video', maxCount: 1 }]),
  (req, res) => {
    const { groupId } = req.params;
    const files = req.files || {};
    const out = {
      image_path: (files.image && files.image[0]) ? path.resolve(files.image[0].path) : undefined,
      audio_path: (files.audio && files.audio[0]) ? path.resolve(files.audio[0].path) : undefined,
      video_path: (files.video && files.video[0]) ? path.resolve(files.video[0].path) : undefined
    };
    res.json({ ok:true, files: out, groupId });
  }
);

// ------ NOVA ROTA: reset de sessão (.wpp-data/<SESSION_NAME>) ------
app.post('/api/session/wipe', async (req, res) => {
  try {
    // 1) encerra sessão atual (se houver)
    await bot.closeSession();

    // 2) calcula pasta da sessão e remove
    const sessionName = process.env.SESSION_NAME || 'group-bot';
    const base = path.resolve(path.join(__dirname, '..', process.env.WPP_DATA_DIR || '.wpp-data'));
    const target = path.join(base, sessionName);

    // segurança básica: só apaga se o alvo estiver dentro de base
    if (!target.startsWith(base)) {
      return res.status(400).json({ ok:false, error:'Alvo inválido para wipe.' });
    }

    fs.rmSync(target, { recursive: true, force: true });

    // 3) atualiza status front
    io.emit('wpp:status', { status: 'DISCONNECTED' });

    return res.json({ ok: true, wiped: target });
  } catch (e) {
    console.error('wipe session error:', e);
    return res.status(500).json({ ok:false, error: e.message || 'Falha ao limpar sessão' });
  }
});

app.post('/api/test-send', async (req, res) => {
  const { groupId } = req.body || {};
  if (!groupId) return res.status(400).json({ ok: false, error: 'groupId é obrigatório' });
  await bot.sendPresetToGroup(groupId);
  res.json({ ok: true });
});

app.post('/api/counters/reset/:groupId', (req, res) => {
  store.reset(req.params.groupId);
  const row = store.getCounter(req.params.groupId);
  io.emit('counter:update', row);
  res.json({ ok: true, counter: row });
});

// ---------- SERVIR O FRONT ----------
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
const clientPath = path.resolve(__dirname, '..', '..', 'FRONTEND', 'dist');

app.use(express.static(clientPath, {
  index: 'index.html',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=utf-8');
  },
}));

app.get(/^\/(?!api\/|socket\.io\/).*/, (req, res) => {
  res.sendFile(path.join(clientPath, 'index.html'));
});

server.listen(PORT, async () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  // opcional: await bot.createSession(io);
});
