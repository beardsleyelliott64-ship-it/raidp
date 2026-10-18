# bot.py — main entry point
import os, asyncio, logging
import discord
from discord.ext import commands
from dotenv import load_dotenv

from web_app import start_web_server
from cogs.gemini_client import GeminiClient

load_dotenv()
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("bot")

DISCORD_TOKEN = os.environ["DISCORD_TOKEN"]
GUILD_ID      = os.environ.get("GUILD_ID", "1553107655516622998")

COGS = ["cogs.tickets", "cogs.builder", "cogs.homework"]


class Bot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.message_content = True
        intents.members = True
        super().__init__(command_prefix="!", intents=intents)
        self.gemini_client = GeminiClient()

    async def setup_hook(self):
        for cog in COGS:
            await self.load_extension(cog)
            log.info("Loaded: %s", cog)
        guild = discord.Object(id=int(GUILD_ID))
        self.tree.copy_global_to(guild=guild)
        await self.tree.sync(guild=guild)
        log.info("Commands synced to guild %s", GUILD_ID)

    async def on_ready(self):
        log.info("Online as %s (%s)", self.user, self.user.id)
        await self.change_presence(
            activity=discord.Activity(
                type=discord.ActivityType.watching,
                name="/ticket • /build • /sparx",
            )
        )


async def main():
    bot = Bot()
    web_runner = await start_web_server(bot)
    try:
        async with bot:
            await bot.start(DISCORD_TOKEN)
    finally:
        await bot.gemini_client.close()
        await web_runner.cleanup()


if __name__ == "__main__":
    asyncio.run(main())
