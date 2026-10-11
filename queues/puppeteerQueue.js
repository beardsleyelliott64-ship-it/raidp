const { default: PQueue } = require('p-queue');
const { browser_queue_size } = require('../config.json');

const puppetQueue = new PQueue({
  concurrency: browser_queue_size,
});

module.exports = puppetQueue;