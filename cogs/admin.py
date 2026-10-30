import secrets
import aiosqlite
import discord
from discord.ext import commands
from discord import app_commands
from config import GUILD_ID, BLUE, DB_PATH
from utils import db, solver
from utils.embeds import error_embed


class AdminCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    def _is_staff(self, member: discord.Member) -> bool:
        return member.guild_permissions.administrator or any(
            r.name.lower() in ("staff", "mod", "admin", "owner") for r in member.roles
        )

    @app_commands.command(name="genkey", description="[Staff] Generate premium keys")
    @app_commands.guilds(discord.Object(id=GUILD_ID))
    @app_commands.default_permissions(administrator=True)
    async def genkey(self, interaction: discord.Interaction, amount: int = 1):
        if not self._is_staff(interaction.user):
            await interaction.response.send_message(embed=error_embed("No permission."), ephemeral=True)
            return
        await interaction.response.defer(ephemeral=True)
        keys = []
        for _ in range(min(amount, 20)):
            key = f"SENAI-{secrets.token_hex(4).upper()}-{secrets.token_hex(4).upper()}"
            await db.create_key(key)
            keys.append(key)
        e = discord.Embed(title="🔑 Premium Keys Generated", colour=BLUE)
        e.description = "\n".join(f"`{k}`" for k in keys)
        await interaction.followup.send(embed=e, ephemeral=True)

    @app_commands.command(name="grantpremium", description="[Staff] Grant premium to a user")
    @app_commands.guilds(discord.Object(id=GUILD_ID))
    @app_commands.default_permissions(administrator=True)
    async def grant_premium(self, interaction: discord.Interaction, user: discord.Member):
        if not self._is_staff(interaction.user):
            await interaction.response.send_message(embed=error_embed("No permission."), ephemeral=True)
            return
        await db.set_premium(user.id, True)
        await interaction.response.send_message(
            embed=discord.Embed(description=f"⭐ Premium granted to {user.mention}", colour=0xf59e0b),
            ephemeral=True,
        )

    @app_commands.command(name="revokepremium", description="[Staff] Revoke premium from a user")
    @app_commands.guilds(discord.Object(id=GUILD_ID))
    @app_commands.default_permissions(administrator=True)
    async def revoke_premium(self, interaction: discord.Interaction, user: discord.Member):
        if not self._is_staff(interaction.user):
            await interaction.response.send_message(embed=error_embed("No permission."), ephemeral=True)
            return
        await db.set_premium(user.id, False)
        await interaction.response.send_message(
            embed=discord.Embed(description=f"Premium revoked from {user.mention}", colour=0xef4444),
            ephemeral=True,
        )

    @app_commands.command(name="stats", description="[Staff] Bot stats + active Gemini model")
    @app_commands.guilds(discord.Object(id=GUILD_ID))
    @app_commands.default_permissions(administrator=True)
    async def stats(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        async with aiosqlite.connect(DB_PATH) as conn:
            async with conn.execute("SELECT COUNT(*) FROM users") as c:
                total_users = (await c.fetchone())[0]
            async with conn.execute("SELECT COUNT(*) FROM users WHERE premium = 1") as c:
                premium_users = (await c.fetchone())[0]
            async with conn.execute("SELECT COUNT(*) FROM sessions") as c:
                total_sessions = (await c.fetchone())[0]
            async with conn.execute("SELECT COUNT(*) FROM sessions WHERE status = 'complete'") as c:
                complete_sessions = (await c.fetchone())[0]

        e = discord.Embed(title="📊 SenAI Stats", colour=BLUE)
        e.add_field(name="Total Users",    value=str(total_users),       inline=True)
        e.add_field(name="Premium",        value=str(premium_users),     inline=True)
        e.add_field(name="Total Sessions", value=str(total_sessions),    inline=True)
        e.add_field(name="Completed",      value=str(complete_sessions), inline=True)
        e.add_field(name="Queue Length",   value=str(await db.queue_length()), inline=True)
        e.add_field(name="Active Model",   value=f"`{solver.current_model()}`", inline=True)
        await interaction.followup.send(embed=e, ephemeral=True)

    @app_commands.command(name="checkuser", description="[Staff] Check a user's status")
    @app_commands.guilds(discord.Object(id=GUILD_ID))
    @app_commands.default_permissions(administrator=True)
    async def check_user(self, interaction: discord.Interaction, user: discord.Member):
        u = await db.get_user(user.id)
        if not u:
            await interaction.response.send_message(
                embed=error_embed("User not in database yet."), ephemeral=True
            )
            return
        e = discord.Embed(title=f"User: {user.display_name}", colour=BLUE)
        e.add_field(name="Premium",    value="Yes ⭐" if u["premium"] else "No", inline=True)
        e.add_field(name="Uses Today", value=str(u["uses_today"]),               inline=True)
        await interaction.response.send_message(embed=e, ephemeral=True)


async def setup(bot: commands.Bot):
    await bot.add_cog(AdminCog(bot))
