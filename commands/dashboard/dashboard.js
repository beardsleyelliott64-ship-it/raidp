// language: JavaScript, file: commands/dashboard/dashboard.js
// Home panel = public reply. Navigation panel = ONE ephemeral reply that gets edited in place.

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
        emoji: 'sparx', colour: 'sparx_maths', needsType: true, needsSchool: true,
        thumbnail: 'https://i.postimg.cc/Xvr3JJZg/C90k-XPO.png',
        children: [
            { id: 'maths',   label: 'Sparx Maths',   emoji: 'sparx_maths',   colour: 'sparx_maths',   thumbnail: 'https://i.postimg.cc/Xvr3JJZg/C90k-XPO.png' },
            { id: 'reader',  label: 'Sparx Reader',  emoji: 'sparx_reader',  colour: 'sparx_reader',  thumbnail: 'https://i.postimg.cc/9fqX29C8/reader.png'    },
            { id: 'science', label: 'Sparx Science', emoji: 'sparx_science', colour: 'sparx_science', thumbnail: 'https://i.postimg.cc/qRkmNjH7/science.png'   },
        ],
    },
    { id: 'seneca',      label: 'Seneca',      desc: 'Seneca Learning autocomplete.',         emoji: 'seneca',      colour: 'seneca',      needsType: false, needsSchool: false, thumbnail: 'https://i.postimg.cc/dtBCgCvT/seneca-512.png',  children: null },
    { id: 'languagenut', label: 'Languagenut', desc: 'Languagenut vocab and language tasks.', emoji: 'languagenut', colour: 'languagenut', needsType: false, needsSchool: false, thumbnail: 'https://i.postimg.cc/pdq3MFwF/languagenut.png',  children: null },
    { id: 'senai', label: 'SEN AI', desc: 'Third-party service — opens their site.', emoji: 'key', colour: 'blurple', external: true, url: 'https://senai.uk', discordInvite: 'https://discord.gg/kgaS4wkD9t', children: null },
];

function sep() { return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small); }
function emojiObj(key) {
    const id = emojis?.[key];
    if (!id) return undefined;
    return /^\d+$/.test(String(id)) ? { id: String(id) } : { name: String(id) };
}

// ─── Panel builders ───────────────────────────────────────────────────────────
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
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('dash_platforms').setLabel('Select Platform').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setLabel('Support Server').setStyle(ButtonStyle.Link).setURL(process.env.DISCORD_INVITE_URL || 'https://discord.com/')
        ));
}

function platformPanel() {
    return new ContainerBuilder()
        .setAccentColor(colours.onyx ?? 3487801)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Select Platform'))
        .addSeparatorComponents(sep())
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('dash_platform_select')
                .setPlaceholder('Choose a platform…')
                .addOptions(PLATFORMS.map(p =>
                    new StringSelectMenuOptionBuilder()
                        .setValue(p.id).setLabel(p.label).setDescription(p.desc)
                        .setEmoji(emojiObj(p.emoji) ?? { name: '📚' })
                ))
        ));
}

function sparxChildPanel() {
    return new ContainerBuilder()
        .setAccentColor(colours.sparx_maths ?? 39423)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Sparx — Choose Subject'))
        .addSeparatorComponents(sep())
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('dash_sparx_child')
                .setPlaceholder('Maths, Reader or Science…')
                .addOptions(PLATFORMS[0].children.map(c =>
                    new StringSelectMenuOptionBuilder()
                        .setValue(c.id).setLabel(c.label)
                        .setEmoji(emojiObj(c.emoji) ?? { name: '📘' })
                ))
        ));
}

