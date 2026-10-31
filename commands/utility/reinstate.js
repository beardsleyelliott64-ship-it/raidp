const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { isolation_role } = require('../../config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reinstate')
        .setDescription('Remove someones isolation role')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to reinstate')
                .setRequired(true)
        ),

    async execute(interaction) {
        const isolationId = isolation_role;
        const user = interaction.options.getMember('user');

        const isolationRole = interaction.guild.roles.cache.get(isolationId);
        if (!isolationRole) {
            return interaction.reply({
                content: "``❌`` The lifetime role ID in the config is invalid.",
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            await user.roles.remove(isolationRole);
            return interaction.reply({
                content: `\`\`✅\`\` Successfully reinstated ${user}!`
            });
        } catch (err) {
            console.error(err);
            return interaction.reply({
                content: "``❌`` I couldn't assign the role. Make sure my role is above the target role!",
                flags: MessageFlags.Ephemeral
            });
        }
    },
};
