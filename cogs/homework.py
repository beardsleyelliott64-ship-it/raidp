# cogs/homework.py — Sparx autocomplete Discord UI (redesigned)
from __future__ import annotations
import asyncio, logging, os, secrets, time
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
CODE_TTL = 600

SPARX_LOGO = "https://maths.sparx-learning.com/logo192.png"
SPARX_BLUE   = 0x1B4FCC
SPARX_GREEN  = 0x00A86B
SPARX_AMBER  = 0xF5A623
SPARX_RED    = 0xD0312D
SPARX_PURPLE = 0x6B3FA0

PLATFORMS = {
    "sparx_maths": {"label": "Sparx Maths", "bm_host": "sparx-learning.com"},
}


def make_code(user_id: int, channel_id: int) -> str:
    for c, v in list(_pending.items()):
        if time.time() - v["ts"] > CODE_TTL:
            del _pending[c]
    code = secrets.token_hex(3).upper()
    _pending[code] = {"user_id": user_id, "channel_id": channel_id, "ts": time.time()}
    return code

def pop_pending(code: str) -> dict | None:
    entry = _pending.pop(code, None)
    if entry and time.time() - entry["ts"] > CODE_TTL:
        return None
    return entry


def _bm_url(platform_key: str, submit_url: str) -> str:
    host = PLATFORMS[platform_key]["bm_host"]
    js = (
        "async()=>{"
        f"if(!location.hostname.includes('{host}'))"
        f"{{alert('Open {host} first, then click this bookmark.');return;}}"
        "let token=null;"
        "for(const k of Object.keys(localStorage)){"
        "if(!k.startsWith('firebase:authUser:'))continue;"
        "try{const obj=JSON.parse(localStorage.getItem(k));"
        "const t=obj&&obj.stsTokenManager&&obj.stsTokenManager.accessToken;"
        "if(t&&t.startsWith('eyJ')){token=t;break;}}catch(e){}}"
        "if(!token){for(const k of Object.keys(localStorage)){"
        "const v=localStorage.getItem(k);"
        "if(v&&v.startsWith('eyJ')&&v.length>200){token=v;break;}}}"
        "if(!token){try{"
        "const r=await fetch('https://api.sparx-learning.com/token',{credentials:'include'});"
        "if(r.ok){const t=(await r.text()).trim();if(t)token=t;}"
        "}catch(e){}}"
        "if(!token){alert('Could not get auth token. Make sure you are logged into Sparx.');return;}"
        "const code=prompt('Enter your Discord code:');"
        "if(!code||code.trim().length<6)return;"
        f"const b=JSON.stringify({{t:token,code:code.trim().toUpperCase(),platform:'{platform_key}'}});"
        f"const res=await fetch('{submit_url}',{{method:'POST',"
        "headers:{'Content-Type':'application/json'},body:b});"
        "const d=await res.json();"
        "alert(d.message||d.error||'Connected — check Discord.');"
        "}"
    )
    return f"javascript:({js})()"


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


# ── platform select view (FIXED — Select + Submit, no dynamic callbacks) ─────
class PlatformSelectView(ui.View):
    def __init__(self, user_id: int, channel_id: int):
        super().__init__(timeout=120)
        self.user_id    = user_id
        self.channel_id = channel_id
        self.chosen     = "sparx_maths"   # default (only option for now)

    @ui.select(
        placeholder="Select a platform",
        custom_id="platform_select_dropdown",
        options=[
            discord.SelectOption(
                label="Sparx Maths",
                value="sparx_maths",
                description="Maths homework packages",
                default=True,
            ),
        ],
    )
    async def on_select(self, interaction: discord.Interaction, select: ui.Select):
        self.chosen = select.values[0]
        await interaction.response.defer()

    @ui.button(label="Connect", style=discord.ButtonStyle.primary, custom_id="platform_submit")
    async def on_submit(self, interaction: discord.Interaction, button: ui.Button):
        if interaction.user.id != self.user_id:
            await interaction.response.send_message("This isn't your session.", ephemeral=True)
            return
        code  = make_code(self.user_id, self.channel_id)
        embed = _bookmark_embed(self.chosen, code)
        await interaction.response.send_message(embed=embed, ephemeral=True)


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
        if interaction.user.id != self.user_id:
            await interaction.response.send_message("This isn't your session.", ephemeral=True); return
        if not self.selected:
            await interaction.response.send_message("Select a package first.", ephemeral=True); return
        if self.user_id in _running:
            await interaction.response.send_message("A job is already running — check your DMs.", ephemeral=True); return
        sess = _sessions.get(self.user_id, {})
        await interaction.response.send_message(
            embed=discord.Embed(
                description=f"Starting **{self.selected['name']}** — progress will appear in your DMs.",
                color=SPARX_GREEN,
            ),
            ephemeral=True,
        )
        asyncio.create_task(_run_homework(self.bot, sess["token"], self.selected, self.user_id))

    async def _on_refresh(self, interaction: discord.Interaction):
        if interaction.user.id != self.user_id:
            await interaction.response.send_message("This isn't your session.", ephemeral=True); return
        sess = _sessions.get(self.user_id)
        if not sess:
            await interaction.response.send_message("Not connected.", ephemeral=True); return
        pkgs = await sparx.get_packages(sess["token"])
        _sessions[self.user_id]["packages"] = pkgs
        if pkgs:
            await interaction.response.edit_message(
                embed=_packages_embed(sess["info"], pkgs),
                view=BookSelectView(self.user_id, pkgs, self.bot),
            )
        else:
            await interaction.response.send_message("No packages found.", ephemeral=True)


