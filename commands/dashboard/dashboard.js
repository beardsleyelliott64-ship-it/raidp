// language: JavaScript, file: commands/dashboard/dashboard.js
// /dashboard — each panel is a fresh followUp message; home panel stays pinned.

const {
    SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder,
    SeparatorBuilder, SeparatorSpacingSize, SectionBuilder, ThumbnailBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { emojis, colours } = require('../../config.json');

function logoUrl() {
    const base = process.env.RENDER_EXTERNAL_URL || process.env.BASE_URL || '';
    return base ? `${base.replace(/\/$/, '')}/logo.gif` : '';
}

const PLATFORMS = [
    {
        id: 'sparx', label: 'Sparx', desc: 'Maths, Reader and Science autocomplete.',
        emoji: 'sparx', colour: 'sparx_maths',
        needsType: true, needsSchool: true,
        thumbnail: 'https://i.postimg.cc/Xvr3JJZg/C90k-XPO.png',
        children: [
            { id: 'maths',   label: 'Sparx Maths',   emoji: 'sparx_maths',   colour: 'sparx_maths',   thumbnail: 'https://i.postimg.cc/Xvr3JJZg/C90k-XPO.png' },
            { id: 'reader',  label: 'Sparx Reader',  emoji: 'sparx_reader',  colour: 'sparx_reader',  thumbnail: 'https://i.postimg.cc/9fqX29C8/reader.png'    },
            { id: 'science', label: 'Sparx Science', emoji: 'sparx_science', colour: 'sparx_science', thumbnail: 'https://i.postimg.cc/qRkmNjH7/science.png'   },
        ],
    },
    { id: 'seneca',      label: 'Seneca',      desc: 'Seneca Learning autocomplete.',         emoji: 'seneca',      colour: 'seneca',      needsType: false, needsSchool: false, thumbnail: 'https://i.postimg.cc/dtBCgCvT/seneca-512.png', children: null },
    { id: 'languagenut', label: 'Languagenut', desc: 'Languagenut vocab and language tasks.', emoji: 'languagenut', colour: 'languagenut', needsType: false, needsSchool: false, thumbnail: 'https://i.postimg.cc/pdq3MFwF/languagenut.png',  children: null },
    { id: 'senai', label: 'SEN AI', desc: 'Third-party service — opens their site.', emoji: 'key', colour: 'blurple', external: true, url: 'https://senai.uk', discordInvite: 'https://discord.gg/kgaS4wkD9t', children: null },
];

function sep() { return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small); }
function emojiObj(key) {
    const id = emojis?.[key];
    if (!id) return undefined;
    return /^\d+$/.test(String(id)) ? { id: String(id) } : { name: String(id) };
}

// ─── Panel builders ──────────────────────────────────────────────────────────
function homePanel() {
    const logo = logoUrl();
    const section = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            '# Phantom — Homework, automated.\n' +
            'Select your platform below and log in. Phantom handles the rest.\n\n' +
            '> `Sparx Maths` · `Sparx Reader` · `Sparx Science` · `Seneca` · `Languagenut`'
        ));
    if (logo) section.setThumbnailAccessory(new ThumbnailBuilder({ media: { url: logo } }));

    return new ContainerBuilder()
        .setAccentColor(colours.blurple ?? 5793266)
        .addSectionComponents(section)
        .addSeparatorComponents(sep())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            '### How it works\n1. Click **Select Platform**\n2. Pick your subject\n3. Enter credentials or load a saved account\n4. Done'
        ))
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('dash_platforms').setLabel('Select Platform').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setLabel('Support Server').setStyle(ButtonStyle.Link).setURL(process.env.DISCORD_INVITE_URL || 'https://discord.com/')
            )
        );
}

function platformPanel() {
    return new ContainerBuilder()
        .setAccentColor(colours.onyx ?? 3487801)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Select Platform'))
        .addSeparatorComponents(sep())
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('dash_platform_select')
                    .setPlaceholder('Choose a platform…')
                    .addOptions(PLATFORMS.map(p =>
                        new StringSelectMenuOptionBuilder()
                            .setValue(p.id).setLabel(p.label).setDescription(p.desc)
                            .setEmoji(emojiObj(p.emoji) ?? { name: '📚' })
                    ))
            )
        )
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('dash_back_home').setLabel('← Home').setStyle(ButtonStyle.Secondary)
            )
        );
}

