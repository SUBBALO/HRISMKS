"""Auth, user management, activity log routes (standalone HRIS)."""
import uuid
import logging
import re
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

import jwt

from db import db
from deps import _now_iso, get_current_user, log_action, require_admin, require_super_admin, SUPER_ADMIN_USERNAME
from services.soft_delete import NOT_DELETED_FILTER, merged, soft_delete_one
from security import (
    JWT_ALGORITHM,
    JWT_SECRET,
    COOKIE_SECURE,
    COOKIE_SAMESITE,
    create_access_token,
    create_refresh_token,
    hash_password,
    set_auth_cookies,
    verify_password,
)
from models import LoginRequest, UserCreate, UserUpdate

router = APIRouter(tags=["auth"])
logger = logging.getLogger(__name__)

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_MINUTES = 15


async def _get_lockout_remaining(username: str) -> int:
    doc = await db.login_attempts.find_one({"username": username})
    if not doc:
        return 0
    locked_until = doc.get("locked_until")
    if not locked_until:
        return 0
    now = datetime.now(timezone.utc)
    if locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=timezone.utc)
    delta = (locked_until - now).total_seconds()
    return int(delta) if delta > 0 else 0


async def _record_failed_login(username: str) -> None:
    doc = await db.login_attempts.find_one({"username": username})
    now = datetime.now(timezone.utc)
    if not doc:
        await db.login_attempts.insert_one({"username": username, "count": 1, "last_attempt": now})
        return
    new_count = (doc.get("count") or 0) + 1
    updates = {"count": new_count, "last_attempt": now}
    if new_count >= MAX_FAILED_ATTEMPTS:
        updates["locked_until"] = now + timedelta(minutes=LOCKOUT_MINUTES)
    await db.login_attempts.update_one({"username": username}, {"$set": updates})


async def _clear_failed_login(username: str) -> None:
    await db.login_attempts.delete_one({"username": username})


# ---------------- Auth ----------------
@router.post("/auth/login")
async def login(payload: LoginRequest, response: Response):
    username = payload.username.lower().strip()

    remaining = await _get_lockout_remaining(username)
    if remaining > 0:
        raise HTTPException(status_code=429,
                            detail=f"Akun terkunci karena terlalu banyak percobaan gagal. Coba lagi dalam {remaining // 60}m {remaining % 60}d")

    user = await db.users.find_one(merged({"username": username}, NOT_DELETED_FILTER))
    if not user or not verify_password(payload.password, user["password_hash"]):
        await _record_failed_login(username)
        rem = await _get_lockout_remaining(username)
        if rem > 0:
            raise HTTPException(status_code=429, detail=f"Percobaan terlalu banyak — akun terkunci {LOCKOUT_MINUTES} menit")
        raise HTTPException(status_code=401, detail="Username atau password salah")
    if user.get("active") is False:
        raise HTTPException(status_code=403, detail="Akun user dinonaktifkan")

    await _clear_failed_login(username)

    access = create_access_token(user["id"], username)
    refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, refresh)
    await log_action(user, "login", "auth", user["id"], {"username": username})
    return {
        "id": user["id"],
        "username": user["username"],
        "name": user.get("name", ""),
        "role": user["role"],
        "access": user.get("access") or {},
        "is_super_admin": (user.get("username") or "").lower().strip() == SUPER_ADMIN_USERNAME,
        "must_change_password": bool(user.get("must_change_password")),
    }


@router.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get("access_token")
    if token:
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            u = await db.users.find_one({"id": payload.get("sub")})
            if u:
                await log_action(u, "logout", "auth", u["id"], {})
        except Exception:
            pass
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}


VALID_ROLES = ("super_admin", "admin", "hrd", "staff")


@router.get("/auth/me")
async def me(current: dict = Depends(get_current_user)):
    return {
        "id": current["id"],
        "username": current.get("username", ""),
        "name": current.get("name", ""),
        "role": current["role"],
        "access": current.get("access") or {},
        "is_super_admin": (current.get("username") or "").lower().strip() == SUPER_ADMIN_USERNAME,
        "must_change_password": bool(current.get("must_change_password")),
    }


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


