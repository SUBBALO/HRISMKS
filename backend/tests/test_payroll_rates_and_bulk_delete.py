"""Payroll: dynamic rate-block parsing (T. Transport in PDF) + bulk delete endpoint."""
import os

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"

MONTH, YEAR = 7, 2026
SAMPLE_XLSX = "/app/backend/tmp_uploads/gaji_trial.xlsx"
EXPECTED_NAMES = ["Wawan Munandar", "Harjono", "Rahmat Ari Sandi NST"]


def _pdf_text(content: bytes) -> str:
    import fitz
    doc = fitz.open(stream=content, filetype="pdf")
    return "\n".join(p.get_text() for p in doc)


@pytest.fixture(scope="module")
def gaji_client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"username": "herliana", "password": "123456"}, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"Login failed {r.status_code}: {r.text[:300]}")
    tok = r.json().get("access_token") or r.json().get("token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    p = s.post(f"{API}/hrd/verify-pin", json={"pin": "1234"}, timeout=30)
    if p.status_code != 200:
        pytest.fail(f"verify-pin failed {p.status_code}: {p.text[:300]}")
    gt = p.json().get("gaji_token")
    assert gt, p.text[:300]
    s.headers.update({"x-hrd-gaji": gt})
    return s


def _list_slips(client):
    r = client.get(f"{API}/hrd/payslips", params={"month": MONTH, "year": YEAR}, timeout=60)
    assert r.status_code == 200, r.text[:300]
    p = r.json()
    return p if isinstance(p, list) else p.get("items", p.get("data", []))


def _import_sample(client):
    assert os.path.exists(SAMPLE_XLSX), f"missing sample {SAMPLE_XLSX}"
    with open(SAMPLE_XLSX, "rb") as f:
        files = {"file": ("gaji_trial.xlsx", f.read(),
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    return client.post(f"{API}/hrd/payslips/import-excel",
                       data={"month": MONTH, "year": YEAR}, files=files, timeout=180)


# --- Excel import + dynamic rate parsing ---
class TestSampleImportAndRates:
    def test_import_sample_creates_three_slips(self, gaji_client):
        r = _import_sample(gaji_client)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:600]}"
        d = r.json()
        assert d.get("success") is True, d
        assert (d.get("created", 0) + d.get("updated", 0)) == 3, d
        names = " | ".join(d.get("names") or [])
        for n in EXPECTED_NAMES:
            assert n in names, f"{n} missing from {names}"

        items = _list_slips(gaji_client)
        for n in EXPECTED_NAMES:
            row = next((x for x in items if n.lower() in str(x.get("nama", "")).lower()), None)
            assert row is not None, f"{n} not persisted"
            assert "_id" not in row
            assert row.get("period_month") == MONTH and row.get("period_year") == YEAR

    def test_rates_parsed_dynamically(self, gaji_client):
        _import_sample(gaji_client)  # self-contained (xdist runs classes in parallel)
        items = _list_slips(gaji_client)
        rahmat = next(x for x in items if "rahmat" in str(x.get("nama", "")).lower())
        rates = rahmat.get("rates")
        assert isinstance(rates, list) and rates, f"rates missing: {rahmat.get('rates')}"
        labels = [str(x.get("label", "")).lower() for x in rates]
        for want in ("perhari", "lembur", "kehadiran", "transport"):
            assert any(want in l for l in labels), f"'{want}' missing in rates {labels}"
        assert rahmat.get("t_transport") is not None, "legacy t_transport not populated"
        assert float(rahmat["t_transport"]) == 10000.0, rahmat.get("t_transport")

    def test_rahmat_pdf_contains_t_transport(self, gaji_client):
        _import_sample(gaji_client)
        items = _list_slips(gaji_client)
        rahmat = next(x for x in items if "rahmat" in str(x.get("nama", "")).lower())
        r = gaji_client.get(f"{API}/hrd/payslips/{rahmat['id']}/pdf", timeout=120)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:400]}"
        assert r.content[:4] == b"%PDF", "not a PDF"
        text = _pdf_text(r.content)
        norm = " ".join(text.split())
        assert norm.count("T. Transport") >= 2, f"T. Transport count={norm.count('T. Transport')}"
        for want in ("Perhari", "Lembur/Jam", "T. Kehadiran"):
            assert want in norm, f"'{want}' missing from PDF header block"
        assert "10.000" in norm, "T. Transport rate value 10.000 not rendered"

    def test_other_slips_pdf_ok(self, gaji_client):
        _import_sample(gaji_client)
        items = _list_slips(gaji_client)
        for n in ("wawan", "harjono"):
            slip = next(x for x in items if n in str(x.get("nama", "")).lower())
            r = gaji_client.get(f"{API}/hrd/payslips/{slip['id']}/pdf", timeout=120)
            assert r.status_code == 200, f"{n}: {r.status_code} {r.text[:300]}"
            norm = " ".join(_pdf_text(r.content).split())
            assert "Perhari" in norm, f"{n}: Perhari missing"
            assert "SLIP GAJI" in norm.upper()


