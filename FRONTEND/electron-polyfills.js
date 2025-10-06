// Polyfills adicionais para compatibilidade com Baileys no Electron
const crypto = require('crypto');
const { Buffer } = require('buffer');

// Polyfill para fetch se não existir
if (!global.fetch) {
  global.fetch = require('node-fetch');
}

// Polyfill para Buffer global
if (!global.Buffer) {
  global.Buffer = Buffer;
}

// Polyfill para process se não existir no renderer
if (!global.process) {
  global.process = require('process');
}

// Polyfill para crypto global
if (!global.crypto) {
  global.crypto = require('./crypto-polyfill');
}

// Polyfill para TextEncoder/TextDecoder
if (!global.TextEncoder) {
  const { TextEncoder, TextDecoder } = require('util');
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}

// Polyfill para performance
if (!global.performance) {
  global.performance = require('perf_hooks').performance;
}

// Polyfill para URL se não existir
if (!global.URL) {
  global.URL = require('url').URL;
}

// Polyfill para WebSocket se necessário
if (!global.WebSocket) {
  try {
    global.WebSocket = require('ws');
  } catch (e) {
    // WebSocket não é crítico para o funcionamento básico
  }
}

module.exports = {
  crypto: global.crypto,
  fetch: global.fetch,
  Buffer: global.Buffer,
  TextEncoder: global.TextEncoder,
  TextDecoder: global.TextDecoder
};

