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

const DEFAULT_SESSION = 'default';

/* =========================
 * Helpers de migração/inspeção
 * ========================= */
function tableInfo(name) {
  try { return db.prepare(`PRAGMA table_info(${name})`).all(); } catch { return []; }
}
function columnExists(cols, colName) {
  return (cols || []).some(c => String(c.name).toLowerCase() === String(colName).toLowerCase());
}
function hasPkOn(cols, colName) {
  return (cols || []).some(c => String(c.name).toLowerCase() === String(colName).toLowerCase() && c.pk > 0);
}
function execSafe(sql) {
  if (!sql) return;
  try { db.exec(sql); } catch (e) { /* ignora se já existir */ }
}

/* =========================
 * Criação / Migração de schema
 * ========================= */

// 1) SETTINGS (PK = session)
(function migrateSettings() {
  const cols = tableInfo('settings');
  if (cols.length === 0) {
    // criar do zero, já no formato novo
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        session TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        threshold INTEGER NOT NULL DEFAULT 10,
        text_message TEXT DEFAULT '',
        send_to_all INTEGER NOT NULL DEFAULT 1,
        selected_groups_json TEXT DEFAULT '[]',
        image_path TEXT DEFAULT NULL,
        audio_path TEXT DEFAULT NULL,
        video_path TEXT DEFAULT NULL,
        random_mode INTEGER NOT NULL DEFAULT 0,
        global_template_id INTEGER
      );
      INSERT OR IGNORE INTO settings (session) VALUES ('${DEFAULT_SESSION}');
    `);
    return;
  }

  // se já tiver coluna session e for PK, apenas garantir colunas novas
  if (columnExists(cols, 'session') && !columnExists(cols, 'id')) {
    if (!columnExists(cols, 'video_path')) {
      execSafe(`ALTER TABLE settings ADD COLUMN video_path TEXT DEFAULT NULL`);
    }
    if (!columnExists(cols, 'random_mode')) {
      execSafe(`ALTER TABLE settings ADD COLUMN random_mode INTEGER NOT NULL DEFAULT 0`);
    }
    if (!columnExists(cols, 'global_template_id')) {
      execSafe(`ALTER TABLE settings ADD COLUMN global_template_id INTEGER`);
    }
    return;
  }

  // Tinha o schema antigo (id=1). Recriar com nova PK (session)
  db.exec(`BEGIN`);
  try {
    const old = db.prepare(`SELECT * FROM settings WHERE id = 1`).get() || {};
    db.exec(`
      CREATE TABLE _settings_new (
        session TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        threshold INTEGER NOT NULL DEFAULT 10,
        text_message TEXT DEFAULT '',
        send_to_all INTEGER NOT NULL DEFAULT 1,
        selected_groups_json TEXT DEFAULT '[]',
        image_path TEXT DEFAULT NULL,
        audio_path TEXT DEFAULT NULL,
        video_path TEXT DEFAULT NULL,
        random_mode INTEGER NOT NULL DEFAULT 0,
        global_template_id INTEGER
      );
    `);

    const ins = db.prepare(`
      INSERT INTO _settings_new
        (session, enabled, threshold, text_message, send_to_all, selected_groups_json,
         image_path, audio_path, video_path, random_mode, global_template_id)
      VALUES (@session, @enabled, @threshold, @text_message, @send_to_all, @selected_groups_json,
              @image_path, @audio_path, @video_path, @random_mode, @global_template_id)
    `);

    ins.run({
      session: DEFAULT_SESSION,
      enabled: old.enabled ? 1 : 0,
      threshold: Number(old.threshold ?? 10),
      text_message: String(old.text_message ?? ''),
      send_to_all: old.send_to_all ? 1 : 0,
      selected_groups_json: old.selected_groups_json ?? '[]',
      image_path: old.image_path ?? null,
      audio_path: old.audio_path ?? null,
      video_path: old.video_path ?? null,
      random_mode: old.random_mode ? 1 : 0,
      global_template_id: (old.global_template_id == null ? null : Number(old.global_template_id)),
    });

    db.exec(`DROP TABLE settings;`);
    db.exec(`ALTER TABLE _settings_new RENAME TO settings;`);
    db.exec(`COMMIT`);
  } catch (e) {
    db.exec(`ROLLBACK`);
    throw e;
  }
})();

// 2) GROUP_COUNTERS (PK = (session, group_id))
(function migrateGroupCounters() {
  const cols = tableInfo('group_counters');
  if (cols.length === 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS group_counters (
        session TEXT NOT NULL,
        group_id TEXT NOT NULL,
        group_name TEXT,
        count INTEGER NOT NULL DEFAULT 0,
        last_reset TEXT,
        last_sent TEXT,
        PRIMARY KEY (session, group_id)
      );
      CREATE INDEX IF NOT EXISTS idx_counters_session_name ON group_counters(session, group_name);
    `);
    return;
  }

  const needSession = !columnExists(cols, 'session');
  const needPkComposite = !(hasPkOn(cols, 'session') && hasPkOn(cols, 'group_id'));

  if (!needSession && !needPkComposite) {
    execSafe(`CREATE INDEX IF NOT EXISTS idx_counters_session_name ON group_counters(session, group_name)`);
    return;
  }

  db.exec(`BEGIN`);
  try {
    db.exec(`
      CREATE TABLE _group_counters_new (
        session TEXT NOT NULL,
        group_id TEXT NOT NULL,
        group_name TEXT,
        count INTEGER NOT NULL DEFAULT 0,
        last_reset TEXT,
        last_sent TEXT,
        PRIMARY KEY (session, group_id)
      );
    `);

    if (needSession) {
      db.exec(`
        INSERT INTO _group_counters_new (session, group_id, group_name, count, last_reset, last_sent)
        SELECT '${DEFAULT_SESSION}', group_id, group_name, count, last_reset, last_sent
        FROM group_counters;
      `);
    } else {
      db.exec(`
        INSERT INTO _group_counters_new (session, group_id, group_name, count, last_reset, last_sent)
        SELECT session, group_id, group_name, count, last_reset, last_sent
        FROM group_counters;
      `);
    }

    db.exec(`DROP TABLE group_counters;`);
    db.exec(`ALTER TABLE _group_counters_new RENAME TO group_counters;`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_counters_session_name ON group_counters(session, group_name);`);
    db.exec(`COMMIT`);
  } catch (e) {
    db.exec(`ROLLBACK`);
    throw e;
  }
})();

// 3) GROUP_PRESETS (PK = (session, group_id))
(function migrateGroupPresets() {
  const cols = tableInfo('group_presets');
  if (cols.length === 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS group_presets (
        session TEXT NOT NULL,
        group_id TEXT NOT NULL,
        enabled INTEGER,
        threshold INTEGER,
        cooldown_sec INTEGER,
        rotate_index INTEGER DEFAULT 0,
        selected_index INTEGER,
        messages_json TEXT,
        template_id INTEGER,
        PRIMARY KEY (session, group_id)
      );
    `);
    return;
  }

  const needSession = !columnExists(cols, 'session');
  const needTemplateId = !columnExists(cols, 'template_id');
  const needPkComposite = !(hasPkOn(cols, 'session') && hasPkOn(cols, 'group_id'));

  if (!needSession && !needTemplateId && !needPkComposite) {
    return;
  }

  db.exec(`BEGIN`);
  try {
    db.exec(`
      CREATE TABLE _group_presets_new (
        session TEXT NOT NULL,
        group_id TEXT NOT NULL,
        enabled INTEGER,
        threshold INTEGER,
        cooldown_sec INTEGER,
        rotate_index INTEGER DEFAULT 0,
        selected_index INTEGER,
        messages_json TEXT,
        template_id INTEGER,
        PRIMARY KEY (session, group_id)
      );
    `);

    if (tableInfo('group_presets').length) {
      const hasRotate = columnExists(cols, 'rotate_index');
      const hasSelIdx = columnExists(cols, 'selected_index');
      const hasMsg = columnExists(cols, 'messages_json');
      const hasTpl = columnExists(cols, 'template_id');

      const selectCols = [
        needSession ? `'${DEFAULT_SESSION}' AS session` : `session`,
        `group_id`,
        `enabled`,
        `threshold`,
        `cooldown_sec`,
        hasRotate ? `rotate_index` : `0 AS rotate_index`,
        hasSelIdx ? `selected_index` : `NULL AS selected_index`,
        hasMsg ? `messages_json` : `NULL AS messages_json`,
        hasTpl ? `template_id` : `NULL AS template_id`,
      ].join(', ');

      db.exec(`
        INSERT INTO _group_presets_new
          (session, group_id, enabled, threshold, cooldown_sec, rotate_index, selected_index, messages_json, template_id)
        SELECT ${selectCols} FROM group_presets;
      `);
    }

    db.exec(`DROP TABLE group_presets;`);
    db.exec(`ALTER TABLE _group_presets_new RENAME TO group_presets;`);
    db.exec(`COMMIT`);
  } catch (e) {
    db.exec(`ROLLBACK`);
    throw e;
  }
})();

