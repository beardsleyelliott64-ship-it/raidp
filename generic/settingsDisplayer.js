const { LabelBuilder, StringSelectMenuBuilder, ActionRowBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { checkAccount } = require('../database/accounts');
const getKnownFile = require('../utils/getKnownFile');
const { embeds } = require('./updateSettingsEmbeds');
const getContainer = require('./getSettingContainer');

function formatName(str) {
  if (!str.includes('_')) return str;

  const [first, ...rest] = str.split('_');
  return `${first}(${rest.join('_')})`;
}

async function settingsDisplayer(interaction, platformProvided) {
    const platform = platformProvided ?? interaction.fields.getField('platform').values[0];
    let settings;
    if (platform === 'general') {
        settings = require('../generalSettings.json');
    } else {
        settings = getKnownFile(platform, 'settings.json');
    }
    const account = await checkAccount(interaction.user.id);
    const storedSettings = account?.[`${platform}_settings`];
    const container = getContainer(settings, storedSettings || account || {});
    const message_sent = await interaction.editReply({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [container],
        fetchReply: true
    });

    embeds.set(interaction.user.id, interaction);
	const collector = message_sent.createMessageComponentCollector({
		time: 180_000
	});

    collector.on('collect', async (componentInteraction) => {
        if (componentInteraction.isButton()) {
            const settingBeingChanged = componentInteraction.customId;
            const settingData = settings.settings[settingBeingChanged];
            if (!settingData.inputs.length) {
                const genFunction = require(`./${platform}_${settingBeingChanged}.js`);
                await genFunction(interaction, componentInteraction);
                return;
            }

            const modal = new ModalBuilder()
                .setCustomId(`changeSettings_${formatName(platform)}_${settingBeingChanged}`)
                .setTitle(settingData.label);
            for (const input of settingData.inputs) {
                if (input.type === 'number' || input.type === 'text') {
                    const buttonInput = new TextInputBuilder()
                        .setCustomId(input.id)
                        .setLabel(input.label)
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder(input.placeholder);
                    modal.addComponents(new ActionRowBuilder().addComponents(buttonInput));
                } else if (input.type === 'choice') {
                    const choiceInput = new StringSelectMenuBuilder()
                        .setCustomId(input.id)
                        .setPlaceholder(input.placeholder)
                        .addOptions(
                            ...input.options
                        );

                    const label = new LabelBuilder({
                        label: settingData.label,
                        component: choiceInput
                    });

                    modal.addLabelComponents(label);
                }
            }
            await componentInteraction.showModal(modal);
        }
    });

    collector.on('end', async () => {
        const container = getContainer(settings, account?.[`${platform}_settings`] || account || {}, true);
        await interaction.editReply({
            components: [container]
        });
    });
}

module.exports = { settingsDisplayer };