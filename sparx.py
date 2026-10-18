# sparx.py — Sparx gRPC-Web client (fixed: Bearer prefix, session_id, token extraction)
from __future__ import annotations
import asyncio, logging, struct, time
from typing import Any, Callable, Awaitable
import aiohttp

log = logging.getLogger("sparx")

_API = "https://api.sparx-learning.com"
_EP_USER_INFO       = "/sparx.auth.userinfo.v1.UserInfoService/GetUserInfo"
_EP_DISPLAY_NAME    = "/sparx.leaderboards.userdisplay.v1.UserDisplay/GetUserDisplayDataForCurrentUser"
_EP_CLIENT_SESSION  = "/sparx.messaging.server.v1.SWServerSession/ClientSession"
_EP_PACKAGE_DATA    = "/sparx.swworker.v1.Sparxweb/GetPackageData"
_EP_GET_ACTIVITY    = "/sparx.swworker.v1.Sparxweb/GetActivity"
_EP_ACTIVITY_ACTION = "/sparx.swworker.v1.Sparxweb/ActivityAction"


def _norm_token(token: str) -> str:
    """Ensure token has Bearer prefix — the #1 cause of silent empty responses."""
    t = token.strip()
    if t.lower().startswith("bearer "):
        return t
    return f"Bearer {t}"


def _headers(token: str, session_id: str = "") -> dict:
    return {
        "accept":           "*/*",
        "accept-language":  "en-GB,en;q=0.9",
        "authorization":    _norm_token(token),   # FIX: always Bearer-prefixed
        "content-type":     "application/grpc-web+proto",
        "origin":           "https://maths.sparx-learning.com",
        "referer":          "https://maths.sparx-learning.com/",
        "x-grpc-web":       "1",
        "x-server-offset":  "-2",
        "x-session-id":     session_id,           # FIX: empty string not "null"
        "user-agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/144.0.0.0 Safari/537.36 Edg/144.0.0.0"
        ),
    }


# ── gRPC-Web framing ──────────────────────────────────────────────────────────
def _frame(b: bytes) -> bytes:
    return b"\x00" + struct.pack(">I", len(b)) + b

def _unframe(body: bytes) -> bytes:
    if len(body) < 5:
        return body
    length = struct.unpack(">I", body[1:5])[0]
    return body[5:5 + length]


# ── protobuf encode ───────────────────────────────────────────────────────────
def _varint_encode(n: int) -> bytes:
    out = bytearray()
    while n > 0x7F:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    out.append(n & 0x7F)
    return bytes(out)

def _tag(field: int, wire: int) -> bytes:
    return _varint_encode((field << 3) | wire)

def _bool(field: int, v: bool) -> bytes:
    return b"" if not v else _tag(field, 0) + _varint_encode(1)

def _int32(field: int, v: int) -> bytes:
    return b"" if v == 0 else _tag(field, 0) + _varint_encode(v & 0xFFFFFFFF)

def _int64(field: int, v: int) -> bytes:
    return b"" if v == 0 else _tag(field, 0) + _varint_encode(v & 0xFFFFFFFFFFFFFFFF)

def _string(field: int, v: str) -> bytes:
    if not v: return b""
    enc = v.encode("utf-8")
    return _tag(field, 2) + _varint_encode(len(enc)) + enc

def _message(field: int, v: bytes) -> bytes:
    if not v: return b""
    return _tag(field, 2) + _varint_encode(len(v)) + v


# ── protobuf decode ───────────────────────────────────────────────────────────
def _varint_decode(buf: bytes, pos: int) -> tuple[int, int]:
    result, shift = 0, 0
    while pos < len(buf):
        b = buf[pos]; pos += 1
        result |= (b & 0x7F) << shift
        if not (b & 0x80): break
        shift += 7
    return result, pos

