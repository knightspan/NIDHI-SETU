"""Generates 10 synthetic FDR images with fictional data (tests + demo).

usage: python scripts/generate_samples.py  → services/ocr/samples/sample-01.png … + manifest.json

Everything is made up: FDR numbers, trusts and amounts are fictional; real bank names are used only
as labels. Each image carries a "SPECIMEN · FICTIONAL" watermark.
"""

from __future__ import annotations

import json
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent.parent / "samples"

FONT_CANDIDATES = {
    "regular": [
        "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/Library/Fonts/Arial.ttf",
    ],
    "bold": [
        "C:/Windows/Fonts/arialbd.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
    ],
}


def font(kind: str, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONT_CANDIDATES[kind]:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size)


SAMPLES = [
    {
        "bank": "State Bank of India",
        "code": "SBIN",
        "ifsc": "SBIN0005943",
        "branch": "Connaught Place, New Delhi",
        "fdr": "SBI/FD/2026/104211",
        "amount": 1000000,
        "issue": "2026-04-01",
        "maturity": "2031-04-01",
        "names": ["AICTE", "Shiksha Prasar Trust"],
        "date_style": "dmy_slash",
        "lien": True,
    },
    {
        "bank": "HDFC Bank",
        "code": "HDFC",
        "ifsc": "HDFC0001234",
        "branch": "Andheri East, Mumbai",
        "fdr": "50300123456789",
        "amount": 1500000,
        "issue": "2025-07-15",
        "maturity": "2030-07-15",
        "names": ["AICTE", "Vidya Vikas Trust"],
        "date_style": "dmon",
        "lien": True,
    },
    {
        "bank": "Punjab National Bank",
        "code": "PUNB",
        "ifsc": "PUNB0123400",
        "branch": "Civil Lines, Kanpur",
        "fdr": "PNB-FDR-0045121",
        "amount": 500000,
        "issue": "2024-01-10",
        "maturity": "2029-01-10",
        "names": ["AICTE", "Gyan Jyoti Trust"],
        "date_style": "dmy_dash",
        "lien": True,
    },
    {
        "bank": "Bank of Baroda",
        "code": "BARB",
        "ifsc": "BARB0VADODA",
        "branch": "Alkapuri, Vadodara",
        "fdr": "BOB/TDR/778812",
        "amount": 2000000,
        "issue": "2023-11-01",
        "maturity": "2028-11-01",
        "names": ["AICTE", "Saraswati Seva Trust"],
        "date_style": "dmy_dot",
        "lien": True,
    },
    {
        "bank": "Canara Bank",
        "code": "CNRB",
        "ifsc": "CNRB0001122",
        "branch": "Jayanagar, Bengaluru",
        "fdr": "CB0011223344",
        "amount": 750000,
        "issue": "2026-02-20",
        "maturity": "2031-02-20",
        "names": ["AICTE", "Navnirman Trust"],
        "date_style": "dmy_slash",
        "lien": False,
    },
    {
        "bank": "Union Bank of India",
        "code": "UBIN",
        "ifsc": "UBIN0531234",
        "branch": "Salt Lake, Kolkata",
        "fdr": "UBI-FD-99120",
        "amount": 1200000,
        "issue": "2022-06-30",
        "maturity": "2027-06-30",
        "names": ["AICTE", "Pragati Shiksha Trust"],
        "date_style": "dmon",
        "lien": True,
    },
    {
        "bank": "ICICI Bank",
        "code": "ICIC",
        "ifsc": "ICIC0000456",
        "branch": "Banjara Hills, Hyderabad",
        "fdr": "ICICI/FD/66123009",
        "amount": 1000000,
        "issue": "2025-03-05",
        "maturity": "2030-03-05",
        "names": ["AICTE", "Vidya Vikas Trust"],
        "date_style": "dmy_slash",
        "lien": True,
    },
    {
        "bank": "Axis Bank",
        "code": "UTIB",
        "ifsc": "UTIB0000789",
        "branch": "MG Road, Pune",
        "fdr": "AXIS-TD-4455120",
        "amount": 600000,
        "issue": "2021-09-15",
        "maturity": "2026-09-15",
        "names": ["AICTE", "Gyan Jyoti Trust"],
        "date_style": "dmy_dash",
        "lien": True,
    },
    {
        "bank": "State Bank of India",
        "code": "SBIN",
        "ifsc": "SBIN0001707",
        "branch": "Hazratganj, Lucknow",
        "fdr": "SBI/FD/2024/880017",
        "amount": 1500000,
        "issue": "2024-08-12",
        "maturity": "2029-08-12",
        "names": ["Shiksha Prasar Trust"],
        "date_style": "dmon",
        "lien": False,
    },
    {
        "bank": "HDFC Bank",
        "code": "HDFC",
        "ifsc": "HDFC0004321",
        "branch": "Gomti Nagar, Lucknow",
        "fdr": "50300987650001",
        "amount": 900000,
        "issue": "2026-01-25",
        "maturity": "2031-01-25",
        "names": ["AICTE", "Navnirman Trust"],
        "date_style": "dmy_slash",
        "lien": True,
    },
]

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def fmt_date(iso: str, style: str) -> str:
    y, m, d = iso.split("-")
    return {
        "dmy_slash": f"{d}/{m}/{y}",
        "dmy_dash": f"{d}-{m}-{y}",
        "dmy_dot": f"{d}.{m}.{y}",
        "dmon": f"{d} {MONTHS[int(m) - 1]} {y}",
    }[style]


