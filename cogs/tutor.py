import asyncio
import discord
from discord.ext import commands
from discord import app_commands
from config import (
    GUILD_ID, PANEL_CHANNEL_ID, BLUE, PLATFORMS,
    FREE_DAILY_LIMIT, PREM_DAILY_LIMIT
)
from utils import db, solver
from utils.embeds import (
    panel_embed, solving_embed, answer_embed, queue_embed,
    error_embed, help_embed, tutorials_embed, history_embed, premium_embed
)


# ── Platform select → modal ───────────────────────────────────────────────────

class QuestionModal(discord.ui.Modal, title="Submit Your Question"):
    question = discord.ui.TextInput(
        label="Question",
        placeholder="Paste your full homework question here…",
        style=discord.TextStyle.long,
        min_length=5,
        max_length=2000,
    )
    context = discord.ui.TextInput(
        label="Context (optional)",
        placeholder="Extra info, passage text, or answer options…",
        style=discord.TextStyle.long,
        required=False,
        max_length=1500,
    )

    def __init__(self, bot: commands.Bot, platform_tag: str, platform_name: str):
        super().__init__()
        self.bot          = bot
        self.platform_tag  = platform_tag
        self.platform_name = platform_name

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        user_id = interaction.user.id

        premium = await db.is_premium(user_id)
        limit   = PREM_DAILY_LIMIT if premium else FREE_DAILY_LIMIT
        allowed = await db.check_and_increment_uses(user_id, limit)

        if not allowed:
            await interaction.followup.send(
                embed=error_embed(
                    f"Daily limit reached ({'unlimited' if premium else f'{FREE_DAILY_LIMIT}/day'}).\n"
                    + ("" if premium else "Upgrade to Premium: `/premium`")
                ),
                ephemeral=True,
            )
            return

        q_text   = self.question.value.strip()
        ctx_text = (self.context.value or "").strip()

        session_id = await db.create_session(
            user_id, interaction.channel_id, self.platform_name, q_text
        )
        await db.add_to_queue(user_id, session_id)

        pos   = await db.queue_position(user_id)
        total = await db.queue_length()
        await interaction.followup.send(
            embed=queue_embed(pos, total),
            ephemeral=True,
        )

        asyncio.create_task(
            _solve_and_deliver(
                self.bot, interaction, session_id,
                self.platform_name, self.platform_tag, q_text, ctx_text
            )
        )


class PlatformSelect(discord.ui.Select):
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        options = [
            discord.SelectOption(label=name, value=tag)
            for name, tag in PLATFORMS.items()
        ]
        options.append(discord.SelectOption(label="Other / General", value="general"))
        super().__init__(
            placeholder="Select your platform…",
            options=options,
            min_values=1,
            max_values=1,
        )

    async def callback(self, interaction: discord.Interaction):
        tag  = self.values[0]
        name = next((k for k, v in PLATFORMS.items() if v == tag), "General")
        await interaction.response.send_modal(QuestionModal(self.bot, tag, name))


class PlatformView(discord.ui.View):
    def __init__(self, bot: commands.Bot):
        super().__init__(timeout=60)
        self.add_item(PlatformSelect(bot))


# ── Permanent panel view ──────────────────────────────────────────────────────

class PanelView(discord.ui.View):
    def __init__(self, bot: commands.Bot):
        super().__init__(timeout=None)
        self.bot = bot

    @discord.ui.button(
        label="Join Queue",
        style=discord.ButtonStyle.primary,
        custom_id="panel:join_queue",
        row=0,
    )
    async def join_queue(self, interaction: discord.Interaction, _: discord.ui.Button):
        await interaction.response.send_message(
            "Select your platform:", view=PlatformView(self.bot), ephemeral=True
        )

    @discord.ui.button(
        label="Check Queue",
        style=discord.ButtonStyle.secondary,
        custom_id="panel:check_queue",
        row=0,
    )
    async def check_queue(self, interaction: discord.Interaction, _: discord.ui.Button):
        pos   = await db.queue_position(interaction.user.id)
        total = await db.queue_length()
        if pos is None:
            await interaction.response.send_message(
                embed=error_embed("You are not currently in the queue."), ephemeral=True
            )
        else:
            await interaction.response.send_message(
                embed=queue_embed(pos, total), ephemeral=True
            )

    @discord.ui.button(label="Help", style=discord.ButtonStyle.secondary,
                       custom_id="panel:help", row=1)
    async def help_btn(self, interaction: discord.Interaction, _: discord.ui.Button):
        await interaction.response.send_message(embed=help_embed(), ephemeral=True)

    @discord.ui.button(label="Tutorials", style=discord.ButtonStyle.secondary,
                       custom_id="panel:tutorials", row=1)
    async def tutorials_btn(self, interaction: discord.Interaction, _: discord.ui.Button):
        await interaction.response.send_message(embed=tutorials_embed(), ephemeral=True)

    @discord.ui.button(label="Uses", style=discord.ButtonStyle.secondary,
                       custom_id="panel:uses", row=1)
    async def uses_btn(self, interaction: discord.Interaction, _: discord.ui.Button):
        user    = await db.ensure_user(interaction.user.id)
        premium = bool(user["premium"])
        limit   = PREM_DAILY_LIMIT if premium else FREE_DAILY_LIMIT
        used    = user["uses_today"]
        e = discord.Embed(title="⚡ Your Usage", colour=BLUE)
        e.add_field(name="Tier",       value="⭐ Premium" if premium else "Free", inline=True)
        e.add_field(name="Used Today", value=str(used),  inline=True)
        e.add_field(name="Remaining",  value="∞" if premium else str(max(0, limit - used)), inline=True)
        e.add_field(name="Active Model", value=f"`{solver.current_model()}`", inline=False)
        await interaction.response.send_message(embed=e, ephemeral=True)

    @discord.ui.button(label="History", style=discord.ButtonStyle.secondary,
                       custom_id="panel:history", row=2)
    async def history_btn(self, interaction: discord.Interaction, _: discord.ui.Button):
        entries = await db.get_history(interaction.user.id, limit=5)
        await interaction.response.send_message(embed=history_embed(entries), ephemeral=True)

    @discord.ui.button(label="Settings", style=discord.ButtonStyle.secondary,
                       custom_id="panel:settings", row=2)
    async def settings_btn(self, interaction: discord.Interaction, _: discord.ui.Button):
        user = await db.ensure_user(interaction.user.id)
        e = discord.Embed(title="⚙️ Settings", colour=BLUE)
        e.add_field(name="Account", value=f"<@{interaction.user.id}>", inline=True)
        e.add_field(name="Premium", value="Yes ⭐" if user["premium"] else "No", inline=True)
        e.add_field(name="Upgrade",
                    value="Use `/premium` for info or `/redeem <key>` to activate",
                    inline=False)
        await interaction.response.send_message(embed=e, ephemeral=True)

    @discord.ui.button(label="Feedback & Suggestions", style=discord.ButtonStyle.secondary,
                       custom_id="panel:feedback", row=2)
    async def feedback_btn(self, interaction: discord.Interaction, _: discord.ui.Button):
        await interaction.response.send_modal(FeedbackModal())


