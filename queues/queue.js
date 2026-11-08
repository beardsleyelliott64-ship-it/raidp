const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');
const queueRanks = Object.keys(config.queue_ranks);
const queueRanksPositions = config.queue_ranks;
const colours = config.colours;

const { logError } = require('../utils/errorLogger.js');
let queueRankStatus = {};
for (const [index, value] of queueRanks.entries()) {
    queueRankStatus[value] = index;
}

class QueueSystem {
    constructor(queueMaxPerUse) {
        this.queueSystem = [];
        this.farmingCancels = [];
        this.lockPerson = [];
        this.queueMaxPerUse = queueMaxPerUse;
        this.activeTasks = new Set();
    }

    async positionToInsert(user) {
        let userStatus = queueRankStatus[user.rank];
        let queueLastPosition;
        for (const [index, item] of this.queueSystem.entries()) {
            if (queueLastPosition === undefined) {
                queueLastPosition = queueRankStatus[item.rank];
            }

            if (queueRankStatus[item.rank] > userStatus) {
                return index;
            }
        }

        return this.queueSystem.length;
    }

    async terminateSession(userID) {
        if (this.lockPerson.some(p => p.id === userID)) { // There is an active session
            this.lockPerson = this.lockPerson.filter(p => p.id !== userID);
            this.changeFarmingStatus(userID, 'blocked');
            return true;
        }
        return false;
    }

    async getFirstMatchingRole(interaction) {
        const guild = interaction.guild;
        const member = await guild.members.fetch(interaction.user);        
        const match = Object.entries(queueRanksPositions).find(([_, roleId]) =>
            member.roles.cache.has(roleId)
        );
        return match ? match[0] : null; 
    }

    async addQueue(info) {
        if (info.farming && this.farmingBlocked(info.id)) return 'blocked';
        let queuePosition = await this.checkQueue(info.id);

        if (queuePosition === -2) {

            const responseEmbed = new EmbedBuilder()
                .setTitle(`Already Using the Autocompleter`)
                .setDescription(`You appear to have an active session. Use "Check Queue" -> "Terminate Session" to end it, then try again.`)
                .setColor(colours.blue);

            await info.interaction.user.send({ embeds: [responseEmbed] });
            return;
        } else if (queuePosition !== -1) {
            const responseEmbed = new EmbedBuilder()
                .setTitle(`Already in the Queue`)
                .setDescription(`You are already in the queue.`)
                .setColor(colours.blue);

            await info.interaction.user.send({ embeds: [responseEmbed] });
            return;
        }

        const rank = await this.getFirstMatchingRole(info.interaction);
        info['rank'] = rank;
        this.queueSystem.splice(await this.positionToInsert(info), 0, info);
        this.processQueue();
    }

    async processQueue() {
        while (this.queueSystem.length > 0 && this.lockPerson.length < this.queueMaxPerUse) {
            const nextPerson = this.queueSystem.shift(); // remove from queue
            this.lockPerson.push(nextPerson);

            const task = nextPerson.action().catch(err => {
                logError(err, 'Autocompleter', 'Autocompleter Execution Failure');
            }).finally(() => {

                // Remove completed person from lockPerson
                this.lockPerson = this.lockPerson.filter(p => p.id !== nextPerson.id);

                this.activeTasks.delete(task);
                this.processQueue();
            });

            this.activeTasks.add(task);
        }
    }

    async shutdown() {
        this.queueSystem = [];
        this.lockPerson = [];
        // Wait for all currently running tasks
        await Promise.allSettled([...this.activeTasks]);

    }

    async waitUntilNoUse(userId) {
        while (await this.checkQueue(userId) !== -1) {
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
        return true; 
    }

    farmingBlocked(userId) {
        const existingFarm = this.farmingCancels.find(item => item.userId === userId);
        if (existingFarm?.status === 'blocked') return true;
    }

    changeFarmingStatus(userId, status) {
        const existingFarm = this.farmingCancels.find(item => item.userId === userId);
        if (existingFarm) {
            existingFarm.status = status;
        } else {
            this.farmingCancels.push({userId, status});
        }
    }

    async checkQueue(personId) {
        if (this.lockPerson.some(p => p.id === personId)) {
            return -2; // currently processing
        }
        return this.queueSystem.findIndex(p => p.id === personId);
    }

    async stillUsing(personID) {
        return this.lockPerson.some(p => p.id === personID);
    }

    async getLength() {
        return this.queueSystem.length + this.lockPerson.length;
    }

    async getPeople() {
        return {
            queue: this.queueSystem,
            currentPerson: this.lockPerson,
        };
    }

    async removePerson(personId) {
        if (!this.queueSystem || this.queueSystem.length === 0) return false;

        const originalLength = this.queueSystem.length;
        this.queueSystem = this.queueSystem.filter(p => p?.id !== personId);
        
        return this.queueSystem.length < originalLength;
    }

}

module.exports = QueueSystem;