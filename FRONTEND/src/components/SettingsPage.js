// src/components/SettingsPage.js — simplificado; exibe/ajusta tema e placeholders
import React, { useContext } from 'react';
import { AppContext } from '../appContext';

const SettingsPage = () => {
  const { darkMode, setDarkMode } = useContext(AppContext);

  return (
    <div className="max-w-2xl">
      <h3 className="text-2xl font-bold text-gray-800 dark:text-white mb-4">Configurações</h3>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-gray-800 dark:text-white">Modo escuro</div>
            <div className="text-sm text-gray-500 dark:text-gray-400">Alterna o tema da interface</div>
          </div>
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="px-3 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white"
          >
            {darkMode ? 'Desativar' : 'Ativar'}
          </button>
        </div>

        <div className="text-sm text-gray-500 dark:text-gray-400">
          Demais configurações avançadas podem ser integradas aos seus endpoints quando desejar.
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
