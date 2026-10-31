const { ComponentType, ButtonBuilder, ButtonStyle, ActionRowBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { addMainAccount, checkDuplicatesMainAccounts, removeMainAccount } = require('../database/accounts');
const { emojis, support_channel, colours } = require('../config.json');
const hash = require('../utils/hash');
const getFile = require('../utils/getFile.js');
const loginWrapper = require('../utils/loginWrapper.js');
const getFunctionParams = require('../utils/getFunctionParams.js');

function getModalFieldSafe(interaction, fieldId, type = 'text') {
    try {
        if (type === 'text') {
            return interaction.fields.getTextInputValue(fieldId);
        } else if (type === 'select') {
            const field = interaction.fields.getField(fieldId);
            return field?.values[0] ?? null;
        } else {
            return null;
        }
    } catch (err) {
        if (err.code === 'ModalSubmitInteractionFieldNotFound') return null;
        throw err;
    }
}

async function notHasEverything(interaction, parametersRequired, parametersGiven) {
    for (const param of parametersRequired) {
        if (!parametersGiven[param]) {
            const container = new ContainerBuilder()
                .setAccentColor(colours.light_red)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# Missing Input\nThe service requires ${param} and you have not included it in your input.`)
                );

            await interaction.editReply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [container]
            });

            return true;
        }
    }

    return false;
}

async function mainAccountLogin(interaction, deleteAccount = false) {
    const school = getModalFieldSafe(interaction, 'school');
    const username = getModalFieldSafe(interaction, 'username');
    const password = getModalFieldSafe(interaction, 'password');
    const type = getModalFieldSafe(interaction, 'type', 'select'); // select menu
    const platform = getModalFieldSafe(interaction, 'platform', 'select'); // select menu
    let cookie = getModalFieldSafe(interaction, 'cookie');
    const loginParametersGiven = {school, username, password, type};

    const container = new ContainerBuilder()
        .setAccentColor(colours.yellow)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# Logging In...\nThe bot is attempting to login into your account...`)
        );

    await interaction.reply({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [container]
    });
    try {

        let authToken;
        if (!cookie) {
            const loginPath = await getFile(platform, 'login.js');
            const login = require(loginPath);
            const loginParameters = getFunctionParams(login);
            if (await notHasEverything(interaction, loginParameters, loginParametersGiven)) return;
            const sessionResults = await loginWrapper(() => login(loginParametersGiven));
            authToken = sessionResults.authToken;
        } else {
            const tokenPath = await getFile(platform, 'getTokenRequest.js');
            const getTokenRequest = require(tokenPath);
            authToken = await getTokenRequest(cookie);
        }

        const Requesticator = require(`../autocompleters/${platform}/requesticator.js`);

        const requesticator = new Requesticator(authToken);
        const accountId = await requesticator.getAccountId();
        // console.log('Account id', accountId);

        /*
        } else if ('educake' === platform) {
            if (await notHasEverything(interaction, ['loginType'], parametersGiven)) return;
            const cookie = await educakeLogin(email, password, loginType, on2FA);
            const educake_Request = new Educake_Requesticator(cookie);
            const authToken = await educake_Request.sendRequest('https://my.educake.co.uk/session-token');
            educake_Request.sessionToken = authToken.accessToken;
            const userInfo = await educake_Request.sendRequest('https://my.educake.co.uk/api/me');
            accountId = String(userInfo.id);
        } else if ('drfrost' === platform) {
            if (await notHasEverything(interaction, ['loginType'], parametersGiven)) return;

            const token = await drfrostLogin(email, password, loginType, on2FA);
            const drfrostAuto = new drfrostAutocompleter(interaction, token);

            const userInfo = await drfrostAuto.getSelfInfo();
            accountId = String(userInfo.user.uid);
        */

        if (accountId) {
            if (deleteAccount) {
                const accountBelongsTo = await checkDuplicatesMainAccounts(platform, accountId, interaction.user.id, true);
                if (accountBelongsTo) {
                    const savedBtn = new ButtonBuilder()
                        .setCustomId("confirm")
                        .setLabel('Confirm')
                        .setEmoji(emojis.tick)
                        .setStyle(ButtonStyle.Success);

                    const row = new ActionRowBuilder().addComponents(savedBtn);

                    const container = new ContainerBuilder()
                        .setAccentColor(colours.yellow)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`# Confirmation\nAre you sure you want to delete the main account for ${platform} that belongs to <@${accountBelongsTo}> with Discord ID: \`\`${accountBelongsTo}\`\``)
                        )
                        .addActionRowComponents(
                            row
                        );

                    const replyMessage = await interaction.editReply({
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                        components: [container],
                        withResponse: true
                    });

                    const collector = replyMessage.createMessageComponentCollector({
                        componentType: ComponentType.Button
                    });

                    collector.on('collect', async (buttonInteraction) => {
                        await buttonInteraction.deferUpdate({ flags: MessageFlags.Ephemeral });
                        await removeMainAccount(accountBelongsTo, platform);

                        const container = new ContainerBuilder()
                            .setAccentColor(colours.light_green)
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`# Main Account Removed\nYou have successfully removed a main account!`)
                            );

                        await buttonInteraction.editReply({
                            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                            components: [container]
                        });
                    });
                } else {

                    const container = new ContainerBuilder()
                        .setAccentColor(colours.light_red)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`# No-one Owns This Main Account\nThe main account you are trying to remove doesn't belong to anybody.`)
                        );

                    await interaction.editReply({
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                        components: [container]
                    });
                }
                return;
            }

            if (await checkDuplicatesMainAccounts(platform, accountId, interaction.user.id)) {
                const container = new ContainerBuilder()
                    .setAccentColor(colours.light_red)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# Main Account Already Belongs to Someone\nThe main account you are trying to add already belongs to another account. Open a [ticket](${support_channel}) if you believe this to be a mistake.`)
                    );

                await interaction.editReply({
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                    components: [container]
                });

                return;
            }

            if (await addMainAccount(interaction.user.id, platform, await hash(accountId))) {

                const container = new ContainerBuilder()
                    .setAccentColor(colours.light_green)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# Main Account Added\nYou have successfully added a main account!`)
                    );

                await interaction.editReply({
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                    components: [container]
                });
            } else {
                const container = new ContainerBuilder()
                    .setAccentColor(colours.light_red)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# Account already Configured\nThe platform you are adding the main account to already has a main account configured for you. If you have just recently added a main account, please run /account again for it to show.`)
                    );

                await interaction.editReply({
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                    components: [container]
                });
            }
        } else {
            throw new Error('Unable to get account Id');
        }
    } catch {
        const container = new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# Failed to Login\nThe bot has failed to login.`)
            );

        await interaction.editReply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container]
        });
    }
}

module.exports = mainAccountLogin;