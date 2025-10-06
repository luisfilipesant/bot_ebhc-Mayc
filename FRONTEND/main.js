// Carregar polyfills para crypto e outras APIs antes de qualquer outra coisa
require('./crypto-polyfill');
require('./electron-polyfills');

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Importar serviços
const whatsappService = require('./src/services/whatsappService');
const dataService = require('./src/services/dataService');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      webSecurity: false
    },
    icon: path.join(__dirname, 'assets', 'logo.png'),
    title: 'Automação WhatsApp - EBHC Cloud'
  });

  mainWindow.loadFile('index.html');

  // Abrir DevTools em desenvolvimento
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // Carregar configurações salvas ao iniciar
  whatsappService.loadConfiguration();
}

// Handlers para WhatsApp Service
ipcMain.handle('whatsapp:connect', async () => {
  try {
    const result = await whatsappService.connect();
    dataService.addLog({
      type: 'info',
      message: 'Tentativa de conexão com WhatsApp iniciada',
      details: 'Aguardando autenticação'
    });
    return { success: true, data: result };
  } catch (error) {
    dataService.addLog({
      type: 'error',
      message: 'Erro ao conectar com WhatsApp',
      details: error.message
    });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('whatsapp:disconnect', async () => {
  try {
    await whatsappService.disconnect();
    dataService.addLog({
      type: 'info',
      message: 'Desconectado do WhatsApp',
      details: 'Conexão encerrada pelo usuário'
    });
    return { success: true };
  } catch (error) {
    dataService.addLog({
      type: 'error',
      message: 'Erro ao desconectar do WhatsApp',
      details: error.message
    });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('whatsapp:getStatus', () => {
  return whatsappService.getConnectionStatus();
});

ipcMain.handle('whatsapp:getGroups', async () => {
  try {
    const groups = await whatsappService.loadGroups();
    return { success: true, data: groups };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('whatsapp:searchGroups', (event, searchTerm) => {
  try {
    const groups = whatsappService.searchGroups(searchTerm);
    return { success: true, data: groups };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('whatsapp:setGroupAutomation', (event, groupId, settings) => {
  try {
    const result = whatsappService.setGroupAutomation(groupId, settings);
    dataService.addLog({
      type: 'info',
      message: `Automação ${settings.enabled ? 'ativada' : 'desativada'} para grupo`,
      details: `Grupo ID: ${groupId}`
    });
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('whatsapp:getGroupAutomation', (event, groupId) => {
  try {
    const automation = whatsappService.getGroupAutomation(groupId);
    return { success: true, data: automation };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('whatsapp:setStandardMessage', (event, index, messageData) => {
  try {
    const result = whatsappService.setStandardMessage(index, messageData);
    dataService.addLog({
      type: 'info',
      message: 'Mensagem padrão configurada',
      details: `Slot ${index + 1}: ${messageData.name}`
    });
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('whatsapp:getStandardMessages', () => {
  try {
    const messages = whatsappService.getStandardMessages();
    return { success: true, data: messages };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handlers para Data Service
ipcMain.handle('data:saveConfig', (event, config) => {
  try {
    const result = dataService.saveConfig(config);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('data:loadConfig', () => {
  try {
    const config = dataService.loadConfig();
    return { success: true, data: config };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('data:addLog', (event, logEntry) => {
  try {
    const result = dataService.addLog(logEntry);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('data:getLogs', (event, filters) => {
  try {
    const logs = dataService.getFilteredLogs(filters);
    return { success: true, data: logs };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('data:clearLogs', () => {
  try {
    dataService.saveLogs([]);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('data:exportData', () => {
  try {
    const filePath = dataService.exportData();
    return { success: true, data: filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('data:importData', (event, filePath) => {
  try {
    const result = dataService.importData(filePath);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handlers para File System
ipcMain.handle('fs:selectFile', async (event, options) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, options);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('fs:saveFile', async (event, options) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, options);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('fs:readFile', (event, filePath) => {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('fs:writeFile', (event, filePath, data) => {
  try {
    fs.writeFileSync(filePath, data, 'utf8');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Tratar erros não capturados
process.on('uncaughtException', (error) => {
  console.error('Erro não capturado:', error);
  dataService.addLog({
    type: 'error',
    message: 'Erro crítico do sistema',
    details: error.message
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Promise rejeitada não tratada:', reason);
  dataService.addLog({
    type: 'error',
    message: 'Promise rejeitada não tratada',
    details: reason.toString()
  });
});