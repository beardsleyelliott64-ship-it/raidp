// language: JavaScript, file: handlers/savedAccountsHandler.js
const {
    ContainerBuilder, TextDisplayBuilder, StringSelectMenuOptionBuilder,
    StringSelectMenuBuilder, ActionRowBuilder, MessageFlags,
} = require('discord.js');
const { checkAccounts, deleteAccounts, addAccount } = require('../database/saved_accounts');
const { checkAccount } = require('../database/accounts');
const hashCompare       = require('../utils/hashCompare');
const { name, colours } = require('../config.json');
const seperateParentChild = require('../utils/seperateParentChild');
const processLogin        = require('../generic/processLogin.js');

async function handleSavedAccounts(interaction, action, platform) {
    if (action === 'delete') {
        await deleteAccounts(interaction.user.id);
        const container = new ContainerBuilder()
            .setAccentColor(colours.onyx)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# Accounts Deleted\nAll your saved accounts have been removed.`));
        await interaction.reply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [container] });
    }
}

// Called from index.js after modal submit (view_saved_accounts_<platform>)
// At this point interaction is already deferReply'd in index.js
async function executeViewAccounts(interaction, platformOverride) {
    // Password from modal fields (blank if no master password set)
    const master_password = interaction.fields
        ? (interaction.fields.fields.has('master_password')
            ? interaction.fields.getTextInputValue('master_password')
            : '')
        : '';

    const platform  = platformOverride ?? extractPlatformFromCid(interaction.customId);
    const platValue = seperateParentChild(platform);
    const accounts  = await checkAccounts(interaction.user.id, master_password);

    if (accounts === false) {
        return _send(interaction, new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# Incorrect Password\nThe master password you entered was wrong.`))
        );
    }

    if (!accounts || !accounts.length) {
        return _send(interaction, new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# No Saved Accounts\nYou haven't saved any accounts yet.`))
        );
    }

    const matching = accounts.filter(a => a?.app === platValue.parent);

    if (!matching.length) {
        return _send(interaction, new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# No Accounts for This Platform\nYou have no saved accounts for **${platValue.parent}**.`))
        );
    }

    const select = new StringSelectMenuBuilder()
        .setCustomId(`autocompleterModule_${platform}_loginSaved`)
        .setPlaceholder('Choose a saved account…');

    for (const acct of matching) {
        const label = (acct.username ?? 'Account').slice(0, 100);
        select.addOptions(new StringSelectMenuOptionBuilder().setLabel(label).setValue(acct.username));
    }

    const container = new ContainerBuilder()
        .setAccentColor(colours.onyx)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# Saved Accounts\nSelect an account to log in as.`));

    const msg = await interaction.editReply({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [container, new ActionRowBuilder().addComponents(select)],
    });

    let used = false;
    const collector = msg.createMessageComponentCollector({ time: 600_000 });

    collector.on('collect', async (ci) => {
        if (used) return;
        used = true;
        const chosen = matching.find(a => a.username === ci.values[0]);
        if (!chosen) { await ci.deferUpdate(); return; }

        ci.loginDetails = chosen;

        const login           = require(`../autocompleters/${platValue.parent}/login.js`);
        const getTokenRequest = require(`../autocompleters/${platValue.parent}/getTokenRequest.js`);
        const menu            = require(`../autocompleters/${platValue.parent}/menu.js`);
        const userSessions    = platValue.child
            ? require(`../autocompleters/${platValue.parent}/children/${platValue.child}/userSessions.js`)
            : require(`../autocompleters/${platValue.parent}/userSessions.js`);

        await processLogin(ci, platValue.parent, login, getTokenRequest, userSessions, menu);
    });
}

async function saveAccount(interaction) {
    const master_password = interaction.fields.getTextInputValue('master_password');
    const account         = await checkAccount(interaction.user.id);

    let ok = false;
    if (!account.master_password) {
        ok = !master_password;
    } else {
        ok = await hashCompare(master_password, account.master_password);
    }

    if (!ok) {
        return interaction.followUp({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [new ContainerBuilder()
                .setAccentColor(colours.light_red)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# Incorrect Password`))],
        });
    }

    const platform  = interaction.customId.split('_')[2];
    const platValue = seperateParentChild(platform);
    let all = await checkAccounts(interaction.user.id, master_password) ?? [];
    if (all === false) {
        return interaction.followUp({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [new ContainerBuilder()
                .setAccentColor(colours.light_red)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# Decryption Error`))],
        });
    }

    const existing = all.filter(v => v.app === platValue.parent);

    const userSessions = platValue.child
        ? require(`../autocompleters/${platValue.parent}/children/${platValue.child}/userSessions`)
        : require(`../autocompleters/${platValue.parent}/userSessions`);

    const loginDetails = userSessions.get(interaction.user.id)?.loginDetails;
    if (!loginDetails) {
        return interaction.followUp({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [new ContainerBuilder()
                .setAccentColor(colours.light_red)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# Session Error\nNo active session found.`))],
        });
    }

    if (existing.length >= 25) {
        return interaction.followUp({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [new ContainerBuilder()
                .setAccentColor(colours.light_red)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# Limit Reached\nMax 25 saved accounts.`))],
        });
    }

    if (existing.some(u => u.username === loginDetails.username)) {
        return interaction.followUp({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [new ContainerBuilder()
                .setAccentColor(colours.light_red)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# Already Saved\nThis account is already in your list.`))],
        });
    }

    await addAccount(interaction.user.id, loginDetails, master_password);
    await interaction.followUp({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [new ContainerBuilder()
            .setAccentColor(colours.light_green)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# Account Saved ✅\nYour account has been saved to ${name}!`))],
    });
}

function extractPlatformFromCid(customId) {
    const marker = '_savedAccounts';
    const idx    = customId.indexOf(marker);
    if (idx !== -1) return customId.slice(0, idx);
    const parts = customId.split('_');
    return parts[3] ?? parts[parts.length - 1];
}

async function _send(interaction, container) {
    const opts = { flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [container] };
    if (interaction.deferred || interaction.replied) return interaction.editReply(opts);
    return interaction.followUp(opts);
}

module.exports = { handleSavedAccounts, executeViewAccounts, saveAccount };
