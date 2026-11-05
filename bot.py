"""
Discord Bookmarklet Verification Bot — Python port
Runs on Render as a web service (Flask + discord.py in same process)
"""

import asyncio
import io
import json
import os
import secrets
import threading
import time
from pathlib import Path

import discord
from discord import app_commands
from flask import Flask, jsonify, request
from flask_cors import CORS

# ── Environment ───────────────────────────────────────────────────────────────

DISCORD_TOKEN     = os.environ["DISCORD_TOKEN"]
DISCORD_CLIENT_ID = os.environ["DISCORD_CLIENT_ID"]
PUBLIC_URL        = os.environ["PUBLIC_URL"].rstrip("/")
PORT              = int(os.environ.get("PORT", 3000))
GUILD_ID          = os.environ.get("GUILD_ID", "").strip() or None

# ── Persistence ───────────────────────────────────────────────────────────────

DATA_FILE = Path("data.json")

def load_data() -> dict:
    try:
        return json.loads(DATA_FILE.read_text())
    except Exception:
        return {"guilds": {}}

def save_data() -> None:
    DATA_FILE.write_text(json.dumps(data, indent=2))

data: dict = load_data()

# ── Challenge store ───────────────────────────────────────────────────────────

challenges: dict[str, dict] = {}
CHALLENGE_TTL = 600  # 10 minutes in seconds

def purge_expired() -> None:
    now = time.time()
    expired = [t for t, c in challenges.items() if now > c["expiresAt"]]
    for t in expired:
        challenges.pop(t, None)

# ── Bookmarklet factory ───────────────────────────────────────────────────────

def make_bookmarklet(token: str) -> str:
    endpoint    = PUBLIC_URL + "/api/complete"
    token_js    = json.dumps(token)      # e.g. "\"abc123\""
    endpoint_js = json.dumps(endpoint)   # e.g. "\"https://...\""

    # Build the JS as plain string concatenation to avoid f-string brace escaping issues
    source = (
        "(async()=>{"
        "if(location.hostname!==\"discord.com\"&&location.hostname!==\"www.discord.com\"){"
        "alert(\"Open Discord in your browser first, then run this bookmarklet.\");return;}"
        "if(document.getElementById(\"dbv-panel\"))return;"
        "const p=document.createElement(\"div\");"
        "p.id=\"dbv-panel\";"
        "p.style=\"position:fixed;z-index:2147483647;top:50%;left:50%;"
        "transform:translate(-50%,-50%);width:320px;max-width:90vw;padding:22px;"
        "background:#171a2b;color:white;border:1px solid #5865f2;border-radius:16px;"
        "box-shadow:0 15px 60px #000b;font:14px Arial;text-align:center\";"
        "p.innerHTML='<div style=\"font-size:20px;font-weight:800;margin-bottom:8px\">"
        "Discord Verification</div>"
        "<div style=\"color:#b9bfd3;margin-bottom:17px\">"
        "Press the button below to complete your verification request.</div>"
        "<button id=\"dbv-go\" style=\"width:100%;padding:13px;background:#5865f2;"
        "color:white;border:0;border-radius:9px;font-weight:bold;cursor:pointer\">"
        "VERIFY</button>"
        "<div id=\"dbv-status\" style=\"margin-top:12px;color:#b9bfd3;font-size:12px\"></div>"
        "<button id=\"dbv-close\" style=\"margin-top:12px;background:transparent;"
        "color:#9ca3af;border:0;cursor:pointer\">Close</button>';"
        "document.body.appendChild(p);"
        "p.querySelector(\"#dbv-close\").onclick=()=>p.remove();"
        "p.querySelector(\"#dbv-go\").onclick=async()=>{"
        "const b=p.querySelector(\"#dbv-go\"),s=p.querySelector(\"#dbv-status\");"
        "b.disabled=true;b.textContent=\"VERIFYING...\";"
        "s.textContent=\"Contacting verification bot...\";"
        "try{"
        "const r=await fetch(" + endpoint_js + ","
        "{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},"
        "body:JSON.stringify({token:" + token_js + ",pageHost:location.hostname})});"
        "const d=await r.json();"
        "if(!r.ok)throw Error(d.error||\"Verification failed\");"
        "s.textContent=\"\\u2713 \"+d.message;"
        "b.textContent=\"SUBMITTED\";b.style.background=\"#248046\";"
        "}catch(e){s.textContent=\"\\u2715 \"+e.message;"
        "b.disabled=false;b.textContent=\"TRY AGAIN\";}"
        "};})();"
    )
    return "javascript:" + source

