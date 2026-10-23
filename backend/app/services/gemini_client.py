"""A small Gemini client for the public, anonymous tools.

Kept apart from :mod:`app.services.llm_router` on purpose. That router carries
user data — resumes, recruiter mail, Gmail content — under consent and provider
rules; the public tools carry only what a stranger typed into a form, and they
should neither spend the product's main LLM budget nor share its failure modes.

The key is read from ``GEMINI_API_KEY`` at call time, so a deployment without it
simply reports :class:`GeminiUnavailable` and the caller degrades (the cover
letter page falls back to its template) rather than failing to start.
"""
from __future__ import annotations

import logging
import os

import httpx

logger = logging.getLogger(__name__)

API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

#: Tried in order. A model that errors, times out or returns nothing hands over
#: to the next; the lite model last because it is the cheapest to keep answering.
MODELS = ("gemini-3.6-flash", "gemini-3.8-flash", "gemini-3.5-flash-lite")


class GeminiUnavailable(RuntimeError):
    """No key configured, or every model failed."""


def is_configured() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY", "").strip())


def generate(
    system: str,
    prompt: str,
    *,
    temperature: float = 0.7,
    # Generous because the 3.x flash models spend part of it thinking before
    # they write; a tight cap truncates the answer, not the thought.
    max_output_tokens: int = 4096,
    timeout: float = 25.0,
) -> str:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        raise GeminiUnavailable("GEMINI_API_KEY is not set")

    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": temperature, "maxOutputTokens": max_output_tokens},
    }
    last = "no model tried"
    for model in MODELS:
        try:
            resp = httpx.post(
                API_URL.format(model=model),
                headers={"x-goog-api-key": key},
                json=body,
                timeout=timeout,
            )
        except httpx.HTTPError as exc:
            last = f"{model}: {type(exc).__name__}"
            continue
        if resp.status_code != 200:
            # Status only: an error body can echo the prompt back.
            last = f"{model}: HTTP {resp.status_code}"
            continue
        text = _text_of(resp)
        if text:
            return text
        last = f"{model}: empty completion"
    logger.warning("gemini: every model failed (%s)", last)
    raise GeminiUnavailable(last)


def _text_of(resp: httpx.Response) -> str:
    try:
        candidates = resp.json().get("candidates") or []
    except ValueError:
        return ""
    if not candidates:
        return ""
    parts = (candidates[0].get("content") or {}).get("parts") or []
    # Thought summaries, when a model returns them, are flagged and not the answer.
    return "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()
