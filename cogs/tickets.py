# cogs/tickets.py — panel + open ticket button, pure AI, server-aware context

import discord
from discord.ext import commands
from discord import app_commands
import logging
import asyncio
import textwrap

log = logging.getLogger("tickets")

# { channel_id: { "user_id": int, "history": [] } }
ticket_state: dict[int, dict] = {}


def build_server_context(guild: discord.Guild) -> str:
    """Snapshot of server info injected into every AI prompt."""
    roles = [r.name for r in guild.roles if not r.is_default()][:20]
    text_channels = [c.name for c in guild.text_channels][:20]
    categories = [c.name for c in guild.categories][:10]

    return textwrap.dedent(f"""
        You are the AI support assistant for the Discord server "{guild.name}".
        Your job is to help users with any question or issue they have related to this server.
        Be helpful, friendly, concise, and accurate. Never break character.

        SERVER DETAILS:
        - Name: {guild.name}
        - Member count: {guild.member_count}
        - Server ID: {guild.id}
        - Created: {guild.created_at.strftime("%Y-%m-%d")}
        - Owner: {guild.owner.display_name if guild.owner else "Unknown"}
        - Boost level: {guild.premium_tier} (boosts: {guild.premium_subscription_count})
        - Text channels: {", ".join(text_channels) or "none"}
        - Categories: {", ".join(categories) or "none"}
        - Roles: {", ".join(roles) or "none"}
        - Verification level: {str(guild.verification_level)}
        - Description: {guild.description or "Not set"}

        You have full knowledge of this server. Answer as if you are its official support AI.
        If you don't know something specific, say so and offer to help find out.
        Keep responses under 1800 characters so they fit in Discord messages.
    """).strip()


class TicketChannelView(discord.ui.View):
    """Controls inside the private ticket channel."""

    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(
        label="🔒 Close Ticket",
        style=discord.ButtonStyle.danger,
        custom_id="ticket_close_v2",
    )
    async def close_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_message("Closing in 5 seconds…", ephemeral=True)
        await asyncio.sleep(5)
        ticket_state.pop(interaction.channel.id, None)
        try:
            await interaction.channel.delete(reason=f"Ticket closed by {interaction.user}")
        except discord.HTTPException as e:
            log.error("Failed to delete ticket channel: %s", e)


class OpenTicketView(discord.ui.View):
    """Persistent panel view posted by /ticket command."""

    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(
        label="🎫 Open Ticket",
        style=discord.ButtonStyle.success,
        custom_id="ticket_open_v2",
    )
    async def open_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild = interaction.guild
        user = interaction.user

        # Check if user already has an open ticket
        for ch in guild.text_channels:
            if ch.name == f"ticket-{user.name}".lower().replace(" ", "-")[:90]:
                await interaction.response.send_message(
                    f"You already have an open ticket: {ch.mention}", ephemeral=True
                )
                return

        overwrites = {
            guild.default_role: discord.PermissionOverwrite(read_messages=False),
            user: discord.PermissionOverwrite(read_messages=True, send_messages=True),
            guild.me: discord.PermissionOverwrite(
                read_messages=True, send_messages=True, manage_channels=True
            ),
        }

        channel_name = f"ticket-{user.name}".lower().replace(" ", "-")[:100]
        try:
            channel = await guild.create_text_channel(
                channel_name,
                overwrites=overwrites,
                reason=f"Ticket opened by {user}",
            )
        except discord.HTTPException as e:
            await interaction.response.send_message(f"Failed to create ticket: {e}", ephemeral=True)
            return

        ticket_state[channel.id] = {
            "user_id": user.id,
            "history": [],
        }

        embed = discord.Embed(
            title="🎫 Support Ticket",
            description=(
                f"Hey {user.mention}! 👋\n\n"
                "I'm the AI support assistant for this server. "
                "Type your question or issue below and I'll help you right away.\n\n"
                "Click **🔒 Close Ticket** when you're done."
            ),
            color=0x5865F2,
        )
        embed.set_footer(text="Powered by AI • Replies are instant")

        view = TicketChannelView()
        await channel.send(embed=embed, view=view)
        await interaction.response.send_message(
            f"✅ Ticket opened: {channel.mention}", ephemeral=True
        )


class Tickets(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.gemini = bot.gemini_client  # type: ignore

    @app_commands.command(name="ticket", description="Post the support ticket panel")
    async def ticket_panel(self, interaction: discord.Interaction):
        embed = discord.Embed(
            title="🎫 Support Center",
            description=(
                "Need help? Click **Open Ticket** below to start a private conversation "
                "with our AI support assistant.\n\n"
                "• Instant responses 24/7\n"
                "• Private — only you and the bot\n"
                "• Close anytime with the button inside"
            ),
            color=0x5865F2,
        )
        embed.set_footer(text=f"{interaction.guild.name} Support")
        view = OpenTicketView()
        await interaction.response.send_message(embed=embed, view=view)

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if message.author.bot:
            return
        if not message.guild:
            return

        state = ticket_state.get(message.channel.id)
        if not state:
            return
        if message.author.id != state["user_id"]:
            return

        # Build full prompt with server context + conversation history
        server_ctx = build_server_context(message.guild)
        history = state["history"]

        convo = []
        for msg in history[-12:]:
            role = "User" if msg["role"] == "user" else "Assistant"
            convo.append(f"{role}: {msg['content']}")
        convo.append(f"User: {message.content}")
        convo.append("Assistant:")

        full_prompt = server_ctx + "\n\n---\n\n" + "\n".join(convo)

        async with message.channel.typing():
            try:
                reply = await self.gemini.generate(full_prompt)
            except Exception as e:
                log.error("Gemini error in ticket: %s", e)
                reply = "⚠️ Something went wrong. Please try again."

        state["history"].append({"role": "user", "content": message.content})
        state["history"].append({"role": "assistant", "content": reply})

        # Split if over Discord's 2000 char limit
        if len(reply) <= 2000:
            await message.channel.send(reply)
        else:
            for chunk in [reply[i:i+1990] for i in range(0, len(reply), 1990)]:
                await message.channel.send(chunk)


async def setup(bot: commands.Bot):
    await bot.add_cog(Tickets(bot))
