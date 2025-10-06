// Serviço de gerenciamento de dados
const fs = require('fs').promises;
const path = require('path');
const { validateImportData } = require('./validation');

class DataService {
  constructor() {
    this.dataDir = path.join(process.cwd(), 'data');
    this.configFile = path.join(this.dataDir, 'config.json');
    this.logsFile = path.join(this.dataDir, 'logs.json');
    this.mediaDir = path.join(this.dataDir, 'media');
    this.ensureDataDirectory();
    this.initializeFiles();
  }

  // Garantir que diretórios existem
  async ensureDataDirectory() {
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.mkdir(this.mediaDir, { recursive: true });
  }

  // Inicializar arquivos de dados
  async initializeFiles() {
    const defaultConfig = {
      standardMessages: [],
      automationSettings: {},
      appSettings: { darkMode: false, language: 'pt-BR' },
    };

    if (!await fs.access(this.configFile).catch(() => false)) {
      await this.saveConfig(defaultConfig);
    }

    if (!await fs.access(this.logsFile).catch(() => false)) {
      await this.saveLogs([]);
    }
  }

  // Salvar configurações
  async saveConfig(config) {
    try {
      await fs.writeFile(this.configFile, JSON.stringify(config, null, 2), 'utf8');
      return true;
    } catch (error) {
      console.error('Erro ao salvar configurações:', error);
      throw new Error('Falha ao salvar configurações');
    }
  }

  // Carregar configurações
  async loadConfig() {
    try {
      if (await fs.access(this.configFile).catch(() => false)) {
        const data = await fs.readFile(this.configFile, 'utf8');
        return JSON.parse(data);
      }
      return null;
    } catch (error) {
      console.error('Erro ao carregar configurações:', error);
      throw new Error('Falha ao carregar configurações');
    }
  }

  // Salvar mensagens padrão
  async saveStandardMessages(messages) {
    const config = (await this.loadConfig()) || {};
    config.standardMessages = messages.map((msg) => ({ ...msg, media: msg.media || null }));
    return await this.saveConfig(config);
  }

  // Carregar mensagens padrão
  async loadStandardMessages() {
    const config = await this.loadConfig();
    return config ? config.standardMessages || [] : [];
  }

  // Salvar configurações de automação
  async saveAutomationSettings(settings) {
    const config = (await this.loadConfig()) || {};
    config.automationSettings = settings;
    return await this.saveConfig(config);
  }

  // Carregar configurações de automação
  async loadAutomationSettings() {
    const config = await this.loadConfig();
    return config ? config.automationSettings || {} : {};
  }

  // Salvar configurações do aplicativo
  async saveAppSettings(settings) {
    const config = (await this.loadConfig()) || {};
    config.appSettings = { ...config.appSettings, ...settings };
    return await this.saveConfig(config);
  }

  // Carregar configurações do aplicativo
  async loadAppSettings() {
    const config = await this.loadConfig();
    return config ? config.appSettings || {} : {};
  }

  // Salvar arquivo de mídia
  async saveMediaFile(file) {
    try {
      const fileName = `${Date.now()}_${file.name}`;
      const filePath = path.join(this.mediaDir, fileName);
      await fs.writeFile(filePath, file.data);
      return fileName;
    } catch (error) {
      console.error('Erro ao salvar mídia:', error);
      throw new Error('Falha ao salvar arquivo de mídia');
    }
  }

  // Adicionar log de atividade
  async addLog(logEntry) {
    try {
      const logs = await this.loadLogs();
      const newLog = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        ...logEntry,
      };

      logs.unshift(newLog);
      if (logs.length > 1000) {
        logs.splice(1000);
      }

      await this.saveLogs(logs);
      return newLog;
    } catch (error) {
      console.error('Erro ao adicionar log:', error);
      throw new Error('Falha ao adicionar log');
    }
  }

  // Salvar logs
  async saveLogs(logs) {
    try {
      await fs.writeFile(this.logsFile, JSON.stringify(logs, null, 2), 'utf8');
      return true;
    } catch (error) {
      console.error('Erro ao salvar logs:', error);
      throw new Error('Falha ao salvar logs');
    }
  }

  // Carregar logs
  async loadLogs() {
    try {
      if (await fs.access(this.logsFile).catch(() => false)) {
        const data = await fs.readFile(this.logsFile, 'utf8');
        return JSON.parse(data);
      }
      return [];
    } catch (error) {
      console.error('Erro ao carregar logs:', error);
      return [];
    }
  }

  // Obter logs filtrados
  async getFilteredLogs(filters = {}) {
    const logs = await this.loadLogs();
    let filteredLogs = logs;

    if (filters.type) {
      filteredLogs = filteredLogs.filter((log) => log.type === filters.type);
    }

    if (filters.startDate) {
      const startDate = new Date(filters.startDate);
      filteredLogs = filteredLogs.filter((log) => new Date(log.timestamp) >= startDate);
    }

    if (filters.endDate) {
      const endDate = new Date(filters.endDate);
      filteredLogs = filteredLogs.filter((log) => new Date(log.timestamp) <= endDate);
    }

    if (filters.limit) {
      filteredLogs = filteredLogs.slice(0, filters.limit);
    }

    return filteredLogs;
  }

  // Limpar logs antigos
  async clearOldLogs(daysToKeep = 30) {
    try {
      const logs = await this.loadLogs();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const filteredLogs = logs.filter(
        (log) => new Date(log.timestamp) >= cutoffDate
      );

      await this.saveLogs(filteredLogs);
      return logs.length - filteredLogs.length;
    } catch (error) {
      console.error('Erro ao limpar logs antigos:', error);
      throw new Error('Falha ao limpar logs antigos');
    }
  }

  // Exportar dados
  async exportData() {
    try {
      const config = await this.loadConfig();
      const logs = await this.loadLogs();

      const exportData = {
        config,
        logs,
        exportedAt: new Date().toISOString(),
        version: '1.0.0',
      };

      const exportPath = path.join(this.dataDir, `backup_${Date.now()}.json`);
      await fs.writeFile(exportPath, JSON.stringify(exportData, null, 2), 'utf8');

      return exportPath;
    } catch (error) {
      console.error('Erro ao exportar dados:', error);
      throw new Error('Falha ao exportar dados');
    }
  }

  // Importar dados
  async importData(filePath) {
    try {
      const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
      const validation = validateImportData(data);

      if (!validation.isValid) {
        throw new Error(validation.errors.join('; '));
      }

      if (data.config) {
        await this.saveConfig(data.config);
      }

      if (data.logs) {
        await this.saveLogs(data.logs);
      }

      return true;
    } catch (error) {
      console.error('Erro ao importar dados:', error);
      throw new Error('Falha ao importar dados');
    }
  }

  // Validar integridade dos dados
  async validateData() {
    try {
      const config = await this.loadConfig();
      const logs = await this.loadLogs();

      return {
        configValid: config !== null,
        logsValid: Array.isArray(logs),
        standardMessagesCount: config?.standardMessages?.length || 0,
        automationSettingsCount: Object.keys(config?.automationSettings || {}).length,
        logsCount: logs.length,
      };
    } catch (error) {
      console.error('Erro ao validar dados:', error);
      return {
        configValid: false,
        logsValid: false,
        error: error.message,
      };
    }
  }
}

module.exports = new DataService();