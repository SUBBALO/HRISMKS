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
- 2026-08: PDF slip redesign dengan KOP SURAT resmi perusahaan. User uploaded official letterhead -> stored at `/app/backend/assets/kop_surat.pdf` (compressed 1.1MB->358KB via pymupdf rewrite_images). `_render_slip_pdf()` renders content only (topMargin 44mm) then `_merge_with_kop()` overlays onto kop page via pypdf. Old text header (nama PT + alamat) removed. New layout: dark title band SLIP GAJI + periode, shaded table headers, TAKE HOME PAY highlighted orange box, Terbilang in box. Signature block REMOVED per user request -> replaced with digital-validity block: No. Dokumen (SG/{tahun}/{bulan}/{NIK}), "Diterbitkan secara elektronik oleh HRD", timestamp WIB, "sah tanpa tanda tangan basah", RAHASIA warning. pypdf added to requirements.
- 2026-08: Slip Gaji tab summary strip (Karyawan, Total Take Home, Email Terkirim x/y, Tanpa Email) — data-testid hrd-slip-summary + hrd-slip-sum-*.
- Testing: iteration_1/2/3 all 100% (backend + frontend).

## Backlog
- P1: Bulk email import via a dedicated Data Karyawan Excel/CSV sheet mapping NIK->email.
- P1: Dokumen HRD module (Absensi, Cuti & Izin, Kontrak, Arsip) — currently placeholders.
- P2: Payslip history/audit per employee; export all slips as a zip of PDFs.
- P2: HR dashboard (headcount, payroll totals per period).

## Not Verified / Notes
- Email blast requires real SMTP credentials configured in Pengaturan Email (Host/Port/Username/Password) — not set in demo, so actual sending not tested end-to-end. Recommended: Hostinger Business Email (smtp.hostinger.com, 465 SSL / 587 TLS). Using own domain avoids the Gmail SPF/DKIM 5.7.26 rejection.
