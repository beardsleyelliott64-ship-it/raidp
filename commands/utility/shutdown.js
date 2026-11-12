const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { name, colours, channels, base_role, down_channel, image_solver } = require('../../config.json');
const setDownStatusChannel = require('../../utils/setDownStatusChannel');
const sendShutdownWebhook = require('../../utils/sendShutdownWebhook');
const Queues = require('../../queues/queues');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('shutdown')
		.setDescription('Shutdown the bot')
        .addBooleanOption(option =>
            option
                .setName('forced')
                .setDescription('If you want the shutdown to be instant')
                .setRequired(false)
        ),
	async execute(interaction, client) {
        const forced = interaction.options.getBoolean('forced') ?? false;
        const container = new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## Shutting Down...\nThe bot is shutting down **${forced ? 'forced' : 'graciously'}**!`)
            );

        await interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });

        await setDownStatusChannel(client);

        const downChannel = await client.channels.fetch(down_channel);

        await downChannel.permissionOverwrites.edit(base_role, {
            ViewChannel: true, 
        });

        const imageSolver = await client.channels.fetch(image_solver);

        await imageSolver.permissionOverwrites.edit(base_role, {
            ViewChannel: false, 
        });
        for (const channel of Object.values(channels)) {
            const tchannel = await client.channels.fetch(channel);

            await tchannel.permissionOverwrites.edit(base_role, {
                ViewChannel: false, 
            });
        }
        if (!forced) {
            await Promise.allSettled(
                [...Queues.values()].map(q => q.shutdown())
            );
        }
        await sendShutdownWebhook(`Shutdown from the /shutdown command, initated by ${interaction.user}`);
        process.kill(process.ppid, 'SIGTERM');
	},
};