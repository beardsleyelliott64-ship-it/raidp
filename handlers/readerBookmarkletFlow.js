// language: JavaScript, file: handlers/readerBookmarkletFlow.js
'use strict';

const crypto = require('node:crypto');
const {
    ContainerBuilder, TextDisplayBuilder, ThumbnailBuilder, SectionBuilder,
    SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder,
    ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');

const { colours, emojis } = require('../config.json');
const { getTokenNative, userInfoFromJwt } = require('../utils/readerNativeAuth.js');

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------
const pendingSessions    = new Map(); // token → pending bookmarklet session
const activeDashboardSessions = new Map(); // userId → session object

const PLATFORMS = [
    { label: 'Sparx Reader',  value: 'reader',  emoji: emojis.sparx_reader,  colour: 'sparx_reader'  },
    { label: 'Sparx Maths',   value: 'maths',   emoji: emojis.sparx_maths,   colour: 'sparx_maths'   },
    { label: 'Sparx Science', value: 'science', emoji: emojis.sparx_science,  colour: 'sparx_science'  }
];

function getColour(p)     { return colours[PLATFORMS.find(x => x.value === p)?.colour ?? 'sparx_reader'] ?? colours.sparx_reader; }
function platformLabel(p) { return PLATFORMS.find(x => x.value === p)?.label ?? p; }
function makeToken()      { return crypto.randomBytes(5).toString('hex'); }
function hostUrl()        { return (process.env.RENDER_EXTERNAL_URL || process.env.BOT_PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, ''); }

function simplePanel(colour, content) {
    return new ContainerBuilder().setAccentColor(colour)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

// ---------------------------------------------------------------------------
// Shared auth helper — used by both bookmarklet and cookie paths
// Accepts either a pre-fetched JWT (bookmarklet) or a cookie string (manual).
// Returns { jwt, userInfo } or throws with a human-readable message.
// ---------------------------------------------------------------------------
async function resolveAuth(input, inputType /* 'jwt' | 'cookie' */) {
    let jwt;

    if (inputType === 'jwt') {
        jwt = input.trim();
        if (!jwt || jwt.startsWith('{') || !jwt.includes('.')) {
            throw new Error(
                'The bookmarklet could not get your auth token. ' +
                'Make sure you are **fully signed into Sparx Reader** (you can see your books) and try again.'
            );
        }
    } else {
        // cookie string — fetch token natively, no Python needed
        try {
            jwt = await getTokenNative(input);
        } catch (err) {
            throw new Error(
                `Could not exchange cookies for an auth token: ${err.message}\n\n` +
                'Make sure the cookies are fresh and include both `live_ssoprovider_session` and `spxlrn_session`.'
            );
        }
        if (!jwt || jwt.startsWith('{') || !jwt.includes('.')) {
            throw new Error(
                'Cookies were accepted but Sparx returned an unexpected token. ' +
                'The cookies may have expired — grab fresh ones and try again.'
            );
        }
    }

    // Decode user info from JWT claims — no gRPC call, no Python needed here
    const userInfo = userInfoFromJwt(jwt);

    // If JWT claims had no name at all, still continue — name will show as "Unknown"
    return { jwt, userInfo };
}

// ---------------------------------------------------------------------------
// UI builders
// ---------------------------------------------------------------------------
function buildPlatformSelect() {
    const select = new StringSelectMenuBuilder()
        .setCustomId('lumen_platform_select').setPlaceholder('Choose a platform...');
    for (const p of PLATFORMS)
        select.addOptions(new StringSelectMenuOptionBuilder().setLabel(p.label).setValue(p.value).setEmoji(p.emoji));
    return new ContainerBuilder().setAccentColor(colours.sparx_reader)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Select Platform\nChoose which Sparx platform to autocomplete.'))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(new ActionRowBuilder().addComponents(select));
}

function buildMethodSelect(platform) {
    return new ContainerBuilder().setAccentColor(getColour(platform))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## Lumen · ${platformLabel(platform)} — Other Login Options\n` +
            `Choose **Bookmarklet** for the easiest setup, or **Cookies** if you prefer manual entry.`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('lumen_method_bm').setLabel('Bookmarklet (Recommended)').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('lumen_method_cookie').setLabel('Cookies').setEmoji(emojis.cookies).setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('lumen_back_platform').setLabel('Back').setEmoji(emojis.arrow_left).setStyle(ButtonStyle.Secondary)
        ));
}

