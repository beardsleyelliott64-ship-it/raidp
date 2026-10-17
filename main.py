# language: Python, file: main.py
# Sparx autocomplete Discord bot

from __future__ import annotations
import asyncio, logging, os, secrets, time
import discord
from discord import app_commands, ui
from aiohttp import web
import sparx, gemini

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(name)s] %(levelname)s %(message)s")
log = logging.getLogger("main")

PUBLIC_URL = os.environ.get("RAILWAY_PUBLIC_DOMAIN", os.environ.get("PUBLIC_URL", ""))
if PUBLIC_URL and not PUBLIC_URL.startswith("http"):
    PUBLIC_URL = f"https://{PUBLIC_URL}"

# ── state ─────────────────────────────────────────────────────────────────────
_pending:  dict[str, dict] = {}
_sessions: dict[int, dict] = {}
_running:  set[int]        = set()
CODE_TTL = 600

def _make_code(user_id: int, channel_id: int) -> str:
    for c, v in list(_pending.items()):
        if time.time() - v["ts"] > CODE_TTL:
            del _pending[c]
    code = secrets.token_hex(3).upper()
    _pending[code] = {"user_id": user_id, "channel_id": channel_id, "ts": time.time()}
    return code

# ── colours ───────────────────────────────────────────────────────────────────
COL_BLUE   = 0x5865F2
COL_GREEN  = 0x57F287
COL_GOLD   = 0xFEE75C
COL_RED    = 0xED4245
COL_PURPLE = 0x9B59B6

# ── platforms ─────────────────────────────────────────────────────────────────
PLATFORMS = {
    "sparx_maths": {
        "label":    "Sparx Maths",
        "desc":     "Maths homework packages",
        "bm_host":  "sparx-learning.com",
        "token_ep": "https://api.sparx-learning.com/token",
    },
}

# ── bookmarklet — inline IIFE, no external module import ──────────────────────
def _bm_url(platform_key: str) -> str:
    """Return a self-contained javascript: bookmarklet URL.
    Avoids import() which is blocked by Sparx's CSP."""
    p      = PLATFORMS[platform_key]
    submit = f"{PUBLIC_URL}/cg-mobile"
    host   = p["bm_host"]
    ep     = p["token_ep"]
    inner = (
        f"async()=>{{"
        f"if(!location.hostname.includes('{host}')){{"
        f"alert('Open {host} first, then click the bookmark from that tab.');return;}}"
        f"const r=await fetch('{ep}',{{credentials:'include'}});"
        f"if(!r.ok){{alert('Log into Sparx first, then run the bookmark again.');return;}}"
        f"const t=await r.text();"
        f"const code=prompt('Enter your Discord code:');"
        f"if(!code||code.trim().length<6)return;"
        f"const b=JSON.stringify({{t,code:code.trim().toUpperCase(),platform:'{platform_key}'}});"
        f"const res=await fetch('{submit}',{{method:'POST',"
        f"headers:{{'Content-Type':'application/json'}},body:b}});"
        f"const d=await res.json();"
        f"alert(d.message||d.error||'Connected! Check Discord.');"
        f"}}"
    )
    return f"javascript:({inner})()"

# keep /bm endpoint for reference (serves plain text now, not a module)
def _bm_text(platform_key: str) -> str:
    return _bm_url(platform_key)

# ── helpers ───────────────────────────────────────────────────────────────────
def bar(current: int, total: int, length: int = 14) -> str:
    if total <= 0:
        return "░" * length
    filled = min(length, int(length * current / total))
    return "█" * filled + "░" * (length - filled)

def pct(current: int, total: int) -> str:
    return f"{int(100 * current / total)}%" if total > 0 else "0%"

# ── web server ────────────────────────────────────────────────────────────────
async def handle_bm(req: web.Request) -> web.Response:
    platform = req.rel_url.query.get("p", "sparx_maths")
    return web.Response(
        text=_bm_text(platform), content_type="text/plain",
        headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache"},
    )

CORS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

async def handle_options(req: web.Request) -> web.Response:
    return web.Response(status=204, headers=CORS)

