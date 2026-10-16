"""Dependency-free local dashboard server. Run: python server.py --open"""
import argparse
import json
import mimetypes
import os
import threading
import time
import traceback
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from engine import ValidationError, advance, create_run, summary
from providers import ModelAdapter, SYSTEM_PROMPT, DECISION_SCHEMA, validate_provider
from button_game import SYSTEM_PROMPT as BUTTON_PROMPT, DECISION_SCHEMA as BUTTON_SCHEMA
from storage import Store

ROOT = Path(__file__).resolve().parent


class Application:
    def __init__(self, database):
        self.store = Store(database)
        self.secrets = {}
        self.locks = {}
        self.progress = {}
        self.lock = threading.Lock()

    def run_lock(self, run_id):
        with self.lock:
            return self.locks.setdefault(run_id, threading.Lock())

    def provider_public(self, provider):
        return {**provider, "has_api_key": bool(self.secrets.get(provider["id"]))}

    def progress_public(self, run_id):
        with self.lock:
            entry = self.progress.get(run_id)
            if entry is None:
                return {"active": False}
            return {"active": True, "completed": entry["completed"],
                    "total": entry["total"], "current_agent": entry["current_agent"],
                    "elapsed_seconds": int(time.monotonic() - entry["started"])}


def make_handler(app):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            # Do not log payloads, credentials, or private prompts.
            print("%s %s" % (self.command, urllib.parse.urlparse(self.path).path), flush=True)

        def send_json(self, value, status=200, attachment=None):
            body = json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            if attachment:
                self.send_header("Content-Disposition", 'attachment; filename="%s"' % attachment)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def body(self):
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                raise ValidationError("Send a JSON request.")
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 65536:
                raise ValidationError("Request body is missing or too large.")
            try:
                value = json.loads(self.rfile.read(length))
            except (json.JSONDecodeError, UnicodeDecodeError):
                raise ValidationError("Request body is not valid JSON.")
            if not isinstance(value, dict):
                raise ValidationError("Request body must be an object.")
            return value

        def permitted(self):
            host = self.headers.get("Host", "")
            if host.split(":")[0] not in ("localhost", "127.0.0.1"):
                self.send_json({"error": "This application accepts loopback connections only."}, 403)
                return False
            origin = self.headers.get("Origin")
            if origin and origin not in ("http://" + host, "https://" + host):
                self.send_json({"error": "Cross-origin requests are not accepted."}, 403)
                return False
            return True

        def do_GET(self):
            if not self.permitted():
                return
            path = urllib.parse.urlparse(self.path).path
            try:
                if path == "/api/health":
                    self.send_json({"ok": True, "name": "Common Ground", "version": "1.1.0"})
                elif path == "/api/runs":
                    self.send_json({"runs": [summary(r) for r in app.store.runs()]})
                elif path == "/api/providers":
                    self.send_json({"providers": [app.provider_public(p) for p in app.store.providers()]})
                elif path.startswith("/api/runs/") and path.endswith("/progress"):
                    run_id = path.strip("/").split("/")[2]
                    if not app.store.get_run(run_id):
                        self.send_json({"error": "Experiment not found."}, 404)
                    else:
                        self.send_json(app.progress_public(run_id))
                elif path.startswith("/api/runs/"):
                    parts = path.strip("/").split("/")
                    run = app.store.get_run(parts[2])
                    if not run:
                        self.send_json({"error": "Experiment not found."}, 404)
                    elif len(parts) == 3:
                        self.send_json(run)
                    elif len(parts) == 4 and parts[3] == "export":
                        self.send_json(run, attachment="common-ground-%s.json" % run["id"][:8])
                    else:
                        self.send_json({"error": "Route not found."}, 404)
                else:
                    relative = "index.html" if path == "/" else urllib.parse.unquote(path.lstrip("/"))
                    file = (ROOT / "web" / relative).resolve()
                    if (ROOT / "web").resolve() not in file.parents or not file.is_file():
                        self.send_json({"error": "Page not found."}, 404)
                        return
                    body = file.read_bytes()
                    self.send_response(200)
                    mime = mimetypes.guess_type(str(file))[0] or "application/octet-stream"
                    if file.suffix == ".js":
                        mime = "text/javascript"
                    self.send_header("Content-Type", mime + ("; charset=utf-8" if mime.startswith("text/") else ""))
                    self.send_header("X-Content-Type-Options", "nosniff")
                    self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'")
                    self.send_header("Cache-Control", "no-cache")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
            except Exception:
                traceback.print_exc()
                self.send_json({"error": "Could not read local application data."}, 500)

        def do_POST(self):
            if not self.permitted():
                return
            path = urllib.parse.urlparse(self.path).path
            try:
                data = self.body()
                if path == "/api/runs":
                    provider = app.store.get_provider(data.get("provider_id")) if data.get("mode") == "model" else None
                    run = create_run(data, provider)
                    run["engine_version"] = "1.1.0"
                    if run["config"]["mode"] == "model":
                        is_buttons = run["config"].get("game") == "buttons"
                        run["system_prompt"] = BUTTON_PROMPT if is_buttons else SYSTEM_PROMPT
                        run["prompt_version"] = "buttons-v1" if is_buttons else "island-v1"
                    app.store.save_run(run)
                    self.send_json(run, 201)
                elif path == "/api/providers":
                    provider_id = data.get("id")
                    if provider_id and not app.store.get_provider(provider_id):
                        raise ValidationError("Model connection not found.")
                    provider = validate_provider(data, provider_id)
                    if "api_key" in data:
                        key = str(data["api_key"])
                        if key:
                            app.secrets[provider["id"]] = key
                        elif data.get("clear_api_key"):
                            app.secrets.pop(provider["id"], None)
                    app.store.save_provider(provider)
                    self.send_json(app.provider_public(provider), 201)
                elif path.startswith("/api/providers/") and path.endswith("/test"):
                    provider = app.store.get_provider(path.split("/")[3])
                    if not provider:
                        raise ValidationError("Model connection not found.")
                    self.send_json(ModelAdapter(provider, app.secrets.get(provider["id"], "")).test())
                elif path.startswith("/api/runs/") and path.endswith("/step"):
                    run_id = path.split("/")[3]
                    lock = app.run_lock(run_id)
                    if not lock.acquire(blocking=False):
                        self.send_json({"error": "This decision round is already being processed."}, 409)
                        return
                    try:
                        run = app.store.get_run(run_id)
                        if not run:
                            self.send_json({"error": "Experiment not found."}, 404)
                            return
                        is_buttons = run["config"].get("game") == "buttons"
                        prompt = BUTTON_PROMPT if is_buttons else SYSTEM_PROMPT
                        schema = BUTTON_SCHEMA if is_buttons else DECISION_SCHEMA
                        adapter = ModelAdapter(run["provider"], app.secrets.get(run["provider"]["id"], ""), run.get("system_prompt", prompt), schema) if run["provider"] else None
                        if adapter:
                            model_adapter = adapter
                            total = len(run["players"]) if is_buttons else sum(p["status"] == "imprisoned" for p in run["prisoners"])
                            with app.lock:
                                app.progress[run_id] = {"completed": 0, "total": total,
                                                        "current_agent": None, "started": time.monotonic()}

                            class ProgressAdapter:
                                def decide(self, obs, history):
                                    with app.lock:
                                        app.progress[run_id]["current_agent"] = obs.get("agent_id", obs.get("prisoner_id"))
                                    answer = model_adapter.decide(obs, history)
                                    with app.lock:
                                        app.progress[run_id]["completed"] += 1
                                    return answer

                            adapter = ProgressAdapter()
                        try:
                            result = advance(run, adapter)
                            app.store.save_run(result)
                            self.send_json(result)
                        finally:
                            with app.lock:
                                app.progress.pop(run_id, None)
                    finally:
                        lock.release()
                else:
                    self.send_json({"error": "Route not found."}, 404)
            except ValidationError as exc:
                self.send_json({"error": str(exc)}, 400)
            except Exception:
                traceback.print_exc()
                self.send_json({"error": "An unexpected local server error occurred."}, 500)
    return Handler


def main():
    parser = argparse.ArgumentParser(description="Common Ground local reasoning laboratory")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data", default=str(ROOT / "data" / "lab.sqlite3"))
    parser.add_argument("--open", action="store_true")
    args = parser.parse_args()
    app = Application(args.data)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(app))
    server.daemon_threads = True
    url = "http://127.0.0.1:%d" % args.port
    print("Common Ground is ready at " + url, flush=True)
    print("Data stays on this computer. Press Ctrl+C to stop.", flush=True)
    if args.open:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
