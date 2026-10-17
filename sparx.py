# language: Python, file: sparx.py
# Sparx Learning API client — token auth, packages/tasks/questions, SRP tracking

from __future__ import annotations
import aiohttp, asyncio, logging
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

async def _get(token: str, *paths: str) -> dict | list | None:
    async with aiohttp.ClientSession(headers=_auth(token),
                                     timeout=aiohttp.ClientTimeout(total=15)) as s:
        for path in paths:
            try:
                async with s.get(f"{BASE}{path}") as r:
                    if r.status == 200:
                        return await r.json(content_type=None)
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
        for k in ("packages","tasks","questions","items","data","results","parts"):
            if k in data and isinstance(data[k], list):
                return data[k]
        return [data] if data else []
    return []

# ── public ────────────────────────────────────────────────────────────────────

async def get_student_info(token: str) -> dict:
    """Return student display name, total SRP, level."""
    data = await _get(token,
        "/v1/student", "/student", "/v1/me", "/me",
        "/v1/student/profile", "/student/profile",
    )
    if not data or not isinstance(data, dict):
        return {"name": "Student", "srp": 0, "level": 1}
    return {
        "name":  data.get("displayName") or data.get("name") or data.get("username") or "Student",
        "srp":   int(data.get("srp") or data.get("totalSrp") or data.get("xp") or 0),
        "level": int(data.get("level") or data.get("currentLevel") or 1),
    }

async def get_packages(token: str) -> list[dict]:
    """Return homework packages enriched with normalised fields."""
    data = await _get(token,
        "/v1/student/packages", "/student/packages",
        "/v1/packages", "/packages",
        "/v1/homework/packages", "/homework/packages",
    )
    raw = _list(data)
    packages = []
    for p in raw:
        packages.append({
            "id":          p.get("id") or p.get("packageId") or p.get("_id",""),
            "name":        p.get("name") or p.get("title") or p.get("subject") or "Homework",
            "subject":     p.get("subject") or p.get("topic") or "",
            "srp_target":  int(p.get("srpTarget") or p.get("srp_target") or p.get("targetSrp") or 100),
            "srp_earned":  int(p.get("srpEarned") or p.get("srp_earned") or p.get("earnedSrp") or 0),
            "due":         p.get("dueDate") or p.get("due") or "",
            "complete":    bool(p.get("complete") or p.get("completed") or False),
            "_raw":        p,
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
            "id":        t.get("id") or t.get("taskId") or t.get("_id",""),
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
            "id":      q.get("id") or q.get("questionId") or q.get("_id",""),
            "text":    q.get("question") or q.get("text") or q.get("prompt") or q.get("stem") or str(q),
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
        f"/v1/answers",
        f"/answers",
    )

class Progress:
    """Mutable progress object updated during a run and read by the DM updater."""
    def __init__(self, pkg_name: str, srp_target: int, srp_start: int):
        self.pkg_name   = pkg_name
        self.srp_target = srp_target
        self.srp_start  = srp_start
        self.srp_earned = 0      # earned THIS session
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
    """Fill Progress as we go — caller reads it live."""
    pkg_id = pkg["id"]
    tasks  = await get_tasks(token, pkg_id)

    # count total questions first
    all_qs = []
    for task in tasks:
        qs = await get_questions(token, pkg_id, task["id"])
        all_qs.append((task, qs))
        progress.q_total += len(qs)

    for task, qs in all_qs:
        for q in qs:
            try:
                answer = await answer_fn(q["text"], q["options"])
                ok = await submit_answer(token, pkg_id, task["id"], q["id"], answer)
                if ok:
                    progress.q_done  += 1
                    progress.srp_earned += q["srp"] or 4   # ~4 SRP per question fallback
                await asyncio.sleep(0.35)
            except Exception as e:
                log.error("q error: %s", e)

    progress.done = True