async def handle_cg(req: web.Request) -> web.Response:
    try:
        body = await req.json()
    except Exception:
        return web.json_response({"error": "bad json"}, status=400, headers=CORS)

    token    = body.get("t", "").strip()
    code     = body.get("code", "").strip().upper()
    platform = body.get("platform", "sparx_maths")
    if not token or not code:
        return web.json_response({"error": "missing t or code"}, status=400, headers=CORS)

    entry = _pending.pop(code, None)
    if not entry or time.time() - entry["ts"] > CODE_TTL:
        return web.json_response(
            {"error": "Code not found or expired. Run /panel again."}, status=404, headers=CORS)

    user_id    = entry["user_id"]
    channel_id = entry["channel_id"]

    if user_id in _running:
        return web.json_response(
            {"message": "A job is already running. Wait for it to finish."}, headers=CORS)

    asyncio.create_task(_post_login(token, user_id, channel_id, platform))
    return web.json_response({"message": "Connected! Check Discord to pick your package."}, headers=CORS)

async def handle_health(req: web.Request) -> web.Response:
    return web.json_response({"status": "ok"})

def build_app() -> web.Application:
    app = web.Application()
    app.router.add_get("/",              handle_health)
    app.router.add_get("/health",        handle_health)
    app.router.add_get("/bm",            handle_bm)
    app.router.add_options("/cg-mobile", handle_options)
    app.router.add_post("/cg-mobile",    handle_cg)
    return app

# ── post-login ────────────────────────────────────────────────────────────────
async def _post_login(token: str, user_id: int, channel_id: int, platform: str = "sparx_maths"):
    channel = bot.get_channel(channel_id) or await bot.fetch_channel(channel_id)
    try:
        info = await sparx.get_student_info(token)
        pkgs = await sparx.get_packages(token)
    except Exception as e:
        await channel.send(
            f"<@{user_id}>",
            embed=discord.Embed(
                title="Connection Failed",
                description=f"Couldn't fetch Sparx data.\n```{e}```",
                color=COL_RED,
            ),
        )
        return

    _sessions[user_id] = {"token": token, "info": info, "packages": pkgs, "platform": platform}

    if not pkgs:
        # No packages — tell them and let them retry via Start Session
        await channel.send(
            f"<@{user_id}>",
            embed=discord.Embed(
                title="Connected — No Packages Found",
                description=(
                    f"Signed in as **{info['name']}** · {info['srp']} SRP\n\n"
                    "No homework packages were returned. This is usually an API path issue — "
                    "check the server logs for JWT claims.\n\n"
                    "Click **Start Session** again to get a fresh code and retry."
                ),
                color=COL_GOLD,
            ),
        )
        return

    await channel.send(
        f"<@{user_id}>",
        embed=_books_embed(info, pkgs),
        view=BookSelectView(user_id, pkgs),
    )

def _books_embed(info: dict, pkgs: list[dict]) -> discord.Embed:
    embed = discord.Embed(
        title="Select a Package",
        description=f"**{info['name']}** · {info['srp']} SRP",
        color=COL_BLUE,
    )
    for p in pkgs[:10]:
        b      = bar(p["srp_earned"], p["srp_target"], 10)
        status = "Complete" if p["complete"] else f"`{b}` {p['srp_earned']}/{p['srp_target']} SRP"
        embed.add_field(name=p["name"], value=status, inline=True)
    embed.set_footer(text="Select a package below, then click Start")
    return embed

