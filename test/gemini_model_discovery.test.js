'use strict';
const assert = require('node:assert/strict');
const { REQUESTED_MODELS, USER_MODELS } = require('../gemini/modelDiscovery');
assert.ok(REQUESTED_MODELS.includes('gemini-3.8-flash'));
assert.ok(REQUESTED_MODELS.includes('gemini-3.5-flash-lite'));
for (const id of ['gemini-2.0-flash-lite','gemini-2.0-flash','gemini-3.5-flash-lite','gemini-3.5-flash','gemini-3-flash-preview','gemini-3-pro-preview','gemini-3.1-flash-lite-preview','gemini-3.1-pro-preview']) assert.ok(USER_MODELS.includes(id), `Missing user model ${id}`);
assert.equal(new Set(REQUESTED_MODELS).size, REQUESTED_MODELS.length);
console.log('Gemini model preference configuration tests passed.');
