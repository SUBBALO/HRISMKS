"""Backend tests for HRD Dokumen (people + docs + letters + verify)"""
import io
import os
import pytest
import requests


def _load_base():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if not v:
        try:
            with open("/app/frontend/.env") as fh:
                for ln in fh:
                    if ln.startswith("REACT_APP_BACKEND_URL="):
                        v = ln.split("=", 1)[1].strip()
                        break
        except Exception:
            pass
    assert v, "REACT_APP_BACKEND_URL not found"
    return v.rstrip("/")


BASE_URL = _load_base()


def _login(username, password):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, f"login {username} failed: {r.status_code} {r.text}"
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


# ---------------- Auth guard ----------------
def test_people_requires_auth():
    r = requests.get(f"{BASE_URL}/api/hrd/people")
    assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"


# ---------------- CRUD karyawan ----------------
def test_create_list_edit_delete_person(heri):
    payload = {
        "nama": "TEST_Karyawan_A", "nik": "MKS TEST01", "nik_ktp": "3201TEST",
        "tempat_lahir": "Batam", "tanggal_lahir": "1995-05-10",
        "jenis_kelamin": "Laki-laki", "agama": "Islam", "status_kawin": "Belum Kawin",
        "pendidikan": "S1", "alamat": "Jl. Test", "telp": "0811", "email": "t@t.com",
        "dept": "IT", "jabatan": "QA Tester", "status_karyawan": "Kontrak",
        "tanggal_masuk": "2022-01-15", "tanggal_keluar": "",
        "bank": "BCA", "no_rekening": "111", "npwp": "-", "no_bpjs_tk": "-", "no_bpjs_kes": "-",
        "kontak_darurat_nama": "X", "kontak_darurat_telp": "0", "catatan": "test"
    }
    r = heri.post(f"{BASE_URL}/api/hrd/people", json=payload)
    assert r.status_code == 200, r.text
    doc = r.json()
    assert "id" in doc and doc["nama"] == payload["nama"]
    assert "_id" not in doc
    emp_id = doc["id"]

    # list + search
    r2 = heri.get(f"{BASE_URL}/api/hrd/people", params={"q": "TEST_Karyawan_A"})
    assert r2.status_code == 200
    js = r2.json()
    assert "doc_types" in js and "KTP" in js["doc_types"]
    ids = [p["id"] for p in js["items"]]
    assert emp_id in ids

    # edit
    payload["jabatan"] = "QA Lead"
    r3 = heri.put(f"{BASE_URL}/api/hrd/people/{emp_id}", json=payload)
    assert r3.status_code == 200
    assert r3.json()["jabatan"] == "QA Lead"

    # delete
    r4 = heri.delete(f"{BASE_URL}/api/hrd/people/{emp_id}")
    assert r4.status_code == 200


def test_create_person_requires_nama(heri):
    r = heri.post(f"{BASE_URL}/api/hrd/people", json={"nama": ""})
    assert r.status_code == 400


# ---------------- Docs upload/list/download/delete ----------------
@pytest.fixture(scope="module")
def emp_for_docs(heri):
    r = heri.post(f"{BASE_URL}/api/hrd/people", json={"nama": "TEST_DocsEmp", "nik": "MKS TESTD",
                                                     "tanggal_masuk": "2020-03-01",
                                                     "status_karyawan": "Tetap", "dept": "HRD", "jabatan": "Staff"})
    assert r.status_code == 200
    eid = r.json()["id"]
    yield eid
    heri.delete(f"{BASE_URL}/api/hrd/people/{eid}")


def test_upload_reject_txt(heri, emp_for_docs):
    files = {"file": ("bad.txt", io.BytesIO(b"nope"), "text/plain")}
    r = heri.post(f"{BASE_URL}/api/hrd/people/{emp_for_docs}/docs",
                  data={"doc_type": "KTP"}, files=files)
    assert r.status_code == 400
    assert "tidak didukung" in r.json().get("detail", "").lower()


def test_upload_jpg_and_download_delete(heri, emp_for_docs):
    fake_jpg = b"\xff\xd8\xff\xe0" + b"0" * 200
    files = {"file": ("ktp.jpg", io.BytesIO(fake_jpg), "image/jpeg")}
    r = heri.post(f"{BASE_URL}/api/hrd/people/{emp_for_docs}/docs",
                  data={"doc_type": "KTP"}, files=files)
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["doc_type"] == "KTP" and doc["ext"] == ".jpg"
    did = doc["id"]

    # list
    r2 = heri.get(f"{BASE_URL}/api/hrd/people/{emp_for_docs}/docs")
    assert r2.status_code == 200 and any(d["id"] == did for d in r2.json()["items"])

    # download
    r3 = heri.get(f"{BASE_URL}/api/hrd/emp-docs/{did}/download")
    assert r3.status_code == 200
    assert r3.content[:2] == b"\xff\xd8"  # jpeg magic

    # delete
    r4 = heri.delete(f"{BASE_URL}/api/hrd/emp-docs/{did}")
    assert r4.status_code == 200


