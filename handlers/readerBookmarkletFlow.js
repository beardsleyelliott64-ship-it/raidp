// language: JavaScript, file: handlers/readerBookmarkletFlow.js
// Manages the full Lumen-style Reader bookmarklet login + autocomplete flow.
// Exports: handleDashboardInteraction, pendingSessions (read by web/dashboard.js)

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
// Shared state: token → session object
// dashboard.js reads this map when the bookmarklet POST arrives.
// ---------------------------------------------------------------------------
const pendingSessions = new Map();

const PLATFORMS = [
    { label: 'Sparx Reader',  value: 'reader',  emoji: emojis.sparx_reader  || '📖', colour: 'sparx_reader'  },
    { label: 'Sparx Maths',   value: 'maths',   emoji: emojis.sparx_maths   || '📐', colour: 'sparx_maths'   },
    { label: 'Sparx Science', value: 'science', emoji: emojis.sparx_science  || '🔬', colour: 'sparx_science'  }
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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
    return crypto.randomBytes(5).toString('hex'); // 10 hex chars
}

function platformLabel(platform) {
    return PLATFORMS.find(x => x.value === platform)?.label ?? platform;
}

function separatedContainer(colour, content) {
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
                .setLabel(p.label)
                .setValue(p.value)
                .setEmoji(p.emoji)
        );
    }

    const colour = colours.sparx_reader;

    const panel = new ContainerBuilder()
        .setAccentColor(colour)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## Select Platform\nChoose which Sparx platform you want to autocomplete.')
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(new ActionRowBuilder().addComponents(select));

    return panel;
}

function buildMethodSelect(platform) {
    const colour = getColour(platform);
    const label = platformLabel(platform);

    const bmBtn = new ButtonBuilder()
        .setCustomId('lumen_method_bm')
        .setLabel('Bookmarklet (Recommended)')
        .setStyle(ButtonStyle.Success);

    const cookieBtn = new ButtonBuilder()
        .setCustomId('lumen_method_cookie')
        .setLabel('Cookies')
        .setStyle(ButtonStyle.Secondary);

    const backBtn = new ButtonBuilder()
        .setCustomId('lumen_start_task')
        .setLabel('Back')
        .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(bmBtn, cookieBtn, backBtn);

    const panel = new ContainerBuilder()
        .setAccentColor(colour)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## Lumen · ${label} — Other Login Options\n` +
                `Choose **Bookmarklet** for the easiest setup, or **Cookies** if you prefer manual entry.`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(row);

    return panel;
}

function buildBookmarkletTutorial(token, platform) {
    const colour = getColour(platform);
    const bm = `xjavascript:import('${hostUrl()}/bm/${token}')`;

    const refreshBtn = new ButtonBuilder()
        .setCustomId('lumen_bm_refresh')
        .setLabel('Refresh')
        .setStyle(ButtonStyle.Primary);

    const resetBtn = new ButtonBuilder()
        .setCustomId('lumen_bm_reset')
        .setLabel('Reset link')
        .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(refreshBtn, resetBtn);

    const panel = new ContainerBuilder()
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
            new TextDisplayBuilder().setContent(
                `**Waiting for you...** Click the bookmark in your Sparx tab, then press **Refresh**.`
            )
        )
        .addActionRowComponents(row);

    return panel;
}

function buildVerifyAccount(userInfo, platform) {
    const colour = getColour(platform);
    const name = `${userInfo.givenName || ''} ${userInfo.familyName || ''}`.trim() || userInfo.displayName || 'Unknown';
    const label = platformLabel(platform);

    const yesBtn = new ButtonBuilder()
        .setCustomId('lumen_verify_yes')
        .setLabel("Yes, that's me")
        .setStyle(ButtonStyle.Success);

    const noBtn = new ButtonBuilder()
        .setCustomId('lumen_verify_no')
        .setLabel('No, cancel')
        .setStyle(ButtonStyle.Danger);

    const refreshBtn = new ButtonBuilder()
        .setCustomId('lumen_verify_refresh')
        .setLabel('Refresh')
        .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(yesBtn, noBtn, refreshBtn);

    const panel = new ContainerBuilder()
        .setAccentColor(colour)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## Step 1 · Account\nHey **${name}**\n\n` +
                `Is this your Sparx account?\n\n` +
                `**Connected tab:** ${label}`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(row);

    return panel;
}

