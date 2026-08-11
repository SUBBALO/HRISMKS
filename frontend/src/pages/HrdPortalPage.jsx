import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import api, { formatRupiah, formatDateTimeWIB, formatApiErrorDetail } from "../lib/api";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Checkbox } from "../components/ui/checkbox";
import {
  UsersThree, Receipt, EnvelopeSimple, Gear, ClockCounterClockwise, Lock, LockKey,
  ArrowLeft, Plus, Trash, PencilSimple, FilePdf, DownloadSimple, UploadSimple,
  ShieldCheck, PaperPlaneTilt, MagnifyingGlass, WarningCircle, CheckCircle, XCircle,
  FolderSimple, Key, Money,
} from "@phosphor-icons/react";

const BULAN = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const now = new Date();
const CURRENT_YEAR = now.getFullYear();
const errMsg = (e) => formatApiErrorDetail(e?.response?.data?.detail) || e?.message || "Terjadi kesalahan";
const ALL = { view: true, create: true, edit: true, delete: true, report: true };

// Bangun payload PayslipIn dari objek slip (untuk PUT update)
const slipToPayload = (s, patch = {}) => ({
  period_month: s.period_month, period_year: s.period_year,
  employee_id: s.employee_id || null,
  nik: s.nik || "", nama: s.nama || "", email: s.email || "",
  jabatan: s.jabatan || "", dept: s.dept || "Production",
  no_rekening: s.no_rekening || "", bank: s.bank || "",
  earnings: (s.earnings || []).map((e) => ({ label: e.label || "", amount: Number(e.amount) || 0, qty: e.qty ?? null, unit: e.unit ?? null })),
  deductions: (s.deductions || []).map((e) => ({ label: e.label || "", amount: Number(e.amount) || 0, qty: e.qty ?? null, unit: e.unit ?? null })),
  take_home: s.take_home ?? null, tanggal_lahir: s.tanggal_lahir || "", terbilang: s.terbilang || "", notes: s.notes || "",
  ...patch,
});

/* ============================ Main ============================ */
export default function HrdPortalPage() {
  const navigate = useNavigate();
  const [meta, setMeta] = useState(null);   // /hrd/my-access
  const [gajiToken, setGajiToken] = useState("");
  const [section, setSection] = useState("home");
  const [gajiPinMode, setGajiPinMode] = useState(null); // 'create' | 'verify'
  const [resetApplyOpen, setResetApplyOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [changePinOpen, setChangePinOpen] = useState(false);

  const loadMeta = useCallback(async () => {
    try { const r = await api.get("/hrd/my-access"); setMeta(r.data); }
    catch (e) { setMeta({ can_enter: false }); }
  }, []);
  useEffect(() => { loadMeta(); }, [loadMeta]);

  const hapi = useMemo(() => {
    const headers = () => ({ "x-hrd-gaji": gajiToken });
    const wrap = (p) => p.catch((e) => {
      if (e?.response?.status === 401 && /PIN Gaji/i.test(errMsg(e))) setGajiToken("");
      throw e;
    });
    return {
      get: (url, config = {}) => wrap(api.get(url, { ...config, headers: { ...(config.headers || {}), ...headers() } })),
      post: (url, data, config = {}) => wrap(api.post(url, data, { ...config, headers: { ...(config.headers || {}), ...headers() } })),
      put: (url, data, config = {}) => wrap(api.put(url, data, { ...config, headers: { ...(config.headers || {}), ...headers() } })),
      delete: (url, config = {}) => wrap(api.delete(url, { ...config, headers: { ...(config.headers || {}), ...headers() } })),
    };
  }, [gajiToken]);

  if (meta == null) {
    return <div className="min-h-[calc(100vh-60px)] bg-slate-50 flex items-center justify-center text-slate-400">Memuat Portal HRD…</div>;
  }
  if (!meta.can_enter) {
    return (
      <div className="min-h-[calc(100vh-60px)] bg-slate-50 flex items-center justify-center p-6" data-testid="hrd-access-denied">
        <Card className="max-w-md w-full p-8 text-center space-y-3">
          <Lock size={40} weight="duotone" className="mx-auto text-rose-500" />
          <h2 className="text-lg font-bold text-slate-800">Akses Ditolak</h2>
          <p className="text-sm text-slate-500">Anda tidak memiliki akses ke Portal HRD.</p>
          <Button variant="outline" onClick={() => navigate("/")} data-testid="hrd-back-home">Kembali</Button>
        </Card>
      </div>
    );
  }

  const access = meta.access || {};
  const hasGajiAccess = (meta.gaji_group || []).some((k) => access[k] && access[k].view);

  const openGaji = () => {
    if (gajiToken) { setSection("gaji"); return; }
    // Selalu ke input PIN biasa. Reset PIN hanya lewat tombol khusus di header (bila lupa).
    setGajiPinMode(meta.gaji_pin_set ? "verify" : "create");
  };

  return (
    <div className="min-h-[calc(100vh-60px)] bg-slate-50 text-slate-900">
      <div className="max-w-[1400px] mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 flex items-center justify-center bg-white border border-slate-200 rounded-md p-0.5 shrink-0">
              <img src="/logo-mks.png" alt="MKS" className="w-full h-full object-contain" />
            </span>
            <div>
              <h1 className="text-xl font-bold tracking-tight" style={{ fontFamily: "Chivo, sans-serif" }}>Portal HRD</h1>
              <p className="text-xs text-slate-500">PT Mitra Karya Sarana — Data bersifat rahasia</p>
            </div>
            {gajiToken && <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 ml-1 gap-1"><LockKey size={13} weight="fill" /> Gaji terbuka</Badge>}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Susanto: notifikasi permintaan reset PIN */}
            {meta.can_approve_reset && meta.gaji_reset_pending > 0 && (
              <Button size="sm" className="gap-1.5 bg-amber-500 hover:bg-amber-600 animate-pulse" onClick={() => setApproveOpen(true)} data-testid="hrd-approve-notif">
                <WarningCircle size={15} weight="fill" /> Persetujuan Reset PIN ({meta.gaji_reset_pending})
              </Button>
            )}
            {/* Herliana: reset sudah disetujui → buat PIN baru */}
            {meta.can_manage_gaji_pin && meta.gaji_reset_approved && (
              <Button size="sm" className="gap-1.5 bg-rose-600 hover:bg-rose-700 animate-pulse" onClick={() => setResetApplyOpen(true)} data-testid="hrd-reset-notif">
                <Key size={15} weight="fill" /> Buat PIN Gaji Baru
              </Button>
            )}
            {section !== "home" && (
              <Button variant="outline" size="sm" onClick={() => setSection("home")} data-testid="hrd-nav-home" className="gap-1.5">
                <ArrowLeft size={15} weight="bold" /> Menu HRD
              </Button>
            )}
            {meta.can_manage_gaji_pin && meta.gaji_pin_set && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setChangePinOpen(true)} data-testid="hrd-change-gajipin">
                <LockKey size={15} weight="bold" /> Ubah PIN Gaji
              </Button>
            )}
            {gajiToken && <Button variant="ghost" size="sm" className="text-slate-500" onClick={() => { setGajiToken(""); setSection("home"); }} data-testid="hrd-lock-gaji">Kunci Gaji</Button>}
          </div>
        </div>

        {section === "home" && <HrdHome access={access} isSuper={meta.is_super} hasGajiAccess={hasGajiAccess} gajiPinSet={meta.gaji_pin_set} gajiUnlocked={!!gajiToken} onOpenGaji={openGaji} onOpen={setSection} />}
        {section === "gaji" && <GajiArea hapi={hapi} can={ALL} onGoTab={() => {}} />}
        {section === "dokumen" && <DokumenSection />}
        {section === "logs" && <LogsSection hapi={hapi} />}
      </div>

      {/* Gaji PIN dialog (create/verify) */}
      <GajiPinDialog mode={gajiPinMode} canManage={meta.can_manage_gaji_pin} onClose={() => setGajiPinMode(null)}
        onCreate={async (pin) => {
          await api.post("/hrd/set-pin", { pin });
          const r = await api.post("/hrd/verify-pin", { pin });
          setGajiToken(r.data.gaji_token); setGajiPinMode(null); setSection("gaji"); await loadMeta();
          toast.success("PIN Gaji dibuat & menu Gaji terbuka");
        }}
        onVerify={async (pin) => {
          const r = await api.post("/hrd/verify-pin", { pin });
          setGajiToken(r.data.gaji_token); setGajiPinMode(null); setSection("gaji");
        }}
        onRequestReset={async () => {
          await api.post("/hrd/gaji-pin/request-reset", { reason: "Lupa PIN Gaji — mohon reset" });
          await loadMeta();
        }} />

      {/* Ubah PIN Gaji (dengan PIN lama) */}
      <ChangeGajiPinDialog open={changePinOpen} onClose={() => setChangePinOpen(false)}
        onSave={async (oldPin, newPin) => {
          await api.post("/hrd/set-pin", { pin: newPin, current_pin: oldPin });
          setChangePinOpen(false); setGajiToken(""); toast.success("PIN Gaji berhasil diubah"); await loadMeta();
        }} />

      {/* Susanto approve reset */}
      <ApproveResetDialog open={approveOpen} onClose={() => setApproveOpen(false)}
        onLoad={async () => (await api.get("/hrd/gaji-pin/reset-requests")).data.items}
        onApprove={async (id) => { await api.post("/hrd/gaji-pin/approve-reset", { request_id: id }); await loadMeta(); }} />

      {/* Herliana buat PIN baru setelah disetujui */}
      <ResetApplyDialog open={resetApplyOpen} onClose={() => setResetApplyOpen(false)}
        onApply={async (pin) => {
          await api.post("/hrd/gaji-pin/reset-apply", { pin });
          setResetApplyOpen(false); setGajiToken(""); await loadMeta();
          toast.success("PIN Gaji baru berhasil dibuat");
        }} />
    </div>
  );
}

