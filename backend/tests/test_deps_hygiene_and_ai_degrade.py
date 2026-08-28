"""Dependency hygiene (requirements.txt installable on plain PyPI) + hrd_ai graceful
degradation (_llm_imports -> HTTP 503) + regression of core payroll flow (month 11/2026)."""
import io
import os
import re
import subprocess
import sys
import textwrap

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"

REQ = "/app/backend/requirements.txt"
REQ_EMERGENT = "/app/backend/requirements-emergent.txt"
HRD_AI = "/app/backend/routers/hrd_ai.py"

MONTH, YEAR = 11, 2026
SAMPLE_XLSX = "/app/backend/tmp_uploads/gaji_trial.xlsx"
EXPECTED_NAMES = ["Wawan Munandar", "Harjono", "Rahmat Ari Sandi NST"]


def _pdf_text(content: bytes) -> str:
    import fitz
    doc = fitz.open(stream=content, filetype="pdf")
    return "\n".join(p.get_text() for p in doc)


# ---------------- requirements.txt hygiene ----------------
class TestRequirementsHygiene:
    def test_main_requirements_has_no_emergent_only_deps(self):
        lines = [l.strip() for l in open(REQ).read().splitlines()
                 if l.strip() and not l.strip().startswith("#")]
        joined = "\n".join(lines).lower()
        assert "emergentintegrations" not in joined, "emergentintegrations still in requirements.txt"
        assert "litellm" not in joined, "litellm still in requirements.txt"

    def test_main_requirements_has_no_url_or_index_directives(self):
        lines = [l.strip() for l in open(REQ).read().splitlines()
                 if l.strip() and not l.strip().startswith("#")]
        bad = [l for l in lines
               if "http://" in l or "https://" in l or l.startswith("-")
               or " @ " in l or l.endswith(".whl")]
        assert not bad, f"non-PyPI installable entries left in requirements.txt: {bad}"

    def test_core_runtime_deps_still_pinned(self):
        content = open(REQ).read().lower()
        for pkg in ("fastapi==", "uvicorn==", "motor==", "pymongo==", "openpyxl==",
                    "reportlab==", "pymupdf==", "python-dotenv=="):
            assert pkg in content, f"{pkg} missing from requirements.txt"

    def test_optional_emergent_requirements_file(self):
        assert os.path.exists(REQ_EMERGENT), "requirements-emergent.txt missing"
        content = open(REQ_EMERGENT).read()
        pkgs = [l.strip() for l in content.splitlines()
                if l.strip() and not l.strip().startswith("#")]
        assert any("emergentintegrations" in p for p in pkgs), pkgs
        assert "extra-index-url" in content, "no install instructions for the private index"


# ---------------- graceful degradation (code level, subprocess) ----------------
class TestGracefulDegradation:
    def test_llm_imports_helper_present_and_no_module_level_import(self):
        src = open(HRD_AI).read()
        assert "def _llm_imports(" in src
        # emergentintegrations must only be imported inside the helper (lazy)
        for m in re.finditer(r"^\s*from emergentintegrations", src, re.MULTILINE):
            indent = m.group(0).replace("\n", "")
            assert indent.startswith(("    ", "\t")), "module-level emergentintegrations import found"
        assert src.count("from emergentintegrations") == 1, "extra inline imports remain"
        assert "status_code=503" in src

    def test_router_imports_without_emergentintegrations_and_returns_503(self):
        script = textwrap.dedent("""
            import sys, os
            sys.path.insert(0, "/app/backend")
            for m in ("emergentintegrations", "emergentintegrations.llm",
                      "emergentintegrations.llm.chat"):
                sys.modules[m] = None
            from routers import hrd_ai
            from fastapi import HTTPException
            print("IMPORT_OK")
            try:
                hrd_ai._llm_imports()
                print("NO_RAISE")
            except HTTPException as e:
                print(f"HTTP:{e.status_code}")
                assert "emergentintegrations" in e.detail
                print("DETAIL_OK")
        """)
        env = dict(os.environ)
        p = subprocess.run([sys.executable, "-c", script], capture_output=True,
                           text=True, timeout=180, cwd="/app/backend", env=env)
        out = p.stdout + p.stderr
        assert "IMPORT_OK" in out, f"hrd_ai failed to import without emergentintegrations:\n{out[-1500:]}"
        assert "HTTP:503" in out, f"expected HTTP 503 degradation, got:\n{out[-1500:]}"
        assert "DETAIL_OK" in out, out[-800:]

    def test_all_ai_call_sites_use_helper(self):
        src = open(HRD_AI).read()
        assert src.count("_llm_imports()") >= 5, "not all AI endpoints route through _llm_imports()"


