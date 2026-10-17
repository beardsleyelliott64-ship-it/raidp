# bot.py — main entry point
# Start command: python bot.py

import os
import asyncio
import logging
import discord
from discord.ext import commands
from dotenv import load_dotenv

from health import start_health_server
from cogs.gemini_client import GeminiClient

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("bot")

DISCORD_TOKEN = os.environ["DISCORD_TOKEN"]
GUILD_ID = os.environ.get("GUILD_ID", "1553107655516622998")


class Bot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.message_content = True
        intents.members = True
        super().__init__(command_prefix="!", intents=intents)
        self.gemini_client = GeminiClient()

    async def setup_hook(self):
        # Load all cogs
        for cog in ("cogs.tickets", "cogs.builder"):
            await self.load_extension(cog)
            log.info("Loaded cog: %s", cog)

        # Sync slash commands
        if GUILD_ID:
            guild = discord.Object(id=int(GUILD_ID))
            self.tree.copy_global_to(guild=guild)
            await self.tree.sync(guild=guild)
            log.info("Synced commands to guild %s (instant)", GUILD_ID)
        else:
            await self.tree.sync()
            log.info("Synced commands globally (up to 1hr propagation)")

    async def on_ready(self):
        log.info("Logged in as %s (ID: %s)", self.user, self.user.id)
        await self.change_presence(
            activity=discord.Activity(
                type=discord.ActivityType.watching,
                name="/ticket • /build",
            )
        )


async def main():
    start_health_server()
    bot = Bot()
    async with bot:
        await bot.start(DISCORD_TOKEN)


if __name__ == "__main__":
    asyncio.run(main())
