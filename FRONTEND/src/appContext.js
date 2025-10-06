// FRONTEND/src/appContext.js — VERSÃO DB (templates persistidos no backend)
import React, { createContext, useState, useEffect, useMemo, useCallback } from 'react';
import { io } from 'socket.io-client';

export const AppContext = createContext();

const API =
  (import.meta && import.meta.env && import.meta.env.VITE_API_BASE) ||
  '';

export const AppProvider = ({ children }) => {
  const [darkMode, setDarkMode] = useState(false);

  const [status, setStatus] = useState({ status: 'DISCONNECTED' });
  const [qrCode, setQrCode] = useState(null);

  const [groups, setGroups] = useState([]);
  const [groupPresets, setGroupPresets] = useState({});
  const [counters, setCounters] = useState({});

  // >>> catálogo de mensagens persistido no DB
  // Cada template: { id, name, text, image_path, audio_path, created_at, updated_at }
  const [templates, setTemplates] = useState([]);

  const [error, setError] = useState(null);

  const isConnected = useMemo(() => {
    const s = String(status?.status || '').toLowerCase();
    return ['islogged', 'inchat', 'qrreadsuccess', 'connected', 'main', 'normal'].includes(s);
  }, [status]);

  const j = useCallback(async (res) => {
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }, []);

  // ------- Loads -------
  const loadStatus = useCallback(async () => {
    try {
      const data = await fetch(`${API}/api/status`).then(j);
      setStatus(data.wpp || {});
      const map = {};
      (data.counters || []).forEach((r) => { map[r.group_id] = r; });
      setCounters(map);
    } catch (e) {
      console.error('[front] loadStatus error', e);
      setError('Falha ao carregar status.');
    }
  }, [j]);

  const loadGroups = useCallback(async () => {
    try {
      const gs = await fetch(`${API}/api/groups`).then(j);
      setGroups(gs || []);
      return gs || [];
    } catch (e) {
      console.error('[front] loadGroups error', e);
      setError('Falha ao carregar grupos.');
      return [];
    }
  }, [j]);

  const loadGroupPresets = useCallback(async () => {
    try {
      const arr = await fetch(`${API}/api/group-presets`).then(j);
      const map = {};
      (arr || []).forEach((p) => { if (p?.group_id) map[p.group_id] = p; });
      setGroupPresets(map);
      return map;
    } catch (e) {
      console.error('[front] loadGroupPresets error', e);
      return {};
    }
  }, [j]);

  const loadTemplates = useCallback(async () => {
    try {
      const list = await fetch(`${API}/api/templates`).then(j);
      setTemplates(Array.isArray(list) ? list : []);
      return Array.isArray(list) ? list : [];
    } catch (e) {
      console.error('[front] loadTemplates error', e);
      setError('Falha ao carregar templates.');
      return [];
    }
  }, [j]);

  // 🔒 garante templates carregados sob demanda (útil antes de abrir o modal)
  const ensureTemplatesLoaded = useCallback(async () => {
    if (Array.isArray(templates) && templates.length > 0) return templates;
    return await loadTemplates();
  }, [templates, loadTemplates]);

  // ------- Sessão -------
  const start = useCallback(async () => {
    try {
      await fetch(`${API}/api/bot/start`, { method: 'POST' }).then(j);
      await loadStatus();
    } catch (e) {
      console.error('[front] start error', e);
      setError('Falha ao iniciar sessão.');
    }
  }, [j, loadStatus]);

  const disconnect = useCallback(async () => {
    try {
      await fetch(`${API}/api/bot/disconnect`, { method: 'POST' }).then(j);
      setQrCode(null);
      await loadStatus();
    } catch (e) {
      console.error('[front] disconnect error', e);
      setError('Falha ao desconectar.');
    }
  }, [j, loadStatus]);

  // ------- Upload de mídia por TEMPLATE -------
  const uploadCatalogMedia = useCallback(async (file) => {
    const fd = new FormData();
    if (file && file.type?.startsWith('image/')) fd.append('image', file);
    else if (file && file.type?.startsWith('audio/')) fd.append('audio', file);
    else fd.append('image', file);

    try {
      const res = await fetch(`${API}/api/catalog-media`, { method: 'POST', body: fd }).then(j);
      // res.path -> caminho absoluto no FS do servidor (usado no sendFile)
      // res.rel  -> "uploads/<arquivo>", útil só para exibir nome
      return res;
    } catch (e) {
      console.error('[front] uploadCatalogMedia error', e);
      setError('Falha no upload de mídia.');
      return null;
    }
  }, [j]);

  // ------- CRUD de Templates (DB) -------
  const createTemplate = useCallback(async ({ name, text, image_path = null, audio_path = null }) => {
    try {
      const body = { name: String(name || '').trim(), text: String(text || '').trim(), image_path, audio_path };
      const res = await fetch(`${API}/api/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(j);
      const tpl = res?.template;
      if (tpl?.id) setTemplates((prev) => [...prev, tpl]);
      return tpl;
    } catch (e) {
      console.error('[front] createTemplate error', e);
      setError('Falha ao criar template.');
      return null;
    }
  }, [j]);

  const updateTemplate = useCallback(async (id, patch = {}) => {
    try {
      const res = await fetch(`${API}/api/templates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      }).then(j);
      const updated = res?.template;
      if (updated?.id) {
        setTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      }
      return updated;
    } catch (e) {
      console.error('[front] updateTemplate error', e);
      setError('Falha ao atualizar template.');
      return null;
    }
  }, [j]);

  const deleteTemplate = useCallback(async (id) => {
    try {
      await fetch(`${API}/api/templates/${id}`, { method: 'DELETE' }).then(j);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      // importante: presets que apontavam para esse template foram limpos no backend
      // então atualizamos o mapa local para refletir imediatamente
      await loadGroupPresets();
      return true;
    } catch (e) {
      console.error('[front] deleteTemplate error', e);
      setError('Falha ao remover template.');
      return false;
    }
  }, [j, loadGroupPresets]);

  // ------- Preset por grupo (agora com template_id) -------
  const saveGroupPreset = useCallback(
    async ({ group_id, enabled, threshold, cooldown_sec, template_id, snapshotMessage }) => {
      try {
        // prioridade é template_id; se vier snapshotMessage, mandamos em messages (opcional)
        const payload = {
          group_id,
          enabled: !!enabled,
          threshold: (threshold != null ? Number(threshold) : undefined),
          cooldown_sec: (cooldown_sec != null ? Number(cooldown_sec) : undefined),
          template_id: (template_id != null ? Number(template_id) : null),
          // compat: ao enviar [], limpamos qualquer snapshot antigo para usar só o template
          messages: Array.isArray(snapshotMessage) ? snapshotMessage : []
        };

        const res = await fetch(`${API}/api/group-presets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(j);

        const saved = res?.preset;
        if (saved?.group_id) {
          setGroupPresets((prev) => ({ ...prev, [saved.group_id]: saved }));
        }
        return saved;
      } catch (e) {
        console.error('[front] saveGroupPreset error', e);
        setError('Falha ao salvar preset do grupo.');
        return null;
      }
    },
    [j]
  );

  // ------- Bootstrap + Socket -------
  useEffect(() => {
    loadStatus();
    loadGroups();
    loadGroupPresets();
    loadTemplates();

    (async () => {
      try {
        const res = await fetch(`${API}/api/qr`);
        if (res.ok) {
          const data = await res.json();
          if (data?.base64Qr) setQrCode(data.base64Qr);
        }
      } catch {}
    })();

    const socket = io(API || window.location.origin, {
      transports: ['websocket', 'polling'],
      withCredentials: false
    });

    socket.on('connect_error', (err) => {
      console.warn('[socket] connect_error:', err?.message || err);
    });

    socket.on('wpp:status', (s) => { setStatus(s || {}); setError(null); if (!s) setQrCode(null); });
    socket.on('wpp:qr', (p) => { setQrCode(p?.base64Qr || null); setError(null); });
    socket.on('counter:update', (row) => {
      if (row?.group_id) setCounters((prev) => ({ ...prev, [row.group_id]: row }));
    });
    socket.on('groups:refresh', (g) => { setGroups(Array.isArray(g) ? g : []); });

    return () => { socket.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------- Tema -------
  useEffect(() => {
    if (darkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    try { localStorage.setItem('ebhc_dark', JSON.stringify(!!darkMode)); } catch {}
  }, [darkMode]);

  useEffect(() => {
    try { setDarkMode(!!JSON.parse(localStorage.getItem('ebhc_dark') || 'false')); } catch {}
  }, []);

  return (
    <AppContext.Provider
      value={{
        darkMode, setDarkMode,
        status, isConnected, qrCode, error,
        groups, groupPresets, counters,
        templates, setTemplates,
        start, disconnect,
        loadGroups, loadGroupPresets, loadTemplates,
        ensureTemplatesLoaded,          // << novo helper
        // Templates (CRUD)
        createTemplate, updateTemplate, deleteTemplate,
        // Upload de mídia por template
        uploadCatalogMedia,
        // Preset por grupo
        saveGroupPreset,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};
