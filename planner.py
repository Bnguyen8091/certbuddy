"""Study plan: turn an exam date into a day-by-day schedule.

How it decides what to study each day:
1. Each domain gets a priority = (how much of the exam it is) x (how weak you are at it).
   Domains you haven't practiced yet count as fairly weak, so they get covered.
2. Days are handed out in proportion to priority using "smooth weighted round-robin"
   (the same trick load balancers use), so a high-priority domain gets more days
   but the domains still rotate instead of bunching up.
3. The last days before the exam are fixed: a full mixed mock exam, then a light
   flashcard-only review day so you go in rested.
"""
from datetime import date, timedelta

# Approximate share of the CompTIA Tech+ (FC0-U71) exam per domain,
# from CompTIA's public exam objectives.
EXAM_WEIGHTS = {
    "IT Concepts": 0.13,
    "Infrastructure": 0.22,
    "Applications & Software": 0.18,
    "Software Development": 0.13,
    "Data & Databases": 0.12,
    "Security": 0.22,
}
UNTESTED_WEAKNESS = 0.6  # treat an unpracticed domain like ~40% accuracy

# Minutes per day -> questions per quiz
QUIZ_SIZE = {15: 5, 30: 10, 60: 20}


def domain_priorities(domains: list[dict]) -> dict[str, float]:
    """domains: [{"domain": str, "accuracy": int | None}, ...] from /api/stats."""
    out = {}
    for d in domains:
        weight = EXAM_WEIGHTS.get(d["domain"], 1 / max(len(domains), 1))
        acc = d["accuracy"]
        weakness = UNTESTED_WEAKNESS if acc is None else (100 - acc) / 100
        # +0.25 so even a domain at 100% still gets an occasional refresher
        out[d["domain"]] = weight * (weakness + 0.25)
    return out


def _focus_sequence(priorities: dict[str, float], n: int) -> list[str]:
    """Smooth weighted round-robin: pick n domains in proportion to priority."""
    total = sum(priorities.values())
    current = {d: 0.0 for d in priorities}
    seq = []
    for _ in range(n):
        for d, w in priorities.items():
            current[d] += w
        pick = max(current, key=current.get)
        current[pick] -= total
        seq.append(pick)
    return seq


def _reason(domain: str, stats_by_domain: dict) -> str:
    acc = stats_by_domain[domain]["accuracy"]
    share = round(EXAM_WEIGHTS.get(domain, 0) * 100)
    if acc is None:
        return f"Not practiced yet · {share}% of the exam"
    return f"You're at {acc}% · {share}% of the exam"


def build_plan(exam_date: date, minutes: int, domains: list[dict],
               today: date | None = None) -> dict:
    today = today or date.today()
    days_left = (exam_date - today).days
    if days_left < 0:
        return {"error": "That exam date is in the past."}

    quiz_n = QUIZ_SIZE.get(minutes, 10)
    stats_by_domain = {d["domain"]: d for d in domains}
    priorities = domain_priorities(domains)

    # Reserve the final days: mock exam, then light review (when there's room).
    if days_left >= 4:
        tail = ["mock", "light"]
    elif days_left >= 2:
        tail = ["light"]
    else:
        tail = []
    study_days = max(days_left - len(tail), 0)
    focus = _focus_sequence(priorities, study_days)

    days = []
    for i in range(days_left):
        day = today + timedelta(days=i)
        entry = {"date": day.isoformat(), "is_today": i == 0, "tasks": []}
        if i < study_days:
            dom = focus[i]
            entry.update(kind="focus", title=dom, reason=_reason(dom, stats_by_domain))
            entry["tasks"].append({"type": "quiz", "domain": dom, "n": quiz_n,
                                   "label": f"Quiz: {quiz_n} {dom} questions"})
            # Every 3rd study day, mix in a review of everything
            if i % 3 == 2:
                entry["tasks"].append({"type": "quiz", "domain": "", "n": quiz_n,
                                       "label": f"Mixed review: {quiz_n} questions from all domains"})
        elif tail[i - study_days] == "mock":
            entry.update(kind="mock", title="Mock exam", reason="Full mixed practice under exam pressure")
            entry["tasks"].append({"type": "quiz", "domain": "", "n": 30,
                                   "label": "Mock exam: 30 questions, all domains"})
        else:
            entry.update(kind="light", title="Light review", reason="Rest up. Just keep your memory fresh")
        entry["tasks"].append({"type": "cards", "label": "Review your due flashcards"})
        days.append(entry)

    days.append({"date": exam_date.isoformat(), "is_today": days_left == 0, "kind": "exam",
                 "title": "Exam day", "reason": "You've got this. Get there early.", "tasks": []})

    return {
        "exam_date": exam_date.isoformat(),
        "minutes": minutes,
        "days_left": days_left,
        "priorities": sorted(
            ({"domain": d, "share": round(100 * p / sum(priorities.values()))}
             for d, p in priorities.items()),
            key=lambda x: -x["share"]),
        "days": days,
    }
