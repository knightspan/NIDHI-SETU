"""NidhiSetu OCR service.

Phase 0: health endpoint only. `POST /extract` (Section 8 of the brief) arrives in Phase 9.
OCR output is never trusted above OCR_EXTRACTED; the API enforces that, not this service.
"""

from datetime import UTC, datetime

from fastapi import FastAPI

VERSION = "0.1.0"

app = FastAPI(title="NidhiSetu OCR", version=VERSION)


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "ocr",
        "version": VERSION,
        "time": datetime.now(UTC).isoformat(),
    }
