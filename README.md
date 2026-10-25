# Discord Bot v2

## Setup

### 1. Environment Variables (Render/Railway → Variables)

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | Bot token from discord.dev |
| `CLIENT_ID` | ✅ | Application ID from discord.dev |
| `BASE_URL` | ✅ | Your Render/Railway URL — no trailing slash |
| `PORT` | ✅ | `3000` |
| `ANTHROPIC_API_KEY` | AI chatbot | console.anthropic.com |
| `TWITCH_CLIENT_ID` | Twitch alerts | dev.twitch.tv |
| `TWITCH_CLIENT_SECRET` | Twitch alerts | dev.twitch.tv |
| `STEAM_API_KEY` | CS2 stats | steamcommunity.com/dev/apikey |

### 2. Discord Bot Settings (discord.dev)

Under your app → Bot:
- Enable **Message Content Intent**
- Enable **Server Members Intent**
- Enable **Presence Intent**

### 3. Invite Bot

Use this URL (replace CLIENT_ID):
```
https://discord.com/oauth2/authorize?client_id=CLIENT_ID&permissions=8&scope=bot+applications.commands
```

---

## Commands

### ⚙️ Admin/Setup
| Command | Description |
|---|---|
| `/panel` | Bot status, ping, uptime, servers |
| `/set-tracker #channel` | Fortnite item shop posts here daily |
| `/tracker-fetch` | Force post current shop now |
| `/set-chatbot #channel` | AI chatbot responds to all messages here |
| `/chatbot-off` | Disable chatbot |
| `/set-alerts #channel` | Twitch/YouTube alert channel |
| `/add-twitch username` | Track a Twitch channel |
| `/add-youtube channel-id name` | Track a YouTube channel |
| `/alerts-list` | List tracked channels |
| `/set-lobby #voice` | Set Join-to-Create lobby VC |
| `/ticket-setup @role` | Configure ticket staff role |
| `/app-setup #channel` | Where applications get posted |
| `/backup` | Download server structure as JSON |

### 💰 Economy
| Command | Description |
|---|---|
| `/balance` | Check coins |
| `/daily` | Claim daily reward (150–400 coins) |
| `/slots bet:100` | Slot machine |
| `/blackjack bet:100` | Blackjack |
| `/rob @user` | 45% success rate, 5min cooldown |
| `/heist` | Server-wide heist, 30s join window |
| `/give @user amount` | Transfer coins |
| `/leaderboard` | Top 10 richest |

### 🎮 Game Stats
| Command | Description |
|---|---|
| `/stats fortnite username` | Fortnite lifetime stats |
| `/stats valorant Name#TAG` | Valorant rank + MMR |
| `/stats cs2 steamid` | CS2 stats (needs STEAM_API_KEY) |

### 🎁 Other
| Command | Description |
|---|---|
| `/giveaway create prize:X duration:10m winners:1` | Start giveaway |
| `/giveaway end message-id:X` | End early |
| `/giveaway reroll message-id:X` | New winner |
| `/ticket reason:X` | Open support ticket |
| `/ticket-close` | Close + save transcript |
| `/apply role:Staff` | Submit application via DM |

---

## Keep-Alive

Self-ping to `/health` every 4 minutes is built in via `BASE_URL`.  
Add your URL to [uptimerobot.com](https://uptimerobot.com) (free, 5-min pings) as a second layer.

## Render Settings

- **Build Command:** `npm install`  
- **Start Command:** `npm start`  
- **Health Check Path:** `/health`  
- **Node Version:** 18+
