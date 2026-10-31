const { SeparatorSpacingSize, StringSelectMenuOptionBuilder, SeparatorBuilder, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { emojis, colours } = require('../../../../config.json');
const base = require('../../../../generic/baseUserSessions');
const formatUnixTimestamp = require('../../../../utils/formatUnixTimestamp.js');

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
        this.platform = 'science';
        this.settings = { min: 20, max: 40, model: 'No Models' };

        this.selectedHomework = null;
        this.homeworksEnddate = {};
    }

    loadFromObject(data) {
        Object.assign(this, data);
        const incoming = data?.settings || {};
        this.settings = { min: 20, max: 40, model: 'No Models', ...incoming };
    }

    async createSelector() {
        const homeworks = await this.requesticator.getHomeworks();

        const select = new StringSelectMenuBuilder()
            .setCustomId('select_homework')
            .setPlaceholder('Choose a homework task')
            .setMinValues(0);

        const homeworksParsed = [];

        for (const homework of homeworks.packages) {
            const progress = homework.state.completion?.progress;
            const totalTasks = homework.state.completion?.size;
            const totalComplete = progress?.C || 0;
            const percent = totalTasks > 0 ? Math.round((totalComplete / totalTasks) * 100) : 0;

            homeworksParsed.push({ endTimestamp: homework.endTimestamp.seconds, percent, name: homework.name });
        }

        const sortByEndDateDesc = (a, b) => b.endTimestamp - a.endTimestamp;

        homeworksParsed.sort(sortByEndDateDesc);

        for (const homework of homeworksParsed) {
            this.homeworksEnddate[homework.name] = homework.endTimestamp;
            select.addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel(`Homework for ${formatUnixTimestamp(homework.endTimestamp)}`)
                    .setValue(homework.name)
                    .setDescription(`${homework.percent}%`)
                    .setDefault(homework.name === this.selectedHomework)
            );
        }

        this.selectRow = select;
    }

    async init() {
        this.userInfo = await this.requesticator.getUserInfo();
        this.userDisplayName = await this.requesticator.getUserDisplayName();
        await this.requesticator.getClientID();
    }

    async updateEmbed(disabled = false) {
        /*
        const IndependentLearningButton = new ButtonBuilder()
            .setCustomId('independent_learning')
            .setLabel('Independent Learning')
            .setEmoji(emojis.independent_learning)
            .setDisabled(disabled)
            .setStyle(ButtonStyle.Primary);

        const settingsRow = new ActionRowBuilder()
            .addComponents(IndependentLearningButton);
        */

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
            .setAccentColor(colours.sparx_science)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## Sparx Science Autocompleter\nWelcome, **${this.userInfo.givenName} the ${this.userDisplayName}**!`)
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`### Settings`),
                new TextDisplayBuilder().setContent(`⏰ **Minimum Fake Time**: ${this.settings.min} Seconds`),
                new TextDisplayBuilder().setContent(`⏰ **Maximum Fake Time**: ${this.settings.max} Seconds`)
            );

        await this.createSelector();
        if (this.selectRow && this.selectRow.options && this.selectRow.options.length) {
            this.selectRow.setDisabled(disabled);
            mathsEmbed.addActionRowComponents(new ActionRowBuilder().addComponents(this.selectRow));
        }
        mathsEmbed.addActionRowComponents(startRow); // settingsRow, 
        const message_sent = await this.interaction.editReply({
            components: [mathsEmbed]
        });

        this.message_sent = message_sent;

        return message_sent;
    }
}

class userSessions extends base {
    constructor() {
        super('sparx', 'science');
    }

    createNewSession(interaction, loginDetails, token, cookies) {
        this.sessions[interaction.user.id] = new userSession(interaction, loginDetails, new this.requesticator(token, loginDetails, cookies));
        return this.sessions[interaction.user.id];
    }

}

const UserSessions = new userSessions();

module.exports = UserSessions;