/* ============================ Home (cards) ============================ */
function HrdHome({ access, isSuper, hasGajiAccess, gajiPinSet, gajiUnlocked, onOpenGaji, onOpen }) {
  const showDokumen = isSuper || (access.hrd_dokumen && access.hrd_dokumen.view);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="hrd-home">
      {hasGajiAccess && (
        <button onClick={onOpenGaji} data-testid="hrd-card-gaji"
          className="group relative text-left bg-white border border-emerald-200 rounded-lg p-5 hover:border-emerald-400 hover:shadow-md transition-all duration-200">
          <span className="absolute top-3 right-3 text-emerald-500" title={gajiUnlocked ? "Terbuka" : "Terkunci PIN Gaji"}>
            {gajiUnlocked ? <CheckCircle size={16} weight="fill" /> : <LockKey size={16} weight="fill" />}
          </span>
          <span className="w-11 h-11 flex items-center justify-center bg-emerald-50 border border-emerald-200 rounded-md mb-3">
            <Money size={22} weight="duotone" className="text-emerald-600" />
          </span>
          <div className="text-base font-bold text-slate-800" style={{ fontFamily: "Chivo, sans-serif" }}>Data Gaji</div>
          <div className="text-xs text-slate-500 mt-1 leading-relaxed">Slip gaji, kirim email slip, & pengaturan email. Area khusus terkunci PIN Gaji.</div>
          {!gajiPinSet && <Badge className="mt-3 bg-amber-100 text-amber-700 hover:bg-amber-100">PIN belum dibuat</Badge>}
        </button>
      )}
      {showDokumen && (
        <button onClick={() => onOpen("dokumen")} data-testid="hrd-card-dokumen"
          className="group relative text-left bg-white border border-slate-200 rounded-lg p-5 hover:border-slate-400 hover:shadow-md transition-all duration-200">
          <span className="w-11 h-11 flex items-center justify-center bg-rose-50 border border-rose-200 rounded-md mb-3"><FolderSimple size={22} weight="duotone" className="text-rose-600" /></span>
          <div className="text-base font-bold text-slate-800" style={{ fontFamily: "Chivo, sans-serif" }}>Dokumen HRD</div>
          <div className="text-xs text-slate-500 mt-1 leading-relaxed">Absensi, cuti, kontrak, arsip karyawan (segera).</div>
        </button>
      )}
      <button onClick={() => onOpen("logs")} data-testid="hrd-card-logs"
        className="group relative text-left bg-white border border-slate-200 rounded-lg p-5 hover:border-slate-400 hover:shadow-md transition-all duration-200">
        <span className="w-11 h-11 flex items-center justify-center bg-slate-100 border border-slate-200 rounded-md mb-3"><ClockCounterClockwise size={22} weight="duotone" className="text-slate-600" /></span>
        <div className="text-base font-bold text-slate-800" style={{ fontFamily: "Chivo, sans-serif" }}>Log Akses</div>
        <div className="text-xs text-slate-500 mt-1 leading-relaxed">Catatan akses portal & perubahan PIN.</div>
      </button>
    </div>
  );
}

