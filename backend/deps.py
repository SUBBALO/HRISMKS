"""FastAPI dependencies + role guards + audit log helper.

Role matrix (v2 — new roles + backwards-compat aliases):
  super_admin — full control (also identified by SUPER_ADMIN_USERNAME env or is_super_admin flag)
  admin       — full access (legacy) — treated as admin-like everywhere except user-management
  supervisor  — admin-like access across all depts; admin panel hidden in frontend;
                CANNOT do user-management (super_admin only).
  finance     — read-only across all depts, can EXPORT with prices
  eng_head    — Engineering full access + can assign inquiries to eng_staff
  eng_staff   — Engineering; upload BOM allowed, but can only work on inquiries assigned to them
  engineering — LEGACY alias — treated as eng_head (full engineering)
  sales       — Sales dept only
  purchasing  — Purchasing dept only (transactions/SO writes)
  staff       — LEGACY alias for purchasing
  store       — Store dept only; prices hidden in Store UI

Super admin: only the username matching env SUPER_ADMIN_USERNAME (default 'susanto')
can manage users (create/edit/delete). All admin-like roles pass require_admin.
"""
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, Request

from db import db
from security import decode_token

logger = logging.getLogger(__name__)

SUPER_ADMIN_USERNAME = os.environ.get("SUPER_ADMIN_USERNAME", "susanto").lower().strip()

# ---------------- Role sets ----------------
ADMIN_LIKE_ROLES = ("admin", "supervisor", "super_admin")
# eng_leader = new canonical name for Engineering Leader role (Feb 2026 rename from eng_head)
# eng_head kept as legacy alias — same permissions
ENGINEERING_ROLES = ("engineering", "eng_head", "eng_leader", "eng_staff")
ENGINEERING_HEAD_ROLES = ("engineering", "eng_head", "eng_leader")  # legacy 'engineering' and 'eng_head' treated as leader
PURCHASING_ROLES = ("staff", "purchasing")
STORE_ROLES = ("store",)
SALES_ROLES = ("sales",)
FINANCE_ROLES = ("finance",)
QC_ROLES = ("qc",)
DOC_CONTROL_ROLES = ("doc_control", "document_control")
PRODUCTION_ROLES = ("produksi", "production")

