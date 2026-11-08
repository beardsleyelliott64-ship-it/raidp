const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { colours } = require('../../config.json');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('credits')
		.setDescription('Credits for people who made the bot'),
    public: true,
	async execute(interaction) {

		const embed = new EmbedBuilder()
			.setColor(colours.blurple)
			.setTitle('✨ Credits')
			.addFields(
				{ name: '👨‍💻 Developer', value: '<@1187435043493257256>', inline: true },
				{ name: '🛠️ Github Link', value: 'https://github.com/DeterminedGeneral/Homework-Autocompleter/tree/main', inline: true },
				{ name: '💡 Discord Server', value: 'https://discord.gg/AaR6VjPDdc', inline: false }
			)
			.setTimestamp();

		await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
	},
};