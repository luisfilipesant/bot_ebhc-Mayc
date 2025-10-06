// src/App.js — versão web, sem Electron, imports corrigidos
import React, { useState, useContext, useEffect } from 'react';
import { AppContext, AppProvider } from './appContext';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import ConnectionPage from './components/ConnectionPage';
import GroupsPage from './components/GroupsPage';
import MessagesPage from './components/MessagesPage';
import SettingsPage from './components/SettingsPage';

const AppContent = () => {
  const { isConnected } = useContext(AppContext);
  const [currentPage, setCurrentPage] = useState('inicio');

  useEffect(() => {
    if (!isConnected && (currentPage === 'grupos' || currentPage === 'mensagens')) {
      setCurrentPage('inicio');
    }
  }, [isConnected, currentPage]);

  const renderPage = () => {
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
  };

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
