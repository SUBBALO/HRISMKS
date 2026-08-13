"""Database Karyawan lengkap + arsip dokumen (KTP/Ijazah/dll) + Surat Kerja (SKK/Paklaring)
dengan QR verifikasi. Semua di bawah permission menu 'hrd_dokumen' (non-payroll, tanpa PIN Gaji)."""
import hashlib
import hmac
import io
import re
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import qrcode
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel

from db import db
from deps import log_action
from security import JWT_SECRET
from services.soft_delete import NOT_DELETED_FILTER, soft_delete_one
from routers.hrd import require_hrd_perm, BULAN_ID, _now

router = APIRouter(prefix="/hrd", tags=["hrd-people"])

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads" / "employees"
ALLOWED_EXT = {".pdf", ".jpg", ".jpeg", ".png", ".webp"}
MAX_UPLOAD = 10 * 1024 * 1024  # 10MB

DOC_TYPES = ["KTP", "Kartu Keluarga", "Ijazah", "Pengalaman Kerja", "NPWP", "BPJS Ketenagakerjaan", "BPJS Kesehatan",
             "Kontrak Kerja", "CV / Lamaran", "Sertifikat", "Pas Foto", "Lainnya"]


def _fmt_date_id(iso: str) -> str:
    """'2021-03-01' -> '1 Maret 2021'."""
    try:
        y, m, d = str(iso or "").split("T")[0].split("-")
        return f"{int(d)} {BULAN_ID.get(int(m), m)} {int(y)}"
    except Exception:
        return str(iso or "-")


# ---------------- Karyawan (master lengkap) ----------------
class PersonIn(BaseModel):
    # identitas
    nama: str = ""
    nik: str = ""            # NIK karyawan internal (MKS xxxx)
    nik_ktp: str = ""
    no_kk: str = ""          # No. Kartu Keluarga
    tempat_lahir: str = ""
    tanggal_lahir: str = ""
    jenis_kelamin: str = ""  # L / P
    golongan_darah: str = ""
    kewarganegaraan: str = "WNI"
    agama: str = ""
    status_kawin: str = ""
    nama_pasangan: str = ""
    jumlah_tanggungan: str = ""
    nama_ibu_kandung: str = ""
    pendidikan: str = ""
    jurusan: str = ""
    alamat: str = ""
    alamat_domisili: str = ""
    telp: str = ""
    email: str = ""
    # kepegawaian
    dept: str = ""
    jabatan: str = ""
    status_karyawan: str = ""  # Tetap / Kontrak / Harian / Magang
    tanggal_masuk: str = ""
    tanggal_keluar: str = ""
    # pembayaran & jaminan
    bank: str = ""
    no_rekening: str = ""
    npwp: str = ""
    no_bpjs_tk: str = ""
    no_bpjs_kes: str = ""
    # kontak darurat
    kontak_darurat_nama: str = ""
    kontak_darurat_hubungan: str = ""
    kontak_darurat_telp: str = ""
    catatan: str = ""
    riwayat_pendidikan: list = []   # [{jenjang, jurusan, institusi, tahun}]
    riwayat_pengalaman: list = []   # [{posisi, perusahaan, periode}]
    anggota_keluarga: list = []     # [{nama, nik, hubungan, tempat_lahir, tanggal_lahir, pekerjaan}]


@router.get("/people")
async def list_people(q: str = "", current: dict = Depends(require_hrd_perm("hrd_dokumen", "view"))):
    flt = dict(NOT_DELETED_FILTER)
    if q:
        rq = re.escape(q)
        flt["$and"] = [{"$or": [{"nama": {"$regex": rq, "$options": "i"}}, {"nik": {"$regex": rq, "$options": "i"}},
                                {"jabatan": {"$regex": rq, "$options": "i"}}, {"dept": {"$regex": rq, "$options": "i"}}]}]
    items = await db.hrd_employees.find(flt, {"_id": 0}).sort("nama", 1).to_list(2000)
    counts = {c["_id"]: c["n"] async for c in db.hrd_emp_docs.aggregate([
        {"$match": NOT_DELETED_FILTER}, {"$group": {"_id": "$employee_id", "n": {"$sum": 1}}}])}
    for it in items:
        it["docs_count"] = counts.get(it["id"], 0)
    return {"items": items, "doc_types": DOC_TYPES}


@router.post("/people")
async def create_person(payload: PersonIn, current: dict = Depends(require_hrd_perm("hrd_dokumen", "create"))):
    if not payload.nama.strip():
        raise HTTPException(status_code=400, detail="Nama wajib diisi")
    doc = payload.dict()
    doc.update({"id": str(uuid.uuid4()), "active": True, "created_at": _now(), "updated_at": _now()})
    await db.hrd_employees.insert_one(dict(doc))
    doc.pop("_id", None)
    await log_action(current, "hrd_person_create", "hrd_employees", doc["id"], {"nama": doc["nama"]})
    return doc