// 4) TEMPLATES (id AUTOINCREMENT + session + video_path)
(function migrateTemplates() {
  const cols = tableInfo('templates');
  if (cols.length === 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session TEXT NOT NULL DEFAULT '${DEFAULT_SESSION}',
        name TEXT NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        image_path TEXT DEFAULT NULL,
        audio_path TEXT DEFAULT NULL,
        video_path TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  } else {
    if (!columnExists(cols, 'session')) {
      execSafe(`ALTER TABLE templates ADD COLUMN session TEXT DEFAULT '${DEFAULT_SESSION}'`);
      execSafe(`UPDATE templates SET session='${DEFAULT_SESSION}' WHERE session IS NULL`);
    }
    if (!columnExists(cols, 'video_path')) {
      execSafe(`ALTER TABLE templates ADD COLUMN video_path TEXT DEFAULT NULL`);
    }
  }
  execSafe(`CREATE INDEX IF NOT EXISTS idx_templates_session ON templates(session)`);
})();

// Trigger updated_at
execSafe(`
  CREATE TRIGGER IF NOT EXISTS trg_templates_updated_at
  AFTER UPDATE ON templates
  FOR EACH ROW
  BEGIN
    UPDATE templates SET updated_at = datetime('now') WHERE id = NEW.id;
  END;
`);