function buildBookmarkletTutorial(token, platform) {
    const bm = `xjavascript:import('${hostUrl()}/bm/${token}')`;
    return new ContainerBuilder().setAccentColor(getColour(platform))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
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
            `• Open **Sparx Reader** and sign in fully\n` +
            `• Click your **Lumen** bookmark\n` +
            `• Wait for the green ✓ box, then press **Refresh** below\n\n` +
            `\`\`\`\n${bm}\n\`\`\`\n*Hold to copy on mobile*`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            '**Waiting for you...** Click the bookmark in your Sparx tab, then press **Refresh**.'
        ))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('lumen_bm_refresh').setLabel('Refresh').setEmoji(emojis.retry).setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('lumen_bm_reset').setLabel('Reset link').setEmoji(emojis.x).setStyle(ButtonStyle.Secondary)
        ));
}

function buildVerifyAccount(userInfo, platform) {
    const given  = userInfo.givenName  || userInfo.given_name  || '';
    const family = userInfo.familyName || userInfo.family_name || '';
    const name   = `${given} ${family}`.trim() || userInfo.displayName || userInfo.display_name || 'Unknown';
    return new ContainerBuilder().setAccentColor(getColour(platform))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## Step 1 · Account\nHey **${name}**\n\nIs this your Sparx account?\n\n**Connected tab:** ${platformLabel(platform)}`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('lumen_verify_yes').setLabel("Yes, that's me").setEmoji(emojis.tick).setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('lumen_verify_no').setLabel('No, cancel').setEmoji(emojis.x).setStyle(ButtonStyle.Danger)
        ));
}

function buildLibraryPanel(sess, disabled = false) {
    const _g   = sess.userInfo?.givenName  || sess.userInfo?.given_name  || '';
    const _f   = sess.userInfo?.familyName || sess.userInfo?.family_name || '';
    const name = `${_g} ${_f}`.trim() || sess.userInfo?.displayName || sess.userInfo?.display_name || 'Reader';
    const hero = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# Lumen · ${platformLabel(sess.platform)}\nWelcome, **${name}**\n\n` +
            `**SRP Target:** ${sess.settings.srp}  •  **WPM:** ${sess.settings.wpm}\n` +
            `**Question window:** ${sess.settings.min}–${sess.settings.max}s\n` +
            `**Mode:** ${sess.mode}`
        ))
        .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: 'https://i.postimg.cc/Y9j7vShY/0H0TBp3.png' } }));

    const select = new StringSelectMenuBuilder()
        .setCustomId('lumen_book_select').setPlaceholder('Choose a book').setMinValues(0).setDisabled(disabled);

    if (sess.books?.length) {
        for (const book of sess.books)
            select.addOptions(new StringSelectMenuOptionBuilder()
                .setLabel(book.title).setDescription(`${book.progress ?? 0}%`)
                .setValue(book.bookId).setDefault(sess.selectedHomework === book.bookId));
    } else {
        select.addOptions(new StringSelectMenuOptionBuilder().setLabel('No books found').setValue('none'));
        select.setDisabled(true);
    }

    const actionRow = new ActionRowBuilder();
    if (sess.selectedHomework)
        actionRow.addComponents(new ButtonBuilder().setCustomId('lumen_book_start').setLabel('Start')
            .setEmoji(emojis.tick).setStyle(ButtonStyle.Success).setDisabled(disabled));
    actionRow.addComponents(
        new ButtonBuilder().setCustomId('lumen_book_mode').setLabel('Mode').setEmoji(emojis.mode).setStyle(ButtonStyle.Primary).setDisabled(disabled),
        new ButtonBuilder().setCustomId('lumen_book_settings').setLabel('Settings').setEmoji(emojis.settings).setStyle(ButtonStyle.Secondary).setDisabled(disabled)
    );

    return new ContainerBuilder().setAccentColor(getColour(sess.platform))
        .addSectionComponents(hero)
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Choose a book'))
        .addActionRowComponents(new ActionRowBuilder().addComponents(select))
        .addActionRowComponents(actionRow);
}