function sparxChildPanel() {
    return new ContainerBuilder()
        .setAccentColor(colours.sparx_maths ?? 39423)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Sparx — Choose Subject'))
        .addSeparatorComponents(sep())
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('dash_sparx_child')
                    .setPlaceholder('Maths, Reader or Science…')
                    .addOptions(PLATFORMS[0].children.map(c =>
                        new StringSelectMenuOptionBuilder()
                            .setValue(c.id).setLabel(c.label)
                            .setEmoji(emojiObj(c.emoji) ?? { name: '📘' })
                    ))
            )
        )
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('dash_back_platforms').setLabel('← Back').setStyle(ButtonStyle.Secondary)
            )
        );
}

function loginPanel(platform, child, selectedType) {
    const platMeta = PLATFORMS.find(p => p.id === platform);
    const meta     = child ? platMeta?.children?.find(c => c.id === child) : platMeta;
    const colour   = colours[meta?.colour] ?? colours.onyx;
    const label    = meta?.label ?? platform;

    const section = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## ${label}\nEnter credentials or load a saved account.`
        ));
    if (meta?.thumbnail) section.setThumbnailAccessory(new ThumbnailBuilder({ media: { url: meta.thumbnail } }));

    const backId = (platform === 'sparx') ? 'dash_back_sparx' : 'dash_back_platforms';

    const container = new ContainerBuilder()
        .setAccentColor(colour)
        .addSectionComponents(section)
        .addSeparatorComponents(sep());

    if (platMeta?.needsType) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `**Login type:** ${selectedType ?? 'Normal'} *(change with the menu below)*`
        ));
        container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('dash_login_type')
                    .setPlaceholder('Login type…')
                    .addOptions(
                        new StringSelectMenuOptionBuilder().setLabel('Normal').setValue('Normal').setEmoji(emojiObj('sparx') ?? { name: '🔵' }),
                        new StringSelectMenuOptionBuilder().setLabel('Microsoft').setValue('Microsoft').setEmoji(emojiObj('microsoft') ?? { name: '🪟' }),
                        new StringSelectMenuOptionBuilder().setLabel('Google').setValue('Google').setEmoji(emojiObj('google') ?? { name: '🔴' })
                    )
            )
        );
    }

    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('dash_login').setLabel('Login').setStyle(ButtonStyle.Success).setEmoji(emojiObj('login') ?? { name: '🔑' }),
            new ButtonBuilder().setCustomId('dash_saved').setLabel('Saved Accounts').setStyle(ButtonStyle.Secondary).setEmoji(emojiObj('accounts') ?? { name: '📂' }),
            new ButtonBuilder().setCustomId(backId).setLabel('← Back').setStyle(ButtonStyle.Secondary)
        )
    );

    return container;
}

function senAIPanel() {
    return new ContainerBuilder()
        .setAccentColor(colours.blurple ?? 5793266)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## SEN AI\nThird-party homework solver. Phantom doesn't integrate directly — open their service below.`
        ))
        .addSeparatorComponents(sep())
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel('Open SEN AI').setStyle(ButtonStyle.Link).setURL('https://senai.uk'),
                new ButtonBuilder().setLabel('SEN AI Discord').setStyle(ButtonStyle.Link).setURL('https://discord.gg/kgaS4wkD9t'),
                new ButtonBuilder().setCustomId('dash_back_platforms').setLabel('← Back').setStyle(ButtonStyle.Secondary)
            )
        );
}

