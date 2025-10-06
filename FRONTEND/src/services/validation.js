// src/services/validation.js
function validateImportData(data) {
  const errors = [];

  // Validar config
  if (!data.config || typeof data.config !== 'object') {
    errors.push('Configuração ausente ou inválida');
  }

  // Validar logs
  if (!Array.isArray(data.logs)) {
    errors.push('Logs ausentes ou inválidos');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

module.exports = { validateImportData };
