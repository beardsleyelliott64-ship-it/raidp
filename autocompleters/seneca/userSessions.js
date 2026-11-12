const { MessageFlags, StringSelectMenuOptionBuilder, SeparatorSpacingSize, SeparatorBuilder, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { emojis, colours } = require('../../config.json');
const base = require('../../generic/baseUserSessions');
const dueDate = require('../../utils/dueDate');

const seperator = new SeparatorBuilder({
    spacing: SeparatorSpacingSize.Small
});

const saveAccountBtn = new ButtonBuilder()
    .setCustomId('save_account')
    .setLabel('Save Account')
    .setEmoji(emojis.save_account)
    .setStyle(ButtonStyle.Secondary);

class userSession {
    constructor(interaction, loginDetails, requesticator) {
        this.interaction = interaction;
        this.loginDetails = loginDetails;
        this.requesticator = requesticator;
        this.settings = { min: 23, max: 25 };
        this.homeworksEnddate = {};
        this.platform = 'seneca';
    }

    loadFromObject(data) {
        Object.assign(this, data);
        const incoming = data?.settings || {};
        this.settings = { min: 23, max: 25, ...incoming };
    }

    createMainMenu() {
        return new TextDisplayBuilder().setContent(`### Seneca Homework Selection\nSelect one of the homeworks below and it will automatically be completed for you!\n\n**❓ What is Simulated Time?**\nSimulated Time is the amount of time the bot simulate completing for each question. This is **PER QUESTION**, not per homework. Recommended time is 23-25 Seconds per question.\n\n**⏰ Simulated Time**: ${this.settings.min}-${this.settings.max} Seconds Per Question`);
    }

    async init() {
        const userInfo = await this.requesticator.get('https://user-info.app.senecalearning.com/api/user-info/me');
        this.userId = userInfo.userId;

        this.assignments = await this.requesticator.get('https://assignments.app.senecalearning.com/api/students/me/assignments', {
            limit: '100',
            date: '11/01/2025',
            archived: 'false'
        });
    }

    getButtons(useStartButton, disabled = false) {
        const setTimeBtn = new ButtonBuilder()
            .setCustomId('settings')
            .setLabel('Settings')
            .setEmoji(emojis.settings)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disabled);

        const startButton = new ButtonBuilder()
            .setCustomId('start')
            .setLabel('Start')
            .setEmoji(emojis.tick)
            .setStyle(ButtonStyle.Success)
            .setDisabled(disabled);

        const saveAccountBtnCopy = ButtonBuilder.from(saveAccountBtn);
        saveAccountBtnCopy.setDisabled(disabled);
        const actionRow = new ActionRowBuilder();
        if (useStartButton) {
            actionRow.addComponents(startButton);
        }
        actionRow.addComponents(setTimeBtn);
        if (this.loginDetails.username) {
            actionRow.addComponents(saveAccountBtnCopy);
        }

        return actionRow;
    }

    async updateEmbed(disabled = false) {

        const select = new StringSelectMenuBuilder()
            .setCustomId('homework')
            .setPlaceholder('Choose a homework')
            .setMinValues(0)
            .setMaxValues(1);
        
        let count = 0;
        for (const assignment of this.assignments.items) {
            this.homeworksEnddate[assignment.id] = Math.floor(new Date(assignment.dueDate).getTime() / 1000);
            if (assignment.status === 'COMPLETE') {
                continue; // ${Math.round(quiz.correctCount / quiz.questionCount * 100)}% • 
            }
            if (count >= 25) break;
            const option = new StringSelectMenuOptionBuilder()
                .setLabel(assignment.name)
                .setDescription(`${dueDate(new Date(assignment.dueDate))}`)
                .setValue(assignment.id)
                .setDefault(assignment.id === this.selectedHomework);

            select.addOptions(option);
            count++;
        }

        this.select = select;

        const selectRow = new ActionRowBuilder().addComponents(this.select);

        const container = new ContainerBuilder()
            .setAccentColor(colours.seneca)
            .addTextDisplayComponents(
                this.createMainMenu()
            );

        container.addSeparatorComponents(
            seperator
        );

        if (selectRow.components[0].options.length) {
            container.addActionRowComponents(
                selectRow
            );
        }

        const buttonRow = this.getButtons(this.selectedHomework !== undefined, disabled);

        container.addActionRowComponents(
            buttonRow
        );

        this.mainMenuSection = this.createMainMenu();

        const message_sent = await this.interaction.editReply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container]
        });

        return message_sent;
    }
}

class userSessions extends base {
    constructor() {
        super('seneca');
    }

    createNewSession(interaction, loginDetails, token) {
        this.sessions[interaction.user.id] = new userSession(interaction, loginDetails, new this.requesticator(token, loginDetails));
        return this.sessions[interaction.user.id];
    }

}

const UserSessions = new userSessions();

module.exports = UserSessions;