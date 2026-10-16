"""Local SQLite persistence; credentials are never stored in the database."""
import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path


class Store:
    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.execute("CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, updated TEXT NOT NULL, document TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY, document TEXT NOT NULL)")

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=30)
        try:
            db.execute("PRAGMA journal_mode=WAL")
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def save_run(self, run):
        with self.connection() as db:
            db.execute("INSERT OR REPLACE INTO runs VALUES (?, ?, ?)", (run["id"], run["updated_at"], json.dumps(run)))

    def get_run(self, run_id):
        with self.connection() as db:
            row = db.execute("SELECT document FROM runs WHERE id = ?", (run_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def runs(self):
        with self.connection() as db:
            rows = db.execute("SELECT document FROM runs ORDER BY updated DESC LIMIT 200").fetchall()
        return [json.loads(row[0]) for row in rows]

    def save_provider(self, provider):
        with self.connection() as db:
            db.execute("INSERT OR REPLACE INTO providers VALUES (?, ?)", (provider["id"], json.dumps(provider)))

    def providers(self):
        with self.connection() as db:
            rows = db.execute("SELECT document FROM providers").fetchall()
        return [json.loads(row[0]) for row in rows]

    def get_provider(self, provider_id):
        return next((p for p in self.providers() if p["id"] == provider_id), None)
