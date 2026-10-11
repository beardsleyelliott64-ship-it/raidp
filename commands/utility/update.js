const { SlashCommandBuilder } = require('discord.js');
const runGitPull = require('../../utils/gitPull');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('update')
		.setDescription('Update the bot'),
	async execute(interaction) {
		await interaction.reply('Updating the bot...');

		try {
			const result = await runGitPull();
			await interaction.editReply(
				`✅ Updated successfully.\n\`\`\`\n${result}\n\`\`\`\nRun \`/restart\` to apply changes.`
			);
		} catch (err) {
			await interaction.editReply(
				`❌ Update failed:\n\`\`\`\n${err.message}\n\`\`\``
			);
		}
	},
};