// ---------------------------------------------------------------------------
// Main panel (channel message) collector
// ---------------------------------------------------------------------------
async function handleMainPanelClick(ci) {
    const userId = ci.user.id;

    if (ci.customId === 'lumen_start_task') {
        const msg = await ci.reply({
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [buildPlatformSelect()], fetchReply: true
        });
        spawnEphemeralCollector(msg, userId);
        return;
    }

    if (ci.customId === 'lumen_saved_accounts') {
        const { executeViewAccounts } = require('../handlers/savedAccountsHandler.js');
        await ci.deferReply({ flags: MessageFlags.Ephemeral });
        await executeViewAccounts(ci);
        return;
    }

    if (ci.customId === 'lumen_check_queue') {
        const queues = require('../queues/queues.js');
        const lines = [];
        try { for (const [n, q] of Object.entries(queues.getAll?.() || {})) lines.push(`**${n}:** ${q.length?.() ?? '?'} in queue`); } catch {}
        await ci.reply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [simplePanel(colours.sparx_reader, `## Queue Status\n${lines.length ? lines.join('\n') : 'All queues empty.'}`)] });
        return;
    }

    if (ci.customId === 'lumen_check_account') {
        await ci.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const { checkAccount } = require('../database/accounts.js');
            const account = await checkAccount(userId);
            await ci.editReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [simplePanel(colours.sparx_reader,
                    account ? `## Your Account\n**Discord ID:** ${userId}\n**Slots used:** ${JSON.stringify(account.uses ?? {})}`
                            : '## No Account\nRun `/account` to set one up.'
                )] });
        } catch (e) { await ci.editReply({ content: `Error: ${e.message}` }); }
        return;
    }

    if (ci.customId === 'lumen_settings') {
        await ci.deferReply({ flags: MessageFlags.Ephemeral });
        await require('../generic/settingsDisplayer.js').settingsDisplayer(ci, 'sparx_reader');
        return;
    }

    if (ci.customId === 'lumen_help') {
        await ci.reply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [simplePanel(colours.sparx_reader,
                `## Help\n**Start Task** — connect to Sparx Reader and autocomplete your homework\n` +
                `**Saved Accounts** — view and manage saved login accounts\n` +
                `**Settings** — adjust SRP target, WPM, question timing\n` +
                `**Check Account** — view your bot account details\n` +
                `**Check Queue** — see how many people are ahead of you\n\n` +
                `Having issues? Make sure you are fully signed into Sparx Reader before clicking the bookmarklet.`
            )] });
        return;
    }
}

// ---------------------------------------------------------------------------
// Ephemeral flow
// ---------------------------------------------------------------------------
function spawnEphemeralCollector(msg, userId) {
    const collector = msg.createMessageComponentCollector({ time: 600_000 });
    collector.on('collect', async (ci) => {
        try { await handleEphemeralInteraction(ci, userId, collector); }
        catch (err) {
            console.error('[lumen:ephemeral]', err);
            try {
                const p = { content: `Error: ${err.message}`, flags: MessageFlags.Ephemeral };
                if (ci.replied || ci.deferred) await ci.followUp(p); else await ci.reply(p);
            } catch {}
        }
    });
}

