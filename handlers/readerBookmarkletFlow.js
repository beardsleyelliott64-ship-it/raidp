// language: JavaScript, file: handlers/readerBookmarkletFlow.js
'use strict';

const crypto = require('node:crypto');
const {
    ContainerBuilder,
    TextDisplayBuilder,
    ThumbnailBuilder,
    SectionBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

const { colours, emojis } = require('../config.json');

// ---------------------------------------------------------------------------
// Shared pending sessions — read by web/dashboard.js when bookmarklet POSTs
// ---------------------------------------------------------------------------
const pendingSessions = new Map();

// Per-user dashboard session state
const activeDashboardSessions = new Map();

const PLATFORMS = [
    { label: 'Sparx Reader',  value: 'reader',  emoji: '📖', colour: 'sparx_reader'  },
    { label: 'Sparx Maths',   value: 'maths',   emoji: '📐', colour: 'sparx_maths'   },
    { label: 'Sparx Science', value: 'science', emoji: '🔬', colour: 'sparx_science'  }
];

function getColour(platform) {
    const p = PLATFORMS.find(x => x.value === platform);
    return colours[p?.colour ?? 'sparx_reader'] ?? colours.sparx_reader;
}

function hostUrl() {
    return (
        process.env.RENDER_EXTERNAL_URL ||
        process.env.BOT_PUBLIC_URL ||
        `http://localhost:${process.env.PORT || process.env.WEB_PORT || 3000}`
    ).replace(/\/$/, '');
}

function makeToken() {
    return crypto.randomBytes(5).toString('hex');
}

function platformLabel(platform) {
    return PLATFORMS.find(x => x.value === platform)?.label ?? platform;
}

function simplePanel(colour, content) {
    return new ContainerBuilder()
        .setAccentColor(colour)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

// ---------------------------------------------------------------------------
// UI builders
// ---------------------------------------------------------------------------
function buildPlatformSelect() {
    const select = new StringSelectMenuBuilder()
        .setCustomId('lumen_platform_select')
        .setPlaceholder('Choose a platform...');

    for (const p of PLATFORMS) {
        select.addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(p.label).setValue(p.value).setEmoji(p.emoji)
        );
    }

    return new ContainerBuilder()
        .setAccentColor(colours.sparx_reader)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## Select Platform\nChoose which Sparx platform to autocomplete.')
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(new ActionRowBuilder().addComponents(select));
}

function buildMethodSelect(platform) {
    const colour = getColour(platform);
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('lumen_method_bm').setLabel('Bookmarklet (Recommended)').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('lumen_method_cookie').setLabel('Cookies').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('lumen_back_platform').setLabel('Back').setStyle(ButtonStyle.Secondary)
    );
    return new ContainerBuilder()
        .setAccentColor(colour)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## Lumen · ${platformLabel(platform)} — Other Login Options\n` +
                `Choose **Bookmarklet** for the easiest setup, or **Cookies** if you prefer manual entry.`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(row);
}

function buildBookmarkletTutorial(token, platform) {
    const colour = getColour(platform);
    const bm = `xjavascript:import('${hostUrl()}/bm/${token}')`;
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('lumen_bm_refresh').setLabel('Refresh').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('lumen_bm_reset').setLabel('Reset link').setStyle(ButtonStyle.Secondary)
    );
    return new ContainerBuilder()
        .setAccentColor(colour)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## Tutorial · Connect to Lumen\n**Save this once — it never changes**\n\n` +
                `🖥️ **PC (Chrome / Edge)**\n` +
                `1. On any page press \`Ctrl+D\`, save it anywhere\n` +
                `2. Right-click that bookmark → **Edit**\n` +
                `3. Paste the link below into the **URL** box, name it \`Lumen\`\n` +
                `4. Delete the **x** at the front, then **Done**\n\n` +
                `📱 **iPhone / iPad (Safari)**\n` +
                `1. Share → **Add Bookmark** on any page\n` +
                `2. Open Bookmarks → **Edit** → tap \`Lumen\`\n` +
                `3. Tap the address field, paste the link below\n` +
                `4. Delete the **x** at the front, then **Done**\n\n` +
                `📱 **Android (Chrome)**\n` +
                `1. ⋮ → **Add to bookmarks**\n` +
                `2. Bookmarks → long-press \`Lumen\` → **Edit**\n` +
                `3. Paste the link, delete the **x** at the front, **Save**\n\n` +
                `**Then, every time**\n` +
                `• Open **Sparx Reader** and sign in\n` +
                `• Click your **Lumen** bookmark\n` +
                `• Wait for the green **Done** box, then press **Refresh** below\n\n` +
                `\`\`\`\n${bm}\n\`\`\`\n*Hold to copy on mobile*`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('**Waiting for you...** Click the bookmark in your Sparx tab, then press **Refresh**.')
        )
        .addActionRowComponents(row);
}

