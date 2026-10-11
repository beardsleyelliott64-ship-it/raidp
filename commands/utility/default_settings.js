const { SlashCommandBuilder } = require('discord.js');
const { setDefault } = require('../../database/accounts');
const platforms = require('../../utils/getAllAutocompletersNames');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('default_settings')
		.setDescription('Change everyone\'s settings to the default')
		.addStringOption(option => 
			option.setName('platform')
				.setDescription('The platform to reset settings for')
				.setRequired(true)
				.addChoices(
					// Dynamically map your array into the { name, value } format required by Discord
					...platforms.map(platform => ({
						// Formats 'sparx_maths' -> 'Sparx Maths' for the UI
						name: platform.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
						value: platform
					}))
				)
		),
	async execute(interaction) {
		// Get the option the user selected
		const selectedPlatform = interaction.options.getString('platform');

		// Defer the reply in case the database takes longer than 3 seconds to update
		await interaction.deferReply({ ephemeral: true });

		try {
			// Update the database dynamically based on their choice
			await setDefault('accounts', `${selectedPlatform}_settings`);
			
			// Send a success message
			await interaction.editReply(`Successfully reset the \`${selectedPlatform}\` settings to default for everyone!`);
		} catch (error) {
			console.error(error);
			await interaction.editReply('There was an error updating the settings in the database.');
		}
	},
};