async function handleEphemeralInteraction(ci, userId, collector) {
    const sess = () => activeDashboardSessions.get(userId) || {};
    const setSess = (data) => activeDashboardSessions.set(userId, { ...sess(), ...data });

    if (ci.customId === 'lumen_platform_select') {
        setSess({ platform: ci.values[0] });
        await ci.update({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [buildMethodSelect(ci.values[0])] });
        return;
    }

    if (ci.customId === 'lumen_back_platform') {
        await ci.update({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [buildPlatformSelect()] });
        return;
    }

    if (ci.customId === 'lumen_method_bm') {
        const s = sess();
        const platform = s.platform ?? 'reader';
        if (s.token) pendingSessions.delete(s.token);
        const token = makeToken();
        setSess({ token, platform, interaction: ci });
        pendingSessions.set(token, {
            token, userId, platform,
            getInteraction: () => activeDashboardSessions.get(userId)?.interaction,
            received: false, jwt: null, cookieString: null,
            expires: Date.now() + 10 * 60 * 1000
        });
        for (const [t, v] of pendingSessions) if (v.expires < Date.now()) pendingSessions.delete(t);
        await ci.update({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [buildBookmarkletTutorial(token, platform)] });
        return;
    }

    if (ci.customId === 'lumen_method_cookie') {
        setSess({ interaction: ci });
        const modal = new ModalBuilder().setCustomId(`lumen_login_cookie_${sess().platform ?? 'reader'}`).setTitle('Login with Cookie');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('cookie').setLabel('Sparx Cookie')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('live_ssoprovider_session=...; spxlrn_session=...')
                .setRequired(true)
        ));
        await ci.showModal(modal);
        return;
    }

    if (ci.customId === 'lumen_bm_refresh') {
        const s = sess();
        const pending = s.token ? pendingSessions.get(s.token) : null;
        if (!pending || pending.expires < Date.now()) {
            await ci.update({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [simplePanel(colours.light_red, '### Session expired\nPress **Reset link** to get a new one.')] });
            return;
        }
        if (!pending.received) {
            await ci.update({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [buildBookmarkletTutorial(s.token, s.platform ?? 'reader')] });
            return;
        }
        await ci.update({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [simplePanel(getColour(s.platform ?? 'reader'), '### Verifying your Sparx account...')] });
        return;
    }

    if (ci.customId === 'lumen_bm_reset') {
        ci.customId = 'lumen_method_bm';
        return handleEphemeralInteraction(ci, userId, collector);
    }

    if (ci.customId === 'lumen_verify_yes') {
        const s = sess();
        if (!s.jwt) {
            await ci.update({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [simplePanel(colours.light_red, '### Session lost\nRun `/dashboard` → Start Task again.')] });
            return;
        }
        await ci.update({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [simplePanel(getColour(s.platform), '### Loading your library...')] });

        // Load saved settings
        try {
            const { checkAccount } = require('../database/accounts.js');
            const account = await checkAccount(userId);
            if (account?.sparx_reader_settings) {
                const st = account.sparx_reader_settings;
                s.settings = { srp: st.srp ?? 300, wpm: st.wpm ?? 300, min: st.min ?? 10, max: st.max ?? 20 };
            }
        } catch {}

        // Build requesticator if not already present (bookmarklet path pre-builds it)
        try {
            if (!s.requesticator) {
                const SparxReader = require('../autocompleters/sparx/children/reader/requesticator.js');
                s.requesticator = new SparxReader(s.jwt, {}, s.cookieString || '');
            }
            await loadBooks(s);
        } catch (err) {
            await ci.editReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [simplePanel(colours.light_red, `### ❌ Failed to load library\n${err.message}`)] });
            return;
        }

        s.interaction = ci;
        activeDashboardSessions.set(userId, s);
        await ci.editReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [buildLibraryPanel(s)] });
        return;
    }

    if (ci.customId === 'lumen_verify_no') {
        activeDashboardSessions.delete(userId);
        await ci.update({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [simplePanel(colours.onyx, '### Cancelled')] });
        return;
    }

    if (ci.customId === 'lumen_book_select') {
        const s = sess();
        if (!s) return;
        const val = ci.values[0];
        if (val !== 'none') s.selectedHomework = val;
        activeDashboardSessions.set(userId, s);
        await ci.update({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [buildLibraryPanel(s)] });
        return;
    }

    if (ci.customId === 'lumen_book_mode') {
        const s = sess();
        s.interaction = ci;
        activeDashboardSessions.set(userId, s);
        const modal = new ModalBuilder().setCustomId('lumen_mode_modal').setTitle('Reading Mode');
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('mode').setLabel('Mode')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Read Until Points Target Achieved  OR  Read Until Book Completed')
                .setValue(s.mode).setRequired(true)
        ));
        await ci.showModal(modal);
        return;
    }

    if (ci.customId === 'lumen_book_settings') {
        await ci.deferReply({ flags: MessageFlags.Ephemeral });
        await require('../generic/settingsDisplayer.js').settingsDisplayer(ci, 'sparx_reader');
        return;
    }

    if (ci.customId === 'lumen_book_start') {
        const s = sess();
        if (!s?.selectedHomework) return;
        await ci.update({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [buildLibraryPanel(s, true)] });
        const userSessionShim = buildUserSessionShim(s, ci);
        const queues           = require('../queues/queues.js');
        const autocompleteWrapper = require('../utils/autocompleteWrapper.js');
        const autocomplete     = require('../autocompleters/sparx/children/reader/autocomplete.js');
        await queues.get('sparx_reader').addQueue({
            action: async () => autocompleteWrapper(ci, 'sparx(reader)', userSessionShim, () => autocomplete(userSessionShim)),
            id: userId, interaction: ci
        });
        return;
    }
}