# === RBAC untuk menu BOM (Feb 2026) ===
# Boleh melihat file Costing Price + Harga/Riwayat Pembelian item BOM.
# (Super Admin, Admin, Supervisor, Finance, semua Engineering, Sales, Purchasing)
COSTING_VIEW_ROLES = ADMIN_LIKE_ROLES + FINANCE_ROLES + ENGINEERING_ROLES + SALES_ROLES + PURCHASING_ROLES
# Kategori attachment yang dianggap "harga/costing" (disembunyikan dari role non-privileged).
PRICE_ATTACHMENT_CATEGORIES = {"costing", "costing_prev", "nesting_price"}
# Role yang HANYA boleh preview file DWG & Customer (tanpa tombol download) di konteks BOM.
DRAWING_PREVIEW_ONLY_ROLES = QC_ROLES + DOC_CONTROL_ROLES + STORE_ROLES + PRODUCTION_ROLES
DRAWING_ATTACHMENT_CATEGORIES = {"drawing", "customer_ref"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def can_view_costing(user: dict) -> bool:
    """True jika role boleh lihat Costing Price & harga/riwayat pembelian BOM."""
    return (user or {}).get("role") in COSTING_VIEW_ROLES


def is_drawing_preview_only(user: dict) -> bool:
    """True untuk QC / Doc Control / Store / Produksi → DWG & Customer preview-only (no download)."""
    return (user or {}).get("role") in DRAWING_PREVIEW_ONLY_ROLES


def is_admin_like(user: dict) -> bool:
    return (user or {}).get("role") in ADMIN_LIKE_ROLES


def is_engineering(user: dict) -> bool:
    return (user or {}).get("role") in ENGINEERING_ROLES


def is_eng_head(user: dict) -> bool:
    return (user or {}).get("role") in ENGINEERING_HEAD_ROLES


def is_purchasing(user: dict) -> bool:
    return (user or {}).get("role") in PURCHASING_ROLES


def is_qc(user: dict) -> bool:
    return (user or {}).get("role") in QC_ROLES


# Management Representative / Document Control — pengisi & penutup Section 3 CAR.
MR_ROLES = ("mr", "management_representative", "doc_control", "document_control")


def is_mr(user: dict) -> bool:
    """MR / Document Control (mis. salma) atau admin-like — berwenang atas CAR Closeout."""
    return (user or {}).get("role") in MR_ROLES or is_admin_like(user)


def is_production(user: dict) -> bool:
    return (user or {}).get("role") in PRODUCTION_ROLES


def is_sales(user: dict) -> bool:
    return (user or {}).get("role") in SALES_ROLES


# Role yang boleh MENERBITKAN Nonconformance (CAR) terhadap Drawing.
NC_ISSUER_ROLES = QC_ROLES + PRODUCTION_ROLES + SALES_ROLES


def is_nc_issuer(user: dict) -> bool:
    """QC / Produksi / Sales (atau admin-like) boleh menerbitkan NC."""
    return (user or {}).get("role") in NC_ISSUER_ROLES or is_admin_like(user)


def is_doc_control(user: dict) -> bool:
    return (user or {}).get("role") in DOC_CONTROL_ROLES


def is_super_admin_user(user: dict) -> bool:
    if (user or {}).get("is_super_admin"):
        return True
    return (user or {}).get("username", "").lower().strip() == SUPER_ADMIN_USERNAME


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"id": payload["sub"]})
        if not user or user.get("deleted_at"):
            raise HTTPException(status_code=401, detail="User not found")
        if user.get("active") is False:
            raise HTTPException(status_code=403, detail="Akun user dinonaktifkan")
        user.pop("password_hash", None)
        user.pop("_id", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def require_admin(current: dict = Depends(get_current_user)) -> dict:
    """Admin-like roles (admin, supervisor, super_admin) pass this check."""
    if not is_admin_like(current):
        raise HTTPException(status_code=403, detail="Hanya admin yang bisa mengakses")
    return current


async def require_super_admin(current: dict = Depends(get_current_user)) -> dict:
    """User-management is restricted to the primary admin only (env SUPER_ADMIN_USERNAME,
    default 'susanto'). Other admins/supervisors can still perform every other admin action."""
    if not is_super_admin_user(current):
        raise HTTPException(
            status_code=403,
            detail=f"Hanya {SUPER_ADMIN_USERNAME.upper()} yang bisa mengelola user",
        )
    return current


async def require_approve_perm(current: dict = Depends(get_current_user)) -> dict:
    # Supervisor + admin (with perm) can approve. Super admin can always approve.
    if is_super_admin_user(current):
        return current
    if current.get("role") == "supervisor":
        return current
    if current.get("role") == "admin" and "approve_store_requests" in (current.get("perms") or []):
        return current
    raise HTTPException(status_code=403, detail="Anda tidak berwenang menyetujui permohonan")


async def require_write(current: dict = Depends(get_current_user)) -> dict:
    """Guard for purchasing writes (transactions, sales-orders).
    Allowed: admin/supervisor/super_admin, purchasing (legacy staff).
    Blocked: finance (read-only), store, engineering, sales."""
    if is_admin_like(current):
        return current
    if is_purchasing(current):
        return current
    role = current.get("role")
    if role in FINANCE_ROLES:
        raise HTTPException(status_code=403, detail="Akun Finance hanya untuk view — tidak bisa mengubah data")
    if role in STORE_ROLES:
        raise HTTPException(status_code=403, detail="Akun Store tidak berwenang mengubah data purchasing/SO")
    if is_engineering(current):
        raise HTTPException(status_code=403, detail="Akun Engineering hanya berwenang di modul BOM")
    if role in SALES_ROLES:
        raise HTTPException(status_code=403, detail="Akun Sales tidak berwenang mengubah data purchasing")
    raise HTTPException(status_code=403, detail="Akses ditolak")


STORE_ACCESS_ROLES = ("admin", "supervisor", "super_admin", "store", "finance")


async def require_store_access(current: dict = Depends(get_current_user)) -> dict:
    if current.get("role") not in STORE_ACCESS_ROLES:
        raise HTTPException(status_code=403, detail="Akses ditolak")
    return current


async def require_store_write(current: dict = Depends(get_current_user)) -> dict:
    if not (is_admin_like(current) or current.get("role") in STORE_ROLES):
        raise HTTPException(status_code=403, detail="Akses ditolak")
    return current


async def require_bom_upload(current: dict = Depends(get_current_user)) -> dict:
    """Engineering (all sub-roles) and admin-like can upload BOM."""
    if is_admin_like(current) or is_engineering(current):
        return current
    raise HTTPException(status_code=403, detail="Hanya Engineering & Admin yang bisa upload BOM")


async def require_bom_admin(current: dict = Depends(get_current_user)) -> dict:
    """Only Admin-like can annotate BOM (Available Stock, Qty Purchase, Remarks)."""
    if not is_admin_like(current):
        raise HTTPException(status_code=403, detail="Hanya Admin yang bisa mengisi annotasi BOM")
    return current


async def require_bom_edit(current: dict = Depends(get_current_user)) -> dict:
    """Iter 22 — Engineering, Purchasing, Doc Control, dan Admin bisa edit isi BOM.
    Sales & QC & Store & Finance HANYA BISA LIHAT — tidak boleh add/edit/delete item BOM."""
    if is_admin_like(current):
        return current
    if is_engineering(current):
        return current
    if is_purchasing(current):
        return current
    if is_doc_control(current):
        return current
    role = (current or {}).get("role", "")
    raise HTTPException(
        status_code=403,
        detail=f"Role Anda ({role}) hanya bisa MELIHAT BOM. Tidak boleh add/edit/delete item BOM.",
    )


def can_see_prices(user: dict) -> bool:
    role = (user or {}).get("role")
    if role in STORE_ROLES:
        return False
    if role in FINANCE_ROLES or is_admin_like(user):
        return True
    return "view_store_report" in (user.get("perms") or [])


async def log_action(actor: dict, action: str, entity: str, entity_id: str,
                     details: Optional[dict] = None) -> None:
    """Fire-and-forget audit log. Errors are swallowed to not disrupt main flow."""
    try:
        await db.activity_logs.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": actor.get("id"),
            "username": actor.get("username", ""),
            "user_name": actor.get("name", ""),
            "action": action,
            "entity": entity,
            "entity_id": entity_id,
            "details": details or {},
            "timestamp": _now_iso(),
        })
    except Exception as e:
        logger.warning(f"Failed to log action {action}: {e}")
