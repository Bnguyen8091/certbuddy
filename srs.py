"""Leitner-box spaced repetition.

Right answer -> card moves up one box and comes back later.
Wrong answer -> card drops to box 1 and comes back right away.
"""
from datetime import datetime, timedelta

MAX_BOX = 5
# Days until a card in each box is due again.
INTERVAL_DAYS = {1: 0, 2: 1, 3: 3, 4: 7, 5: 14}


def next_state(box: int, correct: bool, now: datetime | None = None):
    """Return (new_box, due_at_iso) after a review."""
    now = now or datetime.utcnow()
    new_box = min(box + 1, MAX_BOX) if correct else 1
    due = now + timedelta(days=INTERVAL_DAYS[new_box])
    return new_box, due.strftime("%Y-%m-%d %H:%M:%S")
