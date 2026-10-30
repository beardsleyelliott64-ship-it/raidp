import discord
import time
from config import BLUE, GREEN, GREY, RED, GOLD


def panel_embed() -> discord.Embed:
    e = discord.Embed(
        title="SenAI Learning Platform",
        description=(
            "Your gateway to personalised AI tutoring assistance.\n"
            "Your tutors are available to help you across multiple fields of study.\n"
            "Press the **Join Queue** button below to connect with a tutor."
        ),
        colour=BLUE
    )
    e.add_field(
        name="Notes",
        value=(
            "• Get personalised help for all your questions\n"
            "• Connect with a tutor in real-time\n"
            "• Guidance through even the toughest problems\n"
            "• Secure and confidential tutoring sessions"
        ),
        inline=False
    )
    e.set_footer(text="SenAI • Powered by AI")
    return e


def solving_embed(platform: str, question: str) -> discord.Embed:
    short_q = question[:80] + "…" if len(question) > 80 else question
    e = discord.Embed(
        title="⟳ Solving your question…",
        description=f"**Platform:** {platform}\n**Question:** {short_q}",
        colour=GOLD
    )
    e.set_footer(text="Live progress • SenAI Tutor")
    return e


def answer_embed(platform: str, question: str, full_answer: str, session_id: int, model_used: str = "") -> discord.Embed:
    short_q = question[:100] + "…" if len(question) > 100 else question
    e = discord.Embed(title="✓ Answer Ready", colour=GREEN)
    e.add_field(name="Platform", value=platform, inline=True)
    e.add_field(name="Session",  value=f"#{session_id}", inline=True)
    if model_used:
        e.add_field(name="Model", value=model_used, inline=True)
    e.add_field(name="Question", value=short_q, inline=False)
    body = full_answer[:1000] if len(full_answer) > 1000 else full_answer
    e.add_field(name="Solution", value=body, inline=False)
    if len(full_answer) > 1000:
        e.add_field(name="⚠️", value="Answer truncated — continued below", inline=False)
    e.set_footer(text="SenAI Tutor • Answer + Working")
    e.timestamp = discord.utils.utcnow()
    return e


def history_embed(entries: list[dict]) -> discord.Embed:
    e = discord.Embed(title="📋 Your History", colour=BLUE)
    if not entries:
        e.description = "No history yet — submit your first question to get started."
        return e
    for i, entry in enumerate(entries[:5], 1):
        ts      = time.strftime("%d/%m/%y %H:%M", time.localtime(entry["timestamp"]))
        short_q = entry["question"][:60] + "…" if len(entry["question"]) > 60 else entry["question"]
        short_a = entry["answer"][:80]   + "…" if len(entry["answer"])   > 80 else entry["answer"]
        model   = entry.get("model_used", "")
        label   = f"{i}. [{entry['platform']}] {ts}" + (f" • {model}" if model else "")
        e.add_field(
            name=label,
            value=f"**Q:** {short_q}\n**A:** {short_a}",
            inline=False
        )
    e.set_footer(text="Showing last 5 sessions")
    return e


def queue_embed(position: int, total: int) -> discord.Embed:
    eta = (position - 1) * 12
    e = discord.Embed(
        title="🔄 Queue Status",
        description=f"You are **#{position}** in the queue\n{total} total in queue",
        colour=BLUE
    )
    e.add_field(name="ETA", value="Next up!" if eta == 0 else f"~{eta}s", inline=True)
    e.set_footer(text="SenAI • AI solving in progress")
    return e


def error_embed(message: str) -> discord.Embed:
    return discord.Embed(title="✗ Error", description=message, colour=RED)


def premium_embed() -> discord.Embed:
    e = discord.Embed(
        title="⭐ SenAI Premium",
        description=(
            "**One payment. Yours forever.**\n\n"
            "• AI homework tutor\n"
            "• 13+ platforms supported\n"
            "• Every past paper question\n"
            "• Lifetime access\n"
            "• Unlimited daily solves\n\n"
            "**£10 / Lifetime**"
        ),
        colour=GOLD
    )
    e.set_footer(text="Use /redeem <key> to activate your premium key")
    return e


def help_embed() -> discord.Embed:
    e = discord.Embed(title="📖 SenAI Help", colour=BLUE)
    e.add_field(
        name="Getting Started",
        value=(
            "1. Click **Join Queue** in the learning platform channel\n"
            "2. Select your platform and paste your question\n"
            "3. Your tutor solves it and posts the answer with full working"
        ),
        inline=False
    )
    e.add_field(name="Free Tier",  value="3 solves per day across all platforms", inline=True)
    e.add_field(name="Premium",    value="Unlimited solves, all platforms, £10 lifetime", inline=True)
    e.add_field(
        name="Commands",
        value=(
            "`/solve` — quick solve without queue\n"
            "`/history` — view past sessions\n"
            "`/queue` — check your queue position\n"
            "`/premium` — upgrade info\n"
            "`/redeem` — activate a premium key"
        ),
        inline=False
    )
    return e


def tutorials_embed() -> discord.Embed:
    e = discord.Embed(title="🎓 Tutorials", colour=BLUE)
    e.add_field(
        name="Sparx Maths",
        value="Copy the full question text including all numbers and units. Attach an image if there's a diagram.",
        inline=False
    )
    e.add_field(
        name="Seneca",
        value="Paste the question exactly as it appears. Include all answer options if multiple choice.",
        inline=False
    )
    e.add_field(
        name="Sparx Reader",
        value="Include the passage text AND the question. The more context, the better the answer.",
        inline=False
    )
    e.add_field(
        name="Best results",
        value="• Paste the full question\n• Include any context or passage\n• Mention the topic if known",
        inline=False
    )
    return e