function buildLibraryPanel(userSession, disabled = false) {
    const colour = getColour(userSession.platform);
    const book = userSession.selectedHomework
        ? (userSession.bookNames?.[userSession.selectedHomework] || 'Selected book')
        : 'No book selected';

    const name = `${userSession.userInfo?.givenName || ''} ${userSession.userInfo?.familyName || ''}`.trim() || 'Reader';
    const noun = userSession.userDisplayName || 'Reader';

    const hero = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# Lumen · ${platformLabel(userSession.platform)}\n**Library & session control**\n\n` +
                `Welcome, **${name} the ${noun}**\n\n` +
                `**Selected:** ${book}`
            )
        )
        .setThumbnailAccessory(
            new ThumbnailBuilder({ media: { url: 'https://i.postimg.cc/cJQg4QDt/library-book.webp' } })
        );

    const target = new TextDisplayBuilder().setContent(
        `## Target\n**${userSession.settings.srp} SRP**  •  **${userSession.settings.wpm} WPM**\n` +
        `**Question window:** ${userSession.settings.min}–${userSession.settings.max}s\n` +
        `**Mode:** ${userSession.mode}`
    );

    // Book selector
    const select = new StringSelectMenuBuilder()
        .setCustomId('lumen_book_select')
        .setPlaceholder('Choose a book')
        .setMinValues(0)
        .setDisabled(disabled);

    if (userSession.books?.length) {
        for (const book of userSession.books) {
            const opt = new StringSelectMenuOptionBuilder()
                .setLabel(book.title)
                .setDescription(`${book.progress}%`)
                .setValue(book.bookId)
                .setDefault(userSession.selectedHomework === book.bookId);
            select.addOptions(opt);
        }
    } else {
        // placeholder so the menu renders
        select.addOptions(
            new StringSelectMenuOptionBuilder().setLabel('No books found').setValue('none')
        );
        select.setDisabled(true);
    }

    const startRow = new ActionRowBuilder();
    if (userSession.selectedHomework) {
        startRow.addComponents(
            new ButtonBuilder()
                .setCustomId('lumen_book_start')
                .setLabel('Start')
                .setStyle(ButtonStyle.Success)
                .setEmoji(emojis.tick || '✅')
                .setDisabled(disabled)
        );
    }
    startRow.addComponents(
        new ButtonBuilder()
            .setCustomId('lumen_book_mode')
            .setLabel('Mode')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId('lumen_book_settings')
            .setLabel('Settings')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(emojis.settings || '⚙️')
            .setDisabled(disabled)
    );

    const panel = new ContainerBuilder()
        .setAccentColor(colour)
        .addSectionComponents(hero)
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(target)
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## Choose a book\nSelect a Reader book below, then start the session.')
        )
        .addActionRowComponents(new ActionRowBuilder().addComponents(select))
        .addActionRowComponents(startRow);

    return panel;
}

function loadingPanel(platform, text = 'Starting session...') {
    return separatedContainer(getColour(platform), `### Lumen · ${platformLabel(platform)}\n${text}`);
}

// ---------------------------------------------------------------------------
// Session state storage per Discord user
// Holds the full user session object between interactions.
// ---------------------------------------------------------------------------
const activeDashboardSessions = new Map();
// userId → { platform, token, state, interaction (original reply), requesticator, userInfo, userDisplayName, books, bookNames, selectedHomework, settings, mode }

// ---------------------------------------------------------------------------
// Cookie login flow (bookmarklet POST received — called from web/dashboard.js)
// ---------------------------------------------------------------------------
async function onCookieReceived(token, cookieString) {
    const pending = pendingSessions.get(token);
    if (!pending) return { ok: false, error: 'token_not_found' };

    pending.cookieString = cookieString;
    pending.received = true;

    // Fire the Discord-side continuation asynchronously
    // so the HTTP response returns immediately.
    setImmediate(() => continueAfterCookie(pending).catch(err => {
        console.error('[bookmarklet] continueAfterCookie error:', err);
    }));

    return { ok: true };
}

