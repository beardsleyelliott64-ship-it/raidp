# language: Python, file: main.py
# Sparx autocomplete Discord bot — /panel flow with live DM progress

from __future__ import annotations
import asyncio, logging, os, secrets, time
import discord
from discord import app_commands, ui
from aiohttp import web
import sparx, gemini

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
)
log = logging.getLogger("main")

PUBLIC_URL = os.environ.get("RAILWAY_PUBLIC_DOMAIN", os.environ.get("PUBLIC_URL", ""))
if PUBLIC_URL and not PUBLIC_URL.startswith("http"):
    PUBLIC_URL = f"https://{PUBLIC_URL}"

# ── state ─────────────────────────────────────────────────────────────────────
_pending:  dict[str, dict] = {}   # code → {user_id, channel_id, ts}
_sessions: dict[int, dict] = {}   # user_id → {token, info, packages}
_running:  set[int]        = set()
CODE_TTL = 600

def _make_code(user_id: int, channel_id: int) -> str:
    for c, v in list(_pending.items()):
        if time.time() - v["ts"] > CODE_TTL:
            del _pending[c]
    code = secrets.token_hex(3).upper()
    _pending[code] = {"user_id": user_id, "channel_id": channel_id, "ts": time.time()}
    return code

# ── colours / helpers ─────────────────────────────────────────────────────────
COL_BLUE   = 0x5865F2
COL_GREEN  = 0x57F287
COL_GOLD   = 0xFEE75C
COL_RED    = 0xED4245
COL_PURPLE = 0x9B59B6
COL_GREY   = 0x2F3136

def bar(current: int, total: int, length: int = 14) -> str:
    if total <= 0:
        return "░" * length
    filled = min(length, int(length * current / total))
    return "█" * filled + "░" * (length - filled)

def pct(current: int, total: int) -> str:
    return f"{int(100 * current / total)}%" if total > 0 else "0%"

# ── bookmarklet JS ────────────────────────────────────────────────────────────
def _bm_js() -> str:
    submit = f"{PUBLIC_URL}/cg-mobile"
    return f"""const SUBMIT='{submit}';let done=false;
async function go(code){{
  if(!location.hostname.includes('sparx-learning.com')){{
    if(!done){{alert('❌ Open sparx-learning.com first, then run this bookmark from that tab');done=true;}}return;
  }}
  try{{
    const r=await fetch('https://api.sparx-learning.com/token',{{credentials:'include'}});
    if(!r.ok){{if(!done){{alert('❌ Log into Sparx first then run the bookmark again');done=true;}}return;}}
    const t=await r.text();
    const res=await fetch(SUBMIT,{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{t,code}})}});
    const d=await res.json();
    if(!done){{alert(d.message||d.error||'✅ Connected! Check Discord.');done=true;}}
  }}catch(e){{if(!done){{alert('Error: '+e);done=true;}}}}
}}
const code=prompt('🔑 Enter your Discord auth code:');
if(code&&code.trim().length>=6)go(code.trim().toUpperCase());
export{{}};"""

