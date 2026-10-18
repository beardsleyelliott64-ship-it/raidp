# cogs/homework.py — Sparx autocomplete Discord UI
from __future__ import annotations
import asyncio, json, logging, os, secrets, time
import discord
from discord import app_commands, ui
import sparx, gemini_hw as gemini

log = logging.getLogger("homework")

PUBLIC_URL = os.environ.get("RAILWAY_PUBLIC_DOMAIN", os.environ.get("PUBLIC_URL", ""))
if PUBLIC_URL and not PUBLIC_URL.startswith("http"):
    PUBLIC_URL = f"https://{PUBLIC_URL}"

_pending:  dict[str, dict] = {}
_sessions: dict[int, dict] = {}
_running:  set[int]        = set()
CODE_TTL   = 3600          # 1 hour — survives Railway restarts
_PENDING_FILE = "/tmp/sparx_pending.json"


def _save_pending() -> None:
    try:
        with open(_PENDING_FILE, "w") as f:
            json.dump(_pending, f)
    except Exception as e:
        log.warning("save_pending: %s", e)

def _load_pending() -> None:
    try:
        with open(_PENDING_FILE) as f:
            data = json.load(f)
        now = time.time()
        for code, entry in data.items():
            if now - entry.get("ts", 0) < CODE_TTL:
                _pending[code] = entry
        log.info("Loaded %d pending code(s) from disk", len(_pending))
    except FileNotFoundError:
        pass
    except Exception as e:
        log.warning("load_pending: %s", e)

_load_pending()

SPARX_LOGO   = "https://maths.sparx-learning.com/logo192.png"
SPARX_BLUE   = 0x1B4FCC
SPARX_GREEN  = 0x00A86B
SPARX_AMBER  = 0xF5A623
SPARX_RED    = 0xD0312D
SPARX_PURPLE = 0x6B3FA0

PLATFORMS = {
    "sparx_maths": {"label": "Sparx Maths", "bm_host": "sparx-learning.com"},
}


def make_code(user_id: int, channel_id: int) -> str:
    now = time.time()
    for c, v in list(_pending.items()):
        if now - v["ts"] > CODE_TTL:
            del _pending[c]
    code = secrets.token_hex(3).upper()
    _pending[code] = {"user_id": user_id, "channel_id": channel_id, "ts": now}
    _save_pending()
    return code

def pop_pending(code: str) -> dict | None:
    entry = _pending.pop(code, None)
    _save_pending()
    if entry and time.time() - entry["ts"] > CODE_TTL:
        return None
    return entry


def _bm_url(platform_key: str, submit_url: str) -> str:
    """Build the bookmarklet javascript: URL. All braces in JS escaped as {{ }} in f-strings."""
    host = PLATFORMS[platform_key]["bm_host"]
    if not submit_url or not submit_url.startswith("http"):
        raise ValueError(
            f"PUBLIC_URL not set or invalid ({submit_url!r}). "
            "Set RAILWAY_PUBLIC_DOMAIN or PUBLIC_URL in Railway variables."
        )
    # Single f-string — every JS brace pair escaped as {{ }}
    js = (
        f"async()=>{{"
        f"if(!location.hostname.includes('{host}')){{alert('Open {host} first');return;}}"
        f"let t=null;"
        f"for(let k of Object.keys(localStorage)){{"
        f"if(!k.startsWith('firebase:authUser:'))continue;"
        f"try{{let o=JSON.parse(localStorage[k]);let a=o&&o.stsTokenManager&&o.stsTokenManager.accessToken;"
        f"if(a&&a.startsWith('eyJ')){{t=a;break;}}}}catch(e){{}}}}"
        f"if(!t)for(let k of Object.keys(localStorage)){{let v=localStorage[k];"
        f"if(v&&v.startsWith('eyJ')&&v.length>200){{t=v;break;}}}}"
        f"if(!t){{try{{let r=await fetch('https://api.sparx-learning.com/token',{{credentials:'include'}});"
        f"if(r.ok)t=(await r.text()).trim();}}catch(e){{}}}}"
        f"if(!t){{alert('No auth token. Make sure you are logged into Sparx.');return;}}"
        f"let c=prompt('Discord code:');"
        f"if(!c||c.trim().length<6)return;"
        f"let b=JSON.stringify({{t,code:c.trim().toUpperCase(),platform:'{platform_key}'}});"
        f"let res=await fetch('{submit_url}',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:b}});"
        f"let d=await res.json();alert(d.message||d.error||'Connected — check Discord!');"
        f"}}"
    )
    return f"javascript:(({js})())"


def _bar(cur: int, tot: int, ln: int = 12) -> str:
    if tot <= 0: return "─" * ln
    filled = min(ln, int(ln * cur / tot))
    return "█" * filled + "░" * (ln - filled)

