# health.py — lightweight HTTP server for Railway health checks
# Runs in a daemon thread on PORT env var (Railway sets this automatically)

import os
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
import logging

log = logging.getLogger("health")


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"OK")

    def log_message(self, fmt, *args):
        pass  # suppress access logs


def start_health_server():
    port = int(os.environ.get("PORT", 8080))
    server = HTTPServer(("0.0.0.0", port), HealthHandler)
    log.info("Health check server on port %d", port)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server