def _decode_proto(buf: bytes) -> dict[int, Any]:
    out: dict[int, Any] = {}
    pos = 0
    while pos < len(buf):
        try:
            tag, pos = _varint_decode(buf, pos)
        except Exception:
            break
        field, wire = tag >> 3, tag & 0x07
        if wire == 0:   val, pos = _varint_decode(buf, pos)
        elif wire == 2:
            ln, pos = _varint_decode(buf, pos)
            val = buf[pos:pos + ln]; pos += ln
        elif wire == 1: val = buf[pos:pos + 8]; pos += 8
        elif wire == 5: val = buf[pos:pos + 4]; pos += 4
        else: break
        if field in out:
            ex = out[field]
            out[field] = ex + [val] if isinstance(ex, list) else [ex, val]
        else:
            out[field] = val
    return out

def _try_str(v: Any) -> str:
    if isinstance(v, (bytes, bytearray)):
        try: return v.decode("utf-8")
        except Exception: return ""
    return str(v) if v is not None else ""

def _dbg(label: str, d: dict) -> None:
    if not log.isEnabledFor(logging.DEBUG): return
    log.debug("%s: %s", label, {k: (_try_str(v) if isinstance(v, bytes) else v) for k, v in d.items()})


# ── HTTP / gRPC call ──────────────────────────────────────────────────────────
class _AuthError(Exception): pass

async def _call(session: aiohttp.ClientSession, endpoint: str, body: bytes) -> bytes | None:
    url = _API + endpoint
    try:
        async with session.post(url, data=_frame(body),
                                timeout=aiohttp.ClientTimeout(total=20)) as r:
            raw = await r.read()
            log.debug("POST %s → %d  len=%d", endpoint, r.status, len(raw))
            if r.status == 401:
                raise _AuthError("HTTP 401")
            gs = r.headers.get("grpc-status", "")
            gm = r.headers.get("grpc-message", "")
            if gs and gs != "0":
                log.warning("grpc-status %s (%s) %s", gs, gm, endpoint)
                if gs in ("7", "16"): raise _AuthError(f"gRPC {gs}: {gm}")
                return None
            return _unframe(raw)
    except _AuthError: raise
    except Exception as e:
        log.error("call %s: %s", endpoint, e)
        return None


