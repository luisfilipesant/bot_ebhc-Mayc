// Polyfill completo para crypto.subtle no Electron
const crypto = require('crypto');

// Implementar crypto.subtle se não existir
if (!globalThis.crypto) {
  globalThis.crypto = {};
}

if (!globalThis.crypto.subtle) {
  globalThis.crypto.subtle = {
    digest: async (algorithm, data) => {
      let hashAlgorithm;
      
      if (typeof algorithm === 'string') {
        hashAlgorithm = algorithm;
      } else if (algorithm.name) {
        hashAlgorithm = algorithm.name;
      }
      
      // Mapear algoritmos
      const algorithmMap = {
        'SHA-1': 'sha1',
        'SHA-256': 'sha256',
        'SHA-384': 'sha384',
        'SHA-512': 'sha512'
      };
      
      const nodeAlgorithm = algorithmMap[hashAlgorithm] || hashAlgorithm.toLowerCase().replace('-', '');
      
      const hash = crypto.createHash(nodeAlgorithm);
      hash.update(Buffer.from(data));
      return hash.digest().buffer;
    },
    
    encrypt: async (algorithm, key, data) => {
      if (algorithm.name === 'AES-GCM') {
        const iv = algorithm.iv || crypto.randomBytes(12);
        const cipher = crypto.createCipherGCM('aes-256-gcm', Buffer.from(key));
        cipher.setAAD(Buffer.from(algorithm.additionalData || ''));
        
        let encrypted = cipher.update(Buffer.from(data));
        cipher.final();
        const authTag = cipher.getAuthTag();
        
        return Buffer.concat([encrypted, authTag]).buffer;
      }
      throw new Error(`Algoritmo ${algorithm.name} não suportado`);
    },
    
    decrypt: async (algorithm, key, data) => {
      if (algorithm.name === 'AES-GCM') {
        const dataBuffer = Buffer.from(data);
        const authTagLength = 16;
        const encrypted = dataBuffer.slice(0, -authTagLength);
        const authTag = dataBuffer.slice(-authTagLength);
        
        const decipher = crypto.createDecipherGCM('aes-256-gcm', Buffer.from(key));
        decipher.setAAD(Buffer.from(algorithm.additionalData || ''));
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(encrypted);
        decipher.final();
        
        return decrypted.buffer;
      }
      throw new Error(`Algoritmo ${algorithm.name} não suportado`);
    },
    
    generateKey: async (algorithm, extractable, keyUsages) => {
      if (algorithm.name === 'AES-GCM') {
        const keyLength = algorithm.length || 256;
        return crypto.randomBytes(keyLength / 8).buffer;
      } else if (algorithm.name === 'HMAC') {
        const keyLength = algorithm.length || 256;
        return crypto.randomBytes(keyLength / 8).buffer;
      }
      throw new Error(`Algoritmo ${algorithm.name} não suportado`);
    },
    
    importKey: async (format, keyData, algorithm, extractable, keyUsages) => {
      if (format === 'raw') {
        return keyData;
      }
      throw new Error(`Formato ${format} não suportado`);
    },
    
    exportKey: async (format, key) => {
      if (format === 'raw') {
        return key;
      }
      throw new Error(`Formato ${format} não suportado`);
    },
    
    sign: async (algorithm, key, data) => {
      if (algorithm.name === 'HMAC') {
        const hashAlgorithm = algorithm.hash.name.toLowerCase().replace('-', '');
        const hmac = crypto.createHmac(hashAlgorithm, Buffer.from(key));
        hmac.update(Buffer.from(data));
        return hmac.digest().buffer;
      }
      throw new Error(`Algoritmo ${algorithm.name} não suportado`);
    },
    
    verify: async (algorithm, key, signature, data) => {
      if (algorithm.name === 'HMAC') {
        const hashAlgorithm = algorithm.hash.name.toLowerCase().replace('-', '');
        const hmac = crypto.createHmac(hashAlgorithm, Buffer.from(key));
        hmac.update(Buffer.from(data));
        const computedSignature = hmac.digest();
        return crypto.timingSafeEqual(Buffer.from(signature), computedSignature);
      }
      throw new Error(`Algoritmo ${algorithm.name} não suportado`);
    }
  };
}

// Implementar crypto.getRandomValues se não existir
if (!globalThis.crypto.getRandomValues) {
  globalThis.crypto.getRandomValues = (array) => {
    const bytes = crypto.randomBytes(array.length);
    for (let i = 0; i < array.length; i++) {
      array[i] = bytes[i];
    }
    return array;
  };
}

// Implementar crypto.randomUUID se não existir
if (!globalThis.crypto.randomUUID) {
  globalThis.crypto.randomUUID = () => {
    return crypto.randomUUID();
  };
}

module.exports = globalThis.crypto;

