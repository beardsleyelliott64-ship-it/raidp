// language: JavaScript, file: commands/dashboard/dashboard.js
// /dashboard — PUBLIC UI: platform select → platform panel → login (with type) → start
// Everyone can see the reply (no Ephemeral). Spinning logo in top-right.

const {
    SlashCommandBuilder,
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SectionBuilder,
    ThumbnailBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');
const { emojis, colours } = require('../../config.json');

// ─── Spinning logo URL ────────────────────────────────────────────────────────
// Served from the EAM web dashboard. Falls back to postimg if BASE_URL not set.
function logoUrl() {
    const base = process.env.RENDER_EXTERNAL_URL || process.env.BASE_URL || '';
    return base ? `${base.replace(/\/$/, '')}/logo.gif` : 'https://i.postimg.cc/Xvr3JJZg/C90k-XPO.png';
}

// ─── Platform registry ────────────────────────────────────────────────────────
const PLATFORMS = [
    {
        id: 'sparx',
        label: 'Sparx',
        emoji: 'sparx',
        colour: 'sparx_maths',
        thumbnail: 'https://i.postimg.cc/Xvr3JJZg/C90k-XPO.png',
        desc: 'Maths, Reader and Science autocomplete.',
        needsType: true,
        needsSchool: true,
        children: [
            { id: 'maths',   label: 'Sparx Maths',   emoji: 'sparx_maths',   colour: 'sparx_maths',   thumbnail: 'https://i.postimg.cc/Xvr3JJZg/C90k-XPO.png' },
            { id: 'reader',  label: 'Sparx Reader',  emoji: 'sparx_reader',  colour: 'sparx_reader',  thumbnail: 'https://i.postimg.cc/9fqX29C8/reader.png'    },
            { id: 'science', label: 'Sparx Science', emoji: 'sparx_science', colour: 'sparx_science', thumbnail: 'https://i.postimg.cc/qRkmNjH7/science.png'   },
        ],
    },
    {
        id: 'seneca',
        label: 'Seneca',
        emoji: 'seneca',
        colour: 'seneca',
        thumbnail: 'https://i.postimg.cc/dtBCgCvT/seneca-512.png',
        desc: 'Seneca Learning autocomplete with simulated time.',
        needsType: false,
        needsSchool: false,
        children: null,
    },
    {
        id: 'languagenut',
        label: 'Languagenut',
        emoji: 'languagenut',
        colour: 'languagenut',
        thumbnail: 'https://i.postimg.cc/pdq3MFwF/languagenut.png',
        desc: 'Languagenut vocabulary and language homework.',
        needsType: false,
        needsSchool: false,
        children: null,
    },
    {
        id: 'senai',
        label: 'SEN AI',
        emoji: 'key',
        colour: 'blurple',
        thumbnail: null,
        desc: 'External autocompleter service — opens their site.',
        external: true,
        url: 'https://senai.uk',
        discordInvite: 'https://discord.gg/kgaS4wkD9t',
    },
];

// ─── helpers ──────────────────────────────────────────────────────────────────
function sep() { return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small); }

function emojiObj(key) {
    const id = emojis[key];
    if (!id) return undefined;
    return /^\d+$/.test(String(id)) ? { id: String(id) } : { name: String(id) };
}

// ─── Panels ───────────────────────────────────────────────────────────────────
function buildHomePanel() {
    const section = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                '# EAM Dashboard\n**Homework, automated.**\n\n' +
                'Select your platform and log in — EAM handles the rest.\n\n' +
                '> Supported: `Sparx Maths` · `Sparx Reader` · `Sparx Science` · `Seneca` · `Languagenut`'
            )
        )
        .setThumbnailAccessory(
            new ThumbnailBuilder({ media: { url: logoUrl() } })
        );

    const actions = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('dash_platforms')
            .setLabel('Select Platform')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setLabel('Discord Server')
            .setStyle(ButtonStyle.Link)
            .setURL(process.env.DISCORD_INVITE_URL || 'https://discord.com/')
    );

    return new ContainerBuilder()
        .setAccentColor(colours.blurple ?? 5793266)
        .addSectionComponents(section)
        .addSeparatorComponents(sep())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                '### How to start\n1. Click **Select Platform** below\n2. Pick your platform (and subject for Sparx)\n3. Enter credentials or load a saved account\n4. EAM does the rest'
            )
        )
        .addActionRowComponents(actions);
}

