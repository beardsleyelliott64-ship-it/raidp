import asyncio
import discord
from discord.ext import commands
from config import BOT_TOKEN, GUILD_ID
from utils.db import init_db

COGS = [
    "cogs.tutor",
    "cogs.free",
    "cogs.admin",
]

intents = discord.Intents.default()
intents.message_content = True
intents.members = True


class SenAIBot(commands.Bot):
    def __init__(self):
        super().__init__(
            command_prefix="!",
            intents=intents,
            help_command=None,
        )

    async def setup_hook(self):
        await init_db()
        for cog in COGS:
            await self.load_extension(cog)
            print(f"[+] loaded {cog}")
        guild = discord.Object(id=GUILD_ID)
        self.tree.copy_global_to(guild=guild)
        synced = await self.tree.sync(guild=guild)
        print(f"[+] synced {len(synced)} commands to guild {GUILD_ID}")

    async def on_ready(self):
        await self.change_presence(
            activity=discord.Activity(
                type=discord.ActivityType.watching,
                name="your homework 👀"
            )
        )
        print(f"[+] {self.user} online | {len(self.guilds)} guild(s)")


bot = SenAIBot()

if __name__ == "__main__":
    asyncio.run(bot.start(BOT_TOKEN))
