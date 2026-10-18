# cogs/tickets.py — ticket system, clean UI
import discord
from discord.ext import commands
from discord import app_commands
import logging, asyncio, textwrap

log = logging.getLogger("tickets")
ticket_state: dict[int, dict] = {}

COL_BLUE  = 0x1B4FCC
COL_GREEN = 0x00A86B
COL_RED   = 0xD0312D


def build_server_context(guild: discord.Guild) -> str:
    roles    = [r.name for r in guild.roles if not r.is_default()][:20]
    channels = [c.name for c in guild.text_channels][:20]
    cats     = [c.name for c in guild.categories][:10]
    return textwrap.dedent(f"""
        You are the AI support assistant for the Discord server "{guild.name}".
        Be helpful, concise, and accurate. Never break character.

        SERVER:
        - Name: {guild.name}
        - Members: {guild.member_count}
        - Owner: {guild.owner.display_name if guild.owner else "Unknown"}
        - Boost level: {guild.premium_tier}
        - Channels: {", ".join(channels) or "none"}
        - Categories: {", ".join(cats) or "none"}
        - Roles: {", ".join(roles) or "none"}
        - Verification: {str(guild.verification_level)}
        - Description: {guild.description or "Not set"}

        Answer as the official support AI for this server.
        Keep responses under 1800 characters.
    """).strip()


class TicketChannelView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Close Ticket", style=discord.ButtonStyle.danger, custom_id="ticket_close_v3")
    async def close_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_message("Closing in 5 seconds.", ephemeral=True)
        await asyncio.sleep(5)
        ticket_state.pop(interaction.channel.id, None)
        try:
            await interaction.channel.delete(reason=f"Closed by {interaction.user}")
        except discord.HTTPException as e:
            log.error("delete channel: %s", e)


class OpenTicketView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Open Ticket", style=discord.ButtonStyle.primary, custom_id="ticket_open_v3")
    async def open_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild = interaction.guild
        user  = interaction.user

        for ch in guild.text_channels:
            if ch.name == f"ticket-{user.name}".lower().replace(" ", "-")[:90]:
                await interaction.response.send_message(
                    f"You already have an open ticket: {ch.mention}", ephemeral=True)
                return

        overwrites = {
            guild.default_role: discord.PermissionOverwrite(read_messages=False),
            user:               discord.PermissionOverwrite(read_messages=True, send_messages=True),
            guild.me:           discord.PermissionOverwrite(read_messages=True, send_messages=True, manage_channels=True),
        }
        channel_name = f"ticket-{user.name}".lower().replace(" ", "-")[:100]
        try:
            channel = await guild.create_text_channel(channel_name, overwrites=overwrites)
        except discord.HTTPException as e:
            await interaction.response.send_message(f"Failed to create ticket: {e}", ephemeral=True)
            return

        ticket_state[channel.id] = {"user_id": user.id, "history": []}

        embed = discord.Embed(
            title="Support Ticket",
            description=(
                f"Hello {user.mention},\n\n"
                "Describe your question or issue and the AI assistant will help you right away.\n\n"
                "Click **Close Ticket** when you are done."
            ),
            color=COL_BLUE,
        )
        embed.set_footer(text="AI Support — replies are instant")
        await channel.send(embed=embed, view=TicketChannelView())
        await interaction.response.send_message(f"Ticket created: {channel.mention}", ephemeral=True)


class Tickets(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.gemini = bot.gemini_client

    @app_commands.command(name="ticket", description="Post the support ticket panel")
    async def ticket_panel(self, interaction: discord.Interaction):
        embed = discord.Embed(
            title="Support",
            description=(
                "Need help? Open a private ticket and the AI assistant will respond instantly.\n\n"
                "Tickets are private — only you and the bot have access."
            ),
            color=COL_BLUE,
        )
        embed.set_footer(text=f"{interaction.guild.name} Support")
        await interaction.response.send_message(embed=embed, view=OpenTicketView())

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if message.author.bot or not message.guild:
            return
        state = ticket_state.get(message.channel.id)
        if not state or message.author.id != state["user_id"]:
            return

        server_ctx = build_server_context(message.guild)
        history    = state["history"]
        convo      = []
        for msg in history[-12:]:
            role = "User" if msg["role"] == "user" else "Assistant"
            convo.append(f"{role}: {msg['content']}")
        convo.append(f"User: {message.content}")
        convo.append("Assistant:")

        async with message.channel.typing():
            try:
                reply = await self.gemini.generate(server_ctx + "\n\n---\n\n" + "\n".join(convo))
            except Exception as e:
                log.error("ticket gemini: %s", e)
                reply = "Something went wrong. Please try again."

        state["history"].append({"role": "user",      "content": message.content})
        state["history"].append({"role": "assistant", "content": reply})

        for chunk in [reply[i:i+1990] for i in range(0, len(reply), 1990)]:
            await message.channel.send(chunk)


async def setup(bot):
    await bot.add_cog(Tickets(bot))
