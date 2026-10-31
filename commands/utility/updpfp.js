// language: JavaScript, file: commands/utility/updpfp.js
// /upd-pfp — manually force bot avatar + username update (admin only)
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const fs   = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('upd-pfp')
        .setDescription('Force update the bot avatar and username. Admin only.'),

    async execute(interaction) {
        // Admin guard — check for admin role or server owner
        const isAdmin = interaction.memberPermissions?.has('Administrator') || interaction.user.id === interaction.guild?.ownerId;
        if (!isAdmin) {
            return interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const updates = {};
        const BOT_NAME = process.env.BOT_NAME || 'Phantom';
        updates.username = BOT_NAME;

        const logoPath = path.join(__dirname, '..', '..', 'web', 'public', 'logo.gif');
        if (fs.existsSync(logoPath)) {
            const buf = fs.readFileSync(logoPath);
            updates.avatar = `data:image/gif;base64,${buf.toString('base64')}`;
        } else {
            await interaction.editReply({ content: '❌ logo.gif not found in web/public.' });
            return;
        }

        try {
            await interaction.client.user.edit(updates);
            await interaction.editReply({ content: `✅ Bot updated — username: **${BOT_NAME}**, avatar set.` });
        } catch (err) {
            await interaction.editReply({ content: `❌ Update failed: ${err.message}\n\nDiscord limits username changes to 2/hour — try again in a bit.` });
        }
    },
};