def _pct(cur: int, tot: int) -> str:
    return f"{int(100 * cur / tot)}%" if tot > 0 else "0%"


# ── homework runner ───────────────────────────────────────────────────────────
async def _run_homework(bot: discord.Client, token: str, pkg: dict, user_id: int):
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
            if prog.done and not prog.error:   color, status = SPARX_GREEN,  "Complete"
            elif prog.error:                   color, status = SPARX_RED,    "Error"
            else:                              color, status = SPARX_BLUE,   "Running"
            e = discord.Embed(title=pkg["name"], color=color)
            e.set_thumbnail(url=SPARX_LOGO)
            e.add_field(name="Questions",
                value=f"`{_bar(prog.q_done, prog.q_total)}`  {prog.q_done}/{prog.q_total or '?'}",
                inline=False)
            e.add_field(name="SRP",
                value=f"`{_bar(total, prog.srp_target)}`  {total}/{prog.srp_target} ({pctv}%)",
                inline=False)
            e.add_field(name="Answered",   value=str(prog.q_done),     inline=True)
            e.add_field(name="SRP earned", value=f"+{prog.srp_earned}", inline=True)
            e.add_field(name="Status",     value=status,               inline=True)
            if prog.error: e.set_footer(text=prog.error)
            return e

        msg     = await dm.send(embed=_embed())
        hw_task = asyncio.create_task(
            sparx.complete_package(token=token, pkg=pkg, answer_fn=gemini.answer, progress=prog)
        )
        while not prog.done and not prog.error:
            await asyncio.sleep(3)
            try: await msg.edit(embed=_embed())
            except Exception: pass
        await hw_task
        await msg.edit(embed=_embed())
    except Exception as e:
        log.error("run_homework: %s", e)
        try:
            user = await bot.fetch_user(user_id)
            dm   = await user.create_dm()
            await dm.send(embed=discord.Embed(
                title="Job Failed", description=str(e), color=SPARX_RED))
        except Exception: pass
    finally:
        _running.discard(user_id)


# ── book select view ──────────────────────────────────────────────────────────
class BookSelectView(ui.View):
    def __init__(self, user_id: int, pkgs: list[dict], bot: discord.Client):
        super().__init__(timeout=300)
        self.user_id  = user_id
        self.pkgs     = pkgs
        self.bot      = bot
        self.selected: dict | None = None

        options = [
            discord.SelectOption(
                label=p["name"][:100],
                value=str(i),
                description=("Done" if p["complete"] else f"{p['srp_earned']}/{p['srp_target']} SRP")[:100],
            )
            for i, p in enumerate(pkgs[:25])
        ]
        sel = ui.Select(placeholder="Choose a package", options=options, custom_id="book_select_drop")
        sel.callback = self._on_select
        self.add_item(sel)

        start_btn = ui.Button(label="Start", style=discord.ButtonStyle.success, custom_id="book_start_btn")
        start_btn.callback = self._on_start
        self.add_item(start_btn)

        refresh_btn = ui.Button(label="Refresh", style=discord.ButtonStyle.secondary, custom_id="book_refresh_btn")
        refresh_btn.callback = self._on_refresh
        self.add_item(refresh_btn)

    async def _on_select(self, interaction: discord.Interaction):
        idx = int(interaction.data["values"][0])
        self.selected = self.pkgs[idx]
        await interaction.response.defer()

    async def _on_start(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True, thinking=True)
        try:
            if interaction.user.id != self.user_id:
                await interaction.followup.send("This isn't your session.", ephemeral=True); return
            if not self.selected:
                await interaction.followup.send("Select a package first.", ephemeral=True); return
            if self.user_id in _running:
                await interaction.followup.send("A job is already running — check your DMs.", ephemeral=True); return
            sess = _sessions.get(self.user_id, {})
            await interaction.followup.send(
                embed=discord.Embed(
                    description=f"Starting **{self.selected['name']}** — progress will appear in your DMs.",
                    color=SPARX_GREEN,
                ),
                ephemeral=True,
            )
            asyncio.create_task(_run_homework(self.bot, sess["token"], self.selected, self.user_id))
        except Exception as e:
            log.error("_on_start: %s", e)
            try: await interaction.followup.send(embed=discord.Embed(title="Error", description=str(e), color=SPARX_RED), ephemeral=True)
            except Exception: pass

    async def _on_refresh(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True, thinking=True)
        try:
            if interaction.user.id != self.user_id:
                await interaction.followup.send("This isn't your session.", ephemeral=True); return
            sess = _sessions.get(self.user_id)
            if not sess:
                await interaction.followup.send("Not connected.", ephemeral=True); return
            pkgs = await sparx.get_packages(sess["token"])
            _sessions[self.user_id]["packages"] = pkgs
            if pkgs:
                await interaction.followup.send(
                    embed=_packages_embed(sess["info"], pkgs),
                    view=BookSelectView(self.user_id, pkgs, self.bot),
                    ephemeral=True,
                )
            else:
                await interaction.followup.send("No packages found.", ephemeral=True)
        except Exception as e:
            log.error("_on_refresh: %s", e)
            try: await interaction.followup.send(embed=discord.Embed(title="Error", description=str(e), color=SPARX_RED), ephemeral=True)
            except Exception: pass


