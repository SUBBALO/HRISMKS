"""Diagnostic: does the sheet-wide email scan in _parse_slip_sheet pick up a
company/footer email and override the correct per-employee directory email?"""
import io
import os

import pytest
import requests
from dotenv import dotenv_values

from tests.test_payroll_email_import import _add_slip, XLSX_MIME, _find  # noqa

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"
MONTH, YEAR = 11, 2026


@pytest.fixture(scope="module")
def gaji_client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"username": "herliana", "password": "123456"}, timeout=30)
    assert r.status_code == 200, r.text[:300]
    tok = r.json().get("access_token") or r.json().get("token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    p = s.post(f"{API}/hrd/verify-pin", json={"pin": "1234"}, timeout=30)
    assert p.status_code == 200, p.text[:300]
    s.headers.update({"x-hrd-gaji": p.json()["gaji_token"]})
    return s


def _build():
    from openpyxl import Workbook
    wb = Workbook()
    d = wb.active
    d.title = "Daftar Gaji"
    d["A3"] = "NIK"; d["B3"] = "Nama"; d["C3"] = "Email"; d["D3"] = "Take Home Pay"
    d["A4"] = "MKS 9201"; d["B4"] = "TEST_Ivan Footer"; d["C4"] = "ivan.real@mks.co.id"; d["D4"] = 5398600
    ws = _add_slip(wb, "SlipIvan", "TEST_Ivan Footer", "MKS 9201")
    # typical printed-slip footer with company contact
    ws["A20"] = "Info: hrd@mitrakaryasarana.co.id"
    buf = io.BytesIO()
    wb.save(buf)
    data = buf.getvalue()
    with open("/app/backend/tmp_uploads/TEST_footer_email.xlsx", "wb") as f:
        f.write(data)
    return data


def test_footer_email_does_not_override_employee_email(gaji_client):
    r = gaji_client.post(f"{API}/hrd/payslips/import-excel", data={"month": MONTH, "year": YEAR},
                         files={"file": ("TEST_footer.xlsx", _build(), XLSX_MIME)}, timeout=120)
    assert r.status_code == 200, r.text[:400]
    items = gaji_client.get(f"{API}/hrd/payslips", params={"month": MONTH, "year": YEAR}, timeout=60).json()["items"]
    row = _find(items, "TEST_Ivan")
    assert row is not None
    got = (row.get("email") or "").lower()
    ids = [x["id"] for x in items if str(x.get("nama", "")).startswith("TEST_")]
    gaji_client.post(f"{API}/hrd/payslips/bulk-delete", json={"ids": ids}, timeout=60)
    assert got == "ivan.real@mks.co.id", f"employee email overridden by footer/company email -> {got!r}"
