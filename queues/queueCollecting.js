const { ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags} = require('discord.js');
const { emojis, colours } = require('../config.json');
const queues = require('../queues/queues.js');

function toSnakeCase(str) {
  return str
    .replace(/\((.*?)\)/, '_$1') // replace (science) with _science
    .toLowerCase();
}

async function queueCollector(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const queueToUse = queues.get(toSnakeCase(interaction.customId.split('_')[2]));
    const queuePeople = await queueToUse.getPeople();
    let userPosition = await queueToUse.checkQueue(interaction.user.id);
    const row = new ActionRowBuilder();

    if (userPosition === -1) {
        userPosition = 'not in the queue';
    } else if (userPosition === -2) {
        userPosition = 'using the autocompleter';
        const terminateButton = new ButtonBuilder()
            .setCustomId('terminate_session')
            .setLabel('Terminate Session')
            .setEmoji(emojis.exit_queue)
            .setStyle(ButtonStyle.Danger);

        row.addComponents(terminateButton);
    } else {
        userPosition = `position **${userPosition + 1}** in the queue`;
        const leaveQueueButton = new ButtonBuilder()
            .setCustomId('leave_queue')
            .setLabel('Leave Queue')
            .setEmoji(emojis.exit_queue)
            .setStyle(ButtonStyle.Danger);

        row.addComponents(leaveQueueButton);
    }

    const seperator = new SeparatorBuilder({
        spacing: SeparatorSpacingSize.Small
    });

    const container = new ContainerBuilder()
        .setAccentColor(colours.onyx)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`### Queue Status\nThere are **${queuePeople.queue.length}** people waiting in the queue. **${queuePeople.currentPerson.length}** people are using the autocompleter. You are ${userPosition}.`)
        );

    if (row.components.length) {
        container.addSeparatorComponents(
            seperator
        )
        .addActionRowComponents(
            row
        );
    }

    const message_sent = await interaction.editReply({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [container],
        fetchReply: true
    });

    const collector = message_sent.createMessageComponentCollector({
        componentType: ComponentType.Button
    });

    collector.on('collect', async (interaction) => {
        await interaction.deferUpdate({ flags: MessageFlags.Ephemeral });
        const section = new TextDisplayBuilder();

        const container = new ContainerBuilder();

        if (interaction.customId === 'terminate_session') {
            const sessionTerminated = await queueToUse.terminateSession(interaction.user.id);

            if (sessionTerminated) {
                section.setContent(`### Session Terminated\nYou have successfully terminated your current session with the autocompleter.`);
                container.setAccentColor(colours.light_red);
            } else {
                section.setContent(`### No ongoing Session\nYou have no ongoing session.`);
                container.setAccentColor(colours.blue);
            }
        } else if (interaction.customId === 'leave_queue') {
            const sessionTerminated = await queueToUse.removePerson(interaction.user.id);

            if (sessionTerminated) {
                section.setContent(`### Left Queue\nYou have successfully left the queue.`);
                container.setAccentColor(colours.light_red);
            } else {
                section.setContent(`### Not in Queue\nYou are not in the Queue.`);
                container.setAccentColor(colours.blue);
            }
        }

        container.addTextDisplayComponents(
            section
        );

        await interaction.followUp({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container]
        });
    });
}

module.exports = queueCollector;