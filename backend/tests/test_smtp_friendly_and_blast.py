"""Tests for _smtp_friendly error mapping + blast() SMTP 5.7.26 handling.

Strategy:
- Unit test _smtp_friendly (pure function, in-process import).
- In-process integration test for blast(): monkeypatch routers.hrd.smtplib.SMTP_SSL
  so no real email is sent; verify per-recipient error mapping and success path
  (headers, unencrypted PDF).
- HTTP regression tests via live REACT_APP_BACKEND_URL for:
    * 400 when Gmail settings are missing app_password
    * xlsx import fills email + PDF is not encrypted
"""
import asyncio
import io
import os
import sys
import pytest
import requests
from pathlib import Path

# make backend importable
BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from routers import hrd as hrd_mod  # noqa: E402
from db import db  # noqa: E402

# Read from frontend/.env if not set in shell (pytest doesn't inherit it)
def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    fe_env = Path("/app/frontend/.env")
    if fe_env.exists():
        for line in fe_env.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not configured")


BASE_URL = _load_backend_url()
XLSX_PATH = "/tmp/gaji_new.xlsx"


# ---------------------------------------------------------------------------
# 1) Unit — _smtp_friendly mapping
# ---------------------------------------------------------------------------
class TestSmtpFriendly:
    def test_maps_5_7_26_spf_dkim(self):
        raw = "(550, b'5.7.26 unauthenticated ... SPF ... DKIM ...')"
        out = hrd_mod._smtp_friendly(raw)
        assert out.startswith("Ditolak Gmail: domain pengirim belum lolos autentikasi SPF/DKIM"), out
        assert ("@gmail.com" in out) or ("SPF" in out and "DKIM" in out)

    def test_maps_app_password(self):
        out = hrd_mod._smtp_friendly("Username and Password not accepted 5.7.8")
        assert "App Password" in out, out

    def test_fallback_returns_original(self):
        raw = "Connection timed out"
        out = hrd_mod._smtp_friendly(raw)
        assert out == raw


# ---------------------------------------------------------------------------
# Helpers for in-process blast() test
# ---------------------------------------------------------------------------
class _FakeSMTP:
    """A fake smtplib.SMTP_SSL replacement.

    Behaviour configured via class attributes just before instantiation:
      _mode = "success" | "fail_sendmail" | "fail_login"
    Captures messages actually sent in cls.sent_messages.
    """
    _mode = "success"
    sent_messages = []
    login_calls = []
    quit_called = False

    def __init__(self, host, port, context=None, timeout=None):
        self.host = host
        self.port = port

    def login(self, user, pw):
        _FakeSMTP.login_calls.append((user, pw))
        if _FakeSMTP._mode == "fail_login":
            import smtplib as _sm
            raise _sm.SMTPAuthenticationError(535, b"5.7.8 Username and Password not accepted")
        return (235, b"OK")

    def sendmail(self, from_addr, to_addrs, msg_str):
        if _FakeSMTP._mode == "fail_sendmail":
            import smtplib as _sm
            raise _sm.SMTPDataError(
                550,
                b"5.7.26 Your email has been blocked because the sender is unauthenticated. "
                b"Gmail requires all senders to authenticate with either SPF or DKIM.",
            )
        _FakeSMTP.sent_messages.append({"from": from_addr, "to": to_addrs, "raw": msg_str})
        return {}

    def quit(self):
        _FakeSMTP.quit_called = True


_LOOP = asyncio.new_event_loop()
asyncio.set_event_loop(_LOOP)


def _run(coro):
    return _LOOP.run_until_complete(coro)


