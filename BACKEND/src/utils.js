function pick(obj, keys) {
  const out = {}; keys.forEach(k => { if (obj[k] !== undefined) out[k] = obj[k]; }); return out;
}

function isGroupId(id) {
  // WhatsApp group IDs normalmente terminam com '@g.us'
  return typeof id === 'string' && id.endsWith('@g.us');
}

module.exports = { pick, isGroupId };