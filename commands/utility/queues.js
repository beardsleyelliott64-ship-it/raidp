const { SlashCommandBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ContainerBuilder, MessageFlags, TextDisplayBuilder, ActionRowBuilder, ButtonStyle, ComponentType, ModalBuilder } = require('discord.js');
const { colours, emojis } = require('../../config.json');
const formatSubject = require('../../utils/formatSubject');
const seperateIntoRows = require('../../utils/seperateIntoRows');
const allQueues = require('../../queues/queues');
const puppetQueue = require('../../queues/puppeteerQueue');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('queues')
		.setDescription('Gets information on all of the queues'),
	async execute(interaction) {
        const container = new ContainerBuilder()
            .setAccentColor(colours.onyx);

        const buttons = [];
        for (const [name, queue] of allQueues) {
            const maxUsage = queue.queueMaxPerUse;
            const queuePeople = await queue.getPeople();
            const formattedName = formatSubject(name);
            buttons.push(
                new ButtonBuilder()
                .setCustomId(name)
                .setStyle(ButtonStyle.Primary)
                .setLabel(formattedName)
                .setEmoji(emojis[name])
            );
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## ${formattedName} \n**Processing:** ${queuePeople.currentPerson.length} People (Max is ${maxUsage})\n**Queueing:** ${queuePeople.queue.length} People`)
            );
        }

        buttons.push(
            new ButtonBuilder()
            .setCustomId('puppeteer')
            .setStyle(ButtonStyle.Primary)
            .setLabel('Puppeteer')
            .setEmoji(emojis.x)
        );

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## Puppeteer Queue \n**Processing:** ${puppetQueue.pending} Browsers (Max is ${puppetQueue.concurrency})\n**Queueing:** ${puppetQueue.size} Browsers`)
        );

        container.addActionRowComponents(...seperateIntoRows(buttons));

        const message_sent = await interaction.reply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container],
            fetchReply: true
        });
        
        const collector = message_sent.createMessageComponentCollector({
            componentType: ComponentType.Button
        });

        collector.on('collect', async (buttonInteraction) => {
            await buttonInteraction.deferUpdate({ flags: MessageFlags.Ephemeral });
            const platformName = buttonInteraction.customId;
            const platformNameFormatted = formatSubject(platformName);
            let container;
            if (platformName === 'puppeteer') {
                container = new ContainerBuilder()
                    .setAccentColor(colours.onyx)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`## Puppeteer Queue \n**Processing:** ${puppetQueue.pending} Browsers (Max is ${puppetQueue.concurrency})\n**Queueing:** ${puppetQueue.size} Browsers`)
                    )
                    .addActionRowComponents(
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('change_queue_size')
                                .setStyle(ButtonStyle.Primary)
                                .setLabel('Change Queue Size')
                                .setEmoji(emojis.x)
                        )
                    );
            } else {
                const platformQueue = allQueues.get(platformName);
                const queuePeople = await (platformQueue).getPeople();

                let text = `## ${platformNameFormatted}\n### **Processing**`;
                for (const person of queuePeople.currentPerson) {
                    text += `\n${person.interaction.user}`;
                }

                text += `\n### **Queueing**`;
                queuePeople.queue.forEach((value) => {
                    text += `\n${value.interaction.user}`;
                });

                container = new ContainerBuilder()
                    .setAccentColor(colours[platformName])
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(text)
                    )
                    .addActionRowComponents(
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('force_queue')
                                .setStyle(ButtonStyle.Danger)
                                .setLabel('Force Queue')
                                .setEmoji(emojis.bin),
                            new ButtonBuilder()
                                .setCustomId('change_queue_size')
                                .setStyle(ButtonStyle.Primary)
                                .setLabel('Change Queue Size')
                                .setEmoji(emojis.x)
                        )
                    );
            }

            const message_sent = await interaction.followUp({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [container],
                fetchReply: true
            });

            const collectorQ = message_sent.createMessageComponentCollector({
                componentType: ComponentType.Button
            });

            collectorQ.on('collect', async (queueInteraction) => {
                if (queueInteraction.customId === 'force_queue') {  
                    await queueInteraction.deferUpdate({ flags: MessageFlags.Ephemeral });              
                    const container = new ContainerBuilder()
                        .setAccentColor(colours[platformName])
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`## All the People Processing Pushed Out!\n**${platformQueue.lockPerson.length}** people that were being processed have been pushed out of the queue!`)
                        );
                    const platformQueue = allQueues.get(platformName);
                    platformQueue.lockPerson = [];
                    await interaction.followUp({
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                        components: [container],
                        fetchReply: true
                    });
                } else if (queueInteraction.customId === 'change_queue_size') {
                    const modal = new ModalBuilder()
                        .setCustomId(`queues_changeSize_(${platformName})`)
                        .setTitle('Queue Change Size');

                    const cookieInput = new TextInputBuilder()
                        .setCustomId('size')
                        .setLabel('Queue Size')
                        .setStyle(TextInputStyle.Short);

                    modal.addComponents(new ActionRowBuilder().addComponents(cookieInput));
                    await queueInteraction.showModal(modal);
                }
            });
        });
	},
};