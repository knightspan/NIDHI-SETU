"""OCR engines, tried in order: PaddleOCR → RapidOCR (PP-OCR models on ONNX) → Tesseract.

PDFs with a text layer are read directly; scanned PDFs are rendered page by page.
Every engine returns the same shape: a list of `Line(text, confidence)`.
"""

from __future__ import annotations

import io
import logging
import shutil
from functools import lru_cache
from typing import Protocol

from PIL import Image, ImageOps

from .extract import Line

log = logging.getLogger("ocr")
MAX_PDF_PAGES = 3


class Engine(Protocol):
    name: str

    def read(self, image: Image.Image) -> list[Line]: ...


class PaddleEngine:
    name = "paddleocr"

    def __init__(self) -> None:
        from paddleocr import PaddleOCR  # type: ignore[import-not-found]

        self._ocr = PaddleOCR(lang="en", use_textline_orientation=True)

    def read(self, image: Image.Image) -> list[Line]:
        import numpy as np

        out: list[Line] = []
        for page in self._ocr.predict(np.array(image.convert("RGB"))):
            for text, score in zip(page["rec_texts"], page["rec_scores"], strict=False):
                out.append(Line(str(text), float(score)))
        return out


class RapidEngine:
    name = "rapidocr"

    def __init__(self) -> None:
        from rapidocr import RapidOCR

        self._ocr = RapidOCR()

    def read(self, image: Image.Image) -> list[Line]:
        import numpy as np

        res = self._ocr(np.array(image.convert("RGB")))
        if res is None or res.txts is None:
            return []
        boxes = res.boxes if res.boxes is not None else [None] * len(res.txts)
        items = list(zip(boxes, res.txts, res.scores, strict=False))
        # Reading order: top-to-bottom, then left-to-right; merge fragments on the same row.
        items.sort(key=lambda it: (_top(it[0]), _left(it[0])))
        rows: list[list[tuple[object, str, float]]] = []
        for it in items:
            if rows and abs(_top(rows[-1][0][0]) - _top(it[0])) < _height(it[0]) * 0.6:
                rows[-1].append(it)
            else:
                rows.append([it])
        lines: list[Line] = []
        for row in rows:
            row.sort(key=lambda it: _left(it[0]))
            lines.append(Line(" ".join(t for _, t, _ in row), min(float(s) for _, _, s in row)))
        return lines


def _top(box: object) -> float:
    return float(min(p[1] for p in box)) if box is not None else 0.0  # type: ignore[union-attr]


def _left(box: object) -> float:
    return float(min(p[0] for p in box)) if box is not None else 0.0  # type: ignore[union-attr]


def _height(box: object) -> float:
    if box is None:
        return 10.0
    ys = [p[1] for p in box]  # type: ignore[union-attr]
    return max(10.0, float(max(ys) - min(ys)))


class TesseractEngine:
    name = "tesseract"

    def __init__(self) -> None:
        import pytesseract

        if not shutil.which("tesseract"):
            raise RuntimeError("tesseract binary not found")
        self._t = pytesseract

    def read(self, image: Image.Image) -> list[Line]:
        data = self._t.image_to_data(image, output_type=self._t.Output.DICT)
        rows: dict[tuple[int, int, int], list[tuple[str, float]]] = {}
        for i, word in enumerate(data["text"]):
            if not word.strip():
                continue
            key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
            conf = max(0.0, float(data["conf"][i])) / 100.0
            rows.setdefault(key, []).append((word, conf))
        return [Line(" ".join(w for w, _ in ws), min(c for _, c in ws)) for ws in rows.values()]


@lru_cache(maxsize=1)
def engine() -> Engine | None:
    for cls in (PaddleEngine, RapidEngine, TesseractEngine):
        try:
            e = cls()
            log.info("OCR engine: %s", e.name)
            return e
        except Exception as exc:  # noqa: BLE001 — any import/runtime failure means "try the next one"
            log.info("OCR engine %s unavailable: %s", cls.name, exc)
    return None


def engine_name() -> str:
    e = engine()
    return e.name if e else "none"


def lines_from_bytes(data: bytes, content_type: str | None) -> tuple[list[Line], str]:
    """OCR any supported upload. Returns lines and the method used."""
    if data[:5] == b"%PDF-":
        return _from_pdf(data)
    image = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
    e = engine()
    if e is None:
        raise RuntimeError("No OCR engine is installed")
    return e.read(_prepare(image)), e.name


def _prepare(image: Image.Image) -> Image.Image:
    image = image.convert("RGB")
    # Upscale small scans; OCR models do better around 1500–2500 px wide.
    if image.width < 1400:
        scale = 1400 / image.width
        image = image.resize((int(image.width * scale), int(image.height * scale)))
    return image


def _from_pdf(data: bytes) -> tuple[list[Line], str]:
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(data)
    lines: list[Line] = []
    # Text layer first: exact, and confidence 1.
    for i in range(min(len(pdf), MAX_PDF_PAGES)):
        text = pdf[i].get_textpage().get_text_range()
        lines += [Line(t.strip(), 1.0) for t in text.splitlines() if t.strip()]
    if sum(len(ln.text) for ln in lines) > 40:
        return lines, "pdf-text"
    e = engine()
    if e is None:
        raise RuntimeError("Scanned PDF and no OCR engine installed")
    lines = []
    for i in range(min(len(pdf), MAX_PDF_PAGES)):
        image = pdf[i].render(scale=2.5).to_pil()
        lines += e.read(_prepare(image))
    return lines, e.name