def inr(n: int) -> str:
    s = str(n)
    head, tail = s[:-3], s[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return ",".join([*groups, tail]) + ".00"


def render(s: dict, idx: int, rnd: random.Random) -> Image.Image:
    w, h = 1400, 900
    img = Image.new("RGB", (w, h), (252, 250, 243))
    d = ImageDraw.Draw(img)
    d.rectangle([20, 20, w - 20, h - 20], outline=(40, 60, 120), width=4)
    d.rectangle([20, 20, w - 20, 120], fill=(30, 55, 120))
    d.text((50, 45), s["bank"].upper(), font=font("bold", 44), fill="white")
    d.text((w - 430, 60), f"Branch: {s['branch']}", font=font("regular", 22), fill="white")
    d.text((50, 145), "FIXED DEPOSIT RECEIPT", font=font("bold", 36), fill=(30, 55, 120))
    d.text((w - 360, 150), "NON-TRANSFERABLE", font=font("regular", 22), fill=(110, 110, 110))

    label, value = font("regular", 28), font("bold", 30)
    issue, maturity = (
        fmt_date(s["issue"], s["date_style"]),
        fmt_date(s["maturity"], s["date_style"]),
    )
    rows = [
        ("FDR No.", s["fdr"]),
        ("IFSC", s["ifsc"]),
        ("In the name(s) of", " & ".join(n.upper() for n in s["names"])),
        ("Principal Amount (Rs.)", inr(s["amount"])),
        ("Date of Issue", issue),
        ("Maturity Date", maturity),
        ("Rate of Interest", f"{rnd.choice(['6.50', '6.75', '7.00', '7.10'])}% p.a."),
    ]
    y = 225
    for k, v in rows:
        d.text((60, y), f"{k}:", font=label, fill=(60, 60, 60))
        d.text((480, y), v, font=value, fill=(10, 10, 10))
        y += 62
    if s["lien"]:
        d.rectangle([w - 520, 640, w - 60, 740], outline=(160, 20, 20), width=4)
        d.text(
            (w - 500, 655), "LIEN MARKED IN FAVOUR OF", font=font("bold", 24), fill=(160, 20, 20)
        )
        d.text((w - 500, 695), "AICTE, NEW DELHI", font=font("bold", 26), fill=(160, 20, 20))
    d.text((60, h - 90), "Authorised Signatory", font=font("regular", 22), fill=(90, 90, 90))
    d.line([60, h - 100, 360, h - 100], fill=(90, 90, 90), width=2)

    # Watermark: fictional specimen.
    wm = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(wm).text(
        (300, 420), "SPECIMEN · FICTIONAL", font=font("bold", 90), fill=(200, 30, 30, 40)
    )
    img = Image.alpha_composite(img.convert("RGBA"), wm.rotate(18, center=(w / 2, h / 2))).convert(
        "RGB"
    )

    # A little scan noise and skew.
    img = img.rotate(rnd.uniform(-0.8, 0.8), expand=False, fillcolor=(252, 250, 243))
    noise = Image.effect_noise((w, h), 8).convert("RGB")
    img = Image.blend(img, noise, 0.04).filter(ImageFilter.GaussianBlur(0.4))
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    rnd = random.Random(26265)
    manifest = []
    for i, s in enumerate(SAMPLES, start=1):
        name = f"sample-{i:02d}.jpg"
        render(s, i, rnd).save(OUT / name, quality=85, optimize=True)
        manifest.append(
            {
                "file": name,
                "expected": {
                    "fdr_number": s["fdr"],
                    "bank_name": s["bank"],
                    "bank_code": s["code"],
                    "ifsc": s["ifsc"],
                    "amount": float(s["amount"]),
                    "issue_date": s["issue"],
                    "maturity_date": s["maturity"],
                    "depositor_names": [n.upper() for n in s["names"]],
                    "lien_marked": s["lien"],
                },
            }
        )
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"wrote {len(manifest)} samples to {OUT}")


if __name__ == "__main__":
    main()
