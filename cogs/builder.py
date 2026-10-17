# cogs/builder.py

import discord
from discord.ext import commands
from discord import app_commands
import logging, io, re, zipfile, textwrap, time, asyncio, aiohttp

log = logging.getLogger("builder")

# ── progress bar ──────────────────────────────────────────────────────────────

def _bar(step: int, total: int = 10) -> str:
    filled = max(0, min(step, total))
    return f"`[{'█' * filled}{'░' * (total - filled)}]` {filled * 10}%"

def _status_text(project: str, step: int, label: str) -> str:
    return (
        f"## {project}\n"
        f"### Build Status\n"
        f"`{label}`\n"
        f"{_bar(step)}\n"
        f"-# Last updated <t:{int(time.time())}:R>"
    )

async def _run_with_progress(msg, project: str, coro, step_seconds: float = 3.0):
    done = asyncio.Event()
    result_box, err_box = [None], [None]

    async def updater():
        step = 1
        while not done.is_set():
            try:
                await msg.edit(content=_status_text(project, step, "Generating…"))
            except Exception:
                pass
            await asyncio.sleep(step_seconds)
            step = min(step + 1, 9)

    async def runner():
        try:
            result_box[0] = await coro
        except Exception as e:
            err_box[0] = e
        finally:
            done.set()

    t = asyncio.create_task(updater())
    await runner()
    t.cancel()
    if err_box[0]:
        raise err_box[0]
    return result_box[0]

# ── file helpers ──────────────────────────────────────────────────────────────

TEXT_EXT = {
    ".py",".js",".ts",".jsx",".tsx",".html",".css",".json",
    ".yaml",".yml",".toml",".md",".txt",".sh",".env",".example",
    ".go",".rs",".cpp",".c",".h",".java",".rb",".php",".cs",
    ".sql",".xml",".ini",".cfg",".conf",".gitignore",
}

def _parse_response(text: str) -> dict[str, str]:
    files: dict[str, str] = {}
    for m in re.finditer(r"```[\w]*\n(?:#\s*|//\s*)?([^\s`][^\n]*\.[a-zA-Z0-9]+)\n(.*?)```", text, re.DOTALL):
        files[m.group(1).strip().lstrip("# /")] = m.group(2)
    if files: return files
    for m in re.finditer(r"\*\*([^\*]+\.[a-zA-Z0-9]+)\*\*[^\n]*\n```[\w]*\n(.*?)```", text, re.DOTALL):
        files[m.group(1).strip()] = m.group(2)
    if files: return files
    lang_ext = {"python":"py","py":"py","javascript":"js","js":"js","typescript":"ts","ts":"ts",
                "html":"html","css":"css","bash":"sh","sh":"sh","json":"json","go":"go","rust":"rs"}
    for i,(lang,content) in enumerate(re.findall(r"```(\w*)\n(.*?)```", text, re.DOTALL)):
        ext = lang_ext.get(lang.lower(), "txt")
        files[f"main.{ext}" if i==0 else f"file_{i}.{ext}"] = content
    if not files: files["README.md"] = text
    return files

def _make_zip(files: dict[str, str], name: str) -> io.BytesIO:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for fname, content in files.items():
            zf.writestr(f"{name}/{fname}", content)
    buf.seek(0)
    return buf

def _read_zip(data: bytes) -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            for name in zf.namelist():
                if any(name.lower().endswith(e) for e in TEXT_EXT):
                    try:
                        c = zf.read(name).decode("utf-8", errors="replace")
                        if len(c) < 60_000: out[name] = c
                    except Exception: pass
    except Exception as e:
        log.warning("zip read: %s", e)
    return out

def _read_file(data: bytes, filename: str) -> dict[str, str]:
    return {filename: data.decode("utf-8", errors="replace")[:60_000]}

def _fmt_code(files: dict[str, str]) -> str:
    return "\n\n".join(
        f"### {fn}\n```\n{c[:4000]}\n```"
        for fn, c in list(files.items())[:20]
    )

# ── pending state: user_id → { attachment_data, attachment_name, channel_id } ──
pending_file: dict[int, dict] = {}
pending_wait: dict[int, asyncio.Event] = {}

