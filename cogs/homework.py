# cogs/homework.py — Sparx autocomplete Discord UI
from __future__ import annotations
import asyncio, logging, os, secrets, time
import discord
from discord import app_commands, ui
import sparx, gemini_hw as gemini

log = logging.getLogger("homework")

PUBLIC_URL = os.environ.get("RAILWAY_PUBLIC_DOMAIN", os.environ.get("PUBLIC_URL", ""))
if PUBLIC_URL and not PUBLIC_URL.startswith("http"):
    PUBLIC_URL = f"https://{PUBLIC_URL}"

# ── state ─────────────────────────────────────────────────────────────────────
_pending:  dict[str, dict] = {}
_sessions: dict[int, dict] = {}
_running:  set[int]        = set()
CODE_TTL = 600

COL_BLUE   = 0x5865F2
COL_GREEN  = 0x57F287
COL_GOLD   = 0xFEE75C
COL_RED    = 0xED4245
COL_PURPLE = 0x9B59B6

PLATFORMS = {
    "sparx_maths": {
        "label":   "Sparx Maths",
        "desc":    "Maths homework packages",
        "bm_host": "sparx-learning.com",
    },
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
    """
    Bookmarklet that extracts the Firebase ID token from the Sparx page.

    Priority:
      1. localStorage — Firebase stores auth state as firebase:authUser:<key>
         The stsTokenManager.accessToken is the ID token (eyJ…)
      2. Any raw JWT found in localStorage values
      3. Fallback: fetch /token endpoint with credentials

    FIX: previous version only used method 3, which often returns a non-Bearer
    token or a different token format that the gRPC API rejects silently.
    """
    p    = PLATFORMS[platform_key]
    host = p["bm_host"]
    # Build as a minified IIFE — no import(), no fetch of external scripts (CSP)
    js = (
        "async()=>{"
        f"if(!location.hostname.includes('{host}'))"
        f"{{alert('Open {host} first, then click this bookmark from that tab.');return;}}"

        # Method 1: localStorage Firebase auth state
        "let token=null;"
        "for(const k of Object.keys(localStorage)){"
        "if(!k.startsWith('firebase:authUser:'))continue;"
        "try{"
        "const obj=JSON.parse(localStorage.getItem(k));"
        "const t=obj&&obj.stsTokenManager&&obj.stsTokenManager.accessToken;"
        "if(t&&t.startsWith('eyJ')){token=t;break;}"
        "}catch(e){}}"

        # Method 2: any raw JWT in localStorage
        "if(!token){"
        "for(const k of Object.keys(localStorage)){"
        "const v=localStorage.getItem(k);"
        "if(v&&v.startsWith('eyJ')&&v.length>200){token=v;break;}"
        "}}"

        # Method 3: /token endpoint fallback
        "if(!token){"
        "try{"
        "const r=await fetch('https://api.sparx-learning.com/token',{credentials:'include'});"
        "if(r.ok){const t=(await r.text()).trim();if(t)token=t;}"
        "}catch(e){}}"

        "if(!token){alert('Could not get auth token — make sure you are logged into Sparx.');return;}"

        "const code=prompt('Enter your Discord code (from the bot):');"
        "if(!code||code.trim().length<6)return;"
        f"const b=JSON.stringify({{t:token,code:code.trim().toUpperCase(),platform:'{platform_key}'}});"
        f"const res=await fetch('{submit_url}',{{method:'POST',"
        "headers:{'Content-Type':'application/json'},body:b});"
        "const d=await res.json();"
        "alert(d.message||d.error||'Connected! Check Discord.');"
        "}"
    )
    return f"javascript:({js})()"


def bar(cur: int, tot: int, ln: int = 14) -> str:
    if tot <= 0: return "░" * ln
    filled = min(ln, int(ln * cur / tot))
    return "█" * filled + "░" * (ln - filled)

def pct(cur: int, tot: int) -> str:
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
            qb    = bar(prog.q_done, prog.q_total) if prog.q_total else "░" * 14
            sb    = bar(total, prog.srp_target)
            if prog.done and not prog.error: color, status = COL_GREEN, "Complete"
            elif prog.error:                 color, status = COL_RED,   "Error"
            else:                            color, status = COL_BLUE,  "Running"
            e = discord.Embed(title=pkg["name"], color=color)
            e.add_field(name="Questions",
                value=f"`{qb}`\n{prog.q_done}/{prog.q_total or '?'} · {pct(prog.q_done, prog.q_total)}",
                inline=False)
            e.add_field(name="SRP",
                value=f"`{sb}`\n{total}/{prog.srp_target} · {pctv}%",
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
            dm = await user.create_dm()
            await dm.send(embed=discord.Embed(title="Job Failed", description=str(e), color=COL_RED))
        except Exception: pass
    finally:
        _running.discard(user_id)


# ── views ─────────────────────────────────────────────────────────────────────
def _bookmark_embed(platform_key: str, code: str) -> discord.Embed:
    submit = f"{PUBLIC_URL}/cg-mobile"
    bm     = _bm_url(platform_key, submit)
    p      = PLATFORMS[platform_key]
    embed  = discord.Embed(title=f"Connect — {p['label']}", color=COL_BLUE)
    embed.add_field(
        name="1 · Add the bookmarklet",
        value=(
            "Create a new bookmark in your browser. "
            "Set the **URL / Location** field to:\n"
            f"```\n{bm[:1000]}\n```"
        ),
        inline=False,
    )
    embed.add_field(
        name="2 · Run it on Sparx",
        value=f"Go to [sparx-learning.com](https://maths.sparx-learning.com) and log in. Click the bookmark.",
        inline=False,
    )
    embed.add_field(
        name="3 · Enter your code",
        value=f"Paste this when prompted:\n```\n{code}\n```",
        inline=False,
    )
    embed.set_footer(text="Code expires in 10 minutes")
    return embed


def _books_embed(info: dict, pkgs: list[dict]) -> discord.Embed:
    embed = discord.Embed(
        title="Select a Package",
        description=f"**{info['name']}** · {info['srp']} SRP",
        color=COL_BLUE,
    )
    for p in pkgs[:10]:
        b      = bar(p["srp_earned"], p["srp_target"], 10)
        status = "Complete ✅" if p["complete"] else f"`{b}` {p['srp_earned']}/{p['srp_target']} SRP"
        embed.add_field(name=p["name"], value=status, inline=True)
    embed.set_footer(text="Select a package below → Start")
    return embed


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
                description=("Complete ✅" if p["complete"] else f"{p['srp_earned']}/{p['srp_target']} SRP")[:100],
            )
            for i, p in enumerate(pkgs[:25])
        ]
        select = ui.Select(placeholder="Pick a package…", options=options)
        select.callback = self._on_select
        self.add_item(select)

        start = ui.Button(label="▶ Start", style=discord.ButtonStyle.success, custom_id="book_start")
        start.callback = self._on_start
        self.add_item(start)

        refresh = ui.Button(label="🔄 Refresh", style=discord.ButtonStyle.secondary, custom_id="book_refresh")
        refresh.callback = self._on_refresh
        self.add_item(refresh)

    async def _on_select(self, interaction: discord.Interaction):
        idx = int(interaction.data["values"][0])
        self.selected = self.pkgs[idx]
        await interaction.response.send_message(
            f"Selected: **{self.selected['name']}**", ephemeral=True
        )

    async def _on_start(self, interaction: discord.Interaction):
        if interaction.user.id != self.user_id:
            await interaction.response.send_message("Not your session.", ephemeral=True); return
        if not self.selected:
            await interaction.response.send_message("Pick a package first.", ephemeral=True); return
        if self.user_id in _running:
            await interaction.response.send_message("Job already running — check DMs.", ephemeral=True); return

        await interaction.response.send_message(
            f"▶ Starting **{self.selected['name']}** — progress in your DMs.", ephemeral=True
        )
        sess = _sessions.get(self.user_id, {})
        asyncio.create_task(_run_homework(self.bot, sess["token"], self.selected, self.user_id))

    async def _on_refresh(self, interaction: discord.Interaction):
        if interaction.user.id != self.user_id:
            await interaction.response.send_message("Not your session.", ephemeral=True); return
        sess = _sessions.get(self.user_id)
        if not sess:
            await interaction.response.send_message("Not connected.", ephemeral=True); return
        pkgs = await sparx.get_packages(sess["token"])
        _sessions[self.user_id]["packages"] = pkgs
        if pkgs:
            await interaction.response.edit_message(
                embed=_books_embed(sess["info"], pkgs),
                view=BookSelectView(self.user_id, pkgs, self.bot),
            )
        else:
            await interaction.response.send_message("Still no packages found.", ephemeral=True)


