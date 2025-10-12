// FRONTEND/src/components/ConnectionPage.js
// Usa AppContext (session-aware), renderiza QR e traz um seletor de sessão embutido
import React, { useState, useEffect, useContext, useMemo } from 'react';
import { AppContext } from '../appContext';

const SESSIONS = ['default', 's1', 's2', 's3', 's4', 's5'];

const ConnectionPage = () => {
  const {
    session,                    // sessão atual (ex.: 'default', 's1'…)
    setSession,                 // troca sessão e sincroniza URL
    isConnected,
    status,
    start,                      // chama /api/:session/bot/start
    disconnect,                 // chama /api/:session/bot/disconnect
    qrCode,
    error
  } = useContext(AppContext);

  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const prettyStatus = useMemo(() => String(status?.status || ''), [status]);

  useEffect(() => {
    const s = String(status?.status || '').toLowerCase();
    if (isConnected) {
      setConnectionStatus('connected');
      setLoading(false);
    } else if (qrCode || s.includes('connecting') || s.includes('sync') || s.includes('qr')) {
      setConnectionStatus('connecting');
    } else {
      setConnectionStatus('disconnected');
    }
  }, [isConnected, qrCode, status]);

  const handleConnect = async () => {
    setLoading(true);
    try { await start(); } finally { setLoading(false); }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try { await disconnect(); } finally { setLoading(false); }
  };

  const getStatusMessage = () => {
    switch (connectionStatus) {
      case 'connecting': return 'Conectando ao WhatsApp...';
      case 'connected':  return 'Conectado com sucesso!';
      default:           return 'Desconectado do WhatsApp';
    }
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connecting': return 'text-yellow-600';
      case 'connected':  return 'text-green-600';
      default:           return 'text-gray-600';
    }
  };

  const handlePick = (target) => {
    setPickerOpen(false);
    if (!target || target === session) return;
    setSession(target); // atualiza contexto + URL (/s/:session)
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 relative">
        {/* Cabeçalho */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl text-white">📱</span>
          </div>
          <h3 className="text-2xl font-bold text-gray-800 dark:text-white mb-1">Conexão WhatsApp</h3>
          <p className="text-gray-600 dark:text-gray-300">
            Conecte sua conta do WhatsApp para começar a usar a automação
          </p>

          {/* Sessão atual + botão de troca */}
          <div className="mt-4 flex items-center justify-center gap-2">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-700">
              <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-300">Sessão</span>
              <span className="text-sm font-semibold text-gray-800 dark:text-white">{session}</span>
            </span>

            <div className="relative">
              <button
                onClick={() => setPickerOpen((v) => !v)}
                className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700"
                title="Trocar sessão"
              >
                Trocar sessão ▾
              </button>

              {pickerOpen && (
                <div
                  className="absolute z-10 mt-2 w-56 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg p-2"
                >
                  <p className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400">Escolha a sessão nesta aba</p>
                  <div className="grid grid-cols-2 gap-2 p-2">
                    {SESSIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => handlePick(s)}
                        className={`px-3 py-2 rounded-md text-sm border ${
                          s === session
                            ? 'bg-primary text-white border-primary'
                            : 'bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-gray-100 border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  <div className="px-2 pb-2 pt-1">
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      Dica: para abrir em outra aba, clique com o botão do meio ou use
                      <span className="mx-1 font-semibold">Ctrl/Cmd</span>+ clique em <code>/s/&lt;sessão&gt;</code>.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* status técnico (opcional) */}
          <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">{prettyStatus}</p>
        </div>

        {/* Status */}
        <div className="text-center mb-8">
          <div className={`inline-flex items-center space-x-2 px-4 py-2 rounded-full bg-gray-100 dark:bg-gray-700 ${getStatusColor()}`}>
            <div
              className={`w-3 h-3 rounded-full ${
                connectionStatus === 'connected'
                  ? 'bg-green-500'
                  : connectionStatus === 'connecting'
                  ? 'bg-yellow-500 animate-pulse'
                  : 'bg-gray-400'
              }`}
            />
            <span className="font-medium">{getStatusMessage()}</span>
          </div>
        </div>

        {/* QR Code */}
        {qrCode && !isConnected && (
          <div className="text-center mb-8">
            <div className="inline-block p-4 bg-white rounded-lg shadow-md">
              <img
                src={`data:image/png;base64,${qrCode}`}
                alt="QR Code WhatsApp"
                className="w-64 h-64 object-contain"
              />
              <p className="text-sm text-gray-600 mt-4">
                Escaneie o QR Code com o aplicativo WhatsApp no seu celular
              </p>
            </div>
          </div>
        )}

        {/* Erros */}
        {error && (
          <div className="mb-8 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-center">
            <p className="text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Ações */}
        <div className="flex justify-center space-x-4">
          {!isConnected ? (
            <button
              onClick={handleConnect}
              disabled={loading}
              className="px-6 py-3 bg-primary text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
            >
              {loading ? 'Conectando...' : 'Conectar WhatsApp'}
            </button>
          ) : (
            <button
              onClick={handleDisconnect}
              disabled={loading}
              className="px-6 py-3 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
            >
              {loading ? 'Desconectando...' : 'Desconectar'}
            </button>
          )}
        </div>

        {/* Dicas */}
        <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <h4 className="font-semibold text-blue-800 dark:text-blue-300 mb-2">📋 Como usar</h4>
          <ul className="text-sm text-blue-700 dark:text-blue-400 space-y-1">
            <li>1. Escolha a sessão e clique em “Conectar WhatsApp”.</li>
            <li>2. Escaneie o QR Code com o aplicativo WhatsApp no celular.</li>
            <li>3. Configure seus grupos e mensagens.</li>
            <li>4. Ative a automação desejada.</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default ConnectionPage;
