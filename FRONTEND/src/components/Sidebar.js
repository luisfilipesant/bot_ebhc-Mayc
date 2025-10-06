// src/components/Sidebar.js — ajusta caminho do logo para /assets/logo.png
import React from 'react';

const Sidebar = ({ currentPage, setCurrentPage }) => {
  const menuItems = [
    { id: 'inicio', label: 'Início', icon: '🏠' },
    { id: 'grupos', label: 'Grupos', icon: '👥' },
    { id: 'mensagens', label: 'Mensagens', icon: '💬' },
    { id: 'configuracoes', label: 'Configurações', icon: '⚙️' }
  ];

  return (
    <div className="w-64 bg-primary text-white h-full flex flex-col">
      <div className="p-6 border-b border-purple-500">
        <div className="flex items-center space-x-3">
          <img
            src="/assets/logo.png"
            alt="EBHC Logo"
            className="w-8 h-8"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
          <div>
            <h1 className="text-lg font-bold">EBHC Cloud</h1>
            <p className="text-sm text-purple-200">Automação WhatsApp</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4">
        <ul className="space-y-2">
          {menuItems.map((item) => (
            <li key={item.id}>
              <button
                onClick={() => setCurrentPage(item.id)}
                className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors duration-200 ${
                  currentPage === item.id
                    ? 'bg-purple-600 text-white'
                    : 'text-purple-100 hover:bg-purple-500 hover:text-white'
                }`}
              >
                <span className="text-xl">{item.icon}</span>
                <span className="font-medium">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="p-4 border-t border-purple-500">
        <p className="text-xs text-purple-200 text-center">© 2024 EBHC Cloud</p>
      </div>
    </div>
  );
};

export default Sidebar;
