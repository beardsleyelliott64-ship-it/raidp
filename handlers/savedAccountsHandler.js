const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ContainerBuilder, TextDisplayBuilder, StringSelectMenuOptionBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const { checkAccounts, deleteAccounts, addAccount } = require('../database/saved_accounts');
const { checkAccount } = require('../database/accounts');
const hashCompare = require('../utils/hashCompare');
const { name, colours } = require('../config.json');
const seperateParentChild = require('../utils/seperateParentChild');
const processLogin = require('../generic/processLogin.js');

// Extract platform from the interaction customId.
// loginHandler sets saved-accounts button customId as `${fullPlatform}_savedAccounts_view`
// e.g. "sparx(maths)_savedAccounts_view" — platform is everything before the first "_savedAccounts"
function extractPlatformFromCid(customId) {
    const marker = '_savedAccounts';
    const idx = customId.indexOf(marker);
    if (idx !== -1) return customId.slice(0, idx);
    // Fallback: "view_saved_accounts_<platform>" from modal customId
    const parts = customId.split('_');
    return parts[3] ?? parts[parts.length - 1];
}

async function handleSavedAccounts(interaction, action, platform) {
    if (action === 'view') {
        const account = await checkAccount(interaction.user.id);

        if (!account.master_password) {
            await interaction.deferUpdate();
            return await executeViewAccounts(interaction, platform);
        }

        const modal = new ModalBuilder()
            .setCustomId('view_saved_accounts_' + platform)
            .setTitle('Saved Accounts Login');

        const passwordInput = new TextInputBuilder()
            .setCustomId('master_password')
            .setLabel('Master Password')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(passwordInput));
        await interaction.showModal(modal);

    } else if (action === 'delete') {
        await deleteAccounts(interaction.user.id);

        const container = new ContainerBuilder()
            .setAccentColor(colours.onyx)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# Accounts Deleted\nAll accounts saved by you have been deleted!`)
            );

        await interaction.reply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container]
        });
    }
}

// Called after modal submit (has master_password field) OR directly (no password required).
// `platform` is now passed explicitly so we don't rely on customId parsing.
async function executeViewAccounts(interaction, platformOverride) {
    const master_password = interaction.fields
        ? interaction.fields.getTextInputValue('master_password')
        : '';

    // Determine platform: use override when available, else parse from modal customId
    const platform = platformOverride ?? extractPlatformFromCid(interaction.customId);
    const platValue = seperateParentChild(platform);

    const accounts = await checkAccounts(interaction.user.id, master_password);

    if (accounts === false) {
        const container = new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# Incorrect Password\nThe master password was wrong.`)
            );
        await _reply(interaction, container);
        return;
    }

    if (!accounts || !accounts.length) {
        const container = new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# No Accounts Saved\nYou have no saved accounts yet.`)
            );
        await _reply(interaction, container);
        return;
    }

    const accountsView = [];
    const select = new StringSelectMenuBuilder()
        .setCustomId(`autocompleterModule_${platform}_loginSaved`)
        .setPlaceholder('Choose a saved account…');

    for (const account of accounts) {
        // Match on parent platform (e.g. 'sparx') since app is stored as parent
        if (account?.app === platValue.parent) {
            const label = account.username?.slice(0, 100) || 'Account';
            const option = new StringSelectMenuOptionBuilder()
                .setLabel(label)
                .setValue(account.username);
            select.addOptions(option);
            accountsView.push(account);
        }
    }

    if (!select.options.length) {
        const container = new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# No Accounts for This Platform\nYou have no saved accounts for **${platValue.parent}**.`)
            );
        await _reply(interaction, container);
        return;
    }

    const row = new ActionRowBuilder().addComponents(select);

    const container = new ContainerBuilder()
        .setAccentColor(colours.onyx)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# Saved Accounts\nSelect an account to log in as.`)
        );

    const message_sent = await interaction.editReply({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [container, row]
    });

    let interactedWith = false;
    const collector = message_sent.createMessageComponentCollector({ time: 600_000 });

    collector.on('collect', async (componentInteraction) => {
        if (interactedWith) return;
        interactedWith = true;

        // Acknowledge immediately so Discord doesn't show "interaction failed"
        // processLogin calls deferUpdate internally, so we skip it here.
        const chosen = accountsView.find(a => a.username === componentInteraction.values[0]);
        if (!chosen) {
            await componentInteraction.deferUpdate();
            return;
        }

        componentInteraction.loginDetails = chosen;

        const login        = require(`../autocompleters/${platValue.parent}/login.js`);
        const getTokenRequest = require(`../autocompleters/${platValue.parent}/getTokenRequest.js`);
        const menu         = require(`../autocompleters/${platValue.parent}/menu.js`);

        let userSessions;
        if (!platValue.child) {
            userSessions = require(`../autocompleters/${platValue.parent}/userSessions.js`);
        } else {
            userSessions = require(`../autocompleters/${platValue.parent}/children/${platValue.child}/userSessions.js`);
        }

        await processLogin(componentInteraction, platValue.parent, login, getTokenRequest, userSessions, menu);
    });
}

async function saveAccount(interaction) {
    const master_password = interaction.fields.getTextInputValue('master_password');
    const account = await checkAccount(interaction.user.id);

    let passwordCorrect = false;
    if (account.master_password === null) {
        if (!master_password) passwordCorrect = true;
    } else {
        if (await hashCompare(master_password, account.master_password)) passwordCorrect = true;
    }

    if (!passwordCorrect) {
        const container = new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# Incorrect Password\nThe password you entered was wrong.`));
        await interaction.followUp({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [container] });
        return;
    }

    // platform from modal customId "save_account_<platform>"
    const platform  = interaction.customId.split('_')[2];
    const platValue = seperateParentChild(platform);

    let allAccounts = await checkAccounts(interaction.user.id, master_password) ?? [];
    if (allAccounts === false) {
        const container = new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# Decryption Error\nCould not decrypt accounts despite correct password.`));
        await interaction.followUp({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [container] });
        return;
    }

    const accounts = allAccounts.filter(v => v.app === platValue.parent);

    let userSessions;
    if (!platValue.child) {
        userSessions = require(`../autocompleters/${platValue.parent}/userSessions`);
    } else {
        userSessions = require(`../autocompleters/${platValue.parent}/children/${platValue.child}/userSessions`);
    }

    const loginDetails = userSessions.get(interaction.user.id)?.loginDetails;
    if (!loginDetails) {
        const container = new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# Session Error\nCould not find your active session to save.`));
        await interaction.followUp({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [container] });
        return;
    }

    if (accounts.length >= 25) {
        const container = new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# Limit Reached\nYou can have at most 25 saved accounts.`));
        await interaction.followUp({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [container] });
        return;
    }

    if (accounts.some(u => u.username === loginDetails.username)) {
        const container = new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# Already Saved\nThat account is already in your saved list.`));
        await interaction.followUp({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [container] });
        return;
    }

    await addAccount(interaction.user.id, loginDetails, master_password);

    const container = new ContainerBuilder()
        .setAccentColor(colours.light_green)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# Account Saved\nYour account has been saved to ${name}!`));
    await interaction.followUp({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [container] });
}

// Helper — use editReply if deferred/replied, else reply
async function _reply(interaction, container) {
    const opts = { flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [container] };
    if (interaction.deferred || interaction.replied) {
        await interaction.editReply(opts);
    } else {
        await interaction.followUp(opts);
    }
}

module.exports = { handleSavedAccounts, executeViewAccounts, saveAccount };
