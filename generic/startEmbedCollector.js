const { SeparatorSpacingSize, SeparatorBuilder, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ComponentType } = require('discord.js');
const { emojis, colours } = require('../config.json');
const { validAccount } = require('../handlers/accountHandler.js');
const loginHandler = require('../generic/loginHandler.js');
const getFunctionParams = require('../utils/getFunctionParams.js');
const getChildrenFromId = require('../utils/getChildrenFromId.js');
const getFile = require('../utils/getFile.js');

async function collector(message_sent, platform) {
    const loginPath = await getFile(platform, 'login.js');
    const login = require(loginPath);
    const loginParameters = getFunctionParams(login);
    const needsType   = loginParameters.includes('type');
    const needsSchool = loginParameters.includes('school');

    const collector = message_sent.createMessageComponentCollector({
        componentType: ComponentType.Button,
    });

    collector.on('collect', async (interaction) => {
        try {
            if (interaction.customId.endsWith('_login')) {
                if (await validAccount(interaction, platform)) return;
                const children = getChildrenFromId(interaction.customId);
                const childLabel = children.length ? `(${children})` : '';
                const fullPlatform = `${platform}${childLabel}`;

                const loginBtn = new ButtonBuilder()
                    .setCustomId("login")
                    .setLabel('Login')
                    .setEmoji(emojis.login)
                    .setStyle(ButtonStyle.Success);

                const cookieBtn = new ButtonBuilder()
                    .setCustomId("login_cookies")
                    .setLabel('Cookie Login')
                    .setEmoji(emojis.cookies)
                    .setStyle(ButtonStyle.Success);

                const savedBtn = new ButtonBuilder()
                    .setCustomId(`${fullPlatform}_savedAccounts_view`)
                    .setLabel('Saved Accounts')
                    .setEmoji(emojis.accounts)
                    .setStyle(ButtonStyle.Secondary);

                const btnRow = new ActionRowBuilder().addComponents(loginBtn, cookieBtn, savedBtn);

                const container = new ContainerBuilder()
                    .setAccentColor(colours.onyx)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`### Login\nPick login type below then hit **Login**, or use a saved account.`)
                    )
                    .addSeparatorComponents(new SeparatorBuilder({ spacing: SeparatorSpacingSize.Small }));

                // Type selector lives on the container (not inside the modal — Discord doesn't allow that)
                if (needsType) {
                    const typeSelect = new StringSelectMenuBuilder()
                        .setCustomId('login_type_select')
                        .setPlaceholder('Login type — Normal (default)')
                        .addOptions(
                            { label: 'Normal',    value: 'Normal',    emoji: emojis.sparx },
                            { label: 'Microsoft', value: 'Microsoft', emoji: emojis.microsoft },
                            { label: 'Google',    value: 'Google',    emoji: emojis.google }
                        );
                    container.addActionRowComponents(new ActionRowBuilder().addComponents(typeSelect));
                }

                container.addActionRowComponents(btnRow);

                await loginHandler(interaction, container, fullPlatform, needsSchool, needsType);

            } else if (interaction.customId.startsWith('check_queue')) {
                const queueCollector = require('../queues/queueCollecting.js');
                await queueCollector(interaction);
            }
        } catch (error) {
            console.error(`[panel:${platform}]`, error);
            try {
                const payload = { content: `Panel error: ${error.message || 'Unknown error'}`, ephemeral: true };
                if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
                else await interaction.reply(payload);
            } catch {}
        }
    });
}

module.exports = collector;
