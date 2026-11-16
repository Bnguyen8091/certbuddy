# 📚 Cert Study Buddy

A study app for IT certification exams (starting with CompTIA Tech+), built for the NPower Hackathon.

- **Practice quizzes** by exam domain, with instant feedback
- **🤖 AI tutor** that explains *why* a wrong answer is wrong
- **Flashcards with spaced repetition** (Leitner boxes 1–5)
- **Progress dashboard** showing accuracy by domain and your focus area
- **Study plan**: enter your exam date and get a day-by-day schedule weighted toward your weak domains

> All practice questions are original and written from the public exam objectives. They are not real exam questions.

## Run it

```bash
python -m venv .venv && .venv\Scripts\activate   # Windows (mac/Linux: source .venv/bin/activate)
pip install -r requirements.txt
cp .env.example .env        # optional: add your ANTHROPIC_API_KEY for the AI tutor
python app.py
```
Then open http://localhost:5000

Without an API key the tutor falls back to the built-in explanation, so the app always works.

Reset all progress: `python db.py`

## Project structure

| File | What it does | Owner |
|---|---|---|
| `app.py` | Flask API routes | |
| `db.py` | SQLite schema + seeding | |
| `questions.py` | Question bank (add more here!) | |
| `srs.py` | Spaced-repetition logic | |
| `planner.py` | Exam date → day-by-day study plan | |
| `tutor.py` | AI tutor (with offline fallback) | |
| `static/` | Frontend: HTML, CSS, vanilla JS, Chart.js | |

## API

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/domains` | List domains + question counts |
| GET | `/api/quiz?domain=&n=10` | Random quiz questions (answers hidden) |
| POST | `/api/answer` | `{question_id, chosen_index}` → correct?, explanation |
| POST | `/api/explain` | `{question_id, chosen_index}` → AI tutor explanation |
| GET | `/api/flashcards/due` | Cards due for review |
| POST | `/api/flashcards/review` | `{question_id, correct}` → new box |
| GET | `/api/stats` | Dashboard data |
| GET | `/api/plan` | Current study plan (or `configured: false`) |
| POST | `/api/plan` | `{exam_date: "YYYY-MM-DD", minutes: 15\|30\|60}` → builds plan |

## Stretch goals
- [x] Exam date → day-by-day study plan
- [ ] AI-generated questions for weak domains
- [ ] Study streaks / badges
- [ ] More exams (A+, Network+, Security+)