async function continueAfterCookie(pending) {
    const { interaction, platform } = pending;

    // Show loading
    await interaction.editReply({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [loadingPanel(platform, 'Verifying your Sparx account...')]
    }).catch(() => {});

    // Build requesticator and get user info
    const getTokenRequest = require(`../autocompleters/sparx/getTokenRequest.js`);
    const SparxReader   = require(`../autocompleters/sparx/children/reader/requesticator.js`);

    let authToken, requesticator, userInfo;

    try {
        authToken = await getTokenRequest(pending.cookieString);
        if (!authToken || authToken.length < 50) throw new Error('Auth token invalid — are you logged into Sparx Reader?');

        requesticator = new SparxReader(authToken, {}, pending.cookieString);
        userInfo = await requesticator.getUserInfo();
        if (!userInfo) throw new Error('Could not retrieve user info from Sparx.');
    } catch (err) {
        const errPanel = separatedContainer(colours.light_red,
            `### ❌ Connection failed\n${err.message}\n\nMake sure you're logged into **Sparx Reader** and try the bookmarklet again.`
        );
        await interaction.editReply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [errPanel]
        }).catch(() => {});
        return;
    }

    // Store in dashboard session
    const userId = pending.userId;
    activeDashboardSessions.set(userId, {
        platform,
        token: pending.token,
        authToken,
        cookieString: pending.cookieString,
        requesticator,
        userInfo,
        userDisplayName: null,
        books: [],
        bookNames: {},
        selectedHomework: null,
        settings: { srp: 300, wpm: 300, min: 10, max: 20 },
        mode: 'Read Until Points Target Achieved',
        interaction
    });

    // Load display name
    try {
        const dn = await requesticator.getUserDisplayName();
        activeDashboardSessions.get(userId).userDisplayName = dn;
    } catch {}

    // Show verify panel
    await interaction.editReply({
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [buildVerifyAccount(userInfo, platform)]
    }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Main interaction dispatcher
// ---------------------------------------------------------------------------
async function handleDashboardInteraction(ci, originalInteraction) {
    const userId = ci.user.id;

    // ---- Start Task → platform selector ----
    if (ci.customId === 'lumen_start_task') {
        await ci.deferUpdate();
        await originalInteraction.editReply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [buildPlatformSelect()]
        });
        return;
    }

    // ---- Platform selected ----
    if (ci.customId === 'lumen_platform_select') {
        await ci.deferUpdate();
        const platform = ci.values[0];

        // Store chosen platform for this user
        activeDashboardSessions.set(userId, {
            ...(activeDashboardSessions.get(userId) || {}),
            platform,
            interaction: originalInteraction
        });

        await originalInteraction.editReply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [buildMethodSelect(platform)]
        });
        return;
    }

    // ---- Method: Cookie ----
    if (ci.customId === 'lumen_method_cookie') {
        const sess = activeDashboardSessions.get(userId);
        const platform = sess?.platform ?? 'reader';

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

    // ---- Method: Bookmarklet ----
    if (ci.customId === 'lumen_method_bm') {
        await ci.deferUpdate();

        const sess = activeDashboardSessions.get(userId);
        const platform = sess?.platform ?? 'reader';

        // Clean up any old token for this user
        if (sess?.token) pendingSessions.delete(sess.token);

        const token = makeToken();
        const expiry = Date.now() + 10 * 60 * 1000; // 10 min

        pendingSessions.set(token, {
            token,
            userId,
            platform,
            interaction: originalInteraction,
            received: false,
            cookieString: null,
            expires: expiry
        });

        activeDashboardSessions.set(userId, {
            ...(sess || {}),
            platform,
            token,
            interaction: originalInteraction
        });

        // Prune expired tokens
        for (const [t, v] of pendingSessions.entries()) {
            if (v.expires < Date.now()) pendingSessions.delete(t);
        }

        await originalInteraction.editReply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [buildBookmarkletTutorial(token, platform)]
        });
        return;
    }

    // ---- Bookmarklet: Refresh (poll for received cookie) ----
    if (ci.customId === 'lumen_bm_refresh') {
        await ci.deferUpdate();

        const sess = activeDashboardSessions.get(userId);
        const pending = sess?.token ? pendingSessions.get(sess.token) : null;

        if (!pending) {
            await originalInteraction.editReply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [separatedContainer(colours.light_red,
                    '### Session expired\nYour link has expired. Click **Reset link** to get a new one.'
                )]
            });
            return;
        }

        if (!pending.received) {
            // Not yet received — nudge and stay
            const platform = sess?.platform ?? 'reader';
            const panel = buildBookmarkletTutorial(sess.token, platform);
            await originalInteraction.editReply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [panel]
            });
            return;
        }

        // Cookie was received — continueAfterCookie is already running async,
        // the edit to verify panel will appear; just show a brief loading state.
        await originalInteraction.editReply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [loadingPanel(sess?.platform ?? 'reader', 'Cookie received — verifying...')]
        });
        return;
    }

    // ---- Bookmarklet: Reset link ----
    if (ci.customId === 'lumen_bm_reset') {
        // Treat same as clicking the bookmarklet method button — issue a fresh token
        ci.customId = 'lumen_method_bm';
        return handleDashboardInteraction(ci, originalInteraction);
    }

    // ---- Verify: Yes ----
    if (ci.customId === 'lumen_verify_yes') {
        await ci.deferUpdate();

        const sess = activeDashboardSessions.get(userId);
        if (!sess?.requesticator) {
            await originalInteraction.editReply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [separatedContainer(colours.light_red,
                    '### Session lost\nPlease run `/dashboard` again.'
                )]
            });
            return;
        }

        // Load account settings from DB if possible
        try {
            const { checkAccount } = require('../database/accounts.js');
            const account = await checkAccount(userId);
            if (account?.sparx_reader_settings) {
                const s = account.sparx_reader_settings;
                sess.settings = { srp: s.srp ?? 300, wpm: s.wpm ?? 300, min: s.min ?? 10, max: s.max ?? 20 };
            }
        } catch {}

        // Fetch books
        await originalInteraction.editReply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [loadingPanel(sess.platform, 'Loading your library...')]
        }).catch(() => {});

        try {
            await loadBooks(sess);
        } catch (err) {
            await originalInteraction.editReply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [separatedContainer(colours.light_red,
                    `### ❌ Failed to load library\n${err.message}`
                )]
            }).catch(() => {});
            return;
        }

        await originalInteraction.editReply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [buildLibraryPanel(sess)]
        }).catch(() => {});
        return;
    }

    // ---- Verify: No / cancel ----
    if (ci.customId === 'lumen_verify_no') {
        await ci.deferUpdate();
        activeDashboardSessions.delete(userId);
        await originalInteraction.editReply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [separatedContainer(colours.onyx, '### Cancelled\nRun `/dashboard` to start again.')]
        });
        return;
    }

    // ---- Verify: Refresh (re-fetch user info) ----
    if (ci.customId === 'lumen_verify_refresh') {
        await ci.deferUpdate();

        const sess = activeDashboardSessions.get(userId);
        if (!sess?.requesticator) return;

        try {
            const userInfo = await sess.requesticator.getUserInfo();
            sess.userInfo = userInfo;
            const dn = await sess.requesticator.getUserDisplayName().catch(() => null);
            if (dn) sess.userDisplayName = dn;

            await originalInteraction.editReply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [buildVerifyAccount(userInfo, sess.platform)]
            });
        } catch (err) {
            await originalInteraction.editReply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [separatedContainer(colours.light_red,
                    `### ❌ Refresh failed\n${err.message}`
                )]
            });
        }
        return;
    }

    // ---- Library: Book selected ----
    if (ci.customId === 'lumen_book_select') {
        await ci.deferUpdate();

        const sess = activeDashboardSessions.get(userId);
        if (!sess) return;

        const val = ci.values[0];
        if (val === 'none') return;
        sess.selectedHomework = val;

        await originalInteraction.editReply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [buildLibraryPanel(sess)]
        });
        return;
    }

    // ---- Library: Mode ----
    if (ci.customId === 'lumen_book_mode') {
        const sess = activeDashboardSessions.get(userId);
        if (!sess) return;

        const modal = new ModalBuilder()
            .setCustomId('lumen_mode_modal')
            .setTitle('Reading Mode');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('mode')
                    .setLabel('Mode (type exactly one option)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Read Until Points Target Achieved  OR  Read Until Book Completed')
                    .setValue(sess.mode)
                    .setRequired(true)
            )
        );

        await ci.showModal(modal);
        return;
    }

    // ---- Library: Settings ----
    if (ci.customId === 'lumen_book_settings') {
        await ci.deferReply({ flags: MessageFlags.Ephemeral });

        const { settingsDisplayer } = require('../generic/settingsDisplayer.js');
        await settingsDisplayer(ci, 'sparx_reader');
        return;
    }

    // ---- Library: Start ----
    if (ci.customId === 'lumen_book_start') {
        await ci.deferUpdate();

        const sess = activeDashboardSessions.get(userId);
        if (!sess?.selectedHomework) return;

        // Disable the panel while running
        await originalInteraction.editReply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [buildLibraryPanel(sess, true)]
        }).catch(() => {});

        // Wire up a fake userSession compatible with the existing autocomplete
        const userSessionShim = buildUserSessionShim(sess, originalInteraction);

        const queues = require('../queues/queues.js');
        const autocompleteWrapper = require('../utils/autocompleteWrapper.js');
        const autocomplete = require('../autocompleters/sparx/children/reader/autocomplete.js');
        const queueToUse = queues.get('sparx_reader');

        await queueToUse.addQueue({
            action: async () => {
                return await autocompleteWrapper(
                    originalInteraction,
                    'sparx(reader)',
                    userSessionShim,
                    () => autocomplete(userSessionShim)
                );
            },
            id: userId,
            interaction: originalInteraction
        });
        return;
    }
}

