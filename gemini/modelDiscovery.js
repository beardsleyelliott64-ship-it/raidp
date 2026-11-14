'use strict';

// Ordered preference list. The first entries are current general-purpose models;
// the historical/user-supplied IDs remain candidates but are used only if Google
// currently advertises them as supporting generateContent.
const REQUESTED_MODELS = Object.freeze([
  'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite',
  'gemini-3.7-flash', 'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview',
  'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro',
  'gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-3-pro-preview',
  'gemini-3.1-flash-lite-preview'
]);
const USER_MODELS = Object.freeze([
  'gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-3.5-flash-lite',
  'gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3-pro-preview',
  'gemini-3.1-flash-lite-preview', 'gemini-3.1-pro-preview'
]);
let cachedDiscovery = null;
let cachedAt = 0;
const CACHE_MS = 5 * 60 * 1000;

async function discoverModels(apiKey, { force = false } = {}) {
  if (!apiKey) throw new Error('Gemini API key is not configured.');
  if (!force && cachedDiscovery && Date.now() - cachedAt < CACHE_MS) return cachedDiscovery;
  const axios = require('axios');
  const discovered = [];
  let pageToken;
  do {
    const response = await axios.get('https://generativelanguage.googleapis.com/v1beta/models', {
      params: { key: apiKey, pageSize: 1000, ...(pageToken ? { pageToken } : {}) }, timeout: 15000
    });
    for (const model of response.data?.models || []) {
      if ((model.supportedGenerationMethods || []).includes('generateContent')) {
        const id = String(model.name || '').replace(/^models\//, '');
        if (id && !discovered.includes(id)) discovered.push(id);
      }
    }
    pageToken = response.data?.nextPageToken || undefined;
  } while (pageToken);
  const availableSet = new Set(discovered);
  const available = REQUESTED_MODELS.filter(id => availableSet.has(id));
  // Include newly released general Gemini models from Google's live catalogue.
  const additional = discovered.filter(id => /^gemini-\d+(?:\.\d+)?-(?:flash|pro)(?:-|$)/.test(id) && !available.includes(id));
  const result = { available: [...available, ...additional], discovered, requested: [...REQUESTED_MODELS], checkedAt: new Date().toISOString() };
  cachedDiscovery = result;
  cachedAt = Date.now();
  return result;
}
function clearDiscoveryCache() { cachedDiscovery = null; cachedAt = 0; }
module.exports = { REQUESTED_MODELS, USER_MODELS, discoverModels, clearDiscoveryCache };
