"""Iteration 6 regression:
Ensure Gaji PIN a user sets persists across re-login and is only rejected on
genuinely wrong PIN. Also verifies access segregation for the Data Gaji card.

End-of-run invariant (critical): hrd_settings.pin_hash MUST be unset and
hrd_pin_resets must have no pending/approved rows so the real user gets the
CREATE dialog next time.
"""
import os
import requests
import pytest
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
TEST_PIN = "7788"


def _login(username, password):
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"username": username, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {username} failed: {r.text}"
    return s


def _my_access(sess):
    r = sess.get(f"{BASE}/api/hrd/my-access", timeout=30)
    assert r.status_code == 200
    return r.json()


def _mongo():
    from pymongo import MongoClient
    m = MongoClient(os.environ["MONGO_URL"])
    return m[os.environ["DB_NAME"]]


def _reset_state():
    db = _mongo()
    db.hrd_settings.update_one(
        {"_id": "hrd"},
        {"$unset": {"pin_hash": "", "pin_updated_at": ""}},
    )
    db.hrd_pin_resets.delete_many({})


# ---------------------------------------------------------------------------
# Backend: PIN create -> verify -> re-login persistence -> wrong pin
# ---------------------------------------------------------------------------

def test_00_initial_state_pin_cleared():
    _reset_state()
    sess = _login("herliana", "123456")
    ma = _my_access(sess)
    assert ma["gaji_pin_set"] is False, f"expected gaji_pin_set=False, got {ma}"
    assert ma["gaji_reset_pending"] == 0
    assert ma["gaji_reset_approved"] is False


def test_01_set_pin_and_verify():
    sess = _login("herliana", "123456")
    r = sess.post(f"{BASE}/api/hrd/set-pin", json={"pin": TEST_PIN})
    assert r.status_code == 200, r.text

    ma = _my_access(sess)
    assert ma["gaji_pin_set"] is True

    r = sess.post(f"{BASE}/api/hrd/verify-pin", json={"pin": TEST_PIN})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("gaji_token"), body


def test_02_pin_persists_across_relogin():
    # Simulate a brand new browser session
    sess = _login("herliana", "123456")
    ma = _my_access(sess)
    assert ma["gaji_pin_set"] is True, "PIN should persist across re-login"

    r = sess.post(f"{BASE}/api/hrd/verify-pin", json={"pin": TEST_PIN})
    assert r.status_code == 200, r.text
    assert r.json().get("gaji_token")


def test_03_wrong_pin_rejected_no_reset_triggered():
    sess = _login("herliana", "123456")
    r = sess.post(f"{BASE}/api/hrd/verify-pin", json={"pin": "0000"})
    assert r.status_code == 401
    detail = (r.json().get("detail") or "").lower()
    assert "salah" in detail or "pin" in detail, r.text

    ma = _my_access(sess)
    assert ma["gaji_pin_set"] is True  # still set, not auto-reset
    assert ma["gaji_reset_approved"] is False


# ---------------------------------------------------------------------------
# Access segregation for Data Gaji
# ---------------------------------------------------------------------------

def test_04_heri_cannot_access_payslips():
    sess = _login("heri", "123456")
    ma = _my_access(sess)
    assert ma.get("can_manage_gaji_pin") is False
    r = sess.get(f"{BASE}/api/hrd/payslips", timeout=30)
    assert r.status_code == 403, r.text


def test_05_susanto_cannot_access_payslips_without_gaji_token():
    # susanto is super_admin but Data Gaji is HRD-only per business rule
    sess = _login("susanto", "Subbalo1994")
    r = sess.get(f"{BASE}/api/hrd/payslips", timeout=30)
    # 403 expected (either from role gate or missing gaji_token)
    assert r.status_code in (401, 403), r.text


def test_06_herliana_with_gaji_token_can_list_payslips():
    sess = _login("herliana", "123456")
    r = sess.post(f"{BASE}/api/hrd/verify-pin", json={"pin": TEST_PIN})
    assert r.status_code == 200
    token = r.json()["gaji_token"]
    r = sess.get(f"{BASE}/api/hrd/payslips", headers={"x-hrd-gaji": token}, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    # Accept either bare list or {items: [...]} depending on endpoint version
    if isinstance(body, dict):
        assert "items" in body and isinstance(body["items"], list)
    else:
        assert isinstance(body, list)


# ---------------------------------------------------------------------------
# Final teardown: leave PIN CLEARED for real user
# ---------------------------------------------------------------------------

def test_99_final_cleanup_pin_cleared():
    _reset_state()
    db = _mongo()
    doc = db.hrd_settings.find_one({"_id": "hrd"}) or {}
    assert "pin_hash" not in doc, f"pin_hash must be unset, got: {doc}"
    assert "pin_updated_at" not in doc
    remaining = list(db.hrd_pin_resets.find({"status": {"$in": ["pending", "approved"]}}))
    assert remaining == [], f"expected no pending/approved resets, got {remaining}"

    # Confirm via API surface as well
    sess = _login("herliana", "123456")
    ma = _my_access(sess)
    assert ma["gaji_pin_set"] is False
    assert ma["gaji_reset_pending"] == 0
    assert ma["gaji_reset_approved"] is False
