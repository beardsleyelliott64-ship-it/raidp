"""
Gemini solver with sticky fallback chain.

Tries from the last known-working model index.
On failure rotates forward through all models.
Sticks to the first one that responds successfully.
"""
import google.generativeai as genai
from config import GEMINI_KEY, GEMINI_MODELS

genai.configure(api_key=GEMINI_KEY)

# Module-level sticky index — survives across calls in the same process
_current_idx: int = 0

PLATFORM_PROMPTS: dict[str, str] = {
    "sparx_maths": (
        "You are a GCSE/A-Level maths tutor helping a student with Sparx Maths. "
        "Solve the question with full working shown step by step.\n\n"
        "Format your response exactly as:\n"
        "**Answer:** [final answer]\n\n"
        "**Working:**\n[numbered steps, one per line, showing every operation]\n\n"
        "**Explanation:**\n[brief explanation of the key concept used]"
    ),
    "sparx_science": (
        "You are a GCSE science tutor helping a student with Sparx Science. "
        "Answer the question fully.\n\n"
        "Format your response exactly as:\n"
        "**Answer:** [answer]\n\n"
        "**Explanation:**\n[explain the science concept, key terms in bold]\n\n"
        "**Key Points:**\n[bullet list of important facts to remember]"
    ),
    "sparx_reader": (
        "You are helping a student with Sparx Reader comprehension questions. "
        "Answer the question about the text.\n\n"
        "Format your response as:\n"
        "**Answer:** [full answer]\n\n"
        "**Evidence from text:** [quote or reference supporting the answer]\n\n"
        "**Explanation:** [why this answers the question]"
    ),
    "seneca": (
        "You are helping a student with Seneca Learning revision questions. "
        "These are typically short-answer or multiple-choice style.\n\n"
        "Format your response as:\n"
        "**Answer:** [concise answer matching Seneca's expected format]\n\n"
        "**Why:** [one-sentence explanation]\n\n"
        "**Remember:** [key fact to retain for exam]"
    ),
    "educake": (
        "You are helping a student with Educake quiz questions. "
        "Provide a clear, correct answer in the format Educake expects.\n\n"
        "Format your response as:\n"
        "**Answer:** [answer]\n\n"
        "**Explanation:** [brief explanation of why this is correct]"
    ),
    "bedrock": (
        "You are helping a student with Bedrock Learning vocabulary and reading tasks.\n\n"
        "Format your response as:\n"
        "**Answer:** [answer]\n\n"
        "**Definition/Context:** [meaning or context if vocabulary-based]"
    ),
    "languagenut": (
        "You are helping a student with LanguageNut language learning tasks. "
        "Provide the correct translation, grammar answer, or vocabulary answer.\n\n"
        "Format your response as:\n"
        "**Answer:** [answer in target language if applicable]\n\n"
        "**Translation:** [English meaning if applicable]\n\n"
        "**Grammar note:** [brief grammar rule if relevant]"
    ),
    "tassomai": (
        "You are helping a student with Tassomai science/maths quiz questions.\n\n"
        "Format your response as:\n"
        "**Answer:** [correct answer — single letter if multiple choice, or short phrase]\n\n"
        "**Explanation:** [why this is correct in 1–2 sentences]"
    ),
    "century": (
        "You are helping a student with Century Tech adaptive learning questions.\n\n"
        "Format your response as:\n"
        "**Answer:** [answer]\n\n"
        "**Explanation:** [explanation of the concept]"
    ),
    "kerboodle": (
        "You are helping a student with Kerboodle textbook questions.\n\n"
        "Format your response as:\n"
        "**Answer:** [full answer]\n\n"
        "**Working/Explanation:** [show working or explain]"
    ),
    "gcse_pod": (
        "You are helping a student with GCSEPod revision questions.\n\n"
        "Format your response as:\n"
        "**Answer:** [answer]\n\n"
        "**Key concept:** [the GCSE topic/concept this tests]"
    ),
    "dr_frost": (
        "You are helping a student with Dr Frost Maths. "
        "Show full mathematical working.\n\n"
        "Format your response as:\n"
        "**Answer:** [numerical/algebraic answer]\n\n"
        "**Working:**\n[step-by-step, each step on a new line with → showing transitions]\n\n"
        "**Method:** [name the method used e.g. quadratic formula, substitution]"
    ),
    "isaac": (
        "You are helping a student with Isaac Physics problems. "
        "These require precise physics working with units.\n\n"
        "Format your response as:\n"
        "**Answer:** [answer with correct SI units]\n\n"
        "**Working:**\n[step-by-step with equations, substitutions, and unit tracking]\n\n"
        "**Physics principle:** [the law or principle applied]"
    ),
    "general": (
        "You are SenAI, an AI homework tutor. "
        "Answer the following homework question clearly and completely.\n\n"
        "Format your response as:\n"
        "**Answer:** [clear answer]\n\n"
        "**Explanation:**\n[step-by-step explanation or working]\n\n"
        "**Key point:** [one thing to remember]"
    ),
}


def _extract_answer_line(text: str) -> str:
    for line in text.split("\n"):
        stripped = line.strip()
        if stripped.startswith("**Answer:**"):
            return stripped.replace("**Answer:**", "").strip()
    return text[:200]


async def solve(platform_tag: str, question: str, context: str = "") -> dict:
    """
    Solves a homework question using the Gemini fallback chain.
    Starts at the last known-working model, rotates forward on failure,
    sticks to whichever model responds first.
    Returns dict: answer (short), full (full response), platform_tag, model_used
    """
    global _current_idx

    system_prompt = PLATFORM_PROMPTS.get(platform_tag, PLATFORM_PROMPTS["general"])
    user_content  = question if not context else f"Context:\n{context}\n\nQuestion:\n{question}"

    n = len(GEMINI_MODELS)

    for offset in range(n):
        idx = (_current_idx + offset) % n
        model_name = GEMINI_MODELS[idx]

        try:
            model = genai.GenerativeModel(
                model_name=model_name,
                system_instruction=system_prompt,
            )
            response = await model.generate_content_async(user_content)
            text = response.text

            # Stick to this model for next call
            _current_idx = idx

            return {
                "answer":      _extract_answer_line(text),
                "full":        text,
                "raw":         text,
                "platform_tag": platform_tag,
                "model_used":  model_name,
            }

        except Exception as e:
            print(f"[solver] {model_name} failed (idx {idx}): {e}")
            # Advance sticky index past this failure
            _current_idx = (idx + 1) % n
            continue

    # All models exhausted
    return {
        "answer":      "All models failed",
        "full":        "Every Gemini model in the fallback chain failed. Check your API key and quota.",
        "raw":         "",
        "platform_tag": platform_tag,
        "model_used":  "none",
    }


def current_model() -> str:
    """Returns the name of the currently active model."""
    return GEMINI_MODELS[_current_idx] if GEMINI_MODELS else "none"