# ── modals ────────────────────────────────────────────────────────────────────

class BuildNewModal(discord.ui.Modal, title="🔨 Build New Project"):
    project_name = discord.ui.TextInput(label="Project Name", placeholder="my-bot", max_length=50)
    description  = discord.ui.TextInput(label="What to build?", style=discord.TextStyle.paragraph,
                                        placeholder="Language, features, platform…", max_length=2000)
    extra        = discord.ui.TextInput(label="Extra requirements (optional)", style=discord.TextStyle.paragraph,
                                        placeholder="Railway, .env.example, Python 3.11…",
                                        max_length=500, required=False)

    def __init__(self, gemini):
        super().__init__()
        self.gemini = gemini

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        project = self.project_name.value.strip().replace(" ", "-")
        desc    = self.description.value.strip()
        extra   = self.extra.value.strip()

        prompt = textwrap.dedent(f"""
            Build a complete working project called "{project}".
            REQUIREMENTS: {desc}
            ADDITIONAL: {extra or "None"}
            Output every file as:
            ```<lang>
            # <filename.ext>
            <content>
            ```
            Include entry point, deps file, .env.example, README. No stubs, no TODOs.
        """).strip()

        status = await interaction.followup.send(_status_text(project, 0, "Starting…"), ephemeral=True, wait=True)
        try:
            result = await _run_with_progress(status, project, self.gemini.generate(prompt))
        except Exception as e:
            await status.edit(content=f"❌ {e}"); return

        await status.edit(content=_status_text(project, 10, "Complete ✅"))
        files = _parse_response(result)
        embed = discord.Embed(title=f"📦 {project}", color=0x57F287,
            description="\n".join(f"• `{f}`" for f in list(files.keys())[:20]))
        embed.set_footer(text=f"Built by Gemini • {project}.zip")
        await interaction.followup.send(embed=embed,
            file=discord.File(_make_zip(files, project), filename=f"{project}.zip"), ephemeral=True)


class ImproveModal(discord.ui.Modal, title="📤 Improve Your File"):
    project_name = discord.ui.TextInput(label="Output project name", placeholder="my-project-improved", max_length=50)
    instructions = discord.ui.TextInput(label="What to improve or add?", style=discord.TextStyle.paragraph,
                                        placeholder="Add a level up system, fix auth, improve UI…", max_length=2000)

    def __init__(self, gemini, file_data: bytes, file_name: str, status_msg):
        super().__init__()
        self.gemini    = gemini
        self.file_data = file_data
        self.file_name = file_name
        self.status_msg = status_msg

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        project = self.project_name.value.strip().replace(" ", "-")
        instructions = self.instructions.value.strip()

        fname = self.file_name.lower()
        existing = _read_zip(self.file_data) if fname.endswith(".zip") else _read_file(self.file_data, self.file_name)
        if not existing:
            await interaction.followup.send("❌ Couldn't read any text from that file.", ephemeral=True); return

        prompt = textwrap.dedent(f"""
            Improve the project "{project}".
            EXISTING CODE ({len(existing)} file(s)):
            {_fmt_code(existing)}
            IMPROVEMENTS: {instructions}
            Output the full updated project — every file including unchanged ones.
            Format as:
            ```<lang>
            # <filename.ext>
            <content>
            ```
            No stubs, no TODOs, no explanations.
        """).strip()

        # update the existing status message
        try:
            await self.status_msg.edit(content=_status_text(project, 0, "Starting…"))
        except Exception:
            self.status_msg = await interaction.followup.send(
                _status_text(project, 0, "Starting…"), ephemeral=True, wait=True)

        try:
            result = await _run_with_progress(self.status_msg, project, self.gemini.generate(prompt))
        except Exception as e:
            await self.status_msg.edit(content=f"❌ {e}"); return

        await self.status_msg.edit(content=_status_text(project, 10, "Complete ✅"))
        files = _parse_response(result)
        embed = discord.Embed(title=f"📦 {project} (improved)", color=0x57F287,
            description="\n".join(f"• `{f}`" for f in list(files.keys())[:20]))
        embed.add_field(name="Improvements", value=instructions[:400], inline=False)
        embed.add_field(name="Source", value=f"`{self.file_name}` — {len(existing)} file(s)", inline=False)
        embed.set_footer(text=f"Improved by Gemini • {project}.zip")
        await interaction.followup.send(embed=embed,
            file=discord.File(_make_zip(files, project), filename=f"{project}.zip"), ephemeral=True)

