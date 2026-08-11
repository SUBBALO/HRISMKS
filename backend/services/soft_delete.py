"""Soft-delete helpers — Recycle Bin support for MKS ERP.

Any collection that opts in gets a `deleted_at`, `deleted_by`, `deleted_by_name`
field on delete. Reads should include ``NOT_DELETED_FILTER`` so soft-deleted
docs stay hidden.  A background/periodic job purges docs older than
``AUTO_PURGE_DAYS`` (default 30) via ``purge_expired``.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from db import db

# Collections that participate in Recycle Bin.
TRASH_COLLECTIONS: List[str] = [
    "transactions", "sales_orders", "store_receipts", "store_issuances",
    "store_requests", "deliveries", "boms", "inquiries", "quotations",
    "customers", "users",
]

# Reads must filter this out.  Older docs (before feature) don't have the
# field — they pass because we use `$exists: False` OR `$eq: null`.
NOT_DELETED_FILTER: dict = {"$or": [{"deleted_at": {"$exists": False}}, {"deleted_at": None}]}

AUTO_PURGE_DAYS = 30


def merged(*filters: dict) -> dict:
    """Combine multiple $and-style query filters, preserving NOT_DELETED_FILTER."""
    ands: List[dict] = []
    for f in filters:
        if not f:
            continue
        ands.append(f)
    if not ands:
        return {}
    if len(ands) == 1:
        return dict(ands[0])
    return {"$and": ands}


async def soft_delete_one(collection: str, id_filter: dict, current: dict) -> bool:
    """Mark a single document deleted. Returns True if a doc was modified."""
    upd = {
        "$set": {
            "deleted_at": datetime.now(timezone.utc).isoformat(),
            "deleted_by": current.get("id"),
            "deleted_by_name": current.get("full_name") or current.get("username"),
        }
    }
    # Ensure we don't re-delete already-deleted docs
    filt = merged(id_filter, NOT_DELETED_FILTER)
    res = await db[collection].update_one(filt, upd)
    return res.modified_count > 0


async def soft_delete_many(collection: str, id_filter: dict, current: dict) -> int:
    upd = {
        "$set": {
            "deleted_at": datetime.now(timezone.utc).isoformat(),
            "deleted_by": current.get("id"),
            "deleted_by_name": current.get("full_name") or current.get("username"),
        }
    }
    filt = merged(id_filter, NOT_DELETED_FILTER)
    res = await db[collection].update_many(filt, upd)
    return res.modified_count


async def restore_many(collection: str, id_filter: dict) -> int:
    """Undo soft-delete on the given docs."""
    res = await db[collection].update_many(
        id_filter,
        {"$unset": {"deleted_at": "", "deleted_by": "", "deleted_by_name": ""}},
    )
    return res.modified_count


async def purge_expired(days: int = AUTO_PURGE_DAYS) -> Dict[str, int]:
    """Hard-delete every soft-deleted doc older than ``days`` days.

    Returns a per-collection count so callers can log the report.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    report: Dict[str, int] = {}
    for coll in TRASH_COLLECTIONS:
        res = await db[coll].delete_many({"deleted_at": {"$lte": cutoff}})
        if res.deleted_count:
            report[coll] = res.deleted_count
    return report


async def trash_summary() -> Dict[str, int]:
    out: Dict[str, int] = {}
    for coll in TRASH_COLLECTIONS:
        n = await db[coll].count_documents({"deleted_at": {"$exists": True, "$ne": None}})
        if n:
            out[coll] = n
    return out
