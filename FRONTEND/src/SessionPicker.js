// FRONTEND/src/components/SessionPicker.js
import React, { useMemo, useContext } from 'react';
import { AppContext } from '../appContext';

const SESSIONS = ['s1', 's2', 's3', 's4', 's5'];

function buildSessionUrl(sess) {
  // Gera URL absoluta respeitando domínio/porta atuais
  return new URL(`/s/${encodeURIComponent(sess)}`, window.location.origin).toString();
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

const SessionCard = ({ sess, isCurrent }) => {
  const url = useMemo(() => buildSessionUrl(sess), [sess]);

  const handleOpenNewTab = () => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleCopy = async () => {
    const ok = await copyToClipboard(url);
    if (ok) {
      // feedback simples
      alert('Link copiado!');
    }
  };

  return (
    <div
      className={`rounded-2xl border p-5 shadow-sm bg-white dark:bg-gray-800
        ${isCurrent ? 'border-purple-500 ring-2 ring-purple-200 dark:ring-purple-900/40' : 'border-gray-200 dark:border-gray-700'}
      `}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center
              ${isCurrent ? 'bg-purple-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'}
            `}
          >
            {sess.toUpperCase()}
          </div>
          <div>
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
              Sessão {sess.toUpperCase()}
            </h4>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {isCurrent ? 'Você está nesta sessão' : 'Abrir em nova aba para conectar outro número'}
            </p>
          </div>
        </div>
        {isCurrent && (
          <span className="text-xs px-2 py-1 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200">
            atual
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleOpenNewTab}
          className="px-4 py-2 rounded-lg bg-primary text-white hover:bg-purple-700 transition-colors"
          title={`Abrir ${sess} em nova aba`}
        >
          Abrir em nova aba
        </button>

        <button
          onClick={handleCopy}
          className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
          title="Copiar link"
        >
          Copiar link
        </button>

        <a
          href={url}
          className="ml-auto text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 underline"
          title={url}
        >
          {url.replace(window.location.origin, '')}
        </a>
      </div>
    </div>
  );
};

const SessionPicker = () => {
  const { session: currentSession } = useContext(AppContext);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-2xl font-bold text-gray-900 dark:text-white">Escolha uma sessão</h3>
        <p className="text-gray-600 dark:text-gray-300">
          Abra até <b>5 sessões</b> simultâneas (uma por aba) para conectar números diferentes e
          configurar mensagens independentes.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {SESSIONS.map((s) => (
          <SessionCard key={s} sess={s} isCurrent={currentSession === s} />
        ))}
      </div>

      <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
        Dica: você pode manter esta aba em <b>{currentSession || 'default'}</b> e abrir outra sessão em uma nova aba.
      </div>
    </div>
  );
};

export default SessionPicker;
