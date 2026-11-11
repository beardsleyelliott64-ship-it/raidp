// language: JavaScript, file: handlers/readerBookmarkletFlow.js
'use strict';

const crypto = require('node:crypto');
const {
    ContainerBuilder, TextDisplayBuilder, ThumbnailBuilder, SectionBuilder,
    SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder,
    ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle,
    MediaGalleryBuilder, MediaGalleryItemBuilder
} = require('discord.js');

const { colours, emojis } = require('../config.json');
const { getTokenNative, getNativeUserInfo, getNativeHomeworks, userInfoFromJwt } = require('../utils/readerNativeAuth.js');

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
function progressImageUrl(key) {
    const publicBase = process.env.RENDER_EXTERNAL_URL || process.env.BOT_PUBLIC_URL;
    return publicBase ? `${publicBase.replace(/\/$/, '')}/progress/${key}.png` : null;
}

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
            new ButtonBuilder().setCustomId('lumen_method_normal').setLabel('Normal Sparx Login').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('lumen_method_bm').setLabel('Bookmarklet').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('lumen_method_cookie').setLabel('Cookies').setEmoji(emojis.cookies).setStyle(ButtonStyle.Secondary)
        ))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('lumen_back_platform').setLabel('Back').setEmoji(emojis.arrow_left).setStyle(ButtonStyle.Secondary)
        ));
}

// Render the original glossy blue pill as a genuinely small PNG. Keeping the
// image at a 50:1 aspect ratio prevents Discord's gallery from reserving a huge box.
function crc32(buffer) {
    let c = 0xffffffff;
    for (const byte of buffer) {
        c ^= byte;
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (c ^ 0xffffffff) >>> 0;
}
function makePngChunk(type, data) {
    const name = Buffer.from(type);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const crcInput = Buffer.concat([name, data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(crcInput));
    return Buffer.concat([length, name, data, crc]);
}
function renderLoginProgressPng(percent) {
    const width = 900, height = 18, value = Math.max(0, Math.min(100, percent)) / 100;
    const raw = Buffer.alloc((width * 4 + 1) * height);
    const clamp = n => Math.max(0, Math.min(255, Math.round(n)));
    const mix = (a, b, t) => a + (b - a) * t;
    for (let y = 0; y < height; y++) {
        const row = y * (width * 4 + 1); raw[row] = 0;
        for (let x = 0; x < width; x++) {
            const i = row + 1 + x * 4;
            const nx = (x + 0.5) / width, ny = (y + 0.5) / height;
            const radius = 8;
            const inCorner = (cx, cy) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= radius;
            const inside = (x >= radius || y >= radius || x < width-radius || y < height-radius ||
                inCorner(radius, radius) && x < radius && y < radius ||
                inCorner(width-radius, radius) && x >= width-radius && y < radius ||
                inCorner(radius, height-radius) && x < radius && y >= height-radius ||
                inCorner(width-radius, height-radius) && x >= width-radius && y >= height-radius);
            if (!inside) { raw[i + 3] = 0; continue; }
            const filled = nx <= value && value > 0;
            let r, g, b;
            if (filled) {
                r = mix(105, 0, nx); g = mix(195, 105, nx); b = 255;
                const gloss = ny < 0.48 ? 0.24 * (1 - ny / 0.48) : 0;
                r = mix(r, 255, gloss); g = mix(g, 255, gloss); b = mix(b, 255, gloss);
                const shade = ny > 0.72 ? (ny - 0.72) * 0.35 : 0;
                r *= 1-shade; g *= 1-shade; b *= 1-shade;
            } else {
                const shade = ny < 0.5 ? 1 : 0.86;
                r = 43*shade; g = 49*shade; b = 61*shade;
            }
            raw[i] = clamp(r); raw[i+1] = clamp(g); raw[i+2] = clamp(b); raw[i+3] = 255;
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
    ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;
    return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
        makePngChunk('IHDR', ihdr), makePngChunk('IDAT', require('node:zlib').deflateSync(raw)),
        makePngChunk('IEND', Buffer.alloc(0))]);
}
function buildLoginProgress(platform, percent, status, imageUrl) {
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    const card = new ContainerBuilder().setAccentColor(getColour(platform))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## Lumen · Signing you in\n**${value}%**\n_${status}_`
        ));
    if (imageUrl) card.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(imageUrl).setDescription('Login progress')
    ));
    return card;
}

