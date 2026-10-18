# Discord Bot

Ticket system + AI builder. Deploys on Railway with zero config.

---

## Start command

```
python bot.py
```

---

## Setup

### 1. Environment variables

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | Bot token from Discord Developer Portal |
| `GEMINI_API_KEY` | ✅ | Google AI Studio API key |
| `GUILD_ID` | optional | Server ID for instant slash command sync |

On Railway → set these in the **Variables** tab.
Locally → copy `.env.example` → `.env` and fill in.

### 2. Bot permissions

In Discord Developer Portal → OAuth2 → Bot scopes:
- `bot`
- `applications.commands`

Bot permissions:
- Manage Channels
- Send Messages
- Read Message History
- Attach Files
- Embed Links

### 3. Deploy on Railway

1. Push this repo to GitHub
2. New project → Deploy from GitHub repo
3. Set environment variables in Variables tab
4. Railway auto-detects `railway.toml` — no extra config needed

Health check hits `/` on Railway's assigned PORT — the bot handles this automatically.

---

## Commands

| Command | Description |
|---|---|
| `/ticket` | Open a private support ticket |
| `/build` | Open the project builder panel |

### Ticket UI buttons
| Button | Action |
|---|---|
| 🔒 Close | Closes the ticket channel after 5s |
| 📋 Claim | Staff claims the ticket |
| 🤖 AI Support | Toggle AI responses (auto-disables when staff sends a message) |

---

## Gemini model cycling

`gemini_models.py` lists all models in priority order. On first successful response the bot locks onto that model and saves it to `.gemini_model_lock`. If that model goes down, it cycles again automatically.

If Gemini refuses a request, the bot retries with a bypass system prompt before giving up.

---

## Staff roles

The following role names trigger AI deactivation when the member sends a message in a ticket:
`staff`, `mod`, `moderator`, `admin`, `administrator`, `support`, `helper`

Add or remove entries in `cogs/tickets.py` → `STAFF_ROLES`.
