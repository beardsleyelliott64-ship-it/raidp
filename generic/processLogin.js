const { MessageFlags, AttachmentBuilder, FileBuilder, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const loginWrapper = require('../utils/loginWrapper.js');
const { colours } = require('../config.json');

function getIfExists(fields, id) {
    return fields.fields.has(id)
        ? fields.getTextInputValue(id)
        : undefined;
}

async function processLogin(interaction, platform, login, getTokenRequest, userSessions, menu) {
    await interaction.deferUpdate({ flags: MessageFlags.Ephemeral });
    let loginDetails = { app: platform };

    if (interaction.customId.endsWith('_login')) {
        const school = getIfExists(interaction.fields, 'school');
        const username = interaction.fields.getTextInputValue('username');
        const password = interaction.fields.getTextInputValue('password');

        const type = interaction.fields.fields.has('type')
            ? interaction.fields.getField('type')?.values?.[0]
            : undefined;

        loginDetails = {
            app: platform,
            username,
            password,
            ...(school && { school }),
            ...(type && { type }),
        };

    } else if (interaction.customId.endsWith('_loginSaved')) {
        const { school, username, password, type } = interaction.loginDetails;

        loginDetails = {
            app: platform,
            username,
            password,
            ...(school && { school }),
            ...(type && { type }),
        };

    } else if (interaction.customId.endsWith('_loginCookie')) {
        const cookie = interaction.fields.getTextInputValue('cookie');

        loginDetails = {
            app: platform,
            cookie
        };
    }

    const Loadingcontainer = new ContainerBuilder()
        .setAccentColor(colours.onyx)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`### Logging In... :hourglass:\nAttempting to log in to your account...`)
        );

    await interaction.editReply({
        components: [Loadingcontainer],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    });

    let authToken;
    let cookies;
    let sessionResults = {};
    if (!loginDetails.cookie) {
        sessionResults = await loginWrapper(() =>
            login(loginDetails)
        );
        authToken = sessionResults.authToken;
        cookies = sessionResults.cookies;
    } else {
        authToken = await getTokenRequest(loginDetails.cookie);
        cookies = loginDetails.cookie;
    }

    if (sessionResults.status === 'error' && sessionResults.message === 'No School Found') {

        const container = new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ❌ Login Failed\nUnable to Login. The bot could not find the school you were searching for.\n\n> Please go to https://selectschool.sparx-learning.com/?app=sparx_learning and search for your school, copy the input you used to find your school and use that as the school value for the login. The bot selects the first school that comes up in that search query. If no school shows up, remove any \`‘\` and spell your school correctly.`));

        await interaction.editReply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container]
        });
        return;
    }

    if (!authToken || authToken.length < 50) {
        const attachment = new AttachmentBuilder(
            Buffer.from(sessionResults?.logs ?? '', 'utf8'),
            { name: 'sessionResults.txt' }
        );

        const container = new ContainerBuilder()
            .setAccentColor(colours.light_red)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### ❌ Login Failed\nUnable to Login. Please check your login details and try again.`
                )
            )
            .addFileComponents(
                new FileBuilder().setURL('attachment://sessionResults.txt')
            );

        const replyOptions = {
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [container],
            files: [attachment],
        };

        try {
            await interaction.editReply(replyOptions);
        } catch (replyError) {
            console.error(`[Login Command] Error sending login failed reply with attachment.`, replyError);

            try {
                const fallbackAttachment = new AttachmentBuilder(
                    Buffer.from('Could not attach logs.', 'utf8'),
                    { name: 'sessionResults.txt' }
                );

                const fallbackReplyOptions = {
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                    components: [
                        new ContainerBuilder()
                            .setAccentColor(colours.light_red)
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(
                                    `### ❌ Login Failed\nUnable to Login. Please check your login details and try again. (Could not include log file)`
                                )
                            )
                            .addFileComponents(
                                new FileBuilder().setURL('attachment://sessionResults.txt')
                            ),
                    ],
                    files: [fallbackAttachment],
                };

                await interaction.editReply(fallbackReplyOptions);
            } catch (fallbackError) {
                console.error(`[Login Command] Failed to send even fallback reply:`, fallbackError);
            }
        }

        return;
    }

    await userSessions.createNewSession(interaction, loginDetails, authToken, cookies);

    const loginSuccessContainer = new ContainerBuilder()
        .setAccentColor(colours.light_green)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`### ✅ Login Successful\nSuccessfully logged into your account. Loading...`)
        );

    await interaction.editReply({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [loginSuccessContainer]
    });

    const userSession = userSessions.get(interaction.user.id);

    await menu(userSession);
}

module.exports = processLogin;