// src/components/Header.js — sem Electron; usa AppContext para tema e status
import React, { useContext } from 'react';
import { AppContext } from '../appContext';

const Header = () => {
  const { darkMode, setDarkMode, isConnected } = useContext(AppContext);

  return (
    <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
      <div className="px-6 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-gray-800 dark:text-white">Automação WhatsApp</h2>
          <p className="text-sm text-gray-600 dark:text-gray-300">Gerencie suas mensagens automáticas</p>
        </div>

        <div className="flex items-center space-x-4">
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-200"
            title={darkMode ? 'Ativar modo claro' : 'Ativar modo escuro'}
          >
            <span className="text-xl">{darkMode ? '☀️' : '🌙'}</span>
          </button>

          <div className="flex items-center space-x-2">
            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
            <span className="text-sm text-gray-600 dark:text-gray-300">
              {isConnected ? 'Sistema ativo' : 'Sistema offline'}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