function loginPanel(platform, child, selectedType) {
    const platMeta = PLATFORMS.find(p => p.id === platform);
    const meta     = child ? platMeta?.children?.find(c => c.id === child) : platMeta;
    const colour   = colours[meta?.colour] ?? colours.onyx;
    const label    = meta?.label ?? platform;
    const section  = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## ${label}\nEnter credentials or load a saved account.`
        ));
    if (meta?.thumbnail) section.setThumbnailAccessory(new ThumbnailBuilder({ media: { url: meta.thumbnail } }));

    const container = new ContainerBuilder().setAccentColor(colour).addSectionComponents(section).addSeparatorComponents(sep());

    if (platMeta?.needsType) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Login type:** ${selectedType ?? 'Normal'}`));
        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('dash_login_type').setPlaceholder('Change login type…')
                .addOptions(
                    new StringSelectMenuOptionBuilder().setLabel('Normal').setValue('Normal').setEmoji(emojiObj('sparx') ?? { name: '🔵' }),
                    new StringSelectMenuOptionBuilder().setLabel('Microsoft').setValue('Microsoft').setEmoji(emojiObj('microsoft') ?? { name: '🪟' }),
                    new StringSelectMenuOptionBuilder().setLabel('Google').setValue('Google').setEmoji(emojiObj('google') ?? { name: '🔴' })
                )
        ));
    }

    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('dash_login').setLabel('Login').setStyle(ButtonStyle.Success).setEmoji(emojiObj('login') ?? { name: '🔑' }),
        new ButtonBuilder().setCustomId('dash_saved').setLabel('Saved Accounts').setStyle(ButtonStyle.Secondary).setEmoji(emojiObj('accounts') ?? { name: '📂' }),
        new ButtonBuilder().setCustomId('dash_back').setLabel('← Back').setStyle(ButtonStyle.Secondary)
    ));
    return container;
}

function senAIPanel() {
    return new ContainerBuilder()
        .setAccentColor(colours.blurple ?? 5793266)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## SEN AI\nThird-party homework solver. Phantom doesn't integrate directly — open their service below.`
        ))
        .addSeparatorComponents(sep())
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel('Open SEN AI').setStyle(ButtonStyle.Link).setURL('https://senai.uk'),
            new ButtonBuilder().setLabel('SEN AI Discord').setStyle(ButtonStyle.Link).setURL('https://discord.gg/kgaS4wkD9t'),
            new ButtonBuilder().setCustomId('dash_back').setLabel('← Back').setStyle(ButtonStyle.Secondary)
        ));
}

