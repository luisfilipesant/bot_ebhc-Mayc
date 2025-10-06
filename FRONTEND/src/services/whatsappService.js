// Serviço de integração com WhatsApp usando Baileys
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs').promises;
const path = require('path');
const { ipcMain } = require('electron');
const DataService = require('./dataService');

// Carregar polyfills necessários
require('../../crypto-polyfill');
require('../../electron-polyfills');

class WhatsAppService {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.qrCode = null;
    this.groups = [];
    this.messageCounters = new Map();
    this.automationSettings = new Map();
    this.standardMessages = [];
    this.authDir = path.join(process.cwd(), 'auth_info');
    this.dataService = DataService;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  // Inicializar serviço
  async init() {
    await this.dataService.ensureDataDirectory();
    await this.loadConfiguration();
    this.setupIpcHandlers();
  }

  // Configurar manipuladores IPC
  setupIpcHandlers() {
    ipcMain.on('whatsapp:connect', async () => {
      await this.connect();
    });

    ipcMain.on('whatsapp:disconnect', async () => {
      await this.disconnect();
    });

    ipcMain.on('whatsapp:get-groups', async (event) => {
      event.reply('whatsapp:groups', this.groups);
    });

    ipcMain.on('whatsapp:get-messages', async (event) => {
      event.reply('whatsapp:messages', this.standardMessages);
    });

    ipcMain.on('whatsapp:set-message', async (event, { index, messageData }) => {
      try {
        const message = this.setStandardMessage(index, messageData);
        event.reply('whatsapp:set-message-response', { success: true, message });
      } catch (error) {
        event.reply('whatsapp:set-message-response', { success: false, error: error.message });
      }
    });

    ipcMain.on('whatsapp:set-automation', async (event, { groupId, settings }) => {
      try {
        const automation = this.setGroupAutomation(groupId, settings);
        event.reply('whatsapp:set-automation-response', { success: true, automation });
      } catch (error) {
        event.reply('whatsapp:set-automation-response', { success: false, error: error.message });
      }
    });
  }

  // Conectar ao WhatsApp
  async connect() {
    try {
      await fs.mkdir(this.authDir, { recursive: true });
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

      this.socket = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: { level: 'silent' },
        browser: ['EBHC Cloud', 'Desktop', '1.0.0'],
        syncFullHistory: false,
      });

