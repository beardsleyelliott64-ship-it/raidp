const { ContainerBuilder, MessageFlags, TextDisplayBuilder } = require('discord.js');
const { colours } = require('../config.json');
const { updateDB } = require('../database/general');
const { updateSettingsEmbed } = require('./updateSettingsEmbeds.js');

async function generalRemoveApiKeys(interaction, componentInteraction) {
    await updateDB('accounts', {apikeys: []}, 'discord_id', interaction.user.id);
    await componentInteraction.deferUpdate({ flags: MessageFlags.Ephemeral });
    const container = new ContainerBuilder()
        .setAccentColor(colours.light_red)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## API Keys Removed\nYour Api Keys has been successfully removed`)
        );

    await componentInteraction.followUp({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [container]
    });

    await updateSettingsEmbed(interaction, 'general');
}

module.exports = generalRemoveApiKeys;