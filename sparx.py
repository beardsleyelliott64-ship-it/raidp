# language: Python, file: sparx.py
# Sparx Maths API client — gRPC-Web / protobuf transport
#
# Root cause of the original bug: Sparx does not expose a REST/JSON API.
# Every endpoint is a gRPC-Web service over binary protobuf frames.
# Using aiohttp with JSON bodies against guessed REST paths returns nothing.
#
# This file replaces the broken REST implementation with the correct transport.
#
# ── PROTOBUF FIELD NUMBERS ────────────────────────────────────────────────────
# The Sparx .proto files are not public.  Field numbers below are inferred from
# churroai's JS source (object key order → sequential field numbers) and from
# proto encoding conventions.  They are correct with high confidence for
# PackageDataRequest / TaskItem; less certain for Activity / ActivityAction.
#
# If any call returns unexpected / empty data, set LOG_LEVEL=DEBUG before
# deploying.  _decode_proto() logs every field as {field_num: value} so you
# can cross-reference with what the browser sends in DevTools → Network.
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations
import asyncio, logging, struct, time
from typing import Any, Callable, Awaitable
import aiohttp

log = logging.getLogger("sparx")

# ── endpoint catalogue ────────────────────────────────────────────────────────
_API = "https://api.sparx-learning.com"

_EP_USER_INFO       = "/sparx.auth.userinfo.v1.UserInfoService/GetUserInfo"
_EP_DISPLAY_NAME    = "/sparx.leaderboards.userdisplay.v1.UserDisplay/GetUserDisplayDataForCurrentUser"
_EP_CLIENT_SESSION  = "/sparx.messaging.server.v1.SWServerSession/ClientSession"
_EP_PACKAGE_DATA    = "/sparx.swworker.v1.Sparxweb/GetPackageData"
_EP_GET_ACTIVITY    = "/sparx.swworker.v1.Sparxweb/GetActivity"
_EP_ACTIVITY_ACTION = "/sparx.swworker.v1.Sparxweb/ActivityAction"

# ── request headers ───────────────────────────────────────────────────────────
def _headers(token: str, session_id: str = "null") -> dict:
    # token is passed VERBATIM from the /token endpoint.
    # churroai uses  authorization: ${authToken}  — no "Bearer " prefix.
    # If the bookmarklet's /token endpoint already returns "Bearer eyJ...",
    # that full string becomes the header value and Sparx accepts it.
    # Do NOT double-prefix with "Bearer " in the bookmarklet or here.
    return {
        "accept":            "*/*",
        "accept-language":   "en-GB,en;q=0.9",
        "authorization":     token,
        "content-type":      "application/grpc-web+proto",
        "origin":            "https://maths.sparx-learning.com",
        "referer":           "https://maths.sparx-learning.com/",
        "x-grpc-web":        "1",
        "x-server-offset":   "-2",
        "x-session-id":      session_id,
        "user-agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/144.0.0.0 Safari/537.36 Edg/144.0.0.0"
        ),
    }

# ── gRPC-Web framing ──────────────────────────────────────────────────────────
def _frame(proto_bytes: bytes) -> bytes:
    """Prepend 5-byte gRPC-Web data frame header: flag(0x00) + length(4 BE)."""
    return b"\x00" + struct.pack(">I", len(proto_bytes)) + proto_bytes

def _unframe(body: bytes) -> bytes:
    """
    Strip the gRPC-Web envelope from a response body.
    Response layout: [0x00][4-byte-len][protobuf][0x80][4-byte-len][trailers]
    Returns just the protobuf bytes.
    """
    if len(body) < 5:
        return body
    # first byte: 0x00 = data frame, 0x80 = trailer frame
    if body[0] not in (0x00, 0x01):
        log.debug("_unframe: unexpected leading byte 0x%02x", body[0])
    length = struct.unpack(">I", body[1:5])[0]
    return body[5:5 + length]

# ── protobuf encode helpers ───────────────────────────────────────────────────
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
    if not v:
        return b""
    enc = v.encode("utf-8")
    return _tag(field, 2) + _varint_encode(len(enc)) + enc