# ---------------- Letters ----------------
@pytest.fixture(scope="module")
def emp_for_letters(heri):
    r = heri.post(f"{BASE_URL}/api/hrd/people", json={"nama": "TEST_LetterEmp", "nik": "MKS TESTL",
                                                     "tanggal_masuk": "2019-06-01",
                                                     "status_karyawan": "Tetap", "dept": "Ops", "jabatan": "Operator"})
    assert r.status_code == 200
    eid = r.json()["id"]
    yield eid
    heri.delete(f"{BASE_URL}/api/hrd/people/{eid}")


def test_create_skk_letter(heri, emp_for_letters):
    r = heri.post(f"{BASE_URL}/api/hrd/letters",
                  json={"employee_id": emp_for_letters, "jenis": "skk", "keperluan": "untuk kredit"})
    assert r.status_code == 200, r.text
    l = r.json()
    assert l["nomor"].startswith("SKK/")
    assert len(l["kode"]) == 14 and l["kode"].count("-") == 2
    # pdf
    rp = heri.get(f"{BASE_URL}/api/hrd/letters/{l['id']}/pdf")
    assert rp.status_code == 200
    assert rp.headers.get("content-type", "").startswith("application/pdf")
    assert rp.content[:4] == b"%PDF"
    assert len(rp.content) > 3000
    # verify valid
    rv = heri.post(f"{BASE_URL}/api/hrd/letters/verify", json={"kode": l["kode"]})
    assert rv.status_code == 200 and rv.json()["valid"] is True
    # delete then verify becomes invalid
    rd = heri.delete(f"{BASE_URL}/api/hrd/letters/{l['id']}")
    assert rd.status_code == 200
    rv2 = heri.post(f"{BASE_URL}/api/hrd/letters/verify", json={"kode": l["kode"]})
    assert rv2.status_code == 200 and rv2.json()["valid"] is False


def test_paklaring_requires_tanggal_keluar(heri, emp_for_letters):
    # emp has no tanggal_keluar in DB, so must fail without payload
    r = heri.post(f"{BASE_URL}/api/hrd/letters",
                  json={"employee_id": emp_for_letters, "jenis": "paklaring", "keperluan": ""})
    assert r.status_code == 400
    # with tanggal_keluar
    r2 = heri.post(f"{BASE_URL}/api/hrd/letters",
                   json={"employee_id": emp_for_letters, "jenis": "paklaring",
                         "keperluan": "", "tanggal_keluar": "2025-12-31"})
    assert r2.status_code == 200
    assert r2.json()["nomor"].startswith("SPK/")
    # cleanup
    heri.delete(f"{BASE_URL}/api/hrd/letters/{r2.json()['id']}")


def test_verify_fake_and_malformed(heri):
    r = heri.post(f"{BASE_URL}/api/hrd/letters/verify", json={"kode": "AAAA-BBBB-CCCC"})
    assert r.status_code == 200
    j = r.json()
    assert j["valid"] is False and "terdaftar" in j["message"].lower()

    r2 = heri.post(f"{BASE_URL}/api/hrd/letters/verify", json={"kode": "SHORT"})
    assert r2.status_code == 200
    assert r2.json()["valid"] is False
    assert "format" in r2.json()["message"].lower()


# ---------------- Access control ----------------
def test_susanto_can_access_people(susanto):
    r = susanto.get(f"{BASE_URL}/api/hrd/people")
    assert r.status_code == 200


# ---------------- Regression: payslip for herliana ----------------
def test_herliana_payslip_regression(herliana):
    # unlock gaji using PIN 123456
    rv = herliana.post(f"{BASE_URL}/api/hrd/verify-pin", json={"pin": "123456"})
    assert rv.status_code == 200, f"gaji PIN 123456 must remain valid: {rv.text}"
    gaji_token = rv.json().get("gaji_token")
    assert gaji_token
    headers = {"x-hrd-gaji": gaji_token}
    rs = herliana.get(f"{BASE_URL}/api/hrd/payslips", headers=headers)
    assert rs.status_code == 200
    items = rs.json().get("items", [])
    assert len(items) >= 10, f"expected >=10 slips, got {len(items)}"
    # PDF endpoint
    pid = items[0]["id"]
    rp = herliana.get(f"{BASE_URL}/api/hrd/payslips/{pid}/pdf", headers=headers)
    assert rp.status_code == 200
    assert rp.content[:4] == b"%PDF"