# ── homework runner ───────────────────────────────────────────────────────────
async def _run_homework(token: str, pkg: dict, user_id: int):
    _running.add(user_id)
    try:
        user = await bot.fetch_user(user_id)
        dm   = await user.create_dm()
        prog = sparx.Progress(
            pkg_name   = pkg["name"],
            srp_target = pkg["srp_target"],
            srp_start  = pkg["srp_earned"],
        )

        def _embed() -> discord.Embed:
            total = prog.srp_start + prog.srp_earned
            pctv  = min(100, int(100 * total / prog.srp_target)) if prog.srp_target else 0
            qb    = bar(prog.q_done, prog.q_total) if prog.q_total else "░" * 14
            sb    = bar(total, prog.srp_target)

            if prog.done and not prog.error:
                color, status = COL_GREEN, "Complete"
            elif prog.error:
                color, status = COL_RED, "Error"
            else:
                color, status = COL_BLUE, "Running"

            e = discord.Embed(title=pkg["name"], color=color)
            e.add_field(
                name="Questions",
                value=f"`{qb}`\n{prog.q_done}/{prog.q_total or '?'} · {pct(prog.q_done, prog.q_total)}",
                inline=False,
            )
            e.add_field(
                name="SRP",
                value=f"`{sb}`\n{total}/{prog.srp_target} · {pctv}%",
                inline=False,
            )
            e.add_field(name="Answered",   value=str(prog.q_done),      inline=True)
            e.add_field(name="SRP earned", value=f"+{prog.srp_earned}",  inline=True)
            e.add_field(name="Status",     value=status,                 inline=True)
            if prog.error:
                e.set_footer(text=prog.error)
            return e

        msg     = await dm.send(embed=_embed())
        hw_task = asyncio.create_task(
            sparx.complete_package(token=token, pkg=pkg, answer_fn=gemini.answer, progress=prog)
        )
        while not prog.done and not prog.error:
            await asyncio.sleep(3)
            try:
                await msg.edit(embed=_embed())
            except Exception:
                pass
        await hw_task
        await msg.edit(embed=_embed())

    except Exception as e:
        log.error("run_homework error: %s", e)
        try:
            user = await bot.fetch_user(user_id)
            dm   = await user.create_dm()
            await dm.send(embed=discord.Embed(title="Job Failed", description=str(e), color=COL_RED))
        except Exception:
            pass
    finally:
        _running.discard(user_id)

# ── views ─────────────────────────────────────────────────────────────────────

def _bookmark_embed(platform_key: str, code: str) -> discord.Embed:
    p     = PLATFORMS[platform_key]
    bm    = _bm_url(platform_key)
    embed = discord.Embed(
        title=f"Connect — {p['label']}",
        color=COL_BLUE,
    )
    embed.add_field(
        name="1 · Add the bookmarklet",
        value=(
            "Create a new bookmark in your browser. "
            "Set the **URL / Location** field to this — copy it exactly:\n"
            f"```\n{bm}\n```"
        ),
        inline=False,
    )
    embed.add_field(
        name="2 · Run it on Sparx",
        value=(
            f"Go to [sparx-learning.com](https://www.sparx-learning.com) and log in. "
            f"Then click the bookmark from that tab."
        ),
        inline=False,
    )
    embed.add_field(
        name="3 · Enter your code",
        value=f"The bookmark will open a prompt. Paste this:\n```\n{code}\n```",
        inline=False,
    )
    embed.set_footer(text="Code expires in 10 minutes · your packages appear automatically after")
    return embed