class PlatformSelectView(ui.View):
    def __init__(self, user_id: int, channel_id: int):
        super().__init__(timeout=120)
        self.user_id    = user_id
        self.channel_id = channel_id
        for key, p in PLATFORMS.items():
            btn = ui.Button(label=p["label"], style=discord.ButtonStyle.primary)
            btn.callback = self._make_cb(key)
            self.add_item(btn)

    def _make_cb(self, key: str):
        async def cb(interaction: discord.Interaction):
            code  = make_code(self.user_id, self.channel_id)
            embed = _bookmark_embed(key, code)
            await interaction.response.send_message(embed=embed, ephemeral=True)
        return cb


class PanelView(ui.View):
    def __init__(self, bot: discord.Client):
        super().__init__(timeout=None)
        self.bot = bot

    @ui.button(label="▶ Start Session", style=discord.ButtonStyle.success,
               custom_id="hw_panel_start", row=0)
    async def start_btn(self, interaction: discord.Interaction, button: ui.Button):
        uid = interaction.user.id
        if uid in _running:
            await interaction.response.send_message(
                embed=discord.Embed(description="Job running — check DMs.", color=COL_GOLD),
                ephemeral=True); return

        sess = _sessions.get(uid)
        if sess and sess.get("packages"):
            await interaction.response.send_message(
                embed=_books_embed(sess["info"], sess["packages"]),
                view=BookSelectView(uid, sess["packages"], self.bot),
                ephemeral=True); return

        await interaction.response.send_message(
            embed=discord.Embed(title="Select Platform", color=COL_BLUE),
            view=PlatformSelectView(uid, interaction.channel_id),
            ephemeral=True)

    @ui.button(label="📚 My Books", style=discord.ButtonStyle.secondary,
               custom_id="hw_panel_books", row=0)
    async def books_btn(self, interaction: discord.Interaction, button: ui.Button):
        uid  = interaction.user.id
        sess = _sessions.get(uid)
        if not sess:
            await interaction.response.send_message(
                embed=discord.Embed(description="Not connected. Click **Start Session**.", color=COL_RED),
                ephemeral=True); return
        pkgs = sess.get("packages", [])
        if not pkgs:
            await interaction.response.send_message(
                embed=discord.Embed(title="No Packages",
                    description="No packages found. Click **Start Session** to reconnect.", color=COL_GOLD),
                ephemeral=True); return
        await interaction.response.send_message(
            embed=_books_embed(sess["info"], pkgs),
            view=BookSelectView(uid, pkgs, self.bot),
            ephemeral=True)

    @ui.button(label="❓ Help", style=discord.ButtonStyle.secondary,
               custom_id="hw_panel_help", row=0)
    async def help_btn(self, interaction: discord.Interaction, button: ui.Button):
        embed = discord.Embed(title="How It Works", color=COL_PURPLE, description=(
            "**1.** Click **Start Session** → pick Sparx Maths\n"
            "**2.** Save the bookmarklet (paste into a new bookmark's URL field)\n"
            "**3.** Go to maths.sparx-learning.com, log in, click the bookmark\n"
            "**4.** Enter the code when prompted\n"
            "**5.** Pick a package → Start\n"
            "**6.** Watch progress in DMs\n\n"
            "Your password is never sent. The bookmarklet reads your session token directly."
        ))
        await interaction.response.send_message(embed=embed, ephemeral=True)


