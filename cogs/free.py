import discord
from discord.ext import commands
from discord import app_commands
from config import GUILD_ID, PLATFORMS, FREE_DAILY_LIMIT, PREM_DAILY_LIMIT
from utils import db, solver
from utils.embeds import solving_embed, answer_embed, error_embed, premium_embed


class FreeCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(name="solve", description="Quick solve — paste your question, get an instant answer")
    @app_commands.guilds(discord.Object(id=GUILD_ID))
    @app_commands.describe(
        platform="Which platform is this for?",
        question="Paste your full question",
        context="Optional: extra context, passage text, or answer options",
    )
    @app_commands.choices(platform=[
        app_commands.Choice(name=name, value=tag)
        for name, tag in list(PLATFORMS.items())[:25]
    ])
    async def solve_cmd(
        self,
        interaction: discord.Interaction,
        platform: str,
        question: str,
        context: str = "",
    ):
        await interaction.response.defer(ephemeral=True)
        user_id = interaction.user.id

        premium = await db.is_premium(user_id)
        limit   = PREM_DAILY_LIMIT if premium else FREE_DAILY_LIMIT
        allowed = await db.check_and_increment_uses(user_id, limit)

        if not allowed:
            await interaction.followup.send(
                embed=error_embed(
                    "Daily limit reached.\n"
                    + ("" if premium else "Upgrade to Premium for unlimited solves: `/premium`")
                ),
                ephemeral=True,
            )
            return

        platform_name = next((k for k, v in PLATFORMS.items() if v == platform), platform.title())
        session_id    = await db.create_session(user_id, interaction.channel_id, platform_name, question)

        await interaction.followup.send(
            embed=solving_embed(platform_name, question), ephemeral=True
        )

        result = await solver.solve(platform, question, context)
        await db.complete_session(session_id, result["full"], result.get("model_used", ""))
        await db.add_history(
            user_id, platform_name, question,
            result["answer"], result.get("model_used", "")
        )

        await interaction.edit_original_response(
            embed=answer_embed(
                platform_name, question, result["full"],
                session_id, result.get("model_used", "")
            )
        )

    @app_commands.command(name="premium", description="View premium features and how to upgrade")
    @app_commands.guilds(discord.Object(id=GUILD_ID))
    async def premium_cmd(self, interaction: discord.Interaction):
        await interaction.response.send_message(embed=premium_embed(), ephemeral=True)

    @app_commands.command(name="redeem", description="Activate a premium key")
    @app_commands.guilds(discord.Object(id=GUILD_ID))
    @app_commands.describe(key="Your premium key")
    async def redeem_cmd(self, interaction: discord.Interaction, key: str):
        await interaction.response.defer(ephemeral=True)
        success = await db.redeem_key(key.strip(), interaction.user.id)
        if not success:
            await interaction.followup.send(
                embed=error_embed("Invalid or already-used key."), ephemeral=True
            )
            return
        await db.set_premium(interaction.user.id, True)
        e = discord.Embed(
            title="⭐ Premium Activated",
            description="Welcome to SenAI Premium. Unlimited solves across all 13+ platforms.",
            colour=0xf59e0b,
        )
        await interaction.followup.send(embed=e, ephemeral=True)


async def setup(bot: commands.Bot):
    await bot.add_cog(FreeCog(bot))
