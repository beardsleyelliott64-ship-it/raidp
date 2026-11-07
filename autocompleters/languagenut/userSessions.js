const { SeparatorSpacingSize, SeparatorBuilder, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { emojis, colours } = require('../../config.json');
const base = require('../../generic/baseUserSessions');

const HOMEWORKS_PER_PAGE = 5;

const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;

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
        this.settings = { min: 10, max: 30, accuracy: 100 };
        this.page = 0;
        this.platform = 'languagenut';
    }

    loadFromObject(data) {
        Object.assign(this, data);
        const incoming = data?.settings || {};
        this.settings = { min: 10, max: 30, accuracy: 100, ...incoming };
    }

    async updateEmbed(disabled = false) {

        const homeworks = await this.requesticator.getHomeworks();
        if (homeworks && homeworks.homework && homeworks.homework.length > 0) {
            const sortedHomeworks = homeworks.homework.sort((a, b) => new Date(b.set) - new Date(a.set));
            this.originalHomeworks = sortedHomeworks;
            this.currentPage = 0;
        }
        const allHomeworks = this.originalHomeworks;
        const totalPages = Math.ceil(allHomeworks.length / HOMEWORKS_PER_PAGE);
        const startIndex = this.page * HOMEWORKS_PER_PAGE;
        const endIndex = Math.min(startIndex + HOMEWORKS_PER_PAGE, allHomeworks.length);
        const pageHomeworks = allHomeworks.slice(startIndex, endIndex);

        this.homeworks = pageHomeworks;
        this.currentPage = this.page;

        const seperator = new SeparatorBuilder({
            spacing: SeparatorSpacingSize.Small
        });

        // 3. Assemble everything into the main container
        const hwEmbed = new ContainerBuilder()
            .setAccentColor(colours.languagenut)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## 📚 Assignments\n${allHomeworks.length} assignments available • Page ${this.page + 1} of ${totalPages}\n`)
            );

        const selectOptions = [];

        pageHomeworks.forEach((hw, index) => {
            const globalIndex = startIndex + index;
            const dueDateRaw = hw.due ? new Date(hw.due) : null;
            const dueDate = dueDateRaw && !isNaN(dueDateRaw.getTime()) ? `<t:${Math.floor(dueDateRaw.getTime() / 1000)}:R>` : 'No due date';
            // Calculate progress
            const percentages = [];
            for (const task of hw.tasks) {
                percentages.push(Number(task.gameResults?.percentage || 0));
            }
            const percentage = Math.round(avg(percentages)) || 0;
            const isCompleted = percentage === 100;

            // Enhanced status indicators
            let completionStatus;
            if (isCompleted) {
                completionStatus = '✅';
            } else if (percentage > 0) {
                completionStatus = '🔄';
            } else {
                completionStatus = '⭕';
            }

            hwEmbed.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`${completionStatus} ${hw.name || `Assignment ${globalIndex + 1}`}\n📊 **Percentage:** ${percentage}%\n⏰ **Due:** ${dueDate}\n`)
            );

            const homeworkName = hw.name || `Assignment ${globalIndex + 1}`;

            let dueDateText = 'No due date';
            if (dueDateRaw && !isNaN(dueDateRaw.getTime())) {
                const now = new Date();
                const diffTime = dueDateRaw.getTime() - now.getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays < 0) {
                    dueDateText = `${Math.abs(diffDays)} day${Math.abs(diffDays) !== 1 ? 's' : ''} ago`;
                } else if (diffDays === 0) {
                    dueDateText = 'Due today';
                } else if (diffDays === 1) {
                    dueDateText = 'Due tomorrow';
                } else if (diffDays <= 7) {
                    dueDateText = `Due in ${diffDays} days`;
                } else {
                    dueDateText = `Due ${dueDateRaw.toLocaleDateString()}`;
                }
            }

            const label = homeworkName.length > 0 ? homeworkName.substring(0, 100) : `Assignment ${globalIndex + 1}`;

            const description = `${percentage}% complete • ${dueDateText}`.substring(0, 100) || 'No description';


            const value = `homework_${globalIndex}`;

            if (label.length >= 1 && description.length >= 1 && value.length >= 1) {
                selectOptions.push({
                    label: label,
                    description: description,
                    value: value,
                    emoji: completionStatus
                });
            }
        });

        hwEmbed.addSeparatorComponents(
            seperator
        );

        hwEmbed.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`⚙️ Settings\n🎯 **Accuracy:** ${this.settings.accuracy}%\n⏰ **Simulated Time:** ${this.settings.min}-${this.settings.max} Seconds Per Question (Not Homework)\n`)
        );

        const components = [];

        if (selectOptions.length > 0) {
            if (this.selectedHomeworkIndex !== undefined) {
                const matchingOption = selectOptions.find(opt => opt.value === `homework_${this.selectedHomeworkIndex}`);
                if (matchingOption) matchingOption.default = true;
            }

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select_homework')
                .setPlaceholder('Select assignment')
                .setMinValues(0)
                .setMaxValues(1)
                .addOptions(selectOptions)
                .setDisabled(disabled);

            components.push(new ActionRowBuilder().addComponents(selectMenu));
        }

        const navigationButtons = [];
        if (this.selectedHomeworkIndex !== undefined) {
            const startButton = new ButtonBuilder()
                .setCustomId('start')
                .setLabel('Start')
                .setEmoji(emojis.tick)
                .setStyle(ButtonStyle.Success)
                .setDisabled(disabled);
            navigationButtons.push(startButton);
        }

        const paginationButtons = [];

        paginationButtons.push(
            new ButtonBuilder()
                .setCustomId('settings')
                .setLabel('Settings')
                .setEmoji(emojis.settings)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(disabled)
        );

        const saveAccountBtnCopy = ButtonBuilder.from(saveAccountBtn);
        saveAccountBtnCopy.setDisabled(disabled);
        if (this.loginDetails.username) {
            paginationButtons.push(saveAccountBtnCopy);
        }

        const navButtons = [];
        if (this.page > 0) {
            navButtons.push(
                new ButtonBuilder()
                    .setCustomId('homework_prev_page')
                    .setLabel('Previous')
                    .setEmoji(emojis.arrow_left)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(disabled)
            );
        }

        if (this.page < totalPages - 1) {
            navButtons.push(
                new ButtonBuilder()
                    .setCustomId('homework_next_page')
                    .setLabel('Next')
                    .setEmoji(emojis.arrow_right)
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(disabled)
            );
        }

        components.push(new ActionRowBuilder().addComponents(paginationButtons));
        if (navigationButtons.length > 0) {
            components.push(new ActionRowBuilder().addComponents(navigationButtons));
        }

        components.push(new ActionRowBuilder().addComponents(navButtons));

        hwEmbed.addActionRowComponents(
            [...components]
        );

        this.hwEmbed = hwEmbed;

        const message_sent = await this.interaction.editReply({
            components: [hwEmbed]
        });

        this.message_sent = message_sent;

        return message_sent;
    }
}

class userSessions extends base {
    constructor() {
        super('languagenut');
    }

    createNewSession(interaction, loginDetails, token) {
        this.sessions[interaction.user.id] = new userSession(interaction, loginDetails, new this.requesticator(token, loginDetails));
        return this.sessions[interaction.user.id];
    }

}

const UserSessions = new userSessions();

module.exports = UserSessions;