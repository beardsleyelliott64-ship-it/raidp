# language: Python, file: sparx.py
# Sparx Learning API client — aggressive path discovery + JWT debug logging

from __future__ import annotations
import aiohttp, asyncio, base64, json, logging
log = logging.getLogger("sparx")

# ── multiple possible API bases ───────────────────────────────────────────────
# Sparx runs different products on different domains; try them all
BASES = [
    "https://api.sparx-learning.com",
    "https://student.sparxmaths.uk",
    "https://maths.sparx-learning.com",
]

def _auth_headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type":  "application/json",
        "Accept":        "application/json",
        "Origin":        "https://www.sparx-learning.com",
        "Referer":       "https://www.sparx-learning.com/",
        "User-Agent":    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    }

# ── JWT decode ────────────────────────────────────────────────────────────────
def _jwt_claims(token: str) -> dict:
    """Decode JWT payload without verifying signature."""
    try:
        part = token.split(".")[1]
        part += "=" * (-len(part) % 4)
        return json.loads(base64.urlsafe_b64decode(part))
    except Exception:
        return {}

def _log_token_debug(token: str) -> None:
    """Log everything useful about the token so we can find the right API paths."""
    # show enough to identify format without exposing the full secret
    preview = f"{token[:12]}...{token[-6:]}" if len(token) > 20 else "(short token)"
    log.info("TOKEN preview: %s  len=%d", preview, len(token))

    claims = _jwt_claims(token)
    if claims:
        log.info("JWT CLAIMS: %s", json.dumps(claims, default=str))
        # surface the ones most likely to be IDs
        for k in claims:
            v = claims[k]
            if isinstance(v, (str, int)) and v:
                log.info("  claim  %-20s = %s", k, v)
    else:
        log.warning("Token does not decode as JWT — may be opaque/session token")

def _extract_ids(token: str) -> tuple[str, str]:
    """Return (school_id, student_id) from JWT claims, empty strings if missing."""
    c = _jwt_claims(token)
    if not c:
        return "", ""

    school_id = (
        c.get("schoolId") or c.get("school_id") or c.get("sch") or
        c.get("schoolID") or c.get("school") or c.get("org") or
        c.get("orgId") or c.get("organisation_id") or c.get("organizationId") or
        ""
    )
    student_id = (
        c.get("sub") or c.get("studentId") or c.get("student_id") or
        c.get("uid") or c.get("userId") or c.get("user_id") or
        c.get("id") or c.get("sid") or ""
    )
    log.info("Extracted IDs — school=%r  student=%r", school_id, student_id)
    return str(school_id), str(student_id)

# ── HTTP helpers ──────────────────────────────────────────────────────────────
async def _get_one(session: aiohttp.ClientSession, url: str) -> dict | list | None:
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as r:
            log.debug("GET %s → %d", url, r.status)
            if r.status == 200:
                data = await r.json(content_type=None)
                log.info("GET %s → 200  type=%s  keys=%s", url,
                         type(data).__name__,
                         list(data.keys()) if isinstance(data, dict) else f"list[{len(data)}]")
                return data
            if r.status not in (401, 403, 404):
                body = await r.text()
                log.info("GET %s → %d  body=%r", url, r.status, body[:200])
    except Exception as e:
        log.debug("GET %s error: %s", url, e)
    return None

async def _try_paths(token: str, *path_templates: str) -> dict | list | None:
    """Try every combination of BASES × path_templates until one returns 200."""
    headers = _auth_headers(token)
    async with aiohttp.ClientSession(headers=headers) as session:
        for path in path_templates:
            for base in BASES:
                url  = f"{base}{path}"
                data = await _get_one(session, url)
                if data is not None:
                    return data
    return None

async def _post(token: str, payload: dict, *paths: str) -> bool:
    headers = _auth_headers(token)
    async with aiohttp.ClientSession(headers=headers,
                                     timeout=aiohttp.ClientTimeout(total=15)) as s:
        for path in paths:
            for base in BASES:
                url = f"{base}{path}"
                try:
                    async with s.post(url, json=payload) as r:
                        if r.status in (200, 201, 204):
                            log.info("POST %s → %d", url, r.status)
                            return True
                except Exception as e:
                    log.debug("POST %s error: %s", url, e)
    return False