      this.socket.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qrCode = qr;
          ipcMain.emit('whatsapp:qr', null, qr);
        }

        if (connection === 'close') {
          const error = lastDisconnect?.error;
          const statusCode = error instanceof Boom ? error.output.statusCode : null;
          const shouldReconnect =
            statusCode !== DisconnectReason.loggedOut &&
            this.reconnectAttempts < this.maxReconnectAttempts;

          if (shouldReconnect) {
            this.reconnectAttempts++;
            setTimeout(() => this.connect(), Math.pow(2, this.reconnectAttempts) * 1000);
            ipcMain.emit('whatsapp:connection-update', null, {
              isConnected: false,
              error: 'Tentando reconectar...',
            });
          } else {
            this.isConnected = false;
            this.qrCode = null;
            ipcMain.emit('whatsapp:connection-update', null, {
              isConnected: false,
              error: statusCode === DisconnectReason.loggedOut
                ? 'Sessão encerrada. Por favor, reconecte.'
                : 'Erro na conexão com o WhatsApp.',
            });
            this.reconnectAttempts = 0;
          }
        } else if (connection === 'open') {
          this.isConnected = true;
          this.qrCode = null;
          this.reconnectAttempts = 0;
          ipcMain.emit('whatsapp:connection-update', null, { isConnected: true });
          this.loadGroups();
        }
      });

      this.socket.ev.on('creds.update', saveCreds);
      this.socket.ev.on('messages.upsert', (m) => this.handleIncomingMessages(m));

      return true;
    } catch (error) {
      ipcMain.emit('whatsapp:connection-update', null, {
        isConnected: false,
        error: `Erro ao conectar: ${error.message}`,
      });
      throw error;
    }
  }

  // Desconectar do WhatsApp
  async disconnect() {
    try {
      if (this.socket) {
        await this.socket.logout();
        this.socket = null;
        this.isConnected = false;
        this.qrCode = null;
        await fs.rm(this.authDir, { recursive: true, force: true });
        ipcMain.emit('whatsapp:connection-update', null, { isConnected: false });
      }
    } catch (error) {
      ipcMain.emit('whatsapp:connection-update', null, {
        isConnected: false,
        error: `Erro ao desconectar: ${error.message}`,
      });
      throw error;
    }
  }

  // Carregar lista de grupos
  async loadGroups() {
    try {
      if (!this.socket || !this.isConnected) {
        throw new Error('WhatsApp não está conectado');
      }

      const groups = await this.socket.groupFetchAllParticipating();
      this.groups = Object.values(groups).map((group) => ({
        id: group.id,
        name: group.subject,
        participants: group.participants.length,
        description: group.desc || '',
        createdAt: group.creation,
        isAdmin: group.participants.some(
          (p) => p.id === this.socket.user.id && (p.admin === 'admin' || p.admin === 'superadmin')
        ),
      }));

      ipcMain.emit('whatsapp:groups', null, this.groups);
      return this.groups;
    } catch (error) {
      ipcMain.emit('whatsapp:groups', null, { error: `Erro ao carregar grupos: ${error.message}` });
      throw error;
    }
  }

  // Buscar grupos por nome
  searchGroups(searchTerm) {
    if (!searchTerm) return this.groups;
    return this.groups.filter((group) =>
      group.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }

  // Configurar mensagem padrão
  setStandardMessage(index, messageData) {
    if (index < 0 || index >= 5) {
      throw new Error('Índice de mensagem inválido. Deve estar entre 0 e 4.');
    }

    this.standardMessages[index] = {
      id: index,
      name: messageData.name || `Mensagem ${index + 1}`,
      text: messageData.text || '',
      media: messageData.media || null,
      createdAt: new Date().toISOString(),
    };

    this.dataService.saveStandardMessages(this.standardMessages);
    ipcMain.emit('whatsapp:messages', null, this.standardMessages);
    return this.standardMessages[index];
  }

  // Obter mensagens padrão
  getStandardMessages() {
    return this.standardMessages;
  }

  // Configurar automação para um grupo
  setGroupAutomation(groupId, settings) {
    const automation = {
      enabled: settings.enabled || false,
      messageIndex: settings.messageIndex || 0,
      threshold: settings.threshold || 10,
      lastSent: null,
    };

    this.automationSettings.set(groupId, automation);
    this.messageCounters.set(groupId, 0);
    this.dataService.saveAutomationSettings(Object.fromEntries(this.automationSettings));
    return automation;
  }

  // Obter configuração de automação de um grupo
  getGroupAutomation(groupId) {
    return this.automationSettings.get(groupId) || {
      enabled: false,
      messageIndex: 0,
      threshold: 10,
      lastSent: null,
    };
  }

  // Processar mensagens recebidas
  async handleIncomingMessages(messageUpdate) {
    const { messages } = messageUpdate;
    for (const message of messages) {
      if (message.key.fromMe) continue;
      const groupId = message.key.remoteJid;
      if (!groupId.endsWith('@g.us')) continue;

      const currentCount = (this.messageCounters.get(groupId) || 0) + 1;
      this.messageCounters.set(groupId, currentCount);
      await this.checkAutomationTrigger(groupId);
    }
  }

  // Verificar se deve disparar automação
  async checkAutomationTrigger(groupId) {
    const automation = this.automationSettings.get(groupId);
    if (!automation || !automation.enabled) return;

    const messageCount = this.messageCounters.get(groupId) || 0;
    if (messageCount >= automation.threshold) {
      await this.sendAutomaticMessage(groupId, automation.messageIndex);
      this.messageCounters.set(groupId, 0);
      automation.lastSent = new Date().toISOString();
      this.automationSettings.set(groupId, automation);
      this.dataService.saveAutomationSettings(Object.fromEntries(this.automationSettings));
      this.dataService.addLog({
        type: 'success',
        message: `Mensagem automática enviada para grupo ${groupId}`,
        details: `Mensagem: ${this.standardMessages[automation.messageIndex]?.name}`,
      });
    }
  }

  // Enviar mensagem automática
  async sendAutomaticMessage(groupId, messageIndex) {
    try {
      if (!this.socket || !this.isConnected) {
        throw new Error('WhatsApp não está conectado');
      }

      const message = this.standardMessages[messageIndex];
      if (!message) {
        throw new Error('Mensagem padrão não encontrada');
      }

      const messageContent = { text: message.text };
      if (message.media) {
        const mediaPath = path.join(process.cwd(), 'media', message.media);
        const mediaBuffer = await fs.readFile(mediaPath);
        const mediaType = message.media.endsWith('.mp3') || message.media.endsWith('.wav')
          ? 'audio'
          : 'image';

        messageContent[mediaType] = {
          buffer: mediaBuffer,
          mimetype: mediaType === 'audio' ? 'audio/mpeg' : `image/${message.media.split('.').pop()}`,
        };
      }

      await this.socket.sendMessage(groupId, messageContent);
      const log = {
        success: true,
        groupId,
        messageName: message.name,
        sentAt: new Date().toISOString(),
      };

      this.dataService.addLog({
        type: 'success',
        message: `Mensagem automática enviada para grupo ${groupId}`,
        details: `Mensagem: ${message.name}`,
      });

      return log;
    } catch (error) {
      this.dataService.addLog({
        type: 'error',
        message: `Erro ao enviar mensagem automática para grupo ${groupId}`,
        details: error.message,
      });
      throw error;
    }
  }

  // Carregar configurações
  async loadConfiguration() {
    this.standardMessages = await this.dataService.loadStandardMessages();
    this.automationSettings = new Map(Object.entries(await this.dataService.loadAutomationSettings()));
  }

  // Obter status da conexão
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      qrCode: this.qrCode,
      groupCount: this.groups.length,
    };
  }
}

module.exports = new WhatsAppService();