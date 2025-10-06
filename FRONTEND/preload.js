// Preload script simplificado para compatibilidade
const { ipcRenderer } = require('electron');

// Expor APIs para o renderer process
window.electronAPI = {
  // WhatsApp Service APIs
  whatsapp: {
    connect: () => ipcRenderer.invoke('whatsapp:connect'),
    disconnect: () => ipcRenderer.invoke('whatsapp:disconnect'),
    getStatus: () => ipcRenderer.invoke('whatsapp:getStatus'),
    getGroups: () => ipcRenderer.invoke('whatsapp:getGroups'),
    searchGroups: (searchTerm) => ipcRenderer.invoke('whatsapp:searchGroups', searchTerm),
    setGroupAutomation: (groupId, settings) => ipcRenderer.invoke('whatsapp:setGroupAutomation', groupId, settings),
    getGroupAutomation: (groupId) => ipcRenderer.invoke('whatsapp:getGroupAutomation', groupId),
    setStandardMessage: (index, messageData) => ipcRenderer.invoke('whatsapp:setStandardMessage', index, messageData),
    getStandardMessages: () => ipcRenderer.invoke('whatsapp:getStandardMessages'),
  },

  // Data Service APIs
  data: {
    saveConfig: (config) => ipcRenderer.invoke('data:saveConfig', config),
    loadConfig: () => ipcRenderer.invoke('data:loadConfig'),
    addLog: (logEntry) => ipcRenderer.invoke('data:addLog', logEntry),
    getLogs: (filters) => ipcRenderer.invoke('data:getLogs', filters),
    clearLogs: () => ipcRenderer.invoke('data:clearLogs'),
    exportData: () => ipcRenderer.invoke('data:exportData'),
    importData: (filePath) => ipcRenderer.invoke('data:importData', filePath),
  },

  // File System APIs
  fs: {
    selectFile: (options) => ipcRenderer.invoke('fs:selectFile', options),
    saveFile: (options) => ipcRenderer.invoke('fs:saveFile', options),
    readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
    writeFile: (filePath, data) => ipcRenderer.invoke('fs:writeFile', filePath, data),
  },

  // Event listeners
  on: (channel, callback) => {
    const validChannels = [
      'whatsapp:connectionUpdate',
      'whatsapp:qrCode',
      'whatsapp:messageReceived',
      'whatsapp:messageSent',
      'app:notification'
    ];
    
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, callback);
    }
  },

  // Remove event listeners
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
};

