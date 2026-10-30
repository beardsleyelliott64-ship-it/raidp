# Start & Build Commands

## Render Setup (Free Tier)

**Build Command:**
```
pip install -r requirements.txt
```

**Start Command:**
```
python bot.py
```

---

## Environment Variables (set in Render dashboard)

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | Your bot token from discord.com/developers |
| `GEMINI_API_KEY` | ✅ | From Google AI Studio (aistudio.google.com) |
| `GROQ_API_KEY` | ✅ | From console.groq.com (free, fast fallback) |
| `VIRUSTOTAL_API_KEY` | ❌ | Optional — from virustotal.com/gui/my-apikey |
| `ADMIN_ROLE_ID` | ✅ | Already set: 1555236808382488606 |
| `GUILD_ID` | ✅ | Already set: 1553107655516622998 |
| `PORT` | ❌ | Render sets this automatically |

---

## Uptime Bot (UptimeRobot)

1. Go to uptimerobot.com → Add Monitor
2. Type: **HTTP(s)**
3. URL: `https://your-render-url.onrender.com/health`
4. Interval: every **5 minutes**

This keeps Render from sleeping.

---

## Bot Permissions (Discord Developer Portal)

Enable these **Privileged Gateway Intents:**
- ✅ Presence Intent
- ✅ Server Members Intent  
- ✅ Message Content Intent

Bot invite URL needs these permissions:
- Administrator (easiest) OR manually:
  - Manage Channels, Manage Roles, Kick Members, Ban Members
  - Send Messages, Manage Messages, Read Message History
  - Embed Links, Attach Files, Use Slash Commands

---

## Commands

| Command | Who | What |
|---|---|---|
| `/ticket-panel` | Admin only | Posts the ticket support panel |
| `/applications` | Admin only | Posts the staff application panel |
| `/ban @user reason` | Admin only | Bans a member |
| `/kick @user reason` | Admin only | Kicks a member |
| `/give-role @user @role` | Admin only | Gives a role |
| `/remove-role @user @role` | Admin only | Removes a role |
| `/warn @user reason` | Admin only | Warns a member (tracked) |
| `/clear amount` | Admin only | Deletes messages (max 100) |
| `/serverinfo` | Everyone | Shows server stats |