// ─── Command ─────────────────────────────────────────────────────────────────
module.exports = {
    data: new SlashCommandBuilder()
        .setName('dashboard')
        .setDescription('Open the Phantom autocompleter dashboard.'),

    public: true,

    async execute(interaction) {
        let selectedPlatform = null;
        let selectedChild    = null;
        let selectedType     = 'Normal';

        // Home panel — public, pinned, never edited
        await interaction.reply({
            flags: MessageFlags.IsComponentsV2,
            components: [homePanel()],
        });

        // Active panel message — followUp, updated for navigation
        let panelMsg = null;

        async function pushPanel(ci, panel) {
            if (panelMsg) {
                try {
                    await panelMsg.edit({ flags: MessageFlags.IsComponentsV2, components: [panel] });
                    return;
                } catch {}
            }
            panelMsg = await ci.followUp({ flags: MessageFlags.IsComponentsV2, components: [panel], fetchReply: true });
        }

        // Collect on the channel — catch all components from this user in this session
        const filter = ci => ci.user.id === interaction.user.id;
        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 600_000 });

        collector.on('collect', async (ci) => {
            try {
                // Login type select — update state silently, then refresh panel
                if (ci.customId === 'dash_login_type') {
                    selectedType = ci.values[0];
                    await ci.deferUpdate();
                    await pushPanel(ci, loginPanel(selectedPlatform, selectedChild, selectedType));
                    return;
                }

                // Navigation
                if (ci.customId === 'dash_platforms' || ci.customId === 'dash_back_platforms') {
                    await ci.deferUpdate();
                    await pushPanel(ci, platformPanel());
                    return;
                }
                if (ci.customId === 'dash_back_home') {
                    await ci.deferUpdate();
                    if (panelMsg) { try { await panelMsg.delete(); } catch {} panelMsg = null; }
                    return;
                }
                if (ci.customId === 'dash_back_sparx') {
                    await ci.deferUpdate();
                    await pushPanel(ci, sparxChildPanel());
                    return;
                }

                if (ci.customId === 'dash_platform_select') {
                    await ci.deferUpdate();
                    selectedPlatform = ci.values[0];
                    selectedChild    = null;
                    selectedType     = 'Normal';
                    if (selectedPlatform === 'sparx')  return pushPanel(ci, sparxChildPanel());
                    if (selectedPlatform === 'senai')  return pushPanel(ci, senAIPanel());
                    return pushPanel(ci, loginPanel(selectedPlatform, null, selectedType));
                }

                if (ci.customId === 'dash_sparx_child') {
                    await ci.deferUpdate();
                    selectedChild = ci.values[0];
                    selectedType  = 'Normal';
                    return pushPanel(ci, loginPanel('sparx', selectedChild, selectedType));
                }

                // Login modal — show immediately (no defer before showModal)
                if (ci.customId === 'dash_login') {
                    const platformKey = selectedChild ? `sparx(${selectedChild})` : selectedPlatform;
                    const platMeta    = PLATFORMS.find(p => p.id === selectedPlatform);

                    const modal = new ModalBuilder()
                        .setCustomId(`autocompleterModule_${platformKey}_login`)
                        .setTitle('Login');

                    const rows = [];
                    if (platMeta?.needsSchool) {
                        rows.push(new ActionRowBuilder().addComponents(
                            new TextInputBuilder().setCustomId('school').setLabel('School Name').setStyle(TextInputStyle.Short).setRequired(true)
                        ));
                    }
                    rows.push(
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('username').setLabel('Username / Email').setStyle(TextInputStyle.Short).setRequired(true)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('password').setLabel('Password').setStyle(TextInputStyle.Short).setRequired(true))
                    );
                    if (platMeta?.needsType) {
                        rows.push(new ActionRowBuilder().addComponents(
                            new TextInputBuilder().setCustomId('type').setLabel('Login type (Normal / Microsoft / Google)').setStyle(TextInputStyle.Short).setValue(selectedType).setRequired(true)
                        ));
                    }
                    modal.addComponents(...rows);
                    await ci.showModal(modal);
                    return;
                }

                // Saved accounts — show master password modal immediately (no defer → modal works)
                if (ci.customId === 'dash_saved') {
                    const platformKey = selectedChild ? `sparx(${selectedChild})` : selectedPlatform;
                    const modal = new ModalBuilder()
                        .setCustomId(`view_saved_accounts_${platformKey}`)
                        .setTitle('Saved Accounts Login');
                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('master_password')
                                .setLabel('Master Password (leave blank if none)')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(false)
                        )
                    );
                    await ci.showModal(modal);
                    return;
                }

            } catch (err) {
                console.error('[dashboard collector]', err);
                try { await ci.followUp({ content: `Error: ${err.message}`, flags: MessageFlags.Ephemeral }); } catch {}
            }
        });

        collector.on('end', async () => {
            try {
                await interaction.editReply({
                    flags: MessageFlags.IsComponentsV2,
                    components: [
                        new ContainerBuilder()
                            .setAccentColor(colours.light_red ?? 16729933)
                            .addTextDisplayComponents(new TextDisplayBuilder().setContent('### Dashboard expired\nRun `/dashboard` again.'))
                    ],
                });
            } catch {}
        });
    },
};
