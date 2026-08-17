"""Tests for BOSS 'asiong' multi-group payroll access (karyawan + staff, no PIN)."""
import os
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or "https://hris-sarana.preview.emergentagent.com"


def _login(username: str, password: str) -> requests.Session:
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"username": username, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {username}: {r.status_code} {r.text}"
    return s


# ---------- Boss login & scope ----------
class TestBossAccess:
    def test_boss_login(self):
        s = _login("asiong", "asiong123")
        me = s.get(f"{BASE}/api/auth/me", timeout=15)
        assert me.status_code == 200
        data = me.json()
        assert data.get("username") == "asiong"
        assert data.get("role") == "hrd"

    def test_boss_my_access(self):
        s = _login("asiong", "asiong123")
        r = s.get(f"{BASE}/api/hrd/my-access", timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("is_boss") is True
        assert set(d.get("payroll_groups") or []) == {"karyawan", "staff"}
        assert d.get("can_manage_gaji_pin") is False
        assert d.get("can_enter") is True

    def test_boss_payslips_karyawan_no_pin(self):
        s = _login("asiong", "asiong123")
        r = s.get(f"{BASE}/api/hrd/payslips",
                  params={"month": 8, "year": 2026},
                  headers={"x-payroll-group": "karyawan"}, timeout=20)
        assert r.status_code == 200, f"expected 200 without PIN, got {r.status_code} {r.text}"
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        # No soft-deleted leakage
        for it in items:
            assert not it.get("deleted_at"), f"soft-deleted slip leaked: {it.get('id')}"
        # Group scoping — nothing marked as 'staff'
        for it in items:
            pg = it.get("payroll_group")
            assert pg in (None, "karyawan"), f"cross-group leakage: {pg}"
        # Uniqueness by id
        ids = [it.get("id") for it in items]
        assert len(ids) == len(set(ids)), "duplicate slip ids for karyawan"

    def test_boss_payslips_staff_no_pin(self):
        s = _login("asiong", "asiong123")
        r = s.get(f"{BASE}/api/hrd/payslips",
                  headers={"x-payroll-group": "staff"}, timeout=20)
        assert r.status_code == 200, f"expected 200 without PIN, got {r.status_code} {r.text}"
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        for it in items:
            assert it.get("payroll_group") == "staff", f"non-staff leaked into staff: {it}"

    def test_boss_cannot_manage_pin(self):
        s = _login("asiong", "asiong123")
        # Boss should be rejected from creating/setting PIN
        r = s.post(f"{BASE}/api/hrd/set-pin", json={"pin": "9999"},
                   headers={"x-payroll-group": "karyawan"}, timeout=15)
        assert r.status_code == 403, f"boss should not manage PIN, got {r.status_code} {r.text}"


# ---------- Isolation preserved for others ----------
class TestOtherIsolation:
    def test_nofia_cannot_switch_to_karyawan(self):
        s = _login("nofia", "nofia123")
        r = s.get(f"{BASE}/api/hrd/my-access", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d.get("is_boss") is False
        assert d.get("payroll_groups") == ["staff"]

    def test_nofia_header_ignored_falls_back_to_staff(self):
        s = _login("nofia", "nofia123")
        # forge header — should fall back to staff (Nofia has PIN 4321 for staff)
        # Without PIN token, expect 401 PIN required (still gated), and definitely NOT 200 with karyawan data
        r = s.get(f"{BASE}/api/hrd/payslips",
                  headers={"x-payroll-group": "karyawan"}, timeout=15)
        # Either 401 (PIN required for staff group) or 200 with empty/staff-only data
        if r.status_code == 200:
            items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
            for it in items:
                assert it.get("payroll_group") == "staff", "cross-group leakage for Nofia"
        else:
            assert r.status_code == 401, f"unexpected {r.status_code} {r.text}"

    def test_heri_blocked_from_payroll(self):
        # Try both passwords
        for pw in ("heri123", "123456"):
            try:
                s = _login("heri", pw)
                break
            except AssertionError:
                s = None
        assert s is not None, "heri login failed with both passwords"
        r = s.get(f"{BASE}/api/hrd/payslips", timeout=15)
        assert r.status_code in (401, 403), f"heri should not access payroll, got {r.status_code}"

    def test_susanto_blocked_from_payroll(self):
        s = _login("susanto", "Subbalo1994")
        r = s.get(f"{BASE}/api/hrd/payslips", timeout=15)
        # super_admin has no HRD access -> 403
        assert r.status_code in (401, 403), f"susanto should not access payroll, got {r.status_code}"
