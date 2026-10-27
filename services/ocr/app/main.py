"""NidhiSetu OCR service.

POST /extract takes an FDR scan (PDF / PNG / JPEG) and returns the Section 8 contract:
{ fields, confidence, raw_text } plus the engine used. Field values are suggestions only — the API
records them as OCR_EXTRACTED and never trusts them above that level.
"""

from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import FastAPI, File, HTTPException, UploadFile

from .engines import engine_name, lines_from_bytes
from .extract import extract_fields
from .llm import llm_enabled, llm_extract

VERSION = "0.2.0"
MAX_BYTES = int(os.environ.get("OCR_MAX_MB", "15")) * 1024 * 1024
LOW_CONFIDENCE = 0.8

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    engine_name()  # load the OCR models once at start-up rather than on the first request
    yield


app = FastAPI(title="NidhiSetu OCR", version=VERSION, lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "service": "ocr",
        "version": VERSION,
        "engine": engine_name(),
        "llm": llm_enabled(),
        "time": datetime.now(UTC).isoformat(),
    }


@app.post("/extract")
async def extract(file: UploadFile = File(...)) -> dict[str, object]:  # noqa: B008 — FastAPI idiom
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File too large")
    if not (
        data[:5] == b"%PDF-" or data[:8] == b"\x89PNG\r\n\x1a\n" or data[:3] == b"\xff\xd8\xff"
    ):
        raise HTTPException(415, "Only PDF, PNG or JPEG files are accepted")
    try:
        lines, method = lines_from_bytes(data, file.content_type)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(422, f"Could not read the document: {exc}") from exc

    result = extract_fields(lines).to_contract()
    if llm_enabled():
        result = llm_extract(result)
    result["engine"] = method
    result["low_confidence"] = [
        k for k, c in result["confidence"].items() if result["fields"].get(k) and c < LOW_CONFIDENCE
    ]
    return result