# ---------------- backend health + route registration ----------------
class TestHealthAndRoutes:
    def test_health_ok(self):
        r = requests.get(f"{API}/health", timeout=30)
        if r.status_code == 0 or r.status_code >= 500:
            r = requests.get(f"{API}/health", timeout=30)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"

    def test_ai_routes_registered(self):
        spec = None
        for url in (f"{API}/openapi.json", f"{BASE_URL}/openapi.json"):
            r = requests.get(url, timeout=30)
            if r.status_code == 200 and "json" in r.headers.get("content-type", ""):
                spec = r.json()
                break
        if spec is None:
            pytest.skip("openapi.json not exposed through the public ingress")
        paths = spec.get("paths", {})
        assert "/api/hrd/candidates/upload-cv" in paths, [p for p in paths if "candidat" in p]
        assert "/api/hrd/candidates" in paths

    def test_ai_route_not_404_or_503(self):
        r = requests.post(f"{API}/hrd/candidates/upload-cv", timeout=30)
        assert r.status_code != 404, "upload-cv route not registered"
        assert r.status_code != 503, "AI router degraded although package installed"
        assert r.status_code in (401, 403, 422), f"unexpected {r.status_code}: {r.text[:200]}"


# ---------------- auth fixtures ----------------
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


# ---------------- AI endpoint works when package IS installed ----------------
def _make_cv_pdf() -> bytes:
    from reportlab.pdfgen import canvas
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    lines = [
        "CURRICULUM VITAE",
        "Nama: TEST Budi Santoso",
        "Email: test.budi@example.com",
        "Telp: 081234567890",
        "Alamat: Jakarta Selatan",
        "Tanggal Lahir: 1995-04-12",
        "Pendidikan: S1 Teknik Industri, Universitas Indonesia (2017)",
        "Pengalaman: Staff Admin - PT Contoh Jaya - 2018-2022",
        "Skill: Microsoft Excel, Administrasi, Komunikasi",
    ]
    y = 800
    for l in lines:
        c.drawString(60, y, l)
        y -= 24
    c.showPage()
    c.save()
    return buf.getvalue()


class TestAiEndpointNot503:
    def test_upload_cv_reaches_llm_path(self, gaji_client):
        files = {"file": ("TEST_cv.pdf", _make_cv_pdf(), "application/pdf")}
        r = gaji_client.post(f"{API}/hrd/candidates/upload-cv",
                             data={"job_desc": "Staff Administrasi, mahir Excel"},
                             files=files, timeout=300)
        assert r.status_code != 503, f"AI endpoint degraded even though package installed: {r.text[:400]}"
        assert r.status_code in (200, 502), f"unexpected {r.status_code}: {r.text[:500]}"
        if r.status_code == 200:
            d = r.json()
            assert "_id" not in d
            assert d.get("id")
            assert d.get("status") == "Baru"
            assert isinstance(d.get("skill"), list)
            # cleanup
            gaji_client.delete(f"{API}/hrd/candidates/{d['id']}", timeout=60)
        else:
            print(f"LLM call error (non-503, import path OK): {r.text[:300]}")

    def test_candidates_list_ok(self, gaji_client):
        r = gaji_client.get(f"{API}/hrd/candidates", timeout=60)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        d = r.json()
        assert isinstance(d.get("items"), list)
        assert all("_id" not in x for x in d["items"])


# ---------------- core payroll regression ----------------
class TestPayrollRegression:
    def test_import_creates_three_slips_with_email(self, gaji_client):
        r = _import_sample(gaji_client)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:600]}"
        d = r.json()
        assert d.get("success") is True, d
        assert (d.get("created", 0) + d.get("updated", 0)) == 3, d

        items = _list_slips(gaji_client)
        for n in EXPECTED_NAMES:
            row = next((x for x in items if n.lower() in str(x.get("nama", "")).lower()), None)
            assert row is not None, f"{n} not persisted"
            assert "_id" not in row
            assert row.get("period_month") == MONTH and row.get("period_year") == YEAR
            assert str(row.get("email") or "").strip(), f"{n} has empty email"

    def test_rahmat_pdf_has_t_transport(self, gaji_client):
        _import_sample(gaji_client)
        items = _list_slips(gaji_client)
        rahmat = next(x for x in items if "rahmat" in str(x.get("nama", "")).lower())
        r = gaji_client.get(f"{API}/hrd/payslips/{rahmat['id']}/pdf", timeout=120)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:400]}"
        assert r.content[:4] == b"%PDF"
        norm = " ".join(_pdf_text(r.content).split())
        assert norm.count("T. Transport") >= 2, norm.count("T. Transport")
        assert "10.000" in norm

    def test_bulk_delete_cleans_up(self, gaji_client):
        _import_sample(gaji_client)
        items = _list_slips(gaji_client)
        ids = [x["id"] for x in items
               if any(n.lower() in str(x.get("nama", "")).lower() for n in EXPECTED_NAMES)]
        assert len(ids) == 3, ids
        r = gaji_client.post(f"{API}/hrd/payslips/bulk-delete", json={"ids": ids}, timeout=60)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:400]}"
        assert r.json().get("deleted") == 3, r.text[:300]
        after = {x["id"] for x in _list_slips(gaji_client)}
        for i in ids:
            assert i not in after


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