# ── SparxClient ───────────────────────────────────────────────────────────────
class SparxClient:
    def __init__(self, token: str):
        self.token      = token
        self.session_id = ""          # FIX: empty string, not "null"
        self.student_id = ""
        self.given_name = "Student"
        self.display_name = "Student"

    def _sess(self) -> aiohttp.ClientSession:
        return aiohttp.ClientSession(headers=_headers(self.token, self.session_id))

    async def init(self) -> None:
        await self._user_info()
        await self._display_name()
        await self._client_session()
        log.info("SparxClient ready  student=%r  session=%.12s…", self.given_name, self.session_id)

    async def _user_info(self) -> None:
        async with self._sess() as s:
            raw = await _call(s, _EP_USER_INFO, b"")
        if not raw: return
        d = _decode_proto(raw); _dbg("UserInfo", d)
        for k, v in d.items():
            if isinstance(v, bytes):
                sv = _try_str(v)
                if "users/" in sv:
                    self.student_id = sv.split("/")[-1]
        for k, v in d.items():
            if isinstance(v, bytes):
                sv = _try_str(v)
                if sv and "users/" not in sv and len(sv) < 100:
                    self.given_name = sv; break

    async def _display_name(self) -> None:
        async with self._sess() as s:
            raw = await _call(s, _EP_DISPLAY_NAME, b"")
        if not raw: return
        d = _decode_proto(raw); _dbg("DisplayName", d)
        for k, v in d.items():
            if isinstance(v, bytes):
                noun = _try_str(v)
                if noun: self.display_name = noun; break

    async def _client_session(self) -> None:
        async with self._sess() as s:
            raw = await _call(s, _EP_CLIENT_SESSION, b"")
        if not raw:
            log.warning("ClientSession empty — session_id stays empty")
            return
        d = _decode_proto(raw); _dbg("ClientSession", d)
        for k, v in d.items():
            if isinstance(v, bytes) and v:
                self.session_id = _try_str(v)
                log.info("session_id=%.16s…", self.session_id)
                break

    # ── PackageData ───────────────────────────────────────────────────────────
    def _pkg_req(self, *, include_all=False, get_packages=False,
                 get_tasks=False, get_task_items=False,
                 package_id="", task_index=0, task_item_index=0) -> bytes:
        return (
            _bool  (1, include_all)    +
            _bool  (2, get_packages)   +
            _bool  (3, get_tasks)      +
            _bool  (4, get_task_items) +
            _string(5, package_id)     +
            _int32 (6, task_index)     +
            _int32 (7, task_item_index)
        )

    async def get_packages(self) -> list[dict]:
        req = self._pkg_req(include_all=True, get_packages=True)
        async with self._sess() as s:
            raw = await _call(s, _EP_PACKAGE_DATA, req)
        if not raw:
            log.warning("GetPackageData: empty — token likely wrong or expired")
            return []

        top = _decode_proto(raw); _dbg("PackageData top", top)
        packages = []

        for fk, fv in top.items():
            for entry in (fv if isinstance(fv, list) else [fv]):
                if not isinstance(entry, (bytes, bytearray)) or len(entry) < 3:
                    continue
                pkg = _decode_proto(entry); _dbg(f"  pkg(f{fk})", pkg)
                strs = [(k, _try_str(v)) for k, v in pkg.items()
                        if isinstance(v, bytes) and _try_str(v)]
                ints = [(k, v) for k, v in pkg.items()
                        if isinstance(v, int) and v > 0]
                pkg_id = strs[0][1] if strs else ""
                title  = strs[1][1] if len(strs) > 1 else ""
                n_items = ints[0][1] if ints else 0
                n_done  = ints[1][1] if len(ints) > 1 else 0
                if pkg_id or title:
                    packages.append({
                        "id": pkg_id, "name": title or pkg_id,
                        "num_items": n_items, "num_done": n_done,
                        "srp_earned": n_done * 4,
                        "srp_target": n_items * 4 if n_items else 100,
                        "complete": n_done >= n_items > 0,
                        "due": "", "_raw": pkg,
                    })

        log.info("get_packages: %d found", len(packages))
        if not packages:
            log.warning(
                "get_packages returned 0.\n"
                "  → Set LOG_LEVEL=DEBUG to see raw proto fields.\n"
                "  → Confirm token is a valid Firebase JWT (starts with eyJ).\n"
                "  → Check grpc-status headers in debug log."
            )
        return packages

    async def get_tasks(self, package_id: str) -> list[dict]:
        req = self._pkg_req(get_tasks=True, package_id=package_id)
        async with self._sess() as s:
            raw = await _call(s, _EP_PACKAGE_DATA, req)
        if not raw: return []
        top = _decode_proto(raw); _dbg("Tasks", top)
        tasks = []
        for fk, fv in top.items():
            for entry in (fv if isinstance(fv, list) else [fv]):
                if not isinstance(entry, (bytes, bytearray)): continue
                t = _decode_proto(entry)
                strs = [_try_str(v) for v in t.values() if isinstance(v, bytes) and _try_str(v)]
                if strs:
                    tasks.append({"id": strs[0], "name": strs[1] if len(strs) > 1 else "", "_raw": t})
        log.info("get_tasks(%r): %d", package_id, len(tasks))
        return tasks

    async def get_task_items(self, package_id: str, task_index: int) -> list[dict]:
        req = self._pkg_req(get_task_items=True, package_id=package_id, task_index=task_index)
        async with self._sess() as s:
            raw = await _call(s, _EP_PACKAGE_DATA, req)
        if not raw: return []
        top = _decode_proto(raw)
        items = []
        for fk, fv in top.items():
            for entry in (fv if isinstance(fv, list) else [fv]):
                if isinstance(entry, (bytes, bytearray)):
                    items.append({"_raw": _decode_proto(entry), "_field": fk})
        log.info("get_task_items(%r, %d): %d", package_id, task_index, len(items))
        return items

    def _task_item_msg(self, pkg_id: str, ti: int, ii: int) -> bytes:
        return _string(1, pkg_id) + _int32(2, ti) + _int32(3, ii) + _int32(4, 0)

    async def get_activity(self, pkg_id: str, ti: int, ii: int) -> dict | None:
        ti_msg = self._task_item_msg(pkg_id, ti, ii)
        req = _int32(1, 0) + _message(5, ti_msg) + _int64(6, int(time.time()))
        async with self._sess() as s:
            raw = await _call(s, _EP_GET_ACTIVITY, req)
        if not raw: return None
        d = _decode_proto(raw); _dbg(f"Activity(ti={ti},ii={ii})", d)
        return d

    async def answer_question(self, pkg_id: str, ti: int, ii: int, answer: str) -> bool:
        ti_msg = self._task_item_msg(pkg_id, ti, ii)
        req = (
            _message(1, ti_msg) +
            _int32  (2, 1) +
            _message(3, _string(1, answer)) +
            _int64  (4, int(time.time()))
        )
        async with self._sess() as s:
            try:
                raw = await _call(s, _EP_ACTIVITY_ACTION, req)
            except _AuthError:
                return False
        return raw is not None

    def _extract_question(self, activity: dict) -> tuple[str, list[str]]:
        texts, options = [], []
        for k, v in activity.items():
            for entry in (v if isinstance(v, list) else [v]):
                if isinstance(entry, bytes):
                    sv = _try_str(entry)
                    if sv and len(sv) > 1:
                        texts.append(sv)
        question = " ".join(t for t in texts if len(t) > 3)[:500]
        return question or "Question", []