// ---------------------------------------------------------------------------
// Bookmarklet POST handler (called from web/dashboard.js)
// Receives the JWT the browser fetched directly from Sparx
// ---------------------------------------------------------------------------
async function onCookieReceived(token, jwt, cookieString) {
    const pending = pendingSessions.get(token);
    if (!pending) return { ok: false, error: 'token_not_found' };

    pending.received     = true;
    pending.jwt          = jwt          || null;
    pending.cookieString = cookieString || null;

    setImmediate(() => continueAfterBookmarklet(pending).catch(err => {
        console.error('[bookmarklet]', err);
    }));

    return { ok: true };
}

async function continueAfterBookmarklet(pending) {
    const { userId, platform } = pending;
    const s  = activeDashboardSessions.get(userId) || {};
    const ci = pending.getInteraction?.() || s.interaction;
    if (!ci) return;

    await ci.editReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        components: [simplePanel(getColour(platform), '### Verifying your Sparx account...')] }).catch(() => {});

    try {
        let jwt = pending.jwt;
        const cookieString = pending.cookieString || '';

        // Resolve JWT — from bookmarklet (direct) or from cookie exchange
        if (jwt) {
            // Validate it looks like a JWT
            if (!jwt.includes('.') || jwt.startsWith('{')) {
                throw new Error(
                    'The bookmarklet returned an unexpected token. ' +
                    'Make sure you are **fully signed into Sparx Reader** and try again.'
                );
            }
        } else if (cookieString) {
            // Fallback: exchange cookies natively
            jwt = await getTokenNative(cookieString);
            if (!jwt || jwt.startsWith('{')) {
                throw new Error('Could not get auth token from cookies. Try the bookmarklet again.');
            }
        } else {
            throw new Error('No auth data received from the bookmarklet.');
        }

        // Build requesticator with JWT + cookies (Python needed for gRPC)
        const SparxReader   = require('../autocompleters/sparx/children/reader/requesticator.js');
        const requesticator = new SparxReader(jwt, {}, cookieString);

        // Try to get real name via gRPC getUserInfo — fall back to JWT claims if Python slow
        let userInfo;
        try {
            userInfo = await Promise.race([
                requesticator.getUserInfo(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
            ]);
        } catch {
            // Python microservice not ready or slow — use JWT claims as fallback
            userInfo = userInfoFromJwt(jwt);
        }

        // If gRPC returned nothing useful, try JWT claims
        if (!userInfo || (!userInfo.givenName && !userInfo.displayName && !userInfo.given_name)) {
            const fromJwt = userInfoFromJwt(jwt);
            if (fromJwt.givenName || fromJwt.displayName) userInfo = fromJwt;
        }

        // Store requesticator so library load can use it immediately
        Object.assign(s, {
            platform, jwt, cookieString, requesticator, userInfo,
            settings: s.settings || { srp: 300, wpm: 300, min: 10, max: 20 },
            mode: s.mode || 'Read Until Points Target Achieved'
        });
        activeDashboardSessions.set(userId, s);
        pendingSessions.delete(pending.token);

        await ci.editReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [buildVerifyAccount(userInfo, platform)] }).catch(() => {});

    } catch (err) {
        await ci.editReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [simplePanel(colours.light_red, `### ❌ Connection failed\n${err.message}`)] }).catch(() => {});
    }
}

