const { SlashCommandBuilder, TextInputStyle, ModalBuilder, MessageFlags, TextInputBuilder, ComponentType, ButtonBuilder, ButtonStyle, ActionRowBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { checkAccount } = require('../../database/accounts');
const { emojis, colours } = require('../../config.json');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('get_account')
		.setDescription('Get the account of someone')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to get the account of')
                .setRequired(true)
        ),
	async execute(interaction) {
        const user = interaction.options.getMember('user');
        const account = await checkAccount(user.id);
        const seperator = new SeparatorBuilder({
            spacing: SeparatorSpacingSize.Small
        });

        if (account) {
            let totalUses = 0;
            for (const platform of Object.values(account.total_usage)) {
                totalUses += platform.total_uses;
            }

            let usages = '';
            for (const [platform, usage] of Object.entries(account.uses)) {
                usages += `${platform.charAt(0).toUpperCase() + platform.slice(1)}: ${usage.length}/${account.slots}\n`;
            }

            const statsBtn = new ButtonBuilder()
                .setCustomId('set_slots')
                .setLabel('Set Slots')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(emojis.settings);

            const row = new ActionRowBuilder().addComponents(statsBtn);
            
            const container = new ContainerBuilder()
                .setAccentColor(colours.onyx)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## <@${user.id}>'s Account\n**Total Usage**: You have used the bot a total of **${totalUses}** times.\n**Slots Limit**: You have an account slots limit of **${account.slots}**.\n**Account Rank**: Your current account rank is **${account.license ?? 'None'}**.\n### Account Slots (Last 24 Hours)\n\`\`\`js\n${usages || 'No slots used in the past 24 Hours'}\`\`\``)
                ).addSeparatorComponents(
                    seperator
                )
                .addActionRowComponents(
                    row
                );

            await interaction.reply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [container]
            });

            const message_sent = await interaction.fetchReply();
            
            const collector = message_sent.createMessageComponentCollector({
                componentType: ComponentType.Button
            });

            collector.on('collect', async (buttonInteraction) => {
                if (buttonInteraction.customId === 'set_slots') {
                    const modal = new ModalBuilder()
                        .setCustomId(`set_slots_${user.id}`)
                        .setTitle('Set Slots');

                    const schoolInput = new TextInputBuilder()
                        .setCustomId('slots')
                        .setLabel("Slots")
                        .setStyle(TextInputStyle.Short);
 
                    modal.addComponents(new ActionRowBuilder().addComponents(schoolInput));

                    await buttonInteraction.showModal(modal);
                }
            });
        } else {

            const container = new ContainerBuilder()
                .setAccentColor(colours.onyx)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## No Account\nThe user has no account`)
                );

            await interaction.reply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [container]
            });
        }
	},
};
