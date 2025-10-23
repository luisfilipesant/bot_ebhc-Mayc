// FRONTEND/src/components/SettingsPage.js
import React, { useContext, useState } from 'react';
import { AppContext } from '../appContext';

const SettingsPage = () => {
  const {
    darkMode, setDarkMode,
    status, isConnected,
    session,          // sessão atual (ex.: 'default', 's1', 's2'...)
    resetSession,     // <- usa o nome correto exposto pelo contexto
    disconnect,       // opcional: encerrar antes de resetar
  } = useContext(AppContext);

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const handleToggleTheme = () => setDarkMode(!darkMode);

  const handleResetSession = async () => {
    if (!window.confirm(
      `Isto vai encerrar a sessão "${session}" (se houver) e apagar os tokens/chaves locais dessa sessão. Continuar?`
    )) {
      return;
    }

    try {
      setBusy(true);
      setFeedback(null);

      // UX: se estiver conectado, encerra antes (server também fecha na rota)
      if (isConnected) {
        try { await disconnect(); } catch {}
      }

      const res = await resetSession(); // <- chama a função correta do contexto
      if (res?.ok) {
        setFeedback(`Sessão "${session}" resetada com sucesso. Clique em "Conectar" para gerar um novo QR.`);
      } else {
        setFeedback('Não foi possível resetar a sessão.');
      }
    } catch (e) {
      setFeedback('Falha ao resetar a sessão.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">Aparência</h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-gray-800 dark:text-gray-100 font-medium">Tema escuro</p>
            <p className="text-gray-500 dark:text-gray-400 text-sm">Alterne entre claro e escuro</p>
          </div>
          <button
            onClick={handleToggleTheme}
            className={`px-4 py-2 rounded-lg ${darkMode ? 'bg-primary text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100'}`}
          >
            {darkMode ? 'Ativado' : 'Desativado'}
          </button>
        </div>
      </section>

      <section className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold text-gray-800 dark:text-white">Sessão do WhatsApp</h3>
          <span className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
            Sessão: <b>{String(session || 'default')}</b>
          </span>
        </div>

        <div className="mb-4">
          <p className="text-gray-700 dark:text-gray-200">
            Status atual: <b className="font-semibold">{String(status?.status || '—')}</b>
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Se estiver com travamento, QR inválido ou quiser conectar outro número nesta sessão,
            você pode <b>resetar os tokens</b>. Isso encerra o cliente e apaga os dados locais de autenticação
            da sessão selecionada para forçar uma reconexão limpa.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleResetSession}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
            title="Encerrar e limpar tokens da sessão (apagar .wpp-data da sessão)"
          >
            {busy ? 'Limpando...' : 'Resetar sessão (apagar tokens)'}
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Depois, use <b>Conectar</b> para gerar um novo QR para <b>{String(session || 'default')}</b>.
          </span>
        </div>

        {feedback && (
          <div className="mt-3 text-sm text-gray-700 dark:text-gray-200">
            {feedback}
          </div>
        )}
      </section>
    </div>
  );
};

export default SettingsPage;
