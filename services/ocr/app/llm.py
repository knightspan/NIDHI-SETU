"""Optional LLM-assisted field extraction (off by default; LLM_EXTRACTION=true to enable).

When enabled, the OCR text is sent to Claude, which returns the same fields as structured output.
The LLM only fills gaps or low-confidence fields left by the rule-based extractor, and its answers
are still recorded as OCR_EXTRACTED — never trusted above that level. Requires the optional
`anthropic` package (requirements-llm.txt) and Anthropic credentials. Note for DPDP compliance:
enabling this sends FDR text to an external processor (see docs/DPDP.md).
"""

from __future__ import annotations

import logging
import os

from pydantic import BaseModel

log = logging.getLogger("ocr.llm")

LLM_CONFIDENCE = 0.75
MODEL = os.environ.get("LLM_MODEL", "claude-opus-5-5")


class FdrFields(BaseModel):
    fdr_number: str | None
    bank_name: str | None
    ifsc: str | None
    amount: float | None
    issue_date: str | None  # YYYY-MM-DD
    maturity_date: str | None  # YYYY-MM-DD
    depositor_names: list[str]


PROMPT = """You read OCR text from an Indian bank Fixed Deposit Receipt (FDR).
Extract the fields exactly as printed.
Dates must be ISO YYYY-MM-DD (Indian documents use day/month/year).
Amount is the principal in rupees as a number. Use null for anything not present; do not guess.

OCR text:
<ocr>
{text}
</ocr>"""


def llm_enabled() -> bool:
    return os.environ.get("LLM_EXTRACTION", "false").lower() == "true"


def llm_extract(result: dict) -> dict:
    """Fills missing / low-confidence fields from Claude; on any problem returns `result` as is."""
    try:
        import anthropic
    except ImportError:
        log.warning("LLM_EXTRACTION=true but the anthropic package is not installed")
        return result
    try:
        client = anthropic.Anthropic()
        response = client.messages.parse(
            model=MODEL,
            max_tokens=2000,
            output_config={"effort": "low"},
            messages=[{"role": "user", "content": PROMPT.format(text=result["raw_text"][:20000])}],
            output_format=FdrFields,
        )
    except anthropic.APIConnectionError as exc:
        log.warning("LLM extraction unavailable (connection): %s", exc)
        return result
    except anthropic.RateLimitError as exc:
        log.warning("LLM extraction rate-limited: %s", exc)
        return result
    except anthropic.APIStatusError as exc:
        log.warning("LLM extraction failed (%s): %s", exc.status_code, exc)
        return result

    if response.stop_reason == "refusal" or response.parsed_output is None:
        log.info("LLM extraction declined; keeping rule-based fields")
        return result

    parsed = response.parsed_output.model_dump()
    fields, confidence = dict(result["fields"]), dict(result["confidence"])
    for name, value in parsed.items():
        if value in (None, "", []):
            continue
        if not fields.get(name) or confidence.get(name, 0.0) < LLM_CONFIDENCE:
            fields[name] = value
            confidence[name] = LLM_CONFIDENCE
    return {**result, "fields": fields, "confidence": confidence, "llm": MODEL}
