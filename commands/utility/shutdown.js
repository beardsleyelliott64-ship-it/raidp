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

        // Mark down immediately so every subsequent button/command gets the red ephemeral
        client.botDown = true;
        global.botDown = true;

        const container = new ContainerBuilder()
            .setAccentColor(colours.light_red ?? 0xed4245)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `## Shutting Down…\n` +
                    `The bot is shutting down **${forced ? 'forced' : 'graciously'}**.\n` +
                    `All dashboard buttons and UI actions will reply with a down notice until restart.`
                )
            );

        await interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });

        try { await setDownStatusChannel(client); } catch (e) { console.error('[shutdown] status channel', e); }

        try {
            const downChannel = await client.channels.fetch(down_channel);
            await downChannel.permissionOverwrites.edit(base_role, { ViewChannel: true });
        } catch (e) { console.error('[shutdown] down channel', e); }

        try {
            const imageSolver = await client.channels.fetch(image_solver);
            await imageSolver.permissionOverwrites.edit(base_role, { ViewChannel: false });
        } catch (e) { console.error('[shutdown] image solver', e); }

        for (const channel of Object.values(channels || {})) {
            try {
                const tchannel = await client.channels.fetch(channel);
                await tchannel.permissionOverwrites.edit(base_role, { ViewChannel: false });
            } catch (e) { console.error('[shutdown] channel', channel, e); }
        }

        if (!forced) {
            try {
                await Promise.allSettled(
                    [...(Queues?.values?.() ?? [])].map(q => q.shutdown?.())
                );
            } catch (e) { console.error('[shutdown] queues', e); }
        }

        try {
            await sendShutdownWebhook(`Shutdown from the /shutdown command, initiated by ${interaction.user}`);
        } catch (e) { console.error('[shutdown] webhook', e); }

        // Grace window so the down flag is live for any in-flight button clicks,
        // then terminate. forced = shorter grace.
        const graceMs = forced ? 1500 : 8000;
        setTimeout(() => {
            try {
                process.kill(process.ppid, 'SIGTERM');
            } catch {
                process.exit(0);
            }
        }, graceMs);
	},
};
