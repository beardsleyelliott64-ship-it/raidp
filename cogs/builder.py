# cogs/builder.py — /build panel → modal → Gemini → zip → download embed

import discord
from discord.ext import commands
from discord import app_commands
import logging
import io
import re
import zipfile
import textwrap

log = logging.getLogger("builder")


def _extract_files(text: str) -> dict[str, str]:
    """
    Parse Gemini's response into {filename: content} pairs.
    Looks for:
      ```language\n# filename.ext\n...\n```
    or
      **filename.ext**\n```...```
    Falls back to a single main file if no named blocks found.
    """
    files: dict[str, str] = {}

    # Pattern 1: ```lang\n# filename\ncontent\n```
    pattern1 = re.compile(
        r"```[\w]*\n(?:#\s*|//\s*|--\s*)?([^\s`][^\n]*\.[a-zA-Z0-9]+)\n(.*?)```",
        re.DOTALL,
    )
    for match in pattern1.finditer(text):
        fname = match.group(1).strip().lstrip("# /")
        content = match.group(2)
        files[fname] = content

    if files:
        return files

    # Pattern 2: **filename.ext** followed by code block
    pattern2 = re.compile(
        r"\*\*([^\*]+\.[a-zA-Z0-9]+)\*\*[^\n]*\n```[\w]*\n(.*?)```",
        re.DOTALL,
    )
    for match in pattern2.finditer(text):
        fname = match.group(1).strip()
        content = match.group(2)
        files[fname] = content

    if files:
        return files

    # Fallback: all code blocks into main.py / index.html etc.
    blocks = re.findall(r"```(\w*)\n(.*?)```", text, re.DOTALL)
    if blocks:
        lang_ext = {
            "python": "py", "py": "py", "javascript": "js", "js": "js",
            "typescript": "ts", "ts": "ts", "html": "html", "css": "css",
            "bash": "sh", "sh": "sh", "json": "json", "yaml": "yaml",
            "yml": "yaml", "go": "go", "rust": "rs", "cpp": "cpp", "c": "c",
        }
        for i, (lang, content) in enumerate(blocks):
            ext = lang_ext.get(lang.lower(), "txt")
            fname = f"main.{ext}" if i == 0 else f"file_{i}.{ext}"
            files[fname] = content
    else:
        # Pure text response — save as readme
        files["README.md"] = text

    return files


def _build_zip(files: dict[str, str], project_name: str) -> io.BytesIO:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for fname, content in files.items():
            zf.writestr(f"{project_name}/{fname}", content)
    buf.seek(0)
    return buf


class BuildModal(discord.ui.Modal, title="🔨 Build Something"):
    project_name = discord.ui.TextInput(
        label="Project Name",
        placeholder="my-discord-bot",
        max_length=50,
        required=True,
    )
    description = discord.ui.TextInput(
        label="What do you want to build?",
        style=discord.TextStyle.paragraph,
        placeholder="Describe your project in detail — language, features, platform, etc.",
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

        status_msg = await interaction.followup.send(
            "⚙️ Generating your project with Gemini…", wait=True, ephemeral=True
        )

        try:
            result = await self.gemini.generate(prompt)
        except Exception as e:
            log.error("Build generation error: %s", e)
            await status_msg.edit(content=f"❌ Generation failed: {e}", )
            return

        files = _extract_files(result)
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

        await status_msg.delete()
        await interaction.followup.send(
            embed=embed,
            file=discord.File(zip_buf, filename=zip_name),
            ephemeral=True,
        )


class BuildPanelView(discord.ui.View):
    def __init__(self, gemini_client):
        super().__init__(timeout=None)
        self.gemini = gemini_client

    @discord.ui.button(
        label="🔨 Build",
        style=discord.ButtonStyle.success,
        custom_id="build_open_modal",
    )
    async def open_build_modal(self, interaction: discord.Interaction, button: discord.ui.Button):
        modal = BuildModal(self.gemini)
        await interaction.response.send_modal(modal)


class Builder(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.gemini = bot.gemini_client  # type: ignore

    @app_commands.command(name="build", description="Open the project builder panel")
    async def build_cmd(self, interaction: discord.Interaction):
        embed = discord.Embed(
            title="🔨 Project Builder",
            description=(
                "Click **Build** to open the form.\n\n"
                "Describe what you want — language, features, platform — and Gemini will generate "
                "the full project and package it as a zip for you to download.\n\n"
                "✨ *AI-powered code generation*"
            ),
            color=0x5865F2,
        )
        embed.set_footer(text="Powered by Gemini")
        view = BuildPanelView(self.gemini)
        await interaction.response.send_message(embed=embed, view=view)


async def setup(bot: commands.Bot):
    await bot.add_cog(Builder(bot))
