// language: JavaScript, file: commands/utility/updpfp.js
// /upd-pfp — force update bot username, avatar, and banner (admin only)
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const fs   = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('upd-pfp')
        .setDescription('Force update the bot username, avatar, and banner. Admin only.'),

    async execute(interaction) {
        const isAdmin = interaction.memberPermissions?.has('Administrator') || interaction.user.id === interaction.guild?.ownerId;
        if (!isAdmin) {
            return interaction.reply({ content: '❌ Admins only.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const BOT_NAME   = process.env.BOT_NAME || 'Phantom';
        const logoPath   = path.join(__dirname, '..', '..', 'web', 'public', 'logo.gif');
        const bannerPath = path.join(__dirname, '..', '..', 'web', 'public', 'banner.gif');
        const results    = [];

        // ── Username ──────────────────────────────────────────────────────────
        try {
            await interaction.client.user.edit({ username: BOT_NAME });
            results.push(`✅ Username → **${BOT_NAME}**`);
        } catch (err) {
            results.push(`⚠️ Username failed: ${err.message}`);
        }

        // ── Avatar ────────────────────────────────────────────────────────────
        if (fs.existsSync(logoPath)) {
            try {
                const avatarData = `data:image/gif;base64,${fs.readFileSync(logoPath).toString('base64')}`;
                await interaction.client.user.edit({ avatar: avatarData });
                results.push(`✅ Avatar set`);
            } catch (err) {
                results.push(`⚠️ Avatar failed: ${err.message}`);
            }
        } else {
            results.push(`⚠️ Avatar skipped — logo.gif not found in web/public`);
        }

        // ── Banner ────────────────────────────────────────────────────────────
        if (fs.existsSync(bannerPath)) {
            try {
                const bannerData = `data:image/gif;base64,${fs.readFileSync(bannerPath).toString('base64')}`;
                await interaction.client.user.edit({ banner: bannerData });
                results.push(`✅ Banner set`);
            } catch (err) {
                results.push(`⚠️ Banner failed: ${err.message}`);
            }
        } else {
            results.push(`⚠️ Banner skipped — banner.gif not found in web/public`);
        }

        await interaction.editReply({ content: results.join('\n') });
    },
};
