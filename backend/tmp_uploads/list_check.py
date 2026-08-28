import os
import requests
from dotenv import dotenv_values

BASE = (os.environ.get("REACT_APP_BACKEND_URL") or dotenv_values("/app/frontend/.env")["REACT_APP_BACKEND_URL"]).rstrip("/")
API = f"{BASE}/api"
s = requests.Session()
r = s.post(f"{API}/auth/login", json={"username": "herliana", "password": "123456"}, timeout=30)
tok = r.json().get("access_token") or r.json().get("token")
if tok:
    s.headers.update({"Authorization": f"Bearer {tok}"})
s.headers.update({"x-hrd-gaji": s.post(f"{API}/hrd/verify-pin", json={"pin": "1234"}, timeout=30).json()["gaji_token"]})
for m, y in [(8, 2026), (9, 2026), (11, 2026)]:
    items = s.get(f"{API}/hrd/payslips", params={"month": m, "year": y}, timeout=60).json()["items"]
    print(f"--- {m}/{y}: {len(items)} slips")
    for x in items:
        print(f"   {x.get('nama')!r:35s} nik={x.get('nik')!r:12s} email={x.get('email')!r} th={x.get('take_home')} dg={x.get('dg_take_home')}")