# ── Discord client ────────────────────────────────────────────────────────────

intents = discord.Intents.default()
bot     = discord.Client(intents=intents)
tree    = app_commands.CommandTree(bot)

# Shared asyncio loop reference (set in main)
_loop: asyncio.AbstractEventLoop | None = None


class VerifyView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Verify", style=discord.ButtonStyle.primary, custom_id="dbv-start")
    async def verify_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.defer(ephemeral=True)

        guild_id = str(interaction.guild_id)
        config   = data.get("guilds", {}).get(guild_id)

        if not config or not config.get("verifyRoleId"):
            return await interaction.followup.send(
                "The server administrator has not configured a verification role yet.",
                ephemeral=True,
            )

        token = secrets.token_hex(32)
        challenges[token] = {
            "userId":    str(interaction.user.id),
            "guildId":   guild_id,
            "expiresAt": time.time() + CHALLENGE_TTL,
        }

        bookmarklet = make_bookmarklet(token)
        file_bytes  = bookmarklet.encode("utf-8")
        attachment  = discord.File(
            io.BytesIO(file_bytes),
            filename="discord-verify-bookmarklet.txt",
            description="Copy the full contents into a browser bookmark URL.",
        )

        try:
            await interaction.user.send(
                "**Your personal verification bookmarklet**\n"
                "1. Open Discord in your browser at https://discord.com/app\n"
                "2. Create a browser bookmark and edit its URL.\n"
                "3. Copy the entire contents of the attached `.txt` file into the bookmark URL.\n"
                "4. While on Discord, click that bookmark and then click **VERIFY**.\n\n"
                "This one-time link expires in 10 minutes. "
                "Never share the attachment; it is linked to your Discord account.",
                file=attachment,
            )
            await interaction.followup.send(
                "Check your DMs! I've sent your personal bookmarklet. It expires in 10 minutes.",
                ephemeral=True,
            )
        except discord.Forbidden:
            challenges.pop(token, None)
            await interaction.followup.send(
                "I couldn't DM you. Enable server-member DMs, then click Verify again.",
                ephemeral=True,
            )


@tree.command(name="verify", description="Start account verification")
async def cmd_verify(interaction: discord.Interaction):
    view = VerifyView()
    await interaction.response.send_message(
        "Click **Verify** to receive your personal verification bookmarklet in your DMs.",
        view=view,
        ephemeral=True,
    )


@tree.command(name="set-verify-role", description="Set the role awarded after verification")
@app_commands.describe(role="Role to award to verified members")
@app_commands.default_permissions(manage_roles=True)
async def cmd_set_verify_role(interaction: discord.Interaction, role: discord.Role):
    # Fetch fresh member data so role positions aren't stale from cache
    bot_member = await interaction.guild.fetch_member(bot.user.id)

    if not bot_member.guild_permissions.manage_roles:
        return await interaction.response.send_message(
            "I need the **Manage Roles** permission.", ephemeral=True
        )

    if role.position >= bot_member.top_role.position:
        return await interaction.response.send_message(
            f"That role is higher than or equal to my highest role "
            f"(my top role: **{bot_member.top_role.name}**, position {bot_member.top_role.position} | "
            f"target role: **{role.name}**, position {role.position}). "
            f"Move my bot role above **{role.name}** in Server Settings → Roles.",
            ephemeral=True,
        )

    data.setdefault("guilds", {}).setdefault(str(interaction.guild_id), {})
    data["guilds"][str(interaction.guild_id)]["verifyRoleId"] = str(role.id)
    save_data()

    await interaction.response.send_message(
        f"Verification role set to {role.mention}.", ephemeral=True
    )


@bot.event
async def on_ready():
    # Register persistent view so buttons survive restarts
    bot.add_view(VerifyView())

    if GUILD_ID:
        guild_obj = discord.Object(id=int(GUILD_ID))
        tree.copy_global_to(guild=guild_obj)
        await tree.sync(guild=guild_obj)
        print(f"Commands synced to guild {GUILD_ID}")
    else:
        await tree.sync()
        print("Global commands synced (may take up to 1 hour to appear)")

    print(f"Logged in as {bot.user} ({bot.user.id})")

    # Start background TTL purge
    purge_loop.start()