# ── panel view ────────────────────────────────────────────────────────────────
class PanelView(ui.View):
    def __init__(self, bot: discord.Client):
        super().__init__(timeout=None)
        self.bot = bot

    @ui.button(label="Connect", style=discord.ButtonStyle.primary, custom_id="hw_connect", row=0)
    async def connect_btn(self, interaction: discord.Interaction, button: ui.Button):
        uid = interaction.user.id
        if uid in _running:
            await interaction.response.send_message(
                embed=discord.Embed(description="A job is already running — check your DMs.", color=SPARX_AMBER),
                ephemeral=True); return
        sess = _sessions.get(uid)
        if sess and sess.get("packages"):
            await interaction.response.send_message(
                embed=_packages_embed(sess["info"], sess["packages"]),
                view=BookSelectView(uid, sess["packages"], self.bot),
                ephemeral=True); return
        embed = discord.Embed(
            title="Select Platform",
            description="Choose a platform to autocomplete, then click **Connect**.",
            color=SPARX_BLUE,
        )
        embed.set_thumbnail(url=SPARX_LOGO)
        await interaction.response.send_message(
            embed=embed,
            view=PlatformSelectView(uid, interaction.channel_id),
            ephemeral=True,
        )

    @ui.button(label="My Packages", style=discord.ButtonStyle.secondary, custom_id="hw_packages", row=0)
    async def packages_btn(self, interaction: discord.Interaction, button: ui.Button):
        uid  = interaction.user.id
        sess = _sessions.get(uid)
        if not sess:
            await interaction.response.send_message(
                embed=discord.Embed(description="Not connected yet. Click **Connect** first.", color=SPARX_RED),
                ephemeral=True); return
        pkgs = sess.get("packages", [])
        if not pkgs:
            await interaction.response.send_message(
                embed=discord.Embed(
                    title="No Packages",
                    description="No packages were found. Click **Connect** to reconnect.",
                    color=SPARX_AMBER,
                ),
                ephemeral=True); return
        await interaction.response.send_message(
            embed=_packages_embed(sess["info"], pkgs),
            view=BookSelectView(uid, pkgs, self.bot),
            ephemeral=True)

    @ui.button(label="Help", style=discord.ButtonStyle.secondary, custom_id="hw_help", row=0)
    async def help_btn(self, interaction: discord.Interaction, button: ui.Button):
        embed = discord.Embed(
            title="How It Works",
            color=SPARX_PURPLE,
            description=(
                "**Step 1** — Click **Connect** and select your platform\n"
                "**Step 2** — Save the bookmarklet (paste the link into a new bookmark's URL field)\n"
                "**Step 3** — Open Sparx, log in, click the bookmark\n"
                "**Step 4** — Enter the one-time code when prompted\n"
                "**Step 5** — Select a package and click **Start**\n"
                "**Step 6** — Live progress streams to your DMs\n\n"
                "Your password is never sent. The bookmarklet reads your session token directly from the Sparx tab."
            ),
        )
        embed.set_thumbnail(url=SPARX_LOGO)
        await interaction.response.send_message(embed=embed, ephemeral=True)


# ── embeds ────────────────────────────────────────────────────────────────────
def _bookmark_embed(platform_key: str, code: str) -> discord.Embed:
    submit = f"{PUBLIC_URL}/cg-mobile"
    bm     = _bm_url(platform_key, submit)
    label  = PLATFORMS[platform_key]["label"]
    embed  = discord.Embed(
        title=f"Connect to {label}",
        color=SPARX_BLUE,
    )
    embed.set_thumbnail(url=SPARX_LOGO)
    embed.add_field(
        name="Step 1 — Save the bookmarklet",
        value=(
            "Create a new bookmark in your browser. "
            "Paste the following into the bookmark's **URL / Location** field:\n"
            f"```\n{bm[:900]}\n```"
        ),
        inline=False,
    )
    embed.add_field(
        name="Step 2 — Run it on Sparx",
        value="Open [maths.sparx-learning.com](https://maths.sparx-learning.com), log in, then click the bookmark.",
        inline=False,
    )
    embed.add_field(
        name="Step 3 — Enter your code",
        value=f"When the prompt appears, enter:\n```\n{code}\n```",
        inline=False,
    )
    embed.set_footer(text="Code expires in 10 minutes")
    return embed


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
                "No packages were returned. The token was accepted but Sparx returned empty data.\n\n"
                "To diagnose: add `LOG_LEVEL=DEBUG` in Railway Variables and check the deploy logs "
                "for `grpc-status` and `PackageData top` fields.\n\n"
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
