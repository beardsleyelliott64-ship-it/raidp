const { SeparatorSpacingSize, StringSelectMenuOptionBuilder, SeparatorBuilder, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { emojis, colours } = require('../../../../config.json');
const base = require('../../../../generic/baseUserSessions');

const saveAccountBtn = new ButtonBuilder()
    .setCustomId('save_account')
    .setLabel('Save Account')
    .setEmoji(emojis.save_account)
    .setStyle(ButtonStyle.Secondary);
const tagChangerBtn = new ButtonBuilder()
    .setCustomId('tag_changer')
    .setLabel('Tag Changer')
    .setEmoji(emojis.tag_changer)
    .setStyle(ButtonStyle.Secondary);

class userSession {
    constructor(interaction, loginDetails, requesticator) {
        this.interaction = interaction;
        this.loginDetails = loginDetails;
        this.requesticator = requesticator;
        this.platform = 'maths';
        this.homeworksEnddate = {};
        // Maths Specific Settings
        this.settings = {
            pdfSettings: { question: false, working_out: false },
            min: 100,
            max: 140,
            model: 'No Models'
        };

        this.selectedHomework = null;
    }

    loadFromObject(data) {
        Object.assign(this, data);
        const incoming = data?.settings || {};
        this.settings = {
            pdfSettings: { question: false, working_out: false, ...(incoming.pdfSettings || {}) },
            min: 100, max: 140, model: 'No Models', ...incoming
        };
        this.settings.pdfSettings = { question: false, working_out: false, ...(incoming.pdfSettings || {}) };
    }

    async createSelector() {
        const homeworks = await this.requesticator.getHomeworks();
        const packages = Array.isArray(homeworks?.packages) ? homeworks.packages : [];

        // Helper to sort descending by endDate
        const sortByEndDateDesc = (a, b) => b.endDate.seconds - a.endDate.seconds;

        // Filter categories
        const onlyHomeworks = packages
            .filter(pkg => pkg.title.startsWith('Homework'))
            .sort(sortByEndDateDesc);

        const onlyXpBoosts = packages
            .filter(pkg => pkg.title.startsWith('XP Boost'))
            .sort(sortByEndDateDesc);

        const onlyTargets = packages
            .filter(pkg => pkg.title.startsWith('Targets'))
            .sort(sortByEndDateDesc);

        // Combine them in the required order
        const orderedList = [...onlyHomeworks, ...onlyXpBoosts, ...onlyTargets];

        const select = new StringSelectMenuBuilder()
            .setCustomId('select_homework')
            .setPlaceholder('Choose a homework task')
            .setMinValues(0);

        for (const homework of orderedList) {
            this.homeworksEnddate[homework.packageID] = homework.endDate.seconds;
            select.addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel(homework.title)
                    .setDescription(`${(Math.round(homework.numTaskItemsDone / homework.numTaskItems * 100)) || 0}%`)
                    .setValue(homework.packageID)
                    .setDefault(this.selectedHomework === homework.packageID)
            );
        }

        this.selectRow = select;
    }

    async init() {
        this.userInfo = await this.requesticator.getUserInfo();
        this.userDisplayName = await this.requesticator.getUserDisplayName();

        await this.requesticator.getClientSession();
    }

    async updateEmbed(disabled = false) {
        const welcomeMessage = `## Sparx Maths Autocompleter\nWelcome, **${this.userInfo.givenName} the ${this.userDisplayName}**!\nSelect a homework and it automatically will be completed for you!`;
        const loginSuccessSection = new TextDisplayBuilder().setContent(`${welcomeMessage}`);
        const settingsSetup = new TextDisplayBuilder().setContent(`### Settings`);
        const pdfSet = new TextDisplayBuilder().setContent(`**📜 PDF **\n**Answers**  \`\`✅\`\`\n**Questions**  ${this.settings.pdfSettings.question ? '``✅``' : '``❌``'}\n**Working Out**  ${this.settings.pdfSettings.working_out ? '``✅``' : '``❌``'}`);
        const minTime = new TextDisplayBuilder().setContent(`⏰ **Minimum Fake Time**: ${this.settings.min} Seconds`);
        const maxTime = new TextDisplayBuilder().setContent(`⏰ **Maximum Fake Time**: ${this.settings.max} Seconds`);

        const XpFarmingButton = new ButtonBuilder()
            .setCustomId('xp_farming')
            .setLabel('XP Farming')
            .setEmoji(emojis.x)
            .setDisabled(disabled)
            .setStyle(ButtonStyle.Primary);

        const IndependentLearningButton = new ButtonBuilder()
            .setCustomId('independent_learning')
            .setLabel('Independent Learning')
            .setEmoji(emojis.independent_learning)
            .setDisabled(disabled)
            .setStyle(ButtonStyle.Primary);

        const settingsRow = new ActionRowBuilder()
            .addComponents(IndependentLearningButton, XpFarmingButton);

        const startRow = new ActionRowBuilder();
        if (this.selectedHomework) {
            const startButton = new ButtonBuilder()
                .setCustomId('start')
                .setLabel('Start')
                .setStyle(ButtonStyle.Success)
                .setEmoji(emojis.tick)
                .setDisabled(disabled);
            startRow.addComponents(startButton);
        }

        if (this.loginDetails.username) {
            const saveAccountBtnCopy = ButtonBuilder.from(saveAccountBtn);
            saveAccountBtnCopy.setDisabled(disabled);
            startRow.addComponents(saveAccountBtnCopy);
        }

        const tagBtnCopy = ButtonBuilder.from(tagChangerBtn);
        tagBtnCopy.setDisabled(disabled);
        startRow.addComponents(tagBtnCopy);
        const settingBtn = new ButtonBuilder()
            .setCustomId('settings')
            .setLabel('Settings')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(emojis.settings)
            .setDisabled(disabled);
        startRow.addComponents(settingBtn);

        const mathsEmbed = new ContainerBuilder()
            .setAccentColor(colours.sparx_maths)
            .addTextDisplayComponents(
                loginSuccessSection
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(
                settingsSetup,
                pdfSet,
                minTime,
                maxTime
            );

        await this.createSelector();
        if (this.selectRow && this.selectRow.options && this.selectRow.options.length) {
            this.selectRow.setDisabled(disabled);
            mathsEmbed.addActionRowComponents(new ActionRowBuilder().addComponents(this.selectRow));
        }
        mathsEmbed.addActionRowComponents(settingsRow, startRow);
        const message_sent = await this.interaction.editReply({
            components: [mathsEmbed]
        });

        this.message_sent = message_sent;

        return message_sent;
    }
}

class userSessions extends base {
    constructor() {
        super('sparx', 'maths');
    }

    createNewSession(interaction, loginDetails, token, cookies) {
        this.sessions[interaction.user.id] = new userSession(interaction, loginDetails, new this.requesticator(token, loginDetails, cookies));
        return this.sessions[interaction.user.id];
    }

}

const UserSessions = new userSessions();

module.exports = UserSessions;