# ── upload-file view (shown after clicking Improve File) ─────────────────────

class UploadPromptView(discord.ui.View):
    """Shown ephemerally — user sees this, uploads a file, bot detects it."""
    def __init__(self):
        super().__init__(timeout=300)

    @discord.ui.button(label="📎 I've uploaded my file", style=discord.ButtonStyle.primary, custom_id="improve_confirm")
    async def confirm(self, interaction: discord.Interaction, button: discord.ui.Button):
        ev = pending_wait.get(interaction.user.id)
        if ev:
            ev.set()
        await interaction.response.defer()

# ── main panel view ───────────────────────────────────────────────────────────

class BuildPanelView(discord.ui.View):
    def __init__(self, gemini):
        super().__init__(timeout=None)
        self.gemini = gemini

    @discord.ui.button(label="🔨 Build New", style=discord.ButtonStyle.success, custom_id="build_new_v4")
    async def build_new(self, interaction: discord.Interaction, _button):
        await interaction.response.send_modal(BuildNewModal(self.gemini))

    @discord.ui.button(label="📤 Improve File", style=discord.ButtonStyle.primary, custom_id="build_improve_v4")
    async def improve_file(self, interaction: discord.Interaction, _button):
        user_id = interaction.user.id
        channel = interaction.channel

        ev = asyncio.Event()
        pending_wait[user_id] = ev
        pending_file.pop(user_id, None)

        status = await interaction.response.send_message(
            "**Upload your file or zip below, then click the button.**\n"
            "-# Attach it as a message in this channel — any file or `.zip`",
            ephemeral=True,
            view=UploadPromptView(),
            wait=True if hasattr(interaction.response, 'wait') else False
        )
        # send_message via response doesn't return the message — use followup for status
        status_msg = await interaction.followup.send(
            _status_text("your project", 0, "Waiting for file…"), ephemeral=True, wait=True
        )

        # wait up to 5 min for user to upload file
        try:
            await asyncio.wait_for(ev.wait(), timeout=300)
        except asyncio.TimeoutError:
            pending_wait.pop(user_id, None)
            pending_file.pop(user_id, None)
            await status_msg.edit(content="⏱️ Timed out — no file received."); return

        state = pending_file.pop(user_id, None)
        pending_wait.pop(user_id, None)
        if not state:
            await status_msg.edit(content="❌ No file detected. Try again."); return

        # open improve modal with the file already captured
        modal = ImproveModal(self.gemini, state["data"], state["name"], status_msg)
        await interaction.followup.send_modal(modal)  # type: ignore

# ── cog ───────────────────────────────────────────────────────────────────────

class Builder(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.gemini = bot.gemini_client  # type: ignore

    @app_commands.command(name="build", description="Open the project builder")
    async def build_cmd(self, interaction: discord.Interaction):
        embed = discord.Embed(
            title="🔨 Project Builder",
            description=(
                "**🔨 Build New** — describe a project from scratch\n"
                "**📤 Improve File** — upload a file or zip, describe what to improve\n\n"
                "Everything is private to you."
            ),
            color=0x5865F2,
        )
        embed.set_footer(text="Powered by Gemini")
        await interaction.response.send_message(embed=embed, view=BuildPanelView(self.gemini))

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if message.author.bot or not message.attachments:
            return
        user_id = message.author.id
        if user_id not in pending_wait:
            return

        attachment = message.attachments[0]
        try:
            async with aiohttp.ClientSession() as s:
                async with s.get(attachment.url) as r:
                    data = await r.read()
        except Exception as e:
            log.warning("attachment download: %s", e)
            return

        pending_file[user_id] = {"data": data, "name": attachment.filename}
        ev = pending_wait.get(user_id)
        if ev:
            ev.set()

        try:
            await message.add_reaction("✅")
        except Exception:
            pass

async def setup(bot):
    await bot.add_cog(Builder(bot))