// ---------------------------------------------------------------------------
// Modal submissions
// ---------------------------------------------------------------------------
async function handleModalSubmit(interaction) {
    const userId = interaction.user.id;

    if (interaction.customId.startsWith('lumen_login_cookie_')) {
        const platform     = interaction.customId.replace('lumen_login_cookie_', '') || 'reader';
        const cookieString = interaction.fields.getTextInputValue('cookie').trim();
        const s            = activeDashboardSessions.get(userId) || {};
        s.platform         = platform;
        const ci           = s.interaction || interaction;
        activeDashboardSessions.set(userId, s);

        await ci.editReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [simplePanel(getColour(platform), '### Verifying your Sparx account...')] })
            .catch(() => interaction.deferUpdate().catch(() => {}));

        try {
            const { jwt, userInfo } = await resolveAuth(cookieString, 'cookie');
            Object.assign(s, { jwt, cookieString, userInfo,
                settings: s.settings || { srp: 300, wpm: 300, min: 10, max: 20 },
                mode: s.mode || 'Read Until Points Target Achieved' });
            activeDashboardSessions.set(userId, s);
            await ci.editReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [buildVerifyAccount(userInfo, platform)] }).catch(() => {});
        } catch (err) {
            await ci.editReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [simplePanel(colours.light_red, `### ❌ Login failed\n${err.message}`)] }).catch(() => {});
        }

        await interaction.deferUpdate().catch(() => {});
        return;
    }

    if (interaction.customId === 'lumen_mode_modal') {
        const s = activeDashboardSessions.get(userId);
        if (!s) return;
        const raw     = interaction.fields.getTextInputValue('mode').trim();
        const valid   = ['Read Until Points Target Achieved', 'Read Until Book Completed'];
        const matched = valid.find(v => v.toLowerCase() === raw.toLowerCase());
        if (matched) s.mode = matched;
        const ci = s.interaction || interaction;
        await ci.editReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [buildLibraryPanel(s)] }).catch(() => {});
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
    sess.books    = books;
    sess.bookNames = {};
    for (const b of books) sess.bookNames[b.bookId] = b.title;
    if (!sess.selectedHomework && books.length) sess.selectedHomework = books[0].bookId;
}

function buildUserSessionShim(sess, interaction) {
    return {
        interaction, platform: 'reader',
        requesticator: sess.requesticator,
        selectedHomework: sess.selectedHomework,
        bookNames:  sess.bookNames,
        settings:   sess.settings,
        mode:       sess.mode,
        srp:        sess.settings.srp,
        wpm:        sess.settings.wpm,
        goldReader: false
    };
}

module.exports = { handleMainPanelClick, handleModalSubmit, onCookieReceived, pendingSessions };