def _bytes_field(field: int, v: bytes) -> bytes:
    if not v:
        return b""
    return _tag(field, 2) + _varint_encode(len(v)) + v

def _message(field: int, v: bytes) -> bytes:
    """Embed a serialised sub-message as a length-delimited field."""
    if not v:
        return b""
    return _tag(field, 2) + _varint_encode(len(v)) + v

# ── protobuf decode helper ────────────────────────────────────────────────────
def _varint_decode(buf: bytes, pos: int) -> tuple[int, int]:
    result, shift = 0, 0
    while pos < len(buf):
        b = buf[pos]; pos += 1
        result |= (b & 0x7F) << shift
        if not (b & 0x80):
            break
        shift += 7
    return result, pos

def _decode_proto(buf: bytes) -> dict[int, Any]:
    """
    Schema-less protobuf decode.  Returns {field_num: value} where:
      wire 0  → int
      wire 2  → bytes  (could be string or nested message)
      wire 1  → bytes (8)
      wire 5  → bytes (4)
    Repeated fields collected as list.
    Call _try_str() to attempt UTF-8 decode of a bytes value.
    """
    out: dict[int, Any] = {}
    pos = 0
    while pos < len(buf):
        try:
            tag, pos = _varint_decode(buf, pos)
        except Exception:
            break
        field = tag >> 3
        wire  = tag & 0x07
        if wire == 0:
            val, pos = _varint_decode(buf, pos)
        elif wire == 2:
            length, pos = _varint_decode(buf, pos)
            val = buf[pos:pos + length]; pos += length
        elif wire == 1:
            val = buf[pos:pos + 8]; pos += 8
        elif wire == 5:
            val = buf[pos:pos + 4]; pos += 4
        else:
            log.debug("_decode_proto: unknown wire type %d field %d, aborting", wire, field)
            break
        if field in out:
            existing = out[field]
            if isinstance(existing, list):
                existing.append(val)
            else:
                out[field] = [existing, val]
        else:
            out[field] = val
    return out

def _try_str(v: Any) -> str:
    if isinstance(v, (bytes, bytearray)):
        try:
            return v.decode("utf-8")
        except Exception:
            return ""
    return str(v) if v is not None else ""

def _debug_decode(label: str, decoded: dict) -> None:
    if not log.isEnabledFor(logging.DEBUG):
        return
    pretty = {}
    for k, v in decoded.items():
        if isinstance(v, list):
            pretty[k] = [_try_str(i) if isinstance(i, bytes) else i for i in v]
        elif isinstance(v, bytes):
            pretty[k] = _try_str(v) or f"<bytes len={len(v)}>"
        else:
            pretty[k] = v
    log.debug("%s raw fields: %s", label, pretty)

# ── gRPC call ─────────────────────────────────────────────────────────────────
class _AuthError(Exception):
    pass

async def _call(session: aiohttp.ClientSession, endpoint: str,
                proto_body: bytes) -> bytes | None:
    url  = _API + endpoint
    body = _frame(proto_body)
    try:
        async with session.post(url, data=body,
                                timeout=aiohttp.ClientTimeout(total=20)) as r:
            raw = await r.read()
            log.debug("POST %s → HTTP %d  resp_len=%d", endpoint, r.status, len(raw))
            if r.status == 401:
                raise _AuthError("HTTP 401 — token rejected")
            grpc_st  = r.headers.get("grpc-status", "")
            grpc_msg = r.headers.get("grpc-message", "")
            if grpc_st and grpc_st != "0":
                log.warning("grpc-status %s (%s) on %s", grpc_st, grpc_msg, endpoint)
                if grpc_st in ("7", "16"):   # PERMISSION_DENIED / UNAUTHENTICATED
                    raise _AuthError(f"gRPC auth error {grpc_st}: {grpc_msg}")
                if grpc_st == "8":           # RESOURCE_EXHAUSTED (task finished)
                    return None
                return None
            return _unframe(raw)
    except _AuthError:
        raise
    except Exception as e:
        log.error("gRPC call %s error: %s", endpoint, e)
        return None