# ── panel view ────────────────────────────────────────────────────────────────
class PanelView(ui.View):
    def __init__(self, bot: discord.Client):
        super().__init__(timeout=None)
        self.bot = bot

    @ui.button(label="Connect", style=discord.ButtonStyle.primary, custom_id="hw_connect", row=0)
    async def connect_btn(self, interaction: discord.Interaction, button: ui.Button):
        await interaction.response.defer(ephemeral=True, thinking=True)
        try:
            uid = interaction.user.id
            if uid in _running:
                await interaction.followup.send(
                    embed=discord.Embed(description="A job is already running — check your DMs.", color=SPARX_AMBER),
                    ephemeral=True); return
            sess = _sessions.get(uid)
            if sess and sess.get("packages"):
                await interaction.followup.send(
                    embed=_packages_embed(sess["info"], sess["packages"]),
                    view=BookSelectView(uid, sess["packages"], self.bot),
                    ephemeral=True); return
            code = make_code(uid, interaction.channel_id)
            bm_embed, overflow_bm = _bookmark_embed("sparx_maths", code)
            await interaction.followup.send(embed=bm_embed, ephemeral=True)
            if overflow_bm:
                try:
                    dm = await interaction.user.create_dm()
                    await dm.send(
                        f"**Bookmarklet for code `{code}`** — paste the full text into the bookmark URL field:\n"
                        f"```\n{overflow_bm}\n```"
                    )
                except Exception: pass
        except Exception as e:
            log.error("connect_btn: %s", e)
            try: await interaction.followup.send(
                embed=discord.Embed(title="Error", description=str(e), color=SPARX_RED), ephemeral=True)
            except Exception: pass

    @ui.button(label="My Packages", style=discord.ButtonStyle.secondary, custom_id="hw_packages", row=0)
    async def packages_btn(self, interaction: discord.Interaction, button: ui.Button):
        await interaction.response.defer(ephemeral=True, thinking=True)
        try:
            uid  = interaction.user.id
            sess = _sessions.get(uid)
            if not sess:
                await interaction.followup.send(
                    embed=discord.Embed(description="Not connected yet. Click **Connect** first.", color=SPARX_RED),
                    ephemeral=True); return
            pkgs = sess.get("packages", [])
            if not pkgs:
                await interaction.followup.send(
                    embed=discord.Embed(
                        title="No Packages",
                        description="No packages found. Click **Connect** to reconnect.",
                        color=SPARX_AMBER,
                    ),
                    ephemeral=True); return
            await interaction.followup.send(
                embed=_packages_embed(sess["info"], pkgs),
                view=BookSelectView(uid, pkgs, self.bot),
                ephemeral=True)
        except Exception as e:
            log.error("packages_btn: %s", e)
            try: await interaction.followup.send(
                embed=discord.Embed(title="Error", description=str(e), color=SPARX_RED), ephemeral=True)
            except Exception: pass

    @ui.button(label="Help", style=discord.ButtonStyle.secondary, custom_id="hw_help", row=0)
    async def help_btn(self, interaction: discord.Interaction, button: ui.Button):
        await interaction.response.defer(ephemeral=True, thinking=True)
        try:
            embed = discord.Embed(
                title="How It Works",
                color=SPARX_PURPLE,
                description=(
                    "**Step 1** — Click **Connect**, save the bookmarklet\n"
                    "**Step 2** — Open Sparx, log in, click the bookmark\n"
                    "**Step 3** — Enter the one-time code when prompted\n"
                    "**Step 4** — Select a package and click **Start**\n"
                    "**Step 5** — Live progress streams to your DMs\n\n"
                    "Your password is never sent. The bookmarklet reads your session token directly from the Sparx tab."
                ),
            )
            embed.set_thumbnail(url=SPARX_LOGO)
            await interaction.followup.send(embed=embed, ephemeral=True)
        except Exception as e:
            log.error("help_btn: %s", e)
            try: await interaction.followup.send(
                embed=discord.Embed(title="Error", description=str(e), color=SPARX_RED), ephemeral=True)
            except Exception: pass