function buildVerifyAccount(userInfo, platform) {
    const colour = getColour(platform);
    const name = `${userInfo.givenName || ''} ${userInfo.familyName || ''}`.trim() || userInfo.displayName || 'Unknown';
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('lumen_verify_yes').setLabel("Yes, that's me").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('lumen_verify_no').setLabel('No, cancel').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('lumen_verify_refresh').setLabel('Refresh').setStyle(ButtonStyle.Secondary)
    );
    return new ContainerBuilder()
        .setAccentColor(colour)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## Step 1 · Account\nHey **${name}**\n\nIs this your Sparx account?\n\n**Connected tab:** ${platformLabel(platform)}`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(row);
}

function buildLibraryPanel(sess, disabled = false) {
    const colour = getColour(sess.platform);
    const name = `${sess.userInfo?.givenName || ''} ${sess.userInfo?.familyName || ''}`.trim() || 'Reader';

    const hero = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# Lumen · ${platformLabel(sess.platform)}\n` +
                `Welcome, **${name}**\n\n` +
                `**SRP Target:** ${sess.settings.srp}  •  **WPM:** ${sess.settings.wpm}\n` +
                `**Question window:** ${sess.settings.min}–${sess.settings.max}s\n` +
                `**Mode:** ${sess.mode}`
            )
        )
        .setThumbnailAccessory(
            new ThumbnailBuilder({ media: { url: 'https://i.postimg.cc/Y9j7vShY/0H0TBp3.png' } })
        );

    const select = new StringSelectMenuBuilder()
        .setCustomId('lumen_book_select')
        .setPlaceholder('Choose a book')
        .setMinValues(0)
        .setDisabled(disabled);

    if (sess.books?.length) {
        for (const book of sess.books) {
            select.addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel(book.title)
                    .setDescription(`${book.progress ?? 0}%`)
                    .setValue(book.bookId)
                    .setDefault(sess.selectedHomework === book.bookId)
            );
        }
    } else {
        select.addOptions(new StringSelectMenuOptionBuilder().setLabel('No books found').setValue('none'));
        select.setDisabled(true);
    }

    const actionRow = new ActionRowBuilder();
    if (sess.selectedHomework) {
        actionRow.addComponents(
            new ButtonBuilder().setCustomId('lumen_book_start').setLabel('Start').setEmoji('▶️').setStyle(ButtonStyle.Success).setDisabled(disabled)
        );
    }
    actionRow.addComponents(
        new ButtonBuilder().setCustomId('lumen_book_mode').setLabel('Mode').setStyle(ButtonStyle.Primary).setDisabled(disabled),
        new ButtonBuilder().setCustomId('lumen_book_settings').setLabel('Settings').setEmoji('⚙️').setStyle(ButtonStyle.Secondary).setDisabled(disabled)
    );

    return new ContainerBuilder()
        .setAccentColor(colour)
        .addSectionComponents(hero)
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Choose a book'))
        .addActionRowComponents(new ActionRowBuilder().addComponents(select))
        .addActionRowComponents(actionRow);
}

