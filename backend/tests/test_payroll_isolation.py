"""Backend tests for payroll group isolation between 'karyawan' (Herliana) and 'staff' (Nofia).

ABSOLUTE CONSTRAINTS enforced by this suite:
- We DO NOT read/guess/set/reset Herliana's Gaji PIN.
- We only set Nofia's staff PIN (doc _id='hrd_staff') using value 4321.
- We do not mutate employee/payslip data.
"""
import os
import pytest
import requests

from dotenv import dotenv_values

_env = dotenv_values("/app/frontend/.env")
_base = os.environ.get("REACT_APP_BACKEND_URL") or _env.get("REACT_APP_BACKEND_URL")
if not _base:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = _base.rstrip("/")
API = f"{BASE_URL}/api"

NOFIA_PIN = "4321"


def _login(username: str, password: str) -> requests.Session:
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"username": username, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {username}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def nofia():
    return _login("nofia", "nofia123")


@pytest.fixture(scope="module")
def herliana():
    return _login("herliana", "123456")


# --- Access scope ---
class TestAccessScope:
    def test_nofia_my_access(self, nofia):
        r = nofia.get(f"{API}/hrd/my-access", timeout=30)
        assert r.status_code == 200, r.text
        acc = r.json().get("access") or {}
        assert (acc.get("hrd_slip_gaji") or {}).get("view") is True
        assert (acc.get("hrd_email") or {}).get("view") is True
        assert (acc.get("hrd_settings") or {}).get("view") is True
        assert (acc.get("hrd_dokumen") or {}).get("view") in (False, None)
        assert (acc.get("hrd_karyawan") or {}).get("view") in (False, None)


# --- PIN scoping / isolation ---
class TestPinIsolation:
    def test_herliana_pin_status_before(self, herliana):
        r = herliana.get(f"{API}/hrd/pin-status", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("gaji_pin_set") is True, "Herliana's karyawan PIN must already be set"

    def test_nofia_pin_status_can_manage(self, nofia):
        r = nofia.get(f"{API}/hrd/pin-status", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("can_manage_gaji_pin") is True
        # initial state may be true if a previous test iteration already set it; both acceptable
        assert "gaji_pin_set" in data

    def test_nofia_set_and_verify_pin(self, nofia):
        # Setting/replacing nofia's staff PIN. If already set, provide current_pin=NOFIA_PIN to allow re-set.
        r = nofia.post(f"{API}/hrd/set-pin", json={"pin": NOFIA_PIN, "current_pin": NOFIA_PIN}, timeout=30)
        # If not previously set, current_pin is ignored server-side
        if r.status_code == 400 and "PIN Gaji lama salah" in r.text:
            # Skip re-set if we don't know previous; try without current_pin (only works when unset)
            r = nofia.post(f"{API}/hrd/set-pin", json={"pin": NOFIA_PIN}, timeout=30)
        assert r.status_code == 200, f"set-pin failed: {r.status_code} {r.text}"

        v = nofia.post(f"{API}/hrd/verify-pin", json={"pin": NOFIA_PIN}, timeout=30)
        assert v.status_code == 200, v.text
        token = v.json().get("gaji_token")
        assert isinstance(token, str) and len(token) > 20
        # stash token on session for downstream tests
        nofia.headers.update({"x-hrd-gaji": token})

    def test_nofia_payslips_isolated_empty(self, nofia):
        assert "x-hrd-gaji" in nofia.headers, "requires previous set/verify"
        r = nofia.get(f"{API}/hrd/payslips", params={"month": 8, "year": 2026}, timeout=30)
        assert r.status_code == 200, r.text
        payload = r.json()
        # accept list or {items:[]}
        items = payload if isinstance(payload, list) else payload.get("items") or payload.get("payslips") or []
        assert isinstance(items, list)
        # Isolation check: no karyawan slips
        for it in items:
            grp = it.get("payroll_group")
            assert grp == "staff", f"Nofia received non-staff slip: payroll_group={grp} item={it}"
        # Also expected empty per problem statement
        assert len(items) == 0, f"Expected empty staff slip list, got {len(items)}"

    def test_herliana_pin_untouched(self, herliana):
        r = herliana.get(f"{API}/hrd/pin-status", timeout=30)
        assert r.status_code == 200
        assert r.json().get("gaji_pin_set") is True, "Herliana's karyawan PIN must remain set after nofia actions"

    def test_nofia_payroll_requires_gaji_token(self):
        # Fresh session without x-hrd-gaji
        s = _login("nofia", "nofia123")
        r = s.get(f"{API}/hrd/payslips", params={"month": 8, "year": 2026}, timeout=30)
        assert r.status_code == 401
        assert "PIN Gaji" in r.text or "diperlukan" in r.text
