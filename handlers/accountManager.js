const { ModalBuilder, LabelBuilder, MessageFlags, ButtonBuilder, ButtonStyle, ActionRowBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, SectionBuilder, StringSelectMenuOptionBuilder, StringSelectMenuBuilder } = require('discord.js');
const { checkAccount } = require('../database/accounts');
const { updateDB } = require('../database/general');
const { checkAccounts, updateSavedAccounts } = require('../database/saved_accounts');
const hash = require('../utils/hash');
const { emojis, colours } = require('../config.json');
const hashCompare = require('../utils/hashCompare');
const capitalise = require('../utils/capitalise');
const interactionStored = {};

async function changeSlots(interaction) {
    const userId = interaction.customId.split('_')[2];
    const slots = Number(interaction.fields.getTextInputValue('slots'));
    if (!Number.isFinite(slots)) return;
    await updateDB('accounts', { slots: slots, custom_slots: true}, 'discord_id', userId);

    const container = new ContainerBuilder()
        .setAccentColor(colours.onyx)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## Slots Set\nThe user's slots have been set to **${slots}**`)
        );

    await interaction.followUp({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [container]
    });
}

function getAccountEmbed(currentServiceSelected, select) {
    const deleteAllAccounts = new ButtonBuilder()
        .setCustomId('deleteAllAccounts')
        .setLabel('Delete All Accounts')
        .setEmoji(emojis.bin)
        .setStyle(ButtonStyle.Danger);

    const buttonRow = new ActionRowBuilder().addComponents(deleteAllAccounts);

    // 3. Assemble everything into the main container
    const container = new ContainerBuilder()
        .setAccentColor(colours.onyx)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# Accounts\n`))
        .addSectionComponents(
            new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`Selected Service: **${capitalise(currentServiceSelected)}**`))
                .setButtonAccessory(new ButtonBuilder().setLabel('🗂️ Service').setCustomId('service').setStyle(ButtonStyle.Primary))
        )
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`\n**Selecting an account will delete it from your saved accounts.**`))
        .addSeparatorComponents(new SeparatorBuilder({spacing: SeparatorSpacingSize.Small}));

    if (select.options.length) {
        container.addActionRowComponents(new ActionRowBuilder().addComponents(select));
    }

    container.addActionRowComponents(buttonRow);

    return container;
}

async function viewSavedAccounts(interaction) {
    const master_password = interaction.fields.getTextInputValue('master_password');
    const account = await checkAccount(interaction.user.id);
    if (await hashCompare(master_password, account.master_password)) {
        let accounts = await checkAccounts(interaction.user.id, master_password);

        if (!account.saved_accounts || !accounts.length) {
            const container = new ContainerBuilder()
                .setAccentColor(colours.light_red)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# No Accounts Saved\nYou have no accounts saved!`)
                );

            await interaction.followUp({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [container]
            });
            return;
        }


        const select = new StringSelectMenuBuilder()
            .setCustomId('account_selected')
            .setPlaceholder('Choose an account...');

        let accountsPerServices = {};

        for (const account of accounts) {
            const option = new StringSelectMenuOptionBuilder()
                .setLabel(account.username)
                .setValue(account.username);

            if (!accountsPerServices[account.app]) accountsPerServices[account.app] = [];
            accountsPerServices[account.app].push(account.username);

            select.addOptions(option);
        }

        let currentServiceSelected = Object.keys(accountsPerServices)[0];

        // 3. Assemble everything into the main container
        const container = getAccountEmbed(currentServiceSelected, select);
        interactionStored[interaction.user.id] = {};
        interactionStored[interaction.user.id].interaction = interaction;
        interactionStored[interaction.user.id].accounts = accountsPerServices;
        interactionStored[interaction.user.id].currentServiceSelected = currentServiceSelected;

        const message_sent = await interaction.followUp({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container]
        });

        const collector = message_sent.createMessageComponentCollector({});

        collector.on('collect', async (componentInteraction) => {
            if (componentInteraction.isButton()) {
                if (componentInteraction.customId === 'service') {
                    const modal = new ModalBuilder()
                        .setCustomId(`accountManager_service`)
                        .setTitle(`Service`);
                    const typeInput = new StringSelectMenuBuilder()
                        .setCustomId('type')
                        .setPlaceholder("Choose a Service")
                        .addOptions(Object.keys(accountsPerServices).map(serviceType => ({
                            label: capitalise(serviceType),
                            value: serviceType,
                            emoji: emojis[serviceType] || emojis.sparx
                        }))
                        );
                    const typeLabel = new LabelBuilder({
                        label: 'Service Type',
                        component: typeInput
                    });

                    modal.addLabelComponents(typeLabel);
                    await componentInteraction.showModal(modal);
                } else if (componentInteraction.customId === 'deleteAllAccounts') {
                    await componentInteraction.deferUpdate();
                    await updateDB('accounts', { saved_accounts: null }, 'discord_id', interaction.user.id);
                    const container = new ContainerBuilder()
                        .setAccentColor(colours.light_red)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`# Deleted All Accounts\nAll saved accounts have been deleted.`)
                        );

                    await interaction.editReply({
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                        components: [container]
                    });
                }
            } else if (componentInteraction.customId === 'account_selected') {
                await componentInteraction.deferUpdate();
                const accountSelected = componentInteraction.values[0];

                const currentType = interactionStored[interaction.user.id].currentServiceSelected;
                accountsPerServices[currentType] = accountsPerServices[currentType].filter(item => item !== accountSelected);
                const select = new StringSelectMenuBuilder()
                    .setCustomId('account_selected')
                    .setPlaceholder('Choose an account...');
                for (const account of accountsPerServices[currentType]) {
                    select.addOptions(account);
                }

                accounts = accounts.filter(item => item.username !== accountSelected);
                await updateSavedAccounts(interaction.user.id, accounts, master_password);

                await interaction.editReply({ components: [getAccountEmbed(currentType, select)] });
            }
        });
    } else {
        const container = new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# Password was Incorrect\nThe password to your saved accounts was incorrect!`)
            );

        await interaction.followUp({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container]
        });
    }
}

async function changeMasterPassword(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const master_password = interaction.fields.getTextInputValue('master_password');
    await updateDB('accounts', { master_password: await hash(master_password), saved_accounts: null }, 'discord_id', interaction.user.id);

    const container = new ContainerBuilder()
        .setAccentColor(colours.light_green)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# Master Password Changed\nYou have successfully changed your master password! All saved accounts have also been deleted.`)
        );

    await interaction.editReply({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [container]
    });
}

async function updateAccountInteraction(interaction) {
    const storedInteraction = interactionStored[interaction.user.id].interaction;
    const typeSelected = interaction.fields.getField('type').values[0];
    interactionStored[interaction.user.id].currentServiceSelected = typeSelected;

    const select = new StringSelectMenuBuilder()
        .setCustomId('account_selected')
        .setPlaceholder('Choose an account...');

    for (const account of interactionStored[interaction.user.id].accounts[typeSelected]) {
        const option = new StringSelectMenuOptionBuilder()
            .setLabel(account)
            .setValue(account);

        select.addOptions(option);
    }

    await storedInteraction.editReply({ components: [getAccountEmbed(typeSelected, select)] });
}

module.exports = { viewSavedAccounts, changeMasterPassword, updateAccountInteraction, changeSlots };