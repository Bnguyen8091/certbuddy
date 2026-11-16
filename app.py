"""Cert Study Buddy - Flask API + static frontend.

Run:  python app.py   then open http://localhost:5000
"""
import json
import os
import random
from datetime import date

from flask import Flask, jsonify, request, send_from_directory

import planner
import srs
import tutor
from db import get_conn, init_db

try:  # optional: load ANTHROPIC_API_KEY from a .env file
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

app = Flask(__name__, static_folder="static", static_url_path="")


def row_to_question(row, include_answer=False):
    q = {
        "id": row["id"],
        "exam": row["exam"],
        "domain": row["domain"],
        "prompt": row["prompt"],
        "choices": json.loads(row["choices"]),
    }
    if include_answer:
        q["correct_index"] = row["correct_index"]
        q["explanation"] = row["explanation"]
    return q


def get_question(conn, qid):
    row = conn.execute("SELECT * FROM questions WHERE id = ?", (qid,)).fetchone()
    return row_to_question(row, include_answer=True) if row else None


def record_review(conn, qid, chosen, correct, mode):
    conn.execute(
        "INSERT INTO attempts (question_id, chosen_index, correct, mode) VALUES (?, ?, ?, ?)",
        (qid, chosen, int(correct), mode),
    )
    box = conn.execute("SELECT box FROM cards WHERE question_id = ?", (qid,)).fetchone()["box"]
    new_box, due = srs.next_state(box, correct)
    conn.execute("UPDATE cards SET box = ?, due_at = ? WHERE question_id = ?", (new_box, due, qid))
    return new_box


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/domains")
def domains():
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT exam, domain, COUNT(*) AS n FROM questions GROUP BY exam, domain ORDER BY domain"
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.get("/api/status")
def status():
    """Small summary for the status bar."""
    with get_conn() as conn:
        n = conn.execute("SELECT COUNT(*) FROM questions").fetchone()[0]
        due = conn.execute("SELECT COUNT(*) FROM cards WHERE due_at <= datetime('now')").fetchone()[0]
        exam = conn.execute("SELECT exam FROM questions LIMIT 1").fetchone()
    return jsonify({
        "exam": exam["exam"] if exam else "",
        "questions": n,
        "due": due,
        "ai": bool(os.environ.get("ANTHROPIC_API_KEY")),
    })


@app.get("/api/quiz")
def quiz():
    domain = request.args.get("domain")
    n = min(int(request.args.get("n", 10)), 50)
    sql, params = "SELECT * FROM questions", []
    if domain:
        sql += " WHERE domain = ?"
        params.append(domain)
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    rows = random.sample(rows, min(n, len(rows)))
    return jsonify([row_to_question(r) for r in rows])


@app.post("/api/answer")
def answer():
    data = request.get_json(force=True)
    qid, chosen = int(data["question_id"]), data.get("chosen_index")
    with get_conn() as conn:
        q = get_question(conn, qid)
        if not q:
            return jsonify({"error": "question not found"}), 404
        correct = chosen == q["correct_index"]
        box = record_review(conn, qid, chosen, correct, "quiz")
    return jsonify({
        "correct": correct,
        "correct_index": q["correct_index"],
        "explanation": q["explanation"],
        "box": box,
    })


@app.post("/api/explain")
def explain():
    data = request.get_json(force=True)
    with get_conn() as conn:
        q = get_question(conn, int(data["question_id"]))
    if not q:
        return jsonify({"error": "question not found"}), 404
    return jsonify(tutor.explain(q, data.get("chosen_index")))


@app.get("/api/flashcards/due")
def due_cards():
    domain = request.args.get("domain")
    sql = ("SELECT q.*, c.box FROM cards c JOIN questions q ON q.id = c.question_id "
           "WHERE c.due_at <= datetime('now')")
    params = []
    if domain:
        sql += " AND q.domain = ?"
        params.append(domain)
    sql += " ORDER BY c.box, c.due_at LIMIT 20"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    cards = []
    for r in rows:
        card = row_to_question(r, include_answer=True)
        card["box"] = r["box"]
        cards.append(card)
    return jsonify(cards)


@app.post("/api/flashcards/review")
def review_card():
    data = request.get_json(force=True)
    qid, correct = int(data["question_id"]), bool(data["correct"])
    with get_conn() as conn:
        if not get_question(conn, qid):
            return jsonify({"error": "question not found"}), 404
        box = record_review(conn, qid, None, correct, "flashcard")
    return jsonify({"box": box})


def domain_accuracy(conn):
    """Per-domain attempts and accuracy (None if never attempted)."""
    rows = conn.execute("""
        SELECT q.domain,
               COUNT(a.id)                 AS attempts,
               COALESCE(SUM(a.correct), 0) AS correct
        FROM questions q LEFT JOIN attempts a ON a.question_id = q.id
        GROUP BY q.domain ORDER BY q.domain
    """).fetchall()
    return [{
        "domain": r["domain"],
        "attempts": r["attempts"],
        "correct": r["correct"],
        "accuracy": round(100 * r["correct"] / r["attempts"]) if r["attempts"] else None,
    } for r in rows]


@app.get("/api/stats")
def stats():
    with get_conn() as conn:
        by_domain = domain_accuracy(conn)
        boxes = conn.execute("SELECT box, COUNT(*) AS n FROM cards GROUP BY box").fetchall()
        due = conn.execute("SELECT COUNT(*) FROM cards WHERE due_at <= datetime('now')").fetchone()[0]

    domains = [{k: d[k] for k in ("domain", "attempts", "accuracy")} for d in by_domain]
    tried = [d for d in domains if d["accuracy"] is not None]
    weakest = min(tried, key=lambda d: d["accuracy"])["domain"] if tried else None
    total = sum(d["attempts"] for d in domains)
    total_correct = sum(r["correct"] for r in by_domain)

    return jsonify({
        "domains": domains,
        "weakest": weakest,
        "total_attempts": total,
        "overall_accuracy": round(100 * total_correct / total) if total else None,
        "boxes": {str(b["box"]): b["n"] for b in boxes},
        "due_now": due,
    })


def _plan_response(conn):
    settings = dict(conn.execute("SELECT key, value FROM settings").fetchall())
    if "exam_date" not in settings:
        return {"configured": False}
    plan = planner.build_plan(
        date.fromisoformat(settings["exam_date"]),
        int(settings.get("minutes", 30)),
        domain_accuracy(conn),
    )
    return {"configured": True, **plan}


@app.get("/api/plan")
def get_plan():
    with get_conn() as conn:
        return jsonify(_plan_response(conn))


@app.post("/api/plan")
def save_plan():
    data = request.get_json(force=True)
    try:
        exam_date = date.fromisoformat(data["exam_date"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "Please pick a valid exam date."}), 400
    if exam_date < date.today():
        return jsonify({"error": "That exam date is in the past."}), 400
    if (exam_date - date.today()).days > 365:
        return jsonify({"error": "Pick a date within the next year."}), 400
    minutes = int(data.get("minutes", 30))
    with get_conn() as conn:
        conn.executemany(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [("exam_date", exam_date.isoformat()), ("minutes", str(minutes))],
        )
        return jsonify(_plan_response(conn))


@app.post("/api/reset")
def reset():
    init_db(reset=True)
    return jsonify({"ok": True})


init_db()

if __name__ == "__main__":
    app.run(debug=True, port=int(os.environ.get("PORT", 5000)))