// ---------------------------------------------------------------------------
// Main panel button handler (non-ephemeral channel message collector)
// ---------------------------------------------------------------------------
async function handleMainPanelClick(ci) {
    const userId = ci.user.id;

    if (ci.customId === 'lumen_start_task') {
        // Open ephemeral flow for this user
        const msg = await ci.reply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [buildPlatformSelect()],
            fetchReply: true
        });
        spawnEphemeralCollector(msg, ci, userId);
        return;
    }

    if (ci.customId === 'lumen_saved_accounts') {
        const { executeViewAccounts } = require('../handlers/savedAccountsHandler.js');
        await ci.deferReply({ flags: MessageFlags.Ephemeral });
        await executeViewAccounts(ci);
        return;
    }

    if (ci.customId === 'lumen_check_queue') {
        const allQueues = require('../queues/queues.js');
        const lines = [];
        for (const [name, q] of Object.entries(allQueues.getAll?.() || {})) {
            const len = q.length?.() ?? '?';
            lines.push(`**${name}:** ${len} in queue`);
        }
        await ci.reply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [simplePanel(colours.sparx_reader,
                `## Queue Status\n${lines.length ? lines.join('\n') : 'All queues empty.'}`
            )]
        });
        return;
    }

    if (ci.customId === 'lumen_check_account') {
        await ci.deferReply({ flags: MessageFlags.Ephemeral });
        const { checkAccount } = require('../database/accounts.js');
        try {
            const account = await checkAccount(userId);
            const text = account
                ? `## Your Account\n**Discord ID:** ${userId}\n**Slots used:** ${JSON.stringify(account.uses ?? {})}`
                : '## No Account\nRun `/account` to set one up.';
            await ci.editReply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [simplePanel(colours.sparx_reader, text)]
            });
        } catch (e) {
            await ci.editReply({ content: `Could not fetch account: ${e.message}` });
        }
        return;
    }

    if (ci.customId === 'lumen_settings') {
        await ci.deferReply({ flags: MessageFlags.Ephemeral });
        const { settingsDisplayer } = require('../generic/settingsDisplayer.js');
        await settingsDisplayer(ci, 'sparx_reader');
        return;
    }

    if (ci.customId === 'lumen_help') {
        await ci.reply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [simplePanel(colours.sparx_reader,
                `## Help\n` +
                `**Start Task** — connect to Sparx Reader and autocomplete your homework\n` +
                `**Saved Accounts** — view and manage saved login accounts\n` +
                `**Settings** — adjust SRP target, WPM, question timing\n` +
                `**Check Account** — view your bot account details\n` +
                `**Check Queue** — see how many people are ahead of you\n\n` +
                `Having issues? Make sure you're logged into Sparx before clicking the bookmarklet.`
            )]
        });
        return;
    }
}

// ---------------------------------------------------------------------------
// Ephemeral flow collector — handles all subsequent steps for one user
// ---------------------------------------------------------------------------
function spawnEphemeralCollector(msg, originalCi, userId) {
    const collector = msg.createMessageComponentCollector({ time: 600_000 });

    collector.on('collect', async (ci) => {
        try {
            await handleEphemeralInteraction(ci, userId, collector);
        } catch (err) {
            console.error('[lumen:ephemeral]', err);
            try {
                if (ci.replied || ci.deferred) await ci.followUp({ content: `Error: ${err.message}`, flags: MessageFlags.Ephemeral });
                else await ci.reply({ content: `Error: ${err.message}`, flags: MessageFlags.Ephemeral });
            } catch {}
        }
    });
}