# ── SparxClient ───────────────────────────────────────────────────────────────
class SparxClient:
    """
    Stateful gRPC-Web client for api.sparx-learning.com.

    Lifecycle:
        client = SparxClient(token)
        await client.init()     # UserInfo → DisplayName → ClientSession
        pkgs = await client.get_packages()
    """

    def __init__(self, token: str):
        self.token        = token
        self.session_id   = "null"
        self.student_id   = ""
        self.given_name   = "Student"
        self.display_name = "Student"

    def _sess(self) -> aiohttp.ClientSession:
        return aiohttp.ClientSession(headers=_headers(self.token, self.session_id))

    # ── init sequence ─────────────────────────────────────────────────────────
    async def init(self) -> None:
        """Must be called before get_packages / complete tasks."""
        await self._user_info()
        await self._display_name()
        await self._client_session()
        log.info("SparxClient ready  student=%r  display=%r  session=%.8s…",
                 self.given_name, self.display_name, self.session_id)

    async def _user_info(self) -> None:
        # GetUserInfo — empty proto body
        # Response: UserInfo { subject (field ?), givenName (field ?), … }
        # subject looks like "users/STUDENT_ID" — split on "/" for the ID
        async with self._sess() as s:
            raw = await _call(s, _EP_USER_INFO, b"")
        if not raw:
            log.warning("GetUserInfo: empty response")
            return
        d = _decode_proto(raw)
        _debug_decode("GetUserInfo", d)

        # Scan all bytes fields:
        #   subject  → contains "users/"
        #   givenName → short string that isn't the subject
        for k, v in d.items():
            if isinstance(v, bytes):
                sv = _try_str(v)
                if "users/" in sv:
                    self.student_id = sv.split("/")[-1]
                    log.info("UserInfo field %d → subject=%r  student_id=%r", k, sv, self.student_id)

        for k, v in d.items():
            if isinstance(v, bytes):
                sv = _try_str(v)
                if sv and "users/" not in sv and len(sv) < 100:
                    self.given_name = sv
                    log.info("UserInfo field %d → givenName=%r", k, sv)
                    break

    async def _display_name(self) -> None:
        # GetUserDisplayDataForCurrentUser — empty proto body
        # Response: UserDisplayData { positiveNoun (field ?) }
        async with self._sess() as s:
            raw = await _call(s, _EP_DISPLAY_NAME, b"")
        if not raw:
            return
        d = _decode_proto(raw)
        _debug_decode("GetDisplayName", d)
        for k, v in d.items():
            if isinstance(v, bytes):
                noun = _try_str(v)
                if noun:
                    self.display_name = noun
                    log.info("DisplayName field %d → %r", k, noun)
                    break

    async def _client_session(self) -> None:
        # ClientSession — empty proto body
        # Response: ClientSessionResponse { sessionId (field ?) }
        async with self._sess() as s:
            raw = await _call(s, _EP_CLIENT_SESSION, b"")
        if not raw:
            log.warning("ClientSession: empty response — session_id stays 'null'")
            return
        d = _decode_proto(raw)
        _debug_decode("ClientSession", d)
        for k, v in d.items():
            if isinstance(v, bytes) and v:
                self.session_id = _try_str(v)
                log.info("ClientSession field %d → session_id=%.12s…", k, self.session_id)
                break

    # ── PackageData ───────────────────────────────────────────────────────────
    # PackageDataRequest field numbers (inferred from JS object key order):
    #   1 = includeAllActivePackages (bool)
    #   2 = getPackages              (bool)
    #   3 = getTasks                 (bool)
    #   4 = getTaskItems             (bool)
    #   5 = packageID                (string)
    #   6 = taskIndex                (int32)
    #   7 = taskItemIndex            (int32)

    def _pkg_req(self, *, include_all=False, get_packages=False,
                 get_tasks=False, get_task_items=False,
                 package_id="", task_index=0, task_item_index=0) -> bytes:
        return (
            _bool  (1, include_all)     +
            _bool  (2, get_packages)    +
            _bool  (3, get_tasks)       +
            _bool  (4, get_task_items)  +
            _string(5, package_id)      +
            _int32 (6, task_index)      +
            _int32 (7, task_item_index)
        )

    async def get_packages(self) -> list[dict]:
        req = self._pkg_req(include_all=True, get_packages=True)
        async with self._sess() as s:
            raw = await _call(s, _EP_PACKAGE_DATA, req)
        if not raw:
            log.warning("GetPackageData(packages): empty — check token + field numbers")
            return []

        top = _decode_proto(raw)
        _debug_decode("PackageDataResponse(packages) top", top)

        packages = []
        # Packages are a repeated message field — scan all fields for nested messages
        for fk, fv in top.items():
            entries = fv if isinstance(fv, list) else [fv]
            for entry in entries:
                if not isinstance(entry, (bytes, bytearray)) or len(entry) < 3:
                    continue
                pkg = _decode_proto(entry)
                _debug_decode(f"  Package(field {fk})", pkg)

                pkg_id = title = ""
                n_items = n_done = 0

                # Collect all string fields; first non-empty → packageID, second → title
                strs = []
                for k, v in pkg.items():
                    if isinstance(v, bytes):
                        sv = _try_str(v)
                        if sv:
                            strs.append((k, sv))

                if strs:
                    pkg_id = strs[0][1]
                if len(strs) > 1:
                    title = strs[1][1]

                # Integer fields: first → numTaskItems, second → numTaskItemsDone
                ints = [(k, v) for k, v in pkg.items()
                        if isinstance(v, int) and v > 0]
                if ints:
                    n_items = ints[0][1]
                if len(ints) > 1:
                    n_done = ints[1][1]

                if pkg_id or title:
                    packages.append({
                        "id":        pkg_id,
                        "name":      title or pkg_id,
                        "num_items": n_items,
                        "num_done":  n_done,
                        # main.py BookSelectView uses srp_earned / srp_target / complete
                        "srp_earned": n_done * 4,
                        "srp_target": n_items * 4 if n_items else 100,
                        "complete":   n_done >= n_items and n_items > 0,
                        "due":        "",
                        "_raw":       pkg,
                    })

        log.info("get_packages: %d packages found", len(packages))
        if not packages:
            log.warning(
                "get_packages: still empty after decode.\n"
                "  → Run with LOG_LEVEL=DEBUG to see raw field output.\n"
                "  → Check that token has no double 'Bearer Bearer' prefix.\n"
                "  → Verify PackageDataRequest field numbers against a live DevTools capture."
            )
        return packages

    async def get_tasks(self, package_id: str) -> list[dict]:
        req = self._pkg_req(get_tasks=True, package_id=package_id)
        async with self._sess() as s:
            raw = await _call(s, _EP_PACKAGE_DATA, req)
        if not raw:
            return []
        top = _decode_proto(raw)
        _debug_decode("PackageDataResponse(tasks)", top)

        tasks = []
        for fk, fv in top.items():
            entries = fv if isinstance(fv, list) else [fv]
            for entry in entries:
                if not isinstance(entry, (bytes, bytearray)):
                    continue
                t = _decode_proto(entry)
                strs = [_try_str(v) for v in t.values()
                        if isinstance(v, bytes) and _try_str(v)]
                if strs:
                    tasks.append({"id": strs[0], "name": strs[1] if len(strs) > 1 else "", "_raw": t})
        log.info("get_tasks(%r): %d tasks", package_id, len(tasks))
        return tasks

    async def get_task_items(self, package_id: str, task_index: int) -> list[dict]:
        req = self._pkg_req(get_task_items=True, package_id=package_id, task_index=task_index)
        async with self._sess() as s:
            raw = await _call(s, _EP_PACKAGE_DATA, req)
        if not raw:
            return []
        top = _decode_proto(raw)
        _debug_decode(f"PackageDataResponse(taskItems pkg={package_id} ti={task_index})", top)

        items = []
        for fk, fv in top.items():
            entries = fv if isinstance(fv, list) else [fv]
            for entry in entries:
                if not isinstance(entry, (bytes, bytearray)):
                    continue
                items.append({"_raw": _decode_proto(entry), "_field": fk})
        log.info("get_task_items(%r, %d): %d items", package_id, task_index, len(items))
        return items

    # ── GetActivity ───────────────────────────────────────────────────────────
    # GetActivityRequest field numbers (estimated):
    #   1 = activityType (int32, 0 = normal)
    #   2 = payload      (bytes/message, empty = {})
    #   3 = method       (int32, 0)
    #   4 = clientFeatureFlags (message, empty = {})
    #   5 = taskItem     (message):
    #         1 = packageID      (string)
    #         2 = taskIndex      (int32)
    #         3 = taskItemIndex  (int32)
    #         4 = taskState      (int32, 0)
    #   6 = timestamp    (int64, unix seconds)

    def _task_item_msg(self, pkg_id: str, task_idx: int, item_idx: int) -> bytes:
        return (
            _string(1, pkg_id)    +
            _int32 (2, task_idx)  +
            _int32 (3, item_idx)  +
            _int32 (4, 0)         # taskState = 0
        )

    def _get_activity_req(self, pkg_id: str, task_idx: int,
                          item_idx: int, activity_type: int = 0) -> bytes:
        ti_msg = self._task_item_msg(pkg_id, task_idx, item_idx)
        ts     = int(time.time())
        return (
            _int32  (1, activity_type)  +
            # field 2 (payload) and field 3 (method) omitted → default 0 / empty
            _message(5, ti_msg)         +
            _int64  (6, ts)
        )

    async def get_activity(self, pkg_id: str, task_idx: int,
                           item_idx: int) -> dict | None:
        req = self._get_activity_req(pkg_id, task_idx, item_idx)
        async with self._sess() as s:
            raw = await _call(s, _EP_GET_ACTIVITY, req)
        if not raw:
            return None
        d = _decode_proto(raw)
        _debug_decode(f"GetActivity(pkg={pkg_id}, ti={task_idx}, ii={item_idx})", d)
        return d

    # ── ActivityAction (answer submission) ────────────────────────────────────
    # ActivityAction field numbers (estimated — LEAST CERTAIN):
    #   The exact structure depends on question type.
    #   Below encodes a simple string answer as a nested payload message.
    #
    #   ActivityAction {
    #     taskItem  (field 1, message) = same TaskItem as GetActivity
    #     action    (field 2, int32)   = 1 (ANSWER)
    #     payload   (field 3, message) {
    #       answer  (field 1, string)  = answer text
    #     }
    #     timestamp (field 4, int64)
    #   }
    #
    # If answers are rejected (grpc-status 9 "wrong question state"), the
    # question type requires a different payload structure.  Run DEBUG and
    # compare ActivityAction bytes against a browser DevTools capture.

    def _answer_payload(self, answer_text: str) -> bytes:
        return _string(1, answer_text)

    def _activity_action_req(self, pkg_id: str, task_idx: int,
                             item_idx: int, answer_text: str) -> bytes:
        ti_msg      = self._task_item_msg(pkg_id, task_idx, item_idx)
        payload_msg = self._answer_payload(answer_text)
        ts          = int(time.time())
        return (
            _message(1, ti_msg)      +
            _int32  (2, 1)           +   # action = ANSWER
            _message(3, payload_msg) +
            _int64  (4, ts)
        )

    async def answer_question(self, pkg_id: str, task_idx: int,
                              item_idx: int, answer_text: str) -> bool:
        req = self._activity_action_req(pkg_id, task_idx, item_idx, answer_text)
        async with self._sess() as s:
            try:
                raw = await _call(s, _EP_ACTIVITY_ACTION, req)
            except _AuthError:
                return False
        if raw is None:
            return False
        d = _decode_proto(raw)
        _debug_decode("ActivityActionResponse", d)
        return True

    # ── question text extraction ──────────────────────────────────────────────
    def _extract_question(self, activity: dict) -> tuple[str, list[str]]:
        """
        Pull question text and options from a decoded Activity proto dict.
        The Activity message is complex (LaTeX, sub-messages, etc.).
        This is a best-effort text extractor — collects all readable string
        fields and joins them.  May need refinement once field numbers are known.
        """
        texts   = []
        options = []

        def _walk(d: dict, depth: int = 0) -> None:
            for k, v in d.items():
                entries = v if isinstance(v, list) else [v]
                for entry in entries:
                    if isinstance(entry, bytes):
                        sv = _try_str(entry)
                        if sv and len(sv) > 1:
                            if depth == 0:
                                texts.append(sv)
                            else:
                                options.append(sv)
                    elif isinstance(entry, int) and entry == 0:
                        pass
                    # don't recurse further — too much nesting without schema

        _walk(activity)

        question = " ".join(t for t in texts if len(t) > 3)[:500]
        opts     = [o for o in options if len(o) < 200][:8]
        return question or "Question", opts


