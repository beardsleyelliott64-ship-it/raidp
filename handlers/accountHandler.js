const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { checkAccount, addToDb } = require('../database/accounts');
const { updateDB } = require('../database/general');
const whatRole = require('../utils/whatRole');
const config = require('../config.json');
const queueRanksPositions = config.queue_ranks;
const hash = require('../utils/hash');
const hashCompare = require('../utils/hashCompare');
const { name, colours } = require('../config.json');

async function useUpSlot(interaction, parent, accountId, child) {
    if (!child) child = parent;
    const account = await checkAccount(interaction.user.id);
    if (config.require_mainaccounts && await hashCompare(accountId, account.main_accounts[parent])) {

    } else {
        const platformUsesAccounts = account.uses[child] ?? [];
        let accountAlreadyUsed = false;
        for (const accountUsed of platformUsesAccounts) {
            if (await hashCompare(accountId, accountUsed)) {
                accountAlreadyUsed = true;
                break;
            }
        }

        if (!accountAlreadyUsed) {
            platformUsesAccounts.push(await hash(accountId));
            account.uses[child] = platformUsesAccounts;

            await updateDB('accounts', { uses: account.uses }, 'discord_id', interaction.user.id);
        }
    }
}

async function validAccount(interaction, platform) {
    // Acknowledge the Discord button immediately. Supabase can take longer than
    // Discord's 3-second interaction window, so defer before doing database work.
    if (!interaction.replied && !interaction.deferred) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    let account;
    try {
        const roleID = whatRole(await interaction.guild.members.fetch(interaction.user.id));
        const userRole = Object.keys(queueRanksPositions).find(key => queueRanksPositions[key] === roleID) ?? null;
        account = await checkAccount(interaction.user.id, userRole);
    } catch (error) {
        console.error('[account] Account lookup failed:', error);
        const missingTable = /Could not find the table ['\"]public\.accounts['\"]|relation ['\"]?accounts['\"]? does not exist/i.test(error.message || '');
        const message = missingTable
            ? '# Database Setup Required\nThe Supabase `accounts` table has not been created yet. Run the SQL in `supabase-setup.sql` in your Supabase SQL Editor, then restart the bot.'
            : `# Database Error\n${error.message || 'Unable to check your account right now.'}`;
        await interaction.editReply({ content: message, components: [] });
        return true;
    }

    if (!account) {

        const container = new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# No Account Found\nYou do not have a ${name} Account. Please create one by doing \`/account\` and then configuring the main account for this platform.`)
            );

        await interaction.editReply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container]
        });

        return true;
    } else if (config.require_mainaccounts && !account.main_accounts[platform]) {
        const container = new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(
               new TextDisplayBuilder().setContent(`# No Main Account Found for this Platform\nYou do not have a Main Account for this platform configured. Please configure one by doing it in the \`/account\` menu.`)
            );

        await interaction.editReply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container]
        });

        return true;
    }
}

async function createAccount(interaction) {
    await interaction.deferUpdate({ flags: MessageFlags.Ephemeral});
    const master_password = interaction.fields.getTextInputValue('master_password');

    const userId = interaction.user.id;
    const roleID = whatRole(await interaction.guild.members.fetch(userId));
    const userRole = Object.keys(queueRanksPositions).find(key => queueRanksPositions[key] === roleID);

    const accountCreated = await addToDb(userId, await hash(master_password), userRole);

    if (!accountCreated) {
        const container = new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# Account already Exists\nYou already have a ${name} account.`)
            );

        await interaction.followUp({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container]
        });
        return;
    }

    const container = new ContainerBuilder()
        .setAccentColor(colours.light_green)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# Account Created\nYour ${name} account has been successfully created!`)
        );

    await interaction.followUp({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [container]
    });
}

module.exports = { createAccount, validAccount, useUpSlot };