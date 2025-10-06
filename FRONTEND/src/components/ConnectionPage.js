// src/components/ConnectionPage.js — usa AppContext (start/disconnect) e mostra QR como imagem base64
import React, { useState, useEffect, useContext } from 'react';
import { AppContext } from '../appContext';

const ConnectionPage = () => {
  const { isConnected, status, start, disconnect, qrCode, error } = useContext(AppContext);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [loading, setLoading] = useState(false);

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
      case 'connected': return 'Conectado com sucesso!';
      default: return 'Desconectado do WhatsApp';
    }
  };
  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connecting': return 'text-yellow-600';
      case 'connected': return 'text-green-600';
      default: return 'text-gray-600';
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl text-white">📱</span>
          </div>
          <h3 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">Conexão WhatsApp</h3>
          <p className="text-gray-600 dark:text-gray-300">Conecte sua conta do WhatsApp para começar a usar a automação</p>
        </div>

        <div className="text-center mb-8">
          <div className={`inline-flex items-center space-x-2 px-4 py-2 rounded-full bg-gray-100 dark:bg-gray-700 ${getStatusColor()}`}>
            <div className={`w-3 h-3 rounded-full ${
              connectionStatus === 'connected'
                ? 'bg-green-500'
                : connectionStatus === 'connecting'
                ? 'bg-yellow-500 animate-pulse'
                : 'bg-gray-400'
            }`} />
            <span className="font-medium">{getStatusMessage()}</span>
          </div>
        </div>

        {/* QR: backend envia PNG base64 — renderizamos como <img> */}
        {qrCode && !isConnected && (
          <div className="text-center mb-8">
            <div className="inline-block p-4 bg-white rounded-lg shadow-md">
              <img
                src={`data:image/png;base64,${qrCode}`}
                alt="QR Code WhatsApp"
                className="w-64 h-64 object-contain"
              />
              <p className="text-sm text-gray-600 mt-4">Escaneie o QR Code com o aplicativo WhatsApp no seu celular</p>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-8 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-center">
            <p className="text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

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

        <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <h4 className="font-semibold text-blue-800 dark:text-blue-300 mb-2">📋 Como usar</h4>
          <ul className="text-sm text-blue-700 dark:text-blue-400 space-y-1">
            <li>1. Clique em "Conectar WhatsApp"</li>
            <li>2. Escaneie o QR Code com o aplicativo WhatsApp no celular</li>
            <li>3. Configure seus grupos e mensagens</li>
            <li>4. Ative a automação desejada</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default ConnectionPage;