async function handleEphemeralInteraction(ci, userId, collector) {
    // Platform selected
    if (ci.customId === 'lumen_platform_select') {
        const platform = ci.values[0];
        const sess = activeDashboardSessions.get(userId) || {};
        sess.platform = platform;
        activeDashboardSessions.set(userId, sess);
        await ci.update({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [buildMethodSelect(platform)]
        });
        return;
    }

    if (ci.customId === 'lumen_back_platform') {
        await ci.update({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [buildPlatformSelect()]
        });
        return;
    }

    if (ci.customId === 'lumen_method_bm') {
        const sess = activeDashboardSessions.get(userId) || {};
        const platform = sess.platform ?? 'reader';
        if (sess.token) pendingSessions.delete(sess.token);

        const token = makeToken();
        sess.token = token;
        sess.interaction = ci; // store for bookmarklet POST callback
        activeDashboardSessions.set(userId, sess);

        pendingSessions.set(token, {
            token, userId, platform,
            getInteraction: () => activeDashboardSessions.get(userId)?.interaction,
            received: false,
            cookieString: null,
            expires: Date.now() + 10 * 60 * 1000
        });

        // Prune expired
        for (const [t, v] of pendingSessions) if (v.expires < Date.now()) pendingSessions.delete(t);

        await ci.update({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [buildBookmarkletTutorial(token, platform)]
        });
        return;
    }

    if (ci.customId === 'lumen_method_cookie') {
        const sess = activeDashboardSessions.get(userId) || {};
        const platform = sess.platform ?? 'reader';
        sess.interaction = ci;
        activeDashboardSessions.set(userId, sess);

        const modal = new ModalBuilder()
            .setCustomId(`lumen_login_cookie_${platform}`)
            .setTitle('Login with Cookie');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('cookie')
                    .setLabel('Sparx Cookie')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('live_ssoprovider_session=...; spxlrn_session=...')
                    .setRequired(true)
            )
        );
        await ci.showModal(modal);
        return;
    }

    if (ci.customId === 'lumen_bm_refresh') {
        const sess = activeDashboardSessions.get(userId);
        const pending = sess?.token ? pendingSessions.get(sess.token) : null;

        if (!pending || pending.expires < Date.now()) {
            await ci.update({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [simplePanel(colours.light_red,
                    '### Session expired\nPress **Reset link** to get a new one.'
                )]
            });
            return;
        }

        if (!pending.received) {
            // Not yet — stay on tutorial, nudge
            await ci.update({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [buildBookmarkletTutorial(sess.token, sess.platform ?? 'reader')]
            });
            return;
        }

        // Received — loading state; continueAfterCookie already fired
        await ci.update({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [simplePanel(getColour(sess?.platform ?? 'reader'), '### Cookie received — verifying...')]
        });
        return;
    }

    if (ci.customId === 'lumen_bm_reset') {
        // Treat as clicking bookmarklet method again — reuse the ci
        ci.customId = 'lumen_method_bm';
        return handleEphemeralInteraction(ci, userId, collector);
    }

    if (ci.customId === 'lumen_verify_yes') {
        const sess = activeDashboardSessions.get(userId);
        if (!sess?.requesticator) {
            await ci.update({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [simplePanel(colours.light_red, '### Session lost\nRun `/dashboard` → Start Task again.')]
            });
            return;
        }

        await ci.update({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [simplePanel(getColour(sess.platform), '### Loading your library...')]
        });

        // Load user settings from DB
        try {
            const { checkAccount } = require('../database/accounts.js');
            const account = await checkAccount(userId);
            if (account?.sparx_reader_settings) {
                const s = account.sparx_reader_settings;
                sess.settings = { srp: s.srp ?? 300, wpm: s.wpm ?? 300, min: s.min ?? 10, max: s.max ?? 20 };
            }
        } catch {}

        try {
            await loadBooks(sess);
        } catch (err) {
            await ci.editReply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [simplePanel(colours.light_red, `### ❌ Failed to load library\n${err.message}`)]
            });
            return;
        }

        // Store updated ci for library panel interactions
        sess.interaction = ci;
        activeDashboardSessions.set(userId, sess);

        await ci.editReply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [buildLibraryPanel(sess)]
        });
        return;
    }

    if (ci.customId === 'lumen_verify_no') {
        activeDashboardSessions.delete(userId);
        await ci.update({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [simplePanel(colours.onyx, '### Cancelled')]
        });
        return;
    }

    if (ci.customId === 'lumen_verify_refresh') {
        const sess = activeDashboardSessions.get(userId);
        if (!sess?.requesticator) return;
        try {
            const userInfo = await sess.requesticator.getUserInfo();
            sess.userInfo = userInfo;
            await ci.update({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [buildVerifyAccount(userInfo, sess.platform)]
            });
        } catch (err) {
            await ci.update({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [simplePanel(colours.light_red, `### Refresh failed\n${err.message}`)]
            });
        }
        return;
    }

    if (ci.customId === 'lumen_book_select') {
        const sess = activeDashboardSessions.get(userId);
        if (!sess) return;
        const val = ci.values[0];
        if (val !== 'none') sess.selectedHomework = val;
        await ci.update({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [buildLibraryPanel(sess)]
        });
        return;
    }

    if (ci.customId === 'lumen_book_mode') {
        const sess = activeDashboardSessions.get(userId);
        if (!sess) return;
        sess.interaction = ci;
        activeDashboardSessions.set(userId, sess);

        const modal = new ModalBuilder()
            .setCustomId('lumen_mode_modal')
            .setTitle('Reading Mode');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('mode')
                    .setLabel('Mode')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Read Until Points Target Achieved  OR  Read Until Book Completed')
                    .setValue(sess.mode)
                    .setRequired(true)
            )
        );
        await ci.showModal(modal);
        return;
    }

    if (ci.customId === 'lumen_book_settings') {
        await ci.deferReply({ flags: MessageFlags.Ephemeral });
        const { settingsDisplayer } = require('../generic/settingsDisplayer.js');
        await settingsDisplayer(ci, 'sparx_reader');
        return;
    }

    if (ci.customId === 'lumen_book_start') {
        const sess = activeDashboardSessions.get(userId);
        if (!sess?.selectedHomework) return;

        await ci.update({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [buildLibraryPanel(sess, true)]
        });

        const userSessionShim = buildUserSessionShim(sess, ci);
        const queues = require('../queues/queues.js');
        const autocompleteWrapper = require('../utils/autocompleteWrapper.js');
        const autocomplete = require('../autocompleters/sparx/children/reader/autocomplete.js');
        const queueToUse = queues.get('sparx_reader');

        await queueToUse.addQueue({
            action: async () => autocompleteWrapper(ci, 'sparx(reader)', userSessionShim, () => autocomplete(userSessionShim)),
            id: userId,
            interaction: ci
        });
        return;
    }
}