function buildPlatformPanel() {
    const options = PLATFORMS.map(p =>
        new StringSelectMenuOptionBuilder()
            .setValue(p.id)
            .setLabel(p.label)
            .setDescription(p.desc)
            .setEmoji(emojiObj(p.emoji) ?? { name: '📚' })
    );

    return new ContainerBuilder()
        .setAccentColor(colours.onyx ?? 3487801)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Select Platform'))
        .addSeparatorComponents(sep())
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('dash_platform_select')
                    .setPlaceholder('Choose a platform…')
                    .addOptions(options)
            )
        )
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('dash_home')
                    .setLabel('← Back')
                    .setStyle(ButtonStyle.Secondary)
            )
        );
}

function buildSparxChildPanel() {
    const options = PLATFORMS[0].children.map(c =>
        new StringSelectMenuOptionBuilder()
            .setValue(c.id)
            .setLabel(c.label)
            .setEmoji(emojiObj(c.emoji) ?? { name: '📘' })
    );

    return new ContainerBuilder()
        .setAccentColor(colours.sparx_maths ?? 39423)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Sparx — Choose Subject'))
        .addSeparatorComponents(sep())
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('dash_sparx_child')
                    .setPlaceholder('Maths, Reader or Science…')
                    .addOptions(options)
            )
        )
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('dash_platforms')
                    .setLabel('← Back')
                    .setStyle(ButtonStyle.Secondary)
            )
        );
}

function buildLoginPanel(platform, child) {
    const platMeta = PLATFORMS.find(p => p.id === platform);
    const meta = child
        ? platMeta?.children?.find(c => c.id === child)
        : platMeta;

    const colour    = colours[meta?.colour] ?? colours.onyx;
    const thumbnail = meta?.thumbnail;
    const label     = meta?.label ?? platform;
    const needsType = platMeta?.needsType ?? false;

    const section = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## ${label}\nEnter your credentials or load a saved account.`
            )
        );

    if (thumbnail) {
        section.setThumbnailAccessory(new ThumbnailBuilder({ media: { url: thumbnail } }));
    }

    const loginBtn = new ButtonBuilder()
        .setCustomId('dash_login')
        .setLabel('Login')
        .setStyle(ButtonStyle.Success)
        .setEmoji(emojiObj('login') ?? { name: '🔑' });

    const savedBtn = new ButtonBuilder()
        .setCustomId('dash_saved')
        .setLabel('Saved Accounts')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(emojiObj('accounts') ?? { name: '📂' });

    const backId = platform === 'sparx' ? 'dash_sparx_back' : 'dash_platforms';
    const backBtn = new ButtonBuilder()
        .setCustomId(backId)
        .setLabel('← Back')
        .setStyle(ButtonStyle.Secondary);

    const container = new ContainerBuilder()
        .setAccentColor(colour)
        .addSectionComponents(section)
        .addSeparatorComponents(sep());

    if (needsType) {
        const typeSelect = new StringSelectMenuBuilder()
            .setCustomId('dash_login_type')
            .setPlaceholder('Login type — Normal (default)')
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel('Normal')
                    .setValue('Normal')
                    .setEmoji(emojiObj('sparx') ?? { name: '🔵' }),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Microsoft')
                    .setValue('Microsoft')
                    .setEmoji(emojiObj('microsoft') ?? { name: '🪟' }),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Google')
                    .setValue('Google')
                    .setEmoji(emojiObj('google') ?? { name: '🔴' })
            );

        container.addActionRowComponents(new ActionRowBuilder().addComponents(typeSelect));
    }

    container.addActionRowComponents(new ActionRowBuilder().addComponents(loginBtn, savedBtn, backBtn));
    return container;
}

function buildSenAIPanel() {
    const meta = PLATFORMS.find(p => p.id === 'senai');
    return new ContainerBuilder()
        .setAccentColor(colours.blurple ?? 5793266)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## SEN AI\n` +
                `SEN AI is a third-party homework solver — they run their own Discord bot and web dashboard.\n\n` +
                `EAM doesn't integrate directly with them; click below to open their service.`
            )
        )
        .addSeparatorComponents(sep())
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Open SEN AI')
                    .setStyle(ButtonStyle.Link)
                    .setURL(meta.url),
                new ButtonBuilder()
                    .setLabel('SEN AI Discord')
                    .setStyle(ButtonStyle.Link)
                    .setURL(meta.discordInvite),
                new ButtonBuilder()
                    .setCustomId('dash_platforms')
                    .setLabel('← Back')
                    .setStyle(ButtonStyle.Secondary)
            )
        );
}

