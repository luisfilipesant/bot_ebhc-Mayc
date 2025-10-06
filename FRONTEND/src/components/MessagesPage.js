// FRONTEND/src/components/MessagesPage.js — versão DB (com fix de corrida no "remover")
import React, { useState, useContext, useEffect, useMemo } from 'react';
import { AppContext } from '../appContext';

const MAX_TEMPLATES = 5;

const MessagesPage = () => {
  const {
    templates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    uploadCatalogMedia,
    loadTemplates,
  } = useContext(AppContext);

  // estado local editável (clone dos templates do contexto)
  const [local, setLocal] = useState([]);
  const [saving, setSaving] = useState(false);

  // sincroniza quando o contexto muda
  useEffect(() => {
    const mapped = (Array.isArray(templates) ? templates : []).map((t) => ({
      id: t.id,
      name: t.name || '',
      text: t.text || '',
      image_path: t.image_path ?? null,
      audio_path: t.audio_path ?? null,
      created_at: t.created_at || null,
      updated_at: t.updated_at || null,
      _isNew: false,
      _errors: {},
    }));
    setLocal(mapped);
  }, [templates]);

  const canCreate = useMemo(() => (Array.isArray(local) ? local.length < MAX_TEMPLATES : true), [local]);

  const handleCreate = () => {
    if (!canCreate) return;
    setLocal((prev) => [
      ...prev,
      {
        id: undefined, // ainda não criado no DB
        name: '',
        text: '',
        image_path: null,
        audio_path: null,
        created_at: null,
        updated_at: null,
        _isNew: true,
        _errors: {},
      },
    ]);
  };

  const handleChange = (idx, field, value) => {
    setLocal((prev) => {
      const next = [...prev];
      const cur = next[idx] || {};
      next[idx] = { ...cur, [field]: value };
      return next;
    });
  };

  const validate = (item) => {
    const errors = {};
    const name = String(item?.name || '').trim();
    const text = String(item?.text || '').trim();
    if (!name) errors.name = 'O nome da mensagem é obrigatório';
    else if (name.length > 50) errors.name = 'O nome deve ter no máximo 50 caracteres';
    if (!text) errors.text = 'O texto da mensagem é obrigatório';
    else if (text.length > 2000) errors.text = 'O texto deve ter no máximo 2000 caracteres';
    return errors;
  };

  // Salva usando o item atual + um "overridePatch" (evita corrida com setState)
  const handleSave = async (idx, overridePatch = {}) => {
    const itemFromState = local[idx];
    if (!itemFromState) return;

    // monta o snapshot que será enviado AGORA
    const draft = {
      ...itemFromState,
      ...overridePatch, // <- força o valor mais recente (ex.: image_path: null)
    };

    // valida antes de bater no servidor
    const errs = validate(draft);
    if (Object.keys(errs).length) {
      setLocal((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], _errors: errs };
        return next;
      });
      return;
    }

    try {
      setSaving(true);

      if (draft._isNew || !draft.id) {
        // criar no DB
        const created = await createTemplate({
          name: String(draft.name).trim(),
          text: String(draft.text).trim(),
          image_path: draft.image_path ?? null,
          audio_path: draft.audio_path ?? null,
        });
        if (created?.id) {
          await loadTemplates(); // recarrega para alinhar datas/ids
        }
      } else {
        // atualizar no DB — envia SEMPRE image_path/audio_path (mesmo null) para sobrescrever
        await updateTemplate(draft.id, {
          name: String(draft.name).trim(),
          text: String(draft.text).trim(),
          image_path: draft.image_path ?? null,
          audio_path: draft.audio_path ?? null,
        });

        // reflete no estado local imediatamente (sem esperar novo load)
        setLocal((prev) => {
          const next = [...prev];
          next[idx] = { ...draft, _isNew: false, _errors: {} };
          return next;
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (idx) => {
    const item = local[idx];
    if (!item) return;
    if (!window.confirm('Tem certeza que deseja excluir este template?')) return;

    if (item.id) {
      const ok = await deleteTemplate(item.id);
      if (!ok) return;
    }
    setLocal((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">Mensagens</h3>
          <p className="text-gray-600 dark:text-gray-300">
            Gerencie seus <b>templates</b> persistidos no servidor. Cada template pode ter anexos próprios (imagem/áudio).
          </p>
        </div>

        {canCreate && (
          <button
            onClick={handleCreate}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-purple-700 transition-colors duration-200 flex items-center space-x-2"
          >
            <span>➕</span><span>Novo Template</span>
          </button>
        )}
      </div>

      <div className="grid gap-4">
        {(local?.length || 0) === 0 ? (
          <div className="text-center py-12">
            <span className="text-6xl mb-4 block">💬</span>
            <h4 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">Nenhum template criado</h4>
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              Crie seu primeiro template para usar nos grupos.
            </p>
            {canCreate && (
              <button
                onClick={handleCreate}
                className="px-6 py-3 bg-primary text-white rounded-lg hover:bg-purple-700"
              >
                Criar Template
              </button>
            )}
          </div>
        ) : (
          <>
            {local.map((message, idx) => (
              <MessageCard
                key={message.id ?? `new-${idx}`}
                idx={idx}
                message={message}
                onChange={handleChange}
                onSave={(override) => handleSave(idx, override)}
                onDelete={() => handleDelete(idx)}
                uploadCatalogMedia={uploadCatalogMedia}
                saving={saving}
              />
            ))}

            {Array.from({ length: Math.max(0, MAX_TEMPLATES - local.length) }, (_, index) => (
              <div
                key={`empty-${index}`}
                className="bg-gray-50 dark:bg-gray-800 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center"
              >
                <span className="text-4xl mb-2 block text-gray-400">➕</span>
                <p className="text-gray-600 dark:text-gray-400 mb-3">
                  Slot {local.length + index + 1} disponível
                </p>
                {canCreate && (
                  <button
                    onClick={handleCreate}
                    className="px-4 py-2 text-primary border border-primary rounded-lg hover:bg-primary hover:text-white"
                  >
                    Criar Template
                  </button>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
};

const MessageCard = ({ idx, message, onChange, onSave, onDelete, uploadCatalogMedia, saving }) => {
  const [errors, setErrors] = useState({});

  useEffect(() => {
    setErrors(message?._errors || {});
  }, [message?._errors]);

  const validate = () => {
    const e = {};
    const name = String(message?.name || '').trim();
    const text = String(message?.text || '').trim();
    if (!name) e.name = 'O nome da mensagem é obrigatório';
    else if (name.length > 50) e.name = 'O nome deve ter no máximo 50 caracteres';
    if (!text) e.text = 'O texto da mensagem é obrigatório';
    else if (text.length > 2000) e.text = 'O texto deve ter no máximo 2000 caracteres';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleUpload = async (file, kind) => {
    if (!file) return;
    const allowed = ['image/jpeg','image/png','image/gif','audio/mpeg','audio/wav','audio/aac','audio/ogg'];
    const maxSize = 16 * 1024 * 1024;
    if (!allowed.includes(file.type)) { setErrors((p) => ({ ...p, media: 'Tipo de arquivo não suportado' })); return; }
    if (file.size > maxSize) { setErrors((p) => ({ ...p, media: 'O arquivo deve ter no máximo 16MB' })); return; }

    const res = await uploadCatalogMedia(file);
    if (!res?.ok || !res?.path) {
      setErrors((p) => ({ ...p, media: 'Falha no upload da mídia' }));
      return;
    }

    // Atualiza UI e salva IMEDIATAMENTE com override para evitar corrida
    onChange(idx, kind === 'image' ? 'image_path' : 'audio_path', res.path);
    await onSave({ [kind === 'image' ? 'image_path' : 'audio_path']: res.path });

    setErrors((p) => ({ ...p, media: null }));
  };

  const handleSaveClick = async () => {
    if (!validate()) return;
    await onSave(); // sem override -> usa o estado atual
  };

  const basename = (p) => {
    try { return String(p).split(/[\\/]/).pop(); } catch { return String(p || ''); }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow duration-200">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-3 mb-3">
            <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center">
              <span className="text-white font-semibold">{idx + 1}</span>
            </div>
            <div>
              <h4 className="text-lg font-semibold text-gray-800 dark:text-white">
                {message?.name || `Template ${idx + 1}`}
              </h4>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {message?.updated_at
                  ? `Atualizado em ${new Date(message.updated_at).toLocaleString('pt-BR')}`
                  : (message?.created_at
                    ? `Criado em ${new Date(message.created_at).toLocaleString('pt-BR')}`
                    : '—')}
              </p>
            </div>
          </div>

          {/* Nome */}
          <div className="mb-3">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Nome da mensagem *
            </label>
            <input
              type="text"
              value={message?.name || ''}
              onChange={(e) => onChange(idx, 'name', e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white ${
                errors.name ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
              }`}
              placeholder="Ex: Mensagem de Boas-Vindas"
              maxLength={50}
            />
            {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{(message?.name || '').length}/50 caracteres</p>
          </div>

          {/* Texto */}
          <div className="mb-3">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Texto da mensagem *
            </label>
            <textarea
              value={message?.text || ''}
              onChange={(e) => onChange(idx, 'text', e.target.value)}
              rows={4}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white ${
                errors.text ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
              }`}
              placeholder="Digite o texto da sua mensagem aqui..."
              maxLength={2000}
            />
            {errors.text && <p className="text-red-500 text-sm mt-1">{errors.text}</p>}
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{(message?.text || '').length}/2000 caracteres</p>
          </div>

          {/* Imagem (opcional) */}
          <div className="mb-3">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Imagem (opcional)</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => handleUpload(e.target.files?.[0], 'image')}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              disabled={saving}
            />
            {message?.image_path && (
              <div className="mt-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg flex items-center justify-between">
                <p className="text-sm text-green-700 dark:text-green-400">🖼 {basename(message.image_path)}</p>
                <button
                  onClick={async () => {
                    // Atualiza UI e salva IMEDIATAMENTE com override image_path=null (evita corrida)
                    onChange(idx, 'image_path', null);
                    await onSave({ image_path: null });
                  }}
                  className="text-red-600 hover:underline text-sm"
                  disabled={saving}
                >
                  remover
                </button>
              </div>
            )}
          </div>

          {/* Áudio (opcional) */}
          <div className="mb-3">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Áudio (opcional)</label>
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => handleUpload(e.target.files?.[0], 'audio')}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              disabled={saving}
            />
            {message?.audio_path && (
              <div className="mt-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg flex items-center justify-between">
                <p className="text-sm text-green-700 dark:text-green-400">🎵 {basename(message.audio_path)}</p>
                <button
                  onClick={async () => {
                    onChange(idx, 'audio_path', null);
                    await onSave({ audio_path: null });
                  }}
                  className="text-red-600 hover:underline text-sm"
                  disabled={saving}
                >
                  remover
                </button>
              </div>
            )}
          </div>

          {/* erros gerais de mídia */}
          {errors.media && <p role="alert" className="text-red-500 text-sm mt-1">{errors.media}</p>}
        </div>

        <div className="flex flex-col gap-2 ml-4">
          <button
            onClick={handleSaveClick}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-purple-700 disabled:opacity-60"
            title="Salvar template"
            disabled={saving}
          >
            {saving ? 'Salvando...' : 'Salvar Template'}
          </button>
          <button
            onClick={onDelete}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
            title="Excluir template"
            disabled={saving}
          >
            Excluir
          </button>
        </div>
      </div>
    </div>
  );
};

export default MessagesPage;
