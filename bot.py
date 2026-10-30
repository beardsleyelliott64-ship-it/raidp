#!/usr/bin/env python3
"""
Discord Ticket + Application Bot
AI: Gemini 2.0 Flash (primary) → Groq Llama (fallback)
"""

import discord
from discord import app_commands
from discord.ext import commands
from aiohttp import web
import os, asyncio, hashlib, io, json, pathlib, aiohttp as ahttp
from datetime import datetime
from dataclasses import dataclass, field
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────
DISCORD_TOKEN  = os.getenv("DISCORD_TOKEN", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GROQ_API_KEY   = os.getenv("GROQ_API_KEY", "")
VT_API_KEY     = os.getenv("VIRUSTOTAL_API_KEY", "")
ADMIN_ROLE_ID  = int(os.getenv("ADMIN_ROLE_ID", "1555236808382488606"))
GUILD_ID       = int(os.getenv("GUILD_ID",      "1553107655516622998"))
PORT           = int(os.getenv("PORT", "8080"))
GUILD_OBJ      = discord.Object(id=GUILD_ID)

# ── Gemini model list ─────────────────────────────────────────────────────
_EMBEDDED_MODELS = [
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-3-flash-preview",
    "gemini-3-pro-preview",
    "gemini-3.1-flash-lite-preview",
    "gemini-3.1-pro-preview",
]

def _load_model_list() -> list:
    """Load Gemini model priority list from JSON (aiModelsRanking_1 preferred), else embedded fallback."""
    for fname in ("aiModelsRanking_1.json", "aiModelsRanking.json"):
        try:
            p = pathlib.Path(fname)
            if p.exists():
                data = json.loads(p.read_text())
                if isinstance(data, list) and data:
                    print(f"✓ Loaded {len(data)} Gemini models from {fname}")
                    return data
        except Exception as e:
            print(f"Model list load error ({fname}): {e}")
    print(f"✓ Using embedded model list ({len(_EMBEDDED_MODELS)} models)")
    return list(_EMBEDDED_MODELS)

GEMINI_MODELS = _load_model_list()

# ── AI Manager ────────────────────────────────────────────────────────────
class AIManager:
    def __init__(self):
        self.gemini_client = None
        self._groq = None
        self._model_list = list(GEMINI_MODELS)

        if GEMINI_API_KEY:
            try:
                from google import genai
                self.gemini_client = genai.Client(api_key=GEMINI_API_KEY)
                print(f"✓ Gemini ready — {len(self._model_list)} models in rotation")
            except Exception as e:
                print(f"✗ Gemini: {e}")

        if GROQ_API_KEY:
            try:
                from groq import Groq
                self._groq = Groq(api_key=GROQ_API_KEY)
                print("✓ Groq ready (final fallback)")
            except Exception as e:
                print(f"✗ Groq: {e}")

    async def ask(self, prompt: str, system: str = "") -> str:
        full = f"{system}\n\n{prompt}" if system else prompt
        loop = asyncio.get_event_loop()

        # Try every Gemini model in ranked order — auto-switch on failure OR timeout
        if self.gemini_client:
            for model in self._model_list[:2]:
                try:
                    r = await asyncio.wait_for(
                        loop.run_in_executor(
                            None,
                            lambda m=model: self.gemini_client.models.generate_content(
                                model=m,
                                contents=full
                            )
                        ),
                        timeout=12.0
                    )
                    return r.text.strip()
                except asyncio.TimeoutError:
                    print(f"Gemini [{model}] timeout → next model")
                    continue
                except Exception as e:
                    print(f"Gemini [{model}] failed → {e}")
                    continue

        # Groq final fallback
        if self._groq:
            try:
                msgs = ([{"role": "system", "content": system}] if system else []) + \
                       [{"role": "user", "content": prompt}]
                r = await asyncio.wait_for(
                    loop.run_in_executor(
                        None,
                        lambda: self._groq.chat.completions.create(
                            model="llama-3.1-8b-instant", messages=msgs, max_tokens=1000
                        )
                    ),
                    timeout=12.0
                )
                return r.choices[0].message.content.strip()
            except asyncio.TimeoutError:
                print("Groq timeout")
            except Exception as e:
                print(f"Groq error: {e}")

        return "⚠️ AI temporarily unavailable. Staff has been notified."

ai = AIManager()

# ── Application session ───────────────────────────────────────────────────
APPLICATION_QUESTIONS = [
    "How old are you?",
    "What is your timezone and how many hours per week can you dedicate?",
    "Why do you want to become staff on this server?",
    "Do you have previous moderation experience? If yes, describe it.",
    "How would you handle a user repeatedly breaking the rules?",
    "A member complains about another staff member. What do you do?",
    "Describe yourself — your personality and what makes you a good fit.",
]

@dataclass
class AppSession:
    user_id: int
    guild_id: int
    answers: list = field(default_factory=list)
    current_q: int = 0

active_apps: dict[int, AppSession] = {}
open_tickets: dict[int, int] = {}   # channel_id → user_id
warned_users: dict[int, int] = {}   # user_id → warn count

# ── Web server (Render keepalive) ─────────────────────────────────────────
async def start_web():
    async def handle(r): return web.Response(text="OK")
    app = web.Application()
    app.router.add_get("/", handle)
    app.router.add_get("/health", handle)
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", PORT).start()
    print(f"✓ Web server :{PORT}")

# ── Bot ───────────────────────────────────────────────────────────────────
intents = discord.Intents.all()
bot = commands.Bot(command_prefix="!", intents=intents)

def admin_only():
    async def pred(i: discord.Interaction):
        role = i.guild.get_role(ADMIN_ROLE_ID)
        if role and role in i.user.roles:
            return True
        await i.response.send_message("❌ No permission.", ephemeral=True)
        return False
    return app_commands.check(pred)

# ── VirusTotal file check ─────────────────────────────────────────────────
DANGEROUS_EXT = {".exe",".bat",".ps1",".vbs",".cmd",".msi",".scr",".pif",".jar",".dll",".sh",".hta"}

async def scan_attachment(attachment: discord.Attachment) -> str:
    ext = os.path.splitext(attachment.filename)[1].lower()
    size_mb = attachment.size / 1_000_000
    danger_note = f"⚠️ **Dangerous extension detected: `{ext}`**\n" if ext in DANGEROUS_EXT else ""

    if VT_API_KEY:
        try:
            async with ahttp.ClientSession() as session:
                data = await attachment.read()
                sha256 = hashlib.sha256(data).hexdigest()
                headers = {"x-apikey": VT_API_KEY}
                async with session.get(f"https://www.virustotal.com/api/v3/files/{sha256}", headers=headers) as r:
                    if r.status == 200:
                        j = await r.json()
                        stats = j["data"]["attributes"]["last_analysis_stats"]
                        mal = stats.get("malicious", 0)
                        sus = stats.get("suspicious", 0)
                        total = sum(stats.values())
                        verdict = "🔴 **MALICIOUS**" if mal > 2 else ("🟡 **Suspicious**" if sus > 0 or mal > 0 else "🟢 **Clean**")
                        return (
                            f"{danger_note}"
                            f"**VirusTotal Scan — `{attachment.filename}`**\n"
                            f"Verdict: {verdict}\n"
                            f"Detections: `{mal} malicious / {sus} suspicious / {total} engines`\n"
                            f"SHA256: `{sha256[:16]}...`"
                        )
                    elif r.status == 404:
                        form = ahttp.FormData()
                        form.add_field("file", io.BytesIO(data), filename=attachment.filename)
                        async with session.post("https://www.virustotal.com/api/v3/files", headers=headers, data=form) as sr:
                            return (
                                f"{danger_note}"
                                f"**File submitted to VirusTotal for analysis.**\n"
                                f"`{attachment.filename}` — results available in ~1 min at virustotal.com\n"
                                f"SHA256: `{sha256[:16]}...`"
                            )
        except Exception as e:
            print(f"VT error: {e}")

    ai_resp = await ai.ask(
        f"A user uploaded a file named '{attachment.filename}' ({size_mb:.2f} MB) in a support ticket. "
        f"Based only on the filename and extension, assess if it could be malicious and explain briefly.",
        system="You are a security analyst. Be concise, clear, and practical. Flag anything suspicious."
    )
    return f"{danger_note}**AI File Assessment — `{attachment.filename}`**\n{ai_resp}"

# ── Ticket Views ──────────────────────────────────────────────────────────
class TicketPanelView(discord.ui.View):
    def __init__(self): super().__init__(timeout=None)

    @discord.ui.button(label="📩  Open a Ticket", style=discord.ButtonStyle.primary, custom_id="ticket:open")
    async def open_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        guild = interaction.guild
        user  = interaction.user

        for ch_id, uid in open_tickets.items():
            if uid == user.id:
                ch = guild.get_channel(ch_id)
                if ch:
                    await interaction.response.send_message(f"❌ Ticket already open: {ch.mention}", ephemeral=True)
                    return

        admin_role = guild.get_role(ADMIN_ROLE_ID)
        overwrites = {
            guild.default_role: discord.PermissionOverwrite(view_channel=False),
            user:               discord.PermissionOverwrite(view_channel=True, send_messages=True,
                                                            attach_files=True, read_message_history=True),
            guild.me:           discord.PermissionOverwrite(view_channel=True, send_messages=True,
                                                            manage_channels=True, manage_messages=True),
        }
        if admin_role:
            overwrites[admin_role] = discord.PermissionOverwrite(view_channel=True, send_messages=True,
                                                                  manage_messages=True)

        cat = discord.utils.get(guild.categories, name="🎫 Tickets")
        if not cat:
            cat = await guild.create_category("🎫 Tickets")

        ch = await guild.create_text_channel(
            f"ticket-{user.name}", category=cat, overwrites=overwrites,
            topic=f"Ticket for {user} | {datetime.now().strftime('%Y-%m-%d %H:%M UTC')}"
        )
        open_tickets[ch.id] = user.id

        embed = discord.Embed(
            title="🎫  Support Ticket",
            description=(
                f"Hey {user.mention}, welcome to your ticket!\n\n"
                "Our **AI support agent** is active 24/7 and will respond to your messages.\n"
                "Staff are also notified and may join at any time.\n\n"
                "**📌 How to get help:**\n"
                "① Describe your issue clearly\n"
                "② Attach any screenshots, files, or links\n"
                "③ Our AI will reply instantly\n"
                "④ Press **Close Ticket** once resolved"
            ),
            color=0x5865F2,
            timestamp=datetime.now()
        )
        embed.set_footer(text=f"Opened by {user}", icon_url=user.display_avatar.url)

        ctrl = TicketControlView()
        msg  = await ch.send(
            content=f"{user.mention}" + (f" | {admin_role.mention}" if admin_role else ""),
            embed=embed, view=ctrl
        )
        await msg.pin()
        await interaction.response.send_message(f"✅ Ticket created: {ch.mention}", ephemeral=True)

class TicketControlView(discord.ui.View):
    def __init__(self): super().__init__(timeout=None)

    @discord.ui.button(label="🔒  Close Ticket", style=discord.ButtonStyle.danger, custom_id="ticket:close")
    async def close(self, interaction: discord.Interaction, button: discord.ui.Button):
        ch   = interaction.channel
        uid  = open_tickets.get(ch.id)
        role = interaction.guild.get_role(ADMIN_ROLE_ID)
        if not (role and role in interaction.user.roles) and interaction.user.id != uid:
            await interaction.response.send_message("❌ Only the ticket owner or staff can close this.", ephemeral=True)
            return
        embed = discord.Embed(title="🔒 Ticket Closing", description="Deleting in **5 seconds**...", color=0xED4245)
        await interaction.response.send_message(embed=embed)
        open_tickets.pop(ch.id, None)
        await asyncio.sleep(5)
        await ch.delete(reason=f"Closed by {interaction.user}")

# ── Application Views ─────────────────────────────────────────────────────
class ApplicationPanelView(discord.ui.View):
    def __init__(self): super().__init__(timeout=None)

    @discord.ui.button(label="🚀  Start Application", style=discord.ButtonStyle.success, custom_id="app:start")
    async def start(self, interaction: discord.Interaction, button: discord.ui.Button):
        user = interaction.user
        if user.id in active_apps:
            await interaction.response.send_message("❌ You already have an application in your DMs.", ephemeral=True)
            return
        role = interaction.guild.get_role(ADMIN_ROLE_ID)
        if role and role in user.roles:
            await interaction.response.send_message("❌ You're already staff!", ephemeral=True)
            return

        await interaction.response.send_message(
            "📬 **Check your DMs!** Your application has started.\n*Enable DMs if you don't receive a message.*",
            ephemeral=True
        )

        session = AppSession(user_id=user.id, guild_id=interaction.guild.id)
        active_apps[user.id] = session

        try:
            embed = discord.Embed(
                title="📋  Staff Application",
                description=(
                    "Welcome to the staff application!\n\n"
                    "**Rules:**\n"
                    "• Answer every question **honestly and in detail**\n"
                    "• Troll/low-effort answers will auto-reject your application\n"
                    "• Type `cancel` at any time to withdraw\n\n"
                    f"**Question 1 / {len(APPLICATION_QUESTIONS)}**\n>>> {APPLICATION_QUESTIONS[0]}"
                ),
                color=0x57F287,
                timestamp=datetime.now()
            )
            embed.set_footer(text="Type your answer below")
            await user.send(embed=embed)
        except discord.Forbidden:
            active_apps.pop(user.id, None)

# ── Slash Commands ────────────────────────────────────────────────────────
@bot.tree.command(name="ticket-panel", description="Post the ticket support panel", guild=GUILD_OBJ)
@admin_only()
async def cmd_ticket_panel(interaction: discord.Interaction):
    embed = discord.Embed(
        title="🎫  Support Center",
        description=(
            "Need help? Our support team and AI are here **24/7**.\n\n"
            "**How it works:**\n"
            "① Click **Open a Ticket** below\n"
            "② A private channel is created just for you\n"
            "③ Our AI will respond instantly to your messages\n"
            "④ Staff will also be notified\n"
            "⑤ Close the ticket when your issue is resolved\n\n"
            "*All tickets are private and confidential.*"
        ),
        color=0x5865F2,
        timestamp=datetime.now()
    )
    embed.set_footer(text="Powered by AI Support")
    await interaction.channel.send(embed=embed, view=TicketPanelView())
    await interaction.response.send_message("✅ Ticket panel posted.", ephemeral=True)


@bot.tree.command(name="applications", description="Post the staff application panel", guild=GUILD_OBJ)
@admin_only()
async def cmd_applications(interaction: discord.Interaction):
    embed = discord.Embed(
        title="⭐  Staff Applications",
        description=(
            "Think you have what it takes to join our team?\n\n"
            "**What we look for:**\n"
            "• Maturity and professionalism\n"
            "• Active presence in the server\n"
            "• Good communication and conflict-resolution skills\n"
            "• Prior moderation experience (preferred, not required)\n\n"
            "**Process:**\n"
            "① Click **Start Application**\n"
            "② Answer questions in your DMs\n"
            "③ Our AI reviews your answers\n"
            "④ You'll be notified of the result via DM\n\n"
            "*Applications are reviewed by AI and senior staff.*"
        ),
        color=0x57F287,
        timestamp=datetime.now()
    )
    embed.set_footer(text="Good luck!")
    await interaction.channel.send(embed=embed, view=ApplicationPanelView())
    await interaction.response.send_message("✅ Application panel posted.", ephemeral=True)


@bot.tree.command(name="ban", description="Ban a member", guild=GUILD_OBJ)
@admin_only()
async def cmd_ban(interaction: discord.Interaction, member: discord.Member, reason: str = "No reason provided"):
    await member.ban(reason=reason)
    embed = discord.Embed(title="🔨 Banned", description=f"{member.mention} was banned.\n**Reason:** {reason}", color=0xED4245)
    await interaction.response.send_message(embed=embed)


@bot.tree.command(name="kick", description="Kick a member", guild=GUILD_OBJ)
@admin_only()
async def cmd_kick(interaction: discord.Interaction, member: discord.Member, reason: str = "No reason provided"):
    await member.kick(reason=reason)
    embed = discord.Embed(title="👢 Kicked", description=f"{member.mention} was kicked.\n**Reason:** {reason}", color=0xFEE75C)
    await interaction.response.send_message(embed=embed)


@bot.tree.command(name="give-role", description="Give a role to a member", guild=GUILD_OBJ)
@admin_only()
async def cmd_give_role(interaction: discord.Interaction, member: discord.Member, role: discord.Role):
    await member.add_roles(role)
    await interaction.response.send_message(f"✅ Gave {role.mention} to {member.mention}.", ephemeral=True)


@bot.tree.command(name="remove-role", description="Remove a role from a member", guild=GUILD_OBJ)
@admin_only()
async def cmd_remove_role(interaction: discord.Interaction, member: discord.Member, role: discord.Role):
    await member.remove_roles(role)
    await interaction.response.send_message(f"✅ Removed {role.mention} from {member.mention}.", ephemeral=True)


@bot.tree.command(name="warn", description="Warn a member", guild=GUILD_OBJ)
@admin_only()
async def cmd_warn(interaction: discord.Interaction, member: discord.Member, reason: str):
    warned_users[member.id] = warned_users.get(member.id, 0) + 1
    count = warned_users[member.id]
    embed = discord.Embed(
        title="⚠️ Warning Issued",
        description=f"{member.mention} has been warned.\n**Reason:** {reason}\n**Total warnings:** {count}",
        color=0xFEE75C
    )
    await interaction.response.send_message(embed=embed)
    try:
        await member.send(f"⚠️ You were warned in **{interaction.guild.name}**.\n**Reason:** {reason}\nWarnings: {count}")
    except discord.Forbidden:
        pass
    if count >= 3:
        await interaction.followup.send(f"⚠️ {member.mention} now has **{count} warnings**. Consider action.")


@bot.tree.command(name="clear", description="Delete messages from a channel", guild=GUILD_OBJ)
@admin_only()
async def cmd_clear(interaction: discord.Interaction, amount: int):
    if amount < 1 or amount > 100:
        await interaction.response.send_message("❌ Amount must be 1–100.", ephemeral=True)
        return
    await interaction.response.defer(ephemeral=True)
    deleted = await interaction.channel.purge(limit=amount)
    await interaction.followup.send(f"✅ Deleted {len(deleted)} messages.", ephemeral=True)


@bot.tree.command(name="serverinfo", description="Show server information", guild=GUILD_OBJ)
async def cmd_serverinfo(interaction: discord.Interaction):
    g = interaction.guild
    embed = discord.Embed(title=f"📊 {g.name}", color=0x5865F2, timestamp=datetime.now())
    embed.add_field(name="Members", value=str(g.member_count), inline=True)
    embed.add_field(name="Channels", value=str(len(g.channels)), inline=True)
    embed.add_field(name="Roles", value=str(len(g.roles)), inline=True)
    embed.add_field(name="Boost Level", value=str(g.premium_tier), inline=True)
    embed.add_field(name="Created", value=g.created_at.strftime("%Y-%m-%d"), inline=True)
    if g.icon: embed.set_thumbnail(url=g.icon.url)
    embed.set_footer(text=f"ID: {g.id}")
    await interaction.response.send_message(embed=embed)

# ── Profile theme commands ─────────────────────────────────────────────────
# These commands create a clearly fictional bot persona, not a real-person impersonation.
_original_profile = {"name": None, "avatar": None}
_MYSTERIOUS_AVATAR_PATH = pathlib.Path("mysterious_avatar.png")

@bot.tree.command(name="mysterious", description="Give the bot a mysterious purple persona", guild=GUILD_OBJ)
@admin_only()
async def cmd_mysterious(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=True, thinking=True)
    try:
        if _original_profile["name"] is None:
            _original_profile["name"] = bot.user.name
            _original_profile["avatar"] = await bot.user.display_avatar.read()
        if _MYSTERIOUS_AVATAR_PATH.exists():
            await bot.user.edit(username="The Mysterious", avatar=_MYSTERIOUS_AVATAR_PATH.read_bytes())
        else:
            await bot.user.edit(username="The Mysterious")
        await bot.change_presence(activity=discord.Activity(
            type=discord.ActivityType.watching, name="the shadows 🟣"
        ))
        await interaction.followup.send(
            "🟣 Mysterious theme enabled. The bot now uses a purple-themed name/avatar and status. "
            "Discord does not expose a bot-bio editing API here; keep the profile clearly identified as a bot.",
            ephemeral=True
        )
    except discord.HTTPException as exc:
        await interaction.followup.send(
            f"Couldn't fully change the profile (Discord may rate-limit username/avatar changes): `{exc}`",
            ephemeral=True
        )

@bot.tree.command(name="reverse", description="Restore the bot's profile from before /mysterious", guild=GUILD_OBJ)
@admin_only()
async def cmd_reverse(interaction: discord.Interaction):
    await interaction.response.defer(ephemeral=True, thinking=True)
    if _original_profile["name"] is None:
        await interaction.followup.send("No saved profile to restore. Run `/mysterious` first.", ephemeral=True)
        return
    try:
        kwargs = {"username": _original_profile["name"]}
        if _original_profile["avatar"]:
            kwargs["avatar"] = _original_profile["avatar"]
        await bot.user.edit(**kwargs)
        await bot.change_presence(activity=discord.Activity(
            type=discord.ActivityType.watching, name="the server 👀"
        ))
        await interaction.followup.send("↩️ Original bot name/avatar and status restored.", ephemeral=True)
    except discord.HTTPException as exc:
        await interaction.followup.send(f"Couldn't restore the profile: `{exc}`", ephemeral=True)

# ── Events ────────────────────────────────────────────────────────────────
BAD_WORDS = ["nigger","faggot","retard","kys","kill yourself"]  # extend as needed

@bot.event
async def on_message(message: discord.Message):
    if message.author.bot:
        return

    # ── DM: application flow ──────────────────────────────────────────
    if isinstance(message.channel, discord.DMChannel):
        uid = message.author.id
        if uid in active_apps:
            session = active_apps[uid]
            text = message.content.strip()

            if text.lower() == "cancel":
                del active_apps[uid]
                await message.channel.send("❌ Application cancelled.")
                return

            # Troll check
            troll_check = await ai.ask(
                f"The applicant answered: \"{text}\"\n"
                f"The question was: \"{APPLICATION_QUESTIONS[session.current_q]}\"\n"
                "Is this answer clearly trolling, completely nonsensical, or only 1-2 meaningless words with zero effort? "
                "Reply with only YES or NO. When in doubt, say NO.",
                system="You are a staff application screener. Only flag obvious trolling — a brief but genuine answer is fine."
            )
            if troll_check.strip().upper().startswith("YES"):
                del active_apps[uid]
                embed = discord.Embed(
                    title="❌ Application Cancelled",
                    description="Your answer was flagged as low-effort or trolling.\nYou may reapply later.",
                    color=0xED4245
                )
                await message.channel.send(embed=embed)
                return

            session.answers.append(text)
            session.current_q += 1

            if session.current_q < len(APPLICATION_QUESTIONS):
                embed = discord.Embed(
                    title=f"📋 Question {session.current_q + 1} / {len(APPLICATION_QUESTIONS)}",
                    description=f">>> {APPLICATION_QUESTIONS[session.current_q]}",
                    color=0x57F287
                )
                embed.set_footer(text="Type your answer below • Type 'cancel' to withdraw")
                await message.channel.send(embed=embed)
            else:
                # All answered — AI evaluation
                await message.channel.send("⏳ Reviewing your application...")

                qa_block = "\n".join(
                    f"Q{i+1}: {APPLICATION_QUESTIONS[i]}\nA{i+1}: {session.answers[i]}"
                    for i in range(len(APPLICATION_QUESTIONS))
                )
                try:
                    verdict_raw = await asyncio.wait_for(ai.ask(
                        f"Review this staff application:\\n\\n{qa_block}\\n\\n"
                        "Decide: ACCEPT or REJECT. Give a short reason (2-3 sentences). "
                        "Respond exactly as: VERDICT: ACCEPT or VERDICT: REJECT, then REASON: <short reason>.",
                        system=(
                            "You are a fair and encouraging staff application reviewer for a Discord server. "
                            "ACCEPT applicants who seem genuine, willing to help, and show some maturity — "
                            "they don't need to be perfect or have prior mod experience. "
                            "REJECT only obvious trolling or completely meaningless answers. Give benefit of doubt."
                        )
                    ), timeout=35.0)
                except asyncio.TimeoutError:
                    verdict_raw = "VERDICT: REVIEW\\nREASON: Automated review timed out; staff should review this application manually."

                # If AI providers are unavailable, do not silently reject a genuine applicant.
                if "temporarily unavailable" in verdict_raw.lower() or "VERDICT: REVIEW" in verdict_raw.upper():
                    await message.channel.send(embed=discord.Embed(
                        title="📨 Application Submitted",
                        description="Your answers were saved for staff review because the automated reviewer is unavailable. Staff will follow up.",
                        color=0xFEE75C,
                        timestamp=datetime.now()
                    ))
                    active_apps.pop(uid, None)
                    return

                # Robust verdict parsing
                accepted = False
                reason_line = ""

                lines = verdict_raw.splitlines()
                for line in lines:
                    stripped = line.strip()
                    upper = stripped.upper()
                    if upper.startswith("VERDICT:"):
                        val = stripped[8:].strip().upper()
                        accepted = "ACCEPT" in val
                    elif upper.startswith("REASON:"):
                        reason_line = stripped[7:].strip()

                # Fallback: scan whole text if structured parse missed
                if not reason_line:
                    # grab everything after first newline as reason
                    parts = verdict_raw.strip().split("\n", 1)
                    if len(parts) > 1:
                        reason_line = parts[1].replace("REASON:", "").strip()
                if not reason_line:
                    reason_line = verdict_raw.strip()

                # Final accepted fallback check if VERDICT line was missing
                if "VERDICT:" not in verdict_raw.upper():
                    accepted = "ACCEPT" in verdict_raw.upper() and "REJECT" not in verdict_raw.upper()

                guild = bot.get_guild(session.guild_id)
                member = guild.get_member(uid) if guild else None

                if accepted and member and guild:
                    role = guild.get_role(ADMIN_ROLE_ID)
                    if role:
                        await member.add_roles(role, reason="Staff application accepted by AI")
                    embed = discord.Embed(
                        title="✅ Application Accepted!",
                        description=(
                            f"Congratulations! You have been accepted as staff.\n\n"
                            f"**Feedback:** {reason_line or 'Great answers — welcome to the team!'}\n\n"
                            "You have been given the staff role. Welcome to the team!"
                        ),
                        color=0x57F287,
                        timestamp=datetime.now()
                    )
                else:
                    embed = discord.Embed(
                        title="❌ Application Not Accepted",
                        description=(
                            f"Thank you for applying. Unfortunately we won't be moving forward at this time.\n\n"
                            f"**Feedback:** {reason_line or 'Please put more detail into your answers next time.'}\n\n"
                            "You are welcome to reapply in the future."
                        ),
                        color=0xED4245,
                        timestamp=datetime.now()
                    )

                await message.channel.send(embed=embed)
                active_apps.pop(uid, None)
        return  # Don't process guild commands in DMs

    # ── Guild: moderation ────────────────────────────────────────────
    content_lower = message.content.lower()

    # Bad word filter
    if any(w in content_lower for w in BAD_WORDS):
        try:
            await message.delete()
        except Exception:
            pass
        warned_users[message.author.id] = warned_users.get(message.author.id, 0) + 1
        warn_embed = discord.Embed(
            description=f"⚠️ {message.author.mention}, that language isn't allowed here. (**Warning {warned_users[message.author.id]}**)",
            color=0xFEE75C
        )
        await message.channel.send(embed=warn_embed, delete_after=8)

    # ── Ticket channel: AI responds + scans attachments ──────────────
    if message.channel.name.startswith("ticket-") and message.channel.id in open_tickets:
        # Attachment scan
        for att in message.attachments:
            async with message.channel.typing():
                result = await scan_attachment(att)
            scan_embed = discord.Embed(
                title="🔍 File Scan Complete",
                description=result,
                color=0xFEE75C,
                timestamp=datetime.now()
            )
            await message.channel.send(embed=scan_embed)

        # AI reply
        if message.content.strip():
            async with message.channel.typing():
                reply = await ai.ask(
                    message.content,
                    system=(
                        "You are a helpful, professional support agent for a Discord server. "
                        "Answer support questions clearly and concisely. "
                        "If you cannot resolve the issue, say staff will assist shortly. "
                        "Never reveal that you are an AI unless directly asked."
                    )
                )
            embed = discord.Embed(description=reply, color=0x5865F2, timestamp=datetime.now())
            embed.set_author(name="Support Agent", icon_url=bot.user.display_avatar.url)
            await message.channel.send(embed=embed)

    await bot.process_commands(message)


@bot.event
async def on_member_join(member: discord.Member):
    for ch in member.guild.text_channels:
        try:
            embed = discord.Embed(
                title=f"👋 Welcome, {member.name}!",
                description=(
                    f"Hey {member.mention}, welcome to **{member.guild.name}**!\n\n"
                    "Read the rules and enjoy your stay. Open a ticket if you need help."
                ),
                color=0x57F287,
                timestamp=datetime.now()
            )
            embed.set_thumbnail(url=member.display_avatar.url)
            await ch.send(embed=embed)
            break
        except Exception:
            continue


@bot.event
async def on_ready():
    print(f"✓ Logged in as {bot.user} ({bot.user.id})")
    bot.add_view(TicketPanelView())
    bot.add_view(TicketControlView())
    bot.add_view(ApplicationPanelView())
    synced = await bot.tree.sync(guild=GUILD_OBJ)
    print(f"✓ Synced {len(synced)} commands to guild {GUILD_ID}")
    await bot.change_presence(
        activity=discord.Activity(type=discord.ActivityType.watching, name="the server 👀")
    )

# ── Main ──────────────────────────────────────────────────────────────────
async def main():
    await start_web()
    await bot.start(DISCORD_TOKEN)

if __name__ == "__main__":
    asyncio.run(main())
