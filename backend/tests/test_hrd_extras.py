"""Tests for HRD Extras: dashboard, leaves, attendance, reviews, announcements, career."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback for local run (frontend .env)
    with open("/app/frontend/.env") as f:
        for ln in f:
            if ln.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = ln.split("=", 1)[1].strip().rstrip("/")
                break

HERI = ("heri", "123456")
HERL = ("herliana", "123456")
SUSA = ("susanto", "Subbalo1994")


def _login(session, u, p):
    r = session.post(f"{BASE_URL}/api/auth/login", json={"username": u, "password": p})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def s_heri():
    s = requests.Session()
    _login(s, *HERI)
    yield s
    try:
        s.post(f"{BASE_URL}/api/auth/logout")
    except Exception:
        pass


@pytest.fixture
def s_herl():
    s = requests.Session()
    _login(s, *HERL)
    yield s
    try:
        s.post(f"{BASE_URL}/api/auth/logout")
    except Exception:
        pass


@pytest.fixture
def s_susa():
    s = requests.Session()
    _login(s, *SUSA)
    yield s
    try:
        s.post(f"{BASE_URL}/api/auth/logout")
    except Exception:
        pass


@pytest.fixture
def emp_id(s_heri):
    r = s_heri.get(f"{BASE_URL}/api/hrd/people")
    assert r.status_code == 200
    items = r.json().get("items", [])
    assert items, "No employees found (need at least 1 dev-seeded)"
    return items[0]["id"]


# ---------- Access control ----------

class TestAccessControl:
    def test_unauth_dashboard(self):
        r = requests.get(f"{BASE_URL}/api/hrd/dashboard")
        assert r.status_code in (401, 403)

    def test_unauth_leaves(self):
        r = requests.get(f"{BASE_URL}/api/hrd/leaves")
        assert r.status_code in (401, 403)

    def test_unauth_attendance(self):
        r = requests.get(f"{BASE_URL}/api/hrd/attendance", params={"year": 2026, "month": 1})
        assert r.status_code in (401, 403)

    def test_unauth_reviews(self):
        r = requests.get(f"{BASE_URL}/api/hrd/reviews")
        assert r.status_code in (401, 403)

    def test_unauth_announcements(self):
        r = requests.get(f"{BASE_URL}/api/hrd/announcements")
        assert r.status_code in (401, 403)

    def test_super_can_view_dashboard(self, s_susa):
        r = s_susa.get(f"{BASE_URL}/api/hrd/dashboard")
        assert r.status_code == 200


# ---------- Dashboard ----------

class TestDashboard:
    def test_dashboard_shape(self, s_heri):
        r = s_heri.get(f"{BASE_URL}/api/hrd/dashboard")
        assert r.status_code == 200
        d = r.json()
        for k in ["total_karyawan", "by_status", "by_dept", "contracts_expiring",
                  "birthdays", "required_docs", "doc_incomplete", "doc_complete_count",
                  "letters_count", "bulan", "tahun"]:
            assert k in d, f"missing {k}"
        assert isinstance(d["total_karyawan"], int)
        assert d["required_docs"] == ["KTP", "Kartu Keluarga", "Ijazah", "Kontrak Kerja"]


# ---------- Leaves ----------

class TestLeaves:
    def test_leaves_crud(self, s_heri, emp_id):
        year = 2026
        # Create
        r = s_heri.post(f"{BASE_URL}/api/hrd/leaves", json={
            "employee_id": emp_id, "jenis": "Cuti Tahunan",
            "tanggal_mulai": f"{year}-01-05", "tanggal_selesai": f"{year}-01-07",
            "jumlah_hari": 3, "keterangan": "TEST_leave",
        })
        assert r.status_code == 200, r.text
        lid = r.json()["id"]

        # List
        r = s_heri.get(f"{BASE_URL}/api/hrd/leaves", params={"year": year})
        assert r.status_code == 200
        data = r.json()
        assert data["quota"] == 12
        assert any(it["id"] == lid for it in data["items"])
        bal = next(b for b in data["balances"] if b["employee_id"] == emp_id)
        assert bal["terpakai"] >= 3
        assert bal["sisa"] == 12 - bal["terpakai"]

        # Delete
        r = s_heri.delete(f"{BASE_URL}/api/hrd/leaves/{lid}")
        assert r.status_code == 200

        # Verify removed
        r = s_heri.get(f"{BASE_URL}/api/hrd/leaves", params={"year": year})
        assert not any(it["id"] == lid for it in r.json()["items"])

    def test_leave_invalid_date(self, s_heri, emp_id):
        r = s_heri.post(f"{BASE_URL}/api/hrd/leaves", json={
            "employee_id": emp_id, "jenis": "Izin",
            "tanggal_mulai": "invalid", "jumlah_hari": 1,
        })
        assert r.status_code == 400

    def test_leave_bad_emp(self, s_heri):
        r = s_heri.post(f"{BASE_URL}/api/hrd/leaves", json={
            "employee_id": str(uuid.uuid4()), "jenis": "Izin",
            "tanggal_mulai": "2026-01-01", "jumlah_hari": 1,
        })
        assert r.status_code == 404


# ---------- Attendance ----------

class TestAttendance:
    def test_upsert_no_dup(self, s_heri, emp_id):
        year, month = 2026, 3
        # First save
        r = s_heri.post(f"{BASE_URL}/api/hrd/attendance", json={
            "employee_id": emp_id, "year": year, "month": month,
            "hadir": 20, "terlambat": 2, "absen": 1,
        })
        assert r.status_code == 200

        # Second save (should upsert not duplicate)
        r = s_heri.post(f"{BASE_URL}/api/hrd/attendance", json={
            "employee_id": emp_id, "year": year, "month": month,
            "hadir": 22, "terlambat": 0, "absen": 0,
        })
        assert r.status_code == 200

        r = s_heri.get(f"{BASE_URL}/api/hrd/attendance", params={"year": year, "month": month})
        assert r.status_code == 200
        rows = r.json()["items"]
        mine = [x for x in rows if x["employee_id"] == emp_id]
        assert len(mine) == 1
        assert mine[0]["hadir"] == 22
        assert mine[0]["terlambat"] == 0


# ---------- Reviews ----------

class TestReviews:
    def test_reviews_crud_and_clamp(self, s_heri, emp_id):
        # Create with skor > 5 (should be clamped)
        r = s_heri.post(f"{BASE_URL}/api/hrd/reviews", json={
            "employee_id": emp_id, "periode": "TEST Semester 1 2026",
            "skor": {"disiplin": 9, "kualitas": 5, "kerjasama": 4, "inisiatif": 3, "kehadiran": 5},
            "catatan": "TEST",
        })
        assert r.status_code == 200, r.text
        rev = r.json()
        assert rev["skor"]["disiplin"] == 5, "Should clamp > 5 to 5"
        # rata = (5+5+4+3+5)/5 = 4.4
        assert abs(rev["rata"] - 4.4) < 0.01
        rid = rev["id"]

        # List
        r = s_heri.get(f"{BASE_URL}/api/hrd/reviews")
        assert r.status_code == 200
        assert any(it["id"] == rid for it in r.json()["items"])

        # Delete
        r = s_heri.delete(f"{BASE_URL}/api/hrd/reviews/{rid}")
        assert r.status_code == 200


# ---------- Announcements ----------

class TestAnnouncements:
    def test_announcements_crud(self, s_heri):
        r = s_heri.post(f"{BASE_URL}/api/hrd/announcements", json={
            "judul": "TEST Pengumuman", "isi": "body", "penting": True,
        })
        assert r.status_code == 200
        aid = r.json()["id"]
        assert r.json()["penting"] is True

        # List
        r = s_heri.get(f"{BASE_URL}/api/hrd/announcements")
        assert r.status_code == 200
        assert any(a["id"] == aid for a in r.json()["items"])

        # Update
        r = s_heri.put(f"{BASE_URL}/api/hrd/announcements/{aid}", json={
            "judul": "TEST Updated", "isi": "x", "penting": False,
        })
        assert r.status_code == 200
        assert r.json()["judul"] == "TEST Updated"

        # Delete
        r = s_heri.delete(f"{BASE_URL}/api/hrd/announcements/{aid}")
        assert r.status_code == 200

    def test_announcement_empty_title(self, s_heri):
        r = s_heri.post(f"{BASE_URL}/api/hrd/announcements", json={"judul": "  ", "isi": ""})
        assert r.status_code == 400

    def test_super_can_read_announcements(self, s_susa):
        r = s_susa.get(f"{BASE_URL}/api/hrd/announcements")
        assert r.status_code == 200


# ---------- Career ----------

class TestCareer:
    def test_career_crud(self, s_heri, emp_id):
        r = s_heri.post(f"{BASE_URL}/api/hrd/career", json={
            "employee_id": emp_id, "tanggal": "2026-01-15",
            "jenis": "Promosi", "keterangan": "TEST promo",
        })
        assert r.status_code == 200, r.text
        cid = r.json()["id"]

        r = s_heri.get(f"{BASE_URL}/api/hrd/people/{emp_id}/career")
        assert r.status_code == 200
        data = r.json()
        assert any(it["id"] == cid for it in data["items"])
        assert "Promosi" in data["kinds"]

        r = s_heri.delete(f"{BASE_URL}/api/hrd/career/{cid}")
        assert r.status_code == 200

    def test_career_invalid_date(self, s_heri, emp_id):
        r = s_heri.post(f"{BASE_URL}/api/hrd/career", json={
            "employee_id": emp_id, "tanggal": "not-a-date", "jenis": "Promosi",
        })
        assert r.status_code == 400


# ---------- Regression: Gaji PIN 123456 ----------

class TestGajiPinRegression:
    def test_herliana_pin_still_works(self, s_herl):
        r = s_herl.post(f"{BASE_URL}/api/hrd/verify-pin", json={"pin": "123456"})
        assert r.status_code == 200, "Gaji PIN 123456 must still work for herliana!"
        token = r.json().get("gaji_token")
        assert token

        # List payslips
        r = s_herl.get(f"{BASE_URL}/api/hrd/payslips",
                       headers={"x-hrd-gaji": token},
                       params={"month": 8, "year": 2026})
        assert r.status_code == 200
