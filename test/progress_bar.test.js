'use strict';
const assert = require('node:assert/strict');
const config = require('../config.json');
const getProgressBar = require('../utils/getProgressBar');

const names = [
  ['login_bar_left_full', 'bar_left_full'],
  ['login_bar_left_half', 'bar_left_half'],
  ['login_bar_left_empty', 'bar_left_empty'],
  ['login_bar_fill', 'bar_fill'],
  ['login_bar_half', 'bar_half'],
  ['login_bar_empty', 'bar_empty'],
  ['login_bar_right_full', 'bar_right_full'],
  ['login_bar_right_half', 'bar_right_half'],
  ['login_bar_right_empty', 'bar_right_empty']
];
names.forEach(([key], index) => { config.emojis[key] = String(100000000000000000 + index); });

const parts = value => getProgressBar(value, 100).match(/<:[a-z_]+:\d+>/g) || [];
const bar0 = parts(0);
assert.equal(bar0.length, 10);
assert.match(bar0[0], /bar_left_empty/);
assert.match(bar0[9], /bar_right_empty/);

const bar5 = parts(5);
assert.match(bar5[0], /bar_left_half/);

const bar10 = parts(10);
assert.match(bar10[0], /bar_left_full/);
assert.match(bar10[1], /bar_empty/);

const bar15 = parts(15);
assert.match(bar15[1], /bar_half/);

const bar50 = parts(50);
assert.match(bar50[0], /bar_left_full/);
for (let i = 1; i <= 4; i++) assert.match(bar50[i], /bar_fill/);
assert.match(bar50[9], /bar_right_empty/);

const bar100 = parts(100);
assert.match(bar100[9], /bar_right_full/);
for (const item of bar100) assert.ok(/bar_(left_full|fill|right_full)/.test(item));

for (const value of [-100, 0, 1, 49, 50, 51, 99, 100, 200]) {
  assert.equal(parts(value).length, 10, `bar for ${value}% should contain ten segments`);
}
console.log('Named progress-bar boundary tests passed.');
