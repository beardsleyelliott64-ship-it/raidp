const QueueSystem = require('./queue');
const { queue_size } = require('../config.json');
const Queues = new Map();

for (const [key, value] of Object.entries(queue_size)) {
    Queues.set(key, new QueueSystem(value));
}

module.exports = Queues;