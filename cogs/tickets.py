# cogs/tickets.py — ticket system with close / claim / AI support UI

import discord
from discord.ext import commands
from discord import app_commands
import logging
import asyncio

log = logging.getLogger("tickets")

# Role names considered "staff" — AI stops when they send a message
STAFF_ROLES = {"staff", "mod", "moderator", "admin", "administrator", "support", "helper"}

# Track per-channel AI state and conversation history
# { channel_id: { "ai_active": bool, "claimed_by": int|None, "history": [] } }
ticket_state: dict[int, dict] = {}


def is_staff(member: discord.Member) -> bool:
    return any(r.name.lower() in STAFF_ROLES for r in member.roles)


class TicketControlView(discord.ui.View):
    """Persistent UI attached to the ticket control message."""

    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(
        label="🔒 Close",
        style=discord.ButtonStyle.danger,
        custom_id="ticket_close",
    )
    async def close_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        channel = interaction.channel
        await interaction.response.send_message("Closing ticket in 5 seconds…", ephemeral=True)
        await asyncio.sleep(5)
        ticket_state.pop(channel.id, None)
        try:
            await channel.delete(reason=f"Ticket closed by {interaction.user}")
        except discord.HTTPException as e:
            log.error("Failed to delete ticket channel: %s", e)

    @discord.ui.button(
        label="📋 Claim",
        style=discord.ButtonStyle.primary,
        custom_id="ticket_claim",
    )
    async def claim_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        channel = interaction.channel
        state = ticket_state.setdefault(channel.id, {"ai_active": False, "claimed_by": None, "history": []})
        if state["claimed_by"]:
            claimer = interaction.guild.get_member(state["claimed_by"])
            name = claimer.display_name if claimer else "someone"
            await interaction.response.send_message(f"Already claimed by **{name}**.", ephemeral=True)
            return
        state["claimed_by"] = interaction.user.id
        await interaction.response.send_message(
            f"✅ **{interaction.user.display_name}** has claimed this ticket.", ephemeral=False
        )

    @discord.ui.button(
        label="🤖 AI Support",
        style=discord.ButtonStyle.success,
        custom_id="ticket_ai",
    )
    async def toggle_ai(self, interaction: discord.Interaction, button: discord.ui.Button):
        channel = interaction.channel
        state = ticket_state.setdefault(channel.id, {"ai_active": False, "claimed_by": None, "history": []})
        state["ai_active"] = not state["ai_active"]
        status = "enabled ✅" if state["ai_active"] else "disabled ❌"
        button.style = discord.ButtonStyle.success if state["ai_active"] else discord.ButtonStyle.secondary
        await interaction.response.edit_message(view=self)
        await interaction.followup.send(f"🤖 AI Support {status}", ephemeral=False)


class Tickets(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.gemini = bot.gemini_client  # type: ignore

    @app_commands.command(name="ticket", description="Open a support ticket")
    async def open_ticket(self, interaction: discord.Interaction):
        guild = interaction.guild
        if not guild:
            return

        # Create private channel
        overwrites = {
            guild.default_role: discord.PermissionOverwrite(read_messages=False),
            interaction.user: discord.PermissionOverwrite(read_messages=True, send_messages=True),
            guild.me: discord.PermissionOverwrite(read_messages=True, send_messages=True, manage_channels=True),
        }
        # Give staff roles access
        for role in guild.roles:
            if role.name.lower() in STAFF_ROLES:
                overwrites[role] = discord.PermissionOverwrite(read_messages=True, send_messages=True)

        channel_name = f"ticket-{interaction.user.name}".lower().replace(" ", "-")[:100]
        try:
            channel = await guild.create_text_channel(
                channel_name,
                overwrites=overwrites,
                reason=f"Ticket opened by {interaction.user}",
            )
        except discord.HTTPException as e:
            await interaction.response.send_message(f"Failed to create ticket: {e}", ephemeral=True)
            return

        ticket_state[channel.id] = {"ai_active": False, "claimed_by": None, "history": []}

        embed = discord.Embed(
            title="🎫 Support Ticket",
            description=(
                f"Welcome {interaction.user.mention}! Describe your issue and a staff member will assist you.\n\n"
                "**Controls:**\n"
                "🔒 **Close** — close and delete this ticket\n"
                "📋 **Claim** — staff claims this ticket\n"
                "🤖 **AI Support** — toggle AI assistant (auto-disables when staff arrives)"
            ),
            color=0x5865F2,
        )
        embed.set_footer(text="Ticket system")

        view = TicketControlView()
        await channel.send(embed=embed, view=view)
        await interaction.response.send_message(
            f"✅ Ticket created: {channel.mention}", ephemeral=True
        )

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if message.author.bot:
            return
        if not message.guild:
            return

        channel_id = message.channel.id
        state = ticket_state.get(channel_id)
        if not state:
            return

        # If staff member sends message, disable AI
        if is_staff(message.author):  # type: ignore
            if state["ai_active"]:
                state["ai_active"] = False
                await message.channel.send(
                    "🤖 AI Support **deactivated** — staff is here.", delete_after=8
                )
            return  # Don't have AI respond to staff

        if not state["ai_active"]:
            return

        # AI responds
        state["history"].append({"role": "user", "content": message.content})
        async with message.channel.typing():
            try:
                reply = await self.gemini.chat_response(state["history"], message.content)
            except Exception as e:
                log.error("Gemini chat error: %s", e)
                reply = "⚠️ AI encountered an error. Please wait for staff assistance."

        state["history"].append({"role": "assistant", "content": reply})
        await message.channel.send(reply)


async def setup(bot: commands.Bot):
    await bot.add_cog(Tickets(bot))
