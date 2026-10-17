# language: Python, file: gemini.py
# Gemini multi-model answerer — full chain 3.x → 2.x → 1.5

from __future__ import annotations
import asyncio, os, logging, re
import google.generativeai as genai

log = logging.getLogger("gemini")

_MODEL_CHAIN = [
    "gemini-3.5-pro",
    "gemini-3.5-flash",
    "gemini-3.4-pro",
    "gemini-3.4-flash",
    "gemini-3.3-pro",
    "gemini-3.3-flash",
    "gemini-3.2-pro",
    "gemini-3.2-flash",
    "gemini-3.0-pro",
    "gemini-3.0-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-2.0-pro-exp",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b",
]

_configured = False
_current_model_idx = 0


def _ensure_configured() -> None:
    global _configured
    if not _configured:
        genai.configure(api_key=os.environ["GEMINI_API_KEY"])
        _configured = True


def _make_model(idx: int) -> genai.GenerativeModel:
    _ensure_configured()
    name = _MODEL_CHAIN[idx]
    log.info("gemini: using model %s (index %d)", name, idx)
    return genai.GenerativeModel(
        model_name=name,
        generation_config=genai.types.GenerationConfig(
            temperature=0.1,
            max_output_tokens=512,
        ),
    )


SYSTEM = """You are a homework assistant solving GCSE-level maths and science questions from Sparx Learning.
Rules:
- Give ONLY the final answer, no working, no explanation, no punctuation beyond the answer itself.
- For multiple choice, output the exact text of the correct option.
- For numeric answers, output the number only (include units if the question asks for them).
- For fraction answers, use the format a/b.
- For algebra, simplify fully.
- Never say "the answer is", never add trailing text.
"""

_QUOTA_SIGNALS = (
    "quota", "rate limit", "resourceexhausted", "unavailable",
    "not found", "404", "503", "model is not supported",
    "deprecated", "invalid", "permission", "does not exist",
)


def _is_model_error(e: Exception) -> bool:
    msg = str(e).lower()
    return any(sig in msg for sig in _QUOTA_SIGNALS)


async def answer(question: str, options: list | None = None) -> str:
    global _current_model_idx

    if options:
        opts_block = "\n".join(f"- {o}" for o in options)
        prompt = f"{SYSTEM}\n\nQuestion: {question}\n\nOptions:\n{opts_block}\n\nAnswer:"
    else:
        prompt = f"{SYSTEM}\n\nQuestion: {question}\n\nAnswer:"

    start_idx = _current_model_idx
    for offset in range(len(_MODEL_CHAIN)):
        idx = (start_idx + offset) % len(_MODEL_CHAIN)
        model = await asyncio.get_event_loop().run_in_executor(None, _make_model, idx)

        def _call(m=model):
            return m.generate_content(prompt)

        try:
            resp = await asyncio.get_event_loop().run_in_executor(None, _call)
            raw  = resp.text.strip()
            raw  = re.sub(r"^[Aa]nswer\s*:\s*", "", raw).strip()

            if offset > 0:
                _current_model_idx = idx
                log.info("gemini: permanently switched to %s", _MODEL_CHAIN[idx])

            log.debug("Q: %s → A: %s [model=%s]", question[:80], raw[:60], _MODEL_CHAIN[idx])
            return raw

        except Exception as e:
            if _is_model_error(e):
                log.warning("gemini: model %s unavailable (%s), trying next", _MODEL_CHAIN[idx], e)
                continue
            log.error("gemini: hard error on %s: %s", _MODEL_CHAIN[idx], e)
            break

    log.error("gemini: entire model chain exhausted, returning numeric fallback")
    return "1"
