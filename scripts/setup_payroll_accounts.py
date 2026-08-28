"""One-time setup: konfigurasi akses payroll multi-grup di server Anda.

Jalankan dari folder backend agar .env terbaca:
    cd backend
    python ../scripts/setup_payroll_accounts.py

Idempotent — aman dijalankan berkali-kali. Tidak mengubah password user yang sudah ada.
Efek:
  - Herliana -> grup 'karyawan'
  - Nofia    -> MASTER (lihat grup staff + karyawan) tapi TETAP pakai PIN grup staff-nya
  - Asiong   -> BOS (akses penuh 2 grup, TANPA PIN); dibuat jika belum ada (password: Asiong2026)
  - Semua slip lama tanpa penanda grup ditandai 'karyawan'
"""
import asyncio
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

# Muat backend/.env (relatif ke lokasi skrip)
BACKEND_ENV = Path(__file__).resolve().parent.parent / "backend" / ".env"
load_dotenv(BACKEND_ENV if BACKEND_ENV.exists() else None)

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from passlib.context import CryptContext  # noqa: E402

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
ALL = {"view": True, "create": True, "edit": True, "delete": True, "report": True}
GAJI_ACCESS = {m: dict(ALL) for m in ["hrd_slip_gaji", "hrd_email", "hrd_settings"]}


async def main():
    url = os.environ["MONGO_URL"]
    dbname = os.environ["DB_NAME"]
    db = AsyncIOMotorClient(url)[dbname]

    await db.users.update_one({"username": "herliana"}, {"$set": {"payroll_group": "karyawan"}})

    if await db.users.find_one({"username": "nofia"}):
        await db.users.update_one({"username": "nofia"}, {"$set": {
            "payroll_groups": ["staff", "karyawan"], "payroll_group": "staff",
            "payroll_no_pin": False, "access": GAJI_ACCESS, "role": "hrd", "active": True,
        }})
        print("OK: Nofia -> MASTER (2 grup, tetap PIN)")
    else:
        print("SKIP: user 'nofia' belum ada")

    if await db.users.find_one({"username": "asiong"}):
        await db.users.update_one({"username": "asiong"}, {"$set": {
            "role": "hrd", "name": "Asiong", "active": True, "access": GAJI_ACCESS,
            "payroll_groups": ["karyawan", "staff"], "payroll_no_pin": True,
        }})
        print("OK: Asiong -> BOS (2 grup, tanpa PIN)")
    else:
        await db.users.insert_one({
            "id": str(uuid.uuid4()), "username": "asiong",
            "password_hash": _pwd.hash("Asiong2026"), "name": "Asiong", "role": "hrd",
            "active": True, "access": GAJI_ACCESS, "payroll_groups": ["karyawan", "staff"],
            "payroll_no_pin": True, "must_change_password": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        print("OK: Asiong dibuat (password: Asiong2026)")

    r = await db.hrd_payslips.update_many(
        {"$or": [{"payroll_group": {"$exists": False}}, {"payroll_group": None}]},
        {"$set": {"payroll_group": "karyawan"}})
    print(f"OK: {r.modified_count} slip lama ditandai grup 'karyawan'")
    print("Selesai. Restart backend, lalu login ulang.")


if __name__ == "__main__":
    asyncio.run(main())
