"""Fitur AI HRD: Screening CV pelamar (ekstraksi + skor kecocokan) dan Draft Surat otomatis.
Menggunakan Emergent LLM Key. Permission: hrd_dokumen."""
import json
import os
import re
import uuid
from pathlib import Path

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from db import db
from deps import log_action
from services.soft_delete import NOT_DELETED_FILTER, soft_delete_one
from routers.hrd import require_hrd_perm, _now

load_dotenv()
LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

router = APIRouter(prefix="/hrd", tags=["hrd-ai"])

CV_DIR = Path(__file__).resolve().parent.parent / "uploads" / "cv"
CV_EXT = {".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
          ".png": "image/png", ".webp": "image/webp"}
CANDIDATE_STATUSES = ["Baru", "Interview", "Diterima", "Ditolak"]


def _parse_json(text: str) -> dict:
    t = re.sub(r"^```(json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    m = re.search(r"\{.*\}", t, re.DOTALL)
    if not m:
        raise ValueError("AI tidak mengembalikan JSON")
    return json.loads(m.group(0))


# ---------------- Screening CV ----------------
@router.post("/candidates/upload-cv")
async def upload_cv(file: UploadFile = File(...), job_desc: str = Form(""),
                    current: dict = Depends(require_hrd_perm("hrd_dokumen", "create"))):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in CV_EXT:
        raise HTTPException(status_code=400, detail="CV harus PDF/JPG/PNG/WEBP")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Ukuran CV maksimal 10 MB")
    cid = str(uuid.uuid4())
    CV_DIR.mkdir(parents=True, exist_ok=True)
    path = CV_DIR / f"{cid}{ext}"
    path.write_bytes(data)

    from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContentWithMimeType
    chat = LlmChat(api_key=LLM_KEY, session_id=f"cv-{cid}",
                   system_message="Kamu asisten HRD yang mengekstrak data CV pelamar. Jawab HANYA dengan JSON valid, tanpa penjelasan lain.").with_model("gemini", "gemini-2.5-flash")
    skor_part = ""
    if job_desc.strip():
        skor_part = (f'\nUraian jabatan yang dilamar: "{job_desc.strip()}"\n'
                     'Tambahkan juga field "skor" (integer 0-100, kecocokan kandidat dengan uraian jabatan) '
                     'dan "alasan_skor" (1-2 kalimat bahasa Indonesia).')
    prompt = ("Ekstrak data dari CV terlampir ke JSON dengan field: "
              '"nama", "email", "telp", "alamat", "tanggal_lahir" (YYYY-MM-DD atau ""), '
              '"pendidikan" (array string, terbaru dulu), "pengalaman" (array string ringkas "posisi - perusahaan - periode"), '
              '"skill" (array string), "ringkasan" (2-3 kalimat bahasa Indonesia tentang kandidat).'
              " Bila info tidak ada, isi string kosong / array kosong." + skor_part)
    try:
        resp = await chat.send_message(UserMessage(
            text=prompt, file_contents=[FileContentWithMimeType(file_path=str(path), mime_type=CV_EXT[ext])]))
        parsed = _parse_json(str(resp))
    except Exception as e:
        path.unlink(missing_ok=True)
        raise HTTPException(status_code=502, detail=f"AI gagal membaca CV: {e}")

    rec = {
        "id": cid, "filename": file.filename, "ext": ext,
        "nama": parsed.get("nama") or "", "email": parsed.get("email") or "", "telp": parsed.get("telp") or "",
        "alamat": parsed.get("alamat") or "", "tanggal_lahir": parsed.get("tanggal_lahir") or "",
        "pendidikan": parsed.get("pendidikan") or [], "pengalaman": parsed.get("pengalaman") or [],
        "skill": parsed.get("skill") or [], "ringkasan": parsed.get("ringkasan") or "",
        "job_desc": job_desc.strip(), "skor": parsed.get("skor"), "alasan_skor": parsed.get("alasan_skor") or "",
        "status": "Baru", "created_by": current.get("name") or current.get("username", ""), "created_at": _now(),
    }
    await db.hrd_candidates.insert_one(dict(rec))
    rec.pop("_id", None)
    await log_action(current, "hrd_cv_screen", "hrd_candidates", cid, {"nama": rec["nama"]})
    return rec


@router.get("/candidates")
async def list_candidates(current: dict = Depends(require_hrd_perm("hrd_dokumen", "view"))):
    items = await db.hrd_candidates.find(NOT_DELETED_FILTER, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"items": items, "statuses": CANDIDATE_STATUSES}


class StatusIn(BaseModel):
    status: str


@router.put("/candidates/{cid}/status")
async def set_candidate_status(cid: str, payload: StatusIn, current: dict = Depends(require_hrd_perm("hrd_dokumen", "edit"))):
    if payload.status not in CANDIDATE_STATUSES:
        raise HTTPException(status_code=400, detail="Status tidak dikenal")
    r = await db.hrd_candidates.update_one({"id": cid, **NOT_DELETED_FILTER}, {"$set": {"status": payload.status}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Kandidat tidak ditemukan")
    return {"success": True}


@router.get("/candidates/{cid}/cv")
async def download_cv(cid: str, current: dict = Depends(require_hrd_perm("hrd_dokumen", "view"))):
    rec = await db.hrd_candidates.find_one({"id": cid, **NOT_DELETED_FILTER}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Kandidat tidak ditemukan")
    path = CV_DIR / f"{cid}{rec['ext']}"
    if not path.exists():
        raise HTTPException(status_code=404, detail="File CV tidak ditemukan")
    import io
    return StreamingResponse(io.BytesIO(path.read_bytes()), media_type=CV_EXT.get(rec["ext"], "application/pdf"),
                             headers={"Content-Disposition": f'inline; filename="{rec["filename"]}"'})


@router.delete("/candidates/{cid}")
async def delete_candidate(cid: str, current: dict = Depends(require_hrd_perm("hrd_dokumen", "delete"))):
    ok = await soft_delete_one("hrd_candidates", {"id": cid}, current)
    if not ok:
        raise HTTPException(status_code=404, detail="Kandidat tidak ditemukan")
    return {"success": True}


@router.post("/candidates/{cid}/hire")
async def hire_candidate(cid: str, current: dict = Depends(require_hrd_perm("hrd_dokumen", "create"))):
    rec = await db.hrd_candidates.find_one({"id": cid, **NOT_DELETED_FILTER}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Kandidat tidak ditemukan")
    emp = {
        "id": str(uuid.uuid4()), "nama": rec.get("nama") or "", "nik": "", "nik_ktp": "",
        "tempat_lahir": "", "tanggal_lahir": rec.get("tanggal_lahir") or "", "jenis_kelamin": "", "agama": "",
        "status_kawin": "", "pendidikan": (rec.get("pendidikan") or [""])[0], "alamat": rec.get("alamat") or "",
        "telp": rec.get("telp") or "", "email": rec.get("email") or "", "dept": "", "jabatan": "",
        "status_karyawan": "", "tanggal_masuk": "", "tanggal_keluar": "", "bank": "", "no_rekening": "",
        "npwp": "", "no_bpjs_tk": "", "no_bpjs_kes": "", "kontak_darurat_nama": "", "kontak_darurat_telp": "",
        "catatan": f"Direkrut dari screening CV ({rec.get('filename')})", "active": True,
        "created_at": _now(), "updated_at": _now(),
    }
    await db.hrd_employees.insert_one(dict(emp))
    emp.pop("_id", None)
    await db.hrd_candidates.update_one({"id": cid}, {"$set": {"status": "Diterima"}})
    await log_action(current, "hrd_candidate_hire", "hrd_employees", emp["id"], {"nama": emp["nama"]})
    return emp


# ---------------- Draft Surat AI ----------------
DRAFT_KINDS = {
    "sp": "Surat Peringatan (SP)",
    "panggilan": "Surat Panggilan",
    "memo": "Internal Memo",
    "pengumuman": "Pengumuman",
}


class DraftIn(BaseModel):
    jenis: str
    employee_id: str = ""
    tingkat_sp: str = ""  # SP1/SP2/SP3
    kronologi: str


@router.post("/ai/draft-letter")
async def draft_letter(payload: DraftIn, current: dict = Depends(require_hrd_perm("hrd_dokumen", "create"))):
    kind = DRAFT_KINDS.get(payload.jenis)
    if not kind:
        raise HTTPException(status_code=400, detail="Jenis draft tidak dikenal")
    if not payload.kronologi.strip():
        raise HTTPException(status_code=400, detail="Kronologi/isi singkat wajib diisi")
    emp_info = ""
    if payload.employee_id:
        emp = await db.hrd_employees.find_one({"id": payload.employee_id, **NOT_DELETED_FILTER}, {"_id": 0})
        if emp:
            emp_info = (f"\nData karyawan terkait: Nama {emp.get('nama')}, NIK {emp.get('nik') or '-'}, "
                        f"Jabatan {emp.get('jabatan') or '-'}, Departemen {emp.get('dept') or '-'}.")
    sp_info = f" Tingkat: {payload.tingkat_sp}." if payload.jenis == "sp" and payload.tingkat_sp else ""

    from emergentintegrations.llm.chat import LlmChat, UserMessage
    from datetime import datetime, timezone, timedelta
    tgl = datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=7)))
    BULAN = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]
    tgl_str = f"{tgl.day} {BULAN[tgl.month]} {tgl.year}"
    chat = LlmChat(api_key=LLM_KEY, session_id=f"draft-{uuid.uuid4().hex[:8]}",
                   system_message=("Kamu staf HRD senior PT. Mitra Karya Sarana (perusahaan manufaktur di Batam). "
                                   "Tulis surat resmi berbahasa Indonesia yang formal, sopan, ringkas, dan sesuai norma ketenagakerjaan Indonesia. "
                                   "Keluarkan HANYA isi surat (tanpa kop, tanpa judul surat, tanpa nomor surat, tanpa penjelasan tambahan). "
                                   "JANGAN menulis blok tanda tangan, 'Hormat kami', 'Batam, [tanggal]', atau nama penandatangan — "
                                   "dokumen diterbitkan elektronik oleh sistem. Akhiri cukup dengan kalimat penutup. "
                                   f"Bila perlu menyebut tanggal hari ini, gunakan {tgl_str}.")).with_model("openai", "gpt-5.4")
    prompt = (f"Buat draft {kind}.{sp_info}{emp_info}\n"
              f"Kronologi/poin dari HRD: {payload.kronologi.strip()}\n"
              "Struktur: pembuka, isi (uraikan kronologi secara profesional), penutup dengan konsekuensi/harapan yang wajar.")
    try:
        resp = await chat.send_message(UserMessage(text=prompt))
        draft = str(resp).strip()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI gagal membuat draft: {e}")
    await log_action(current, "hrd_ai_draft", "hrd_ai", payload.jenis, {"jenis": kind})
    return {"draft": draft, "jenis": kind}


# ---------------- OCR KTP ----------------
@router.post("/ai/ocr-ktp")
async def ocr_ktp(file: UploadFile = File(...), current: dict = Depends(require_hrd_perm("hrd_dokumen", "create"))):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in CV_EXT:
        raise HTTPException(status_code=400, detail="Foto KTP harus JPG/PNG/WEBP/PDF")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Ukuran file maksimal 10 MB")
    tmp = CV_DIR / f"ktp-{uuid.uuid4().hex[:8]}{ext}"
    CV_DIR.mkdir(parents=True, exist_ok=True)
    tmp.write_bytes(data)
    from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContentWithMimeType
    chat = LlmChat(api_key=LLM_KEY, session_id=f"ktp-{uuid.uuid4().hex[:8]}",
                   system_message="Kamu asisten HRD yang membaca KTP Indonesia. Jawab HANYA dengan JSON valid.").with_model("gemini", "gemini-2.5-flash")
    prompt = ('Baca KTP terlampir, keluarkan JSON: "nik_ktp" (16 digit), "nama", "tempat_lahir", '
              '"tanggal_lahir" (YYYY-MM-DD), "jenis_kelamin" ("Laki-laki"/"Perempuan"), "alamat" (gabungan alamat+RT/RW+kel+kec+kota), '
              '"agama", "status_kawin" ("Belum Kawin"/"Kawin"/"Cerai Hidup"/"Cerai Mati"). Bila tidak terbaca, isi "".')
    try:
        resp = await chat.send_message(UserMessage(
            text=prompt, file_contents=[FileContentWithMimeType(file_path=str(tmp), mime_type=CV_EXT[ext])]))
        parsed = _parse_json(str(resp))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI gagal membaca KTP: {e}")
    finally:
        tmp.unlink(missing_ok=True)
    await log_action(current, "hrd_ocr_ktp", "hrd_employees", "-", {"nama": parsed.get("nama", "")})
    return {k: parsed.get(k) or "" for k in ["nik_ktp", "nama", "tempat_lahir", "tanggal_lahir",
                                             "jenis_kelamin", "alamat", "agama", "status_kawin"]}


# ---------------- Arsipkan surat AI (nomor terpusat + QR) ----------------
class SaveLetterIn(BaseModel):
    jenis: str  # sp / panggilan / memo / pengumuman
    employee_id: str = ""
    tingkat_sp: str = ""
    body: str


@router.post("/ai/save-letter")
async def save_ai_letter(payload: SaveLetterIn, current: dict = Depends(require_hrd_perm("hrd_dokumen", "create"))):
    from routers.hrd_people import LETTER_KINDS, _letter_kode
    from datetime import datetime, timezone
    kind = LETTER_KINDS.get(payload.jenis)
    if not kind or payload.jenis in ("skk", "paklaring"):
        raise HTTPException(status_code=400, detail="Jenis surat tidak valid")
    if not payload.body.strip():
        raise HTTPException(status_code=400, detail="Isi surat kosong")
    emp = None
    if payload.employee_id:
        emp = await db.hrd_employees.find_one({"id": payload.employee_id, **NOT_DELETED_FILTER}, {"_id": 0})
    now = datetime.now(timezone.utc)
    ctr = await db.hrd_counters.find_one_and_update(
        {"_id": f"letter_{kind['code']}_{now.year}"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True)
    nomor = f"{kind['code']}/{now.year}/{now.month:02d}/{int(ctr['seq']):04d}"
    lid = str(uuid.uuid4())
    rec = {
        "id": lid, "nomor": nomor, "jenis": payload.jenis, "kode": _letter_kode(lid, nomor),
        "tingkat_sp": payload.tingkat_sp, "body": payload.body.strip(),
        "employee_id": emp["id"] if emp else "", "nama": emp.get("nama", "") if emp else "",
        "nik": emp.get("nik", "") if emp else "", "dept": emp.get("dept", "") if emp else "",
        "jabatan": emp.get("jabatan", "") if emp else "",
        "tanggal_masuk": "", "tanggal_keluar": "", "keperluan": "",
        "created_by": current.get("name") or current.get("username", ""), "created_at": _now(),
    }
    await db.hrd_letters.insert_one(dict(rec))
    rec.pop("_id", None)
    if payload.jenis == "sp" and emp:
        await db.hrd_career.insert_one({
            "id": str(uuid.uuid4()), "employee_id": emp["id"], "nama": emp.get("nama", ""),
            "tanggal": now.date().isoformat(), "jenis": "Surat Peringatan",
            "keterangan": f"{payload.tingkat_sp or 'SP'} — {nomor}",
            "created_by": rec["created_by"], "created_at": _now()})
    await log_action(current, "hrd_ai_letter_save", "hrd_letters", lid, {"nomor": nomor})
    return rec