// ---------------------------------------------------------------------------
// Called by web/dashboard.js when bookmarklet POSTs cookies
// ---------------------------------------------------------------------------
async function onCookieReceived(token, cookieString) {
    const pending = pendingSessions.get(token);
    if (!pending) return { ok: false, error: 'token_not_found' };

    pending.received = true;
    pending.cookieString = cookieString;

    setImmediate(() => continueAfterCookie(pending).catch(err => {
        console.error('[bookmarklet] continueAfterCookie error:', err);
    }));

    return { ok: true };
}

async function continueAfterCookie(pending) {
    const { token, userId, platform } = pending;
    const sess = activeDashboardSessions.get(userId) || {};
    const ci = pending.getInteraction?.() || sess.interaction;

    if (!ci) return;

    // Show loading
    await ci.editReply({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [simplePanel(getColour(platform), '### Verifying your Sparx account...')]
    }).catch(() => {});

    const getTokenRequest = require('../autocompleters/sparx/getTokenRequest.js');
    const SparxReader = require('../autocompleters/sparx/children/reader/requesticator.js');

    let authToken, requesticator, userInfo;
    try {
        authToken = await getTokenRequest(pending.cookieString);
        // Accept any non-empty string — the token format varies
        if (!authToken || (typeof authToken === 'string' && authToken.trim() === '') || authToken === 'null') {
            throw new Error(
                'Could not get auth token — make sure you\'re logged into Sparx Reader on the **same tab** where you clicked the bookmark, then try again.'
            );
        }

        requesticator = new SparxReader(authToken, {}, pending.cookieString);
        userInfo = await requesticator.getUserInfo();
        if (!userInfo) throw new Error('Could not retrieve user info from Sparx.');
    } catch (err) {
        await ci.editReply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [simplePanel(colours.light_red,
                `### ❌ Connection failed\n${err.message}\n\nMake sure you are logged into **Sparx Reader** and try the bookmarklet again.`
            )]
        }).catch(() => {});
        return;
    }

    const dn = await requesticator.getUserDisplayName().catch(() => null);
    Object.assign(sess, { platform, authToken, cookieString: pending.cookieString, requesticator, userInfo, userDisplayName: dn });
    activeDashboardSessions.set(userId, sess);
    pendingSessions.delete(token);

    await ci.editReply({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [buildVerifyAccount(userInfo, platform)]
    }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Modal submissions — called from index.js
// ---------------------------------------------------------------------------
async function handleModalSubmit(interaction) {
    const userId = interaction.user.id;

    if (interaction.customId.startsWith('lumen_login_cookie_')) {
        const platform = interaction.customId.replace('lumen_login_cookie_', '') || 'reader';
        const cookieString = interaction.fields.getTextInputValue('cookie').trim();

        const sess = activeDashboardSessions.get(userId) || {};
        sess.platform = platform;
        sess.cookieString = cookieString;
        const ci = sess.interaction || interaction;
        activeDashboardSessions.set(userId, sess);

        await ci.editReply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [simplePanel(getColour(platform), '### Verifying your Sparx account...')]
        }).catch(() => interaction.deferUpdate().catch(() => {}));

        const getTokenRequest = require('../autocompleters/sparx/getTokenRequest.js');
        const SparxReader = require('../autocompleters/sparx/children/reader/requesticator.js');

        try {
            const authToken = await getTokenRequest(cookieString);
            if (!authToken || authToken === 'null' || (typeof authToken === 'string' && !authToken.trim())) {
                throw new Error('Invalid cookie — check that it includes the full session string.');
            }
            const requesticator = new SparxReader(authToken, {}, cookieString);
            const userInfo = await requesticator.getUserInfo();
            if (!userInfo) throw new Error('Could not retrieve user info from Sparx.');
            const dn = await requesticator.getUserDisplayName().catch(() => null);
            Object.assign(sess, { authToken, requesticator, userInfo, userDisplayName: dn });
            activeDashboardSessions.set(userId, sess);
            await ci.editReply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [buildVerifyAccount(userInfo, platform)]
            }).catch(() => {});
        } catch (err) {
            await ci.editReply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [simplePanel(colours.light_red, `### ❌ Login failed\n${err.message}`)]
            }).catch(() => {});
        }

        await interaction.deferUpdate().catch(() => {});
        return;
    }

    if (interaction.customId === 'lumen_mode_modal') {
        const sess = activeDashboardSessions.get(userId);
        if (!sess) return;
        const raw = interaction.fields.getTextInputValue('mode').trim();
        const valid = ['Read Until Points Target Achieved', 'Read Until Book Completed'];
        const matched = valid.find(v => v.toLowerCase() === raw.toLowerCase());
        if (matched) sess.mode = matched;
        const ci = sess.interaction || interaction;
        await ci.editReply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [buildLibraryPanel(sess)]
        }).catch(() => {});
        await interaction.deferUpdate().catch(() => {});
        return;
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function loadBooks(sess) {
    const books = await sess.requesticator.getHomeworks();
    books.sort((a, b) => {
        if (a.setBook !== b.setBook) return a.setBook ? -1 : 1;
        return b.progress - a.progress;
    });
    sess.books = books;
    sess.bookNames = {};
    for (const b of books) sess.bookNames[b.bookId] = b.title;
    if (!sess.selectedHomework && books.length) sess.selectedHomework = books[0].bookId;
}

function buildUserSessionShim(sess, interaction) {
    return {
        interaction,
        platform: 'reader',
        requesticator: sess.requesticator,
        selectedHomework: sess.selectedHomework,
        bookNames: sess.bookNames,
        settings: sess.settings,
        mode: sess.mode,
        srp: sess.settings.srp,
        wpm: sess.settings.wpm,
        goldReader: false
    };
}

module.exports = { handleMainPanelClick, handleModalSubmit, onCookieReceived, pendingSessions };