def _list(data) -> list:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for k in ("packages", "homework", "homeworkPackages", "tasks",
                  "items", "data", "results", "content", "records"):
            if k in data and isinstance(data[k], list):
                log.info("_list: found array under key %r", k)
                return data[k]
        # last resort: if the dict itself looks like one package, wrap it
        if "id" in data or "packageId" in data:
            return [data]
    return []

# ── student info ──────────────────────────────────────────────────────────────
async def get_student_info(token: str) -> dict:
    _log_token_debug(token)
    sc, st = _extract_ids(token)

    # build ordered candidate paths — scoped first, then generic
    paths = []
    if sc and st:
        paths += [
            f"/v1/schools/{sc}/students/{st}",
            f"/v1/schools/{sc}/students/{st}/profile",
            f"/schools/{sc}/students/{st}",
            f"/apis/sparxmaths/v1/schools/{sc}/students/{st}",
        ]
    if st:
        paths += [
            f"/v1/students/{st}",
            f"/students/{st}",
            f"/v1/users/{st}",
        ]
    paths += [
        "/v1/student", "/student",
        "/v1/me", "/me",
        "/v1/student/profile", "/student/profile",
        "/v1/user", "/user",
        "/v1/profile", "/profile",
    ]

    data = await _try_paths(token, *paths)
    if not data or not isinstance(data, dict):
        log.warning("get_student_info: all paths failed")
        return {"name": "Student", "srp": 0, "level": 1}

    name = (
        data.get("displayName") or data.get("name") or
        data.get("username") or data.get("firstName") or
        data.get("fullName") or data.get("givenName") or "Student"
    )
    srp = int(
        data.get("srp") or data.get("totalSrp") or data.get("xp") or
        data.get("srpTotal") or data.get("points") or 0
    )
    return {"name": name, "srp": srp, "level": int(data.get("level") or 1)}

# ── packages ──────────────────────────────────────────────────────────────────
async def get_packages(token: str) -> list[dict]:
    sc, st = _extract_ids(token)

    paths = []
    if sc and st:
        paths += [
            f"/v1/schools/{sc}/students/{st}/packages",
            f"/v1/schools/{sc}/students/{st}/homework",
            f"/v1/schools/{sc}/students/{st}/homeworkPackages",
            f"/v1/schools/{sc}/students/{st}/tasks",
            f"/schools/{sc}/students/{st}/packages",
            f"/apis/sparxmaths/v1/schools/{sc}/students/{st}/packages",
            f"/apis/sparxmaths/v1/schools/{sc}/students/{st}/homework",
        ]
    if st:
        paths += [
            f"/v1/students/{st}/packages",
            f"/v1/students/{st}/homework",
        ]
    paths += [
        "/v1/student/packages", "/student/packages",
        "/v1/packages", "/packages",
        "/v1/homework/packages", "/homework/packages",
        "/v1/student/homework", "/student/homework",
        "/v1/homework", "/homework",
        "/v1/tasks", "/tasks",
        "/v1/student/tasks", "/student/tasks",
    ]

    data = await _try_paths(token, *paths)
    raw  = _list(data)
    log.info("get_packages: raw item count = %d", len(raw))
    if not raw:
        log.warning("get_packages: still empty — deploy, run bookmark, check logs above for JWT CLAIMS and 200 hits")

    packages = []
    for p in raw:
        packages.append({
            "id":         (p.get("id") or p.get("packageId") or
                           p.get("_id") or p.get("taskId") or ""),
            "name":       (p.get("name") or p.get("title") or
                           p.get("subject") or p.get("bookName") or
                           p.get("packageName") or "Homework"),
            "subject":    p.get("subject") or p.get("topic") or "",
            "srp_target": int(p.get("srpTarget") or p.get("srp_target") or
                              p.get("targetSrp") or p.get("xpTarget") or
                              p.get("srpGoal") or 100),
            "srp_earned": int(p.get("srpEarned") or p.get("srp_earned") or
                              p.get("earnedSrp") or p.get("xpEarned") or
                              p.get("srp") or 0),
            "due":        p.get("dueDate") or p.get("due") or p.get("deadline") or "",
            "complete":   bool(p.get("complete") or p.get("completed") or
                               p.get("isComplete") or p.get("done") or False),
            "_raw":       p,
        })
    return packages