@router.post("/auth/change-password")
async def change_password(payload: ChangePasswordIn, current: dict = Depends(get_current_user)):
    user = await db.users.find_one({"id": current["id"]})
    if not user:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    if not verify_password(payload.current_password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Password lama salah")
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password baru minimal 6 karakter")
    await db.users.update_one(
        {"id": current["id"]},
        {"$set": {"password_hash": hash_password(payload.new_password),
                  "must_change_password": False, "password_changed_at": _now_iso()}},
    )
    await log_action(current, "change_password", "auth", current["id"], {"username": current.get("username")})
    return {"ok": True, "message": "Password berhasil diganti"}


@router.post("/auth/refresh")
async def refresh_token(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"id": payload["sub"]})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        access = create_access_token(user["id"], user.get("username", ""))
        response.set_cookie("access_token", access, httponly=True, secure=COOKIE_SECURE,
                            samesite=COOKIE_SAMESITE, max_age=8 * 3600, path="/")
        return {"ok": True}
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")


# ---------------- Users (super admin) ----------------
PAYROLL_PRESETS = {
    "none": {"groups": [], "no_pin": False},
    "karyawan": {"groups": ["karyawan"], "no_pin": False},
    "staff": {"groups": ["staff"], "no_pin": False},
    "master": {"groups": ["staff", "karyawan"], "no_pin": False},
    "bos": {"groups": ["karyawan", "staff"], "no_pin": True},
}
GAJI_ACCESS_KEYS = ["hrd_slip_gaji", "hrd_email", "hrd_settings"]
_ALL_ACT = {"view": True, "create": True, "edit": True, "delete": True, "report": True}


def _apply_payroll_access(doc: dict, level: str, access: dict) -> dict:
    """Terjemahkan pilihan 'Akses Gaji' menjadi field payroll + pastikan menu gaji ada di access."""
    preset = PAYROLL_PRESETS.get(level)
    access = dict(access or {})
    if preset is None:
        return access
    groups = preset["groups"]
    if groups:
        doc["payroll_groups"] = groups
        doc["payroll_group"] = groups[0]
        doc["payroll_no_pin"] = preset["no_pin"]
        for k in GAJI_ACCESS_KEYS:
            if not (access.get(k) or {}).get("view"):
                access[k] = dict(_ALL_ACT)
    else:
        doc["payroll_groups"] = []
        doc["payroll_group"] = None
        doc["payroll_no_pin"] = False
        for k in GAJI_ACCESS_KEYS + ["hrd_karyawan"]:
            access.pop(k, None)
    return access


def _payroll_level(u: dict) -> str:
    groups = u.get("payroll_groups")
    if isinstance(groups, list) and len(groups) > 1:
        return "bos" if u.get("payroll_no_pin") else "master"
    single = groups[0] if isinstance(groups, list) and groups else u.get("payroll_group")
    return single if single in ("karyawan", "staff") else "none"


def _sanitize_user(u: dict) -> dict:
    return {
        "id": u["id"],
        "username": u.get("username", ""),
        "name": u.get("name", ""),
        "role": u.get("role", "hrd"),
        "active": u.get("active", True),
        "access": u.get("access") or {},
        "payroll_access": _payroll_level(u),
        "must_change_password": bool(u.get("must_change_password")),
        "created_at": u.get("created_at", ""),
    }


@router.get("/users")
async def list_users(current: dict = Depends(require_super_admin)):
    users = await db.users.find(NOT_DELETED_FILTER, {"_id": 0, "password_hash": 0}).sort("created_at", 1).to_list(length=500)
    return [_sanitize_user(u) for u in users]


