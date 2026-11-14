'use strict';
const { REQUESTED_MODELS, discoverModels } = require('./modelDiscovery');

function statusOf(error) {
  return Number(error?.status ?? error?.code ?? error?.response?.status ?? error?.error?.code ?? 0);
}
function messageOf(error) { return String(error?.message || error || 'Unknown Gemini error'); }
function canFallback(error) {
  const status = statusOf(error);
  if (status === 401) return false; // bad API key cannot be repaired by switching models
  if ([400, 403, 404, 408, 409, 429, 500, 502, 503, 504].includes(status)) return true;
  return /not found|not supported|model.*(unavailable|disabled)|quota|rate.?limit|resource.?exhausted|overloaded|temporar|timeout|invalid.*model/i.test(messageOf(error));
}
async function getCandidateModels(apiKey, preferred) {
  let live = [];
  try { live = (await discoverModels(apiKey)).available; }
  catch (error) { console.warn('[gemini] Model discovery failed; will probe configured fallbacks:', messageOf(error)); }
  const requested = [preferred, ...live, ...REQUESTED_MODELS].filter(Boolean);
  return [...new Set(requested)];
}
async function generateContentWithFallback({ apiKey = process.env.GEMINI_API_KEY, model, contents, config, ai, models, timeoutMs = 35000 }) {
  if (!apiKey) throw new Error('Gemini API key is not configured.');
  const client = ai || new (require('@google/genai').GoogleGenAI)({ apiKey });
  const candidates = models || await getCandidateModels(apiKey, model);
  const failures = [];
  for (const candidate of candidates) {
    try {
      let timer;
      const request = client.models.generateContent({ model: candidate, contents, ...(config ? { config } : {}) });
      const response = await Promise.race([request, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`Gemini request timed out after ${timeoutMs}ms`), { status: 408 })), timeoutMs); })]).finally(() => clearTimeout(timer));
      if (response?.text || response?.candidates?.length) return { response, model: candidate, attempted: failures.map(x => x.model) };
      throw new Error(`Gemini returned an empty response from ${candidate}.`);
    } catch (error) {
      failures.push({ model: candidate, status: statusOf(error), message: messageOf(error).slice(0, 220) });
      console.warn(`[gemini] ${candidate} failed (${statusOf(error) || 'unknown'}); ${canFallback(error) ? 'trying next model' : 'stopping'}.`, messageOf(error));
      if (!canFallback(error)) break;
    }
  }
  const summary = failures.slice(-5).map(x => `${x.model} [${x.status || 'error'}]: ${x.message}`).join(' | ');
  const error = new Error(`All usable Gemini model attempts failed. ${summary || 'No candidate models were available.'}`);
  error.failures = failures;
  throw error;
}
module.exports = { generateContentWithFallback, getCandidateModels, statusOf, canFallback };
