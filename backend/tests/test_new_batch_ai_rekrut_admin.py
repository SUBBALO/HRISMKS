"""Tests for the NEW batch: AI CV screening, Draft AI, save-letter, OCR KTP,
Recycle Bin & Backup (super only), Access rules for /hrd/logs, Regression checks.

AI endpoints are expensive — each is called AT MOST ONCE.
"""
import io
import os
import zipfile

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback: read from frontend/.env
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.strip().split("=", 1)[1].rstrip("/")
                    break
    except Exception:
        pass
API = f"{BASE_URL}/api"


def _login(username, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"username": username, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {username}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def heri():
    return _login("heri", "123456")


@pytest.fixture(scope="module")
def herliana():
    return _login("herliana", "123456")


@pytest.fixture(scope="module")
def susanto():
    return _login("susanto", "Subbalo1994")


# ------------------ ACCESS RULES ------------------
class TestHrdLogsAccess:
    def test_heri_forbidden(self, heri):
        r = heri.get(f"{API}/hrd/logs", timeout=30)
        assert r.status_code == 403, r.text

    def test_susanto_forbidden(self, susanto):
        r = susanto.get(f"{API}/hrd/logs", timeout=30)
        assert r.status_code == 403, r.text

    def test_herliana_allowed(self, herliana):
        r = herliana.get(f"{API}/hrd/logs", timeout=30)
        assert r.status_code == 200, r.text
        assert isinstance(r.json().get("items"), list)


class TestRecycleBinAccess:
    def test_heri_forbidden_recycle_bin(self, heri):
        r = heri.get(f"{API}/admin/recycle-bin", timeout=30)
        assert r.status_code == 403, r.text

    def test_susanto_recycle_bin_ok(self, susanto):
        r = susanto.get(f"{API}/admin/recycle-bin", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "items" in data and "purge_days" in data
        assert data["purge_days"] == 30
        # sanity: each item has days_left & module
        for it in data["items"][:5]:
            assert "days_left" in it and "module" in it and "collection" in it


# ------------------ RECYCLE BIN RESTORE ------------------
class TestRecycleBinRestore:
    def test_restore_one_item_roundtrip(self, susanto):
        # Grab any restorable item that we OWN (created earlier by tests). We prefer
        # a Pengumuman if any, else the first item. We snapshot state to restore back.
        r = susanto.get(f"{API}/admin/recycle-bin", timeout=30)
        assert r.status_code == 200
        items = r.json()["items"]
        if not items:
            pytest.skip("Recycle bin empty — nothing to test restore against")
        # prefer pengumuman
        target = next((x for x in items if x["collection"] == "hrd_announcements"), items[0])
        coll, iid = target["collection"], target["id"]

        rr = susanto.post(f"{API}/admin/recycle-bin/restore",
                          json={"collection": coll, "id": iid}, timeout=30)
        assert rr.status_code == 200, rr.text
        assert rr.json().get("success") is True

        # Verify item gone from bin
        r2 = susanto.get(f"{API}/admin/recycle-bin", timeout=30)
        remaining_ids = {(x["collection"], x["id"]) for x in r2.json()["items"]}
        assert (coll, iid) not in remaining_ids

        # Re-soft-delete via appropriate module endpoint to restore state
        cleanup_map = {
            "hrd_announcements": f"{API}/hrd/announcements/{iid}",
            "hrd_letters": f"{API}/hrd/letters/{iid}",
            "hrd_candidates": f"{API}/hrd/candidates/{iid}",
            "hrd_employees": f"{API}/hrd/employees/{iid}",
            "hrd_leaves": f"{API}/hrd/leaves/{iid}",
            "hrd_reviews": f"{API}/hrd/reviews/{iid}",
            "hrd_career": f"{API}/hrd/career/{iid}",
            "hrd_payslips": f"{API}/hrd/payslips/{iid}",
            "hrd_attendance": f"{API}/hrd/attendance/{iid}",
            "hrd_emp_docs": f"{API}/hrd/documents/{iid}",
        }
        url = cleanup_map.get(coll)
        if url:
            # herliana can delete most hrd things; use susanto (super) via herliana session actually not possible without direct super delete. Try susanto first, then herliana.
            for sess in (susanto,):
                try:
                    d = sess.delete(url, timeout=30)
                    if d.status_code in (200, 204, 404):
                        break
                except Exception:
                    pass


# ------------------ BACKUP ------------------
class TestBackup:
    def test_heri_forbidden(self, heri):
        r = heri.get(f"{API}/admin/backup", timeout=60)
        assert r.status_code == 403

    def test_backup_zip(self, susanto):
        r = susanto.get(f"{API}/admin/backup", timeout=120)
        assert r.status_code == 200, r.text
        assert "application/zip" in r.headers.get("content-type", "")
        assert len(r.content) > 1024, f"ZIP too small: {len(r.content)}"
        z = zipfile.ZipFile(io.BytesIO(r.content))
        names = z.namelist()
        # should contain at least users.json + a couple hrd_ files
        assert any(n.endswith(".json") for n in names)
        assert any("hrd_" in n for n in names)


# ------------------ AI CV UPLOAD (call once) ------------------
def _tiny_pdf(text: str) -> bytes:
    """Build a very small single-page PDF containing text."""
    # Minimal PDF with a text stream
    content = f"BT /F1 12 Tf 50 750 Td ({text}) Tj ET".encode("latin-1")
    stream = b"%PDF-1.4\n"
    objs = []
    def add(o):
        objs.append(o)
        return len(objs)
    o1 = add(b"<< /Type /Catalog /Pages 2 0 R >>")
    o2 = add(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    o3 = add(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>")
    o4_stream = content
    o4 = add(b"<< /Length " + str(len(o4_stream)).encode() + b" >>\nstream\n" + o4_stream + b"\nendstream")
    o5 = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    xref_positions = []
    body = b""
    for i, o in enumerate(objs, 1):
        xref_positions.append(len(stream) + len(body))
        body += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
    stream += body
    xref_off = len(stream)
    stream += b"xref\n0 " + str(len(objs) + 1).encode() + b"\n0000000000 65535 f \n"
    for p in xref_positions:
        stream += f"{p:010d} 00000 n \n".encode()
    stream += b"trailer << /Size " + str(len(objs) + 1).encode() + b" /Root 1 0 R >>\nstartxref\n" + str(xref_off).encode() + b"\n%%EOF"
    return stream


class TestAIEndpoints:
    """Each AI endpoint called at most once."""

    def test_upload_cv_once(self, herliana):
        pdf = _tiny_pdf("CV Andi TEST. Nama: TEST_CANDIDATE. Email: t@t.com. Skill: Python.")
        files = {"file": ("test_cv.pdf", pdf, "application/pdf")}
        data = {"job_desc": "Software engineer python fastapi"}
        r = herliana.post(f"{API}/hrd/candidates/upload-cv", files=files, data=data, timeout=180)
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        body = r.json()
        assert "nama" in body and "id" in body
        assert body.get("skor") is None or isinstance(body["skor"], int)
        # Clean up
        cid = body["id"]
        d = herliana.delete(f"{API}/hrd/candidates/{cid}", timeout=30)
        assert d.status_code in (200, 204)

    def test_draft_letter_once(self, herliana):
        r = herliana.post(f"{API}/hrd/ai/draft-letter",
                          json={"jenis": "memo", "kronologi": "perubahan jam istirahat menjadi 12.00-13.00"},
                          timeout=180)
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        body = r.json()
        assert body.get("draft") and len(body["draft"]) > 20
        assert body.get("jenis") == "Internal Memo"

    def test_ocr_ktp_once(self, herliana):
        # Build tiny "KTP-like" image with Pillow (installed with reportlab? try fallback)
        try:
            from PIL import Image, ImageDraw
        except ImportError:
            pytest.skip("Pillow not installed")
        img = Image.new("RGB", (600, 380), "white")
        d = ImageDraw.Draw(img)
        d.text((10, 10), "PROVINSI KEPULAUAN RIAU", fill="black")
        d.text((10, 30), "KOTA BATAM", fill="black")
        d.text((10, 60), "NIK : 2171012345678901", fill="black")
        d.text((10, 90), "Nama : TEST OCR NAME", fill="black")
        d.text((10, 120), "Tempat/Tgl Lahir : Batam, 01-01-1990", fill="black")
        d.text((10, 150), "Jenis Kelamin : LAKI-LAKI", fill="black")
        d.text((10, 180), "Alamat : Jl. Test No. 1", fill="black")
        d.text((10, 210), "Agama : ISLAM", fill="black")
        d.text((10, 240), "Status Perkawinan : BELUM KAWIN", fill="black")
        buf = io.BytesIO()
        img.save(buf, "PNG")
        buf.seek(0)
        files = {"file": ("ktp.png", buf.getvalue(), "image/png")}
        r = herliana.post(f"{API}/hrd/ai/ocr-ktp", files=files, timeout=180)
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        body = r.json()
        for k in ["nik_ktp", "nama", "alamat"]:
            assert k in body


# ------------------ Arsip Terpusat (save-letter, list, pdf, verify) ------------------
class TestArsipTerpusat:
    def test_save_list_pdf_verify_delete(self, herliana):
        r = herliana.post(f"{API}/hrd/ai/save-letter",
                          json={"jenis": "memo", "body": "TEST isi memo untuk arsip terpusat."},
                          timeout=60)
        assert r.status_code == 200, r.text
        rec = r.json()
        assert rec["nomor"].startswith("IM/2026/")
        assert rec.get("kode") and len(rec["kode"]) >= 12
        lid = rec["id"]

        # GET listing shows it
        r2 = herliana.get(f"{API}/hrd/letters", timeout=30)
        assert r2.status_code == 200
        ids = [x["id"] for x in r2.json()["items"]]
        assert lid in ids

        # PDF
        r3 = herliana.get(f"{API}/hrd/letters/{lid}/pdf", timeout=60)
        assert r3.status_code == 200
        assert r3.content[:4] == b"%PDF", "PDF signature mismatch"

        # Verify code
        r4 = herliana.post(f"{API}/hrd/letters/verify", json={"kode": rec["kode"]}, timeout=30)
        assert r4.status_code == 200
        assert r4.json().get("valid") is True

        # cleanup
        d = herliana.delete(f"{API}/hrd/letters/{lid}", timeout=30)
        assert d.status_code in (200, 204)


# ------------------ REGRESSION ------------------
class TestRegression:
    def test_herliana_gaji_pin_still_123456_and_payslips(self, herliana):
        r = herliana.post(f"{API}/hrd/verify-pin", json={"pin": "123456"}, timeout=30)
        assert r.status_code == 200, r.text
        tok = r.json().get("gaji_token")
        assert tok, r.json()
        r2 = herliana.get(f"{API}/hrd/payslips", timeout=30,
                          headers={"X-HRD-GAJI": tok})
        assert r2.status_code == 200, r2.text
        items = r2.json().get("items", [])
        # 10 slips exist, but list_payslips filters by month/year defaults; just ensure request works
        assert isinstance(items, list)

    def test_candidates_list_has_andi(self, herliana):
        r = herliana.get(f"{API}/hrd/candidates", timeout=30)
        assert r.status_code == 200
        names = [x.get("nama", "") for x in r.json().get("items", [])]
        assert any("Andi" in n for n in names), f"Andi Prasetyo not found. Names: {names}"