/* =========================
 * Funções utilitárias comuns
 * ========================= */
function parseJSON(json, fallback) {
  try { return JSON.parse(json); } catch { return fallback; }
}
function parseMessages(json) {
  return parseJSON(json || '[]', []);
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

/* =========================
 * Fábrica de Store por sessão
 * ========================= */
function makeStore(session) {
  const sess = session || DEFAULT_SESSION;

  // SETTINGS
  const getSettingsStmt = db.prepare(`SELECT * FROM settings WHERE session = ?`);
  // NOVO: garante linha com defaults
  const ensureSettingsRowStmt = db.prepare(`INSERT OR IGNORE INTO settings (session) VALUES (?)`);

  const upsertSettingsStmt = db.prepare(`
    INSERT INTO settings
      (session, enabled, threshold, text_message, send_to_all, selected_groups_json,
       image_path, audio_path, video_path, random_mode, global_template_id)
    VALUES
      (@session, @enabled, @threshold, @text_message, @send_to_all, @selected_groups_json,
       @image_path, @audio_path, @video_path, @random_mode, @global_template_id)
    ON CONFLICT(session) DO UPDATE SET
      enabled = excluded.enabled,
      threshold = excluded.threshold,
      text_message = excluded.text_message,
      send_to_all = excluded.send_to_all,
      selected_groups_json = excluded.selected_groups_json,
      image_path = excluded.image_path,
      audio_path = excluded.audio_path,
      video_path = excluded.video_path,
      random_mode = excluded.random_mode,
      global_template_id = excluded.global_template_id
  `);

  // COUNTERS
  const upsertGroupStmt = db.prepare(`
    INSERT INTO group_counters (session, group_id, group_name, count, last_reset, last_sent)
    VALUES (?, ?, ?, 0, datetime('now'), NULL)
    ON CONFLICT(session, group_id) DO UPDATE SET group_name = excluded.group_name
  `);
  const incrementStmt       = db.prepare(`UPDATE group_counters SET count = count + 1 WHERE session = ? AND group_id = ?`);
  const resetStmt           = db.prepare(`UPDATE group_counters SET count = 0, last_reset = datetime('now') WHERE session = ? AND group_id = ?`);
  const setLastSentNowStmt  = db.prepare(`UPDATE group_counters SET last_sent = datetime('now') WHERE session = @session AND group_id = @id`);
  const setLastSentAtStmt   = db.prepare(`UPDATE group_counters SET last_sent = @ts WHERE session = @session AND group_id = @id`);
  const getAllCountersStmt  = db.prepare(`
    SELECT group_id, group_name, count, last_reset, last_sent
    FROM group_counters
    WHERE session = ?
    ORDER BY group_name
  `);
  const getCounterStmt      = db.prepare(`
    SELECT group_id, group_name, count, last_reset, last_sent
    FROM group_counters
    WHERE session = ? AND group_id = ?
  `);
  const selectAllGroupIdsStmt = db.prepare(`SELECT group_id FROM group_counters WHERE session = ? ORDER BY group_name`);

  // PRESETS
  const selectAllPresetsStmt = db.prepare(`SELECT * FROM group_presets WHERE session = ?`);
  const selectPresetStmt     = db.prepare(`SELECT * FROM group_presets WHERE session = ? AND group_id = ?`);
  const upsertPresetStmt     = db.prepare(`
    INSERT INTO group_presets
      (session, group_id, enabled, threshold, cooldown_sec, rotate_index, selected_index, messages_json, template_id)
    VALUES
      (@session, @group_id, @enabled, @threshold, @cooldown_sec, @rotate_index, @selected_index, @messages_json, @template_id)
    ON CONFLICT(session, group_id) DO UPDATE SET
      enabled        = excluded.enabled,
      threshold      = excluded.threshold,
      cooldown_sec   = excluded.cooldown_sec,
      rotate_index   = COALESCE(excluded.rotate_index, group_presets.rotate_index),
      selected_index = excluded.selected_index,
      template_id    = excluded.template_id,
      messages_json  = COALESCE(excluded.messages_json, group_presets.messages_json)
  `);
  const bumpRotateStmt = db.prepare(`UPDATE group_presets SET rotate_index = @idx WHERE session = @session AND group_id = @group_id`);
  const clearTemplateFromPresetsStmt = db.prepare(`UPDATE group_presets SET template_id = NULL WHERE session = ? AND template_id = ?`);

  // TEMPLATES
  const selectAllTemplatesStmt = db.prepare(`SELECT * FROM templates WHERE session = ? ORDER BY id ASC`);
  const selectTemplateStmt     = db.prepare(`SELECT * FROM templates WHERE id = ? AND session = ?`);
  const insertTemplateStmt     = db.prepare(`
    INSERT INTO templates (session, name, text, image_path, audio_path, video_path)
    VALUES (@session, @name, @text, @image_path, @audio_path, @video_path)
  `);
  const updateTemplateStmt     = db.prepare(`
    UPDATE templates SET
      name = COALESCE(@name, name),
      text = COALESCE(@text, text),
      image_path = @image_path,
      audio_path = @audio_path,
      video_path = @video_path
    WHERE id = @id AND session = @session
  `);
  const deleteTemplateStmt     = db.prepare(`DELETE FROM templates WHERE id = ? AND session = ?`);

  return {
    // Identificação
    session: sess,

    // SETTINGS
    getSettings() {
      // garante que a linha exista com DEFAULTs
      ensureSettingsRowStmt.run(sess);

      const row = getSettingsStmt.get(sess) || {};
      // se por algum motivo ainda não houver, cria e busca de novo
      if (!row.session) {
        ensureSettingsRowStmt.run(sess);
        const again = getSettingsStmt.get(sess) || {};
        if (!again.session) return {
          session: sess,
          enabled: false,
          threshold: 10,
          text_message: '',
          send_to_all: true,
          selected_groups: [],
          image_path: null,
          audio_path: null,
          video_path: null,
          random_mode: false,
          global_template_id: null
        };
        return this.getSettings();
      }

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
      // garante a linha antes do upsert com todos os campos
      ensureSettingsRowStmt.run(sess);

      const current = this.getSettings();
      const toInt = (v) => (v ? 1 : 0);
      const updated = {
        session: sess,
        enabled: payload.enabled !== undefined ? toInt(payload.enabled) : toInt(current.enabled),
        threshold: Number(payload.threshold ?? current.threshold ?? 10),
        text_message: String(payload.text_message ?? current.text_message ?? ''),
        send_to_all: payload.send_to_all !== undefined ? toInt(payload.send_to_all) : toInt(current.send_to_all),
        selected_groups_json: JSON.stringify(payload.selected_groups ?? current.selected_groups ?? []),
        image_path: (payload.image_path ?? current.image_path) ?? null,
        audio_path: (payload.audio_path ?? current.audio_path) ?? null,
        video_path: (payload.video_path ?? current.video_path) ?? null,
        random_mode: payload.random_mode !== undefined ? toInt(payload.random_mode) : toInt(current.random_mode),
        global_template_id: (payload.global_template_id !== undefined)
          ? (payload.global_template_id == null ? null : Number(payload.global_template_id))
          : current.global_template_id
      };
      upsertSettingsStmt.run(updated);
      return this.getSettings();
    },

    // COUNTERS
    upsertGroup(group) { upsertGroupStmt.run(sess, group.id, group.name); },
    increment(groupId) { incrementStmt.run(sess, groupId); },
    reset(groupId)     { resetStmt.run(sess, groupId); },

    setLastSent(groupId, ts) {
      if (ts) setLastSentAtStmt.run({ session: sess, id: groupId, ts });
      else    setLastSentNowStmt.run({ session: sess, id: groupId });
    },

    getAllCounters()     { return getAllCountersStmt.all(sess); },
    getCounter(groupId)  { return getCounterStmt.get(sess, groupId); },
    getAllGroupIds()     { return selectAllGroupIdsStmt.all(sess).map(r => r.group_id); },

    // PRESETS
    getAllGroupPresets() {
      const rows = selectAllPresetsStmt.all(sess);
      return rows.map(presetRowToObj);
    },
    getGroupPreset(groupId) {
      const row = selectPresetStmt.get(sess, groupId);
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
        session: sess,
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
      bumpRotateStmt.run({ session: sess, group_id: groupId, idx: Number(nextIdx || 0) });
    },

    // TEMPLATES
    getAllTemplates() {
      return selectAllTemplatesStmt.all(sess).map((t) => ({ ...t, id: Number(t.id) }));
    },
    getTemplate(id) {
      const row = selectTemplateStmt.get(Number(id), sess);
      if (!row) return null;
      return { ...row, id: Number(row.id) };
    },
    templateExists(id) {
      if (id == null) return false;
      const row = selectTemplateStmt.get(Number(id), sess);
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
      const info = insertTemplateStmt.run({ session: sess, name, text, image_path, audio_path, video_path });
      return this.getTemplate(info.lastInsertRowid);
    },
    updateTemplate(id, patch = {}) {
      const payload = {
        session: sess,
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
      deleteTemplateStmt.run(Number(id), sess);
    },
    clearTemplateFromPresets(id) {
      clearTemplateFromPresetsStmt.run(sess, Number(id));
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
     * Ativa/Configura todos os grupos de uma vez para ESTA sessão.
     * opt = { enable, threshold, cooldown_sec, mode: 'fixed'|'random', template_id }
     */
    activateAllGroups(opt = {}) {
      const enable = !!opt.enable;
      const mode = (opt.mode === 'random') ? 'random' : 'fixed';
      const template_id = (opt.template_id != null) ? Number(opt.template_id) : null;

      // atualiza settings da sessão
      this.updateSettings({
        send_to_all: true,
        random_mode: mode === 'random',
        global_template_id: mode === 'fixed' ? template_id : null,
        threshold: (opt.threshold != null ? Number(opt.threshold) : undefined)
      });

      // aplica preset básico para todos os grupos da sessão
      const allIds = this.getAllGroupIds();
      for (const gid of allIds) {
        this.setGroupPreset(gid, {
          enabled: enable,
          threshold: opt.threshold != null ? Number(opt.threshold) : undefined,
          cooldown_sec: opt.cooldown_sec != null ? Number(opt.cooldown_sec) : undefined,
          template_id: mode === 'fixed' ? template_id : null
        });
      }
      return this.getAllGroupPresets();
    }
  };
}

/* =========================
 * Export público
 * ========================= */

// API por sessão
function forSession(session) {
  return makeStore(session);
}

// API legada (mantém compatibilidade) usando 'default'
const legacy = makeStore(DEFAULT_SESSION);

module.exports = {
  DEFAULT_SESSION,
  forSession,

  // Legado:
  getSettings: legacy.getSettings,
  updateSettings: legacy.updateSettings,

  upsertGroup: legacy.upsertGroup,
  increment: legacy.increment,
  reset: legacy.reset,
  setLastSent: legacy.setLastSent,
  getAllCounters: legacy.getAllCounters,
  getCounter: legacy.getCounter,
  getAllGroupIds: legacy.getAllGroupIds,

  getAllGroupPresets: legacy.getAllGroupPresets,
  getGroupPreset: legacy.getGroupPreset,
  setGroupPreset: legacy.setGroupPreset,
  bumpPresetRotateIndex: legacy.bumpPresetRotateIndex,

  getAllTemplates: legacy.getAllTemplates,
  getTemplate: legacy.getTemplate,
  templateExists: legacy.templateExists,
  createTemplate: legacy.createTemplate,
  updateTemplate: legacy.updateTemplate,
  deleteTemplate: legacy.deleteTemplate,
  clearTemplateFromPresets: legacy.clearTemplateFromPresets,

  pickRandomTemplate: legacy.pickRandomTemplate,
  activateAllGroups: legacy.activateAllGroups,
};