# ── tasks ─────────────────────────────────────────────────────────────────────
async def get_tasks(token: str, pkg_id: str) -> list[dict]:
    sc, st = _extract_ids(token)
    paths  = []
    if sc and st:
        paths += [
            f"/v1/schools/{sc}/students/{st}/packages/{pkg_id}/tasks",
            f"/apis/sparxmaths/v1/schools/{sc}/students/{st}/packages/{pkg_id}/tasks",
        ]
    paths += [
        f"/v1/student/packages/{pkg_id}/tasks",
        f"/student/packages/{pkg_id}/tasks",
        f"/v1/packages/{pkg_id}/tasks",
        f"/packages/{pkg_id}/tasks",
        f"/v1/tasks/{pkg_id}",
        f"/tasks/{pkg_id}",
    ]
    data = await _try_paths(token, *paths)
    raw  = _list(data)
    tasks = []
    for t in raw:
        tasks.append({
            "id":        t.get("id") or t.get("taskId") or t.get("_id") or "",
            "name":      t.get("name") or t.get("title") or "",
            "srp_value": int(t.get("srpValue") or t.get("srp") or 0),
            "_raw":      t,
        })
    return tasks

# ── questions ─────────────────────────────────────────────────────────────────
async def get_questions(token: str, pkg_id: str, task_id: str) -> list[dict]:
    sc, st = _extract_ids(token)
    paths  = []
    if sc and st:
        paths += [
            f"/v1/schools/{sc}/students/{st}/packages/{pkg_id}/tasks/{task_id}/questions",
            f"/apis/sparxmaths/v1/schools/{sc}/students/{st}/packages/{pkg_id}/tasks/{task_id}/questions",
        ]
    paths += [
        f"/v1/student/packages/{pkg_id}/tasks/{task_id}/questions",
        f"/student/packages/{pkg_id}/tasks/{task_id}/questions",
        f"/v1/packages/{pkg_id}/tasks/{task_id}",
        f"/packages/{pkg_id}/tasks/{task_id}",
    ]
    data = await _try_paths(token, *paths)
    raw  = _list(data)
    qs = []
    for q in raw:
        qs.append({
            "id":      q.get("id") or q.get("questionId") or q.get("_id") or "",
            "text":    (q.get("question") or q.get("text") or
                        q.get("prompt") or q.get("stem") or str(q)),
            "options": q.get("options") or q.get("choices") or q.get("answers") or [],
            "srp":     int(q.get("srpValue") or q.get("srp") or 0),
            "_raw":    q,
        })
    return qs

# ── answer submission ─────────────────────────────────────────────────────────
async def submit_answer(token: str, pkg_id: str, task_id: str, q_id: str, answer: str) -> bool:
    payload = {
        "answer":     [answer],
        "questionId": q_id,
        "taskId":     task_id,
        "packageId":  pkg_id,
    }
    sc, st = _extract_ids(token)
    paths  = []
    if sc and st:
        paths += [
            f"/v1/schools/{sc}/students/{st}/packages/{pkg_id}/tasks/{task_id}/answers",
        ]
    paths += [
        f"/v1/student/packages/{pkg_id}/tasks/{task_id}/answers",
        f"/student/packages/{pkg_id}/tasks/{task_id}/answers",
        f"/v1/answers",
        f"/answers",
    ]
    return await _post(token, payload, *paths)

# ── progress ──────────────────────────────────────────────────────────────────
class Progress:
    def __init__(self, pkg_name: str, srp_target: int, srp_start: int):
        self.pkg_name   = pkg_name
        self.srp_target = srp_target
        self.srp_start  = srp_start
        self.srp_earned = 0
        self.q_done     = 0
        self.q_total    = 0
        self.done       = False
        self.error: str = ""

async def complete_package(token: str, pkg: dict, answer_fn, progress: Progress) -> None:
    pkg_id = pkg["id"]
    tasks  = await get_tasks(token, pkg_id)

    all_qs = []
    for task in tasks:
        qs = await get_questions(token, pkg_id, task["id"])
        all_qs.append((task, qs))
        progress.q_total += len(qs)

    for task, qs in all_qs:
        for q in qs:
            try:
                answer = await answer_fn(q["text"], q["options"])
                ok     = await submit_answer(token, pkg_id, task["id"], q["id"], answer)
                if ok:
                    progress.q_done    += 1
                    progress.srp_earned += q["srp"] or 4
                await asyncio.sleep(0.35)
            except Exception as e:
                log.error("question error: %s", e)

    progress.done = True
