'use strict';
const assert = require('node:assert/strict');
const { MODELS, MODEL_BY_ID } = require('../web/requestJailbreak');

assert.ok(MODELS.length >= 15, 'model catalogue should include all three providers');
for (const provider of ['Gemini', 'Grok', 'Claude']) {
  assert.ok(MODELS.some(model => model.provider === provider), `${provider} catalogue missing`);
}
for (const model of MODELS) {
  assert.equal(MODEL_BY_ID.get(model.id), model);
  assert.ok(model.id && model.name && model.providerKey);
}
assert.equal(MODEL_BY_ID.has('not-a-real-model'), false);
console.log('Request Jailbreak model catalogue tests passed.');
