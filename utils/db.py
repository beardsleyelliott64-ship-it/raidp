import aiosqlite
import json
import time
from config import DB_PATH


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                discord_id    INTEGER PRIMARY KEY,
                premium       INTEGER DEFAULT 0,
                uses_today    INTEGER DEFAULT 0,
                last_reset    INTEGER DEFAULT 0,
                settings      TEXT    DEFAULT '{}',
                joined_at     INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id       INTEGER NOT NULL,
                channel_id    INTEGER NOT NULL,
                thread_id     INTEGER,
                platform      TEXT,
                question      TEXT,
                answer        TEXT,
                model_used    TEXT,
                status        TEXT DEFAULT 'waiting',
                created_at    INTEGER DEFAULT 0,
                completed_at  INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS history (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id       INTEGER NOT NULL,
                platform      TEXT,
                question      TEXT,
                answer        TEXT,
                model_used    TEXT,
                timestamp     INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS queue (
                position      INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id       INTEGER NOT NULL,
                session_id    INTEGER NOT NULL,
                joined_at     INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS keys (
                key_code      TEXT PRIMARY KEY,
                used          INTEGER DEFAULT 0,
                used_by       INTEGER,
                created_at    INTEGER DEFAULT 0
            );
        """)
        await db.commit()


# ── User ──────────────────────────────────────────────────────────────────────

async def get_user(discord_id: int) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM users WHERE discord_id = ?", (discord_id,)
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def ensure_user(discord_id: int) -> dict:
    user = await get_user(discord_id)
    if user:
        return user
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO users (discord_id, joined_at) VALUES (?, ?)",
            (discord_id, int(time.time()))
        )
        await db.commit()
    return await get_user(discord_id)


async def is_premium(discord_id: int) -> bool:
    user = await get_user(discord_id)
    return bool(user and user["premium"])


async def set_premium(discord_id: int, value: bool):
    await ensure_user(discord_id)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE users SET premium = ? WHERE discord_id = ?",
            (int(value), discord_id)
        )
        await db.commit()


async def check_and_increment_uses(discord_id: int, limit: int) -> bool:
    user = await ensure_user(discord_id)
    now  = int(time.time())
    today = now // 86400

    if user["last_reset"] < today:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "UPDATE users SET uses_today = 0, last_reset = ? WHERE discord_id = ?",
                (today, discord_id)
            )
            await db.commit()
        user["uses_today"] = 0

    if user["uses_today"] >= limit:
        return False

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE users SET uses_today = uses_today + 1 WHERE discord_id = ?",
            (discord_id,)
        )
        await db.commit()
    return True


# ── Sessions ──────────────────────────────────────────────────────────────────

async def create_session(user_id: int, channel_id: int, platform: str, question: str) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            """INSERT INTO sessions (user_id, channel_id, platform, question, status, created_at)
               VALUES (?, ?, ?, ?, 'waiting', ?)""",
            (user_id, channel_id, platform, question, int(time.time()))
        )
        await db.commit()
        return cur.lastrowid


async def complete_session(session_id: int, answer: str, model_used: str = ""):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """UPDATE sessions SET answer = ?, model_used = ?, status = 'complete', completed_at = ?
               WHERE id = ?""",
            (answer, model_used, int(time.time()), session_id)
        )
        await db.commit()


async def get_session(session_id: int) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM sessions WHERE id = ?", (session_id,)
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


# ── History ───────────────────────────────────────────────────────────────────

async def add_history(user_id: int, platform: str, question: str, answer: str, model_used: str = ""):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO history (user_id, platform, question, answer, model_used, timestamp)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (user_id, platform, question, answer, model_used, int(time.time()))
        )
        await db.commit()


async def get_history(user_id: int, limit: int = 10) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM history WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?",
            (user_id, limit)
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


# ── Queue ─────────────────────────────────────────────────────────────────────

async def queue_position(user_id: int) -> int | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT position FROM queue WHERE user_id = ?", (user_id,)
        ) as cur:
            row = await cur.fetchone()
        if not row:
            return None
        async with db.execute(
            "SELECT COUNT(*) as c FROM queue WHERE position <= ?", (row["position"],)
        ) as cur:
            c = await cur.fetchone()
            return c["c"] if c else None


async def queue_length() -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT COUNT(*) FROM queue") as cur:
            row = await cur.fetchone()
            return row[0] if row else 0


async def add_to_queue(user_id: int, session_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO queue (user_id, session_id, joined_at) VALUES (?, ?, ?)",
            (user_id, session_id, int(time.time()))
        )
        await db.commit()


async def remove_from_queue(user_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM queue WHERE user_id = ?", (user_id,))
        await db.commit()


# ── Keys ──────────────────────────────────────────────────────────────────────

async def create_key(key_code: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR IGNORE INTO keys (key_code, created_at) VALUES (?, ?)",
            (key_code, int(time.time()))
        )
        await db.commit()


async def redeem_key(key_code: str, user_id: int) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM keys WHERE key_code = ?", (key_code,)
        ) as cur:
            row = await cur.fetchone()
        if not row or row["used"]:
            return False
        await db.execute(
            "UPDATE keys SET used = 1, used_by = ? WHERE key_code = ?",
            (user_id, key_code)
        )
        await db.commit()
        return True
