"""AI tutor: explains why an answer was wrong.

Uses the Anthropic API if ANTHROPIC_API_KEY is set. Otherwise (or on any
error) it falls back to the explanation stored with the question, so the
demo never breaks.
"""
import os

MODEL = os.environ.get("TUTOR_MODEL", "claude-haiku-5-5")

SYSTEM = (
    "You are a friendly IT certification tutor for beginners. "
    "Explain in 3-5 short sentences, plain language, no markdown headers. "
    "Say why the student's choice is wrong, why the correct answer is right, "
    "and end with one memory tip."
)


def explain(question: dict, chosen_index: int | None) -> dict:
    choices = question["choices"]
    correct = choices[question["correct_index"]]
    chosen = choices[chosen_index] if chosen_index is not None else "(no answer)"

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if api_key:
        try:
            import anthropic

            client = anthropic.Anthropic(api_key=api_key)
            msg = client.messages.create(
                model=MODEL,
                max_tokens=300,
                system=SYSTEM,
                messages=[{
                    "role": "user",
                    "content": (
                        f"Question: {question['prompt']}\n"
                        f"Choices: {', '.join(choices)}\n"
                        f"Student picked: {chosen}\n"
                        f"Correct answer: {correct}"
                    ),
                }],
            )
            text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
            if text.strip():
                return {"source": "ai", "text": text.strip()}
        except Exception as e:  # keep the demo alive no matter what
            print(f"[tutor] AI call failed, using fallback: {e}")

    return {
        "source": "fallback",
        "text": (
            f"\"{chosen}\" is a common mix-up here, but the answer is \"{correct}\". "
            f"Add an ANTHROPIC_API_KEY to get a personalized AI explanation. "
            f"For now, mark this one as a flashcard and review the {question['domain']} domain."
        ),
    }
