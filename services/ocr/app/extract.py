"""Rule-based extraction of FDR fields from OCR text lines.

Input: OCR lines with a recognition confidence. Output: the Section 8 contract fields with a
per-field confidence. Labelled matches ("Maturity Date: 31/03/2031") score higher than
unlabelled guesses.
OCR output is advisory: the API stores it as OCR_EXTRACTED and never trusts it further.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

FIELDS = (
    "fdr_number",
    "bank_name",
    "ifsc",
    "amount",
    "issue_date",
    "maturity_date",
    "depositor_names",
)

#: Real bank names appear only as labels (bank master); IFSC prefixes are public codes.
BANKS: dict[str, tuple[str, ...]] = {
    "SBIN": ("STATE BANK OF INDIA",),
    "PUNB": ("PUNJAB NATIONAL BANK",),
    "BARB": ("BANK OF BARODA",),
    "CNRB": ("CANARA BANK",),
    "UBIN": ("UNION BANK OF INDIA",),
    "HDFC": ("HDFC BANK",),
    "ICIC": ("ICICI BANK",),
    "UTIB": ("AXIS BANK",),
}

MONTHS = {
    m: i + 1
    for i, m in enumerate(
        ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
    )
}

IFSC_RE = re.compile(r"\b([A-Z]{4})\s?0\s?([A-Z0-9]{6})\b")
DATE_RE = (
    r"(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[\s\-]?"
    r"(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[\s\-,]*\d{4})"
)
AMOUNT_RE = r"(?:RS\.?|INR|₹|`)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)"

LABELLED = 0.95
UNLABELLED = 0.7


@dataclass
class Line:
    text: str
    confidence: float = 1.0


@dataclass
class Extraction:
    fields: dict[str, object] = field(default_factory=dict)
    confidence: dict[str, float] = field(default_factory=dict)
    raw_text: str = ""

    def put(self, name: str, value: object, conf: float) -> None:
        if value in (None, "", []):
            return
        if name in self.fields and self.confidence.get(name, 0) >= conf:
            return
        self.fields[name] = value
        self.confidence[name] = round(max(0.0, min(1.0, conf)), 3)

    def to_contract(self) -> dict[str, object]:
        return {
            "fields": {k: self.fields.get(k) for k in FIELDS},
            "confidence": {k: self.confidence.get(k, 0.0) for k in FIELDS},
            "raw_text": self.raw_text,
        }


def parse_date(raw: str) -> str | None:
    """Indian-style dates (dd/mm/yyyy, dd-Mon-yyyy, …) → ISO yyyy-mm-dd."""
    s = raw.upper().strip().replace(",", " ")
    try:
        m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", s)
        if m:
            return date(int(m[1]), int(m[2]), int(m[3])).isoformat()
        m = re.fullmatch(r"(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})", s)
        if m:
            return date(int(m[3]), int(m[2]), int(m[1])).isoformat()
        m = re.fullmatch(r"(\d{1,2})[\s\-]?([A-Z]{3})[A-Z]*[\s\-]*(\d{4})", s)
        if m and m[2] in MONTHS:
            return date(int(m[3]), MONTHS[m[2]], int(m[1])).isoformat()
    except ValueError:
        return None
    return None


def parse_amount(raw: str) -> float | None:
    digits = raw.replace(",", "").strip()
    try:
        v = float(digits)
    except ValueError:
        return None
    return v if v > 0 else None


def _label_value(lines: list[Line], label: str, value: str) -> tuple[str, float] | None:
    """A value after a label on the same line, or on the next line when the label ends the line."""
    lab = re.compile(label, re.I)
    val = re.compile(value, re.I)
    for i, ln in enumerate(lines):
        m = lab.search(ln.text)
        if not m:
            continue
        rest = ln.text[m.end() :]
        v = val.search(rest)
        if v:
            return v.group(1), ln.confidence
        if i + 1 < len(lines):
            v = val.match(lines[i + 1].text.strip())
            if v:
                return v.group(1), min(ln.confidence, lines[i + 1].confidence) * 0.95
    return None


KEEP_SHORT = {"AND", "THE", "LTD", "PVT", "CO", "OF"}


def _clean_name(raw: str) -> str:
    """Drops stray 1–3 letter fragments at the end of a name (stamp / watermark bleed)."""
    tokens = raw.strip(" .,:;").split()
    while len(tokens) > 1 and len(tokens[-1]) <= 3 and tokens[-1] not in KEEP_SHORT:
        tokens.pop()
    return " ".join(tokens).strip(" .,:;")


def extract_fields(lines: list[Line]) -> Extraction:
    ex = Extraction(raw_text="\n".join(ln.text for ln in lines))
    upper = [Line(ln.text.upper(), ln.confidence) for ln in lines]
    text = ex.raw_text.upper()

    # FDR / deposit number
    hit = _label_value(
        upper,
        r"(?:F\.?D\.?R\.?|FIXED\s+DEPOSIT|DEPOSIT|RECEIPT|TDR|ACCOUNT)\s*(?:NO\b|NUMBER\b|#)\.?\s*[:\-]?",
        r"\s*([A-Z0-9][A-Z0-9/\-]{3,})",
    )
    if hit:
        ex.put("fdr_number", hit[0].strip("-/"), hit[1] * LABELLED)

    # IFSC (anywhere) and bank
    for ln in upper:
        m = IFSC_RE.search(ln.text)
        if m:
            ex.put("ifsc", f"{m[1]}0{m[2]}", ln.confidence * LABELLED)
            break
    for names in BANKS.values():
        for name in names:
            for ln in upper:
                if name in ln.text:
                    ex.put(
                        "bank_name",
                        name.title().replace("Hdfc", "HDFC").replace("Icici", "ICICI"),
                        ln.confidence * LABELLED,
                    )
    if "bank_name" not in ex.fields and "ifsc" in ex.fields:
        prefix = str(ex.fields["ifsc"])[:4]
        if prefix in BANKS:
            ex.put("bank_name", BANKS[prefix][0].title(), ex.confidence["ifsc"] * UNLABELLED)

    # Amount (prefer a labelled principal / deposit amount)
    hit = _label_value(
        upper,
        r"(?:PRINCIPAL|DEPOSIT)?\s*AMOUNT(?:\s+OF\s+DEPOSIT)?(?:\s*\(?(?:RS\.?|INR|₹)\)?)?\s*[:\-]?",
        AMOUNT_RE,
    )
    if hit and (v := parse_amount(hit[0])):
        ex.put("amount", v, hit[1] * LABELLED)
    else:
        m = re.search(r"(?:RS\.?|INR|₹)\s*([0-9][0-9,]{3,}(?:\.[0-9]{1,2})?)", text)
        if m and (v := parse_amount(m[1])):
            ex.put("amount", v, UNLABELLED)

    # Dates
    hit = _label_value(
        upper,
        r"(?:DATE\s+OF\s+(?:ISSUE|DEPOSIT)|ISSUE\s+DATE|DEPOSIT\s+DATE|VALUE\s+DATE|DATED)\s*[:\-]?",
        r"\s*" + DATE_RE,
    )
    if hit and (d := parse_date(hit[0])):
        ex.put("issue_date", d, hit[1] * LABELLED)
    hit = _label_value(
        upper,
        r"(?:MATURITY\s+DATE|DATE\s+OF\s+MATURITY|DUE\s+DATE|MATURES\s+ON)\s*[:\-]?",
        r"\s*" + DATE_RE,
    )
    if hit and (d := parse_date(hit[0])):
        ex.put("maturity_date", d, hit[1] * LABELLED)
    if "issue_date" not in ex.fields or "maturity_date" not in ex.fields:
        dates = [p for p in (parse_date(x) for x in re.findall(DATE_RE, text, re.I)) if p]
        if len(dates) >= 2:
            dates.sort()
            ex.put("issue_date", dates[0], UNLABELLED)
            ex.put("maturity_date", dates[-1], UNLABELLED)

    # Depositor / beneficiary names
    hit = _label_value(
        upper,
        r"(?:IN\s+THE\s+NAMES?(?:\s*\(S\))?\s+OF|DEPOSITOR(?:\(S\)|S)?|NAMES?\s+OF\s+(?:THE\s+)?DEPOSITORS?|BENEFICIAR(?:Y|IES))\s*[:\-]?",
        r"\s*(.+)",
    )
    if hit:
        names = [
            _clean_name(n)
            for n in re.split(r"\s+(?:AND|&)\s+|\s*[;,]\s*|\s+JOINTLY\s+WITH\s+", hit[0])
        ]
        names = [n for n in names if len(n) >= 3]
        if names:
            ex.put("depositor_names", names, hit[1] * LABELLED)

    return ex