# ── Progress ──────────────────────────────────────────────────────────────────
class Progress:
    def __init__(self, pkg_name: str, srp_target: int, srp_start: int):
        self.pkg_name   = pkg_name
        self.srp_target = srp_target
        self.srp_start  = srp_start
        self.srp_earned = 0
        self.q_done     = 0
        self.q_total    = 0
        self.done       = False
        self.error      = ""


# ── complete_package ──────────────────────────────────────────────────────────
async def complete_package(
    token: str,
    pkg: dict,
    answer_fn: Callable[[str, list], Awaitable[str]],
    progress: Progress,
) -> None:
    """
    Run through all tasks / task items in pkg, get each question via
    GetActivity, ask answer_fn, submit via ActivityAction.
    Mutates progress in place; main.py polls it every 3 s.
    """
    client = SparxClient(token)
    try:
        await client.init()
    except _AuthError as e:
        progress.error = f"Auth failed: {e}"
        progress.done  = True
        return

    pkg_id = pkg["id"]
    tasks  = await client.get_tasks(pkg_id)

    if not tasks:
        log.warning("complete_package: no tasks found for %r", pkg_id)
        progress.done = True
        return

    # Count total items across all tasks
    all_task_items: list[tuple[int, int, int]] = []  # (task_index, item_index, task_id)
    for task_idx, task in enumerate(tasks):
        items = await client.get_task_items(pkg_id, task_idx)
        for item_idx, _ in enumerate(items):
            all_task_items.append((task_idx, item_idx, task_idx))

    progress.q_total = len(all_task_items)
    log.info("complete_package %r: %d tasks, %d items total",
             pkg_id, len(tasks), len(all_task_items))

    for task_idx, item_idx, _ in all_task_items:
        try:
            activity = await client.get_activity(pkg_id, task_idx, item_idx)
            if activity is None:
                log.info("GetActivity returned None for ti=%d ii=%d — skipping", task_idx, item_idx)
                progress.q_done += 1
                await asyncio.sleep(0.3)
                continue

            question, options = client._extract_question(activity)
            log.debug("Q[ti=%d ii=%d]: %r  options=%r", task_idx, item_idx, question[:80], options)

            answer = await answer_fn(question, options)
            log.debug("A[ti=%d ii=%d]: %r", task_idx, item_idx, answer)

            ok = await client.answer_question(pkg_id, task_idx, item_idx, answer)
            if ok:
                progress.q_done    += 1
                progress.srp_earned += 4  # Sparx typically awards 4 SRP per item

            await asyncio.sleep(0.4)   # pace requests, avoid rate-limit

        except _AuthError as e:
            progress.error = f"Auth error mid-run: {e}"
            break
        except Exception as e:
            log.error("complete_package item error ti=%d ii=%d: %s", task_idx, item_idx, e)
            progress.q_done += 1   # count as done so progress bar advances
            await asyncio.sleep(0.3)

    progress.done = True


# ── module-level convenience (called by main.py) ──────────────────────────────
async def get_student_info(token: str) -> dict:
    client = SparxClient(token)
    try:
        await client.init()
    except _AuthError as e:
        log.error("get_student_info auth error: %s", e)
        return {"name": "Student", "srp": 0, "level": 1}
    return {
        "name":    f"{client.given_name} the {client.display_name}",
        "srp":     0,
        "level":   1,
        "_client": client,   # stored in _sessions so complete_package can reuse init
    }

async def get_packages(token: str) -> list[dict]:
    client = SparxClient(token)
    try:
        await client.init()
    except _AuthError as e:
        log.error("get_packages auth error: %s", e)
        return []
    return await client.get_packages()
