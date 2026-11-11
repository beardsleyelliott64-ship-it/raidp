'use strict';
const assert = require('node:assert/strict');
const config = require('../config.json');
const keys = [
    'login_bar_left_full', 'login_bar_left_half', 'login_bar_left_empty',
    'login_bar_fill', 'login_bar_half', 'login_bar_empty',
    'login_bar_right_full', 'login_bar_right_half', 'login_bar_right_empty'
];
keys.forEach((key, index) => { config.emojis[key] = String(1000000000000000000n + BigInt(index)); });
const getProgressBar = require('../utils/getProgressBar');

for (const percent of [0, 1, 10, 25, 49, 50, 51, 75, 90, 99, 100]) {
    const bar = getProgressBar(percent, 100);
    assert.equal((bar.match(/<:/g) || []).length, 10, `${percent}% should render ten custom emoji segments`);
}

const full = getProgressBar(100, 100);
assert.match(full, /^<:bar_left_full:/);
assert.equal((full.match(/<:bar_fill:/g) || []).length, 8);
assert.match(full, /<:bar_right_full:[^>]+>$/);

config.emojis.login_bar_half = '';
assert.equal(getProgressBar(45, 100), '▰'.repeat(5) + '▱'.repeat(5), 'missing custom emoji should use Unicode fallback');
console.log('Named progress-bar tests passed.');
