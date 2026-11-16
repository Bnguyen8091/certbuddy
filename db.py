"""SQLite setup: schema + seeding. Run `python db.py` to reset the database."""
import json
import os
import sqlite3

from questions import EXAM, QUESTIONS

DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "certbuddy.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS questions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    exam          TEXT NOT NULL,
    domain        TEXT NOT NULL,
    prompt        TEXT NOT NULL,
    choices       TEXT NOT NULL,      -- JSON list of strings
    correct_index INTEGER NOT NULL,
    explanation   TEXT NOT NULL
);

-- One row per answer submitted (quiz or flashcard). Powers the dashboard.
CREATE TABLE IF NOT EXISTS attempts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id  INTEGER NOT NULL REFERENCES questions(id),
    chosen_index INTEGER,
    correct      INTEGER NOT NULL,    -- 0 or 1
    mode         TEXT NOT NULL,       -- 'quiz' or 'flashcard'
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Spaced-repetition state: one card per question (Leitner boxes 1-5).
CREATE TABLE IF NOT EXISTS cards (
    question_id INTEGER PRIMARY KEY REFERENCES questions(id),
    box         INTEGER NOT NULL DEFAULT 1,
    due_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Simple key/value settings (exam date, study minutes per day).
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(reset=False):
    if reset and os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    conn = get_conn()
    conn.executescript(SCHEMA)
    # Add any questions from questions.py that aren't in the database yet.
    # Matching on the prompt text means new questions show up without wiping progress.
    existing = {r[0] for r in conn.execute("SELECT prompt FROM questions")}
    for domain, prompt, choices, correct, expl in QUESTIONS:
        if prompt in existing:
            continue
        cur = conn.execute(
            "INSERT INTO questions (exam, domain, prompt, choices, correct_index, explanation) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (EXAM, domain, prompt, json.dumps(choices), correct, expl),
        )
        conn.execute("INSERT INTO cards (question_id) VALUES (?)", (cur.lastrowid,))
    conn.commit()
    conn.close()


if __name__ == "__main__":
    init_db(reset=True)
    print(f"Database reset with {len(QUESTIONS)} questions at {DB_PATH}")