// ─── Command ──────────────────────────────────────────────────────────────────
module.exports = {
    data: new SlashCommandBuilder()
        .setName('dashboard')
        .setDescription('Open the Phantom autocompleter dashboard.'),

    public: true,

    async execute(interaction) {
        let selectedPlatform = null;
        let selectedChild    = null;
        let selectedType     = 'Normal';
        let navStack         = [];

        // ── Public home panel ─────────────────────────────────────────────────
        await interaction.reply({
            flags: MessageFlags.IsComponentsV2,
            components: [homePanel()],
        });

        // ── Nav panel state — ONE ephemeral interaction reply, edited in place ─
        // navInteraction: the interaction we called deferReply on — used for all editReplys
        let navInteraction = null;

        async function setPanel(ci, panel, stack) {
            navStack = stack;
            const opts = { flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [panel] };

            // Always ack the incoming component interaction within 3s.
            // Prefer editing the existing nav ephemeral; otherwise open a fresh one.
            if (navInteraction) {
                try {
                    await navInteraction.editReply(opts);
                    if (!ci.deferred && !ci.replied) {
                        await ci.deferUpdate().catch(() => {});
                    }
                    return;
                } catch {
                    navInteraction = null;
                }
            }

            try {
                if (!ci.deferred && !ci.replied) {
                    await ci.deferReply({ flags: MessageFlags.Ephemeral });
                }
                await ci.editReply(opts);
                navInteraction = ci;
            } catch (err) {
                // Last resort: try a follow-up so the user still gets a panel
                try {
                    if (!ci.deferred && !ci.replied) await ci.deferReply({ flags: MessageFlags.Ephemeral });
                    await ci.followUp(opts);
                } catch (e2) {
                    console.error('[dashboard setPanel]', err, e2);
                }
            }
        }

        // Channel collector — long-lived, user-scoped. No idle timeout so Select Platform
        // keeps working on every click of the public home message.
        const collector = interaction.channel.createMessageComponentCollector({
            filter: ci => ci.user.id === interaction.user.id && (
                ci.customId === 'dash_platforms' ||
                ci.customId === 'dash_platform_select' ||
                ci.customId === 'dash_sparx_child' ||
                ci.customId === 'dash_login_type' ||
                ci.customId === 'dash_login' ||
                ci.customId === 'dash_saved' ||
                ci.customId === 'dash_back'
            ),
        });

        collector.on('collect', async (ci) => {
            // Global down gate (set by /shutdown)
            if (ci.client?.botDown) {
                try {
                    const down = new ContainerBuilder()
                        .setAccentColor(colours.light_red ?? 0xed4245)
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            '## Phantom is currently down\nWe are testing / the bot is offline. Try again later.'
                        ));
                    if (!ci.deferred && !ci.replied) {
                        await ci.reply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [down] });
                    } else {
                        await ci.followUp({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [down] });
                    }
                } catch {}
                return;
            }

            try {
                if (ci.customId === 'dash_login_type') {
                    selectedType = ci.values[0];
                    await setPanel(ci, loginPanel(selectedPlatform, selectedChild, selectedType), navStack);
                    return;
                }

                if (ci.customId === 'dash_platforms') {
                    await setPanel(ci, platformPanel(), ['platforms']);
                    return;
                }

                if (ci.customId === 'dash_platform_select') {
                    selectedPlatform = ci.values[0];
                    selectedChild    = null;
                    selectedType     = 'Normal';
                    if (selectedPlatform === 'sparx')  return setPanel(ci, sparxChildPanel(), ['platforms', 'sparx_child']);
                    if (selectedPlatform === 'senai')  return setPanel(ci, senAIPanel(),      ['platforms', 'senai']);
                    return setPanel(ci, loginPanel(selectedPlatform, null, selectedType), ['platforms', 'login']);
                }

                if (ci.customId === 'dash_sparx_child') {
                    selectedChild = ci.values[0];
                    selectedType  = 'Normal';
                    return setPanel(ci, loginPanel('sparx', selectedChild, selectedType), ['platforms', 'sparx_child', 'login']);
                }

                if (ci.customId === 'dash_back') {
                    navStack.pop();
                    const prev = navStack[navStack.length - 1];
                    if (!prev || prev === 'platforms') return setPanel(ci, platformPanel(), ['platforms']);
                    if (prev === 'sparx_child')        return setPanel(ci, sparxChildPanel(), ['platforms', 'sparx_child']);
                    return setPanel(ci, platformPanel(), ['platforms']);
                }

                // Login modal — showModal must be the FIRST response to ci
                if (ci.customId === 'dash_login') {
                    const platformKey = selectedChild ? `sparx(${selectedChild})` : selectedPlatform;
                    const platMeta    = PLATFORMS.find(p => p.id === selectedPlatform);
                    const modal = new ModalBuilder()
                        .setCustomId(`autocompleterModule_${platformKey}_login`)
                        .setTitle('Login');
                    const rows = [];
                    if (platMeta?.needsSchool) rows.push(new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('school').setLabel('School Name').setStyle(TextInputStyle.Short).setRequired(true)
                    ));
                    rows.push(
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('username').setLabel('Username / Email').setStyle(TextInputStyle.Short).setRequired(true)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('password').setLabel('Password').setStyle(TextInputStyle.Short).setRequired(true))
                    );
                    if (platMeta?.needsType) rows.push(new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('type').setLabel('Login type (Normal / Microsoft / Google)').setStyle(TextInputStyle.Short).setValue(selectedType).setRequired(true)
                    ));
                    modal.addComponents(...rows);
                    await ci.showModal(modal);
                    return;
                }

                // Saved accounts modal — showModal must be first response
                if (ci.customId === 'dash_saved') {
                    const platformKey = selectedChild ? `sparx(${selectedChild})` : selectedPlatform;
                    const modal = new ModalBuilder()
                        .setCustomId(`view_saved_accounts_${platformKey}`)
                        .setTitle('Saved Accounts');
                    modal.addComponents(new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('master_password')
                            .setLabel('Master Password (blank if none set)')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(false)
                    ));
                    await ci.showModal(modal);
                    return;
                }

            } catch (err) {
                console.error('[dashboard]', err);
                try {
                    if (!ci.deferred && !ci.replied) {
                        await ci.reply({ content: `Error: ${err.message}`, flags: MessageFlags.Ephemeral });
                    } else {
                        await ci.followUp({ content: `Error: ${err.message}`, flags: MessageFlags.Ephemeral });
                    }
                } catch {}
            }
        });
    },
};
