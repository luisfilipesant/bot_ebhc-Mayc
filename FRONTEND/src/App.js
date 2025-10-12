// src/App.js — SPA com sessão em URL (/s/:session)
import React, { useState, useContext, useEffect, useCallback } from 'react';
import { AppContext, AppProvider } from './appContext';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import ConnectionPage from './components/ConnectionPage';
import GroupsPage from './components/GroupsPage';
import MessagesPage from './components/MessagesPage';
import SettingsPage from './components/SettingsPage';

// -------- URL helpers (History API) --------
// Preferimos /s/:session. Fallbacks: /:session e ?session=...
function parseSessionFromURL() {
  const path = window.location.pathname || '/';

  // /s/:session
  const m1 = path.match(/^\/s\/([^\/?#]+)/i);
  if (m1) return decodeURIComponent(m1[1]);

  // /:session  (ignora / e /index.html)
  const m2 = path.match(/^\/([^\/?#]+)/i);
  const candidate = m2 ? decodeURIComponent(m2[1]) : '';
  if (candidate && candidate !== 'index.html') return candidate;

  // ?session=...
  const usp = new URLSearchParams(window.location.search);
  return usp.get('session') || 'default';
}

function pushSessionToURL(session) {
  const newPath = `/s/${encodeURIComponent(session)}`;
  if (window.location.pathname !== newPath) {
    window.history.pushState({ session }, '', newPath); // History API
  }
}

const AppContent = () => {
  const { isConnected, session, setSession } = useContext(AppContext);
  const [currentPage, setCurrentPage] = useState('inicio');

  // Na primeira carga: pega sessão da URL e assina popstate
  useEffect(() => {
    const initial = parseSessionFromURL();
    setSession(initial);

    const onPop = () => setSession(parseSessionFromURL());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [setSession]);

  // Quando a sessão mudar no contexto, refletir na URL
  useEffect(() => {
    if (session) pushSessionToURL(session);
  }, [session]);

  // Se desconectar, evita páginas que dependem de conexão
  useEffect(() => {
    if (!isConnected && (currentPage === 'grupos' || currentPage === 'mensagens')) {
      setCurrentPage('inicio');
    }
  }, [isConnected, currentPage]);

  const renderPage = useCallback(() => {
    switch (currentPage) {
      case 'inicio':
        return <ConnectionPage />;
      case 'grupos':
        return isConnected ? <GroupsPage /> : <ConnectionPage />;
      case 'mensagens':
        return isConnected ? <MessagesPage /> : <ConnectionPage />;
      case 'configuracoes':
        return <SettingsPage />;
      default:
        return <ConnectionPage />;
    }
  }, [currentPage, isConnected]);

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      <Sidebar currentPage={currentPage} setCurrentPage={setCurrentPage} />
      <div className="flex-1 flex flex-col">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">{renderPage()}</main>
      </div>
    </div>
  );
};

const App = () => (
  <AppProvider>
    <AppContent />
  </AppProvider>
);

export default App;
