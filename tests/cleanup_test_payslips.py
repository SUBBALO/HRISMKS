import os, requests
from dotenv import dotenv_values
API = (os.environ.get("REACT_APP_BACKEND_URL") or dotenv_values("/app/frontend/.env")["REACT_APP_BACKEND_URL"]).rstrip("/") + "/api"
s = requests.Session()
r = s.post(f"{API}/auth/login", json={"username": "herliana", "password": "123456"}, timeout=30)
tok = r.json().get("access_token") or r.json().get("token")
if tok:
    s.headers.update({"Authorization": f"Bearer {tok}"})
s.headers.update({"x-hrd-gaji": s.post(f"{API}/hrd/verify-pin", json={"pin": "1234"}, timeout=30).json()["gaji_token"]})
for m, y in [(7, 2026), (8, 2026)]:
    p = s.get(f"{API}/hrd/payslips", params={"month": m, "year": y}, timeout=60).json()
    items = p if isinstance(p, list) else p.get("items", p.get("data", []))
    for x in items:
        if "TEST_" in str(x.get("nama", "")):
            d = s.delete(f"{API}/hrd/payslips/{x['id']}", timeout=30)
            print("deleted", x["nama"], m, y, d.status_code)
print("cleanup done")
