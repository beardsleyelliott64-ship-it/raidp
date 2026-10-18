# web_app.py — aiohttp web server: health check + bookmarklet token receiver
import asyncio, logging, os
from aiohttp import web
import cogs.homework as hw

log = logging.getLogger("web_app")

CORS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

async def handle_health(req: web.Request) -> web.Response:
    return web.json_response({"status": "ok"})

async def handle_options(req: web.Request) -> web.Response:
    return web.Response(status=204, headers=CORS)

async def handle_cg(req: web.Request) -> web.Response:
    bot = req.app["bot"]
    try:
        body = await req.json()
    except Exception:
        return web.json_response({"error": "bad json"}, status=400, headers=CORS)

    token    = body.get("t", "").strip()
    code     = body.get("code", "").strip().upper()
    platform = body.get("platform", "sparx_maths")

    if not token or not code:
        return web.json_response({"error": "missing token or code"}, status=400, headers=CORS)

    entry = hw.pop_pending(code)
    if not entry:
        return web.json_response(
            {"error": "Code not found or expired. Run /sparx again."}, status=404, headers=CORS)

    user_id    = entry["user_id"]
    channel_id = entry["channel_id"]

    if user_id in hw._running:
        return web.json_response({"message": "Job already running. Check DMs."}, headers=CORS)

    asyncio.create_task(hw.post_login(bot, token, user_id, channel_id, platform))
    return web.json_response({"message": "Connected! Check Discord to pick your package."}, headers=CORS)


def build_app(bot) -> web.Application:
    app = web.Application()
    app["bot"] = bot
    app.router.add_get("/",             handle_health)
    app.router.add_get("/health",       handle_health)
    app.router.add_options("/cg-mobile", handle_options)
    app.router.add_post("/cg-mobile",   handle_cg)
    return app


async def start_web_server(bot) -> web.AppRunner:
    port = int(os.environ.get("PORT", 8080))
    app  = build_app(bot)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", port)
    await site.start()
    log.info("Web server on port %d", port)
    return runner
