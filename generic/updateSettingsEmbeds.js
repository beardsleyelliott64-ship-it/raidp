const { MessageFlags } = require('discord.js');
const getContainer = require('./getSettingContainer');
const { checkAccount } = require('../database/accounts');
const embeds = new Map();
const getKnownFile = require('../utils/getKnownFile');

async function updateSettingsEmbed(interaction, platform) {
    let embedInteraction = embeds.get(interaction.user.id) ?? interaction;

    if (!embeds.has(interaction.user.id)) {
        embeds.set(interaction.user.id, interaction);
    }

    let settings;
    if (platform === 'general') {
        settings = require('../generalSettings.json');
    } else {
        settings = getKnownFile(platform, 'settings.json');
    }
    const account = await checkAccount(interaction.user.id);

    await embedInteraction.editReply({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [getContainer(settings, account?.[`${platform}_settings`] || account || {})],
        fetchReply: true
    });
}

module.exports = { updateSettingsEmbed, embeds };