const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === '@google/genai') return { GoogleGenAI: class {} };
  if (request === 'dotenv') return { config: () => {} };
  return originalLoad.call(this, request, parent, isMain);
};
const { parseAnswer, normaliseOptions } = require('../gemini/sparx_reader/main.js');
Module._load = originalLoad;

const options = normaliseOptions([
  { text: 'Colder and quieter than the Big Barn' },
  { text: 'Not in story' },
  { text: 'Going to college' }
]);

assert.equal(parseAnswer('2', options), 'Not in story');
assert.equal(parseAnswer('Answer: 3', options), 'Going to college');
assert.equal(parseAnswer('B', options), 'Not in story');
assert.equal(parseAnswer('The answer is option 1.', options), 'Colder and quieter than the Big Barn');
assert.equal(parseAnswer('Going to college', options), 'Going to college');
assert.equal(parseAnswer('I think 2 because the passage says...', options), null);
assert.equal(parseAnswer('The answer is 2 because...', options), 'Not in story');

console.log('Reader AI parser tests passed.');
