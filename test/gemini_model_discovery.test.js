'use strict';
const assert = require('node:assert/strict');
const { REQUESTED_MODELS } = require('../gemini/modelDiscovery');
assert.equal(REQUESTED_MODELS.length, 13);
assert.equal(new Set(REQUESTED_MODELS).size, 13);
for (const id of ['gemini-2.0-flash-lite','gemini-2.0-flash','gemini-2.5-flash-lite','gemini-2.5-flash','gemini-2.5-pro','gemini-3-flash-preview','gemini-3-pro-preview','gemini-3.1-flash-lite-preview','gemini-3.1-pro-preview','gemini-3.5-flash','gemini-3.5-flash-lite','gemini-3.6-flash','gemini-3.8-flash']) assert.ok(REQUESTED_MODELS.includes(id), `Missing ${id}`);
console.log('Gemini model configuration tests passed.');
