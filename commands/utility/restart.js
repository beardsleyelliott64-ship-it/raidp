const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('restart')
        .setDescription('Restarts the bot (ADMIN ONLY)'),
    async execute(interaction, client) {
        await interaction.reply('Restarting the bot...');
        await client.destroy();
        setTimeout(() => process.exit(0), 1000);
    }
};