class FeedbackModal(discord.ui.Modal, title="Feedback & Suggestions"):
    feedback = discord.ui.TextInput(
        label="Your feedback",
        placeholder="What to improve, or report a bug…",
        style=discord.TextStyle.long,
        min_length=5,
        max_length=1000,
    )

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.send_message(
            "Thanks! The team reviews all submissions.", ephemeral=True
        )


# ── Solver task ───────────────────────────────────────────────────────────────

async def _solve_and_deliver(
    bot: commands.Bot,
    interaction: discord.Interaction,
    session_id: int,
    platform_name: str,
    platform_tag: str,
    question: str,
    context: str,
):
    try:
        channel = interaction.channel

        if isinstance(channel, discord.TextChannel):
            thread = await channel.create_thread(
                name=f"Session #{session_id} — {interaction.user.display_name}",
                type=discord.ChannelType.private_thread,
                invitable=False,
            )
            await thread.add_user(interaction.user)
            status_msg = await thread.send(embed=solving_embed(platform_name, question))

            result = await solver.solve(platform_tag, question, context)

            await db.complete_session(session_id, result["full"], result.get("model_used", ""))
            await db.remove_from_queue(interaction.user.id)
            await db.add_history(
                interaction.user.id, platform_name,
                question, result["answer"], result.get("model_used", "")
            )

            await status_msg.edit(
                embed=answer_embed(
                    platform_name, question, result["full"],
                    session_id, result.get("model_used", "")
                )
            )
            if len(result["full"]) > 1000:
                await thread.send(f"**Continued:**\n{result['full'][1000:]}")

        else:
            result = await solver.solve(platform_tag, question, context)
            await db.complete_session(session_id, result["full"], result.get("model_used", ""))
            await db.remove_from_queue(interaction.user.id)
            await db.add_history(
                interaction.user.id, platform_name,
                question, result["answer"], result.get("model_used", "")
            )
            try:
                dm = await interaction.user.create_dm()
                await dm.send(
                    embed=answer_embed(
                        platform_name, question, result["full"],
                        session_id, result.get("model_used", "")
                    )
                )
            except discord.Forbidden:
                pass

    except Exception as e:
        await db.remove_from_queue(interaction.user.id)
        print(f"[solver error] session {session_id}: {e}")


# ── Cog ───────────────────────────────────────────────────────────────────────

class TutorCog(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    async def cog_load(self):
        self.bot.add_view(PanelView(self.bot))

    @app_commands.command(name="panel", description="[Staff] Post the SenAI learning platform panel")
    @app_commands.guilds(discord.Object(id=GUILD_ID))
    @app_commands.default_permissions(administrator=True)
    async def post_panel(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)
        channel = interaction.guild.get_channel(PANEL_CHANNEL_ID) or interaction.channel
        msg = await channel.send(embed=panel_embed(), view=PanelView(self.bot))
        await interaction.followup.send(f"Panel posted: {msg.jump_url}", ephemeral=True)

    @app_commands.command(name="queue", description="Check your current queue position")
    @app_commands.guilds(discord.Object(id=GUILD_ID))
    async def queue_cmd(self, interaction: discord.Interaction):
        pos   = await db.queue_position(interaction.user.id)
        total = await db.queue_length()
        if pos is None:
            await interaction.response.send_message(
                embed=error_embed("You are not in the queue. Use the panel to join."), ephemeral=True
            )
        else:
            await interaction.response.send_message(embed=queue_embed(pos, total), ephemeral=True)

    @app_commands.command(name="history", description="View your past sessions")
    @app_commands.guilds(discord.Object(id=GUILD_ID))
    async def history_cmd(self, interaction: discord.Interaction):
        entries = await db.get_history(interaction.user.id, limit=5)
        await interaction.response.send_message(embed=history_embed(entries), ephemeral=True)


async def setup(bot: commands.Bot):
    await bot.add_cog(TutorCog(bot))