class PanelView(ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @ui.button(label="Start Session", style=discord.ButtonStyle.primary,
               custom_id="panel_start", row=0)
    async def start_btn(self, interaction: discord.Interaction, button: ui.Button):
        user_id    = interaction.user.id
        channel_id = interaction.channel_id

        if user_id in _running:
            await interaction.response.send_message(
                embed=discord.Embed(
                    description="A job is already running. Check your DMs.",
                    color=COL_GOLD,
                ),
                ephemeral=True,
            )
            return

        # already have packages → go straight to book picker
        sess = _sessions.get(user_id)
        if sess and sess["packages"]:
            await interaction.response.send_message(
                embed=_books_embed(sess["info"], sess["packages"]),
                view=BookSelectView(user_id, sess["packages"]),
                ephemeral=True,
            )
            return

        # no session, or session with no packages → fresh bookmarklet code either way
        view = PlatformSelectView(user_id, channel_id)
        await interaction.response.send_message(
            embed=discord.Embed(
                title="Select Platform",
                description="Choose which Sparx platform to autocomplete.",
                color=COL_BLUE,
            ),
            view=view,
            ephemeral=True,
        )

    @ui.button(label="My Books", style=discord.ButtonStyle.secondary,
               custom_id="panel_books", row=1)
    async def books_btn(self, interaction: discord.Interaction, button: ui.Button):
        user_id = interaction.user.id
        sess    = _sessions.get(user_id)
        if not sess:
            await interaction.response.send_message(
                embed=discord.Embed(
                    description="Not connected yet. Click **Start Session** first.",
                    color=COL_RED,
                ),
                ephemeral=True,
            )
            return
        if not sess["packages"]:
            await interaction.response.send_message(
                embed=discord.Embed(
                    title="No Packages",
                    description="No packages found. Click **Start Session** to connect again.",
                    color=COL_GOLD,
                ),
                ephemeral=True,
            )
            return
        await interaction.response.send_message(
            embed=_books_embed(sess["info"], sess["packages"]),
            view=BookSelectView(user_id, sess["packages"]),
            ephemeral=True,
        )

    @ui.button(label="Help", style=discord.ButtonStyle.secondary,
               custom_id="panel_help", row=1)
    async def help_btn(self, interaction: discord.Interaction, button: ui.Button):
        embed = discord.Embed(
            title="How It Works",
            color=COL_PURPLE,
            description=(
                "**1.** Click **Start Session** and pick your platform\n"
                "**2.** Save the bookmarklet in your browser "
                "(paste it into the URL/Location field of a new bookmark)\n"
                "**3.** Go to sparx-learning.com, log in, click the bookmark\n"
                "**4.** Enter the one-time code when prompted\n"
                "**5.** Pick a package and click **Start**\n"
                "**6.** Live SRP progress appears in your DMs\n\n"
                "Your Sparx password is never sent here. "
                "The bookmarklet reads your session token directly from the Sparx tab."
            ),
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)


class PlatformSelectView(ui.View):
    def __init__(self, user_id: int, channel_id: int):
        super().__init__(timeout=120)
        self.user_id    = user_id
        self.channel_id = channel_id

        opts = [
            discord.SelectOption(
                label=p["label"],
                value=key,
                description=p["desc"],
            )
            for key, p in PLATFORMS.items()
        ]
        sel = ui.Select(placeholder="Choose a platform...", options=opts)
        sel.callback = self._on_select
        self.add_item(sel)

    async def _on_select(self, interaction: discord.Interaction):
        if interaction.user.id != self.user_id:
            await interaction.response.send_message("Not your panel.", ephemeral=True)
            return
        platform_key = interaction.data["values"][0]
        code         = _make_code(self.user_id, self.channel_id)
        await interaction.response.edit_message(
            embed=_bookmark_embed(platform_key, code),
            view=None,
        )


class BookSelectView(ui.View):
    def __init__(self, user_id: int, packages: list[dict]):
        super().__init__(timeout=300)
        self.user_id   = user_id
        self.packages  = packages
        self.selected: dict | None = None

        opts = []
        for p in packages[:25]:
            b    = bar(p["srp_earned"], p["srp_target"], 8)
            desc = "Complete" if p["complete"] else f"{p['srp_earned']}/{p['srp_target']} SRP"
            opts.append(discord.SelectOption(
                label=p["name"][:100],
                value=p["id"],
                description=desc[:100],
            ))

        if opts:
            sel = ui.Select(placeholder="Choose a package...", options=opts, row=0)
            sel.callback = self._on_select
            self.add_item(sel)

    async def _on_select(self, interaction: discord.Interaction):
        if interaction.user.id != self.user_id:
            await interaction.response.send_message("Not your panel.", ephemeral=True)
            return
        sel_id        = interaction.data["values"][0]
        self.selected = next((p for p in self.packages if p["id"] == sel_id), None)
        name          = self.selected["name"] if self.selected else "Unknown"

        embed = interaction.message.embeds[0] if interaction.message.embeds else discord.Embed()
        embed.set_footer(text=f"Selected: {name} · click Start to begin")
        self.start_btn.disabled = False
        await interaction.response.edit_message(embed=embed, view=self)

    @ui.button(label="Start", style=discord.ButtonStyle.success,
               disabled=True, row=1)
    async def start_btn(self, interaction: discord.Interaction, button: ui.Button):
        if interaction.user.id != self.user_id:
            await interaction.response.send_message("Not your panel.", ephemeral=True)
            return
        if not self.selected:
            await interaction.response.send_message("Pick a package first.", ephemeral=True)
            return
        if self.user_id in _running:
            await interaction.response.send_message(
                "Already running — check your DMs.", ephemeral=True)
            return
        sess = _sessions.get(self.user_id)
        if not sess:
            await interaction.response.send_message(
                "Session expired. Click Start Session again.", ephemeral=True)
            return

        await interaction.response.send_message(
            embed=discord.Embed(
                title=self.selected["name"],
                description="Started. Check your **DMs** for live progress.",
                color=COL_GREEN,
            ),
            ephemeral=True,
        )
        asyncio.create_task(_run_homework(sess["token"], self.selected, self.user_id))

    @ui.button(label="Refresh", style=discord.ButtonStyle.secondary, row=1)
    async def refresh_btn(self, interaction: discord.Interaction, button: ui.Button):
        if interaction.user.id != self.user_id:
            await interaction.response.send_message("Not your panel.", ephemeral=True)
            return
        sess = _sessions.get(self.user_id)
        if not sess:
            await interaction.response.send_message("Not logged in.", ephemeral=True)
            return
        await interaction.response.defer()
        try:
            pkgs = await sparx.get_packages(sess["token"])
            _sessions[self.user_id]["packages"] = pkgs
            if pkgs:
                embed    = _books_embed(sess["info"], pkgs)
                new_view = BookSelectView(self.user_id, pkgs)
            else:
                embed = discord.Embed(
                    title="No Packages",
                    description="Still no packages. Check server logs for API path info.",
                    color=COL_GOLD,
                )
                new_view = BookSelectView(self.user_id, [])
            await interaction.edit_original_response(embed=embed, view=new_view)
        except Exception as e:
            await interaction.edit_original_response(
                embed=discord.Embed(title="Refresh Failed", description=str(e), color=COL_RED))


# ── Discord bot ────────────────────────────────────────────────────────────────
intents = discord.Intents.default()
bot     = discord.Client(intents=intents)
tree    = app_commands.CommandTree(bot)
GUILD_ID = discord.Object(id=1553107655516622998)

@bot.event
async def on_ready():
    tree.clear_commands(guild=GUILD_ID)
    await tree.sync(guild=GUILD_ID)
    tree.copy_global_to(guild=GUILD_ID)
    synced = await tree.sync(guild=GUILD_ID)
    log.info("[bot] online as %s — synced %d command(s)", bot.user, len(synced))

@tree.command(name="panel", description="Open the Sparx autocomplete panel")
async def slash_panel(interaction: discord.Interaction):
    embed = discord.Embed(
        title="Sparx Autocompleter",
        description=(
            "Press **Start Session** to choose a platform and connect your account.\n\n"
            "**Features**\n"
            "· Bookmarklet auth — no password required\n"
            "· AI-powered answers via Gemini\n"
            "· Live SRP progress in your DMs\n"
            "· Sparx Maths supported"
        ),
        color=COL_BLUE,
    )
    embed.set_footer(text="Powered by Gemini 1.5 Flash")
    await interaction.response.send_message(embed=embed, view=PanelView())

# ── entry ──────────────────────────────────────────────────────────────────────
async def main():
    port = int(os.environ.get("PORT", 8080))

    app    = build_app()
    runner = web.AppRunner(app)
    await runner.setup()
    site   = web.TCPSite(runner, "0.0.0.0", port)
    await site.start()
    log.info("[server] listening on 0.0.0.0:%d", port)

    token = os.environ.get("DISCORD_BOT_TOKEN", "").strip()
    if not token:
        log.error("[bot] DISCORD_BOT_TOKEN not set")
        await asyncio.Event().wait()
        return

    log.info("[bot] connecting to Discord...")
    await bot.start(token)

if __name__ == "__main__":
    asyncio.run(main())
