"""End-to-end OCR over the 10 synthetic samples (skipped when no OCR engine is installed)."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.engines import engine_name
from app.main import app

SAMPLES = Path(__file__).resolve().parent.parent / "samples"
MANIFEST = json.loads((SAMPLES / "manifest.json").read_text(encoding="utf-8"))
needs_engine = pytest.mark.skipif(engine_name() == "none", reason="no OCR engine installed")
client = TestClient(app)

FIELDS = [
    "fdr_number",
    "ifsc",
    "amount",
    "issue_date",
    "maturity_date",
    "depositor_names",
    "bank_name",
]


@needs_engine
def test_samples_extract_with_high_accuracy() -> None:
    correct = total = 0
    for s in MANIFEST:
        with (SAMPLES / s["file"]).open("rb") as fh:
            res = client.post("/extract", files={"file": (s["file"], fh, "image/jpeg")})
        assert res.status_code == 200, res.text
        body = res.json()
        assert set(body["fields"]) >= set(FIELDS)
        for k in FIELDS:
            total += 1
            correct += str(body["fields"][k]).upper() == str(s["expected"][k]).upper()
    # The brief only needs pre-fill quality; we hold the bar at 90 % of fields on the samples.
    assert correct / total >= 0.9, f"{correct}/{total}"


def test_rejects_unsupported_files() -> None:
    res = client.post("/extract", files={"file": ("x.txt", b"hello", "text/plain")})
    assert res.status_code == 415


def test_reads_pdf_text_layer() -> None:
    pdf = _minimal_pdf(
        "FDR No.: PDF-12345  Maturity Date: 31/03/2031  Principal Amount: Rs. 2,00,000"
    )
    res = client.post("/extract", files={"file": ("x.pdf", pdf, "application/pdf")})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["engine"] == "pdf-text"
    assert body["fields"]["fdr_number"] == "PDF-12345"
    assert body["fields"]["maturity_date"] == "2031-03-31"


def _minimal_pdf(text: str) -> bytes:
    content = f"BT /F1 10 Tf 20 100 Td ({text}) Tj ET".encode()
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = b"%PDF-1.4\n"
    offsets = []
    for i, o in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer << /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out
