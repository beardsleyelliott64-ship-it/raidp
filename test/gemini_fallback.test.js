'use strict';
const assert = require('node:assert/strict');
const { generateContentWithFallback } = require('../gemini/generate');
(async () => {
  const calls = [];
  const ai = { models: { generateContent: async ({ model }) => {
    calls.push(model);
    if (model === 'bad-404') { const e = new Error('model not found'); e.status = 404; throw e; }
    if (model === 'busy-429') { const e = new Error('rate limit'); e.status = 429; throw e; }
    return { text: 'working response' };
  } } };
  const result = await generateContentWithFallback({ apiKey: 'test-key', ai, models: ['bad-404','busy-429','good-model'], contents: 'hello' });
  assert.equal(result.model, 'good-model');
  assert.equal(result.response.text, 'working response');
  assert.deepEqual(calls, ['bad-404','busy-429','good-model']);
  const unauthorized = { models: { generateContent: async () => { const e = new Error('bad key'); e.status = 401; throw e; } } };
  await assert.rejects(() => generateContentWithFallback({ apiKey: 'test-key', ai: unauthorized, models: ['first','second'], contents: 'x' }), /All usable Gemini model attempts failed/);
  console.log('Gemini automatic model fallback tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
