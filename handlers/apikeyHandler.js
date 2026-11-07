const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { updateDB, getFromDB } = require('../database/general');
const removeDuplicates = require('../utils/removeDuplicates');
const { colours } = require('../config.json');
const { updateSettingsEmbed } = require('../generic/updateSettingsEmbeds.js');

async function handleApiKeyRequest(interaction) {
    if (interaction.customId === 'changeSettings_general_add_apikey') {
        const existingApiKeys = (await getFromDB('accounts', 'discord_id', interaction.user.id, 'apikeys')).apikeys;
        const apikey = interaction.fields.getTextInputValue('apikey').trim();
        if (!(apikey.startsWith('AIzaSy')) || (apikey.length !== 39)) {
            const container = new ContainerBuilder()
                .setAccentColor(colours.light_red)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`## API Key Invalid\nYour API Key is invalid. Please make sure it is a Gemini API Key.`)
                );

            await interaction.followUp({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [container]
            });
            return;
        }

        const newKeys = removeDuplicates([...existingApiKeys, apikey]);
        await updateDB('accounts', {apikeys: newKeys}, 'discord_id', interaction.user.id);

        const container = new ContainerBuilder()
            .setAccentColor(colours.light_green)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`## API Key Added Successfully\nYour API Key has been successfully added!`)
            );

        await interaction.followUp({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container]
        });

        await updateSettingsEmbed(interaction, 'general');
    }
}

module.exports = { handleApiKeyRequest };