# cogs/builder.py — /build panel: Build New only
import discord
from discord.ext import commands
from discord import app_commands
import logging, io, re, zipfile, textwrap, time, asyncio

log = logging.getLogger("builder")


def _bar(step: int, total: int = 10) -> str:
    filled = max(0, min(step, total))
    return f"`[{'█' * filled}{'░' * (total - filled)}]` {filled * 10}%"

def _status(project: str, step: int, label: str) -> str:
    return (
        f"## {project}\n"
        f"### Build Status\n"
        f"`{label}`\n"
        f"{_bar(step)}\n"
        f"-# Last updated <t:{int(time.time())}:R>"
    )

async def _with_progress(msg, project: str, coro, step_secs: float = 3.0):
    done, result_box, err_box = asyncio.Event(), [None], [None]
    async def updater():
        step = 1
        while not done.is_set():
            try: await msg.edit(content=_status(project, step, "Generating…"))
            except Exception: pass
            await asyncio.sleep(step_secs)
            step = min(step + 1, 9)
    async def runner():
        try: result_box[0] = await coro
        except Exception as e: err_box[0] = e
        finally: done.set()
    t = asyncio.create_task(updater())
    await runner()
    t.cancel()
    if err_box[0]: raise err_box[0]
    return result_box[0]


def _parse(text: str) -> dict[str, str]:
    files: dict[str, str] = {}
    for m in re.finditer(r"```[\w]*\n(?:#\s*|//\s*)?([^\s`][^\n]*\.[a-zA-Z0-9]+)\n(.*?)```", text, re.DOTALL):
        files[m.group(1).strip().lstrip("# /")] = m.group(2)
    if files: return files
    for m in re.finditer(r"\*\*([^\*]+\.[a-zA-Z0-9]+)\*\*[^\n]*\n```[\w]*\n(.*?)```", text, re.DOTALL):
        files[m.group(1).strip()] = m.group(2)
    if files: return files
    lang_ext = {"python":"py","py":"py","javascript":"js","js":"js","typescript":"ts","ts":"ts",
                "html":"html","css":"css","bash":"sh","sh":"sh","json":"json","go":"go"}
    for i,(lang,content) in enumerate(re.findall(r"```(\w*)\n(.*?)```", text, re.DOTALL)):
        ext = lang_ext.get(lang.lower(), "txt")
        files[f"main.{ext}" if i==0 else f"file_{i}.{ext}"] = content
    if not files: files["README.md"] = text
    return files

def _zip(files: dict[str, str], name: str) -> io.BytesIO:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for fname, content in files.items():
            zf.writestr(f"{name}/{fname}", content)
    buf.seek(0)
    return buf


class BuildModal(discord.ui.Modal, title="🔨 Build New Project"):
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

        status = await interaction.followup.send(_status(project, 0, "Starting…"), ephemeral=True, wait=True)
        try:
            result = await _with_progress(status, project, self.gemini.generate(prompt))
        except Exception as e:
            await status.edit(content=f"❌ {e}"); return

        await status.edit(content=_status(project, 10, "Complete ✅"))
        files = _parse(result)
        embed = discord.Embed(title=f"📦 {project}", color=0x57F287,
            description="\n".join(f"• `{f}`" for f in list(files.keys())[:20]))
        embed.add_field(name="Request", value=desc[:400], inline=False)
        embed.set_footer(text=f"Built by Gemini • {project}.zip")
        await interaction.followup.send(embed=embed,
            file=discord.File(_zip(files, project), filename=f"{project}.zip"), ephemeral=True)


class BuildPanelView(discord.ui.View):
    def __init__(self, gemini):
        super().__init__(timeout=None)
        self.gemini = gemini

    @discord.ui.button(label="🔨 Build", style=discord.ButtonStyle.success, custom_id="build_v5")
    async def build(self, interaction: discord.Interaction, _button):
        await interaction.response.send_modal(BuildModal(self.gemini))


class Builder(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.gemini = bot.gemini_client

    @app_commands.command(name="build", description="Open the project builder")
    async def build_cmd(self, interaction: discord.Interaction):
        embed = discord.Embed(
            title="🔨 Project Builder",
            description="Click **Build** to describe your project — Gemini generates it and packages it as a zip.\n\nPrivate to you.",
            color=0x5865F2,
        )
        embed.set_footer(text="Powered by Gemini")
        await interaction.response.send_message(embed=embed, view=BuildPanelView(self.gemini))


async def setup(bot):
    await bot.add_cog(Builder(bot))
