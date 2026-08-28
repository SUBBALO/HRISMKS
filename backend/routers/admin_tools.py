"""Tools super admin: Recycle Bin (restore data terhapus, auto-purge 30 hari) & Backup database."""
import io
import json
import zipfile
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from db import db
from deps import require_super_admin, log_action

router = APIRouter(prefix="/admin", tags=["admin-tools"])

# Koleksi yang ikut recycle bin & backup, dengan label + field nama tampilan
BIN_COLLECTIONS = {
    "hrd_employees": {"label": "Database Karyawan", "name": "nama"},
    "hrd_emp_docs": {"label": "Dokumen Karyawan", "name": "filename"},
    "hrd_letters": {"label": "Surat Kerja", "name": "nomor"},
    "hrd_payslips": {"label": "Slip Gaji", "name": "nama"},
    "hrd_leaves": {"label": "Cuti & Izin", "name": "nama"},
    "hrd_attendance": {"label": "Absensi", "name": "nama"},
    "hrd_reviews": {"label": "Penilaian Kinerja", "name": "nama"},
    "hrd_announcements": {"label": "Pengumuman", "name": "judul"},
    "hrd_career": {"label": "Riwayat Karir", "name": "nama"},
    "hrd_candidates": {"label": "Kandidat (CV)", "name": "nama"},
}
PURGE_DAYS = 30


def _days_left(deleted_at: str) -> int:
    try:
        d = datetime.fromisoformat(str(deleted_at).replace("Z", "+00:00"))
        return max(0, PURGE_DAYS - (datetime.now(timezone.utc) - d).days)
    except Exception:
        return PURGE_DAYS


async def _purge_expired():
    cutoff = (datetime.now(timezone.utc) - timedelta(days=PURGE_DAYS)).isoformat()
    flt = {"deleted_at": {"$ne": None, "$lt": cutoff}}
    # hapus juga file fisik (CV & dokumen karyawan) sebelum record dipurge
    try:
        from routers.hrd_ai import CV_DIR
        from routers.hrd_people import UPLOAD_DIR
        async for c in db.hrd_candidates.find(flt, {"_id": 0, "id": 1, "ext": 1}):
            (CV_DIR / f"{c['id']}{c.get('ext', '')}").unlink(missing_ok=True)
        async for d in db.hrd_emp_docs.find(flt, {"_id": 0, "id": 1, "employee_id": 1, "ext": 1}):
            (UPLOAD_DIR / d["employee_id"] / f"{d['id']}{d.get('ext', '')}").unlink(missing_ok=True)
    except Exception:
        pass
    for coll in BIN_COLLECTIONS:
        await db[coll].delete_many(flt)


@router.get("/recycle-bin")
async def recycle_bin(current: dict = Depends(require_super_admin)):
    await _purge_expired()  # lazy purge saat dibuka
    items = []
    for coll, cfg in BIN_COLLECTIONS.items():
        docs = await db[coll].find({"deleted_at": {"$ne": None}}, {"_id": 0}).sort("deleted_at", -1).to_list(500)
        for d in docs:
            items.append({
                "collection": coll, "module": cfg["label"], "id": d.get("id"),
                "name": d.get(cfg["name"]) or "(tanpa nama)",
                "detail": d.get("jenis") or d.get("doc_type") or d.get("jabatan") or "",
                "deleted_at": d.get("deleted_at"), "deleted_by": d.get("deleted_by", ""),
                "days_left": _days_left(d.get("deleted_at")),
            })
    items.sort(key=lambda x: x["deleted_at"] or "", reverse=True)
    return {"items": items, "purge_days": PURGE_DAYS}


class RestoreIn(BaseModel):
    collection: str
    id: str


@router.post("/recycle-bin/restore")
async def restore_item(payload: RestoreIn, current: dict = Depends(require_super_admin)):
    if payload.collection not in BIN_COLLECTIONS:
        raise HTTPException(status_code=400, detail="Koleksi tidak dikenal")
    r = await db[payload.collection].update_one(
        {"id": payload.id, "deleted_at": {"$ne": None}},
        {"$set": {"deleted_at": None}, "$unset": {"deleted_by": ""}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Data tidak ditemukan di recycle bin")
    await log_action(current, "recycle_restore", payload.collection, payload.id, {})
    return {"success": True}


@router.get("/backup")
async def backup_db(current: dict = Depends(require_super_admin)):
    """Unduh backup seluruh data (JSON per koleksi dalam 1 ZIP)."""
    extra = ["users", "hrd_settings", "hrd_counters", "hrd_logs", "audit_logs"]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        names = set(list(BIN_COLLECTIONS.keys()) + extra)
        existing = set(await db.list_collection_names())
        for coll in sorted(names & existing):
            docs = await db[coll].find({}, {"_id": 0}).to_list(100000)
            zf.writestr(f"{coll}.json", json.dumps(docs, ensure_ascii=False, default=str, indent=1))
    buf.seek(0)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M")
    await log_action(current, "db_backup", "admin", stamp, {})
    return StreamingResponse(buf, media_type="application/zip",
                             headers={"Content-Disposition": f'attachment; filename="backup_hris_mks_{stamp}.zip"'})