# --- Bulk delete ---
class TestBulkDelete:
    def test_bulk_delete_subset_keeps_rest(self, gaji_client):
        r = _import_sample(gaji_client)
        assert r.status_code == 200, r.text[:400]
        items = _list_slips(gaji_client)
        target = [x for x in items if any(n.lower() in str(x.get("nama", "")).lower() for n in EXPECTED_NAMES)]
        assert len(target) == 3, [x.get("nama") for x in target]
        ids = [x["id"] for x in target[:2]]
        keep_id = target[2]["id"]

        br = gaji_client.post(f"{API}/hrd/payslips/bulk-delete", json={"ids": ids}, timeout=60)
        assert br.status_code == 200, f"{br.status_code}: {br.text[:400]}"
        d = br.json()
        assert d.get("success") is True and d.get("deleted") == 2, d

        after = {x["id"] for x in _list_slips(gaji_client)}
        assert keep_id in after, "remaining slip was deleted"
        for i in ids:
            assert i not in after, f"{i} still listed after bulk delete"

    def test_bulk_delete_empty_and_unknown_ids(self, gaji_client):
        r = gaji_client.post(f"{API}/hrd/payslips/bulk-delete", json={"ids": []}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("deleted") == 0, r.text[:200]

        r2 = gaji_client.post(f"{API}/hrd/payslips/bulk-delete",
                              json={"ids": ["no-such-id-1", "no-such-id-2"]}, timeout=30)
        assert r2.status_code == 200, f"{r2.status_code}: {r2.text[:300]}"
        assert r2.json().get("deleted") == 0, r2.text[:200]

    def test_bulk_delete_requires_pin(self, gaji_client):
        s = requests.Session()
        s.headers.update({k: v for k, v in gaji_client.headers.items() if k.lower() != "x-hrd-gaji"})
        s.cookies.update(gaji_client.cookies)
        r = s.post(f"{API}/hrd/payslips/bulk-delete", json={"ids": []}, timeout=30)
        assert r.status_code in (401, 403), f"expected pin gate, got {r.status_code}: {r.text[:200]}"

    def test_bulk_delete_unauthenticated(self):
        r = requests.post(f"{API}/hrd/payslips/bulk-delete", json={"ids": []}, timeout=30)
        assert r.status_code in (401, 403), r.status_code

    def test_single_delete_still_works(self, gaji_client):
        _import_sample(gaji_client)
        items = _list_slips(gaji_client)
        slip = next(x for x in items if "harjono" in str(x.get("nama", "")).lower())
        r = gaji_client.delete(f"{API}/hrd/payslips/{slip['id']}", timeout=30)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        after = {x["id"] for x in _list_slips(gaji_client)}
        assert slip["id"] not in after


@pytest.fixture(scope="module", autouse=True)
def cleanup(gaji_client):
    yield
    try:
        items = _list_slips(gaji_client)
        ids = [x["id"] for x in items
               if any(n.lower() in str(x.get("nama", "")).lower() for n in EXPECTED_NAMES)]
        if ids:
            gaji_client.post(f"{API}/hrd/payslips/bulk-delete", json={"ids": ids}, timeout=60)
    except Exception as e:
        print(f"cleanup skipped: {e}")
