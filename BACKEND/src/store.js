// BACKEND/src/store.js
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'bot.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);

// PRAGMAs
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

// --- MIGRATION HELPERS ---
function tableInfo(name) {
  try { return db.prepare(`PRAGMA table_info(${name})`).all(); } catch { return []; }
}
function columnExists(cols, colName) {
  return (cols || []).some(c => String(c.name).toLowerCase() === String(colName).toLowerCase());
}

// --- SCHEMA (create) ---
db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  threshold INTEGER NOT NULL DEFAULT 10,
  text_message TEXT DEFAULT '',
  send_to_all INTEGER NOT NULL DEFAULT 1,
  selected_groups_json TEXT DEFAULT '[]',
  image_path TEXT DEFAULT NULL,
  audio_path TEXT DEFAULT NULL,
  random_mode INTEGER NOT NULL DEFAULT 0,
  global_template_id INTEGER
);
INSERT OR IGNORE INTO settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS group_counters (
  group_id TEXT PRIMARY KEY,
  group_name TEXT,
  count INTEGER NOT NULL DEFAULT 0,
  last_reset TEXT,
  last_sent TEXT
);

CREATE TABLE IF NOT EXISTS group_presets (
  group_id TEXT PRIMARY KEY,
  enabled INTEGER,
  threshold INTEGER,
  cooldown_sec INTEGER,
  rotate_index INTEGER DEFAULT 0,
  selected_index INTEGER,
  messages_json TEXT,
  template_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_counters_name ON group_counters(group_name);

-- Catálogo de templates persistidos
CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  image_path TEXT DEFAULT NULL,
  audio_path TEXT DEFAULT NULL,
  video_path TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// --- SCHEMA (migrate) ---
(() => {
  // garante template_id em group_presets
  const gpCols = tableInfo('group_presets');
  if (!columnExists(gpCols, 'template_id')) {
    db.exec(`ALTER TABLE group_presets ADD COLUMN template_id INTEGER`);
  }

  // garante random_mode/global_template_id em settings
  const sCols = tableInfo('settings');
  if (!columnExists(sCols, 'random_mode')) {
    db.exec(`ALTER TABLE settings ADD COLUMN random_mode INTEGER NOT NULL DEFAULT 0`);
  }
  if (!columnExists(sCols, 'global_template_id')) {
    db.exec(`ALTER TABLE settings ADD COLUMN global_template_id INTEGER`);
  }

  // garante video_path em templates
  const tCols = tableInfo('templates');
  if (!columnExists(tCols, 'video_path')) {
    db.exec(`ALTER TABLE templates ADD COLUMN video_path TEXT DEFAULT NULL`);
  }
})();

// Trigger de updated_at nos templates
db.exec(`
CREATE TRIGGER IF NOT EXISTS trg_templates_updated_at
AFTER UPDATE ON templates
FOR EACH ROW
BEGIN
  UPDATE templates SET updated_at = datetime('now') WHERE id = NEW.id;
END;
`);

// --- STATEMENTS: settings ---
const getSettingsStmt = db.prepare(`SELECT * FROM settings WHERE id = 1`);
const updateSettingsStmt = db.prepare(`
  UPDATE settings SET
    enabled = @enabled,
    threshold = @threshold,
    text_message = @text_message,
    send_to_all = @send_to_all,
    selected_groups_json = @selected_groups_json,
    image_path = @image_path,
    audio_path = @audio_path,
    random_mode = @random_mode,
    global_template_id = @global_template_id
  WHERE id = 1
`);

// --- STATEMENTS: counters ---
const upsertGroupStmt = db.prepare(`
  INSERT INTO group_counters (group_id, group_name, count, last_reset, last_sent)
  VALUES (@group_id, @group_name, 0, datetime('now'), NULL)
  ON CONFLICT(group_id) DO UPDATE SET group_name = excluded.group_name
`);
const incrementStmt       = db.prepare(`UPDATE group_counters SET count = count + 1 WHERE group_id = ?`);
const resetStmt           = db.prepare(`UPDATE group_counters SET count = 0, last_reset = datetime('now') WHERE group_id = ?`);
const setLastSentNowStmt  = db.prepare(`UPDATE group_counters SET last_sent = datetime('now') WHERE group_id = @id`);
const setLastSentAtStmt   = db.prepare(`UPDATE group_counters SET last_sent = @ts WHERE group_id = @id`);

const getAllCountersStmt  = db.prepare(`
  SELECT group_id, group_name, count, last_reset, last_sent
  FROM group_counters
  ORDER BY group_name
`);
const getCounterStmt      = db.prepare(`
  SELECT group_id, group_name, count, last_reset, last_sent
  FROM group_counters
  WHERE group_id = ?
`);

const selectAllGroupIdsStmt = db.prepare(`SELECT group_id FROM group_counters ORDER BY group_name`);

// --- STATEMENTS: templates (CRUD) ---
const selectAllTemplatesStmt = db.prepare(`SELECT * FROM templates ORDER BY id ASC`);
const selectTemplateStmt     = db.prepare(`SELECT * FROM templates WHERE id = ?`);
const insertTemplateStmt     = db.prepare(`
  INSERT INTO templates (name, text, image_path, audio_path, video_path)
  VALUES (@name, @text, @image_path, @audio_path, @video_path)
`);
const updateTemplateStmt     = db.prepare(`
  UPDATE templates SET
    name = COALESCE(@name, name),
    text = COALESCE(@text, text),
    image_path = @image_path,
    audio_path = @audio_path,
    video_path = @video_path
  WHERE id = @id
`);
const deleteTemplateStmt     = db.prepare(`DELETE FROM templates WHERE id = ?`);

// --- STATEMENTS: group_presets ---
const selectAllPresetsStmt = db.prepare(`SELECT * FROM group_presets`);
const selectPresetStmt     = db.prepare(`SELECT * FROM group_presets WHERE group_id = ?`);
const upsertPresetStmt     = db.prepare(`
  INSERT INTO group_presets (group_id, enabled, threshold, cooldown_sec, rotate_index, selected_index, messages_json, template_id)
  VALUES (@group_id, @enabled, @threshold, @cooldown_sec, @rotate_index, @selected_index, @messages_json, @template_id)
  ON CONFLICT(group_id) DO UPDATE SET
    enabled        = excluded.enabled,
    threshold      = excluded.threshold,
    cooldown_sec   = excluded.cooldown_sec,
    rotate_index   = COALESCE(excluded.rotate_index, group_presets.rotate_index),
    selected_index = excluded.selected_index,
    template_id    = excluded.template_id,
    messages_json  = COALESCE(excluded.messages_json, group_presets.messages_json)
`);
const bumpRotateStmt = db.prepare(`
  UPDATE group_presets SET rotate_index = @idx WHERE group_id = @group_id
`);
const clearTemplateFromPresetsStmt = db.prepare(`
  UPDATE group_presets SET template_id = NULL WHERE template_id = ?
`);

// --- HELPERS ---
function parseJSON(json, fallback) {
  try { return JSON.parse(json); } catch { return fallback; }
}
function parseMessages(json) {
  return parseJSON(json || '[]', []);
}
function presetRowToObj(row) {
  if (!row) return null;
  return {
    group_id: row.group_id,
    enabled: row.enabled === null ? undefined : !!row.enabled,
    threshold: row.threshold !== null && row.threshold !== undefined ? Number(row.threshold) : undefined,
    cooldown_sec: row.cooldown_sec !== null && row.cooldown_sec !== undefined ? Number(row.cooldown_sec) : undefined,
    rotate_index: row.rotate_index ?? 0,
    selected_index: (row.selected_index !== null && row.selected_index !== undefined)
      ? Number(row.selected_index)
      : null,
    template_id: (row.template_id !== null && row.template_id !== undefined)
      ? Number(row.template_id)
      : null,
    messages: parseMessages(row.messages_json)
  };
}
function toIntOrNullBool(v) {
  if (v === undefined) return null;
  return v ? 1 : 0;
}
function cleanPath(p) {
  if (p === undefined || p === null) return null;
  const s = String(p).trim();
  return s ? s : null;
}
function trimStr(v) {
  return (typeof v === 'string') ? v.trim() : '';
}
function sanitizeSnapshotMessages(arr) {
  if (!Array.isArray(arr)) return undefined;
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
}

// --- EXPORTS ---
module.exports = {
  // SETTINGS
  getSettings() {
    const row = getSettingsStmt.get();
    const parsed = { ...row };
    parsed.selected_groups = parseJSON(row.selected_groups_json || '[]', []);
    delete parsed.selected_groups_json;
    parsed.enabled = !!parsed.enabled;
    parsed.send_to_all = !!parsed.send_to_all;
    parsed.random_mode = !!parsed.random_mode;
    parsed.global_template_id = (row.global_template_id != null) ? Number(row.global_template_id) : null;
    return parsed;
  },

  updateSettings(payload) {
    const current = this.getSettings();
    const toInt = (v) => (v ? 1 : 0);
    const updated = {
      enabled: payload.enabled !== undefined ? toInt(payload.enabled) : toInt(current.enabled),
      threshold: Number(payload.threshold ?? current.threshold ?? 10),
      text_message: String(payload.text_message ?? current.text_message ?? ''),
      send_to_all: payload.send_to_all !== undefined ? toInt(payload.send_to_all) : toInt(current.send_to_all),
      selected_groups_json: JSON.stringify(payload.selected_groups ?? current.selected_groups ?? []),
      image_path: (payload.image_path ?? current.image_path) ?? null,
      audio_path: (payload.audio_path ?? current.audio_path) ?? null,
      random_mode: payload.random_mode !== undefined ? toInt(payload.random_mode) : toInt(current.random_mode),
      global_template_id: (payload.global_template_id !== undefined)
        ? (payload.global_template_id == null ? null : Number(payload.global_template_id))
        : current.global_template_id
    };
    updateSettingsStmt.run(updated);
    return this.getSettings();
  },

  // COUNTERS
  upsertGroup(group) { upsertGroupStmt.run({ group_id: group.id, group_name: group.name }); },
  increment(groupId) { incrementStmt.run(groupId); },
  reset(groupId)     { resetStmt.run(groupId); },

  setLastSent(groupId, ts) {
    if (ts) setLastSentAtStmt.run({ id: groupId, ts });
    else    setLastSentNowStmt.run({ id: groupId }); // nomeado (evita binding errado)
  },

  getAllCounters()     { return getAllCountersStmt.all(); },
  getCounter(groupId)  { return getCounterStmt.get(groupId); },
  getAllGroupIds()     { return selectAllGroupIdsStmt.all().map(r => r.group_id); },

  // GROUP PRESETS
  getAllGroupPresets() {
    const rows = selectAllPresetsStmt.all();
    return rows.map(presetRowToObj);
  },
  getGroupPreset(groupId) {
    const row = selectPresetStmt.get(groupId);
    return presetRowToObj(row);
  },
  setGroupPreset(groupId, payload = {}) {
    const enabled = toIntOrNullBool(payload.enabled);
    const threshold = (payload.threshold !== undefined) ? payload.threshold : null;
    const cooldown_sec = (payload.cooldown_sec !== undefined) ? payload.cooldown_sec : null;
    const rotate_index =
      (payload.rotate_index !== undefined && payload.rotate_index !== null)
        ? Number(payload.rotate_index)
        : null;
    const selected_index =
      (payload.selected_index !== undefined && payload.selected_index !== null)
        ? Number(payload.selected_index)
        : null;
    const template_id =
      (payload.template_id !== undefined && payload.template_id !== null)
        ? Number(payload.template_id)
        : null;

    const sanitizedMsgs = sanitizeSnapshotMessages(payload.messages);
    const messages_json =
      (sanitizedMsgs === undefined)
        ? null
        : JSON.stringify(sanitizedMsgs);

    upsertPresetStmt.run({
      group_id: groupId,
      enabled,
      threshold,
      cooldown_sec,
      rotate_index,
      selected_index,
      template_id,
      messages_json
    });

    return this.getGroupPreset(groupId);
  },
  bumpPresetRotateIndex(groupId, nextIdx) {
    bumpRotateStmt.run({ group_id: groupId, idx: Number(nextIdx || 0) });
  },

  // TEMPLATES
  getAllTemplates() {
    return selectAllTemplatesStmt.all().map((t) => ({ ...t, id: Number(t.id) }));
  },
  getTemplate(id) {
    const row = selectTemplateStmt.get(Number(id));
    if (!row) return null;
    return { ...row, id: Number(row.id) };
  },
  templateExists(id) {
    if (id == null) return false;
    const row = selectTemplateStmt.get(Number(id));
    return !!row;
  },
  createTemplate(body = {}) {
    const name = trimStr(body.name || '');
    const text = trimStr(body.text || '');
    if (!name) throw new Error('Nome é obrigatório');
    if (!text) throw new Error('Texto é obrigatório');
    const image_path = cleanPath(body.image_path);
    const audio_path = cleanPath(body.audio_path);
    const video_path = cleanPath(body.video_path);
    const info = insertTemplateStmt.run({ name, text, image_path, audio_path, video_path });
    return this.getTemplate(info.lastInsertRowid);
  },
  updateTemplate(id, patch = {}) {
    const payload = {
      id: Number(id),
      name: (patch.name !== undefined) ? trimStr(patch.name) : undefined,
      text: (patch.text !== undefined) ? trimStr(patch.text) : undefined,
      image_path: (patch.image_path !== undefined) ? cleanPath(patch.image_path) : undefined,
      audio_path: (patch.audio_path !== undefined) ? cleanPath(patch.audio_path) : undefined,
      video_path: (patch.video_path !== undefined) ? cleanPath(patch.video_path) : undefined,
    };
    updateTemplateStmt.run(payload);
    return this.getTemplate(id);
  },
  deleteTemplate(id) {
    deleteTemplateStmt.run(Number(id));
  },
  clearTemplateFromPresets(id) {
    clearTemplateFromPresetsStmt.run(Number(id));
  },

  // RANDÔMICO / GLOBAL
  pickRandomTemplate() {
    const all = this.getAllTemplates().filter(t =>
      (t.text && t.text.trim()) || t.image_path || t.audio_path || t.video_path
    );
    if (!all.length) return null;
    const i = Math.floor(Math.random() * all.length);
    return all[i];
  },

  /**
   * Ativa/Configura todos os grupos de uma vez.
   * opt = { enable, threshold, cooldown_sec, mode: 'fixed'|'random', template_id }
   */
  activateAllGroups(opt = {}) {
    const enable = !!opt.enable;
    const mode = (opt.mode === 'random') ? 'random' : 'fixed';
    const template_id = (opt.template_id != null) ? Number(opt.template_id) : null;

    // atualiza settings globais
    this.updateSettings({
      send_to_all: true,
      random_mode: mode === 'random',
      global_template_id: mode === 'fixed' ? template_id : null,
      threshold: (opt.threshold != null ? Number(opt.threshold) : undefined)
    });

    // aplica preset básico para todos os grupos
    const allIds = this.getAllGroupIds();
    for (const gid of allIds) {
      this.setGroupPreset(gid, {
        enabled: enable,
        threshold: opt.threshold != null ? Number(opt.threshold) : undefined,
        cooldown_sec: opt.cooldown_sec != null ? Number(opt.cooldown_sec) : undefined,
        // no modo random não fixamos template_id por grupo
        template_id: mode === 'fixed' ? template_id : null
      });
    }
    return this.getAllGroupPresets();
  }
};
