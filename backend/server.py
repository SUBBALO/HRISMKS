"""HRIS PT Mitra Karya Sarana — standalone backend (HRD module only)."""
from dotenv import load_dotenv
from pathlib import Path
import os

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import logging
import uuid
from datetime import datetime, timezone

from fastapi import FastAPI, APIRouter
from starlette.middleware.cors import CORSMiddleware

from db import db
from security import hash_password, verify_password
from routers import auth as auth_router
from routers import hrd as hrd_router
from routers import hrd_people as hrd_people_router
from routers import hrd_extras as hrd_extras_router
from routers import hrd_ai as hrd_ai_router
from routers import admin_tools as admin_tools_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="HRIS MKS")
api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"message": "HRIS PT Mitra Karya Sarana"}


@api_router.get("/health")
async def health():
    return {"status": "ok"}


app.include_router(auth_router.router, prefix="/api")
app.include_router(hrd_router.router, prefix="/api")
app.include_router(hrd_people_router.router, prefix="/api")
app.include_router(hrd_extras_router.router, prefix="/api")
app.include_router(hrd_ai_router.router, prefix="/api")
app.include_router(admin_tools_router.router, prefix="/api")
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origin_regex=".*",
    allow_methods=["*"],
    allow_headers=["*"],
)

ALL_ACTIONS = {"view": True, "create": True, "edit": True, "delete": True, "report": True}
GAJI_MENUS = ["hrd_karyawan", "hrd_slip_gaji", "hrd_email", "hrd_settings"]
NON_GAJI_MENUS = ["hrd_dokumen"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _ensure_user(username: str, password: str, name: str, role: str, access: dict):
    existing = await db.users.find_one({"username": username})
    if existing:
        # keep access in sync with intended defaults, but never touch password
        await db.users.update_one({"username": username},
                                  {"$set": {"role": role, "access": access, "name": name, "active": True}})
        return
    await db.users.insert_one({
        "id": str(uuid.uuid4()),
        "username": username,
        "password_hash": hash_password(password),
        "name": name,
        "role": role,
        "active": True,
        "access": access,
        "must_change_password": False,
        "created_at": _now_iso(),
    })
    logger.info(f"Seeded user: {username} ({role})")


@app.on_event("startup")
async def seed_and_index():
    # Cleanup legacy super admin account from earlier builds
    await db.users.delete_many({"username": "superadmin"})
    # Super admin (manages users & access matrix) — susanto
    su_user = os.environ.get("SUPER_ADMIN_USERNAME", "susanto").lower().strip()
    su_pass = os.environ.get("SUPER_ADMIN_PASSWORD", "Subbalo1994")
    su_existing = await db.users.find_one({"username": su_user})
    if not su_existing:
        await _ensure_user(su_user, su_pass, "Susanto", "super_admin", {})
    # Herliana — akses SEMUA menu (termasuk area Gaji) + pengelola PIN Gaji
    herliana_access = {m: dict(ALL_ACTIONS) for m in (GAJI_MENUS + NON_GAJI_MENUS)}
    await _ensure_user("herliana", "123456", "Herliana", "hrd", herliana_access)
    # Heri — akses menu selain area Gaji (tidak bisa masuk Portal Data Gaji)
    heri_access = {m: dict(ALL_ACTIONS) for m in NON_GAJI_MENUS}
    await _ensure_user("heri", "123456", "Heri", "hrd", heri_access)

    # --- Konfigurasi akses payroll multi-grup (idempotent, jalan tiap start) ---
    gaji_access = {m: dict(ALL_ACTIONS) for m in ["hrd_slip_gaji", "hrd_email", "hrd_settings"]}
    # Herliana = grup 'karyawan'
    await db.users.update_one({"username": "herliana"}, {"$set": {"payroll_group": "karyawan"}})
    # Nofia = MASTER (lihat 2 grup) TAPI tetap wajib PIN grup staff-nya (payroll_no_pin=False)
    if await db.users.find_one({"username": "nofia"}):
        await db.users.update_one({"username": "nofia"}, {"$set": {
            "payroll_groups": ["staff", "karyawan"],
            "payroll_group": "staff",
            "payroll_no_pin": False,
            "access": gaji_access,
            "role": "hrd", "active": True,
        }})
    # Asiong = BOS: akses penuh 2 grup TANPA PIN
    if await db.users.find_one({"username": "asiong"}):
        await db.users.update_one({"username": "asiong"}, {"$set": {
            "role": "hrd", "name": "Asiong", "active": True, "access": gaji_access,
            "payroll_groups": ["karyawan", "staff"], "payroll_no_pin": True,
        }})
    else:
        await db.users.insert_one({
            "id": str(uuid.uuid4()), "username": "asiong",
            "password_hash": hash_password("Asiong2026"),
            "name": "Asiong", "role": "hrd", "active": True, "access": gaji_access,
            "payroll_groups": ["karyawan", "staff"], "payroll_no_pin": True,
            "must_change_password": False, "created_at": _now_iso(),
        })
        logger.info("Seeded BOS account: asiong")
    # Data-heal: slip lama tanpa penanda grup dianggap 'karyawan' (kompat filter STRICT)
    try:
        r = await db.hrd_payslips.update_many(
            {"$or": [{"payroll_group": {"$exists": False}}, {"payroll_group": None}]},
            {"$set": {"payroll_group": "karyawan"}})
        if r.modified_count:
            logger.info(f"Backfilled payroll_group=karyawan on {r.modified_count} payslips")
    except Exception as e:
        logger.warning(f"Payslip group backfill warning: {e}")

    try:
        await db.users.create_index("username")
        await db.login_attempts.create_index("username")
        await db.hrd_payslips.create_index([("period_month", 1), ("period_year", 1)])
    except Exception as e:
        logger.warning(f"Index creation warning: {e}")


@app.on_event("shutdown")
async def shutdown():
    pass