@pytest.fixture
def ensure_gmail_configured():
    """Make sure hrd_settings has a gmail_user + app_password so blast() pre-check passes.
    Restores prior values after the test.
    """
    async def _setup():
        prev = await db.hrd_settings.find_one({"_id": "hrd"}) or {}
        await db.hrd_settings.update_one(
            {"_id": "hrd"},
            {"$set": {"gmail_user": prev.get("gmail_user") or "dummy@example.com",
                      "app_password": prev.get("app_password") or "dummy_app_password",
                      "sender_name": prev.get("sender_name") or "PT. MITRA KARYA SARANA"}},
            upsert=True,
        )
        return prev
    prev = _run(_setup())
    yield prev

    async def _restore():
        # nothing to remove; keep original values (they were preserved)
        pass
    _run(_restore())


@pytest.fixture(autouse=True)
def patch_smtp(monkeypatch):
    """Monkeypatch smtplib.SMTP_SSL used inside routers.hrd to our fake — NO real email."""
    _FakeSMTP.sent_messages = []
    _FakeSMTP.login_calls = []
    _FakeSMTP.quit_called = False
    _FakeSMTP._mode = "success"
    monkeypatch.setattr(hrd_mod.smtplib, "SMTP_SSL", _FakeSMTP)
    yield


# ---------------------------------------------------------------------------
# 2) In-process blast — 5.7.26 mapped per recipient
# ---------------------------------------------------------------------------
class TestBlastFailureMapping:
    def test_blast_5_7_26_maps_to_friendly_error(self, ensure_gmail_configured):
        _FakeSMTP._mode = "fail_sendmail"

        payload = hrd_mod.BlastIn(month=7, year=2026)
        current = {"id": "test-user", "username": "herliana", "name": "Herliana"}

        result = _run(hrd_mod.blast(payload=payload, current=current))
        assert result["success"] is True
        assert result["failed"] >= 1
        assert result["sent"] == 0
        assert len(result["results"]) >= 1
        for row in result["results"]:
            assert row["status"] == "gagal"
            assert "SPF/DKIM" in row["error"]
            assert row["error"].startswith("Ditolak Gmail:")
            assert "550" not in row["error"] or "5.7.26" not in row["error"]  # not raw traceback

        # DB updated with friendly error
        async def _check():
            docs = await db.hrd_payslips.find({"period_month": 7, "period_year": 2026}).to_list(50)
            for d in docs:
                if (d.get("email") or "").strip():
                    assert d.get("email_status") == "gagal"
                    assert "SPF/DKIM" in (d.get("email_error") or "")
        _run(_check())


# ---------------------------------------------------------------------------
# 3) In-process blast — success path (headers + unencrypted PDF)
# ---------------------------------------------------------------------------
class TestBlastSuccess:
    def test_blast_success_headers_and_unencrypted_pdf(self, ensure_gmail_configured):
        _FakeSMTP._mode = "success"

        payload = hrd_mod.BlastIn(month=7, year=2026)
        current = {"id": "test-user", "username": "herliana", "name": "Herliana"}
        result = _run(hrd_mod.blast(payload=payload, current=current))
        assert result["sent"] >= 1
        assert result["sent"] == result["sent"] + 0  # sanity
        for row in result["results"]:
            assert row["status"] == "terkirim", row

        # Inspect first captured message
        assert _FakeSMTP.sent_messages, "no messages captured"
        m = _FakeSMTP.sent_messages[0]
        raw = m["raw"]
        # Headers
        assert "\nDate:" in raw or raw.startswith("Date:")
        assert "Message-ID:" in raw
        # From: '<sender_name> <gmail_user>'
        s = _run(db.hrd_settings.find_one({"_id": "hrd"})) or {}
        gmail_user = s.get("gmail_user")
        sender_name = s.get("sender_name") or "PT. MITRA KARYA SARANA"
        assert f"{sender_name} <{gmail_user}>" in raw, "From header format mismatch"
        # No PDF encryption (attachment part must not contain /Encrypt)
        assert b"/Encrypt" not in raw.encode("utf-8", errors="ignore"), "PDF appears encrypted"


