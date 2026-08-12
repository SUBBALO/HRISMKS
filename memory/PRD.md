# PRD — HRIS PT Mitra Karya Sarana

## Problem Statement
Extract ONLY the HRD module from an existing ERP (github.com/SUBBALO/PROCUREMENT) and turn it into a standalone HRIS with its own login and its own database. Preserve business rules: granular access rights (view/create/edit/delete/report per menu), Excel importer that reads per-employee slip sheets marked 'SLIP GAJI', Take Home taken from the Excel PEMBULATAN column, and the company PDF payslip format.

## Architecture
- Backend: FastAPI + MongoDB (motor). JWT auth via httponly cookies (Secure+SameSite=None). Modules: routers/auth.py, routers/hrd.py, deps.py, security.py, services/soft_delete.py, models.py, server.py.
- Frontend: React (CRA/craco) + Tailwind + shadcn/ui + @phosphor-icons/react. Pages: LoginPage, HrdPortalPage, AdminPage. Same-origin API via /api ingress.

## User Personas & Access (as decided by owner)
- susanto (super_admin, pass Subbalo1994): manages users & granular access matrix (/admin). Can access everything EXCEPT Data Gaji. APPROVES Gaji-PIN reset requests but never sets the PIN.
- herliana / "Bu Lia" (hrd, pass 123456): ONLY user who can open the Data Gaji card and manage the Gaji PIN. On forgot-PIN: she requests reset -> susanto approves -> she creates a new PIN herself.
- heri (hrd, pass 123456): only non-payroll menus (Dokumen HRD, Log). Cannot see/enter Data Gaji.

## Core Rules (static)
- NO portal PIN. The only PIN is the Gaji PIN guarding the single "Data Gaji" card (tabs: Slip Gaji, Data Karyawan, Kirim Email, Pengaturan Email).
- Super admin excluded from Gaji access. Gaji access is explicit-grant only (herliana).
- Reset flow: request (herliana) -> approve (susanto) -> set new PIN (herliana, no old PIN needed).
- Importer: sheets with cell A5=='SLIP GAJI'; Take Home = PEMBULATAN (col K). Emails: typed in-app OR from Data Karyawan master OR auto-detected from any email-looking cell in a slip sheet; manual emails preserved on re-import.

