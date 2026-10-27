from app.extract import Line, extract_fields, parse_amount, parse_date


def lines(*texts: str, conf: float = 0.99) -> list[Line]:
    return [Line(t, conf) for t in texts]


def test_parse_date_formats() -> None:
    assert parse_date("31/03/2031") == "2031-03-31"
    assert parse_date("05-01-2030") == "2030-01-05"
    assert parse_date("05.01.2030") == "2030-01-05"
    assert parse_date("15 Jul 2030") == "2030-07-15"
    assert parse_date("15-JULY-2030") == "2030-07-15"
    assert parse_date("2030-07-15") == "2030-07-15"
    assert parse_date("31/02/2030") is None
    assert parse_date("not a date") is None


def test_parse_amount_indian_grouping() -> None:
    assert parse_amount("15,00,000.00") == 1500000.0
    assert parse_amount("0") is None


def test_labelled_fields() -> None:
    ex = extract_fields(
        lines(
            "STATE BANK OF INDIA",
            "FIXED DEPOSIT RECEIPT NON-TRANSFERABLE",
            "FDR No.: SBI/FD/2026/104211",
            "IFSC: SBIN0005943",
            "In the name(s) of: AICTE & SHIKSHA PRASAR TRUST IEN",
            "Principal Amount (Rs.): 10,00,000.00",
            "Date of Issue: 01/04/2026",
            "Maturity Date: 01/04/2031",
        )
    ).to_contract()
    f = ex["fields"]
    assert f["fdr_number"] == "SBI/FD/2026/104211"
    assert f["ifsc"] == "SBIN0005943"
    assert f["bank_name"] == "State Bank Of India"
    assert f["amount"] == 1000000.0
    assert f["issue_date"] == "2026-04-01"
    assert f["maturity_date"] == "2031-04-01"
    assert f["depositor_names"] == ["AICTE", "SHIKSHA PRASAR TRUST"]
    assert all(c > 0.9 for c in ex["confidence"].values())


def test_value_on_next_line_and_unlabelled_fallbacks() -> None:
    ex = extract_fields(
        lines(
            "HDFC0001234",
            "Deposit Number:",
            "50300123456789",
            "Rs. 5,00,000",
            "10 Jan 2024",
            "10 Jan 2029",
        )
    ).to_contract()
    f, c = ex["fields"], ex["confidence"]
    assert f["fdr_number"] == "50300123456789"
    assert f["bank_name"] == "Hdfc Bank" or f["bank_name"].upper() == "HDFC BANK"
    assert f["amount"] == 500000.0 and c["amount"] < 0.8  # unlabelled → flagged for review
    assert (f["issue_date"], f["maturity_date"]) == ("2024-01-10", "2029-01-10")


def test_low_ocr_confidence_lowers_field_confidence() -> None:
    ex = extract_fields(lines("FDR No.: AB12345", conf=0.6)).to_contract()
    assert ex["confidence"]["fdr_number"] < 0.8


def test_missing_fields_are_null() -> None:
    ex = extract_fields(lines("hello world")).to_contract()
    assert all(v is None for v in ex["fields"].values())
