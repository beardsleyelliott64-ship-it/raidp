# language: Python, file: sparx.py
# Sparx Learning API client — JWT-decoded paths, packages/tasks/questions, SRP tracking

from __future__ import annotations
import aiohttp, asyncio, base64, json, logging
log = logging.getLogger("sparx")

BASE = "https://api.sparx-learning.com"

def _auth(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type":  "application/json",
        "Accept":        "application/json",
        "Origin":        "https://www.sparx-learning.com",
        "Referer":       "https://www.sparx-learning.com/",
        "User-Agent":    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    }

def _jwt_claims(token: str) -> dict:
    """Decode JWT payload without verifying signature — we just want the claims."""
    try:
        part = token.split('.')[1]
        part += '=' * (-len(part) % 4)
        return json.loads(base64.urlsafe_b64decode(part))
    except Exception:
        return {}

def _student_paths(token: str) -> list[str]:
    """Build ordered list of paths to try for student info, scoped first."""
    c  = _jwt_claims(token)
    sc = c.get("schoolId") or c.get("school_id") or c.get("sch") or c.get("schoolID") or ""
    st = c.get("sub") or c.get("studentId") or c.get("student_id") or c.get("uid") or ""
    log.debug("JWT claims — schoolId=%s studentId=%s  all_keys=%s", sc, st, list(c.keys()))
    scoped = []
    if sc and st:
        scoped = [
            f"/v1/schools/{sc}/students/{st}",
            f"/schools/{sc}/students/{st}",
            f"/v1/schools/{sc}/students/{st}/profile",
        ]
    elif st:
        scoped = [f"/v1/students/{st}", f"/students/{st}"]
    return scoped + ["/v1/student", "/student", "/v1/me", "/me",
                     "/v1/student/profile", "/student/profile"]

def _package_paths(token: str) -> list[str]:
    c  = _jwt_claims(token)
    sc = c.get("schoolId") or c.get("school_id") or c.get("sch") or c.get("schoolID") or ""
    st = c.get("sub") or c.get("studentId") or c.get("student_id") or c.get("uid") or ""
    scoped = []
    if sc and st:
        scoped = [
            f"/v1/schools/{sc}/students/{st}/packages",
            f"/schools/{sc}/students/{st}/packages",
            f"/v1/schools/{sc}/students/{st}/homework",
        ]
    elif st:
        scoped = [f"/v1/students/{st}/packages", f"/students/{st}/packages"]
    return scoped + [
        "/v1/student/packages", "/student/packages",
        "/v1/packages", "/packages",
        "/v1/homework/packages", "/homework/packages",
        "/v1/student/homework", "/student/homework",
    ]

async def _get(token: str, *paths: str) -> dict | list | None:
    async with aiohttp.ClientSession(headers=_auth(token),
                                     timeout=aiohttp.ClientTimeout(total=15)) as s:
        for path in paths:
            try:
                async with s.get(f"{BASE}{path}") as r:
                    log.debug("GET %s → %d", path, r.status)
                    if r.status == 200:
                        data = await r.json(content_type=None)
                        log.debug("GET %s → OK  keys=%s", path,
                                  list(data.keys()) if isinstance(data, dict) else f"list[{len(data)}]")
                        return data
            except Exception as e:
                log.debug("GET %s: %s", path, e)
    return None

async def _post(token: str, payload: dict, *paths: str) -> bool:
    async with aiohttp.ClientSession(headers=_auth(token),
                                     timeout=aiohttp.ClientTimeout(total=15)) as s:
        for path in paths:
            try:
                async with s.post(f"{BASE}{path}", json=payload) as r:
                    if r.status in (200, 201, 204):
                        return True
            except Exception as e:
                log.debug("POST %s: %s", path, e)
    return False

def _list(data) -> list:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for k in ("packages", "homework", "tasks", "questions", "items", "data", "results", "parts"):
            if k in data and isinstance(data[k], list):
                return data[k]
        return [data] if data else []
    return []