# ── Progress ──────────────────────────────────────────────────────────────────
class Progress:
    def __init__(self, pkg_name: str, srp_target: int, srp_start: int):
        self.pkg_name   = pkg_name
        self.srp_target = srp_target
        self.srp_start  = srp_start
        self.srp_earned = 0
        self.q_done = self.q_total = 0
        self.done = False
        self.error = ""


async def complete_package(
    token: str, pkg: dict,
    answer_fn: Callable[[str, list], Awaitable[str]],
    progress: Progress,
) -> None:
    client = SparxClient(token)
    try:
        await client.init()
    except _AuthError as e:
        progress.error = f"Auth failed: {e}"; progress.done = True; return

    pkg_id = pkg["id"]
    tasks  = await client.get_tasks(pkg_id)
    if not tasks:
        progress.done = True; return

    all_items: list[tuple[int, int]] = []
    for ti, task in enumerate(tasks):
        items = await client.get_task_items(pkg_id, ti)
        for ii in range(len(items)):
            all_items.append((ti, ii))

    progress.q_total = len(all_items)

    for ti, ii in all_items:
        try:
            activity = await client.get_activity(pkg_id, ti, ii)
            if activity is None:
                progress.q_done += 1; await asyncio.sleep(0.3); continue
            question, options = client._extract_question(activity)
            answer = await answer_fn(question, options)
            ok = await client.answer_question(pkg_id, ti, ii, answer)
            if ok:
                progress.q_done    += 1
                progress.srp_earned += 4
            await asyncio.sleep(0.4)
        except _AuthError as e:
            progress.error = f"Auth error: {e}"; break
        except Exception as e:
            log.error("item ti=%d ii=%d: %s", ti, ii, e)
            progress.q_done += 1; await asyncio.sleep(0.3)

    progress.done = True


async def get_student_info(token: str) -> dict:
    client = SparxClient(token)
    try:
        await client.init()
    except _AuthError as e:
        log.error("get_student_info: %s", e)
        return {"name": "Student", "srp": 0, "level": 1}
    return {"name": f"{client.given_name} the {client.display_name}", "srp": 0, "level": 1}

async def get_packages(token: str) -> list[dict]:
    client = SparxClient(token)
    try:
        await client.init()
    except _AuthError as e:
        log.error("get_packages: %s", e)
        return []
    return await client.get_packages()
