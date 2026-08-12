"""Modul HRD tambahan: Dashboard, Cuti & Izin, Absensi, Penilaian Kinerja,
Pengumuman, Riwayat Karir. Permission: hrd_dokumen (non-payroll)."""
import uuid
from datetime import datetime, timezone, date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db import db
from deps import log_action
from services.soft_delete import NOT_DELETED_FILTER, soft_delete_one
from routers.hrd import require_hrd_perm, require_hrd, _now

router = APIRouter(prefix="/hrd", tags=["hrd-extras"])

CUTI_QUOTA = 12  # hari per tahun
REQUIRED_DOCS = ["KTP", "Kartu Keluarga", "Ijazah", "Kontrak Kerja"]


def _iso_date(v):
    try:
        y, m, d = str(v or "").split("T")[0].split("-")
        return date(int(y), int(m), int(d))
    except Exception:
        return None


# ---------------- Dashboard ----------------
@router.get("/dashboard")
async def dashboard(current: dict = Depends(require_hrd_perm("hrd_dokumen", "view"))):
    today = datetime.now(timezone.utc).date()
    emps = await db.hrd_employees.find(NOT_DELETED_FILTER, {"_id": 0}).to_list(2000)

    by_status, by_dept = {}, {}
    new_this_month, contracts, birthdays = [], [], []
    for e in emps:
        st = e.get("status_karyawan") or "Belum diisi"
        by_status[st] = by_status.get(st, 0) + 1
        dp = e.get("dept") or "Lainnya"
        by_dept[dp] = by_dept.get(dp, 0) + 1
        tm = _iso_date(e.get("tanggal_masuk"))
        if tm and tm.year == today.year and tm.month == today.month:
            new_this_month.append({"nama": e.get("nama"), "jabatan": e.get("jabatan"), "tanggal_masuk": e.get("tanggal_masuk")})
        if (e.get("status_karyawan") == "Kontrak"):
            tk = _iso_date(e.get("tanggal_keluar"))
            if tk:
                days_left = (tk - today).days
                if days_left <= 90:
                    contracts.append({"id": e.get("id"), "nama": e.get("nama"), "jabatan": e.get("jabatan"),
                                      "berakhir": e.get("tanggal_keluar"), "sisa_hari": days_left})
        tl = _iso_date(e.get("tanggal_lahir"))
        if tl and tl.month == today.month:
            birthdays.append({"nama": e.get("nama"), "tanggal": tl.day, "jabatan": e.get("jabatan")})
    contracts.sort(key=lambda x: x["sisa_hari"])
    birthdays.sort(key=lambda x: x["tanggal"])

    # kelengkapan dokumen
    doc_map = {}
    async for c in db.hrd_emp_docs.aggregate([
            {"$match": NOT_DELETED_FILTER},
            {"$group": {"_id": {"emp": "$employee_id", "type": "$doc_type"}}}]):
        doc_map.setdefault(c["_id"]["emp"], set()).add(c["_id"]["type"])
    completeness = []
    for e in emps:
        have = doc_map.get(e.get("id"), set())
        missing = [t for t in REQUIRED_DOCS if t not in have]
        completeness.append({"id": e.get("id"), "nama": e.get("nama"), "missing": missing,
                             "pct": round(100 * (len(REQUIRED_DOCS) - len(missing)) / len(REQUIRED_DOCS))})
    incomplete = [c for c in completeness if c["missing"]]
    incomplete.sort(key=lambda x: x["pct"])

    letters_count = await db.hrd_letters.count_documents(NOT_DELETED_FILTER)
    return {
        "total_karyawan": len(emps),
        "by_status": by_status,
        "by_dept": by_dept,
        "new_this_month": new_this_month,
        "contracts_expiring": contracts,
        "birthdays": birthdays,
        "required_docs": REQUIRED_DOCS,
        "doc_incomplete": incomplete[:50],
        "doc_complete_count": len(emps) - len(incomplete),
        "letters_count": letters_count,
        "bulan": today.month, "tahun": today.year,
    }


# ---------------- Cuti & Izin ----------------
class LeaveIn(BaseModel):
    employee_id: str
    jenis: str  # Cuti Tahunan / Sakit / Izin / Cuti Khusus
    tanggal_mulai: str
    tanggal_selesai: str = ""
    jumlah_hari: float = 1
    keterangan: str = ""


@router.get("/leaves")
async def list_leaves(year: int = 0, current: dict = Depends(require_hrd_perm("hrd_dokumen", "view"))):
    year = year or datetime.now(timezone.utc).year
    items = await db.hrd_leaves.find(
        {**NOT_DELETED_FILTER, "tanggal_mulai": {"$regex": f"^{year}"}}, {"_id": 0}
    ).sort("tanggal_mulai", -1).to_list(2000)
    emps = await db.hrd_employees.find(NOT_DELETED_FILTER, {"_id": 0, "id": 1, "nama": 1}).to_list(2000)
    used = {}
    for it in items:
        if it.get("jenis") == "Cuti Tahunan":
            used[it["employee_id"]] = used.get(it["employee_id"], 0) + float(it.get("jumlah_hari") or 0)
    balances = [{"employee_id": e["id"], "nama": e.get("nama"), "quota": CUTI_QUOTA,
                 "terpakai": used.get(e["id"], 0), "sisa": CUTI_QUOTA - used.get(e["id"], 0)} for e in emps]
    balances.sort(key=lambda x: (x["nama"] or ""))
    return {"items": items, "balances": balances, "year": year, "quota": CUTI_QUOTA}


