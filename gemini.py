# language: Python, file: gemini.py
# Gemini 1.5 Flash — answers Sparx homework questions

from __future__ import annotations
import asyncio, os, logging, re
import google.generativeai as genai

log = logging.getLogger("gemini")

_model: genai.GenerativeModel | None = None

def _get_model() -> genai.GenerativeModel:
    global _model
    if _model is None:
        genai.configure(api_key=os.environ["GEMINI_API_KEY"])
        _model = genai.GenerativeModel(
            model_name="gemini-1.5-flash",
            generation_config=genai.types.GenerationConfig(
                temperature=0.1,      # low temp = more accurate, less creative
                max_output_tokens=512,
            ),
        )
    return _model


SYSTEM = """You are a homework assistant solving GCSE-level maths and science questions from Sparx Learning.
Rules:
- Give ONLY the final answer, no working, no explanation, no punctuation beyond the answer itself.
- For multiple choice, output the exact text of the correct option.
- For numeric answers, output the number only (include units if the question asks for them).
- For fraction answers, use the format a/b.
- For algebra, simplify fully.
- Never say "the answer is", never add trailing text.
"""


async def answer(question: str, options: list | None = None) -> str:
    """Return the answer string for a given question + optional choices."""
    model = await asyncio.get_event_loop().run_in_executor(None, _get_model)

    if options:
        opts_block = "\n".join(f"- {o}" for o in options)
        prompt = f"{SYSTEM}\n\nQuestion: {question}\n\nOptions:\n{opts_block}\n\nAnswer:"
    else:
        prompt = f"{SYSTEM}\n\nQuestion: {question}\n\nAnswer:"

    def _call():
        return model.generate_content(prompt)

    try:
        resp = await asyncio.get_event_loop().run_in_executor(None, _call)
        raw = resp.text.strip()
        # strip leading "Answer:" if model echoed it
        raw = re.sub(r"^[Aa]nswer\s*:\s*", "", raw).strip()
        log.debug("Q: %s → A: %s", question[:80], raw[:60])
        return raw
    except Exception as e:
        log.error("gemini error: %s", e)
        return "1"   # safe numeric fallback
