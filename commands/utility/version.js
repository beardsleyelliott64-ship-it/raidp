const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { colours } = require('../../config.json');
const version = require('../../utils/version');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('version')
        .setDescription('Gets the version the bot is on'),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('Bot Version')
            .setColor(colours.bright_green)
            .addFields(
                { name: 'Commit', value: `\`${version.commitHash}\`` },
                { name: 'Message', value: version.commitMessage }
            )
            .setTimestamp()
            .setFooter({ text: 'Version info' });

        await interaction.reply({ embeds: [embed] });
    },
};