@router.post("/leaves")
async def create_leave(payload: LeaveIn, current: dict = Depends(require_hrd_perm("hrd_dokumen", "create"))):
    emp = await db.hrd_employees.find_one({"id": payload.employee_id, **NOT_DELETED_FILTER}, {"_id": 0})
    if not emp:
        raise HTTPException(status_code=404, detail="Karyawan tidak ditemukan")
    if not _iso_date(payload.tanggal_mulai):
        raise HTTPException(status_code=400, detail="Tanggal mulai tidak valid")
    rec = {**payload.dict(), "id": str(uuid.uuid4()), "nama": emp.get("nama", ""),
           "created_by": current.get("name") or current.get("username", ""), "created_at": _now()}
    await db.hrd_leaves.insert_one(dict(rec))
    rec.pop("_id", None)
    await log_action(current, "hrd_leave_create", "hrd_leaves", rec["id"], {"nama": rec["nama"], "jenis": rec["jenis"]})
    return rec


@router.delete("/leaves/{lid}")
async def delete_leave(lid: str, current: dict = Depends(require_hrd_perm("hrd_dokumen", "delete"))):
    ok = await soft_delete_one("hrd_leaves", {"id": lid}, current)
    if not ok:
        raise HTTPException(status_code=404, detail="Data cuti tidak ditemukan")
    return {"success": True}


# ---------------- Absensi (rekap bulanan) ----------------
class AttendanceIn(BaseModel):
    employee_id: str
    year: int
    month: int
    hadir: float = 0
    terlambat: float = 0
    absen: float = 0
    izin: float = 0
    sakit: float = 0
    cuti: float = 0


@router.get("/attendance")
async def list_attendance(year: int, month: int, current: dict = Depends(require_hrd_perm("hrd_dokumen", "view"))):
    items = await db.hrd_attendance.find(
        {**NOT_DELETED_FILTER, "year": year, "month": month}, {"_id": 0}).to_list(2000)
    by_emp = {i["employee_id"]: i for i in items}
    emps = await db.hrd_employees.find(NOT_DELETED_FILTER, {"_id": 0, "id": 1, "nama": 1, "dept": 1, "jabatan": 1}).to_list(2000)
    emps.sort(key=lambda x: (x.get("nama") or ""))
    rows = []
    for e in emps:
        a = by_emp.get(e["id"], {})
        rows.append({"employee_id": e["id"], "nama": e.get("nama"), "dept": e.get("dept"), "jabatan": e.get("jabatan"),
                     **{k: a.get(k, 0) for k in ["hadir", "terlambat", "absen", "izin", "sakit", "cuti"]}})
    return {"items": rows, "year": year, "month": month}


@router.post("/attendance")
async def save_attendance(payload: AttendanceIn, current: dict = Depends(require_hrd_perm("hrd_dokumen", "edit"))):
    emp = await db.hrd_employees.find_one({"id": payload.employee_id, **NOT_DELETED_FILTER}, {"_id": 0})
    if not emp:
        raise HTTPException(status_code=404, detail="Karyawan tidak ditemukan")
    data = payload.dict()
    data.update({"nama": emp.get("nama", ""), "updated_by": current.get("name") or current.get("username", ""),
                 "updated_at": _now()})
    await db.hrd_attendance.update_one(
        {"employee_id": payload.employee_id, "year": payload.year, "month": payload.month, **NOT_DELETED_FILTER},
        {"$set": data, "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": _now()}}, upsert=True)
    return {"success": True}


# ---------------- Penilaian Kinerja ----------------
REVIEW_CRITERIA = ["disiplin", "kualitas", "kerjasama", "inisiatif", "kehadiran"]


class ReviewIn(BaseModel):
    employee_id: str
    periode: str  # bebas: "Semester 1 2026"
    skor: dict   # {disiplin:1-5, ...}
    catatan: str = ""


