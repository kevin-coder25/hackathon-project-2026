# ========================================================================
# GRIDGUARD AI — backend/server.py
# ========================================================================
# Local HTTP server for the GridGuard AI dashboard.
#
# Serves:
#   1. REST API  — /api/state, /api/health, /api/devices, ... (JSON)
#   2. SSE       — /api/events (live 'tick' notifications)
#   3. Static    — the existing frontend/ directory (index.html,
#                  pages/, assets/) so the dashboard and the API share
#                  one origin (no CORS needed).
#
# Built entirely on the Python standard library (http.server) — the only
# third-party dependency in the backend is paho-mqtt (see bridge.py).
#
# Run:
#   ./venv/bin/python server.py          (or use run.sh)
# ========================================================================

import json
import os
import queue
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

import config
from db import Database
from bridge import Bridge

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".js":   "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg":  "image/svg+xml",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".ico":  "image/x-icon",
    ".txt":  "text/plain; charset=utf-8",
    ".md":   "text/plain; charset=utf-8",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".map":  "application/json",
}


class GridGuardHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "GridGuardBackend/1.0"

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    @property
    def bridge(self):
        return self.server.bridge

    def _send_json(self, obj, status=200):
        payload = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def _read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None

    # ------------------------------------------------------------------
    # GET
    # ------------------------------------------------------------------
    def do_GET(self):
        path = urlsplit(self.path).path

        try:
            if path == "/api/health":
                self._send_json({
                    "status": "ok",
                    "mqttConnected": self.bridge.is_mqtt_connected(),
                    "devices": len(self.bridge.get_api_state()["devices"]),
                    "uptimeSeconds": int(time.time() - self.server.started_at),
                })
            elif path == "/api/state":
                self._send_json(self.bridge.get_api_state())
            elif path == "/api/devices":
                self._send_json(
                    {"devices": self.bridge.get_api_state()["devices"]})
            elif path == "/api/anomalies":
                self._send_json(
                    {"anomalies": self.bridge.get_api_state()["anomalies"]})
            elif path == "/api/intrusions":
                self._send_json(
                    {"intrusions": self.bridge.get_api_state()["intrusions"]})
            elif path == "/api/settings":
                self._send_json({"settings": self.bridge.get_api_state()["settings"]})
            elif path == "/api/events":
                self._handle_sse()
            elif path.startswith("/api/"):
                self._send_json({"error": "not found"}, status=404)
            else:
                self._serve_static(path)
        except (BrokenPipeError, ConnectionResetError):
            pass  # client went away mid-stream (normal for SSE)
        except Exception as exc:
            try:
                self._send_json({"error": str(exc)}, status=500)
            except Exception:
                pass

    # ------------------------------------------------------------------
    # POST
    # ------------------------------------------------------------------
    def do_POST(self):
        path = urlsplit(self.path).path
        body = self._read_json_body()
        if body is None:
            self._send_json({"error": "invalid JSON body"}, status=400)
            return

        try:
            if path == "/api/login":
                self._handle_login(body)
            elif path == "/api/settings":
                settings = self.bridge.update_settings(body)
                self._send_json({"ok": True, "settings": settings})
            elif path == "/api/anomalies/resolve":
                anomaly_id = str(body.get("id", ""))
                if not anomaly_id:
                    self._send_json({"error": "missing 'id'"}, status=400)
                else:
                    self.bridge.resolve_anomaly(anomaly_id)
                    self._send_json({"ok": True})
            elif path == "/api/reset":
                self.bridge.reset()
                self._send_json({"ok": True})
            else:
                self._send_json({"error": "not found"}, status=404)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:
            try:
                self._send_json({"error": str(exc)}, status=500)
            except Exception:
                pass

    # ------------------------------------------------------------------
    # Login
    # ------------------------------------------------------------------
    def _handle_login(self, body):
        username = str(body.get("username", "")).strip().lower()
        password = str(body.get("password", ""))

        if not username or not password:
            self._send_json({"error": "Email and password are required."}, status=400)
            return

        demo_user = config.DEMO_USERS.get(username)
        if demo_user and demo_user["password"] == password:
            self._send_json({
                "ok": True,
                "user": {
                    "name":  demo_user["name"],
                    "email": demo_user["email"],
                    "role":  demo_user["role"],
                }
            })
        else:
            self._send_json({"error": "Invalid email or password."}, status=401)

    # ------------------------------------------------------------------
    # SSE stream
    # ------------------------------------------------------------------
    def _handle_sse(self):
        q = self.bridge.add_subscriber()
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            self.wfile.write(b"retry: 3000\n\n")
            hello = json.dumps({"type": "hello"})
            self.wfile.write(("event: hello\ndata: %s\n\n" % hello).encode("utf-8"))
            self.wfile.flush()

            while True:
                try:
                    payload = q.get(timeout=15)
                except queue.Empty:
                    # Comment frame keeps the connection alive
                    self.wfile.write(b": heartbeat\n\n")
                    self.wfile.flush()
                    continue
                self.wfile.write(("event: tick\ndata: %s\n\n" % payload).encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass  # client disconnected — normal
        finally:
            self.bridge.remove_subscriber(q)

    # ------------------------------------------------------------------
    # Static file serving (frontend/)
    # ------------------------------------------------------------------
    def _serve_static(self, path):
        if path == "/":
            path = "/index.html"

        rel = os.path.normpath(path.lstrip("/"))
        full = os.path.realpath(os.path.join(config.FRONTEND_DIR, rel))
        frontend_root = os.path.realpath(config.FRONTEND_DIR)

        # Path-traversal guard
        if not full.startswith(frontend_root + os.sep) and full != frontend_root:
            self._send_json({"error": "forbidden"}, status=403)
            return

        if not os.path.isfile(full):
            self._send_json({"error": "not found"}, status=404)
            return

        ext = os.path.splitext(full)[1].lower()
        mime = MIME_TYPES.get(ext, "application/octet-stream")

        with open(full, "rb") as fh:
            content = fh.read()

        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)

    # ------------------------------------------------------------------
    # Quiet request logging (polling every few seconds would spam)
    # ------------------------------------------------------------------
    def log_message(self, fmt, *args):
        pass  # errors still surface via the exception handlers


class GridGuardServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, handler, bridge):
        super().__init__(address, handler)
        self.bridge = bridge
        self.started_at = time.time()

    def handle_error(self, request, client_address):
        # Browsers and curl drop SSE/polling connections routinely; a
        # traceback for every one of those is pure noise. Anything that
        # is NOT a client disconnect is still reported normally.
        if sys.exc_info()[0] in (ConnectionResetError, BrokenPipeError):
            return
        super().handle_error(request, client_address)


def main():
    print()
    print("  ============================================================")
    print("   GRIDGUARD AI — Backend Bridge (MQTT → SQLite → REST/SSE)")
    print("  ============================================================")
    print("   Dashboard : http://%s:%d/" % (config.HTTP_HOST, config.HTTP_PORT))
    print("   API state : http://%s:%d/api/state" % (config.HTTP_HOST, config.HTTP_PORT))
    print("   SSE stream: http://%s:%d/api/events" % (config.HTTP_HOST, config.HTTP_PORT))
    print("   Database  : %s" % config.DB_PATH)
    print("   Frontend  : %s" % config.FRONTEND_DIR)
    print("   Press Ctrl+C to stop.")
    print("  ============================================================")
    print()

    database = Database(config.DB_PATH)
    bridge = Bridge(database)
    bridge.start()

    # Pre-flight: detect port conflicts before the cryptic traceback.
    try:
        server = GridGuardServer((config.HTTP_HOST, config.HTTP_PORT),
                                 GridGuardHandler, bridge)
    except OSError as exc:
        if "Address already in use" in str(exc) or exc.errno == 48:
            print("  [server] ERROR: port %d is already in use." % config.HTTP_PORT)
            print("  [server] Another process is occupying port %d." % config.HTTP_PORT)
            print("  [server] Stop it first, then restart.")
            print("  [server] Hint: lsof -i :%d  to find the process." % config.HTTP_PORT)
        else:
            print("  [server] ERROR: could not bind %s:%d — %s"
                  % (config.HTTP_HOST, config.HTTP_PORT, exc))
        bridge.stop()
        database.close()
        sys.exit(1)

    # Periodic maintenance (telemetry pruning)
    def maintenance():
        while True:
            time.sleep(60)
            try:
                bridge.prune()
            except Exception as exc:
                print("  [server] prune error: %s" % exc)

    threading.Thread(target=maintenance, name="maintenance", daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  [server] shutting down...")
    finally:
        bridge.stop()
        server.server_close()
        database.close()
        print("  [server] stopped.")


if __name__ == "__main__":
    main()
