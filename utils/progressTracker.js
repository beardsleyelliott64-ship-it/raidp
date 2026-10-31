const { EmbedBuilder, ComponentType, MessageFlags, SeparatorBuilder, TextDisplayBuilder, SeparatorSpacingSize, ContainerBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const getProgressBar = require('./getProgressBar');
const { name, colours, emojis } = require('../config.json');
const disableComponents = require('./disableComponents.js');

function webDashboard() { return global.__eamDashboard; }

class progressTracker {
    constructor(interaction, getTimeField, getSettingsField, Executer, title, colour, dueIn, userSession) {
        this.interaction = interaction;
        this.user = interaction.user;
        this.targetMessage;
        this.totalSeconds = 0;
        this.taskTimer = process.hrtime();
        this.container = null;
        this.sectionsProgress;
        this.currentPage = 1;
        this.cancelled = false;
        this.Executer = Executer;
        this.title = title;
        this.colour = colour;
        this.dueIn = dueIn;
        this.userSession = userSession;
        this.getTimeField = getTimeField.bind(this);
        this.getSettingsField = getSettingsField.bind(this);
        this.lastSettingField = this.getTimeField();
        this._refreshTimer = null;
        this._updateInFlight = false;
    }

    async end() {
        if (this._refreshTimer) {
            clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        }
        const finalContainer = disableComponents(this.container);
        try {
            if (this.targetMessage) {
                await this.targetMessage.edit({ components: [finalContainer] });
            }
        } catch (err) {
            console.error('[progressTracker] Failed to finish DM progress message:', err);
        }
        try {
            if (this.interaction && typeof this.interaction.editReply === 'function') {
                await this.interaction.editReply({ components: [finalContainer] });
            }
        } catch (err) {
            console.error('[progressTracker] Failed to finish original progress panel:', err);
        }
        try { webDashboard()?.unregisterSession(this.user?.id); } catch (_) {}
    }

    async wait(time, message, cancelFlag = async () => false) {
        // Resolve wait time in seconds
        const waitSeconds =
            typeof time === "number"
                ? time
                : Math.floor(Math.random() * (time.max - time.min + 1)) + time.min;

        if (waitSeconds <= 0) return;

        const waitMs = waitSeconds * 1000;
        const endTimestamp = Math.floor(Date.now() / 1000 + waitSeconds);

        await this.updateEmbed(`${message} <t:${endTimestamp}:R>`);

        const interval = 1000;
        const start = Date.now();

        while (true) {
            if (await cancelFlag()) break;

            const elapsed = Date.now() - start;
            const remaining = waitMs - elapsed;

            if (remaining <= 0) break;

            await new Promise(res => setTimeout(res, Math.min(interval, remaining)));
        }
    }

    async _editProgressMessage() {
        const payload = {
            components: [this.container]
        };

        let dmError = null;
        if (this.targetMessage) {
            try {
                await this.targetMessage.edit(payload);
            } catch (err) {
                dmError = err;
            }
        }

        // Keep the original Discord panel in sync as well.  The DM tracker is
        // the primary display, but editing only that message made the public
        // panel appear frozen while the worker continued.
        try {
            if (this.interaction && typeof this.interaction.editReply === 'function') {
                await this.interaction.editReply(payload);
            }
        } catch (err) {
            // The interaction reply may no longer be editable; the DM can
            // still be updated, so don't stop the autocompleter for this.
            if (dmError && !this.targetMessage) throw err;
        }

        if (dmError && !this.targetMessage) throw dmError;
        return true;
    }

    async updateEmbed(description) {
        if (this._updateInFlight) return false;
        this._updateInFlight = true;
        this.generateEmbed(description);
        try {
            return await this._editProgressMessage();
        } catch (err) {
            console.error('[progressTracker] Failed to update progress message:', err);
            return false;
        } finally {
            this._updateInFlight = false;
        }
    }

    generateEmbed(status) {
        const page = this.sectionsProgress?.[this.currentPage - 1] || [];
        const maxPages = Math.max(1, this.sectionsProgress?.length || 1);
        if (this.Executer) this.Executer.settings = this.userSession.settings;

        const currentStatus = status || this.lastStatus || 'Working...';
        const settings = this.getSettingsField();
        const live = this.getTimeField();
        const progress = page.map(section => {
            const pct = Math.max(0, Math.min(100, Math.floor(Number(section.percentage) || 0)));
            return `**${section.name}**\n${section.value}\n${pct}%`;
        }).join('\n\n');

        const cancel = new ButtonBuilder()
            .setCustomId('cancel')
            .setLabel('Stop')
            .setStyle(ButtonStyle.Danger);
        const settingsBtn = new ButtonBuilder()
            .setCustomId('settings')
            .setLabel('Settings')
            .setStyle(ButtonStyle.Secondary);
        const row = new ActionRowBuilder().addComponents(cancel, settingsBtn);

        const header = `# Phantom • ${this.title}\n> ${currentStatus}${maxPages > 1 ? `\n> Page ${this.currentPage}/${maxPages}` : ''}`;
        const stats = live.replace(/\*\*/g, '**');

        const container = new ContainerBuilder()
            .setAccentColor(colours[this.colour])
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(header))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Progress\n${progress || 'Preparing session...'}`))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Session\n${settings}`))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Live stats\n${stats}`))
            .addActionRowComponents(row);

        if (status) this.lastStatus = status;
        this.container = container;
    }

    async updateProgressBar(index, newProg, progMax=1) {
        const progressBar = getProgressBar(newProg, progMax);
        const percentage = newProg / progMax * 100;
        const adjustedIndex = Math.floor(index / 5);
        this.currentPage = adjustedIndex + 1;
        const page = this.sectionsProgress[adjustedIndex];
        if (!page || !page[index % 5]) {
            console.warn(`[progressTracker] Ignoring invalid progress update index=${index}, page=${adjustedIndex}`);
            return false;
        }

        page[index % 5].value = progressBar;
        page[index % 5].percentage = Math.max(0, Math.min(100, Number(percentage) || 0));
        try {
            const total = Number(progMax) || 1;
            webDashboard()?.setStatus({
                sessionActive: true, activeUser: this.user?.username || this.user?.globalName || null,
                progress: Math.max(0, Math.min(100, Number(percentage) || 0)),
                srp: Number(newProg) || 0, target: total,
                reader: this.title === 'Sparx Reader' ? 'Running' : undefined,
                maths: this.title === 'Sparx Maths' ? 'Running' : undefined,
                dmPanel: 'Active'
            });
        } catch (_) {}

        return await this.updateEmbed();
    }

    async start(sectionsProgress) {
        this.sectionsProgress = sectionsProgress;
        this.generateEmbed('Starting Autocompleter...');
        try {

            this.targetMessage = await this.user.send({
                components: [this.container],
                flags: MessageFlags.IsComponentsV2
            });

            try {
                webDashboard()?.registerSession(this.user.id, {
                    username: this.user.username || this.user.globalName || 'Discord user',
                    title: this.title,
                    stop: async () => { this.cancelled = true; await this.updateEmbed('Stopping from Phantom Web...'); }
                });
                webDashboard()?.setStatus({
                    dmPanel:'Active', sessionActive:true,
                    reader:this.title === 'Sparx Reader' ? 'Running' : 'Idle',
                    maths:this.title === 'Sparx Maths' ? 'Running' : 'Idle',
                    progress:0, srp:0, target:0, questions:0, correct:0, accuracy:0, elapsed:'0s', speed:0
                });
            } catch (_) {}

            // Keep Time Spent and other live fields moving while the worker is
            // waiting/reading.  The old tracker only edited on task events.
            this._refreshTimer = setInterval(() => {
                if (!this.cancelled) this.updateEmbed().catch(() => {});
            }, 5000);

            const collector = this.targetMessage.createMessageComponentCollector({
                componentType: ComponentType.Button
            });

            collector.on('collect', async (interaction) => {
                try {
                    if (interaction.customId === 'cancel') {
                        if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
                        this.cancelled = true;
                        await this.updateEmbed('Stopping...');
                    } else if (interaction.customId === 'settings') {
                        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                        const { settingsDisplayer } = require('../generic/settingsDisplayer.js');
                        await settingsDisplayer(interaction, this.colour);
                    }
                } catch (err) {
                    console.error('[progressTracker] DM button error:', err);
                    try {
                        if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'Phantom could not process that button.', flags: MessageFlags.Ephemeral });
                    } catch {}
                }
            });
            collector.on('end', () => {
                this._dmCollector = null;
            });
            this._dmCollector = collector;

        } catch {
            const noDMenabled = new EmbedBuilder()
                .setTitle('Cannot Direct Message')
                .setDescription('The autocompleter is unable to direct message you the progress tracker because your discord settings prevent this. You have been kicked out of the queue and the autocompleter has cancelled your task.')
                .addFields({
                    name: 'How do I fix this issue?',
                    value: `Please go to \`Settings -> Content & Social -> Social Permissions -> '${name}' -> Direct Messages ✅\``
                })
                .setColor(colours.light_red);

            await this.interaction.followUp({
                embeds: [noDMenabled],
                flags: MessageFlags.Ephemeral
            });
            return true;
        }
    }
}

module.exports = progressTracker;