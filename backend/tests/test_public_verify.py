"""Test public verification endpoint (/api/hrd/verify/{kode}) - NO AUTH required."""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
# Fallback: read from frontend/.env if not set in environment
if not BASE_URL:
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    break
    except Exception:
        pass

SLIP_CODE = "247C-6B9E-5C76"
LETTER_CODE = "A116-5FD8-4389"


@pytest.fixture
def clean_client():
    """Session WITHOUT any auth cookies to ensure the endpoint truly is public."""
    s = requests.Session()
    return s


def _get(client, code):
    return client.get(f"{BASE_URL}/api/hrd/verify/{code}", timeout=15)


class TestPublicVerify:
    def test_slip_code_valid(self, clean_client):
        r = _get(clean_client, SLIP_CODE)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["valid"] is True
        assert data["type"] == "slip"
        d = data["data"]
        assert d["nama"] == "Harjono"
        assert d["periode"] == "Agustus 2026"
        assert d["take_home"] == 6206000
        assert d["no_dok"] == "SG/2026/08/MKS0013"

    def test_letter_code_valid(self, clean_client):
        r = _get(clean_client, LETTER_CODE)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["valid"] is True
        assert data["type"] == "letter"
        d = data["data"]
        assert d["nomor"] == "SKK/2026/08/0001"
        assert "SURAT KETERANGAN KERJA" in d["jenis"].upper()
        assert d["nama"] == "Test Karyawan"

    def test_invalid_code(self, clean_client):
        r = _get(clean_client, "AAAA-BBBB-CCCC")
        assert r.status_code == 200
        data = r.json()
        assert data["valid"] is False
        assert "message" in data

    def test_lowercase_no_dashes(self, clean_client):
        # Lowercase without dashes for slip
        r = _get(clean_client, "247c6b9e5c76")
        assert r.status_code == 200
        data = r.json()
        assert data["valid"] is True
        assert data["type"] == "slip"
        assert data["data"]["nama"] == "Harjono"

    def test_lowercase_with_dashes(self, clean_client):
        r = _get(clean_client, "247c-6b9e-5c76")
        data = r.json()
        assert data["valid"] is True
        assert data["type"] == "slip"

    def test_bad_format(self, clean_client):
        r = _get(clean_client, "SHORT")
        data = r.json()
        assert data["valid"] is False

    def test_no_credentials_accepted(self, clean_client):
        """Public endpoint must be reachable without any auth header/cookie."""
        assert "Cookie" not in clean_client.headers
        r = _get(clean_client, SLIP_CODE)
        # Not 401/403
        assert r.status_code == 200, f"Public endpoint returned {r.status_code}"

    def test_post_not_allowed(self, clean_client):
        """Endpoint is READ-ONLY (GET). POST should not succeed."""
        r = clean_client.post(f"{BASE_URL}/api/hrd/verify/{SLIP_CODE}", timeout=10)
        assert r.status_code in (404, 405), f"Expected method not allowed, got {r.status_code}"
