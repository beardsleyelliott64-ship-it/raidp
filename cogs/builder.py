# cogs/builder.py — /build panel: Build New + Improve File (zip/any text file)

import discord
from discord.ext import commands
from discord import app_commands
import logging
import io
import re
import zipfile
import textwrap
import time
import aiohttp

log = logging.getLogger("builder")

# { user_id: { "instructions": str, "channel_id": int, "ts": float } }
pending_improvements: dict[int, dict] = {}

PENDING_TTL = 300  # seconds before pending state expires


# ── file parsing ──────────────────────────────────────────────────────────────

def _extract_files_from_response(text: str) -> dict[str, str]:
    files: dict[str, str] = {}

    pattern1 = re.compile(
        r"```[\w]*\n(?:#\s*|//\s*|--\s*)?([^\s`][^\n]*\.[a-zA-Z0-9]+)\n(.*?)```",
        re.DOTALL,
    )
    for m in pattern1.finditer(text):
        files[m.group(1).strip().lstrip("# /")] = m.group(2)
    if files:
        return files

    pattern2 = re.compile(
        r"\*\*([^\*]+\.[a-zA-Z0-9]+)\*\*[^\n]*\n```[\w]*\n(.*?)```",
        re.DOTALL,
    )
    for m in pattern2.finditer(text):
        files[m.group(1).strip()] = m.group(2)
    if files:
        return files

    lang_ext = {
        "python": "py", "py": "py", "javascript": "js", "js": "js",
        "typescript": "ts", "ts": "ts", "html": "html", "css": "css",
        "bash": "sh", "sh": "sh", "json": "json", "yaml": "yaml",
        "go": "go", "rust": "rs", "cpp": "cpp", "c": "c",
    }
    blocks = re.findall(r"```(\w*)\n(.*?)```", text, re.DOTALL)
    if blocks:
        for i, (lang, content) in enumerate(blocks):
            ext = lang_ext.get(lang.lower(), "txt")
            files[f"main.{ext}" if i == 0 else f"file_{i}.{ext}"] = content
    else:
        files["README.md"] = text

    return files


def _build_zip(files: dict[str, str], project_name: str) -> io.BytesIO:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for fname, content in files.items():
            zf.writestr(f"{project_name}/{fname}", content)
    buf.seek(0)
    return buf


TEXT_EXTENSIONS = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".json",
    ".yaml", ".yml", ".toml", ".md", ".txt", ".sh", ".env", ".example",
    ".go", ".rs", ".cpp", ".c", ".h", ".java", ".rb", ".php", ".cs",
    ".sql", ".xml", ".ini", ".cfg", ".conf",
}


def _read_zip_contents(data: bytes) -> dict[str, str]:
    """Extract readable text files from a zip."""
    result: dict[str, str] = {}
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            for name in zf.namelist():
                if any(name.endswith(ext) for ext in TEXT_EXTENSIONS):
                    try:
                        content = zf.read(name).decode("utf-8", errors="replace")
                        if len(content) < 50_000:  # skip huge files
                            result[name] = content
                    except Exception:
                        pass
    except Exception as e:
        log.warning("Zip read error: %s", e)
    return result


def _read_text_file(data: bytes, filename: str) -> dict[str, str]:
    """Read a single text file."""
    if any(filename.endswith(ext) for ext in TEXT_EXTENSIONS):
        try:
            return {filename: data.decode("utf-8", errors="replace")}
        except Exception:
            pass
    return {"file": data.decode("utf-8", errors="replace")}


def _format_existing_code(files: dict[str, str]) -> str:
    parts = []
    for fname, content in list(files.items())[:20]:  # cap at 20 files
        parts.append(f"### {fname}\n```\n{content[:3000]}\n```")
    return "\n\n".join(parts)


# ── modals ────────────────────────────────────────────────────────────────────

class BuildModal(discord.ui.Modal, title="🔨 Build Something New"):
    project_name = discord.ui.TextInput(
        label="Project Name",
        placeholder="my-discord-bot",
        max_length=50,
        required=True,
    )
    description = discord.ui.TextInput(
        label="What do you want to build?",
        style=discord.TextStyle.paragraph,
        placeholder="Describe your project — language, features, platform, etc.",
        max_length=2000,
        required=True,
    )
    extra = discord.ui.TextInput(
        label="Extra requirements (optional)",
        style=discord.TextStyle.paragraph,
        placeholder="e.g. use Railway, add .env.example, Python 3.11",
        max_length=500,
        required=False,
    )

    def __init__(self, gemini_client):
        super().__init__()
        self.gemini = gemini_client

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(thinking=True, ephemeral=True)

        project = self.project_name.value.strip().replace(" ", "-")
        desc = self.description.value.strip()
        extra = self.extra.value.strip()

        prompt = textwrap.dedent(f"""
            Build a complete, working project called "{project}".

            REQUIREMENTS:
            {desc}

            ADDITIONAL:
            {extra if extra else "None"}

            OUTPUT RULES:
            - Output every file needed for the project to run
            - Format each file as:
              ```<language>
              # <filename with extension>
              <full file content>
              ```
            - Include: main entry point, requirements/package files, .env.example, README.md
            - No stubs. No TODOs. Every file must be complete and functional.
            - Do not explain. Output files only.
        """).strip()

        status = await interaction.followup.send("⚙️ Generating with Gemini…", wait=True, ephemeral=True)

        try:
            result = await self.gemini.generate(prompt)
        except Exception as e:
            await status.edit(content=f"❌ Generation failed: {e}")
            return

        files = _extract_files_from_response(result)
        zip_buf = _build_zip(files, project)
        zip_name = f"{project}.zip"

        file_list = "\n".join(f"• `{f}`" for f in files)
        embed = discord.Embed(
            title=f"📦 {project}",
            description=f"**{len(files)} file(s) generated:**\n{file_list}",
            color=0x57F287,
        )
        embed.add_field(
            name="Request",
            value=desc[:500] + ("…" if len(desc) > 500 else ""),
            inline=False,
        )
        embed.set_footer(text=f"Built by Gemini • {zip_name}")

        await status.delete()
        await interaction.followup.send(
            embed=embed,
            file=discord.File(zip_buf, filename=zip_name),
            ephemeral=True,
        )