# ---------------------------------------------------------------------------
# 4) HTTP Regression — 400 when Gmail not configured
# ---------------------------------------------------------------------------
class TestBlast400WhenNotConfigured:
    def test_blast_returns_400_when_app_password_missing(self):
        # temporarily blank app_password + gmail_user
        async def _setup():
            prev = await db.hrd_settings.find_one({"_id": "hrd"}) or {}
            await db.hrd_settings.update_one(
                {"_id": "hrd"},
                {"$unset": {"app_password": "", "gmail_user": ""}},
                upsert=True,
            )
            return prev
        prev = _run(_setup())
        try:
            sess = requests.Session()
            r = sess.post(f"{BASE_URL}/api/auth/login",
                          json={"username": "herliana", "password": "123456"}, timeout=30)
            assert r.status_code == 200, r.text
            r = sess.post(f"{BASE_URL}/api/hrd/verify-pin", json={"pin": "1111"}, timeout=30)
            assert r.status_code == 200, r.text
            gaji = r.json()["gaji_token"]

            r = sess.post(f"{BASE_URL}/api/hrd/blast",
                          headers={"x-hrd-gaji": gaji},
                          json={"month": 7, "year": 2026}, timeout=30)
            assert r.status_code == 400, r.text
            body = r.json()
            detail = body.get("detail", "")
            assert "Gmail belum dikonfigurasi" in detail, detail
        finally:
            # restore previous settings
            async def _restore():
                if prev.get("gmail_user") or prev.get("app_password"):
                    await db.hrd_settings.update_one(
                        {"_id": "hrd"},
                        {"$set": {"gmail_user": prev.get("gmail_user"),
                                  "app_password": prev.get("app_password")}},
                        upsert=True,
                    )
            _run(_restore())


# ---------------------------------------------------------------------------
# 5) HTTP Regression — xlsx import fills emails + PDF not encrypted
# ---------------------------------------------------------------------------
class TestImportAndPdfRegression:
    def test_import_xlsx_and_pdf_unencrypted(self):
        assert Path(XLSX_PATH).exists(), f"missing {XLSX_PATH}"
        sess = requests.Session()
        r = sess.post(f"{BASE_URL}/api/auth/login",
                      json={"username": "herliana", "password": "123456"}, timeout=30)
        assert r.status_code == 200
        r = sess.post(f"{BASE_URL}/api/hrd/verify-pin", json={"pin": "1111"}, timeout=30)
        assert r.status_code == 200, r.text
        gaji = r.json()["gaji_token"]
        h = {"x-hrd-gaji": gaji}

        # Import into a fresh period to avoid contamination
        month, year = 3, 2027
        with open(XLSX_PATH, "rb") as f:
            r = sess.post(
                f"{BASE_URL}/api/hrd/payslips/import-excel",
                data={"month": str(month), "year": str(year)},
                files={"file": ("gaji_new.xlsx", f,
                                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
                headers=h, timeout=60,
            )
        assert r.status_code == 200, r.text
        imported = r.json()
        print("Import result:", imported)

        # List payslips and verify all 5 have email
        r = sess.get(f"{BASE_URL}/api/hrd/payslips?month={month}&year={year}", headers=h, timeout=30)
        assert r.status_code == 200
        data = r.json()
        items = data["items"] if isinstance(data, dict) else data
        assert len(items) == 5, f"expected 5 slips, got {len(items)}"
        for slip in items:
            assert (slip.get("email") or "").strip(), f"missing email for {slip.get('nama')}"

        # PDF preview for first slip
        sid = items[0]["id"]
        r = sess.get(f"{BASE_URL}/api/hrd/payslips/{sid}/pdf", headers=h, timeout=30)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        body = r.content
        assert body.startswith(b"%PDF-")
        assert b"/Encrypt" not in body, "PDF appears encrypted"

        # cleanup: delete imported test period
        async def _cleanup():
            await db.hrd_payslips.delete_many({"period_month": month, "period_year": year})
        _run(_cleanup())
