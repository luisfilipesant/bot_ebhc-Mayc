// Utilitários auxiliares para a aplicação

// Formatar data para exibição em português
function formatDate(dateString, includeTime = true) {
  try {
    const date = new Date(dateString);
    const options = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'America/Sao_Paulo'
    };

    if (includeTime) {
      options.hour = '2-digit';
      options.minute = '2-digit';
      options.second = '2-digit';
    }

    return date.toLocaleString('pt-BR', options);
  } catch (error) {
    return 'Data inválida';
  }
}

// Formatar data relativa (há X tempo)
function formatRelativeDate(dateString) {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMinutes < 1) {
      return 'Agora mesmo';
    } else if (diffMinutes < 60) {
      return `Há ${diffMinutes} minuto${diffMinutes > 1 ? 's' : ''}`;
    } else if (diffHours < 24) {
      return `Há ${diffHours} hora${diffHours > 1 ? 's' : ''}`;
    } else if (diffDays < 7) {
      return `Há ${diffDays} dia${diffDays > 1 ? 's' : ''}`;
    } else {
      return formatDate(dateString, false);
    }
  } catch (error) {
    return 'Data inválida';
  }
}

// Truncar texto com reticências
function truncateText(text, maxLength = 50) {
  if (!text || typeof text !== 'string') return '';
  
  if (text.length <= maxLength) return text;
  
  return text.substring(0, maxLength - 3) + '...';
}

// Capitalizar primeira letra
function capitalize(text) {
  if (!text || typeof text !== 'string') return '';
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

// Formatar número de telefone brasileiro
function formatPhoneNumber(phone) {
  if (!phone) return '';
  
  const cleaned = phone.replace(/\D/g, '');
  
  if (cleaned.length === 11) {
    return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 7)}-${cleaned.slice(7)}`;
  } else if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 6)}-${cleaned.slice(6)}`;
  }
  
  return phone;
}

// Gerar ID único
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Debounce para otimizar buscas
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Throttle para limitar execuções
function throttle(func, limit) {
  let inThrottle;
  return function() {
    const args = arguments;
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// Converter bytes para formato legível
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Validar se é uma URL válida
function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

// Extrair extensão de arquivo
function getFileExtension(filename) {
  if (!filename || typeof filename !== 'string') return '';
  return filename.split('.').pop().toLowerCase();
}

// Verificar se arquivo é imagem
function isImageFile(filename) {
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
  return imageExtensions.includes(getFileExtension(filename));
}

// Verificar se arquivo é áudio
function isAudioFile(filename) {
  const audioExtensions = ['mp3', 'wav', 'ogg', 'aac', 'm4a'];
  return audioExtensions.includes(getFileExtension(filename));
}

// Escapar HTML
function escapeHtml(text) {
  if (!text || typeof text !== 'string') return '';
  
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  
  return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

// Remover acentos
function removeAccents(text) {
  if (!text || typeof text !== 'string') return '';
  
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Busca insensível a caso e acentos
function fuzzySearch(text, searchTerm) {
  if (!text || !searchTerm) return false;
  
  const normalizedText = removeAccents(text.toLowerCase());
  const normalizedSearch = removeAccents(searchTerm.toLowerCase());
  
  return normalizedText.includes(normalizedSearch);
}

// Ordenar array de objetos por propriedade
function sortByProperty(array, property, ascending = true) {
  return array.sort((a, b) => {
    const aVal = a[property];
    const bVal = b[property];
    
    if (aVal < bVal) return ascending ? -1 : 1;
    if (aVal > bVal) return ascending ? 1 : -1;
    return 0;
  });
}

// Agrupar array por propriedade
function groupBy(array, property) {
  return array.reduce((groups, item) => {
    const key = item[property];
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(item);
    return groups;
  }, {});
}

// Copiar texto para clipboard (se disponível)
function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  } else {
    // Fallback para navegadores mais antigos
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    return new Promise((resolve, reject) => {
      if (document.execCommand('copy')) {
        resolve();
      } else {
        reject(new Error('Falha ao copiar texto'));
      }
      textArea.remove();
    });
  }
}

// Gerar cores aleatórias para avatares
function generateAvatarColor(text) {
  const colors = [
    '#6B46C1', '#7C3AED', '#8B5CF6', '#A855F7', '#C084FC',
    '#1F2937', '#374151', '#4B5563', '#6B7280', '#9CA3AF'
  ];
  
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = text.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  return colors[Math.abs(hash) % colors.length];
}

// Obter iniciais do nome
function getInitials(name) {
  if (!name || typeof name !== 'string') return '?';
  
  return name
    .split(' ')
    .map(word => word.charAt(0))
    .join('')
    .toUpperCase()
    .substring(0, 2);
}

module.exports = {
  formatDate,
  formatRelativeDate,
  truncateText,
  capitalize,
  formatPhoneNumber,
  generateId,
  debounce,
  throttle,
  formatFileSize,
  isValidUrl,
  getFileExtension,
  isImageFile,
  isAudioFile,
  escapeHtml,
  removeAccents,
  fuzzySearch,
  sortByProperty,
  groupBy,
  copyToClipboard,
  generateAvatarColor,
  getInitials
};