class ImproveModal(discord.ui.Modal, title="📤 Improve / Extend Your File"):
    instructions = discord.ui.TextInput(
        label="What do you want improved or added?",
        style=discord.TextStyle.paragraph,
        placeholder="e.g. Add a level up system, improve the UI, fix the auth flow…",
        max_length=2000,
        required=True,
    )
    project_name = discord.ui.TextInput(
        label="Project name for the output zip",
        placeholder="my-project-improved",
        max_length=50,
        required=True,
    )

    def __init__(self, gemini_client):
        super().__init__()
        self.gemini = gemini_client

    async def on_submit(self, interaction: discord.Interaction):
        user_id = interaction.user.id
        channel_id = interaction.channel_id

        pending_improvements[user_id] = {
            "instructions": self.instructions.value.strip(),
            "project": self.project_name.value.strip().replace(" ", "-"),
            "channel_id": channel_id,
            "ts": time.time(),
        }

        await interaction.response.send_message(
            "📎 **Now upload your file or zip** in this channel and I'll improve it.\n"
            "*(You have 5 minutes — attach the file to any message)*",
            ephemeral=True,
        )


# ── views ─────────────────────────────────────────────────────────────────────

class BuildPanelView(discord.ui.View):
    def __init__(self, gemini_client):
        super().__init__(timeout=None)
        self.gemini = gemini_client

    @discord.ui.button(
        label="🔨 Build New",
        style=discord.ButtonStyle.success,
        custom_id="build_new_v2",
    )
    async def build_new(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_modal(BuildModal(self.gemini))

    @discord.ui.button(
        label="📤 Improve File",
        style=discord.ButtonStyle.primary,
        custom_id="build_improve_v2",
    )
    async def improve_file(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_modal(ImproveModal(self.gemini))


# ── cog ───────────────────────────────────────────────────────────────────────

class Builder(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.gemini = bot.gemini_client  # type: ignore

    @app_commands.command(name="build", description="Open the project builder panel")
    async def build_cmd(self, interaction: discord.Interaction):
        embed = discord.Embed(
            title="🔨 Project Builder",
            description=(
                "**🔨 Build New** — describe a project from scratch, Gemini builds it\n"
                "**📤 Improve File** — upload an existing file or zip, tell it what to improve"
                "\n\nOutput is always a downloadable zip, visible only to you."
            ),
            color=0x5865F2,
        )
        embed.set_footer(text="Powered by Gemini")
        view = BuildPanelView(self.gemini)
        await interaction.response.send_message(embed=embed, view=view)

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if message.author.bot or not message.attachments:
            return

        user_id = message.author.id
        state = pending_improvements.get(user_id)
        if not state:
            return

        # Expire stale states
        if time.time() - state["ts"] > PENDING_TTL:
            del pending_improvements[user_id]
            return

        # Must be in the right channel
        if message.channel.id != state["channel_id"]:
            return

        del pending_improvements[user_id]

        attachment = message.attachments[0]
        project = state["project"]
        instructions = state["instructions"]

        status = await message.reply("⚙️ Reading your file and generating improvements…")

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(attachment.url) as resp:
                    data = await resp.read()
        except Exception as e:
            await status.edit(content=f"❌ Failed to download attachment: {e}")
            return

        # Parse file contents
        fname = attachment.filename.lower()
        if fname.endswith(".zip"):
            existing_files = _read_zip_contents(data)
            if not existing_files:
                await status.edit(content="❌ Couldn't read any text files from that zip.")
                return
        else:
            existing_files = _read_text_file(data, attachment.filename)

        existing_code = _format_existing_code(existing_files)
        file_count = len(existing_files)

        prompt = textwrap.dedent(f"""
            You are improving an existing project called "{project}".

            EXISTING CODE ({file_count} file(s)):
            {existing_code}

            IMPROVEMENT INSTRUCTIONS:
            {instructions}

            OUTPUT RULES:
            - Output the full improved/updated project — every file, including unchanged ones
            - Format each file as:
              ```<language>
              # <filename with extension>
              <full file content>
              ```
            - No stubs. No TODOs. All files complete and functional.
            - Do not explain. Output files only.
        """).strip()

        try:
            result = await self.gemini.generate(prompt)
        except Exception as e:
            await status.edit(content=f"❌ Generation failed: {e}")
            return

        files = _extract_files_from_response(result)
        zip_buf = _build_zip(files, project)
        zip_name = f"{project}.zip"

        file_list = "\n".join(f"• `{f}`" for f in files)
        embed = discord.Embed(
            title=f"📦 {project} (improved)",
            description=f"**{len(files)} file(s) generated:**\n{file_list}",
            color=0x57F287,
        )
        embed.add_field(name="Improvements", value=instructions[:500], inline=False)
        embed.add_field(name="Source", value=f"{file_count} file(s) from `{attachment.filename}`", inline=True)
        embed.set_footer(text=f"Improved by Gemini • {zip_name}")

        await status.delete()
        await message.reply(
            embed=embed,
            file=discord.File(zip_buf, filename=zip_name),
        )


async def setup(bot: commands.Bot):
    await bot.add_cog(Builder(bot))