@bot.event
async def on_interaction(interaction: discord.Interaction):
    # Fallback handler catches button presses that arrive before the view is
    # re-registered after a cold start (edge case on Render free tier cold boots).
    if interaction.type == discord.InteractionType.component:
        if interaction.data.get("custom_id") == "dbv-start":
            view = VerifyView()
            await view.verify_button(interaction, None)


# ── Background TTL task ───────────────────────────────────────────────────────

from discord.ext import tasks as ext_tasks

@ext_tasks.loop(seconds=60)
async def purge_loop():
    purge_expired()

# ── Flask HTTP API ────────────────────────────────────────────────────────────

flask_app = Flask(__name__)
CORS(flask_app, resources={r"/api/*": {"origins": ["https://discord.com", "https://www.discord.com"]}})


@flask_app.get("/health")
def health():
    return jsonify({"ok": True})


@flask_app.post("/api/complete")
def api_complete():
    body      = request.get_json(silent=True) or {}
    token     = body.get("token", "")
    page_host = body.get("pageHost", "")

    if not isinstance(token, str) or len(token) != 64 or not token.isalnum():
        return jsonify({"error": "Invalid verification token."}), 400

    if page_host not in ("discord.com", "www.discord.com"):
        return jsonify({"error": "Run the bookmarklet on discord.com."}), 400

    challenge = challenges.get(token)
    if not challenge:
        return jsonify({"error": "This request is invalid, expired, or already used. Run /verify again."}), 400

    if time.time() > challenge["expiresAt"]:
        challenges.pop(token, None)
        return jsonify({"error": "Your verification request expired. Run /verify again."}), 400

    # Consume before assignment to prevent replay
    challenges.pop(token, None)

    guild_id = challenge["guildId"]
    user_id  = challenge["userId"]
    config   = data.get("guilds", {}).get(guild_id)

    if not config or not config.get("verifyRoleId"):
        return jsonify({"error": "The verification role is not configured."}), 400

    # Cross-thread async call into the discord.py event loop
    future = asyncio.run_coroutine_threadsafe(
        _assign_role(guild_id, user_id, config["verifyRoleId"]),
        _loop,
    )
    try:
        result = future.result(timeout=10)
        return jsonify(result[0]), result[1]
    except Exception as exc:
        print("Role assignment error:", exc)
        return jsonify({"error": "Internal error during role assignment."}), 500


async def _assign_role(guild_id: str, user_id: str, role_id: str):
    try:
        guild  = await bot.fetch_guild(int(guild_id))
        member = await guild.fetch_member(int(user_id))
        role   = guild.get_role(int(role_id))

        if role is None:
            role = await guild.fetch_roles()
            role = next((r for r in role if str(r.id) == role_id), None)

        if role is None:
            return {"error": "Configured role not found in server."}, 400

        if member.get_role(int(role_id)):
            return {"ok": True, "message": "You already have the verification role."}, 200

        await member.add_roles(role, reason="Completed bookmarklet verification request")
        return {"ok": True, "message": "Verification complete. Your server role has been assigned."}, 200

    except discord.NotFound:
        return {"error": "Could not find your account in that server."}, 400
    except discord.Forbidden:
        return {"error": "I couldn't assign the role. Check my Manage Roles permission and role hierarchy."}, 500
    except Exception as exc:
        print("_assign_role exception:", exc)
        return {"error": "Role assignment failed."}, 500


def run_flask():
    flask_app.run(host="0.0.0.0", port=PORT, use_reloader=False)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Validate required env vars
    for var in ("DISCORD_TOKEN", "DISCORD_CLIENT_ID", "PUBLIC_URL"):
        if not os.environ.get(var):
            raise SystemExit(f"Missing required environment variable: {var}")

    # Grab the event loop before starting anything
    _loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_loop)

    # Flask in a daemon thread
    flask_thread = threading.Thread(target=run_flask, daemon=True)
    flask_thread.start()
    print(f"Flask API listening on port {PORT}")

    # Discord bot on the main event loop
    _loop.run_until_complete(bot.start(DISCORD_TOKEN))