## Implemented (2026-06)
- 2026-06: Standalone JWT auth (login/me/logout/refresh, bcrypt, brute-force lockout), user CRUD + granular HRD access matrix (super admin).
- 2026-06: HRD portal — single Data Gaji card + tabs; employees CRUD; Excel slip import (5 sheets, Take Home=PEMBULATAN); company PDF payslip; Gmail SMTP settings + email blast; access log.
- 2026-06: Gaji PIN system (single PIN) with reset workflow (herliana request -> susanto approve -> herliana set new).
- 2026-06: Payslip detail edit dialog (identity, email, earnings/deductions line items with qty/unit, Take Home) + inline email edit in Kirim Email tab + importer email auto-detection.
- 2026-06: Branding — MKS logo, MKS building login background, "Human Resources Information System", credit "Developed by Susanto | Purchasing".
- 2026-06: Flexible SMTP (replaced Gmail-only). Pengaturan Email now has generic SMTP fields: Host, Port, Keamanan (SSL/STARTTLS), Username, Nama Pengirim, Password. Backend `_open_smtp()` branches SSL (SMTP_SSL:465) vs STARTTLS (SMTP+starttls:587); provider-agnostic friendly errors; new `POST /api/hrd/settings/test` (Test Koneksi SMTP button). Verified via curl (save/get/test reaches smtp.hostinger.com). Works with Hostinger Business Email.
- 2026-08: PDF slip redesign v2 — KOP SURAT DIHAPUS atas permintaan HRD (risiko manipulasi/penyalahgunaan untuk surat keterangan palsu). Asset /app/backend/assets/kop_surat.pdf DELETED, _merge_with_kop removed. Template aman: header teks polos "PT. MITRA KARYA SARANA" + subjudul "Dokumen Internal Penggajian — bukan kop surat resmi perusahaan", watermark diagonal transparan "SLIP GAJI • RAHASIA / PT. MITRA KARYA SARANA" di seluruh halaman (via onPage canvas _watermark) agar halaman tak bisa dipakai ulang. Layout tetap: dark title band, shaded headers, TAKE HOME PAY orange, Terbilang box. Tanpa kolom TTD -> blok validasi digital: No. Dokumen SG/{tahun}/{bulan}/{NIK}, diterbitkan elektronik + timestamp WIB, sah tanpa ttd basah, RAHASIA. File ringan ~4KB.
- 2026-08: Slip Gaji tab summary strip (Karyawan, Total Take Home, Email Terkirim x/y, Tanpa Email) — data-testid hrd-slip-summary + hrd-slip-sum-*.
- 2026-08: HRD UPGRADE (Dokumen HRD card, permission hrd_dokumen, NO Gaji PIN): (1) Database Karyawan lengkap (pribadi/KTP/TTL/alamat, kepegawaian/status/tgl masuk-keluar, BPJS TK+Kes/NPWP/bank/rek, kontak darurat, catatan) — collection hrd_employees shared dg payroll email mapping; (2) Upload dokumen karyawan (KTP/KK/Ijazah/NPWP/BPJS/Kontrak/CV/Sertifikat/Pas Foto/Lainnya; PDF/JPG/PNG/WEBP max 10MB; disk /app/backend/uploads/employees/{emp_id}/; collection hrd_emp_docs); (3) Surat Kerja generator: SKK + Paklaring (SPK), nomor auto {SKK|SPK}/{tahun}/{bulan}/{seq} via hrd_counters, kode verifikasi HMAC(JWT_SECRET) XXXX-XXXX-XXXX, QR di PDF (qrcode lib), arsip hrd_letters, delete=kode jadi tidak sah; (4) Verifikasi: POST /api/hrd/letters/verify -> ASLI/TIDAK TERDAFTAR. Backend: /app/backend/routers/hrd_people.py. Frontend: /app/frontend/src/pages/HrdDokumen.jsx. Testing agent iteration_7: backend 10/10 + frontend 100% (1 null-guard fix by tester di PersonDialog line 188 — preserve). Backend tests: /app/backend/tests/test_hrd_dokumen.py (run: pytest -o addopts='').
- 2026-08: UI revisi per user: Dokumen HRD landing per-KARTU (dok-card-karyawan/surat/verifikasi + dok-back, bukan tabs); klik baris karyawan -> popup detail lengkap (person-detail-dialog: avatar, badge, seksi data, tombol Edit); dokumen tampil kartu compact berwarna per jenis (docs-panel, doc-row-{id}) + PREVIEW inline (doc-preview-dialog: img utk gambar, iframe utk PDF, tombol Unduh). Verified via screenshot.
- 2026-08: SEMUA MENU HR BARU dibangun (user: "ok buatkan semua") + UI overhaul SIDEBAR modern (ganti card home): (1) Dashboard HR /api/hrd/dashboard — stat cards, bar chart dept + pie status (recharts), widget Kontrak Hampir Habis (<=90 hari, merah <=30), Ulang Tahun bulan ini, Kelengkapan Dokumen (wajib: KTP, KK, Ijazah, Kontrak Kerja; pct bar), banner Pengumuman; (2) Cuti & Izin — kuota 12 hari/tahun, jenis Cuti Tahunan/Sakit/Izin/Cuti Khusus, auto-hitung jumlah hari, tab Riwayat + Saldo, filter tahun; (3) Absensi rekap bulanan — grid input hadir/terlambat/absen/izin/sakit/cuti per karyawan, upsert by (emp,year,month); (4) Penilaian Kinerja — 5 kriteria skor 1-5 (clamp), rata otomatis + warna; (5) Struktur Organisasi — kartu per dept dari database karyawan; (6) Pengumuman Internal — CRUD + flag PENTING, tampil di Beranda (GET=require_hrd semua user, write=hrd_dokumen); (7) Riwayat Karir — panel di popup detail karyawan (Promosi/Mutasi/Kenaikan Gaji/SP/Kontrak Baru). Backend: /app/backend/routers/hrd_extras.py. Frontend: HrdDashboard.jsx, HrdModules.jsx, sidebar di HrdPortalPage.jsx (testid hrd-sidebar, hrd-nav-*; hrd-card-gaji/dokumen/logs dipertahankan; tombol "Menu HRD" back dihapus), CareerPanel di HrdDokumen.jsx. Testing iteration_8: backend 18/18 + frontend 100% semua flow + regression PIN gaji aman. Tests: /app/backend/tests/test_hrd_extras.py.

## Backlog
- P1: Bulk email import via a dedicated Data Karyawan Excel/CSV sheet mapping NIK->email.
- P1: Dokumen HRD module (Absensi, Cuti & Izin, Kontrak, Arsip) — currently placeholders.
- P2: Payslip history/audit per employee; export all slips as a zip of PDFs.
- P2: HR dashboard (headcount, payroll totals per period).

## Not Verified / Notes
- Email blast requires real SMTP credentials configured in Pengaturan Email (Host/Port/Username/Password) — not set in demo, so actual sending not tested end-to-end. Recommended: Hostinger Business Email (smtp.hostinger.com, 465 SSL / 587 TLS). Using own domain avoids the Gmail SPF/DKIM 5.7.26 rejection.
