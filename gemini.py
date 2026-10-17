# language: Python, file: gemini.py
# Gemini multi-model answerer — uses google.genai (new SDK), full chain 3.x → 2.x → 1.5

from __future__ import annotations
import asyncio, os, logging, re
from google import genai
from google.genai import types

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
    "gemini-2.5-flash-lite-preview-06-17",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b",
]

_client: genai.Client | None = None
_current_model_idx = 0


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    return _client


SYSTEM = (
    "You are a homework assistant solving GCSE-level maths and science questions from Sparx Learning.\n"
    "Rules:\n"
    "- Give ONLY the final answer, no working, no explanation, no punctuation beyond the answer itself.\n"
    "- For multiple choice, output the exact text of the correct option.\n"
    "- For numeric answers, output the number only (include units if the question asks for them).\n"
    "- For fraction answers, use the format a/b.\n"
    "- For algebra, simplify fully.\n"
    "- Never say \"the answer is\", never add trailing text."
)

_QUOTA_SIGNALS = (
    "quota", "rate limit", "resourceexhausted", "unavailable",
    "not found", "404", "503", "model is not supported",
    "deprecated", "invalid", "permission", "does not exist",
    "not supported", "unknown model",
)


def _is_model_error(e: Exception) -> bool:
    msg = str(e).lower()
    return any(sig in msg for sig in _QUOTA_SIGNALS)


async def answer(question: str, options: list | None = None) -> str:
    global _current_model_idx

    if options:
        opts_block = "\n".join(f"- {o}" for o in options)
        prompt = f"Question: {question}\n\nOptions:\n{opts_block}\n\nAnswer:"
    else:
        prompt = f"Question: {question}\n\nAnswer:"

    client = _get_client()
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM,
        temperature=0.1,
        max_output_tokens=512,
    )

    start_idx = _current_model_idx
    for offset in range(len(_MODEL_CHAIN)):
        idx = (start_idx + offset) % len(_MODEL_CHAIN)
        model_name = _MODEL_CHAIN[idx]

        def _call(mn=model_name):
            return client.models.generate_content(
                model=mn,
                contents=prompt,
                config=config,
            )

        try:
            resp = await asyncio.get_event_loop().run_in_executor(None, _call)
            raw  = resp.text.strip()
            raw  = re.sub(r"^[Aa]nswer\s*:\s*", "", raw).strip()

            if offset > 0:
                _current_model_idx = idx
                log.info("gemini: permanently switched to %s", model_name)

            log.debug("Q: %s → A: %s [model=%s]", question[:80], raw[:60], model_name)
            return raw

        except Exception as e:
            if _is_model_error(e):
                log.warning("gemini: model %s unavailable (%s), trying next", model_name, e)
                continue
            log.error("gemini: hard error on %s: %s", model_name, e)
            break

    log.error("gemini: entire model chain exhausted, returning numeric fallback")
    return "1"
