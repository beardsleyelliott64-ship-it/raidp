const assert = require('node:assert/strict');
const getProgressBar = require('../utils/getProgressBar');
for (const percent of [0, 1, 10, 25, 49, 50, 51, 75, 99, 100]) {
    const bar = getProgressBar(percent, 100);
    assert.equal([...bar].length, 10, `Expected ten cells at ${percent}%`);
    assert.ok(bar.length > 0);
}
assert.equal(getProgressBar(0, 100), '▱'.repeat(10));
assert.equal(getProgressBar(100, 100), '▰'.repeat(10));
console.log('Progress bar renderer tests passed.');