// ─── Command ──────────────────────────────────────────────────────────────────
module.exports = {
    data: new SlashCommandBuilder()
        .setName('dashboard')
        .setDescription('Open the EAM autocompleter dashboard.'),

    public: true,

    async execute(interaction) {
        let selectedPlatform = null;
        let selectedChild    = null;
        let selectedType     = 'Normal';

        // PUBLIC reply — no Ephemeral flag, everyone in the channel sees it
        const reply = await interaction.reply({
            flags: MessageFlags.IsComponentsV2,
            components: [buildHomePanel()],
            fetchReply: true,
        });

        const collector = reply.createMessageComponentCollector({ time: 600_000 });

        async function go(panel) {
            await interaction.editReply({
                components: [panel],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
        }

        async function showLoginModal(ci) {
            const platformKey = selectedChild ? `sparx(${selectedChild})` : selectedPlatform;
            const platMeta    = PLATFORMS.find(p => p.id === selectedPlatform);

            const modal = new ModalBuilder()
                .setCustomId(`autocompleterModule_${platformKey}_login`)
                .setTitle('Login');

            const usernameInput = new TextInputBuilder()
                .setCustomId('username')
                .setLabel('Username / Email')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const passwordInput = new TextInputBuilder()
                .setCustomId('password')
                .setLabel('Password')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const rows = [
                new ActionRowBuilder().addComponents(usernameInput),
                new ActionRowBuilder().addComponents(passwordInput),
            ];

            if (platMeta?.needsSchool) {
                rows.unshift(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('school')
                            .setLabel('School Name')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                    )
                );
            }

            if (platMeta?.needsType) {
                rows.push(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('type')
                            .setLabel(`Login type (Normal / Microsoft / Google)`)
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                            .setValue(selectedType)
                    )
                );
            }

            modal.addComponents(...rows);
            await ci.showModal(modal);
        }

        collector.on('collect', async (ci) => {
            if (ci.user.id !== interaction.user.id) {
                return ci.reply({ content: 'Not your dashboard.', flags: MessageFlags.Ephemeral });
            }

            try {
                if (ci.customId === 'dash_login_type') {
                    selectedType = ci.values[0];
                    await ci.deferUpdate();
                    return;
                }

                if (ci.customId === 'dash_home')        { await ci.deferUpdate(); return go(buildHomePanel()); }
                if (ci.customId === 'dash_platforms')   { await ci.deferUpdate(); return go(buildPlatformPanel()); }
                if (ci.customId === 'dash_sparx_back')  { await ci.deferUpdate(); return go(buildSparxChildPanel()); }

                if (ci.customId === 'dash_platform_select') {
                    await ci.deferUpdate();
                    selectedPlatform = ci.values[0];
                    selectedChild    = null;
                    selectedType     = 'Normal';
                    if (selectedPlatform === 'sparx')  return go(buildSparxChildPanel());
                    if (selectedPlatform === 'senai')  return go(buildSenAIPanel());
                    return go(buildLoginPanel(selectedPlatform, null));
                }

                if (ci.customId === 'dash_sparx_child') {
                    await ci.deferUpdate();
                    selectedChild = ci.values[0];
                    selectedType  = 'Normal';
                    return go(buildLoginPanel('sparx', selectedChild));
                }

                if (ci.customId === 'dash_login') return showLoginModal(ci);

                if (ci.customId === 'dash_saved') {
                    // Defer IMMEDIATELY before any async DB work — kills the "did not respond in time" error
                    await ci.deferUpdate();
                    const platformKey = selectedChild ? `sparx(${selectedChild})` : selectedPlatform;
                    const { handleSavedAccounts } = require('../../handlers/savedAccountsHandler.js');
                    return handleSavedAccounts(ci, 'view', platformKey);
                }

            } catch (err) {
                console.error('[dashboard]', err);
                try {
                    await ci.followUp({ content: `Error: ${err.message}`, flags: MessageFlags.Ephemeral });
                } catch {}
            }
        });

        collector.on('end', async () => {
            try {
                await interaction.editReply({
                    components: [
                        new ContainerBuilder()
                            .setAccentColor(colours.light_red ?? 16729933)
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent('### Dashboard expired\nRun `/dashboard` again.')
                            ),
                    ],
                    flags: MessageFlags.IsComponentsV2,
                });
            } catch {}
        });
    },
};