// ---------------------------------------------------------------------------
// Handle modal submissions from the dashboard flow.
// Add this check inside index.js's isModalSubmit handler, before the
// autocompleterModule_ block:
//   if (interaction.customId.startsWith('lumen_')) {
//       await require('./handlers/readerBookmarkletFlow.js').handleModalSubmit(interaction);
//       return;
//   }
// ---------------------------------------------------------------------------
async function handleModalSubmit(interaction) {
    const userId = interaction.user.id;

    // Cookie login modal
    if (interaction.customId.startsWith('lumen_login_cookie_')) {
        await interaction.deferUpdate().catch(() => interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {}));

        const platform = interaction.customId.replace('lumen_login_cookie_', '') || 'reader';
        const cookieString = interaction.fields.getTextInputValue('cookie').trim();

        const sess = activeDashboardSessions.get(userId) || {};
        sess.platform = platform;
        sess.cookieString = cookieString;
        activeDashboardSessions.set(userId, sess);

        const originalInteraction = sess.interaction || interaction;

        // Show loading
        await originalInteraction.editReply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [loadingPanel(platform, 'Verifying your Sparx account...')]
        }).catch(() => {});

        const getTokenRequest = require(`../autocompleters/sparx/getTokenRequest.js`);
        const SparxReader   = require(`../autocompleters/sparx/children/reader/requesticator.js`);

        try {
            const authToken = await getTokenRequest(cookieString);
            if (!authToken || authToken.length < 50) throw new Error('Invalid token — make sure your cookies are correct.');

            const requesticator = new SparxReader(authToken, {}, cookieString);
            const userInfo = await requesticator.getUserInfo();
            if (!userInfo) throw new Error('Could not retrieve user info from Sparx.');

            const dn = await requesticator.getUserDisplayName().catch(() => null);

            Object.assign(sess, { authToken, requesticator, userInfo, userDisplayName: dn });
            activeDashboardSessions.set(userId, sess);

            await originalInteraction.editReply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [buildVerifyAccount(userInfo, platform)]
            });
        } catch (err) {
            await originalInteraction.editReply({
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [separatedContainer(colours.light_red,
                    `### ❌ Login failed\n${err.message}`
                )]
            }).catch(() => {});
        }
        return;
    }

    // Mode change modal
    if (interaction.customId === 'lumen_mode_modal') {
        await interaction.deferUpdate().catch(() => {});

        const sess = activeDashboardSessions.get(userId);
        if (!sess) return;

        const raw = interaction.fields.getTextInputValue('mode').trim();
        const valid = ['Read Until Points Target Achieved', 'Read Until Book Completed'];
        const matched = valid.find(v => v.toLowerCase() === raw.toLowerCase());
        if (matched) sess.mode = matched;

        const originalInteraction = sess.interaction || interaction;
        await originalInteraction.editReply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [buildLibraryPanel(sess)]
        }).catch(() => {});
        return;
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function loadBooks(sess) {
    const books = await sess.requesticator.getHomeworks();

    // Sort: set books first, then by progress desc
    books.sort((a, b) => {
        if (a.setBook !== b.setBook) return a.setBook ? -1 : 1;
        return b.progress - a.progress;
    });

    sess.books = books;
    sess.bookNames = {};
    for (const b of books) {
        sess.bookNames[b.bookId] = b.title;
    }

    // Auto-select first
    if (!sess.selectedHomework && books.length) {
        sess.selectedHomework = books[0].bookId;
    }
}

function buildUserSessionShim(sess, interaction) {
    // Minimal object matching what the existing autocomplete.js expects
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

module.exports = { handleDashboardInteraction, handleModalSubmit, onCookieReceived, pendingSessions };