/* ============================ Gaji Area (tabs) ============================ */
function GajiArea({ hapi, can }) {
  return (
    <div data-testid="hrd-gaji-area">
      <div className="flex items-center gap-2 mb-4">
        <Money size={22} weight="duotone" className="text-emerald-600" />
        <h2 className="text-lg font-bold text-slate-800" style={{ fontFamily: "Chivo, sans-serif" }}>Data Gaji</h2>
        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 gap-1"><LockKey size={12} weight="fill" /> Area rahasia</Badge>
      </div>
      <Tabs defaultValue="slip" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="slip" data-testid="gaji-tab-slip">Slip Gaji</TabsTrigger>
          <TabsTrigger value="karyawan" data-testid="gaji-tab-karyawan">Data Karyawan</TabsTrigger>
          <TabsTrigger value="email" data-testid="gaji-tab-email">Kirim Email</TabsTrigger>
          <TabsTrigger value="settings" data-testid="gaji-tab-settings">Pengaturan Email</TabsTrigger>
        </TabsList>
        <TabsContent value="slip"><PayslipsSection hapi={hapi} can={can} /></TabsContent>
        <TabsContent value="karyawan"><EmployeesSection hapi={hapi} can={can} /></TabsContent>
        <TabsContent value="email"><EmailSection hapi={hapi} can={can} /></TabsContent>
        <TabsContent value="settings"><SettingsSection hapi={hapi} can={can} /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ============================ Gaji PIN dialog (create/verify) ============================ */
function GajiPinDialog({ mode, onClose, onCreate, onVerify, onRequestReset, canManage }) {
  const open = !!mode;
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reqBusy, setReqBusy] = useState(false);
  const [reqDone, setReqDone] = useState(false);
  const clean = (v) => v.replace(/\D/g, "");
  useEffect(() => { if (open) { setPin(""); setConfirm(""); setFailed(false); setReqDone(false); } }, [open, mode]);

  const submit = async () => {
    if (pin.length < 4) return toast.error("PIN minimal 4 digit");
    setBusy(true);
    try {
      if (mode === "create") { if (pin !== confirm) { setBusy(false); return toast.error("Konfirmasi PIN tidak cocok"); } await onCreate(pin); }
      else await onVerify(pin);
    } catch (e) { setFailed(true); toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const requestReset = async () => {
    setReqBusy(true);
    try { await onRequestReset(); setReqDone(true); toast.success("Permintaan reset dikirim ke Super Admin (Susanto)"); }
    catch (e) { toast.error(errMsg(e)); } finally { setReqBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm" data-testid="hrd-gajipin-dialog">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><LockKey size={18} weight="duotone" className="text-emerald-600" /> {mode === "create" ? "Buat PIN Gaji" : "PIN Gaji"}</DialogTitle></DialogHeader>
        <p className="text-sm text-slate-500 -mt-1">
          {mode === "create" ? "Buat PIN untuk mengunci Area Data Gaji. Hanya Anda (Bu Lia) yang tahu PIN ini." : "Area Data Gaji terkunci PIN. Masukkan PIN Gaji untuk membuka."}
        </p>
        <div><Label>{mode === "create" ? "PIN Baru (min 4 digit)" : "PIN Gaji"}</Label>
          <Input type="password" inputMode="numeric" value={pin} maxLength={12} autoFocus
            onChange={(e) => setPin(clean(e.target.value))} onKeyDown={(e) => e.key === "Enter" && mode === "verify" && submit()}
            placeholder="••••" data-testid="hrd-gajipin-input" /></div>
        {mode === "create" && (
          <div><Label>Konfirmasi PIN</Label>
            <Input type="password" inputMode="numeric" value={confirm} maxLength={12}
              onChange={(e) => setConfirm(clean(e.target.value))} data-testid="hrd-gajipin-confirm" /></div>
        )}
        {mode === "verify" && failed && !reqDone && (
          <div className="text-xs bg-rose-50 border border-rose-200 text-rose-700 rounded-md p-2.5 space-y-2" data-testid="hrd-gajipin-failed">
            <div className="flex items-start gap-1.5"><WarningCircle size={15} weight="fill" className="shrink-0 mt-0.5" /> PIN salah — Anda tidak bisa masuk. Jika lupa PIN, ajukan reset. Super Admin (Susanto) akan menyetujui, lalu Anda membuat PIN baru sendiri.</div>
            {canManage && <Button variant="outline" size="sm" className="w-full border-rose-300 text-rose-700 hover:bg-rose-100" onClick={requestReset} disabled={reqBusy} data-testid="hrd-gajipin-request-reset">{reqBusy ? "Mengirim…" : "Ajukan Reset PIN ke Admin"}</Button>}
          </div>
        )}
        {reqDone && (
          <div className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-md p-2.5 flex items-start gap-1.5">
            <CheckCircle size={15} weight="fill" className="shrink-0 mt-0.5" /> Permintaan reset terkirim. Tunggu persetujuan Super Admin, lalu buat PIN baru dari tombol yang muncul di header.
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={submit} disabled={busy || !pin} data-testid="hrd-gajipin-submit">{busy ? "Memproses…" : (mode === "create" ? "Buat & Buka" : "Buka Menu Gaji")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================ Ubah PIN Gaji (dgn PIN lama) ============================ */
function ChangeGajiPinDialog({ open, onClose, onSave }) {
  const [oldPin, setOldPin] = useState("");
  const [np, setNp] = useState("");
  const [cp, setCp] = useState("");
  const [busy, setBusy] = useState(false);
  const clean = (v) => v.replace(/\D/g, "");
  useEffect(() => { if (open) { setOldPin(""); setNp(""); setCp(""); } }, [open]);
  const save = async () => {
    if (np.length < 4) return toast.error("PIN minimal 4 digit");
    if (np !== cp) return toast.error("Konfirmasi PIN tidak cocok");
    setBusy(true);
    try { await onSave(oldPin, np); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm" data-testid="hrd-changepin-dialog">
        <DialogHeader><DialogTitle>Ubah PIN Gaji</DialogTitle></DialogHeader>
        <div><Label>PIN Lama</Label><Input type="password" inputMode="numeric" value={oldPin} onChange={(e) => setOldPin(clean(e.target.value))} data-testid="hrd-changepin-old" /></div>
        <div><Label>PIN Baru</Label><Input type="password" inputMode="numeric" value={np} onChange={(e) => setNp(clean(e.target.value))} data-testid="hrd-changepin-new" /></div>
        <div><Label>Konfirmasi PIN Baru</Label><Input type="password" inputMode="numeric" value={cp} onChange={(e) => setCp(clean(e.target.value))} data-testid="hrd-changepin-confirm" /></div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button className="bg-teal-600 hover:bg-teal-700" onClick={save} disabled={busy} data-testid="hrd-changepin-save">{busy ? "Menyimpan…" : "Simpan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================ Approve reset (Susanto) ============================ */
function ApproveResetDialog({ open, onClose, onLoad, onApprove }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) onLoad().then(setItems).catch(() => setItems([])); }, [open, onLoad]);
  const approve = async (id) => {
    setBusy(true);
    try { await onApprove(id); toast.success("Reset PIN disetujui. Herliana dapat membuat PIN baru."); onClose(); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="hrd-approve-dialog">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldCheck size={18} weight="duotone" className="text-amber-600" /> Persetujuan Reset PIN Gaji</DialogTitle></DialogHeader>
        <p className="text-sm text-slate-500 -mt-1">Setujui permintaan agar Herliana bisa membuat PIN Gaji baru. Anda tidak melihat/mengatur PIN-nya.</p>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {items.length === 0 ? <div className="text-sm text-slate-400 text-center py-6">Tidak ada permintaan.</div>
            : items.map((it) => (
              <div key={it.id} className="border border-slate-200 rounded-md p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-800">{it.requested_by_name}</div>
                  <div className="text-xs text-slate-500">{it.reason || "Lupa PIN"} · {formatDateTimeWIB(it.created_at)}</div>
                </div>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => approve(it.id)} disabled={busy} data-testid={`hrd-approve-${it.id}`}>Setujui</Button>
              </div>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ============================ Reset apply (Herliana buat PIN baru) ============================ */
function ResetApplyDialog({ open, onClose, onApply }) {
  const [np, setNp] = useState("");
  const [cp, setCp] = useState("");
  const [busy, setBusy] = useState(false);
  const clean = (v) => v.replace(/\D/g, "");
  useEffect(() => { if (open) { setNp(""); setCp(""); } }, [open]);
  const submit = async () => {
    if (np.length < 4) return toast.error("PIN minimal 4 digit");
    if (np !== cp) return toast.error("Konfirmasi PIN tidak cocok");
    setBusy(true);
    try { await onApply(np); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm" data-testid="hrd-reset-apply-dialog">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Key size={18} weight="duotone" className="text-rose-600" /> Buat PIN Gaji Baru</DialogTitle></DialogHeader>
        <div className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-md p-2.5 flex items-start gap-1.5">
          <CheckCircle size={15} weight="fill" className="shrink-0 mt-0.5" /> Reset telah disetujui Super Admin. Silakan buat PIN Gaji baru Anda sendiri.
        </div>
        <div><Label>PIN Baru (min 4 digit)</Label><Input type="password" inputMode="numeric" value={np} maxLength={12} onChange={(e) => setNp(clean(e.target.value))} data-testid="hrd-reset-new" /></div>
        <div><Label>Konfirmasi PIN Baru</Label><Input type="password" inputMode="numeric" value={cp} maxLength={12} onChange={(e) => setCp(clean(e.target.value))} data-testid="hrd-reset-confirm" /></div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button className="bg-rose-600 hover:bg-rose-700" onClick={submit} disabled={busy} data-testid="hrd-reset-apply-save">{busy ? "Menyimpan…" : "Simpan PIN Baru"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================ Employees ============================ */
const EMPTY_EMP = { nik: "", nama: "", email: "", jabatan: "", dept: "Production", no_rekening: "", bank: "" };
function EmployeesSection({ hapi, can }) {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [dlg, setDlg] = useState(false);
  const [form, setForm] = useState(EMPTY_EMP);
  const [editId, setEditId] = useState(null);
  const [delId, setDelId] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (query = "") => {
    setLoading(true);
    try { const r = await hapi.get("/hrd/employees", { params: { q: query } }); setItems(r.data.items || []); }
    catch (e) { toast.error(errMsg(e)); } finally { setLoading(false); }
  }, [hapi]);
  useEffect(() => { load(""); }, [load]);

  const openNew = () => { setForm(EMPTY_EMP); setEditId(null); setDlg(true); };
  const openEdit = (emp) => { setForm({ ...EMPTY_EMP, ...emp }); setEditId(emp.id); setDlg(true); };
  const save = async () => {
    if (!form.nama.trim()) return toast.error("Nama wajib diisi");
    setBusy(true);
    try {
      if (editId) await hapi.put(`/hrd/employees/${editId}`, form);
      else await hapi.post("/hrd/employees", form);
      toast.success("Karyawan tersimpan"); setDlg(false); load(q);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const doDelete = async () => {
    try { await hapi.delete(`/hrd/employees/${delId}`); toast.success("Karyawan dihapus"); setDelId(null); load(q); }
    catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div data-testid="hrd-employees">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h2 className="text-base font-bold text-slate-800">Data Karyawan <span className="text-slate-400 font-normal">({items.length})</span></h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <MagnifyingGlass size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load(q)} placeholder="Cari nama / NIK / jabatan" className="pl-8 w-64" data-testid="hrd-emp-search" />
          </div>
          {can?.create && <Button className="bg-teal-600 hover:bg-teal-700 gap-1.5" onClick={openNew} data-testid="hrd-emp-add"><Plus size={16} weight="bold" /> Tambah</Button>}
        </div>
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2.5 font-semibold">NIK</th>
              <th className="text-left px-4 py-2.5 font-semibold">Nama</th>
              <th className="text-left px-4 py-2.5 font-semibold">Jabatan</th>
              <th className="text-left px-4 py-2.5 font-semibold">Email</th>
              <th className="text-left px-4 py-2.5 font-semibold">Bank / Rekening</th>
              <th className="text-right px-4 py-2.5 font-semibold">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (<tr><td colSpan={6} className="text-center py-10 text-slate-400">Memuat…</td></tr>)
              : items.length === 0 ? (<tr><td colSpan={6} className="text-center py-10 text-slate-400">Belum ada karyawan.</td></tr>)
                : items.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50" data-testid={`hrd-emp-row-${e.id}`}>
                    <td className="px-4 py-2.5 text-slate-600">{e.nik || "-"}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-800">{e.nama}</td>
                    <td className="px-4 py-2.5 text-slate-600">{e.jabatan || "-"}</td>
                    <td className="px-4 py-2.5 text-slate-600">{e.email || "-"}</td>
                    <td className="px-4 py-2.5 text-slate-600">{[e.bank, e.no_rekening].filter(Boolean).join(" · ") || "-"}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {can?.edit && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(e)} data-testid={`hrd-emp-edit-${e.id}`}><PencilSimple size={16} /></Button>}
                        {can?.delete && <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-500 hover:text-rose-600" onClick={() => setDelId(e.id)} data-testid={`hrd-emp-del-${e.id}`}><Trash size={16} /></Button>}
                      </div>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </Card>

      <Dialog open={dlg} onOpenChange={setDlg}>
        <DialogContent className="max-w-lg" data-testid="hrd-emp-dialog">
          <DialogHeader><DialogTitle>{editId ? "Edit Karyawan" : "Tambah Karyawan"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-1">
            <div><Label>NIK / Kode</Label><Input value={form.nik} onChange={(e) => setForm({ ...form, nik: e.target.value })} placeholder="MKS 0021" data-testid="hrd-emp-f-nik" /></div>
            <div><Label>Nama *</Label><Input value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} data-testid="hrd-emp-f-nama" /></div>
            <div><Label>Jabatan</Label><Input value={form.jabatan} onChange={(e) => setForm({ ...form, jabatan: e.target.value })} data-testid="hrd-emp-f-jabatan" /></div>
            <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="hrd-emp-f-email" /></div>
            <div><Label>Bank</Label><Input value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} placeholder="BCA" data-testid="hrd-emp-f-bank" /></div>
            <div><Label>No. Rekening</Label><Input value={form.no_rekening} onChange={(e) => setForm({ ...form, no_rekening: e.target.value })} data-testid="hrd-emp-f-rek" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(false)}>Batal</Button>
            <Button className="bg-teal-600 hover:bg-teal-700" onClick={save} disabled={busy} data-testid="hrd-emp-save">{busy ? "Menyimpan…" : "Simpan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!delId} onOpenChange={(o) => !o && setDelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus karyawan?</AlertDialogTitle>
            <AlertDialogDescription>Data karyawan akan dihapus. Slip gaji yang sudah dibuat tidak ikut terhapus.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={doDelete} data-testid="hrd-emp-del-confirm">Hapus</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ============================ Period picker ============================ */
function PeriodPicker({ month, year, setMonth, setYear }) {
  return (
    <div className="flex items-center gap-2">
      <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
        <SelectTrigger className="w-36" data-testid="hrd-period-month"><SelectValue /></SelectTrigger>
        <SelectContent>{BULAN.slice(1).map((b, i) => <SelectItem key={i + 1} value={String(i + 1)}>{b}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
        <SelectTrigger className="w-28" data-testid="hrd-period-year"><SelectValue /></SelectTrigger>
        <SelectContent>{[CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

/* ============================ Payslips ============================ */
function PayslipsSection({ hapi, can }) {
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [delId, setDelId] = useState(null);
  const [editSlip, setEditSlip] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await hapi.get("/hrd/payslips", { params: { month, year } }); setItems(r.data.items || []); }
    catch (e) { toast.error(errMsg(e)); } finally { setLoading(false); }
  }, [hapi, month, year]);
  useEffect(() => { load(); }, [load]);

  const openPdf = async (id) => {
    try {
      const r = await hapi.get(`/hrd/payslips/${id}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(r.data); window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { toast.error(errMsg(e)); }
  };
  const downloadTemplate = async () => {
    try {
      const r = await hapi.get("/hrd/import-template", { responseType: "blob" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(r.data);
      a.download = "Template_Import_Slip_Gaji.xlsx"; document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const onImport = async (file) => {
    if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("month", month); fd.append("year", year);
      const r = await hapi.post("/hrd/payslips/import-excel", fd);
      toast.success(`Import selesai: ${r.data.created} baru, ${r.data.updated} diperbarui (${r.data.names?.length || 0} karyawan)`);
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setImporting(false); }
  };
  const doDelete = async () => {
    try { await hapi.delete(`/hrd/payslips/${delId}`); toast.success("Slip dihapus"); setDelId(null); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const statusBadge = (s) => s === "terkirim"
    ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 gap-1"><CheckCircle size={12} weight="fill" /> Terkirim</Badge>
    : s === "gagal" ? <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100 gap-1"><XCircle size={12} weight="fill" /> Gagal</Badge>
      : <Badge variant="secondary" className="text-slate-500">Belum</Badge>;

  return (
    <div data-testid="hrd-payslips">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-3"><h2 className="text-base font-bold text-slate-800">Slip Gaji</h2><PeriodPicker month={month} year={year} setMonth={setMonth} setYear={setYear} /></div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={downloadTemplate} data-testid="hrd-tmpl-btn"><DownloadSimple size={15} /> Template</Button>
          {can?.create && (
            <label className="inline-flex">
              <input type="file" accept=".xlsx" hidden onChange={(e) => onImport(e.target.files?.[0])} data-testid="hrd-import-input" />
              <Button variant="default" size="sm" className="bg-teal-600 hover:bg-teal-700 gap-1.5" asChild disabled={importing}>
                <span className="cursor-pointer">{importing ? "Mengimport…" : <><UploadSimple size={15} /> Upload Excel</>}</span>
              </Button>
            </label>
          )}
        </div>
      </div>

      <div className="flex items-start gap-2 text-xs bg-sky-50 border border-sky-200 text-sky-800 rounded-md p-2.5 mb-3">
        <WarningCircle size={15} weight="fill" className="shrink-0 mt-0.5" />
        Klik ikon <PencilSimple size={12} className="inline" /> untuk membuka & mengedit isi slip (termasuk email). Take Home diambil dari kolom PEMBULATAN.
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2.5 font-semibold">Nama</th>
              <th className="text-left px-4 py-2.5 font-semibold">Jabatan</th>
              <th className="text-right px-4 py-2.5 font-semibold">Penghasilan</th>
              <th className="text-right px-4 py-2.5 font-semibold">Potongan</th>
              <th className="text-right px-4 py-2.5 font-semibold">Take Home</th>
              <th className="text-center px-4 py-2.5 font-semibold">Email</th>
              <th className="text-right px-4 py-2.5 font-semibold">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (<tr><td colSpan={7} className="text-center py-10 text-slate-400">Memuat…</td></tr>)
              : items.length === 0 ? (<tr><td colSpan={7} className="text-center py-10 text-slate-400">Belum ada slip untuk {BULAN[month]} {year}. Klik "Upload Excel".</td></tr>)
                : items.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50" data-testid={`hrd-slip-row-${s.id}`}>
                    <td className="px-4 py-2.5 font-medium text-slate-800">{s.nama}</td>
                    <td className="px-4 py-2.5 text-slate-600">{s.jabatan || "-"}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{formatRupiah(s.gross)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{formatRupiah(s.total_deduction)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-emerald-700">{formatRupiah(s.take_home)}</td>
                    <td className="px-4 py-2.5 text-center">{statusBadge(s.email_status)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {can?.edit && <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-600" onClick={() => setEditSlip(s)} data-testid={`hrd-slip-edit-${s.id}`}><PencilSimple size={16} /></Button>}
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-sky-600" onClick={() => openPdf(s.id)} data-testid={`hrd-slip-pdf-${s.id}`}><FilePdf size={16} /></Button>
                        {can?.delete && <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-500" onClick={() => setDelId(s.id)} data-testid={`hrd-slip-del-${s.id}`}><Trash size={16} /></Button>}
                      </div>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </Card>

      <AlertDialog open={!!delId} onOpenChange={(o) => !o && setDelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus slip gaji?</AlertDialogTitle>
            <AlertDialogDescription>Slip gaji ini akan dihapus permanen dari periode ini.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={doDelete} data-testid="hrd-slip-del-confirm">Hapus</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PayslipDetailDialog slip={editSlip} hapi={hapi} onClose={() => setEditSlip(null)} onSaved={() => { setEditSlip(null); load(); }} />
    </div>
  );
}

/* ============================ Payslip detail / edit ============================ */
function PayslipDetailDialog({ slip, hapi, onClose, onSaved }) {
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF(slip ? JSON.parse(JSON.stringify(slip)) : null); }, [slip]);
  if (!f) return null;

  const num = (v) => (v === "" || v == null ? 0 : Number(String(v).replace(/[^\d.-]/g, "")) || 0);
  const gross = (f.earnings || []).reduce((a, e) => a + num(e.amount), 0);
  const totalDed = (f.deductions || []).reduce((a, e) => a + num(e.amount), 0);

  const setLine = (key, i, field, val) => {
    const arr = [...(f[key] || [])]; arr[i] = { ...arr[i], [field]: field === "amount" || field === "qty" ? val : val }; setF({ ...f, [key]: arr });
  };
  const addLine = (key) => setF({ ...f, [key]: [...(f[key] || []), { label: "", amount: 0, qty: null, unit: "" }] });
  const rmLine = (key, i) => setF({ ...f, [key]: (f[key] || []).filter((_, idx) => idx !== i) });

  const save = async () => {
    setBusy(true);
    try {
      const payload = slipToPayload({
        ...f,
        earnings: (f.earnings || []).map((e) => ({ ...e, amount: num(e.amount), qty: e.qty === "" ? null : (e.qty == null ? null : num(e.qty)) })),
        deductions: (f.deductions || []).map((e) => ({ ...e, amount: num(e.amount), qty: e.qty === "" ? null : (e.qty == null ? null : num(e.qty)) })),
        take_home: f.take_home === "" || f.take_home == null ? null : num(f.take_home),
      });
      await hapi.put(`/hrd/payslips/${f.id}`, payload);
      toast.success("Slip diperbarui"); onSaved();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <Dialog open={!!slip} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="hrd-slip-dialog">
        <DialogHeader><DialogTitle>Detail & Edit Slip — {f.nama}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div><Label>NIK</Label><Input value={f.nik || ""} onChange={(e) => setF({ ...f, nik: e.target.value })} data-testid="hrd-slip-f-nik" /></div>
          <div><Label>Nama</Label><Input value={f.nama || ""} onChange={(e) => setF({ ...f, nama: e.target.value })} data-testid="hrd-slip-f-nama" /></div>
          <div><Label>Jabatan</Label><Input value={f.jabatan || ""} onChange={(e) => setF({ ...f, jabatan: e.target.value })} data-testid="hrd-slip-f-jabatan" /></div>
          <div className="col-span-2 md:col-span-3"><Label className="text-teal-700">Email (untuk kirim slip)</Label><Input type="email" value={f.email || ""} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="nama@perusahaan.com" data-testid="hrd-slip-f-email" /></div>
          <div><Label>Departemen</Label><Input value={f.dept || ""} onChange={(e) => setF({ ...f, dept: e.target.value })} data-testid="hrd-slip-f-dept" /></div>
          <div><Label>Bank</Label><Input value={f.bank || ""} onChange={(e) => setF({ ...f, bank: e.target.value })} /></div>
          <div><Label>No. Rekening</Label><Input value={f.no_rekening || ""} onChange={(e) => setF({ ...f, no_rekening: e.target.value })} /></div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
          <div>
            <div className="flex items-center justify-between mb-1"><Label className="text-emerald-700">Penghasilan</Label><Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => addLine("earnings")}><Plus size={13} /> Baris</Button></div>
            <div className="space-y-1.5">
              {(f.earnings || []).map((e, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Input className="flex-1 h-8 text-xs" value={e.label} onChange={(ev) => setLine("earnings", i, "label", ev.target.value)} placeholder="Keterangan" />
                  <Input className="w-28 h-8 text-xs text-right" value={e.amount} onChange={(ev) => setLine("earnings", i, "amount", ev.target.value)} placeholder="0" />
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-400" onClick={() => rmLine("earnings", i)}><Trash size={13} /></Button>
                </div>
              ))}
            </div>
            <div className="text-xs text-right text-slate-500 mt-1">Jumlah: <b className="text-slate-700">{formatRupiah(gross)}</b></div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1"><Label className="text-rose-700">Pengurangan</Label><Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => addLine("deductions")}><Plus size={13} /> Baris</Button></div>
            <div className="space-y-1.5">
              {(f.deductions || []).map((e, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Input className="flex-1 h-8 text-xs" value={e.label} onChange={(ev) => setLine("deductions", i, "label", ev.target.value)} placeholder="Keterangan" />
                  <Input className="w-28 h-8 text-xs text-right" value={e.amount} onChange={(ev) => setLine("deductions", i, "amount", ev.target.value)} placeholder="0" />
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-400" onClick={() => rmLine("deductions", i)}><Trash size={13} /></Button>
                </div>
              ))}
            </div>
            <div className="text-xs text-right text-slate-500 mt-1">Jumlah: <b className="text-slate-700">{formatRupiah(totalDed)}</b></div>
          </div>
        </div>

        <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-md p-3 mt-2">
          <Label className="!mb-0 text-emerald-800 font-semibold">Take Home (Pembulatan)</Label>
          <Input className="w-40 text-right font-semibold" value={f.take_home ?? ""} onChange={(e) => setF({ ...f, take_home: e.target.value })} data-testid="hrd-slip-f-takehome" />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Tutup</Button>
          <Button className="bg-teal-600 hover:bg-teal-700" onClick={save} disabled={busy} data-testid="hrd-slip-save">{busy ? "Menyimpan…" : "Simpan Perubahan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================ Email ============================ */
function EmailSection({ hapi, can }) {
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [items, setItems] = useState([]);
  const [sel, setSel] = useState({});
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(null);
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [emailEdits, setEmailEdits] = useState({});
  const [savingEmail, setSavingEmail] = useState(null);

  const saveEmail = async (s) => {
    const val = (emailEdits[s.id] ?? s.email ?? "").trim();
    setSavingEmail(s.id);
    try {
      await hapi.put(`/hrd/payslips/${s.id}`, slipToPayload(s, { email: val }));
      setItems((prev) => prev.map((x) => (x.id === s.id ? { ...x, email: val } : x)));
      setEmailEdits((p) => { const n = { ...p }; delete n[s.id]; return n; });
      toast.success("Email disimpan");
    } catch (e) { toast.error(errMsg(e)); } finally { setSavingEmail(null); }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await hapi.get("/hrd/payslips", { params: { month, year } }); setItems(r.data.items || []); setSel({}); }
    catch (e) { toast.error(errMsg(e)); } finally { setLoading(false); }
  }, [hapi, month, year]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { hapi.get("/hrd/settings").then((r) => setSettings(r.data)).catch(() => {}); }, [hapi]);

  const gmailReady = settings?.gmail_user && settings?.has_app_password;
  const selectedIds = Object.keys(sel).filter((k) => sel[k]);
  const allChecked = items.length > 0 && selectedIds.length === items.length;

  const doBlast = async () => {
    setConfirmOpen(false); setSending(true);
    try {
      const body = { month, year };
      if (selectedIds.length && selectedIds.length < items.length) body.ids = selectedIds;
      const r = await hapi.post("/hrd/blast", body);
      toast.success(`Selesai: ${r.data.sent} terkirim, ${r.data.failed} gagal`); load();
    } catch (e) { toast.error(errMsg(e)); } finally { setSending(false); }
  };
  const statusBadge = (s) => s === "terkirim"
    ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 gap-1"><CheckCircle size={12} weight="fill" /> Terkirim</Badge>
    : s === "gagal" ? <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100 gap-1"><XCircle size={12} weight="fill" /> Gagal</Badge>
      : <Badge variant="secondary" className="text-slate-500">Belum</Badge>;

  return (
    <div data-testid="hrd-email">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-3"><h2 className="text-base font-bold text-slate-800">Kirim Slip via Email</h2><PeriodPicker month={month} year={year} setMonth={setMonth} setYear={setYear} /></div>
        {can?.create && (
          <Button className="bg-teal-600 hover:bg-teal-700 gap-1.5" disabled={!gmailReady || items.length === 0 || sending} onClick={() => setConfirmOpen(true)} data-testid="hrd-blast-btn">
            <PaperPlaneTilt size={16} weight="fill" /> {sending ? "Mengirim…" : selectedIds.length ? `Kirim ${selectedIds.length} Terpilih` : "Kirim Semua"}
          </Button>
        )}
      </div>

      {!gmailReady && (
        <div className="flex items-center justify-between gap-3 text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-md p-3 mb-4" data-testid="hrd-email-warning">
          <span className="flex items-center gap-2"><WarningCircle size={18} weight="fill" /> Email Gmail belum dikonfigurasi. Atur dulu di tab Pengaturan Email.</span>
        </div>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="px-4 py-2.5 w-10"><Checkbox checked={allChecked} onCheckedChange={(v) => { const n = {}; if (v) items.forEach((s) => n[s.id] = true); setSel(n); }} data-testid="hrd-email-checkall" /></th>
              <th className="text-left px-4 py-2.5 font-semibold">Nama</th>
              <th className="text-left px-4 py-2.5 font-semibold">Email</th>
              <th className="text-right px-4 py-2.5 font-semibold">Take Home</th>
              <th className="text-center px-4 py-2.5 font-semibold">Status</th>
              <th className="text-left px-4 py-2.5 font-semibold">Keterangan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (<tr><td colSpan={6} className="text-center py-10 text-slate-400">Memuat…</td></tr>)
              : items.length === 0 ? (<tr><td colSpan={6} className="text-center py-10 text-slate-400">Belum ada slip untuk {BULAN[month]} {year}.</td></tr>)
                : items.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50" data-testid={`hrd-email-row-${s.id}`}>
                    <td className="px-4 py-2.5"><Checkbox checked={!!sel[s.id]} onCheckedChange={(v) => setSel({ ...sel, [s.id]: v })} data-testid={`hrd-email-check-${s.id}`} /></td>
                    <td className="px-4 py-2.5 font-medium text-slate-800">{s.nama}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <Input className="h-8 text-xs w-52" value={emailEdits[s.id] ?? s.email ?? ""} placeholder="email@perusahaan.com"
                          onChange={(ev) => setEmailEdits({ ...emailEdits, [s.id]: ev.target.value })}
                          onKeyDown={(ev) => ev.key === "Enter" && saveEmail(s)} data-testid={`hrd-email-input-${s.id}`} />
                        {emailEdits[s.id] !== undefined && emailEdits[s.id] !== (s.email || "") && (
                          <Button size="sm" className="h-8 bg-teal-600 hover:bg-teal-700 px-2 text-xs" onClick={() => saveEmail(s)} disabled={savingEmail === s.id} data-testid={`hrd-email-save-${s.id}`}>Simpan</Button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{formatRupiah(s.take_home)}</td>
                    <td className="px-4 py-2.5 text-center">{statusBadge(s.email_status)}</td>
                    <td className="px-4 py-2.5 text-xs text-rose-500">{s.email_error || ""}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Kirim slip gaji?</AlertDialogTitle>
            <AlertDialogDescription>Slip gaji periode <b>{BULAN[month]} {year}</b> akan dikirim ke {selectedIds.length ? `${selectedIds.length} karyawan terpilih` : `semua ${items.length} karyawan`}. Tiap karyawan menerima PDF slip masing-masing.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction className="bg-teal-600 hover:bg-teal-700" onClick={doBlast} data-testid="hrd-blast-confirm">Ya, Kirim</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ============================ Settings ============================ */
function SettingsSection({ hapi, can }) {
  const [f, setF] = useState({ gmail_user: "", sender_name: "PT. MITRA KARYA SARANA", app_password: "", email_subject: "", email_body: "" });
  const [hasPw, setHasPw] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    hapi.get("/hrd/settings").then((r) => {
      setF((p) => ({ ...p, gmail_user: r.data.gmail_user || "", sender_name: r.data.sender_name || "PT. MITRA KARYA SARANA", app_password: "", email_subject: r.data.email_subject || "", email_body: r.data.email_body || "" }));
      setHasPw(!!r.data.has_app_password);
    }).catch((e) => toast.error(errMsg(e)));
  }, [hapi]);
  const save = async () => {
    setBusy(true);
    try {
      const body = { gmail_user: f.gmail_user, sender_name: f.sender_name, email_subject: f.email_subject, email_body: f.email_body };
      if (f.app_password) body.app_password = f.app_password;
      await hapi.post("/hrd/settings", body);
      toast.success("Pengaturan tersimpan"); setF((p) => ({ ...p, app_password: "" })); if (f.app_password) setHasPw(true);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="max-w-2xl" data-testid="hrd-settings">
      <h2 className="text-base font-bold text-slate-800 mb-4">Pengaturan Email (Gmail)</h2>
      <Card className="p-6 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-slate-800 mb-1">✍️ Pesan Email Slip Gaji (bisa diedit)</h3>
          <div className="text-[11px] text-slate-500 mb-3">
            Variabel yang bisa dipakai: <code className="bg-slate-100 px-1 rounded">{"{nama}"}</code> <code className="bg-slate-100 px-1 rounded">{"{bulan}"}</code> <code className="bg-slate-100 px-1 rounded">{"{tahun}"}</code> <code className="bg-slate-100 px-1 rounded">{"{take_home}"}</code> <code className="bg-slate-100 px-1 rounded">{"{jabatan}"}</code> <code className="bg-slate-100 px-1 rounded">{"{nik}"}</code> <code className="bg-slate-100 px-1 rounded">{"{sender}"}</code>
          </div>
          <div className="mb-3"><Label>Subjek Email</Label><Input value={f.email_subject} onChange={(e) => setF({ ...f, email_subject: e.target.value })} placeholder="Slip Gaji {bulan} {tahun} - {nama}" data-testid="hrd-set-subject" /></div>
          <div><Label>Isi Pesan</Label><Textarea rows={8} value={f.email_body} onChange={(e) => setF({ ...f, email_body: e.target.value })} className="font-mono text-xs" data-testid="hrd-set-body" /></div>
        </div>

        <div className="border-t border-slate-200 pt-4 space-y-4">
          <h3 className="text-sm font-bold text-slate-800">Akun Pengirim (Gmail)</h3>
          <div className="flex items-start gap-2 text-xs bg-sky-50 border border-sky-200 text-sky-800 rounded-md p-3">
            <ShieldCheck size={18} weight="fill" className="shrink-0 mt-0.5" />
            <div>Gunakan <b>Gmail App Password</b> (bukan password login biasa). Buat di akun Google: <b>Security → 2-Step Verification → App passwords</b>. App Password disimpan aman di server dan tidak pernah ditampilkan kembali.</div>
          </div>
          <div><Label>Email Gmail Pengirim</Label><Input type="email" value={f.gmail_user} onChange={(e) => setF({ ...f, gmail_user: e.target.value })} placeholder="hrd@gmail.com" data-testid="hrd-set-gmail" /></div>
          <div><Label>Nama Pengirim (tampil di email)</Label><Input value={f.sender_name} onChange={(e) => setF({ ...f, sender_name: e.target.value })} data-testid="hrd-set-sender" /></div>
          <div><Label>App Password {hasPw && <span className="text-emerald-600 text-xs font-normal">(tersimpan ✓ — kosongkan bila tidak diubah)</span>}</Label>
            <Input type="password" value={f.app_password} onChange={(e) => setF({ ...f, app_password: e.target.value })} placeholder={hasPw ? "••••••••••••" : "16 karakter app password"} data-testid="hrd-set-apppw" /></div>
          <div className="flex items-start gap-2 text-[11px] bg-amber-50 border border-amber-200 text-amber-800 rounded-md p-2.5">
            <WarningCircle size={14} weight="fill" className="shrink-0 mt-0.5" /> Disarankan pakai akun <b>@gmail.com</b> agar email lolos autentikasi. Jika memakai domain sendiri (mis. @mitrakaryasarana.com via Google Workspace), pastikan <b>SPF</b> & <b>DKIM</b> domain sudah aktif — bila belum, Gmail menolak dengan error 5.7.26.
          </div>
        </div>

        {can?.edit && <Button className="bg-teal-600 hover:bg-teal-700" onClick={save} disabled={busy} data-testid="hrd-set-save">{busy ? "Menyimpan…" : "Simpan Pengaturan"}</Button>}
      </Card>
    </div>
  );
}

/* ============================ Dokumen (placeholder) ============================ */
function DokumenSection() {
  const items = [
    { t: "Absensi", d: "Rekap kehadiran & jam kerja karyawan." },
    { t: "Cuti & Izin", d: "Pengajuan dan persetujuan cuti/izin." },
    { t: "Kontrak Kerja", d: "Arsip kontrak & masa berlaku." },
    { t: "Arsip Dokumen Karyawan", d: "KTP, NPWP, sertifikat, dsb." },
    { t: "Dashboard HR", d: "Ringkasan headcount, turnover, dll." },
  ];
  return (
    <div data-testid="hrd-dokumen">
      <h2 className="text-lg font-bold text-slate-800 mb-1">Dokumen HRD</h2>
      <p className="text-sm text-slate-500 mb-4">Modul dokumen HR akan hadir di sistem HRIS. Berikut rencana fitur:</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((it) => (
          <Card key={it.t} className="p-5 relative">
            <Badge variant="secondary" className="absolute top-3 right-3 text-[10px]">Segera</Badge>
            <FolderSimple size={22} weight="duotone" className="text-rose-500 mb-2" />
            <div className="font-bold text-slate-800">{it.t}</div>
            <div className="text-xs text-slate-500 mt-1">{it.d}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ============================ Logs ============================ */
function LogsSection({ hapi }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { hapi.get("/hrd/logs").then((r) => setItems(r.data.items || [])).catch((e) => toast.error(errMsg(e))).finally(() => setLoading(false)); }, [hapi]);
  const color = (a) => a === "hrd_access_denied" ? "text-rose-600" : (a === "hrd_set_pin" || a === "hrd_set_portal_pin") ? "text-amber-600" : a === "hrd_blast" ? "text-teal-600" : "text-slate-600";
  return (
    <div data-testid="hrd-logs">
      <h2 className="text-lg font-bold text-slate-800 mb-4">Log Akses HRD</h2>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2.5 font-semibold">Waktu</th>
              <th className="text-left px-4 py-2.5 font-semibold">User</th>
              <th className="text-left px-4 py-2.5 font-semibold">Aktivitas</th>
              <th className="text-left px-4 py-2.5 font-semibold">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (<tr><td colSpan={4} className="text-center py-10 text-slate-400">Memuat…</td></tr>)
              : items.length === 0 ? (<tr><td colSpan={4} className="text-center py-10 text-slate-400">Belum ada log.</td></tr>)
                : items.map((l, i) => (
                  <tr key={l.id || i} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{formatDateTimeWIB(l.timestamp)}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-800">{l.user_name || l.username || "-"}</td>
                    <td className={`px-4 py-2.5 font-medium ${color(l.action)}`}>{l.action_label}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{l.details ? Object.entries(l.details).map(([k, v]) => `${k}: ${v}`).join(", ") : ""}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