@router.put("/people/{emp_id}")
async def update_person(emp_id: str, payload: PersonIn, current: dict = Depends(require_hrd_perm("hrd_dokumen", "edit"))):
    r = await db.hrd_employees.update_one({"id": emp_id, **NOT_DELETED_FILTER},
                                          {"$set": {**payload.dict(), "updated_at": _now()}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Karyawan tidak ditemukan")
    return await db.hrd_employees.find_one({"id": emp_id}, {"_id": 0})


@router.delete("/people/{emp_id}")
async def delete_person(emp_id: str, current: dict = Depends(require_hrd_perm("hrd_dokumen", "delete"))):
    ok = await soft_delete_one("hrd_employees", {"id": emp_id}, current)
    if not ok:
        raise HTTPException(status_code=404, detail="Karyawan tidak ditemukan")
    await log_action(current, "hrd_person_delete", "hrd_employees", emp_id, {})
    return {"success": True}


# ---------------- Foto profil karyawan ----------------
PHOTO_EXT = {".jpg", ".jpeg", ".png", ".webp"}
PHOTO_MIME = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}


@router.post("/people/{emp_id}/photo")
async def upload_photo(emp_id: str, file: UploadFile = File(...),
                       current: dict = Depends(require_hrd_perm("hrd_dokumen", "edit"))):
    emp = await db.hrd_employees.find_one({"id": emp_id, **NOT_DELETED_FILTER}, {"_id": 0})
    if not emp:
        raise HTTPException(status_code=404, detail="Karyawan tidak ditemukan")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in PHOTO_EXT:
        raise HTTPException(status_code=400, detail="Foto harus JPG/PNG/WEBP")
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Ukuran foto maksimal 5 MB")
    folder = UPLOAD_DIR / emp_id
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob("photo.*"):
        old.unlink(missing_ok=True)
    (folder / f"photo{ext}").write_bytes(data)
    ver = uuid.uuid4().hex[:8]
    await db.hrd_employees.update_one({"id": emp_id}, {"$set": {"photo_ext": ext, "photo_ver": ver, "updated_at": _now()}})
    await log_action(current, "hrd_photo_upload", "hrd_employees", emp_id, {"nama": emp.get("nama")})
    return {"success": True, "photo_ext": ext, "photo_ver": ver}


@router.get("/people/{emp_id}/photo")
async def get_photo(emp_id: str, current: dict = Depends(require_hrd_perm("hrd_dokumen", "view"))):
    emp = await db.hrd_employees.find_one({"id": emp_id, **NOT_DELETED_FILTER}, {"_id": 0})
    if not emp or not emp.get("photo_ext"):
        raise HTTPException(status_code=404, detail="Foto tidak ada")
    path = UPLOAD_DIR / emp_id / f"photo{emp['photo_ext']}"
    if not path.exists():
        raise HTTPException(status_code=404, detail="File foto tidak ditemukan")
    return FileResponse(str(path), media_type=PHOTO_MIME.get(emp["photo_ext"], "image/jpeg"))


# ---------------- Dokumen karyawan (upload/list/download/hapus) ----------------
@router.post("/people/{emp_id}/docs")
async def upload_doc(emp_id: str, doc_type: str = Form(...), file: UploadFile = File(...),
                     keterangan: str = Form(""), autoread: str = Form("1"),
                     current: dict = Depends(require_hrd_perm("hrd_dokumen", "create"))):
    emp = await db.hrd_employees.find_one({"id": emp_id, **NOT_DELETED_FILTER}, {"_id": 0})
    if not emp:
        raise HTTPException(status_code=404, detail="Karyawan tidak ditemukan")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail=f"Format file tidak didukung ({ext}). Gunakan PDF/JPG/PNG/WEBP.")
    data = await file.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(status_code=400, detail="Ukuran file maksimal 10 MB")
    doc_id = str(uuid.uuid4())
    folder = UPLOAD_DIR / emp_id
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{doc_id}{ext}"
    path.write_bytes(data)
    rec = {"id": doc_id, "employee_id": emp_id, "doc_type": doc_type, "filename": file.filename,
           "keterangan": keterangan.strip(),
           "ext": ext, "size": len(data), "content_type": file.content_type or "application/octet-stream",
           "uploaded_by": current.get("name") or current.get("username", ""), "uploaded_at": _now()}
    await db.hrd_emp_docs.insert_one(dict(rec))
    rec.pop("_id", None)
    await log_action(current, "hrd_doc_upload", "hrd_emp_docs", doc_id, {"nama": emp.get("nama"), "jenis": doc_type})

    # Auto-baca AI & isi data karyawan (Ijazah->Riwayat Pendidikan, dll). Dilewati bila autoread=0 (mis. dari onboarding).
    ai_summary = ""
    if str(autoread) not in ("0", "false", ""):
        from routers.hrd_ai import DOCTYPE_TO_KATEGORI, ai_read_bytes, apply_extract_to_employee
        kat = DOCTYPE_TO_KATEGORI.get(doc_type)
        if kat:
            try:
                parsed = await ai_read_bytes(data, ext, kat)
                upd, ai_summary = apply_extract_to_employee(emp, kat, parsed)
                if upd:
                    await db.hrd_employees.update_one({"id": emp_id}, {"$set": upd})
            except Exception:
                ai_summary = ""
    employee = await db.hrd_employees.find_one({"id": emp_id, **NOT_DELETED_FILTER}, {"_id": 0})
    return {"doc": rec, "ai_summary": ai_summary, "employee": employee}


