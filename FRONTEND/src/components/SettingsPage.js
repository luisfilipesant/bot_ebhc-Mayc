// FRONTEND/src/components/SettingsPage.js
import React, { useContext, useState } from 'react';
import { AppContext } from '../appContext';

const SettingsPage = () => {
  const {
    darkMode, setDarkMode,
    status, isConnected,
    resetSession,
    disconnect,
  } = useContext(AppContext);

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const handleToggleTheme = () => setDarkMode(!darkMode);

  const handleResetSession = async () => {
    if (!window.confirm('Isto vai encerrar a sessão atual (se houver) e apagar a pasta da sessão (.wpp-data). Continuar?')) {
      return;
    }
    try {
      setBusy(true);
      setFeedback(null);

      // Se quiser, desconecta antes (a rota já chama closeSession, mas mantemos UX clara):
      if (isConnected) {
        try { await disconnect(); } catch {}
      }

      const res = await resetSession();
      if (res?.ok) {
        setFeedback('Sessão resetada com sucesso. Clique em "Conectar" para gerar um novo QR.');
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
        <h3 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">Sessão do WhatsApp</h3>

        <div className="mb-4">
          <p className="text-gray-700 dark:text-gray-200">
            Status atual: <b className="font-semibold">{String(status?.status || '—')}</b>
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Se estiver tendo problemas de travamento ou QR inválido, você pode <b>resetar a sessão</b>.
            Isso encerra o cliente e apaga os dados locais da sessão para forçar uma reconexão limpa.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleResetSession}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
            title="Encerrar e limpar a pasta da sessão (.wpp-data)"
          >
            {busy ? 'Limpando...' : 'Resetar sessão do WhatsApp'}
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            A próxima vez que você clicar em <b>Conectar</b>, um novo QR será gerado.
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