# ── web server ────────────────────────────────────────────────────────────────
async def handle_bm(req: web.Request) -> web.Response:
    return web.Response(
        text=_bm_js(), content_type="application/javascript",
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

    token = body.get("t", "").strip()
    code  = body.get("code", "").strip().upper()
    if not token or not code:
        return web.json_response({"error": "missing t or code"}, status=400, headers=CORS)

    entry = _pending.pop(code, None)
    if not entry or time.time() - entry["ts"] > CODE_TTL:
        return web.json_response(
            {"error": "code not found or expired — run /panel again"}, status=404, headers=CORS)

    user_id    = entry["user_id"]
    channel_id = entry["channel_id"]

    if user_id in _running:
        return web.json_response(
            {"message": "⏳ A job is already running, wait for it to finish."}, headers=CORS)

    asyncio.create_task(_post_login(token, user_id, channel_id))
    return web.json_response({"message": "✅ Connected! Check Discord to pick your book."}, headers=CORS)

async def handle_health(req: web.Request) -> web.Response:
    return web.json_response({"status": "ok"})

def build_app() -> web.Application:
    app = web.Application()
    app.router.add_get("/",            handle_health)
    app.router.add_get("/health",      handle_health)
    app.router.add_get("/bm",          handle_bm)
    app.router.add_options("/cg-mobile", handle_options)
    app.router.add_post("/cg-mobile",  handle_cg)
    return app

# ── post-login: fetch student + packages, send book selector ──────────────────
async def _post_login(token: str, user_id: int, channel_id: int):
    channel = bot.get_channel(channel_id) or await bot.fetch_channel(channel_id)

    try:
        info = await sparx.get_student_info(token)
        pkgs = await sparx.get_packages(token)
    except Exception as e:
        embed = discord.Embed(
            title="❌ Connection Failed",
            description=f"Couldn't fetch your Sparx data.\n```{e}```",
            color=COL_RED,
        )
        await channel.send(f"<@{user_id}>", embed=embed)
        return

    _sessions[user_id] = {"token": token, "info": info, "packages": pkgs}

    if not pkgs:
        embed = discord.Embed(
            title="✅ Logged In — No Packages Found",
            description=(
                f"Signed in as **{info['name']}** ⭐ {info['srp']} SRP\n\n"
                "No homework packages were found on your account.\n"
                "This usually means the API path hasn't been matched yet. "
                "Check the server logs — the JWT claims will show there.\n\n"
                "Try clicking **📖 My Books** after Sparx loads a task, or "
                "wait for your teacher to assign homework."
            ),
            color=COL_GOLD,
        )
        embed.set_footer(text="If you see homework on sparx-learning.com, open an issue")
        await channel.send(f"<@{user_id}>", embed=embed)
        return

    embed = _books_embed(info, pkgs)
    view  = BookSelectView(user_id, pkgs)
    await channel.send(f"<@{user_id}>", embed=embed, view=view)

def _books_embed(info: dict, pkgs: list[dict]) -> discord.Embed:
    embed = discord.Embed(
        title="📚 Select a Homework Package",
        description=f"**{info['name']}** · ⭐ {info['srp']} SRP total",
        color=COL_BLUE,
    )
    for p in pkgs[:10]:
        done   = p["complete"]
        filled = bar(p["srp_earned"], p["srp_target"], 10)
        status = "✅ Complete" if done else f"`{filled}` {p['srp_earned']}/{p['srp_target']} SRP"
        embed.add_field(name=p["name"], value=status, inline=True)
    embed.set_footer(text="Select a package below, then hit ▶️ Start")
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
            total_srp = prog.srp_start + prog.srp_earned
            srp_pct   = min(100, int(100 * total_srp / prog.srp_target)) if prog.srp_target else 0
            q_bar     = bar(prog.q_done, prog.q_total) if prog.q_total else "░" * 14
            srp_bar   = bar(total_srp, prog.srp_target)

            if prog.done and not prog.error:
                color, title = COL_GREEN, "✅ Complete!"
                footer = "All done — check Sparx to verify"
            elif prog.error:
                color, title = COL_RED, "❌ Error"
                footer = prog.error
            else:
                color, title = COL_BLUE, "⚙️ Autocompleting..."
                footer = "Answering questions with Gemini AI"

            e = discord.Embed(title=f"📖 {pkg['name']}", color=color)
            e.add_field(
                name="📊 Questions",
                value=f"`{q_bar}`\n{prog.q_done}/{prog.q_total if prog.q_total else '?'} — {pct(prog.q_done, prog.q_total)}",
                inline=False,
            )
            e.add_field(
                name="⭐ SRP Progress",
                value=f"`{srp_bar}`\n{total_srp}/{prog.srp_target} SRP — {srp_pct}%",
                inline=False,
            )
            e.add_field(name="✅ Answered",   value=str(prog.q_done),      inline=True)
            e.add_field(name="⭐ SRP Earned", value=f"+{prog.srp_earned}",  inline=True)
            e.add_field(name="🎯 Status",
                value="Finished" if prog.done else ("Error" if prog.error else "Running"),
                inline=True)
            e.set_footer(text=title + " · " + footer)
            return e

        msg     = await dm.send(embed=_embed())
        hw_task = asyncio.create_task(
            sparx.complete_package(
                token=token, pkg=pkg,
                answer_fn=gemini.answer, progress=prog,
            )
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
            embed = discord.Embed(title="❌ Job Failed", description=str(e), color=COL_RED)
            await dm.send(embed=embed)
        except Exception:
            pass
    finally:
        _running.discard(user_id)

# ── views ─────────────────────────────────────────────────────────────────────

class PanelView(ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @ui.button(label="🚀 Start Session", style=discord.ButtonStyle.primary, custom_id="panel_login")
    async def login_btn(self, interaction: discord.Interaction, button: ui.Button):
        user_id    = interaction.user.id
        channel_id = interaction.channel_id

        if user_id in _running:
            await interaction.response.send_message(
                "⏳ You have a job running. Check your DMs.", ephemeral=True)
            return

        # already have a session with packages — skip straight to book picker
        if user_id in _sessions:
            pkgs = _sessions[user_id]["packages"]
            info = _sessions[user_id]["info"]
            if not pkgs:
                await interaction.response.send_message(
                    embed=discord.Embed(
                        title="📭 No Packages",
                        description="No homework packages found on your account yet.\nTry **🔄 Refresh** after Sparx loads your tasks.",
                        color=COL_GOLD,
                    ),
                    ephemeral=True,
                )
                return
            embed = _books_embed(info, pkgs)
            view  = BookSelectView(user_id, pkgs)
            await interaction.response.send_message(embed=embed, view=view, ephemeral=True)
            return

        code   = _make_code(user_id, channel_id)
        bm_url = f"javascript:import('{PUBLIC_URL}/bm')"

        embed = discord.Embed(
            title="🔑 Connect Your Sparx Account",
            color=COL_GOLD,
        )
        embed.add_field(
            name="Step 1 — Add the bookmark",
            value=(
                "Copy this and **save it as a new browser bookmark**:\n"
                f"```\n{bm_url}\n```"
            ),
            inline=False,
        )
        embed.add_field(
            name="Step 2 — Run it on Sparx",
            value="Go to [sparx-learning.com](https://www.sparx-learning.com), log in, then click the bookmark.",
            inline=False,
        )
        embed.add_field(
            name="Step 3 — Enter your code",
            value=f"The bookmark will prompt you. Paste this:\n```\n{code}\n```",
            inline=False,
        )
        embed.set_footer(text="⏰ Code expires in 10 minutes · Your books will appear automatically after")
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @ui.button(label="📖 My Books", style=discord.ButtonStyle.secondary, custom_id="panel_books")
    async def books_btn(self, interaction: discord.Interaction, button: ui.Button):
        user_id = interaction.user.id
        if user_id not in _sessions:
            await interaction.response.send_message(
                embed=discord.Embed(
                    description="❌ Not logged in yet — click **🚀 Start Session** first.",
                    color=COL_RED,
                ),
                ephemeral=True,
            )
            return
        pkgs = _sessions[user_id]["packages"]
        info = _sessions[user_id]["info"]
        if not pkgs:
            await interaction.response.send_message(
                embed=discord.Embed(
                    title="📭 No Packages",
                    description="No homework packages found. Try **🔄 Refresh** if you've been assigned work since logging in.",
                    color=COL_GOLD,
                ),
                ephemeral=True,
            )
            return
        embed = _books_embed(info, pkgs)
        view  = BookSelectView(user_id, pkgs)
        await interaction.response.send_message(embed=embed, view=view, ephemeral=True)

    @ui.button(label="❓ Help", style=discord.ButtonStyle.secondary, custom_id="panel_help")
    async def help_btn(self, interaction: discord.Interaction, button: ui.Button):
        bm = f"javascript:import('{PUBLIC_URL}/bm')"
        embed = discord.Embed(
            title="❓ How It Works",
            color=COL_PURPLE,
            description=(
                "**1.** Click **🚀 Start Session** and follow the three steps\n"
                "**2.** The bot reads your Sparx homework packages\n"
                "**3.** Pick a package and hit **▶️ Start**\n"
                "**4.** Live progress lands in your DMs:\n"
                "   · Questions answered\n"
                "   · SRP earned with a progress bar\n"
                "   · Completion percentage\n\n"
                "**The bookmark:**\n"
                f"```\n{bm}\n```\n"
                "Save as a browser bookmark. Click it while on sparx-learning.com — it grabs your auth token automatically.\n\n"
                "**Powered by:** Gemini 1.5 Flash"
            ),
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)


class BookSelectView(ui.View):
    def __init__(self, user_id: int, packages: list[dict]):
        super().__init__(timeout=300)
        self.user_id   = user_id
        self.packages  = packages
        self.selected: dict | None = None

        opts = []
        for p in packages[:25]:
            filled = bar(p["srp_earned"], p["srp_target"], 8)
            desc   = "Complete" if p["complete"] else f"{p['srp_earned']}/{p['srp_target']} SRP"
            opts.append(discord.SelectOption(
                label=p["name"][:100],
                value=p["id"],
                description=desc[:100],
                emoji="✅" if p["complete"] else "📖",
            ))

        # Guard: Discord rejects a Select with 0 options
        if opts:
            self.select = ui.Select(
                placeholder="📖 Choose a homework package...",
                options=opts,
            )
            self.select.callback = self._select_cb
            self.add_item(self.select)
        else:
            self.select = None

    async def _select_cb(self, interaction: discord.Interaction):
        if interaction.user.id != self.user_id:
            await interaction.response.send_message("This isn't your panel.", ephemeral=True)
            return
        sel_id        = self.select.values[0]
        self.selected = next((p for p in self.packages if p["id"] == sel_id), None)
        name          = self.selected["name"] if self.selected else "Unknown"

        embed = interaction.message.embeds[0] if interaction.message.embeds else discord.Embed()
        embed.set_footer(text=f"Selected: {name} · click ▶️ Start to begin")
        self.start_btn.disabled = False
        await interaction.response.edit_message(embed=embed, view=self)

    @ui.button(label="▶️ Start", style=discord.ButtonStyle.success, disabled=True)
    async def start_btn(self, interaction: discord.Interaction, button: ui.Button):
        if interaction.user.id != self.user_id:
            await interaction.response.send_message("This isn't your panel.", ephemeral=True)
            return
        if not self.selected:
            await interaction.response.send_message("Pick a package first.", ephemeral=True)
            return
        if self.user_id in _running:
            await interaction.response.send_message(
                "⏳ Already running — check your DMs.", ephemeral=True)
            return

        sess = _sessions.get(self.user_id)
        if not sess:
            await interaction.response.send_message(
                "❌ Session expired — click **🚀 Start Session** again.", ephemeral=True)
            return

        await interaction.response.send_message(
            embed=discord.Embed(
                title=f"⚙️ Starting {self.selected['name']}",
                description="Check your **DMs** for a live progress card.",
                color=COL_GREEN,
            ),
            ephemeral=True,
        )
        asyncio.create_task(_run_homework(sess["token"], self.selected, self.user_id))

    @ui.button(label="🔄 Refresh", style=discord.ButtonStyle.secondary)
    async def refresh_btn(self, interaction: discord.Interaction, button: ui.Button):
        if interaction.user.id != self.user_id:
            await interaction.response.send_message("This isn't your panel.", ephemeral=True)
            return
        sess = _sessions.get(self.user_id)
        if not sess:
            await interaction.response.send_message("❌ Not logged in.", ephemeral=True)
            return
        await interaction.response.defer()
        try:
            pkgs = await sparx.get_packages(sess["token"])
            _sessions[self.user_id]["packages"] = pkgs
            new_view = BookSelectView(self.user_id, pkgs)
            if pkgs:
                embed = _books_embed(_sessions[self.user_id]["info"], pkgs)
            else:
                embed = discord.Embed(
                    title="📭 Still No Packages",
                    description=f"Found 0 packages. Check the server logs for API paths.",
                    color=COL_GOLD,
                )
            await interaction.edit_original_response(embed=embed, view=new_view)
        except Exception as e:
            await interaction.edit_original_response(
                embed=discord.Embed(title="❌ Refresh Failed", description=str(e), color=COL_RED),
            )


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
    log.info("[bot] online as %s — synced %d command(s) to guild %s",
             bot.user, len(synced), GUILD_ID.id)

@tree.command(name="panel", description="Open the Sparx homework autocomplete panel")
async def slash_panel(interaction: discord.Interaction):
    embed = discord.Embed(
        title="📚 Sparx Autocompleter",
        description=(
            "Automatically complete Sparx homework with Gemini AI.\n\n"
            "**🚀 Start Session** — connect your account via browser bookmark\n"
            "**📖 My Books** — view your packages and start autocomplete\n"
            "**❓ Help** — full walkthrough\n\n"
            "*Live SRP progress sent to your DMs*"
        ),
        color=COL_BLUE,
    )
    embed.set_footer(text="Powered by Gemini 1.5 Flash · Similar to SenAI / Zurith")
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
        log.error("[bot] DISCORD_BOT_TOKEN not set — web server up, bot offline")
        await asyncio.Event().wait()
        return

    log.info("[bot] connecting to Discord...")
    await bot.start(token)

if __name__ == "__main__":
    asyncio.run(main())
