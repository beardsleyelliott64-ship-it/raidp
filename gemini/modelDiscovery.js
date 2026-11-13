'use strict';
const REQUESTED_MODELS = Object.freeze([
 'gemini-2.0-flash-lite','gemini-2.0-flash','gemini-2.5-flash-lite','gemini-2.5-flash','gemini-2.5-pro',
 'gemini-3-flash-preview','gemini-3-pro-preview','gemini-3.1-flash-lite-preview','gemini-3.1-pro-preview',
 'gemini-3.5-flash','gemini-3.5-flash-lite','gemini-3.6-flash','gemini-3.8-flash'
]);
async function discoverModels(apiKey) {
 if (!apiKey) throw new Error('Gemini API key is not configured.');
 const axios = require('axios');
 const response = await axios.get('https://generativelanguage.googleapis.com/v1beta/models', { params: { key: apiKey, pageSize: 1000 }, timeout: 12000 });
 const models = (response.data?.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent'));
 const available = new Set(models.map(m => String(m.name || '').replace(/^models\//, '')));
 return { available: REQUESTED_MODELS.filter(id => available.has(id)), discovered: [...available], requested: [...REQUESTED_MODELS], checkedAt: new Date().toISOString() };
}
module.exports = { REQUESTED_MODELS, discoverModels };
