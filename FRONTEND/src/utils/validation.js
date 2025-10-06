// Utilitários de validação para a aplicação

// Validar mensagem padrão
function validateStandardMessage(message) {
  const errors = [];

  if (!message.name || message.name.trim().length === 0) {
    errors.push('O nome da mensagem não pode estar vazio');
  }

  if (message.name && message.name.length > 50) {
    errors.push('O nome da mensagem deve ter no máximo 50 caracteres');
  }

  if (!message.text || message.text.trim().length === 0) {
    errors.push('O texto da mensagem não pode estar vazio');
  }

  if (message.text && message.text.length > 2000) {
    errors.push('O texto da mensagem deve ter no máximo 2000 caracteres');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// Validar configurações de automação
function validateAutomationSettings(settings) {
  const errors = [];

  if (typeof settings.enabled !== 'boolean') {
    errors.push('O status de ativação deve ser verdadeiro ou falso');
  }

  if (settings.messageIndex < 0 || settings.messageIndex > 4) {
    errors.push('O índice da mensagem deve estar entre 0 e 4');
  }

  if (!Number.isInteger(settings.threshold) || settings.threshold < 1 || settings.threshold > 100) {
    errors.push('O limite de mensagens deve ser um número inteiro entre 1 e 100');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// Validar arquivo de mídia
function validateMediaFile(file) {
  const errors = [];
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'audio/mpeg', 'audio/wav'];
  const maxSize = 16 * 1024 * 1024; // 16MB

  if (!file) {
    errors.push('Nenhum arquivo foi selecionado');
    return { isValid: false, errors };
  }

  if (!allowedTypes.includes(file.type)) {
    errors.push('Tipo de arquivo não suportado. Use JPEG, PNG, GIF, MP3 ou WAV');
  }

  if (file.size > maxSize) {
    errors.push('O arquivo deve ter no máximo 16MB');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// Validar nome de grupo
function validateGroupName(name) {
  const errors = [];

  if (!name || name.trim().length === 0) {
    errors.push('O nome do grupo não pode estar vazio');
  }

  if (name && name.length > 100) {
    errors.push('O nome do grupo deve ter no máximo 100 caracteres');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// Validar configurações do aplicativo
function validateAppSettings(settings) {
  const errors = [];

  if (settings.darkMode !== undefined && typeof settings.darkMode !== 'boolean') {
    errors.push('A configuração de modo escuro deve ser verdadeira ou falsa');
  }

  if (settings.language && !['pt-BR', 'en-US'].includes(settings.language)) {
    errors.push('Idioma não suportado');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// Sanitizar texto de entrada
function sanitizeText(text) {
  if (typeof text !== 'string') return '';
  
  return text
    .trim()
    .replace(/\s+/g, ' ') // Substituir múltiplos espaços por um único
    .replace(/[<>]/g, ''); // Remover caracteres potencialmente perigosos
}

// Validar número de telefone (formato brasileiro)
function validatePhoneNumber(phone) {
  const errors = [];
  const phoneRegex = /^(\+55)?(\d{2})(\d{4,5})(\d{4})$/;

  if (!phone || phone.trim().length === 0) {
    errors.push('O número de telefone não pode estar vazio');
  } else if (!phoneRegex.test(phone.replace(/\D/g, ''))) {
    errors.push('Formato de telefone inválido. Use o formato brasileiro (11) 99999-9999');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// Validar intervalo de datas
function validateDateRange(startDate, endDate) {
  const errors = [];

  if (startDate && isNaN(Date.parse(startDate))) {
    errors.push('Data de início inválida');
  }

  if (endDate && isNaN(Date.parse(endDate))) {
    errors.push('Data de fim inválida');
  }

  if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
    errors.push('A data de início deve ser anterior à data de fim');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// Validar entrada de busca
function validateSearchInput(searchTerm) {
  const errors = [];

  if (searchTerm && searchTerm.length > 100) {
    errors.push('O termo de busca deve ter no máximo 100 caracteres');
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized: sanitizeText(searchTerm || '')
  };
}

// Formatar mensagens de erro para exibição
function formatErrorMessages(errors) {
  if (!Array.isArray(errors) || errors.length === 0) {
    return '';
  }

  if (errors.length === 1) {
    return errors[0];
  }

  return errors.map((error, index) => `${index + 1}. ${error}`).join('\n');
}

// Validar dados de importação
function validateImportData(data) {
  const errors = [];

  if (!data || typeof data !== 'object') {
    errors.push('Dados de importação inválidos');
    return { isValid: false, errors };
  }

  if (!data.version) {
    errors.push('Versão dos dados não especificada');
  }

  if (!data.exportedAt || isNaN(Date.parse(data.exportedAt))) {
    errors.push('Data de exportação inválida');
  }

  if (data.config && typeof data.config !== 'object') {
    errors.push('Configurações inválidas nos dados de importação');
  }

  if (data.logs && !Array.isArray(data.logs)) {
    errors.push('Logs inválidos nos dados de importação');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

module.exports = {
  validateStandardMessage,
  validateAutomationSettings,
  validateMediaFile,
  validateGroupName,
  validateAppSettings,
  validatePhoneNumber,
  validateDateRange,
  validateSearchInput,
  validateImportData,
  sanitizeText,
  formatErrorMessages
};