# ── embeds ────────────────────────────────────────────────────────────────────
def _bookmark_embed(platform_key: str, code: str) -> tuple[discord.Embed, str | None]:
    """Returns (embed, overflow_bm). overflow_bm is set when the bookmarklet is too long for the embed."""
    submit = f"{PUBLIC_URL}/cg-mobile"
    label  = PLATFORMS[platform_key]["label"]
    embed  = discord.Embed(title=f"Connect to {label}", color=SPARX_BLUE)
    embed.set_thumbnail(url=SPARX_LOGO)

    if not PUBLIC_URL or not PUBLIC_URL.startswith("http"):
        embed.add_field(
            name="⚠️ Server not configured",
            value=(
                "`PUBLIC_URL` is not set — the bot cannot receive tokens.\n"
                "Set `RAILWAY_PUBLIC_DOMAIN` or `PUBLIC_URL` in Railway variables and redeploy."
            ),
            inline=False,
        )
        embed.color = SPARX_RED
        return embed, None

    try:
        bm = _bm_url(platform_key, submit)
    except ValueError as e:
        embed.add_field(name="⚠️ Config error", value=str(e)[:1020], inline=False)
        embed.color = SPARX_RED
        return embed, None

    overflow_bm: str | None = None
    bm_display = f"```\n{bm}\n```"
    if len(bm_display) > 1020:
        overflow_bm = bm
        embed.add_field(
            name="Step 1 — Save the bookmarklet",
            value="The bookmarklet URL is too long for this embed — check your DMs for the full text.",
            inline=False,
        )
    else:
        embed.add_field(
            name="Step 1 — Save the bookmarklet",
            value="Create a bookmark and paste the following into the **URL / Location** field:\n" + bm_display,
            inline=False,
        )

    embed.add_field(
        name="Step 2 — Run it on Sparx",
        value="Open [maths.sparx-learning.com](https://maths.sparx-learning.com), log in, click the bookmark.",
        inline=False,
    )
    embed.add_field(
        name="Step 3 — Enter your code",
        value=f"When prompted, enter:\n```\n{code}\n```",
        inline=False,
    )
    embed.set_footer(text="Code expires in 10 minutes")
    return embed, overflow_bm


def _packages_embed(info: dict, pkgs: list[dict]) -> discord.Embed:
    embed = discord.Embed(
        title="Your Packages",
        description=f"Signed in as **{info['name']}**",
        color=SPARX_BLUE,
    )
    embed.set_thumbnail(url=SPARX_LOGO)
    for p in pkgs[:10]:
        if p["complete"]:
            value = "Complete"
        else:
            value = f"`{_bar(p['srp_earned'], p['srp_target'])}` {p['srp_earned']}/{p['srp_target']} SRP"
        embed.add_field(name=p["name"], value=value, inline=True)
    embed.set_footer(text="Select a package below, then click Start")
    return embed


# ── post-login (called from web_app.py) ──────────────────────────────────────
async def post_login(bot: discord.Client, token: str, user_id: int, channel_id: int, platform: str):
    channel = bot.get_channel(channel_id) or await bot.fetch_channel(channel_id)
    try:
        info = await sparx.get_student_info(token)
        pkgs = await sparx.get_packages(token)
    except Exception as e:
        await channel.send(f"<@{user_id}>", embed=discord.Embed(
            title="Connection Failed",
            description=f"Could not fetch Sparx data.\n```{e}```",
            color=SPARX_RED,
        ))
        return

    _sessions[user_id] = {"token": token, "info": info, "packages": pkgs, "platform": platform}

    if not pkgs:
        await channel.send(f"<@{user_id}>", embed=discord.Embed(
            title="Connected — No Packages Found",
            description=(
                f"Signed in as **{info['name']}**.\n\n"
                "No packages were returned. Token accepted but Sparx returned empty data.\n\n"
                "Add `LOG_LEVEL=DEBUG` in Railway variables and check deploy logs for "
                "`grpc-status` and `PackageData top` fields.\n\n"
                "Click **Connect** again to retry."
            ),
            color=SPARX_AMBER,
        ))
        return

    await channel.send(
        f"<@{user_id}>",
        embed=_packages_embed(info, pkgs),
        view=BookSelectView(user_id, pkgs, bot),
    )


# ── cog ───────────────────────────────────────────────────────────────────────
class Homework(discord.ext.commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="sparx", description="Sparx homework autocomplete panel")
    async def sparx_cmd(self, interaction: discord.Interaction):
        embed = discord.Embed(
            title="Sparx Autocomplete",
            description=(
                "Automatically completes your Sparx homework packages using AI.\n\n"
                "**Connect** — link your Sparx account via bookmarklet\n"
                "**My Packages** — view and start a package\n"
                "**Help** — step-by-step guide"
            ),
            color=SPARX_BLUE,
        )
        embed.set_thumbnail(url=SPARX_LOGO)
        embed.set_footer(text="Powered by Gemini")
        await interaction.response.send_message(embed=embed, view=PanelView(self.bot))


async def setup(bot):
    await bot.add_cog(Homework(bot))
    bot.add_view(PanelView(bot))