@router.get("/reviews")
async def list_reviews(current: dict = Depends(require_hrd_perm("hrd_dokumen", "view"))):
    items = await db.hrd_reviews.find(NOT_DELETED_FILTER, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return {"items": items, "criteria": REVIEW_CRITERIA}


@router.post("/reviews")
async def create_review(payload: ReviewIn, current: dict = Depends(require_hrd_perm("hrd_dokumen", "create"))):
    emp = await db.hrd_employees.find_one({"id": payload.employee_id, **NOT_DELETED_FILTER}, {"_id": 0})
    if not emp:
        raise HTTPException(status_code=404, detail="Karyawan tidak ditemukan")
    skor = {}
    for k in REVIEW_CRITERIA:
        try:
            v = float(payload.skor.get(k, 0))
        except Exception:
            v = 0
        skor[k] = max(1.0, min(5.0, v)) if v else 0
    filled = [v for v in skor.values() if v]
    rata = round(sum(filled) / len(filled), 2) if filled else 0
    rec = {"id": str(uuid.uuid4()), "employee_id": emp["id"], "nama": emp.get("nama", ""),
           "jabatan": emp.get("jabatan", ""), "periode": payload.periode.strip(), "skor": skor, "rata": rata,
           "catatan": payload.catatan.strip(),
           "created_by": current.get("name") or current.get("username", ""), "created_at": _now()}
    await db.hrd_reviews.insert_one(dict(rec))
    rec.pop("_id", None)
    await log_action(current, "hrd_review_create", "hrd_reviews", rec["id"], {"nama": rec["nama"], "periode": rec["periode"]})
    return rec


@router.delete("/reviews/{rid}")
async def delete_review(rid: str, current: dict = Depends(require_hrd_perm("hrd_dokumen", "delete"))):
    ok = await soft_delete_one("hrd_reviews", {"id": rid}, current)
    if not ok:
        raise HTTPException(status_code=404, detail="Penilaian tidak ditemukan")
    return {"success": True}


# ---------------- Pengumuman ----------------
class AnnouncementIn(BaseModel):
    judul: str
    isi: str = ""
    penting: bool = False


@router.get("/announcements")
async def list_announcements(current: dict = Depends(require_hrd)):
    items = await db.hrd_announcements.find(NOT_DELETED_FILTER, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {"items": items}


@router.post("/announcements")
async def create_announcement(payload: AnnouncementIn, current: dict = Depends(require_hrd_perm("hrd_dokumen", "create"))):
    if not payload.judul.strip():
        raise HTTPException(status_code=400, detail="Judul wajib diisi")
    rec = {**payload.dict(), "id": str(uuid.uuid4()),
           "created_by": current.get("name") or current.get("username", ""), "created_at": _now()}
    await db.hrd_announcements.insert_one(dict(rec))
    rec.pop("_id", None)
    return rec


@router.put("/announcements/{aid}")
async def update_announcement(aid: str, payload: AnnouncementIn, current: dict = Depends(require_hrd_perm("hrd_dokumen", "edit"))):
    r = await db.hrd_announcements.update_one({"id": aid, **NOT_DELETED_FILTER}, {"$set": payload.dict()})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Pengumuman tidak ditemukan")
    return await db.hrd_announcements.find_one({"id": aid}, {"_id": 0})


@router.delete("/announcements/{aid}")
async def delete_announcement(aid: str, current: dict = Depends(require_hrd_perm("hrd_dokumen", "delete"))):
    ok = await soft_delete_one("hrd_announcements", {"id": aid}, current)
    if not ok:
        raise HTTPException(status_code=404, detail="Pengumuman tidak ditemukan")
    return {"success": True}


# ---------------- Riwayat Karir ----------------
CAREER_KINDS = ["Promosi", "Mutasi", "Kenaikan Gaji", "Surat Peringatan", "Kontrak Baru", "Lainnya"]


class CareerIn(BaseModel):
    employee_id: str
    tanggal: str
    jenis: str
    keterangan: str = ""


@router.get("/people/{emp_id}/career")
async def list_career(emp_id: str, current: dict = Depends(require_hrd_perm("hrd_dokumen", "view"))):
    items = await db.hrd_career.find({"employee_id": emp_id, **NOT_DELETED_FILTER}, {"_id": 0}) \
        .sort("tanggal", -1).to_list(200)
    return {"items": items, "kinds": CAREER_KINDS}


@router.post("/career")
async def create_career(payload: CareerIn, current: dict = Depends(require_hrd_perm("hrd_dokumen", "create"))):
    emp = await db.hrd_employees.find_one({"id": payload.employee_id, **NOT_DELETED_FILTER}, {"_id": 0})
    if not emp:
        raise HTTPException(status_code=404, detail="Karyawan tidak ditemukan")
    if not _iso_date(payload.tanggal):
        raise HTTPException(status_code=400, detail="Tanggal tidak valid")
    rec = {**payload.dict(), "id": str(uuid.uuid4()), "nama": emp.get("nama", ""),
           "created_by": current.get("name") or current.get("username", ""), "created_at": _now()}
    await db.hrd_career.insert_one(dict(rec))
    rec.pop("_id", None)
    return rec


@router.delete("/career/{cid}")
async def delete_career(cid: str, current: dict = Depends(require_hrd_perm("hrd_dokumen", "delete"))):
    ok = await soft_delete_one("hrd_career", {"id": cid}, current)
    if not ok:
        raise HTTPException(status_code=404, detail="Riwayat tidak ditemukan")
    return {"success": True}