@router.get("/people/{emp_id}/docs")
async def list_docs(emp_id: str, current: dict = Depends(require_hrd_perm("hrd_dokumen", "view"))):
    items = await db.hrd_emp_docs.find({"employee_id": emp_id, **NOT_DELETED_FILTER}, {"_id": 0}) \
        .sort("uploaded_at", -1).to_list(200)
    return {"items": items}


@router.get("/emp-docs/{doc_id}/download")
async def download_doc(doc_id: str, current: dict = Depends(require_hrd_perm("hrd_dokumen", "view"))):
    rec = await db.hrd_emp_docs.find_one({"id": doc_id, **NOT_DELETED_FILTER}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Dokumen tidak ditemukan")
    path = UPLOAD_DIR / rec["employee_id"] / f"{doc_id}{rec['ext']}"
    if not path.exists():
        raise HTTPException(status_code=404, detail="File tidak ditemukan di server")
    return StreamingResponse(io.BytesIO(path.read_bytes()), media_type=rec["content_type"],
                             headers={"Content-Disposition": f'inline; filename="{rec["filename"]}"'})


@router.post("/emp-docs/{doc_id}/read")
async def reread_doc(doc_id: str, current: dict = Depends(require_hrd_perm("hrd_dokumen", "create"))):
    """Baca ulang dokumen yang sudah terupload dengan AI, lalu isikan ke data karyawan."""
    rec = await db.hrd_emp_docs.find_one({"id": doc_id, **NOT_DELETED_FILTER}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Dokumen tidak ditemukan")
    from routers.hrd_ai import DOCTYPE_TO_KATEGORI, ai_read_bytes, apply_extract_to_employee
    kat = DOCTYPE_TO_KATEGORI.get(rec["doc_type"])
    if not kat:
        raise HTTPException(status_code=400, detail=f"Jenis '{rec['doc_type']}' tidak bisa dibaca AI")
    path = UPLOAD_DIR / rec["employee_id"] / f"{doc_id}{rec['ext']}"
    if not path.exists():
        raise HTTPException(status_code=404, detail="File tidak ditemukan di server")
    emp = await db.hrd_employees.find_one({"id": rec["employee_id"], **NOT_DELETED_FILTER}, {"_id": 0})
    if not emp:
        raise HTTPException(status_code=404, detail="Karyawan tidak ditemukan")
    try:
        parsed = await ai_read_bytes(path.read_bytes(), rec["ext"], kat)
        upd, ai_summary = apply_extract_to_employee(emp, kat, parsed)
        if upd:
            await db.hrd_employees.update_one({"id": emp["id"]}, {"$set": upd})
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI gagal membaca dokumen: {e}")
    employee = await db.hrd_employees.find_one({"id": emp["id"], **NOT_DELETED_FILTER}, {"_id": 0})
    return {"ai_summary": ai_summary or "Tidak ada data baru terbaca", "employee": employee}


@router.delete("/emp-docs/{doc_id}")
async def delete_doc(doc_id: str, current: dict = Depends(require_hrd_perm("hrd_dokumen", "delete"))):
    rec = await db.hrd_emp_docs.find_one({"id": doc_id, **NOT_DELETED_FILTER}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Dokumen tidak ditemukan")
    await soft_delete_one("hrd_emp_docs", {"id": doc_id}, current)
    try:
        (UPLOAD_DIR / rec["employee_id"] / f"{doc_id}{rec['ext']}").unlink(missing_ok=True)
    except Exception:
        pass
    await log_action(current, "hrd_doc_delete", "hrd_emp_docs", doc_id, {"jenis": rec.get("doc_type")})
    return {"success": True}


# ---------------- Surat Kerja (SKK / Paklaring) ----------------
LETTER_KINDS = {"skk": {"code": "SKK", "title": "SURAT KETERANGAN KERJA"},
                "paklaring": {"code": "SPK", "title": "SURAT PENGALAMAN KERJA"},
                "sp": {"code": "SP", "title": "SURAT PERINGATAN"},
                "panggilan": {"code": "SPG", "title": "SURAT PANGGILAN"},
                "memo": {"code": "IM", "title": "INTERNAL MEMO"},
                "pengumuman": {"code": "PU", "title": "PENGUMUMAN"}}


class LetterIn(BaseModel):
    employee_id: str
    jenis: str  # 'skk' | 'paklaring'
    keperluan: str = ""
    tanggal_keluar: str = ""  # untuk paklaring (override data karyawan)


def _letter_kode(letter_id: str, nomor: str) -> str:
    h = hmac.new(JWT_SECRET.encode(), f"{letter_id}|{nomor}".encode(), hashlib.sha256).hexdigest()[:12].upper()
    return f"{h[:4]}-{h[4:8]}-{h[8:]}"


@router.post("/letters")
async def create_letter(payload: LetterIn, current: dict = Depends(require_hrd_perm("hrd_dokumen", "create"))):
    kind = LETTER_KINDS.get(payload.jenis)
    if not kind:
        raise HTTPException(status_code=400, detail="Jenis surat tidak dikenal")
    emp = await db.hrd_employees.find_one({"id": payload.employee_id, **NOT_DELETED_FILTER}, {"_id": 0})
    if not emp:
        raise HTTPException(status_code=404, detail="Karyawan tidak ditemukan")
    if payload.jenis == "paklaring" and not (payload.tanggal_keluar or emp.get("tanggal_keluar")):
        raise HTTPException(status_code=400, detail="Tanggal keluar wajib diisi untuk Surat Pengalaman Kerja")

    now = datetime.now(timezone.utc)
    ctr = await db.hrd_counters.find_one_and_update(
        {"_id": f"letter_{kind['code']}_{now.year}"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True)
    seq = int(ctr["seq"])
    nomor = f"{kind['code']}/{now.year}/{now.month:02d}/{seq:04d}"
    letter_id = str(uuid.uuid4())
    kode = _letter_kode(letter_id, nomor)
    rec = {
        "id": letter_id, "nomor": nomor, "jenis": payload.jenis, "kode": kode,
        "employee_id": emp["id"], "nama": emp.get("nama", ""), "nik": emp.get("nik", ""),
        "dept": emp.get("dept", ""), "jabatan": emp.get("jabatan", ""),
        "tanggal_masuk": emp.get("tanggal_masuk", ""),
        "tanggal_keluar": payload.tanggal_keluar or emp.get("tanggal_keluar", ""),
        "keperluan": payload.keperluan.strip(),
        "created_by": current.get("name") or current.get("username", ""), "created_at": _now(),
    }
    await db.hrd_letters.insert_one(dict(rec))
    rec.pop("_id", None)
    await log_action(current, "hrd_letter_create", "hrd_letters", letter_id, {"nomor": nomor, "nama": rec["nama"]})
    return rec


@router.post("/letters/preview")
async def preview_letter(payload: LetterIn, current: dict = Depends(require_hrd_perm("hrd_dokumen", "create"))):
    """Preview PDF SKK/Paklaring TANPA menyimpan/menomori."""
    kind = LETTER_KINDS.get(payload.jenis)
    if not kind:
        raise HTTPException(status_code=400, detail="Jenis surat tidak dikenal")
    emp = await db.hrd_employees.find_one({"id": payload.employee_id, **NOT_DELETED_FILTER}, {"_id": 0})
    if not emp:
        raise HTTPException(status_code=404, detail="Karyawan tidak ditemukan")
    rec = {
        "id": "draft", "nomor": "DRAFT — BELUM DITERBITKAN", "jenis": payload.jenis, "kode": "BELUM-TERBIT",
        "employee_id": emp["id"], "nama": emp.get("nama", ""), "nik": emp.get("nik", ""),
        "dept": emp.get("dept", ""), "jabatan": emp.get("jabatan", ""),
        "tanggal_masuk": emp.get("tanggal_masuk", ""),
        "tanggal_keluar": payload.tanggal_keluar or emp.get("tanggal_keluar", ""),
        "keperluan": payload.keperluan.strip(),
    }
    buf = _render_letter_pdf(rec)
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": 'inline; filename="preview_surat.pdf"'})


@router.get("/letters")
async def list_letters(current: dict = Depends(require_hrd_perm("hrd_dokumen", "view"))):
    items = await db.hrd_letters.find(NOT_DELETED_FILTER, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return {"items": items}


@router.delete("/letters/{lid}")
async def delete_letter(lid: str, current: dict = Depends(require_hrd_perm("hrd_dokumen", "delete"))):
    ok = await soft_delete_one("hrd_letters", {"id": lid}, current)
    if not ok:
        raise HTTPException(status_code=404, detail="Surat tidak ditemukan")
    await log_action(current, "hrd_letter_delete", "hrd_letters", lid, {})
    return {"success": True}


class VerifyIn(BaseModel):
    kode: str


@router.post("/letters/verify")
async def verify_letter(payload: VerifyIn, current: dict = Depends(require_hrd_perm("hrd_dokumen", "view"))):
    raw = "".join(ch for ch in payload.kode.upper() if ch.isalnum())
    if len(raw) != 12:
        return {"valid": False, "message": "Format kode tidak valid (12 karakter)"}
    kode = f"{raw[:4]}-{raw[4:8]}-{raw[8:]}"
    rec = await db.hrd_letters.find_one({"kode": kode, **NOT_DELETED_FILTER}, {"_id": 0})
    if not rec:
        return {"valid": False, "message": "Kode tidak terdaftar di sistem — dokumen TIDAK SAH / palsu"}
    # verifikasi ulang HMAC (jaga-jaga bila DB diubah manual)
    if _letter_kode(rec["id"], rec["nomor"]) != kode:
        return {"valid": False, "message": "Kode tidak cocok dengan data surat — dokumen TIDAK SAH"}
    return {"valid": True, "letter": rec}


# ---------------- PDF Surat ----------------
def _letter_qr(rec: dict) -> io.BytesIO:
    kind = LETTER_KINDS[rec["jenis"]]
    lines = ["PT. MITRA KARYA SARANA",
             f"{kind['title'].title()} No: {rec['nomor']}"]
    if rec.get("nama"):
        lines.append(f"Nama: {rec['nama']}" + (f" | NIK: {rec['nik']}" if rec.get("nik") else ""))
    lines.append(f"Kode Verifikasi: {rec['kode']}")
    lines.append("Cek keaslian: hubungi HRD MKS")
    img = qrcode.make("\n".join(lines), box_size=8, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf


def _masa_kerja_text(rec: dict) -> str:
    masuk = _fmt_date_id(rec.get("tanggal_masuk")) if rec.get("tanggal_masuk") else "-"
    if rec["jenis"] == "paklaring":
        keluar = _fmt_date_id(rec.get("tanggal_keluar")) if rec.get("tanggal_keluar") else "-"
        return f"{masuk} s/d {keluar}"
    return f"{masuk} s/d sekarang (karyawan aktif)"


def _watermark_letter(canvas, doc, rec=None):
    from reportlab.lib.pagesizes import A4
    is_sp = bool(rec and rec.get("jenis") == "sp")
    w, h = A4
    # Footer 1 baris (tanpa watermark diagonal)
    canvas.saveState()
    canvas.setStrokeColorRGB(0.80, 0.84, 0.88)
    canvas.setLineWidth(0.5)
    canvas.line(20 * 2.8346, 34, w - 20 * 2.8346, 34)
    canvas.setFont("Helvetica", 6.8)
    canvas.setFillColorRGB(0.42, 0.45, 0.50)
    if is_sp:
        # Kode register dokumen ISO di kiri bawah (kecil)
        canvas.setFont("Helvetica-Bold", 7)
        canvas.drawString(20 * 2.8346, 24, "MKS-F-HRD-019")
    else:
        canvas.drawString(20 * 2.8346, 24,
                          "Dokumen diproses otomatis oleh sistem HRIS PT. Mitra Karya Sarana — sah tanpa tanda tangan basah. Keaslian dijamin kode verifikasi terenkripsi.")
    canvas.setFont("Helvetica", 6.8)
    canvas.drawRightString(w - 20 * 2.8346, 24, f"Hal. {canvas.getPageNumber()}")
    if rec and canvas.getPageNumber() > 1:
        canvas.setFont("Helvetica-Oblique", 7.5)
        canvas.drawCentredString(w / 2, h - 30,
                                 f"Lanjutan {LETTER_KINDS[rec['jenis']]['title'].title()} No. {rec['nomor']}")
    canvas.restoreState()


def _sp_level_roman(t: str) -> str:
    t = str(t or "").upper().replace("SP", "").strip()
    return {"1": "I", "2": "II", "3": "III", "I": "I", "II": "II", "III": "III"}.get(t, "I")


KOP_SURAT_PATH = Path(__file__).resolve().parent.parent / "assets" / "kop_surat.pdf"


def _merge_with_kop(content_buf: io.BytesIO) -> io.BytesIO:
    """Overlay konten surat di atas kop surat resmi (semua dokumen kecuali Slip Gaji)."""
    if not KOP_SURAT_PATH.exists():
        content_buf.seek(0)
        return content_buf
    from pypdf import PdfReader, PdfWriter
    content = PdfReader(content_buf)
    writer = PdfWriter()
    for cp in content.pages:
        bg = PdfReader(str(KOP_SURAT_PATH)).pages[0]
        bg.merge_page(cp)
        writer.add_page(bg)
    out = io.BytesIO()
    writer.write(out)
    out.seek(0)
    return out


def _render_sp_iso_pdf(rec: dict) -> io.BytesIO:
    """Surat Peringatan format ISO MKS-F-HRD-019 (bilingual, tanda tangan basah + QR)."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from xml.sax.saxutils import escape

    DARK = colors.HexColor("#1E293B"); GREY = colors.HexColor("#334155"); LINE = colors.HexColor("#94A3B8")
    MUTE = colors.HexColor("#64748B")
    styles = getSampleStyleSheet()
    lbl = ParagraphStyle("lbl", parent=styles["Normal"], fontSize=9.5, leading=12, textColor=GREY)
    val = ParagraphStyle("val", parent=styles["Normal"], fontSize=10, leading=13, textColor=DARK, fontName="Helvetica-Bold")
    caseS = ParagraphStyle("case", parent=styles["Normal"], fontSize=9.5, leading=14, alignment=4, textColor=DARK)
    ctr = ParagraphStyle("ctr", parent=styles["Normal"], fontSize=9, alignment=1, textColor=GREY)
    en = lambda t: f" <font size=6 color='#64748B'>/ {t}</font>"  # noqa: E731

    buf = io.BytesIO()
    pdf = SimpleDocTemplate(buf, pagesize=A4, topMargin=42 * mm, bottomMargin=20 * mm,
                            leftMargin=20 * mm, rightMargin=20 * mm)
    CW = 170 * mm
    E = []

    E.append(Paragraph("<u>SURAT PERINGATAN</u>", ParagraphStyle("t", parent=styles["Normal"], fontSize=14,
                                                                 alignment=1, fontName="Helvetica-Bold", textColor=DARK)))
    E.append(Spacer(1, 4))
    E.append(Paragraph("WARNING LETTER", ParagraphStyle("t2", parent=styles["Normal"], fontSize=9, alignment=1, textColor=MUTE)))
    E.append(Spacer(1, 2))
    E.append(Paragraph(f"Nomor / Number : {rec['nomor']}", ctr))
    E.append(Spacer(1, 12))

    from datetime import datetime as _dt, timezone as _tz, timedelta as _td
    tgl_terbit = _fmt_date_id(rec.get("created_at")) if rec.get("created_at") else \
        _fmt_date_id(_dt.now(_tz.utc).astimezone(_tz(_td(hours=7))).date().isoformat())
    head = Table([
        [Paragraph("Tanggal" + en("Date"), lbl), ":", tgl_terbit,
         Paragraph("Bagian" + en("Dept"), lbl), ":", rec.get("bagian") or rec.get("dept") or "-"],
    ], colWidths=[26 * mm, 4 * mm, 55 * mm, 22 * mm, 4 * mm, 59 * mm])
    head.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 9.5), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                              ("TEXTCOLOR", (2, 0), (2, 0), DARK), ("TEXTCOLOR", (5, 0), (5, 0), DARK),
                              ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    E.append(head)
    E.append(Spacer(1, 6))

    idt = Table([
        [Paragraph("Nama" + en("Name"), lbl), ":", Paragraph(escape(rec.get("nama", "") or "-"), val)],
        [Paragraph("Jabatan" + en("Designation"), lbl), ":", Paragraph(escape(rec.get("jabatan", "") or "-"), val)],
        [Paragraph("No. Karyawan" + en("Emp. No"), lbl), ":", Paragraph(escape(rec.get("nik", "") or "-"), val)],
    ], colWidths=[42 * mm, 5 * mm, 123 * mm])
    idt.setStyle(TableStyle([("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5)]))
    E.append(idt)
    E.append(Spacer(1, 8))

    E.append(Paragraph("Kasus" + en("Case") + " :", lbl))
    E.append(Spacer(1, 2))
    E.append(Paragraph(escape(rec.get("body") or rec.get("kasus") or "-").replace("\n", "<br/>"), caseS))
    E.append(Spacer(1, 6))
    tgl_kej = _fmt_date_id(rec.get("tgl_kejadian")) if rec.get("tgl_kejadian") else "-"
    E.append(Paragraph("Tanggal Kejadian" + en("Incident Date") + f" : <b>{tgl_kej}</b>", lbl))
    E.append(Spacer(1, 8))

    E.append(Paragraph("Pernyataan" + en("Declaration") + " :", lbl))
    E.append(Spacer(1, 2))
    dl = Table([[""], [""], [""]], colWidths=[CW], rowHeights=[9 * mm, 9 * mm, 9 * mm])
    dl.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE)]))
    E.append(dl)
    E.append(Spacer(1, 8))

    roman = _sp_level_roman(rec.get("tingkat_sp"))
    def lvl_cell(r):
        sel = (r == roman)
        return Paragraph(f"<b>{r}</b>", ParagraphStyle("lc", parent=styles["Normal"], fontSize=11, alignment=1,
                                                       textColor=colors.white if sel else GREY))
    lvl = Table([[Paragraph("Surat Peringatan" + en("Warning Letter") + " :", lbl),
                  lvl_cell("I"), lvl_cell("II"), lvl_cell("III")]],
                colWidths=[92 * mm, 26 * mm, 26 * mm, 26 * mm])
    ls = [("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("BOX", (1, 0), (3, 0), 0.6, LINE),
          ("INNERGRID", (1, 0), (3, 0), 0.6, LINE), ("TOPPADDING", (1, 0), (3, 0), 5), ("BOTTOMPADDING", (1, 0), (3, 0), 5)]
    sel_col = {"I": 1, "II": 2, "III": 3}[roman]
    ls.append(("BACKGROUND", (sel_col, 0), (sel_col, 0), DARK))
    lvl.setStyle(TableStyle(ls))
    E.append(lvl)
    E.append(Spacer(1, 16))

    # Blok tanda tangan basah (Employee / Dept Head / HRD-MR)
    sig = Table([
        [Paragraph("Declared By,", ctr), Paragraph("Issued By,", ctr), Paragraph("Acknowledged By,", ctr)],
        ["", "", ""],
        [Paragraph("(______________)", ctr), Paragraph("(______________)", ctr), Paragraph("(______________)", ctr)],
        [Paragraph("<b>Employee</b>" + en("Karyawan"), ctr), Paragraph("<b>Dept Head</b>" + en("Ka. Bagian"), ctr),
         Paragraph("<b>HRD / MR</b>", ctr)],
    ], colWidths=[CW / 3] * 3, rowHeights=[7 * mm, 16 * mm, 6 * mm, 7 * mm])
    sig.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    E.append(sig)
    E.append(Spacer(1, 10))

    qr_flow = Image(_letter_qr(rec), width=20 * mm, height=20 * mm)
    ver_note = Paragraph(
        f"<b>Verifikasi Keaslian / Authenticity</b> — Kode: <b>{rec['kode']}</b><br/>"
        "Pindai QR lalu cocokkan dengan isi surat. Konfirmasi keaslian: hubungi HRD PT. Mitra Karya Sarana.",
        ParagraphStyle("vn", parent=styles["Normal"], fontSize=7.5, leading=10.5, textColor=GREY))
    grid = Table([[qr_flow, ver_note]], colWidths=[26 * mm, CW - 26 * mm])
    grid.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                              ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
                              ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                              ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6)]))
    E.append(grid)
    E.append(Spacer(1, 4))
    E.append(Paragraph("Cc : Personal File", ParagraphStyle("cc", parent=styles["Normal"], fontSize=8, textColor=MUTE)))

    deco = lambda canvas, doc: _watermark_letter(canvas, doc, rec)  # noqa: E731
    pdf.build(E, onFirstPage=deco, onLaterPages=deco)
    buf.seek(0)
    return buf


def _render_letter_pdf(rec: dict) -> io.BytesIO:
    if rec.get("jenis") == "sp":
        return _merge_with_kop(_render_sp_iso_pdf(rec))
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

    kind = LETTER_KINDS[rec["jenis"]]
    DARK = colors.HexColor("#1E293B")
    GREY = colors.HexColor("#334155")
    LINE = colors.HexColor("#94A3B8")
    styles = getSampleStyleSheet()
    body = ParagraphStyle("b", parent=styles["Normal"], fontSize=10, leading=15, alignment=4)
    small = ParagraphStyle("s", parent=styles["Normal"], fontSize=9)

    buf = io.BytesIO()
    pdf = SimpleDocTemplate(buf, pagesize=A4, topMargin=42 * mm, bottomMargin=16 * mm,
                            leftMargin=20 * mm, rightMargin=20 * mm)
    CW = 170 * mm
    elems = []

    elems.append(Paragraph(f"<u>{kind['title']}{(' ' + rec['tingkat_sp']) if rec.get('tingkat_sp') else ''}</u>",
                           ParagraphStyle("t", parent=styles["Normal"], fontSize=13, alignment=1,
                                          fontName="Helvetica-Bold", textColor=DARK)))
    elems.append(Spacer(1, 3))
    elems.append(Paragraph(f"Nomor : {rec['nomor']}",
                           ParagraphStyle("no", parent=small, alignment=1, textColor=GREY)))
    elems.append(Spacer(1, 14))

    if rec.get("body"):
        # Surat berbasis teks bebas (SP/Panggilan/Memo/Pengumuman dari Draft AI)
        from xml.sax.saxutils import escape
        for para in rec["body"].split("\n\n"):
            if para.strip():
                elems.append(Paragraph(escape(para.strip()).replace("\n", "<br/>"), body))
                elems.append(Spacer(1, 6))
        elems.append(Spacer(1, 10))
    else:
        elems.append(Paragraph("Yang bertanda tangan di bawah ini, Departemen HRD <b>PT. Mitra Karya Sarana</b>, "
                               "dengan ini menerangkan bahwa :", body))
        elems.append(Spacer(1, 8))

    if not rec.get("body"):
        masa = _masa_kerja_text(rec)
        info = Table([
            ["Nama", ":", rec.get("nama", "")],
            ["NIK Karyawan", ":", rec.get("nik", "") or "-"],
            ["Departemen", ":", rec.get("dept", "") or "-"],
            ["Jabatan", ":", rec.get("jabatan", "") or "-"],
            ["Masa Kerja", ":", masa],
        ], colWidths=[38 * mm, 5 * mm, 127 * mm])
        info.setStyle(TableStyle([
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("FONTNAME", (2, 0), (2, 0), "Helvetica-Bold"),
            ("TEXTCOLOR", (0, 0), (0, -1), GREY),
            ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
            ("LEFTPADDING", (0, 0), (0, -1), 12),
        ]))
        elems.append(info)
        elems.append(Spacer(1, 8))

        if rec["jenis"] == "skk":
            elems.append(Paragraph("adalah benar karyawan <b>PT. Mitra Karya Sarana</b> yang masih aktif bekerja "
                                   "sampai dengan surat ini diterbitkan, dan selama bekerja yang bersangkutan menunjukkan "
                                   "dedikasi, loyalitas, serta tanggung jawab yang baik terhadap perusahaan.", body))
        else:
            elems.append(Paragraph("adalah benar pernah bekerja di <b>PT. Mitra Karya Sarana</b> pada periode tersebut di atas. "
                                   "Selama bekerja yang bersangkutan menunjukkan dedikasi, loyalitas, dan tanggung jawab yang baik, "
                                   "serta mengakhiri hubungan kerja dengan baik. Kami mengucapkan terima kasih atas kontribusinya "
                                   "dan mendoakan kesuksesan di masa mendatang.", body))
        elems.append(Spacer(1, 6))
        keperluan = rec.get("keperluan") or "untuk dapat dipergunakan sebagaimana mestinya"
        elems.append(Paragraph(f"Demikian surat keterangan ini dibuat dengan sebenarnya {keperluan}.", body))
        elems.append(Spacer(1, 16))

    qr_flow = Image(_letter_qr(rec), width=20 * mm, height=20 * mm)
    ver_note = Paragraph(
        f"<b>Verifikasi Keaslian</b> — Kode: <b>{rec['kode']}</b><br/>"
        "Pindai QR lalu cocokkan dengan isi surat. Konfirmasi keaslian: hubungi HRD PT. Mitra Karya Sarana dengan menyebutkan kode di atas.",
        ParagraphStyle("vn", parent=styles["Normal"], fontSize=7.5, leading=10.5, textColor=GREY))
    grid = Table([[qr_flow, ver_note]], colWidths=[26 * mm, CW - 26 * mm])
    grid.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    elems.append(grid)

    deco = lambda canvas, doc: _watermark_letter(canvas, doc, rec)  # noqa: E731
    pdf.build(elems, onFirstPage=deco, onLaterPages=deco)
    buf.seek(0)
    return _merge_with_kop(buf)


@router.get("/letters/{lid}/pdf")
async def letter_pdf(lid: str, current: dict = Depends(require_hrd_perm("hrd_dokumen", "view"))):
    rec = await db.hrd_letters.find_one({"id": lid, **NOT_DELETED_FILTER}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Surat tidak ditemukan")
    buf = _render_letter_pdf(rec)
    fname = f"{rec['nomor']}_{rec['nama']}.pdf".replace("/", "-").replace(" ", "_")
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": f'inline; filename="{fname}"'})
