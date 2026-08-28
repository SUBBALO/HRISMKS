"""Regression: 'Herliana selalu reset PIN'.
Ensures:
- Opening Data Gaji does NOT force reset; PIN persists.
- set-pin clears any pending/approved reset requests.
- reset-apply flow works when explicitly requested.
- my-access flags reflect a clean state after set-pin.
"""
import os
import requests
import pytest
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


def _login(username, password):
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"username": username, "password": password}, timeout=30)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def herliana():
    return _login("herliana", "123456")


@pytest.fixture(scope="module")
def susanto():
    return _login("susanto", "Subbalo1994")


def _my_access(sess):
    r = sess.get(f"{BASE}/api/hrd/my-access", timeout=30)
    assert r.status_code == 200
    return r.json()


def _reset_state():
    # Ensure fresh: clear pin + resolve pending resets via direct set-pin path is not possible when pin is not known.
    # Use pymongo through env; else rely on set-pin (needs current_pin). We use Mongo directly.
    from pymongo import MongoClient
    m = MongoClient(os.environ["MONGO_URL"])
    m[os.environ["DB_NAME"]].hrd_settings.update_one({"_id": "hrd"}, {"$unset": {"pin_hash": ""}})
    m[os.environ["DB_NAME"]].hrd_pin_resets.update_many(
        {"status": {"$in": ["pending", "approved"]}}, {"$set": {"status": "resolved"}}
    )


def test_00_clean_state(herliana):
    _reset_state()
    ma = _my_access(herliana)
    assert ma["gaji_pin_set"] is False
    assert ma["gaji_reset_pending"] == 0
    assert ma["gaji_reset_approved"] is False


def test_01_create_pin_1111_and_verify(herliana):
    r = herliana.post(f"{BASE}/api/hrd/set-pin", json={"pin": "1111"})
    assert r.status_code == 200, r.text
    ma = _my_access(herliana)
    assert ma["gaji_pin_set"] is True
    # verify-pin returns gaji_token
    r = herliana.post(f"{BASE}/api/hrd/verify-pin", json={"pin": "1111"})
    assert r.status_code == 200
    assert r.json().get("gaji_token")


def test_02_wrong_pin_rejected_but_no_reset(herliana):
    r = herliana.post(f"{BASE}/api/hrd/verify-pin", json={"pin": "0000"})
    assert r.status_code == 401
    ma = _my_access(herliana)
    # PIN still set, no auto reset triggered
    assert ma["gaji_pin_set"] is True
    assert ma["gaji_reset_approved"] is False


def test_03_reset_flow_end_to_end(herliana, susanto):
    # Herliana requests reset
    r = herliana.post(f"{BASE}/api/hrd/gaji-pin/request-reset", json={"reason": "lupa"})
    assert r.status_code == 200
    req_id = r.json()["request_id"]

    # Susanto sees pending
    ma_s = _my_access(susanto)
    assert ma_s["gaji_reset_pending"] >= 1

    # Approve
    r = susanto.post(f"{BASE}/api/hrd/gaji-pin/approve-reset", json={"request_id": req_id})
    assert r.status_code == 200

    ma_h = _my_access(herliana)
    assert ma_h["gaji_reset_approved"] is True

    # Apply new PIN without providing old pin
    r = herliana.post(f"{BASE}/api/hrd/gaji-pin/reset-apply", json={"pin": "2222"})
    assert r.status_code == 200, r.text

    # After apply: banners must be gone (no leftover pending/approved)
    ma_h = _my_access(herliana)
    assert ma_h["gaji_reset_approved"] is False, ma_h
    assert ma_h["gaji_reset_pending"] == 0, ma_h
    ma_s = _my_access(susanto)
    assert ma_s["gaji_reset_pending"] == 0, ma_s

    # New PIN 2222 verifies
    r = herliana.post(f"{BASE}/api/hrd/verify-pin", json={"pin": "2222"})
    assert r.status_code == 200
    assert r.json().get("gaji_token")


def test_04_change_pin_normal_clears_stale_resets(herliana, susanto):
    # Create a pending reset first
    r = herliana.post(f"{BASE}/api/hrd/gaji-pin/request-reset", json={"reason": "test-stale"})
    assert r.status_code == 200

    # Herliana changes PIN normally with current_pin (still 2222 -> 3333)
    r = herliana.post(f"{BASE}/api/hrd/set-pin", json={"pin": "3333", "current_pin": "2222"})
    assert r.status_code == 200, r.text

    ma_h = _my_access(herliana)
    assert ma_h["gaji_reset_pending"] == 0
    assert ma_h["gaji_reset_approved"] is False

    # Restore to a known final PIN for handoff = 1111
    r = herliana.post(f"{BASE}/api/hrd/set-pin", json={"pin": "1111", "current_pin": "3333"})
    assert r.status_code == 200