# ── post-login (called from web_app.py) ──────────────────────────────────────
async def post_login(bot: discord.Client, token: str, user_id: int, channel_id: int, platform: str):
    channel = bot.get_channel(channel_id) or await bot.fetch_channel(channel_id)
    try:
        info = await sparx.get_student_info(token)
        pkgs = await sparx.get_packages(token)
    except Exception as e:
        await channel.send(f"<@{user_id}>", embed=discord.Embed(
            title="Connection Failed", description=f"```{e}```", color=COL_RED))
        return

    _sessions[user_id] = {"token": token, "info": info, "packages": pkgs, "platform": platform}

    if not pkgs:
        await channel.send(f"<@{user_id}>", embed=discord.Embed(
            title="Connected — No Packages Found",
            description=(
                f"Signed in as **{info['name']}**\n\n"
                "No packages returned. This means the token was accepted but Sparx returned empty data.\n"
                "**To debug:** add `LOG_LEVEL=DEBUG` to Railway Variables and check the deploy logs "
                "for `grpc-status` and `PackageData top` lines.\n\n"
                "Click **Start Session** again to retry."
            ),
            color=COL_GOLD))
        return

    await channel.send(
        f"<@{user_id}>",
        embed=_books_embed(info, pkgs),
        view=BookSelectView(user_id, pkgs, bot),
    )


# ── cog ───────────────────────────────────────────────────────────────────────
class Homework(discord.ext.commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="sparx", description="Open the Sparx homework autocomplete panel")
    async def sparx_cmd(self, interaction: discord.Interaction):
        embed = discord.Embed(
            title=" Sparx Autocomplete",
            description=(
                "** Start Session** — connect your Sparx account via bookmarklet\n"
                "** My Books** — view / start a package\n"
                "** Help** — how it works\n\n"
                "Progress streams live to your DMs."
            ),
            color=COL_BLUE,
        )
        embed.set_footer(text="Powered by Gemini")
        await interaction.response.send_message(embed=embed, view=PanelView(self.bot))


async def setup(bot):
    await bot.add_cog(Homework(bot))