function buildNormalLoginModal(platform) {
    const modal = new ModalBuilder().setCustomId(`lumen_login_normal_${platform}`).setTitle('Normal Sparx Login');
    modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('school').setLabel('School name').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('username').setLabel('Sparx username / email').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('password').setLabel('Sparx password').setStyle(TextInputStyle.Short).setRequired(true))
    );
    return modal;
}

function buildBookmarkletTutorial(token, platform) {
    const bm = `xjavascript:(()=>{const s=document.createElement('script');s.src='${hostUrl()}/bm/${token}';s.async=true;document.documentElement.appendChild(s)})()`;
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
    const name   = `${given} ${family}`.trim() || userInfo.displayName || userInfo.display_name || '';
    const greeting = name ? `Hey **${name}**` : '**Sparx account connected**';
    const sparxUsername = userInfo.username || userInfo.preferred_username || userInfo.email || '';
    const identityLine = sparxUsername ? `\n**Sparx username:** \`${String(sparxUsername).replace(/[`\\]/g, '')}\`` : '';
    const identityNote = name ? '' : '\nThe account name was not included in Sparx profile data; this does not by itself mean authentication failed.';
    return new ContainerBuilder().setAccentColor(getColour(platform))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## Step 1 · Account\n${greeting}${identityLine}${identityNote}\n\nIs this your Sparx account?\n\n**Connected tab:** ${platformLabel(platform)}`
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

    if (ci.customId === 'lumen_method_normal') {
        const platform = sess().platform ?? 'reader';
        await ci.showModal(buildNormalLoginModal(platform));
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
            components: [simplePanel(getColour(s.platform), `### Loading your library...\n${s.userInfo?.username ? `Signed in as \`${String(s.userInfo.username).replace(/[`\\]/g, '')}\`\n` : ''}Retrieving your Sparx books. This can take a few seconds.`)] });

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
            await loadBooks(s, { timeoutMs: 30000 });
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

        // Use the same authenticated request transport as the Reader client.
        // The separate Node fetch implementation was being rejected with HTTP
        // 403 by Sparx's edge/API policy, even though the browser login worked.
        const SparxReader   = require('../autocompleters/sparx/children/reader/requesticator.js');
        const requesticator = new SparxReader(jwt, {}, cookieString);

        // UserInfo is fetched through the project's established gRPC-Web
        // transport (same headers, framing and decoder used by Reader calls).
        let userInfo = null;
        try {
            userInfo = await requesticator.getUserInfo();
        } catch (err) {
            console.warn('[bookmarklet] Reader GetUserInfo failed:', err.message);
        }

        // JWT claims are a fallback only; do not discard a valid API profile.
        const jwtInfo = userInfoFromJwt(jwt);
        userInfo = { ...jwtInfo, ...(userInfo || {}) };
        userInfo.givenName = userInfo.givenName || userInfo.given_name || '';
        userInfo.familyName = userInfo.familyName || userInfo.family_name || '';
        userInfo.displayName = userInfo.displayName || userInfo.display_name ||
            [userInfo.givenName, userInfo.familyName].filter(Boolean).join(' ') ||
            userInfo.email || '';
        userInfo.username = userInfo.username || userInfo.preferred_username || userInfo.email || '';

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

    if (interaction.customId.startsWith('lumen_login_normal_')) {
        const platform = interaction.customId.replace('lumen_login_normal_', '') || 'reader';
        const school = interaction.fields.getTextInputValue('school').trim();
        const username = interaction.fields.getTextInputValue('username').trim();
        const password = interaction.fields.getTextInputValue('password');
        const s = activeDashboardSessions.get(userId) || {};
        s.platform = platform;
        // The modal-submit interaction owns the response; do not use an older button interaction.
        const ci = interaction;
        activeDashboardSessions.set(userId, s);

        // One stable image URL per login. Update its PNG in place without cache-busting
        // query strings, which force Discord clients to reload the image on every edit.
        await interaction.deferUpdate().catch(() => {});
        const progressKey = `login_${userId}_${Date.now()}`;
        const progressUrl = progressImageUrl(progressKey);
        const paint = async (p, label) => {
            try {
                const { setProgressImage } = require('../web/dashboard.js');
                setProgressImage(progressKey, renderLoginProgressPng(p));
                await ci.editReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                    components: [buildLoginProgress(platform, p, label, progressUrl)], attachments: [] });
            } catch (err) {
                console.warn('[lumen:login-progress] Could not update progress card:', err.message);
            }
        };
        await paint(12, 'Checking your school and preparing a secure Sparx session...');

        try {
            const login = require('../autocompleters/sparx/login.js');
            const result = await login({ school, username, password, type: 'normal', onProgress: (p, label) => paint(p, label) });
            if (!result || result.status === 'error' || !result.authToken) {
                const detail = result?.logs || result?.message || 'Sparx did not return a valid login session.';
                throw new Error(String(detail).slice(-1200));
            }
            const jwt = result.authToken;
            const cookieString = result.cookies || '';
            await paint(76, 'Authentication succeeded — retrieving your Sparx profile...');

            const SparxReader = require('../autocompleters/sparx/children/reader/requesticator.js');
            const requesticator = new SparxReader(jwt, { school, username, type: 'normal' }, cookieString);
            let userInfo = null;
            try { userInfo = await requesticator.getUserInfo(); } catch (err) {
                console.warn('[lumen:normal-login] GetUserInfo failed:', err.message);
            }
            userInfo = { ...userInfoFromJwt(jwt), ...(userInfo || {}) };
            userInfo.givenName = userInfo.givenName || userInfo.given_name || '';
            userInfo.familyName = userInfo.familyName || userInfo.family_name || '';
            userInfo.displayName = userInfo.displayName || userInfo.display_name ||
                [userInfo.givenName, userInfo.familyName].filter(Boolean).join(' ') || userInfo.email || '';
            // The submitted Sparx login identifier is the only confirmed username
            // available in this flow; never substitute the Discord account name.
            userInfo.username = userInfo.username || userInfo.preferred_username || username;

            Object.assign(s, {
                platform, jwt, cookieString, requesticator, userInfo,
                settings: s.settings || { srp: 300, wpm: 300, min: 10, max: 20 },
                mode: s.mode || 'Read Until Points Target Achieved'
            });
            activeDashboardSessions.set(userId, s);
            await paint(90, `Verified ${userInfo.username ? `Sparx account ${userInfo.username}` : 'your Sparx profile'} — ready to load your book library...`);
            await ci.editReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [buildVerifyAccount(userInfo, platform)], attachments: [] });
        } catch (err) {
            await ci.editReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [simplePanel(colours.light_red, `### ❌ Login failed\n${String(err.message).slice(0, 1500)}`)], attachments: [] }).catch(() => {});
        } finally {
            // Credentials are never logged or included in progress messages.
        }
        return;
    }

    if (interaction.customId.startsWith('lumen_login_cookie_')) {
        const platform     = interaction.customId.replace('lumen_login_cookie_', '') || 'reader';
        const cookieString = interaction.fields.getTextInputValue('cookie').trim();
        const s            = activeDashboardSessions.get(userId) || {};
        s.platform         = platform;
        const ci           = interaction;
        activeDashboardSessions.set(userId, s);

        await interaction.deferUpdate().catch(() => {});
        const cookieProgressKey = `cookie_${userId}_${Date.now()}`;
        const cookieProgressUrl = progressImageUrl(cookieProgressKey);
        try {
            const { setProgressImage } = require('../web/dashboard.js');
            setProgressImage(cookieProgressKey, renderLoginProgressPng(35));
            await ci.editReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [buildLoginProgress(platform, 35, 'Exchanging your Sparx session...', cookieProgressUrl)], attachments: [] });
        } catch (err) { console.warn('[lumen:cookie-progress] Could not show progress:', err.message); }

        try {
            const jwt = await getTokenNative(cookieString);
            if (!jwt || jwt.startsWith('{')) throw new Error('Cookies are invalid or expired — grab fresh ones and try again.');

            const SparxReader   = require('../autocompleters/sparx/children/reader/requesticator.js');
            const requesticator = new SparxReader(jwt, {}, cookieString);

            let userInfo = null;
            try { userInfo = await requesticator.getUserInfo(); }
            catch (err) { console.warn('[bookmarklet] Reader GetUserInfo failed:', err.message); }
            userInfo = { ...userInfoFromJwt(jwt), ...(userInfo || {}) };
            userInfo.givenName = userInfo.givenName || userInfo.given_name || '';
            userInfo.familyName = userInfo.familyName || userInfo.family_name || '';
            userInfo.displayName = userInfo.displayName || userInfo.display_name ||
                [userInfo.givenName, userInfo.familyName].filter(Boolean).join(' ') ||
                userInfo.email || '';

            Object.assign(s, {
                jwt, cookieString, requesticator, userInfo,
                settings: s.settings || { srp: 300, wpm: 300, min: 10, max: 20 },
                mode: s.mode || 'Read Until Points Target Achieved'
            });
            activeDashboardSessions.set(userId, s);
            await ci.editReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [buildVerifyAccount(userInfo, platform)], attachments: [] });
        } catch (err) {
            await ci.editReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [simplePanel(colours.light_red, `### ❌ Login failed\n${err.message}`)], attachments: [] }).catch(() => {});
        }

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
async function loadBooks(sess, { timeoutMs = 30000 } = {}) {
    if (!sess?.requesticator || typeof sess.requesticator.getHomeworks !== 'function') {
        throw new Error('The authenticated Reader session is missing. Please sign in again.');
    }

    const withTimeout = (promise, ms, stage) => {
        let timer;
        return Promise.race([
            Promise.resolve(promise),
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    const error = new Error(`${stage} timed out after ${Math.round(ms / 1000)} seconds.`);
                    error.code = 'LIBRARY_TIMEOUT';
                    reject(error);
                }, ms);
            })
        ]).finally(() => clearTimeout(timer));
    };

    let books;
    try {
        try {
            books = await withTimeout(sess.requesticator.getHomeworks(), timeoutMs, 'The primary Sparx library request');
        } catch (primaryError) {
            // Keep the established Reader transport primary. Fall back to the
            // native gRPC-Web reader only when the local Python bridge/network
            // is unavailable, not when Sparx explicitly rejects the session.
            const message = String(primaryError?.message || '');
            const causeCode = primaryError?.cause?.code || primaryError?.code || '';
            const bridgeUnavailable = /fetch failed|request bridge|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|LIBRARY_TIMEOUT/i.test(`${message} ${causeCode}`);
            if (!bridgeUnavailable) throw primaryError;

            console.warn('[lumen:library] Primary transport unavailable; attempting native gRPC-Web fallback:', {
                message: message.slice(0, 300), code: causeCode || undefined
            });
            const { getNativeHomeworks } = require('../utils/readerNativeAuth.js');
            books = await withTimeout(getNativeHomeworks(sess.jwt, sess.requesticator.studentUserId || sess.userInfo?.subject?.split('/').pop()), Math.min(timeoutMs, 20000), 'The native Sparx library request');
            sess.libraryTransport = 'native-fallback';
        }
    } catch (err) {
        const causeCode = err?.cause?.code || err?.code;
        const diagnostic = causeCode ? ` (code: ${causeCode})` : '';
        throw new Error(`Could not load books: ${err.message}${diagnostic}`);
    }

    if (!Array.isArray(books)) {
        throw new Error('Could not load books: Sparx returned an unexpected response.');
    }
    if (books.some(book => !book || typeof book.bookId !== 'string' || !book.bookId.trim())) {
        throw new Error('Could not load books: Sparx returned a malformed book entry.');
    }

    sess.books = books;
    sess.bookNames = {};
    for (const book of books) sess.bookNames[book.bookId] = book.title || book.bookId;
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