# ── public ────────────────────────────────────────────────────────────────────

async def get_student_info(token: str) -> dict:
    data = await _get(token, *_student_paths(token))
    if not data or not isinstance(data, dict):
        log.warning("get_student_info: all paths failed, returning fallback")
        return {"name": "Student", "srp": 0, "level": 1}
    return {
        "name":  (data.get("displayName") or data.get("name") or
                  data.get("username") or data.get("firstName") or "Student"),
        "srp":   int(data.get("srp") or data.get("totalSrp") or data.get("xp") or 0),
        "level": int(data.get("level") or data.get("currentLevel") or 1),
    }

async def get_packages(token: str) -> list[dict]:
    data = await _get(token, *_package_paths(token))
    raw  = _list(data)
    log.info("get_packages: raw count=%d", len(raw))
    packages = []
    for p in raw:
        packages.append({
            "id":         p.get("id") or p.get("packageId") or p.get("_id", ""),
            "name":       (p.get("name") or p.get("title") or
                           p.get("subject") or p.get("bookName") or "Homework"),
            "subject":    p.get("subject") or p.get("topic") or "",
            "srp_target": int(p.get("srpTarget") or p.get("srp_target") or
                              p.get("targetSrp") or p.get("xpTarget") or 100),
            "srp_earned": int(p.get("srpEarned") or p.get("srp_earned") or
                              p.get("earnedSrp") or p.get("xpEarned") or 0),
            "due":        p.get("dueDate") or p.get("due") or p.get("deadline") or "",
            "complete":   bool(p.get("complete") or p.get("completed") or
                               p.get("isComplete") or False),
            "_raw":       p,
        })
    return packages

async def get_tasks(token: str, pkg_id: str) -> list[dict]:
    data = await _get(token,
        f"/v1/student/packages/{pkg_id}/tasks",
        f"/student/packages/{pkg_id}/tasks",
        f"/v1/packages/{pkg_id}/tasks",
        f"/packages/{pkg_id}/tasks",
    )
    raw = _list(data)
    tasks = []
    for t in raw:
        tasks.append({
            "id":        t.get("id") or t.get("taskId") or t.get("_id", ""),
            "name":      t.get("name") or t.get("title") or "",
            "srp_value": int(t.get("srpValue") or t.get("srp") or 0),
            "_raw":      t,
        })
    return tasks

async def get_questions(token: str, pkg_id: str, task_id: str) -> list[dict]:
    data = await _get(token,
        f"/v1/student/packages/{pkg_id}/tasks/{task_id}/questions",
        f"/student/packages/{pkg_id}/tasks/{task_id}/questions",
        f"/v1/packages/{pkg_id}/tasks/{task_id}",
        f"/packages/{pkg_id}/tasks/{task_id}",
    )
    raw = _list(data)
    qs = []
    for q in raw:
        qs.append({
            "id":      q.get("id") or q.get("questionId") or q.get("_id", ""),
            "text":    (q.get("question") or q.get("text") or
                        q.get("prompt") or q.get("stem") or str(q)),
            "options": q.get("options") or q.get("choices") or q.get("answers") or [],
            "srp":     int(q.get("srpValue") or q.get("srp") or 0),
            "_raw":    q,
        })
    return qs

async def submit_answer(token: str, pkg_id: str, task_id: str, q_id: str, answer: str) -> bool:
    payload = {
        "answer":     [answer],
        "questionId": q_id,
        "taskId":     task_id,
        "packageId":  pkg_id,
    }
    return await _post(token, payload,
        f"/v1/student/packages/{pkg_id}/tasks/{task_id}/answers",
        f"/student/packages/{pkg_id}/tasks/{task_id}/answers",
        "/v1/answers",
        "/answers",
    )

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

async def complete_package(
    token: str,
    pkg: dict,
    answer_fn,
    progress: Progress,
) -> None:
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
                log.error("q error: %s", e)

    progress.done = True