@router.post("/users")
async def create_user(payload: UserCreate, current: dict = Depends(require_super_admin)):
    username = payload.username.lower().strip()
    if not username or len(username) < 3:
        raise HTTPException(status_code=400, detail="Username minimal 3 karakter")
    if not payload.password or len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password minimal 6 karakter")
    role = payload.role if payload.role in VALID_ROLES else "hrd"
    existing = await db.users.find_one({"username": username})
    if existing:
        raise HTTPException(status_code=400, detail="Username sudah dipakai")
    user_doc = {
        "id": str(uuid.uuid4()),
        "username": username,
        "password_hash": hash_password(payload.password),
        "name": (payload.name or username).strip(),
        "role": role,
        "active": True,
        "access": payload.access or {},
        "must_change_password": bool(payload.must_change_password),
        "created_at": _now_iso(),
    }
    if payload.payroll_access is not None:
        user_doc["access"] = _apply_payroll_access(user_doc, payload.payroll_access, user_doc["access"])
    await db.users.insert_one(user_doc.copy())
    await log_action(current, "create_user", "user", user_doc["id"], {"username": username, "role": role})
    return _sanitize_user(user_doc)


@router.put("/users/{user_id}")
async def update_user(user_id: str, payload: UserUpdate, current: dict = Depends(require_super_admin)):
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    updates: dict = {}
    changed: dict = {}
    if payload.name is not None:
        updates["name"] = payload.name.strip()
        changed["name"] = payload.name.strip()
    if payload.role is not None and payload.role in VALID_ROLES:
        if user_id == current["id"] and payload.role != "super_admin":
            raise HTTPException(status_code=400, detail="Tidak bisa demote akun sendiri")
        updates["role"] = payload.role
        changed["role"] = payload.role
    if payload.active is not None:
        if user_id == current["id"] and payload.active is False:
            raise HTTPException(status_code=400, detail="Tidak bisa menonaktifkan akun sendiri")
        updates["active"] = bool(payload.active)
        changed["active"] = bool(payload.active)
    if payload.access is not None:
        updates["access"] = dict(payload.access)
        changed["access"] = "updated"
    if payload.payroll_access is not None:
        base_access = payload.access if payload.access is not None else (user.get("access") or {})
        doc_updates: dict = {}
        updates["access"] = _apply_payroll_access(doc_updates, payload.payroll_access, base_access)
        updates.update(doc_updates)  # payroll_groups, payroll_group, payroll_no_pin
        changed["payroll_access"] = payload.payroll_access
    if payload.password:
        if len(payload.password) < 6:
            raise HTTPException(status_code=400, detail="Password minimal 6 karakter")
        updates["password_hash"] = hash_password(payload.password)
        changed["password"] = "***"
    if updates:
        await db.users.update_one({"id": user_id}, {"$set": updates})
        await log_action(current, "update_user", "user", user_id, {"target": user.get("username"), "changes": changed})
    updated = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return _sanitize_user(updated)


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, current: dict = Depends(require_super_admin)):
    if user_id == current["id"]:
        raise HTTPException(status_code=400, detail="Tidak bisa hapus akun sendiri")
    user = await db.users.find_one(merged({"id": user_id}, NOT_DELETED_FILTER))
    if not user:
        raise HTTPException(status_code=404, detail="User tidak ditemukan")
    await soft_delete_one("users", {"id": user_id}, current)
    await log_action(current, "delete_user", "user", user_id, {"username": user.get("username")})
    return {"ok": True}


# ---------------- Activity Log ----------------
@router.get("/logs")
async def list_logs(
    current: dict = Depends(require_admin),
    user_id: Optional[str] = None,
    action: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
):
    filt: dict = {}
    if user_id:
        filt["user_id"] = user_id
    if action:
        filt["action"] = action
    total = await db.activity_logs.count_documents(filt)
    cursor = db.activity_logs.find(filt, {"_id": 0}).sort("timestamp", -1).skip((page - 1) * page_size).limit(page_size)
    items = await cursor.to_list(length=page_size)
    return {"total": total, "page": page, "page_size": page_size, "items": items}
