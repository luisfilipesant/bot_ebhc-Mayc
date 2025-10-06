// FRONTEND/src/components/GroupsPage.js — versão DB (usa template_id) com tratamento de template órfão
import React, { useState, useEffect, useContext, useMemo } from 'react';
import { AppContext } from '../appContext';

const GroupsPage = () => {
  const {
    groups,
    groupPresets,
    loadGroups,
    saveGroupPreset,
    templates,           // << templates vindos do DB
  } = useContext(AppContext);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [loading, setLoading] = useState(true);

  // Mapa id -> template (para acesso rápido)
  const templatesById = useMemo(() => {
    const map = {};
    (templates || []).forEach((t) => { if (t?.id != null) map[t.id] = t; });
    return map;
  }, [templates]);

  // Dispara só UMA vez ao montar
  useEffect(() => {
    (async () => {
      setLoading(true);
      const gs = await loadGroups();
      setLoading(false);
      console.debug('[front] GroupsPage mounted -> loadGroups length=', gs?.length);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Retry leve caso o primeiro GET venha vazio (enquanto não chega o groups:refresh)
  useEffect(() => {
    console.debug('[front] GroupsPage groups changed ->', Array.isArray(groups) ? groups.length : 'invalid');
    if (Array.isArray(groups) && groups.length === 0) {
      const t = setTimeout(async () => {
        setLoading(true);
        try {
          const gs = await loadGroups();
          console.debug('[front] GroupsPage retry -> length=', gs?.length);
        } finally {
          setLoading(false);
        }
      }, 2500);
      return () => clearTimeout(t);
    }
  }, [groups, loadGroups]);

  const filteredGroups = useMemo(() => {
    return (groups || []).filter((g) =>
      (g.name || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [groups, searchTerm]);

  const handleConfigureGroup = (group) => {
    setSelectedGroup(group);
    setShowConfigModal(true);
  };

  const handleSaveConfig = async (config) => {
    await saveGroupPreset({
      group_id: selectedGroup.id,
      enabled: config.enabled,
      threshold: config.threshold,
      cooldown_sec: config.cooldown_sec ?? null,
      template_id: config.template_id ?? null,
      // messages snapshot: deixe vazio para usar sempre o template atual do DB
    });
    setShowConfigModal(false);
    setSelectedGroup(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-300">Carregando grupos...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Cabeçalho */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h3 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">Gerenciar Grupos</h3>
          <p className="text-gray-600 dark:text-gray-300">Configure a automação de mensagens para seus grupos</p>
        </div>
        <button
          onClick={async () => {
            setLoading(true);
            const gs = await loadGroups();
            setLoading(false);
            console.debug('[front] GroupsPage manual refresh -> length=', gs?.length);
          }}
          className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-purple-700 transition-colors"
        >
          Atualizar grupos
        </button>
      </div>

      {/* Busca */}
      <div className="mb-6">
        <div className="relative">
          <input
            type="text"
            placeholder="Buscar grupo por nome..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-3 pl-12 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          />
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
        </div>
      </div>

      {/* Lista de grupos */}
      <div className="grid gap-4">
        {filteredGroups.length === 0 ? (
          <div className="text-center py-12">
            <span className="text-6xl mb-4 block">👥</span>
            <h4 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">
              {searchTerm ? 'Nenhum grupo encontrado' : 'Nenhum grupo disponível'}
            </h4>
            <p className="text-gray-600 dark:text-gray-300">
              {searchTerm ? 'Tente buscar com outros termos' : 'Conecte-se para ver seus grupos'}
            </p>
          </div>
        ) : (
          filteredGroups.map((group) => {
            const preset = groupPresets[group.id];
            const enabled = !!preset?.enabled;
            const threshold = preset?.threshold ?? 10;

            // Nome a exibir:
            // 1) se tiver template_id -> nome do template
            // 2) se tiver snapshot em messages -> "Snapshot personalizado"
            // 3) senão -> "—"
            let displayName = '—';
            if (preset?.template_id && templatesById[preset.template_id]) {
              displayName = templatesById[preset.template_id].name || `Template #${preset.template_id}`;
            } else if (Array.isArray(preset?.messages) && preset.messages.length) {
              displayName = 'Snapshot personalizado';
            }

            return (
              <div
                key={group.id}
                className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow duration-200"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <div className="w-12 h-12 bg-primary rounded-full flex items-center justify-center">
                        <span className="text-white font-semibold">
                          {(group.name || '?').charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <h4 className="text-lg font-semibold text-gray-800 dark:text-white">
                          {group.name || group.id}
                        </h4>
                        <p className="text-sm text-gray-600 dark:text-gray-300">{group.id}</p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-4 text-sm">
                      <div className="flex items-center space-x-2">
                        <div className={`w-3 h-3 rounded-full ${enabled ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                        <span className="text-gray-600 dark:text-gray-300">{enabled ? 'Ativo' : 'Inativo'}</span>
                      </div>
                      {enabled && (
                        <>
                          <span className="text-gray-400">•</span>
                          <span className="text-gray-600 dark:text-gray-300">
                            {displayName}
                          </span>
                          <span className="text-gray-400">•</span>
                          <span className="text-gray-600 dark:text-gray-300">Após {threshold} mensagens</span>
                        </>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => handleConfigureGroup(group)}
                    className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-purple-700 transition-colors duration-200"
                  >
                    Configurar
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal */}
      {showConfigModal && selectedGroup && (
        <ConfigurationModal
          group={selectedGroup}
          onSave={handleSaveConfig}
          onClose={() => {
            setShowConfigModal(false);
            setSelectedGroup(null);
          }}
        />
      )}
    </div>
  );
};

const ConfigurationModal = ({ group, onSave, onClose }) => {
  const { groupPresets, templates } = useContext(AppContext);

  const hasTemplates = Array.isArray(templates) && templates.length > 0;

  // Mapa local para checagens rápidas dentro do modal
  const templatesById = useMemo(() => {
    const map = {};
    (templates || []).forEach((t) => { if (t?.id != null) map[t.id] = t; });
    return map;
  }, [templates]);

  const preset = groupPresets[group.id] || { enabled: false, threshold: 10, template_id: null };

  // Escolhe o template inicial:
  // - Se preset.template_id existir e estiver presente no DB, usa-o
  // - Senão, usa o primeiro template disponível (ou null se não houver)
  const initialTemplateId = useMemo(() => {
    const id = preset?.template_id ?? null;
    if (id != null && templatesById[id]) return id;
    return hasTemplates ? templates[0].id : null;
  }, [preset?.template_id, templatesById, hasTemplates, templates]);

  const [config, setConfig] = useState({
    enabled: !!preset.enabled,
    threshold: preset.threshold ?? 10,
    cooldown_sec: preset.cooldown_sec ?? null,
    template_id: initialTemplateId,
  });

  // Se os templates mudarem ou o preset trocar e o template_id ficar órfão,
  // corrigimos automaticamente para o primeiro válido.
  useEffect(() => {
    if (!config.enabled) return; // só importa quando está habilitado
    if (config.template_id == null && hasTemplates) {
      setConfig((c) => ({ ...c, template_id: templates[0].id }));
      return;
    }
    if (config.template_id != null && !templatesById[config.template_id]) {
      // órfão -> escolhe o primeiro template válido
      if (hasTemplates) {
        setConfig((c) => ({ ...c, template_id: templates[0].id }));
      } else {
        setConfig((c) => ({ ...c, template_id: null }));
      }
    }
  }, [hasTemplates, templates, templatesById, config.enabled, config.template_id]);

  const handleSave = () => onSave(config);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-semibold text-gray-800 dark:text-white">Configurar Automação</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">✕</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Grupo</label>
            <p className="text-gray-900 dark:text-white font-medium">{group.name || group.id}</p>
          </div>

          <div>
            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                className="w-4 h-4 text-primary border-gray-300 rounded focus:ring-primary"
              />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Ativar automação</span>
            </label>
          </div>

          {config.enabled && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Template a enviar
                </label>

                {!hasTemplates ? (
                  <p className="text-sm text-amber-600">
                    Você ainda não tem templates. Crie em <b>Mensagens</b> antes de configurar um grupo.
                  </p>
                ) : (
                  <select
                    value={config.template_id ?? ''}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        template_id: e.target.value ? Number(e.target.value) : null
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name || `Template #${t.id}`}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Enviar após quantas mensagens?
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={config.threshold}
                  onChange={(e) => setConfig({ ...config, threshold: parseInt(e.target.value || '1', 10) })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Entre 1 e 100 mensagens</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Cooldown (segundos) — opcional
                </label>
                <input
                  type="number"
                  min="0"
                  max="86400"
                  value={config.cooldown_sec ?? 0}
                  onChange={(e) => {
                    const v = Math.max(0, parseInt(e.target.value || '0', 10));
                    setConfig({ ...config, cooldown_sec: v });
                  }}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Evita disparos muito frequentes para o mesmo grupo (0 = sem cooldown)
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end space-x-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-purple-700 disabled:opacity-60"
            disabled={config.enabled && !hasTemplates}
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
};

export default GroupsPage;
