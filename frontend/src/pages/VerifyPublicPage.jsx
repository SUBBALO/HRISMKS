import React, { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { ShieldCheck, SealCheck, XCircle, QrCode } from "@phosphor-icons/react";

const BASE = process.env.REACT_APP_BACKEND_URL;
const rp = (v) => "Rp " + (Number(v) || 0).toLocaleString("id-ID");
const fmtDT = (s) => { try { return new Date(s).toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" }); } catch { return s || "-"; } };

export default function VerifyPublicPage() {
  const [params] = useSearchParams();
  const [kode, setKode] = useState(params.get("kode") || "");
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async (k) => {
    const code = (k || "").trim();
    if (!code) return;
    setBusy(true); setRes(null);
    try {
      const r = await axios.get(`${BASE}/api/hrd/verify/${encodeURIComponent(code)}`);
      setRes(r.data);
    } catch (e) {
      setRes({ valid: false, message: "Gagal menghubungi server verifikasi." });
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { const q = params.get("kode"); if (q) check(q); }, [params, check]);

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-4 py-10" data-testid="public-verify-page">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-6 justify-center">
          <img src="/logo-mks.png" alt="MKS" className="h-11 w-11 rounded-lg bg-white p-1" onError={(e) => { e.target.style.display = "none"; }} />
          <div className="text-white">
            <div className="font-bold leading-tight">PT. Mitra Karya Sarana</div>
            <div className="text-xs text-slate-400">Verifikasi Keaslian Dokumen HRD</div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-6">
          <div className="flex items-center gap-2 text-slate-800 font-bold mb-1"><ShieldCheck size={20} weight="duotone" className="text-rose-600" /> Cek Keaslian Dokumen</div>
          <p className="text-xs text-slate-500 mb-4">Masukkan Kode Verifikasi pada surat / slip gaji, atau pindai QR di dokumen.</p>
          <div className="flex gap-2">
            <Input value={kode} onChange={(e) => setKode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX"
              className="font-mono tracking-wider" onKeyDown={(e) => e.key === "Enter" && check(kode)} data-testid="public-verify-input" />
            <Button className="bg-rose-600 hover:bg-rose-700 shrink-0" onClick={() => check(kode)} disabled={busy} data-testid="public-verify-btn">{busy ? "…" : "Periksa"}</Button>
          </div>

          {res && res.valid && res.type === "letter" && (
            <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-lg p-4" data-testid="public-verify-letter">
              <div className="flex items-center gap-2 text-emerald-700 font-bold text-sm mb-2"><SealCheck size={18} weight="fill" /> DOKUMEN ASLI — terdaftar di sistem HRD</div>
              <div className="text-xs text-slate-600 space-y-1">
                <div><b>Nomor:</b> {res.data.nomor}</div>
                <div><b>Jenis:</b> {res.data.jenis}</div>
                <div><b>Nama:</b> {res.data.nama} {res.data.nik ? `(${res.data.nik})` : ""}</div>
                {res.data.jabatan && <div><b>Jabatan:</b> {res.data.jabatan}</div>}
                <div><b>Diterbitkan:</b> {fmtDT(res.data.created_at)} oleh {res.data.created_by}</div>
              </div>
              <div className="text-[11px] text-emerald-700 mt-2">Cocokkan data di atas dengan isi dokumen fisik. Bila berbeda, dokumen telah dimodifikasi.</div>
            </div>
          )}
          {res && res.valid && res.type === "slip" && (
            <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-lg p-4" data-testid="public-verify-slip">
              <div className="flex items-center gap-2 text-emerald-700 font-bold text-sm mb-2"><SealCheck size={18} weight="fill" /> SLIP GAJI ASLI — terdaftar di sistem HRD</div>
              <div className="text-xs text-slate-600 space-y-1">
                <div><b>No. Dokumen:</b> {res.data.no_dok}</div>
                <div><b>Nama:</b> {res.data.nama} {res.data.nik ? `(${res.data.nik})` : ""}</div>
                <div><b>Periode:</b> {res.data.periode}</div>
                <div><b>Take Home Pay:</b> {rp(res.data.take_home)}</div>
              </div>
              <div className="text-[11px] text-emerald-700 mt-2">Cocokkan nama & nominal dengan slip yang diterima.</div>
            </div>
          )}
          {res && !res.valid && (
            <div className="mt-4 bg-rose-50 border border-rose-200 rounded-lg p-4 flex items-start gap-2" data-testid="public-verify-invalid">
              <XCircle size={18} weight="fill" className="text-rose-600 shrink-0 mt-0.5" />
              <div><div className="text-rose-700 font-bold text-sm">TIDAK TERDAFTAR</div>
                <div className="text-xs text-rose-600 mt-1">{res.message}</div></div>
            </div>
          )}
        </div>
        <div className="text-center text-[11px] text-slate-500 mt-4 flex items-center justify-center gap-1"><QrCode size={12} /> Sistem HRIS PT. Mitra Karya Sarana</div>
      </div>
    </div>
  );
}
