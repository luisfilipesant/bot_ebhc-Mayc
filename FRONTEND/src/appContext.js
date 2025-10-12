// FRONTEND/src/appContext.js — multi-sessões + templates persistidos no backend
import React, { createContext, useState, useEffect, useMemo, useCallback } from 'react';
import { io } from 'socket.io-client';

export const AppContext = createContext();

const API =
  (import.meta && import.meta.env && import.meta.env.VITE_API_BASE) ||
  '';

export const AppProvider = ({ children }) => {
  const [darkMode, setDarkMode] = useState(false);

  // === Sessão ===
  const [session, _setSession] = useState('default');
  const setSession = useCallback((name) => {
    const s = String(name || '').trim() || 'default';
    _setSession(s);
    try { localStorage.setItem('ebhc_session', s); } catch {}
  }, []);

  // Bases derivadas da sessão
  const apiBase = useMemo(() => {
    // garante /api/<session>
    const base = API || '';
    return `${base}/api/${session}`;
  }, [session]);

  // Estado principal
  const [status, setStatus] = useState({ status: 'DISCONNECTED' });
  const [qrCode, setQrCode] = useState(null);

  const [groups, setGroups] = useState([]);
  const [groupPresets, setGroupPresets] = useState({});
  const [counters, setCounters] = useState({});

  // templates do DB
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
      const data = await fetch(`${apiBase}/status`).then(j);
      setStatus(data.wpp || {});
      const map = {};
      (data.counters || []).forEach((r) => { map[r.group_id] = r; });
      setCounters(map);
    } catch (e) {
      console.error('[front] loadStatus error', e);
      setError('Falha ao carregar status.');
    }
  }, [j, apiBase]);

  const loadGroups = useCallback(async () => {
    try {
      const gs = await fetch(`${apiBase}/groups`).then(j);
      setGroups(gs || []);
      return gs || [];
    } catch (e) {
      console.error('[front] loadGroups error', e);
      setError('Falha ao carregar grupos.');
      return [];
    }
  }, [j, apiBase]);

  const loadGroupPresets = useCallback(async () => {
    try {
      const arr = await fetch(`${apiBase}/group-presets`).then(j);
      const map = {};
      (arr || []).forEach((p) => { if (p?.group_id) map[p.group_id] = p; });
      setGroupPresets(map);
      return map;
    } catch (e) {
      console.error('[front] loadGroupPresets error', e);
      return {};
    }
  }, [j, apiBase]);

  const loadTemplates = useCallback(async () => {
    try {
      const list = await fetch(`${apiBase}/templates`).then(j);
      setTemplates(Array.isArray(list) ? list : []);
      return Array.isArray(list) ? list : [];
    } catch (e) {
      console.error('[front] loadTemplates error', e);
      setError('Falha ao carregar templates.');
      return [];
    }
  }, [j, apiBase]);

  // ------- Sessão: ações -------
  const start = useCallback(async () => {
    try {
      await fetch(`${apiBase}/bot/start`, { method: 'POST' }).then(j);
      await loadStatus();
    } catch (e) {
      console.error('[front] start error', e);
      setError('Falha ao iniciar sessão.');
    }
  }, [j, loadStatus, apiBase]);

  const disconnect = useCallback(async () => {
    try {
      await fetch(`${apiBase}/bot/disconnect`, { method: 'POST' }).then(j);
      setQrCode(null);
      await loadStatus();
    } catch (e) {
      console.error('[front] disconnect error', e);
      setError('Falha ao desconectar.');
    }
  }, [j, loadStatus, apiBase]);

  // Reset total desta sessão (.wpp-data/<SESSION_NAME>)
  const resetSession = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/session/wipe`, { method: 'POST' }).then(j);
      setQrCode(null);
      // Recarrega dados da sessão atual
      await loadStatus();
      await loadGroups();
      // Zera presets/contadores locais (serão abastecidos quando eventos ou loads chegarem)
      setGroupPresets({});
      setCounters({});
      return res;
    } catch (e) {
      console.error('[front] resetSession error', e);
      setError('Falha ao resetar a sessão.');
      return null;
    }
  }, [j, loadStatus, loadGroups, apiBase]);

  // Upload de mídia por TEMPLATE
  const uploadCatalogMedia = useCallback(async (file) => {
    const fd = new FormData();
    if (file && file.type?.startsWith('image/')) fd.append('image', file);
    else if (file && file.type?.startsWith('audio/')) fd.append('audio', file);
    else if (file && file.type?.startsWith('video/')) fd.append('video', file);
    else fd.append('image', file);

    try {
      const res = await fetch(`${apiBase}/catalog-media`, { method: 'POST', body: fd }).then(j);
      return res;
    } catch (e) {
      console.error('[front] uploadCatalogMedia error', e);
      setError('Falha no upload de mídia.');
      return null;
    }
  }, [j, apiBase]);

  // CRUD Templates
  const createTemplate = useCallback(async ({ name, text, image_path = null, audio_path = null, video_path = null }) => {
    try {
      const body = {
        name: String(name || '').trim(),
        text: String(text || '').trim(),
        image_path, audio_path, video_path
      };
      const res = await fetch(`${apiBase}/templates`, {
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
  }, [j, apiBase]);

  const updateTemplate = useCallback(async (id, patch = {}) => {
    try {
      const res = await fetch(`${apiBase}/templates/${id}`, {
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
  }, [j, apiBase]);

  const deleteTemplate = useCallback(async (id) => {
    try {
      await fetch(`${apiBase}/templates/${id}`, { method: 'DELETE' }).then(j);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      // também recarrega presets para refletir a limpeza de template_id
      await loadGroupPresets();
      return true;
    } catch (e) {
      console.error('[front] deleteTemplate error', e);
      setError('Falha ao remover template.');
      return false;
    }
  }, [j, loadGroupPresets, apiBase]);

  // Preset por grupo
  const saveGroupPreset = useCallback(
    async ({ group_id, enabled, threshold, cooldown_sec, template_id, snapshotMessage }) => {
      try {
        const payload = {
          group_id,
          enabled: !!enabled,
          threshold: (threshold != null ? Number(threshold) : undefined),
          cooldown_sec: (cooldown_sec != null ? Number(cooldown_sec) : undefined),
          template_id: (template_id != null ? Number(template_id) : null),
          messages: Array.isArray(snapshotMessage) ? snapshotMessage : []
        };
        const res = await fetch(`${apiBase}/group-presets`, {
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
    [j, apiBase]
  );

  // Ativar todos em lote
  const bulkActivateAll = useCallback(
    async ({ enable = true, mode = 'fixed', template_id = null, threshold = undefined, cooldown_sec = undefined }) => {
      try {
        const body = { enable, mode, template_id, threshold, cooldown_sec };
        const res = await fetch(`${apiBase}/groups/activate-all`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }).then(j);
        // aplica presets retornados
        const map = {};
        (res?.presets || []).forEach((p) => { if (p?.group_id) map[p.group_id] = p; });
        setGroupPresets(map);
        return res;
      } catch (e) {
        console.error('[front] bulkActivateAll error', e);
        setError('Falha ao ativar em todos os grupos.');
        return null;
      }
    },
    [j, apiBase]
  );

  // Bootstrap sessão e Socket.IO
  useEffect(() => {
    // ao trocar de sessão, limpa estados essenciais para evitar leak visual
    setStatus({ status: 'DISCONNECTED' });
    setQrCode(null);
    setGroups([]);
    setGroupPresets({});
    setCounters({});
    setTemplates([]);
    setError(null);

    // carregamentos iniciais da sessão atual
    loadStatus();
    loadGroups();
    loadGroupPresets();
    loadTemplates();

    // QR fallback
    (async () => {
      try {
        const res = await fetch(`${apiBase}/qr`);
        if (res.ok) {
          const data = await res.json();
          if (data?.base64Qr) setQrCode(data.base64Qr);
        }
      } catch {}
    })();

    // socket ligado à sessão
    const socket = io(API || window.location.origin, {
      transports: ['websocket', 'polling'],
      withCredentials: false,
      query: { session }, // <- ESSENCIAL
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
  }, [session]); // recria quando a sessão muda

  // Dark mode persistência
  useEffect(() => {
    if (darkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    try { localStorage.setItem('ebhc_dark', JSON.stringify(!!darkMode)); } catch {}
  }, [darkMode]);

  // Bootstrap preferências: dark e sessão
  useEffect(() => {
    try {
      setDarkMode(!!JSON.parse(localStorage.getItem('ebhc_dark') || 'false'));
    } catch {}
    try {
      const saved = localStorage.getItem('ebhc_session');
      if (saved) _setSession(saved);
    } catch {}
  }, []);

  return (
    <AppContext.Provider
      value={{
        // Preferências
        darkMode, setDarkMode,

        // Sessão
        session, setSession,

        // Estado geral
        status, isConnected, qrCode, error,
        groups, groupPresets, counters,
        templates, setTemplates,

        // Sessão: ações
        start, disconnect, resetSession,

        // Loads (caso precise disparar manualmente)
        loadGroups, loadGroupPresets, loadTemplates,

        // Templates (CRUD)
        createTemplate, updateTemplate, deleteTemplate,

        // Upload de mídia por template
        uploadCatalogMedia,

        // Preset por grupo
        saveGroupPreset,

        // BULK
        bulkActivateAll,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};
