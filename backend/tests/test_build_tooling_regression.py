"""Iteration 4 regression suite — build/tooling change only (craco crypto polyfill + .yarnrc).

Confirms no functional regression: auth login (herliana), PIN Gaji unlock,
Excel import of gaji_trial.xlsx for 10/2026 (3 slips w/ email), payslip list,
slip PDF for Rahmat containing 'T. Transport', bulk delete.
Also static checks on frontend/craco.config.js + .yarnrc.
"""
import io
import os
import re
import subprocess

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"

MONTH, YEAR = 10, 2026
TRIAL_FILE = "/app/backend/tmp_uploads/gaji_trial.xlsx"
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
EXPECTED = ("Wawan", "Harjono", "Rahmat")


# ---------------- fixtures ----------------
@pytest.fixture(scope="module")
def plain_client():
    s = requests.Session()
    return s


@pytest.fixture(scope="module")
def gaji_client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"username": "herliana", "password": "123456"}, timeout=60)
    if r.status_code != 200:
        pytest.fail(f"Login failed {r.status_code}: {r.text[:300]}")
    body = r.json()
    tok = body.get("access_token") or body.get("token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    p = s.post(f"{API}/hrd/verify-pin", json={"pin": "1234"}, timeout=60)
    if p.status_code != 200:
        pytest.fail(f"verify-pin failed {p.status_code}: {p.text[:300]}")
    gt = p.json().get("gaji_token")
    assert gt, f"no gaji_token: {p.text[:300]}"
    s.headers.update({"x-hrd-gaji": gt})
    return s


def _list(client, month=MONTH, year=YEAR):
    r = client.get(f"{API}/hrd/payslips", params={"month": month, "year": year}, timeout=60)
    assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
    payload = r.json()
    return payload if isinstance(payload, list) else payload.get("items", payload.get("data", []))


def _find(items, needle):
    return next((x for x in items if needle in str(x.get("nama", ""))), None)


# ---------------- auth ----------------
class TestAuth:
    def test_login_herliana(self, plain_client):
        r = plain_client.post(f"{API}/auth/login",
                              json={"username": "herliana", "password": "123456"}, timeout=60)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        d = r.json()
        user = d.get("user") or d
        assert user.get("username") == "herliana", d
        assert user.get("role") == "hrd", d
        assert "_id" not in user, "MongoDB _id leaked in login response"

    def test_login_wrong_password(self, plain_client):
        r = plain_client.post(f"{API}/auth/login",
                              json={"username": "herliana", "password": "wrong-pass"}, timeout=60)
        assert r.status_code in (400, 401), f"{r.status_code}: {r.text[:200]}"

    def test_me_requires_auth(self):
        r = requests.get(f"{API}/auth/me", timeout=30)
        assert r.status_code in (401, 403), f"{r.status_code}: {r.text[:200]}"

    def test_me_authenticated(self, gaji_client):
        r = gaji_client.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        assert r.json().get("username") == "herliana", r.text[:200]


class TestPinGuard:
    def test_payslips_without_pin_token_blocked(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"username": "herliana", "password": "123456"}, timeout=60)
        assert r.status_code == 200
        tok = r.json().get("access_token") or r.json().get("token")
        if tok:
            s.headers.update({"Authorization": f"Bearer {tok}"})
        r2 = s.get(f"{API}/hrd/payslips", params={"month": MONTH, "year": YEAR}, timeout=60)
        assert r2.status_code in (401, 403), f"expected block, got {r2.status_code}: {r2.text[:200]}"

    def test_wrong_pin_rejected(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"username": "herliana", "password": "123456"}, timeout=60)
        tok = r.json().get("access_token") or r.json().get("token")
        if tok:
            s.headers.update({"Authorization": f"Bearer {tok}"})
        r2 = s.post(f"{API}/hrd/verify-pin", json={"pin": "9999"}, timeout=60)
        assert r2.status_code in (400, 401, 403), f"{r2.status_code}: {r2.text[:200]}"


# ---------------- payroll import regression ----------------
class TestPayrollImportRegression:
    def test_import_gaji_trial_10_2026(self, gaji_client):
        if not os.path.exists(TRIAL_FILE):
            pytest.skip(f"missing {TRIAL_FILE}")
        with open(TRIAL_FILE, "rb") as f:
            content = f.read()
        r = gaji_client.post(f"{API}/hrd/payslips/import-excel",
                             data={"month": MONTH, "year": YEAR},
                             files={"file": ("gaji_trial.xlsx", content, XLSX_MIME)}, timeout=180)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:600]}"
        d = r.json()
        assert d.get("success") is True, d
        assert (d.get("created", 0) + d.get("updated", 0)) == 3, d
        names = " | ".join(d.get("names", []))
        for n in EXPECTED:
            assert n in names, f"{n} missing in {names}"

    def test_slips_listed_with_email(self, gaji_client):
        items = _list(gaji_client)
        assert len(items) >= 3, f"expected >=3 slips for {MONTH}/{YEAR}, got {len(items)}"
        for n in EXPECTED:
            row = _find(items, n)
            assert row is not None, f"{n} not in list"
            assert "_id" not in row, "MongoDB _id leaked in payslip row"
            email = (row.get("email") or "").strip()
            assert email, f"{n} has EMPTY email (row={ {k: row.get(k) for k in ('nama', 'nik', 'email')} })"
            assert re.match(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$", email), f"{n} invalid email {email!r}"
            assert row.get("id"), f"{n} missing id"

    def test_pdf_rahmat_contains_t_transport(self, gaji_client):
        row = _find(_list(gaji_client), "Rahmat")
        assert row is not None, "Rahmat slip missing"
        r = gaji_client.get(f"{API}/hrd/payslips/{row['id']}/pdf", timeout=120)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        assert r.content[:4] == b"%PDF", "response is not a PDF"
        try:
            from pypdf import PdfReader
        except ImportError:
            try:
                from PyPDF2 import PdfReader
            except ImportError:
                pytest.skip("no pdf reader lib")
        text = "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(r.content)).pages)
        assert "Transport" in text, f"'T. Transport' missing: {text[:600]}"
        assert "Rahmat" in text, "employee name missing in PDF"

    def test_bulk_delete_cleanup_10_2026(self, gaji_client):
        items = _list(gaji_client)
        ids = [x["id"] for x in items]
        assert ids, "nothing to delete"
        r = gaji_client.post(f"{API}/hrd/payslips/bulk-delete", json={"ids": ids}, timeout=60)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        assert r.json().get("deleted") == len(ids), r.json()
        assert _list(gaji_client) == [] or not (set(ids) & {x["id"] for x in _list(gaji_client)})


# ---------------- build tooling static checks ----------------
class TestBuildTooling:
    def test_craco_config_loads_on_current_node(self):
        r = subprocess.run(
            ["node", "-e",
             "process.env.NODE_ENV='production';require('/app/frontend/craco.config.js');"
             "console.log(typeof globalThis.crypto.getRandomValues)"],
            cwd="/app/frontend", capture_output=True, text=True, timeout=120)
        assert r.returncode == 0, f"craco.config.js failed to load: {r.stderr[-800:]}"
        assert "function" in r.stdout, r.stdout

    def test_polyfill_guarded_and_yarnrc(self):
        src = open("/app/frontend/craco.config.js").read()
        assert "webcrypto" in src and "typeof globalThis.crypto" in src, "polyfill guard missing"
        yrc = open("/app/frontend/.yarnrc").read()
        assert "--ignore-engines true" in yrc, yrc
