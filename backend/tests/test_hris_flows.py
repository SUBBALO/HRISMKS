"""End-to-end backend tests for HRIS MKS (NEW DESIGN — no portal PIN).

Focus: Gaji PIN reset bug-fix verification. After susanto approves reset,
herliana can create a NEW Gaji PIN WITHOUT the old PIN.
"""
import os
import pytest
import requests

BASE = (os.environ.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
if not BASE:
    with open("/app/frontend/.env") as f:
        for ln in f:
            if ln.startswith("REACT_APP_BACKEND_URL="):
                BASE = ln.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE}/api"
XLSX = "/tmp/gaji.xlsx"

SU_USER, SU_PASS = "susanto", "Subbalo1994"
HER_USER, HER_PASS = "herliana", "123456"
HERI_USER, HERI_PASS = "heri", "123456"


def _login(username, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"username": username, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {username} -> {r.status_code} {r.text}"
    return s, r.json()


# ---------- Health / Auth ----------
def test_health():
    r = requests.get(f"{API}/health", timeout=10)
    assert r.status_code == 200


def test_login_three_users():
    for u, p in [(SU_USER, SU_PASS), (HER_USER, HER_PASS), (HERI_USER, HERI_PASS)]:
        s, data = _login(u, p)
        assert data["username"] == u
        me = s.get(f"{API}/auth/me").json()
        assert me["username"] == u


def test_login_wrong_password():
    r = requests.post(f"{API}/auth/login",
                      json={"username": HER_USER, "password": "wrongpw"}, timeout=10)
    assert r.status_code in (401, 429)


# ---------- No Portal PIN — herliana/heri go straight into HRD ----------
@pytest.fixture(scope="module")
def herliana_sess():
    s, _ = _login(HER_USER, HER_PASS)
    return s


@pytest.fixture(scope="module")
def heri_sess():
    s, _ = _login(HERI_USER, HERI_PASS)
    return s


@pytest.fixture(scope="module")
def susanto_sess():
    s, _ = _login(SU_USER, SU_PASS)
    return s


def test_herliana_no_portal_pin_required(herliana_sess):
    """my-access & pin-status callable without any portal PIN token."""
    r = herliana_sess.get(f"{API}/hrd/my-access")
    assert r.status_code == 200
    d = r.json()
    assert d["can_enter"] is True
    assert d["can_manage_gaji_pin"] is True
    # Herliana sees all 5 menus with view
    for m in ["hrd_karyawan", "hrd_slip_gaji", "hrd_email", "hrd_settings", "hrd_dokumen"]:
        assert d["access"][m]["view"] is True, m


def test_heri_no_portal_pin_and_no_gaji(heri_sess):
    r = heri_sess.get(f"{API}/hrd/my-access")
    assert r.status_code == 200
    d = r.json()
    assert d["can_enter"] is True
    assert d["can_manage_gaji_pin"] is False
    assert d["access"]["hrd_dokumen"]["view"] is True
    for gm in ["hrd_karyawan", "hrd_slip_gaji", "hrd_email", "hrd_settings"]:
        assert d["access"][gm]["view"] is False, gm


def test_susanto_no_gaji_access(susanto_sess):
    """Super admin susanto sees non-gaji menus but NOT gaji."""
    r = susanto_sess.get(f"{API}/hrd/my-access")
    assert r.status_code == 200
    d = r.json()
    assert d["is_super"] is True
    assert d["can_approve_reset"] is True
    assert d["can_manage_gaji_pin"] is False
    # gaji group menus should NOT be effective True (has_perm returns False for super)
    for gm in ["hrd_karyawan", "hrd_slip_gaji", "hrd_email", "hrd_settings"]:
        assert d["access"][gm]["view"] is False, gm
    # Non-gaji True
    assert d["access"]["hrd_dokumen"]["view"] is True


# ---------- Access enforcement: heri & susanto blocked from gaji endpoints ----------
def test_heri_403_gaji_endpoints(heri_sess):
    for path in ["/hrd/employees", "/hrd/payslips", "/hrd/settings"]:
        r = heri_sess.get(f"{API}{path}")
        assert r.status_code == 403, f"{path}: {r.status_code}"


def test_susanto_403_gaji_endpoints(susanto_sess):
    for path in ["/hrd/employees", "/hrd/payslips", "/hrd/settings"]:
        r = susanto_sess.get(f"{API}{path}")
        assert r.status_code == 403, f"{path}: {r.status_code}"


def test_heri_cannot_set_gaji_pin(heri_sess):
    r = heri_sess.post(f"{API}/hrd/set-pin", json={"pin": "9999"})
    assert r.status_code == 403


def test_susanto_cannot_set_gaji_pin(susanto_sess):
    r = susanto_sess.post(f"{API}/hrd/set-pin", json={"pin": "9999"})
    assert r.status_code == 403


# ---------- Gaji PIN: initial create by herliana (no old PIN) ----------
def test_a_herliana_create_initial_gaji_pin(herliana_sess):
    st = herliana_sess.get(f"{API}/hrd/pin-status").json()
    assert st["gaji_pin_set"] is False, "expected clean state — no gaji PIN set"
    r = herliana_sess.post(f"{API}/hrd/set-pin", json={"pin": "5678"})
    assert r.status_code == 200, r.text
    # Verify PIN
    v = herliana_sess.post(f"{API}/hrd/verify-pin", json={"pin": "5678"})
    assert v.status_code == 200
    herliana_sess.headers.update({"x-hrd-gaji": v.json()["gaji_token"]})


def test_b_herliana_wrong_pin_verify(herliana_sess):
    """Verify wrong PIN returns 401 (frontend then shows 'Ajukan Reset PIN')."""
    # Fresh session without gaji header shouldn't matter, verify doesn't require it
    fresh, _ = _login(HER_USER, HER_PASS)
    v = fresh.post(f"{API}/hrd/verify-pin", json={"pin": "0000"})
    assert v.status_code == 401


# ---------- RESET FLOW: herliana requests → susanto approves → herliana sets new PIN ----------
def test_c_herliana_request_reset(herliana_sess):
    r = herliana_sess.post(f"{API}/hrd/gaji-pin/request-reset",
                            json={"reason": "lupa PIN — test"})
    assert r.status_code == 200, r.text


def test_d_susanto_sees_pending_and_approves(susanto_sess):
    lst = susanto_sess.get(f"{API}/hrd/gaji-pin/reset-requests").json()
    assert lst["count"] >= 1
    req_id = lst["items"][0]["id"]
    r = susanto_sess.post(f"{API}/hrd/gaji-pin/approve-reset",
                          json={"request_id": req_id})
    assert r.status_code == 200, r.text
    assert r.json()["approved"] >= 1


def test_e_herliana_sees_reset_approved(herliana_sess):
    d = herliana_sess.get(f"{API}/hrd/my-access").json()
    assert d["gaji_reset_approved"] is True


def test_f_BUGFIX_herliana_creates_new_pin_without_old(herliana_sess):
    """BUG FIX under test: after approved reset, set-pin (or reset-apply) must
    succeed WITHOUT current_pin — previously returned 'PIN Gaji lama salah'."""
    # Path 1: /hrd/gaji-pin/reset-apply — the frontend's ResetApplyDialog path
    r = herliana_sess.post(f"{API}/hrd/gaji-pin/reset-apply", json={"pin": "4321"})
    assert r.status_code == 200, f"reset-apply failed: {r.status_code} {r.text}"
    # No lingering approved after apply
    d = herliana_sess.get(f"{API}/hrd/my-access").json()
    assert d["gaji_reset_approved"] is False
    # Old PIN must NOT work anymore
    v_old = herliana_sess.post(f"{API}/hrd/verify-pin", json={"pin": "5678"})
    assert v_old.status_code == 401
    # New PIN unlocks
    v_new = herliana_sess.post(f"{API}/hrd/verify-pin", json={"pin": "4321"})
    assert v_new.status_code == 200, v_new.text
    herliana_sess.headers.update({"x-hrd-gaji": v_new.json()["gaji_token"]})


def test_g_BUGFIX_alt_setpin_path_after_reset():
    """Also verify /hrd/set-pin bypasses old-PIN when reset approved (alternate code path)."""
    # Fresh cycle: request → approve → set-pin (no current_pin)
    her, _ = _login(HER_USER, HER_PASS)
    sus, _ = _login(SU_USER, SU_PASS)
    r = her.post(f"{API}/hrd/gaji-pin/request-reset", json={"reason": "alt test"})
    assert r.status_code == 200, r.text
    ap = sus.post(f"{API}/hrd/gaji-pin/approve-reset", json={})
    assert ap.status_code == 200, ap.text
    # NOTE: /hrd/set-pin without current_pin — this used to fail with 'PIN Gaji lama salah'
    sp = her.post(f"{API}/hrd/set-pin", json={"pin": "7777"})
    assert sp.status_code == 200, f"set-pin failed: {sp.status_code} {sp.text}"
    v = her.post(f"{API}/hrd/verify-pin", json={"pin": "7777"})
    assert v.status_code == 200
    # restore back to 4321 to keep herliana_sess valid
    ch = her.post(f"{API}/hrd/set-pin", json={"pin": "4321", "current_pin": "7777"})
    assert ch.status_code == 200


# ---------- Normal change with old PIN ----------
def test_h_herliana_change_pin_requires_old(herliana_sess):
    # wrong old
    r = herliana_sess.post(f"{API}/hrd/set-pin",
                            json={"pin": "1111", "current_pin": "0000"})
    assert r.status_code == 400
    # correct old
    r2 = herliana_sess.post(f"{API}/hrd/set-pin",
                             json={"pin": "4321", "current_pin": "4321"})
    assert r2.status_code == 200


# ---------- Excel import & PDF (needs gaji token) ----------
def test_i_excel_import_and_take_home(herliana_sess):
    # ensure gaji header
    v = herliana_sess.post(f"{API}/hrd/verify-pin", json={"pin": "4321"})
    assert v.status_code == 200
    herliana_sess.headers.update({"x-hrd-gaji": v.json()["gaji_token"]})
    with open(XLSX, "rb") as f:
        files = {"file": ("gaji.xlsx", f,
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = herliana_sess.post(f"{API}/hrd/payslips/import-excel",
                                data={"month": 8, "year": 2025},
                                files=files, timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    assert len(d["sheets"]) == 5, f"sheets={d['sheets']}"
    assert (d["created"] + d["updated"]) == 5
    lst = herliana_sess.get(f"{API}/hrd/payslips",
                             params={"month": 8, "year": 2025}).json()["items"]
    wawan = [p for p in lst if "wawan" in (p.get("nama") or "").lower()]
    assert wawan, "wawan slip not found"
    assert int(wawan[0]["take_home"]) == 8_138_000, \
        f"wawan take_home = {wawan[0]['take_home']}"


def test_j_pdf_endpoint(herliana_sess):
    lst = herliana_sess.get(f"{API}/hrd/payslips",
                             params={"month": 8, "year": 2025}).json()["items"]
    assert lst
    sid = lst[0]["id"]
    r = herliana_sess.get(f"{API}/hrd/payslips/{sid}/pdf")
    assert r.status_code == 200
    assert "application/pdf" in r.headers.get("content-type", "")
    assert r.content[:4] == b"%PDF"


# ---------- Super admin: user management ----------
def test_k_susanto_list_users(susanto_sess):
    r = susanto_sess.get(f"{API}/users")
    assert r.status_code == 200
    unames = {u["username"] for u in r.json()}
    assert {"susanto", "herliana", "heri"}.issubset(unames)


def test_l_non_super_cannot_list_users(herliana_sess):
    r = herliana_sess.get(f"{API}/users")
    assert r.status_code == 403


def test_m_susanto_menu_defs(susanto_sess):
    r = susanto_sess.get(f"{API}/hrd/menu-defs")
    assert r.status_code == 200
    assert len(r.json()["menus"]) == 5
