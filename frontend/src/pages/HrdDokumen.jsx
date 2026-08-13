import React, { useCallback, useEffect, useMemo, useState } from "react";
import api, { formatDateID, formatDateTimeWIB, formatApiErrorDetail } from "../lib/api";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import OnboardDialog from "./HrdOnboard";
import {
  UsersThree, Plus, Trash, PencilSimple, FilePdf, MagnifyingGlass, Files, UploadSimple,
  DownloadSimple, SealCheck, XCircle, FileText, QrCode, ArrowLeft, CaretRight, Eye, Camera, Sparkle,
} from "@phosphor-icons/react";

const errMsg = (e) => formatApiErrorDetail(e?.response?.data?.detail) || e?.message || "Terjadi kesalahan";

const photoUrl = (p) => p?.photo_ext ? `${process.env.REACT_APP_BACKEND_URL}/api/hrd/people/${p.id}/photo?v=${p.photo_ver || ""}` : null;

export function Avatar({ p, className = "h-8 w-8 text-[10px]" }) {
  const url = photoUrl(p);
  const initials = (p?.nama || "?").split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return url ? (
    <img src={url} alt={p.nama} className={`${className} rounded-full object-cover border border-slate-200 shrink-0`} />
  ) : (
    <div className={`${className} rounded-full bg-rose-100 text-rose-700 flex items-center justify-center font-bold shrink-0`}>{initials}</div>
  );
}

/* ============================ Hub (per kartu) ============================ */
const MODULES = [
  { key: "karyawan", title: "Database Karyawan", icon: UsersThree, tint: "text-sky-600", bg: "bg-sky-50",
    desc: "Data lengkap karyawan: pribadi, kepegawaian, BPJS, bank — plus arsip dokumen (KTP, ijazah, dll)." },
  { key: "surat", title: "Surat Kerja", icon: FilePdf, tint: "text-rose-600", bg: "bg-rose-50",
    desc: "Terbitkan Surat Keterangan Kerja & Surat Pengalaman Kerja (Paklaring) ber-QR dari data karyawan." },
];

export default function DokumenHub({ can }) {
  const [view, setView] = useState(null);
  const active = MODULES.find((m) => m.key === view);

  if (!active) {
    return (
      <div data-testid="hrd-dokumen">
        <div className="flex items-center gap-2 mb-1">
          <UsersThree size={22} weight="duotone" className="text-rose-600" />
          <h2 className="text-lg font-bold text-slate-800" style={{ fontFamily: "Chivo, sans-serif" }}>Dokumen HRD</h2>
        </div>
        <p className="text-sm text-slate-500 mb-5">Pilih modul yang ingin dibuka.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {MODULES.map((m) => (
            <Card key={m.key} onClick={() => setView(m.key)} data-testid={`dok-card-${m.key}`}
              className="p-5 cursor-pointer group hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 border-slate-200">
              <div className={`h-11 w-11 rounded-lg ${m.bg} flex items-center justify-center mb-3`}>
                <m.icon size={24} weight="duotone" className={m.tint} />
              </div>
              <div className="font-bold text-slate-800 flex items-center gap-1.5">{m.title}
                <CaretRight size={14} weight="bold" className="text-slate-300 group-hover:text-slate-500 group-hover:translate-x-0.5 transition-all" /></div>
              <div className="text-xs text-slate-500 mt-1 leading-relaxed">{m.desc}</div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="hrd-dokumen">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setView(null)} data-testid="dok-back">
          <ArrowLeft size={15} /> Dokumen HRD
        </Button>
        <div className="flex items-center gap-2">
          <active.icon size={20} weight="duotone" className={active.tint} />
          <h2 className="text-lg font-bold text-slate-800" style={{ fontFamily: "Chivo, sans-serif" }}>{active.title}</h2>
        </div>
      </div>
      {view === "karyawan" && <PeopleSection can={can} />}
      {view === "surat" && <LettersSection can={can} />}
    </div>
  );
}

/* ============================ Database Karyawan ============================ */
const EMPTY_PERSON = {
  nama: "", nik: "", nik_ktp: "", no_kk: "", tempat_lahir: "", tanggal_lahir: "", jenis_kelamin: "",
  golongan_darah: "", kewarganegaraan: "WNI", agama: "", status_kawin: "", nama_pasangan: "",
  jumlah_tanggungan: "", nama_ibu_kandung: "", pendidikan: "", jurusan: "",
  alamat: "", alamat_domisili: "", telp: "", email: "",
  dept: "", jabatan: "", status_karyawan: "", tanggal_masuk: "", tanggal_keluar: "",
  bank: "", no_rekening: "", npwp: "", no_bpjs_tk: "", no_bpjs_kes: "",
  kontak_darurat_nama: "", kontak_darurat_hubungan: "", kontak_darurat_telp: "", catatan: "",
  riwayat_pendidikan: [], riwayat_pengalaman: [], anggota_keluarga: [],
};

function PeopleSection({ can }) {
  const [items, setItems] = useState([]);
  const [docTypes, setDocTypes] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(null);       // person object or EMPTY_PERSON
  const [detail, setDetail] = useState(null);   // person for detail popup
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [delId, setDelId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get("/hrd/people", { params: { q } }); setItems(r.data.items || []); setDocTypes(r.data.doc_types || []); }
    catch (e) { toast.error(errMsg(e)); } finally { setLoading(false); }
  }, [q]);
  useEffect(() => { load(); }, [load]);

  const doDelete = async () => {
    try { await api.delete(`/hrd/people/${delId}`); toast.success("Karyawan dihapus"); setDelId(null); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const statusBadge = (s) => {
    if (!s) return <span className="text-slate-400">-</span>;
    const cls = s === "Tetap" ? "bg-emerald-100 text-emerald-700" : s === "Kontrak" ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-600";
    return <Badge className={`${cls} hover:${cls}`}>{s}</Badge>;
  };

  return (
    <div data-testid="hrd-people">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="relative">
          <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama / NIK / jabatan…"
            className="pl-9 w-72" data-testid="people-search" />
        </div>
        {can?.create && (
          <Button size="sm" className="bg-rose-600 hover:bg-rose-700 gap-1.5" onClick={() => setOnboardOpen(true)} data-testid="people-add-btn">
            <Plus size={15} weight="bold" /> Tambah Karyawan
          </Button>
        )}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2.5 font-semibold">Nama</th>
              <th className="text-left px-4 py-2.5 font-semibold">NIK</th>
              <th className="text-left px-4 py-2.5 font-semibold">Jabatan</th>
              <th className="text-left px-4 py-2.5 font-semibold">Dept</th>
              <th className="text-center px-4 py-2.5 font-semibold">Status</th>
              <th className="text-left px-4 py-2.5 font-semibold">Tgl Masuk</th>
              <th className="text-center px-4 py-2.5 font-semibold">Dokumen</th>
              <th className="text-right px-4 py-2.5 font-semibold">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (<tr><td colSpan={8} className="text-center py-10 text-slate-400">Memuat…</td></tr>)
              : items.length === 0 ? (<tr><td colSpan={8} className="text-center py-10 text-slate-400">Belum ada karyawan. Klik "Tambah Karyawan".</td></tr>)
                : items.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setDetail(p)} data-testid={`people-row-${p.id}`}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar p={p} />
                        <span className="font-medium text-slate-800">{p.nama}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{p.nik || "-"}</td>
                    <td className="px-4 py-2.5 text-slate-600">{p.jabatan || "-"}</td>
                    <td className="px-4 py-2.5 text-slate-600">{p.dept || "-"}</td>
                    <td className="px-4 py-2.5 text-center">{statusBadge(p.status_karyawan)}</td>
                    <td className="px-4 py-2.5 text-slate-600">{p.tanggal_masuk ? formatDateID(p.tanggal_masuk) : "-"}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="inline-flex items-center gap-1 text-sky-700 text-xs font-medium" data-testid={`people-docs-${p.id}`}>
                        <Files size={15} /> {p.docs_count || 0}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {can?.edit && <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-600" onClick={(e) => { e.stopPropagation(); setEdit({ ...EMPTY_PERSON, ...p }); }} data-testid={`people-edit-${p.id}`}><PencilSimple size={16} /></Button>}
                        {can?.delete && <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-500" onClick={(e) => { e.stopPropagation(); setDelId(p.id); }} data-testid={`people-del-${p.id}`}><Trash size={16} /></Button>}
                      </div>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </Card>
      <div className="text-[11px] text-slate-400 mt-2">Klik baris untuk melihat detail lengkap & dokumen karyawan.</div>

      <PersonDialog person={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />
      <OnboardDialog open={onboardOpen} onClose={() => setOnboardOpen(false)} onDone={() => { setOnboardOpen(false); load(); }} />
      <PersonDetailDialog person={detail} docTypes={docTypes} can={can}
        onClose={() => { setDetail(null); load(); }}
        onEdit={(p) => { setDetail(null); setEdit({ ...EMPTY_PERSON, ...p }); }} />

      <AlertDialog open={!!delId} onOpenChange={(o) => !o && setDelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus karyawan?</AlertDialogTitle>
            <AlertDialogDescription>Data karyawan akan dihapus dari database.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={doDelete} data-testid="people-del-confirm">Hapus</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ---------- Form karyawan ---------- */
function Fld({ label, children }) {
  return <div><Label className="text-xs text-slate-500">{label}</Label>{children}</div>;
}

function SectionTitle({ children }) {
  return <div className="col-span-2 md:col-span-3 mt-2 pb-1 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-rose-600">{children}</div>;
}

function PersonDialog({ person, onClose, onSaved }) {
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF(person ? { ...person } : null); }, [person]);
  if (!f) return null;
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  const addRow = (key, blank) => setF({ ...f, [key]: [...(f[key] || []), blank] });
  const setRow = (key, i, k, v) => { const a = [...(f[key] || [])]; a[i] = { ...a[i], [k]: v }; setF({ ...f, [key]: a }); };
  const rmRow = (key, i) => setF({ ...f, [key]: (f[key] || []).filter((_, j) => j !== i) });
  const save = async () => {
    if (!f.nama?.trim()) { toast.error("Nama wajib diisi"); return; }
    setBusy(true);
    try {
      const payload = Object.fromEntries(Object.keys(EMPTY_PERSON).map((k) => [k, f[k] ?? EMPTY_PERSON[k]]));
      if (f.id) await api.put(`/hrd/people/${f.id}`, payload);
      else await api.post("/hrd/people", payload);
      toast.success("Data karyawan disimpan"); onSaved();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const sel = (k, opts, ph) => (
    <Select value={f[k] || ""} onValueChange={(v) => setF({ ...f, [k]: v })}>
      <SelectTrigger data-testid={`person-f-${k}`}><SelectValue placeholder={ph || "Pilih"} /></SelectTrigger>
      <SelectContent>{opts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
    </Select>
  );
  return (
    <Dialog open={!!person} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="person-dialog">
        <DialogHeader><DialogTitle>{f.id ? `Edit Karyawan — ${person?.nama ?? f.nama}` : "Tambah Karyawan"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <SectionTitle>Data Pribadi</SectionTitle>
          <Fld label="Nama Lengkap *"><Input value={f.nama} onChange={set("nama")} data-testid="person-f-nama" /></Fld>
          <Fld label="NIK Karyawan"><Input value={f.nik} onChange={set("nik")} placeholder="MKS 0001" data-testid="person-f-nik" /></Fld>
          <Fld label="No. KTP (NIK)"><Input value={f.nik_ktp} onChange={set("nik_ktp")} data-testid="person-f-nikktp" /></Fld>
          <Fld label="No. Kartu Keluarga"><Input value={f.no_kk} onChange={set("no_kk")} data-testid="person-f-nokk" /></Fld>
          <Fld label="Tempat Lahir"><Input value={f.tempat_lahir} onChange={set("tempat_lahir")} /></Fld>
          <Fld label="Tanggal Lahir"><Input type="date" value={f.tanggal_lahir} onChange={set("tanggal_lahir")} data-testid="person-f-tgllahir" /></Fld>
          <Fld label="Jenis Kelamin">{sel("jenis_kelamin", ["Laki-laki", "Perempuan"])}</Fld>
          <Fld label="Golongan Darah">{sel("golongan_darah", ["A", "B", "AB", "O", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"])}</Fld>
          <Fld label="Kewarganegaraan"><Input value={f.kewarganegaraan} onChange={set("kewarganegaraan")} placeholder="WNI" /></Fld>
          <Fld label="Agama">{sel("agama", ["Islam", "Kristen", "Katolik", "Hindu", "Buddha", "Konghucu"])}</Fld>
          <Fld label="Status Kawin">{sel("status_kawin", ["Belum Kawin", "Kawin", "Cerai Hidup", "Cerai Mati"])}</Fld>
          <Fld label="Nama Pasangan"><Input value={f.nama_pasangan} onChange={set("nama_pasangan")} /></Fld>
          <Fld label="Jumlah Tanggungan"><Input value={f.jumlah_tanggungan} onChange={set("jumlah_tanggungan")} placeholder="0" /></Fld>
          <Fld label="Nama Ibu Kandung"><Input value={f.nama_ibu_kandung} onChange={set("nama_ibu_kandung")} /></Fld>
          <Fld label="Pendidikan Terakhir"><Input value={f.pendidikan} onChange={set("pendidikan")} placeholder="SMA / D3 / S1…" /></Fld>
          <Fld label="Jurusan"><Input value={f.jurusan} onChange={set("jurusan")} placeholder="mis. Teknik Mesin" /></Fld>
          <Fld label="No. Telepon / WA"><Input value={f.telp} onChange={set("telp")} data-testid="person-f-telp" /></Fld>
          <Fld label="Email"><Input type="email" value={f.email} onChange={set("email")} data-testid="person-f-email" /></Fld>
          <div className="col-span-2 md:col-span-3"><Label className="text-xs text-slate-500">Alamat (sesuai KTP)</Label>
            <Textarea rows={2} value={f.alamat} onChange={set("alamat")} data-testid="person-f-alamat" /></div>
          <div className="col-span-2 md:col-span-3"><Label className="text-xs text-slate-500">Alamat Domisili (bila berbeda)</Label>
            <Textarea rows={2} value={f.alamat_domisili} onChange={set("alamat_domisili")} /></div>

          <SectionTitle>Kepegawaian</SectionTitle>
          <Fld label="Departemen"><Input value={f.dept} onChange={set("dept")} placeholder="Production" data-testid="person-f-dept" /></Fld>
          <Fld label="Jabatan"><Input value={f.jabatan} onChange={set("jabatan")} data-testid="person-f-jabatan" /></Fld>
          <Fld label="Status Karyawan">{sel("status_karyawan", ["Tetap", "Kontrak", "Harian", "Magang"])}</Fld>
          <Fld label="Tanggal Masuk"><Input type="date" value={f.tanggal_masuk} onChange={set("tanggal_masuk")} data-testid="person-f-tglmasuk" /></Fld>
          <Fld label="Tanggal Keluar (bila sudah resign)"><Input type="date" value={f.tanggal_keluar} onChange={set("tanggal_keluar")} data-testid="person-f-tglkeluar" /></Fld>

          <SectionTitle>Pembayaran & Jaminan</SectionTitle>
          <Fld label="Bank"><Input value={f.bank} onChange={set("bank")} /></Fld>
          <Fld label="No. Rekening"><Input value={f.no_rekening} onChange={set("no_rekening")} /></Fld>
          <Fld label="NPWP"><Input value={f.npwp} onChange={set("npwp")} /></Fld>
          <Fld label="BPJS Ketenagakerjaan"><Input value={f.no_bpjs_tk} onChange={set("no_bpjs_tk")} /></Fld>
          <Fld label="BPJS Kesehatan"><Input value={f.no_bpjs_kes} onChange={set("no_bpjs_kes")} /></Fld>

          <SectionTitle>Kontak Darurat & Catatan</SectionTitle>
          <Fld label="Nama Kontak Darurat"><Input value={f.kontak_darurat_nama} onChange={set("kontak_darurat_nama")} /></Fld>
          <Fld label="Hubungan"><Input value={f.kontak_darurat_hubungan} onChange={set("kontak_darurat_hubungan")} placeholder="mis. Istri / Orang Tua" /></Fld>
          <Fld label="Telp Kontak Darurat"><Input value={f.kontak_darurat_telp} onChange={set("kontak_darurat_telp")} /></Fld>
          <div className="col-span-2 md:col-span-3"><Label className="text-xs text-slate-500">Catatan</Label>
            <Textarea rows={2} value={f.catatan} onChange={set("catatan")} /></div>
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[11px] font-bold uppercase tracking-wider text-rose-600">Riwayat Pendidikan</div>
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => addRow("riwayat_pendidikan", { jenjang: "", jurusan: "", institusi: "", tahun: "" })} data-testid="person-add-edu"><Plus size={13} /> Baris</Button>
          </div>
          <div className="space-y-1.5">
            <div className="grid grid-cols-12 gap-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide px-0.5"><div className="col-span-2">Jenjang</div><div className="col-span-4">Jurusan</div><div className="col-span-4">Institusi</div><div className="col-span-1">Thn</div><div className="col-span-1"></div></div>
            {(f.riwayat_pendidikan || []).map((r, i) => (
              <div key={i} className="grid grid-cols-12 gap-1.5 items-center" data-testid={`person-edu-${i}`}>
                <Input className="h-8 text-xs col-span-2" value={r.jenjang} placeholder="Jenjang" onChange={(e) => setRow("riwayat_pendidikan", i, "jenjang", e.target.value)} />
                <Input className="h-8 text-xs col-span-4" value={r.jurusan} placeholder="Jurusan" onChange={(e) => setRow("riwayat_pendidikan", i, "jurusan", e.target.value)} />
                <Input className="h-8 text-xs col-span-4" value={r.institusi} placeholder="Institusi" onChange={(e) => setRow("riwayat_pendidikan", i, "institusi", e.target.value)} />
                <Input className="h-8 text-xs col-span-1" value={r.tahun} placeholder="Thn" onChange={(e) => setRow("riwayat_pendidikan", i, "tahun", e.target.value)} />
                <Trash size={14} className="text-rose-500 cursor-pointer col-span-1 mx-auto" onClick={() => rmRow("riwayat_pendidikan", i)} />
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[11px] font-bold uppercase tracking-wider text-rose-600">Riwayat Pengalaman Kerja</div>
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => addRow("riwayat_pengalaman", { posisi: "", perusahaan: "", periode: "" })} data-testid="person-add-exp"><Plus size={13} /> Baris</Button>
          </div>
          <div className="space-y-1.5">
            <div className="grid grid-cols-12 gap-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide px-0.5"><div className="col-span-4">Posisi / Jabatan</div><div className="col-span-4">Perusahaan</div><div className="col-span-3">Periode</div><div className="col-span-1"></div></div>
            {(f.riwayat_pengalaman || []).map((r, i) => (
              <div key={i} className="grid grid-cols-12 gap-1.5 items-center" data-testid={`person-exp-${i}`}>
                <Input className="h-8 text-xs col-span-4" value={r.posisi} placeholder="Posisi/Jabatan" onChange={(e) => setRow("riwayat_pengalaman", i, "posisi", e.target.value)} />
                <Input className="h-8 text-xs col-span-4" value={r.perusahaan} placeholder="Perusahaan" onChange={(e) => setRow("riwayat_pengalaman", i, "perusahaan", e.target.value)} />
                <Input className="h-8 text-xs col-span-3" value={r.periode} placeholder="Periode" onChange={(e) => setRow("riwayat_pengalaman", i, "periode", e.target.value)} />
                <Trash size={14} className="text-rose-500 cursor-pointer col-span-1 mx-auto" onClick={() => rmRow("riwayat_pengalaman", i)} />
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[11px] font-bold uppercase tracking-wider text-rose-600">Data Keluarga (Kartu Keluarga)</div>
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => addRow("anggota_keluarga", { nama: "", hubungan: "", nik: "", tanggal_lahir: "", pekerjaan: "" })} data-testid="person-add-kel"><Plus size={13} /> Baris</Button>
          </div>
          <div className="space-y-1.5">
            <div className="flex gap-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide px-0.5"><div className="flex-[3]">Nama</div><div className="flex-[2]">Hubungan</div><div className="flex-[3]">NIK</div><div className="flex-[2]">Tgl Lahir</div><div className="flex-[2]">Pekerjaan</div><div className="w-[14px] shrink-0"></div></div>
            {(f.anggota_keluarga || []).map((r, i) => (
              <div key={i} className="flex items-center gap-1.5" data-testid={`person-kel-${i}`}>
                <Input className="h-8 text-xs flex-[3]" value={r.nama || ""} placeholder="Nama" onChange={(e) => setRow("anggota_keluarga", i, "nama", e.target.value)} />
                <Input className="h-8 text-xs flex-[2]" value={r.hubungan || ""} placeholder="Hubungan" onChange={(e) => setRow("anggota_keluarga", i, "hubungan", e.target.value)} />
                <Input className="h-8 text-xs flex-[3]" value={r.nik || ""} placeholder="NIK" onChange={(e) => setRow("anggota_keluarga", i, "nik", e.target.value)} />
                <Input className="h-8 text-xs flex-[2]" type="date" value={r.tanggal_lahir || ""} onChange={(e) => setRow("anggota_keluarga", i, "tanggal_lahir", e.target.value)} />
                <Input className="h-8 text-xs flex-[2]" value={r.pekerjaan || ""} placeholder="Pekerjaan" onChange={(e) => setRow("anggota_keluarga", i, "pekerjaan", e.target.value)} />
                <Trash size={14} className="text-rose-500 cursor-pointer shrink-0" onClick={() => rmRow("anggota_keluarga", i)} />
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button className="bg-rose-600 hover:bg-rose-700" onClick={save} disabled={busy} data-testid="person-save">{busy ? "Menyimpan…" : "Simpan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Detail karyawan (popup baca) + dokumen per kartu ---------- */
function DItem({ label, value }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{label}</div>
      <div className="text-sm text-slate-800">{value || <span className="text-slate-300">-</span>}</div>
    </div>
  );
}

function DSection({ title, children }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-rose-600 border-b border-slate-200 pb-1 mb-2">{title}</div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2.5">{children}</div>
    </div>
  );
}

function PersonDetailDialog({ person, docTypes, can, onClose, onEdit }) {
  const [photo, setPhoto] = useState({ ext: null, ver: null });
  const [p, setP] = useState(person);
  useEffect(() => { setP(person); if (person) setPhoto({ ext: person.photo_ext, ver: person.photo_ver }); }, [person]);
  if (!p) return null;

  const uploadPhoto = async (file) => {
    if (!file) return;
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await api.post(`/hrd/people/${p.id}/photo`, fd);
      setPhoto({ ext: r.data.photo_ext, ver: r.data.photo_ver });
      toast.success("Foto profil diperbarui");
    } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <Dialog open={!!person} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="person-detail-dialog">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="relative shrink-0">
              <Avatar p={{ ...p, photo_ext: photo.ext, photo_ver: photo.ver }} className="h-14 w-14 text-lg" />
              {can?.edit && (
                <label className="absolute -bottom-1 -right-1 h-6 w-6 bg-slate-800 text-white rounded-full flex items-center justify-center cursor-pointer hover:bg-slate-700 border-2 border-white" title="Upload foto profil">
                  <Camera size={12} weight="fill" />
                  <input type="file" hidden accept=".jpg,.jpeg,.png,.webp"
                    onChange={(e) => { uploadPhoto(e.target.files?.[0]); e.target.value = ""; }} data-testid="person-photo-input" />
                </label>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="truncate">{p.nama}</DialogTitle>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {p.nik && <Badge variant="secondary" className="text-[10px]">{p.nik}</Badge>}
                {p.jabatan && <Badge variant="secondary" className="text-[10px]">{p.jabatan}</Badge>}
                {p.dept && <Badge variant="secondary" className="text-[10px]">{p.dept}</Badge>}
                {p.status_karyawan && <Badge className="text-[10px] bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{p.status_karyawan}</Badge>}
              </div>
            </div>
            {can?.edit && (
              <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={() => onEdit(p)} data-testid="person-detail-edit">
                <PencilSimple size={14} /> Edit
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <DSection title="Data Pribadi">
            <DItem label="No. KTP" value={p.nik_ktp} />
            <DItem label="No. Kartu Keluarga" value={p.no_kk} />
            <DItem label="Tempat, Tgl Lahir" value={[p.tempat_lahir, p.tanggal_lahir ? formatDateID(p.tanggal_lahir) : ""].filter(Boolean).join(", ")} />
            <DItem label="Jenis Kelamin" value={p.jenis_kelamin} />
            <DItem label="Golongan Darah" value={p.golongan_darah} />
            <DItem label="Kewarganegaraan" value={p.kewarganegaraan} />
            <DItem label="Agama" value={p.agama} />
            <DItem label="Status Kawin" value={p.status_kawin} />
            <DItem label="Nama Pasangan" value={p.nama_pasangan} />
            <DItem label="Jumlah Tanggungan" value={p.jumlah_tanggungan} />
            <DItem label="Nama Ibu Kandung" value={p.nama_ibu_kandung} />
            <DItem label="Pendidikan" value={[p.pendidikan, p.jurusan].filter(Boolean).join(" - ")} />
            <DItem label="Telepon / WA" value={p.telp} />
            <DItem label="Email" value={p.email} />
            <div className="col-span-2 md:col-span-3"><DItem label="Alamat (KTP)" value={p.alamat} /></div>
            {p.alamat_domisili && <div className="col-span-2 md:col-span-3"><DItem label="Alamat Domisili" value={p.alamat_domisili} /></div>}
          </DSection>
          <DSection title="Kepegawaian">
            <DItem label="Tanggal Masuk" value={p.tanggal_masuk ? formatDateID(p.tanggal_masuk) : ""} />
            <DItem label="Tanggal Keluar" value={p.tanggal_keluar ? formatDateID(p.tanggal_keluar) : ""} />
            <DItem label="Status" value={p.status_karyawan} />
          </DSection>
          <DSection title="Pembayaran & Jaminan">
            <DItem label="Bank" value={p.bank} />
            <DItem label="No. Rekening" value={p.no_rekening} />
            <DItem label="NPWP" value={p.npwp} />
            <DItem label="BPJS Ketenagakerjaan" value={p.no_bpjs_tk} />
            <DItem label="BPJS Kesehatan" value={p.no_bpjs_kes} />
          </DSection>
          <DSection title="Kontak Darurat">
            <DItem label="Nama" value={p.kontak_darurat_nama} />
            <DItem label="Hubungan" value={p.kontak_darurat_hubungan} />
            <DItem label="Telepon" value={p.kontak_darurat_telp} />
          </DSection>
          {(p.riwayat_pendidikan || []).length > 0 && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-rose-600 border-b border-slate-200 pb-1 mb-2">Riwayat Pendidikan</div>
              <div className="space-y-1">
                {p.riwayat_pendidikan.map((r, i) => (
                  <div key={i} className="text-sm text-slate-700" data-testid={`detail-edu-${i}`}>• <b>{[r.jenjang, r.jurusan].filter(Boolean).join(" ")}</b>{r.institusi ? ` — ${r.institusi}` : ""}{r.tahun ? ` (${r.tahun})` : ""}</div>
                ))}
              </div>
            </div>
          )}
          {(p.riwayat_pengalaman || []).length > 0 && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-rose-600 border-b border-slate-200 pb-1 mb-2">Riwayat Pengalaman Kerja</div>
              <div className="space-y-1">
                {p.riwayat_pengalaman.map((r, i) => (
                  <div key={i} className="text-sm text-slate-700" data-testid={`detail-exp-${i}`}>• <b>{r.posisi || "-"}</b>{r.perusahaan ? ` di ${r.perusahaan}` : ""}{r.periode ? ` (${r.periode})` : ""}</div>
                ))}
              </div>
            </div>
          )}
          {(p.anggota_keluarga || []).length > 0 && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-rose-600 border-b border-slate-200 pb-1 mb-2">Data Keluarga (Kartu Keluarga)</div>
              <div className="space-y-1">
                {p.anggota_keluarga.map((r, i) => (
                  <div key={i} className="text-sm text-slate-700" data-testid={`detail-kel-${i}`}>• <b>{r.nama || "-"}</b>{r.hubungan ? ` — ${r.hubungan}` : ""}{r.nik ? ` (NIK: ${r.nik})` : ""}{r.tanggal_lahir ? `, lahir ${formatDateID(r.tanggal_lahir)}` : ""}{r.pekerjaan ? `, ${r.pekerjaan}` : ""}</div>
                ))}
              </div>
            </div>
          )}
          {p.catatan && (
            <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-800"><b>Catatan:</b> {p.catatan}</div>
          )}
          <DocsPanel person={p} docTypes={docTypes} can={can} onEmployeeUpdate={(emp) => setP(emp)} />
          <CareerPanel person={p} can={can} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Riwayat karir ---------- */
function CareerPanel({ person, can }) {
  const [items, setItems] = useState([]);
  const [kinds, setKinds] = useState([]);
  const [tanggal, setTanggal] = useState("");
  const [jenis, setJenis] = useState("");
  const [ket, setKet] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api.get(`/hrd/people/${person.id}/career`); setItems(r.data.items || []); setKinds(r.data.kinds || []); }
    catch (e) { toast.error(errMsg(e)); }
  }, [person.id]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!tanggal || !jenis) { toast.error("Isi tanggal & jenis"); return; }
    setBusy(true);
    try {
      await api.post("/hrd/career", { employee_id: person.id, tanggal, jenis, keterangan: ket });
      toast.success("Riwayat tercatat"); setTanggal(""); setJenis(""); setKet(""); load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const del = async (id) => {
    try { await api.delete(`/hrd/career/${id}`); toast.success("Dihapus"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const kindColor = (j) => j === "Promosi" ? "bg-emerald-100 text-emerald-700" : j === "Kenaikan Gaji" ? "bg-sky-100 text-sky-700"
    : j === "Surat Peringatan" ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600";

  return (
    <div data-testid="career-panel">
      <div className="text-[11px] font-bold uppercase tracking-wider text-rose-600 border-b border-slate-200 pb-1 mb-2">
        Riwayat Karir ({items.length})
      </div>
      {can?.create && (
        <div className="flex items-end gap-2 flex-wrap bg-slate-50 border border-slate-200 rounded-md p-2.5 mb-3">
          <div><Label className="text-[11px] text-slate-500">Tanggal</Label>
            <Input type="date" className="h-8 text-xs w-36" value={tanggal} onChange={(e) => setTanggal(e.target.value)} data-testid="career-tanggal" /></div>
          <div className="w-40"><Label className="text-[11px] text-slate-500">Jenis</Label>
            <Select value={jenis} onValueChange={setJenis}>
              <SelectTrigger className="h-8 text-xs" data-testid="career-jenis"><SelectValue placeholder="Pilih…" /></SelectTrigger>
              <SelectContent>{kinds.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
            </Select></div>
          <div className="flex-1 min-w-40"><Label className="text-[11px] text-slate-500">Keterangan</Label>
            <Input className="h-8 text-xs" value={ket} onChange={(e) => setKet(e.target.value)} placeholder="mis. naik jadi Leader" data-testid="career-ket" /></div>
          <Button size="sm" className="h-8 bg-sky-600 hover:bg-sky-700 text-xs" onClick={add} disabled={busy} data-testid="career-add">{busy ? "…" : "Catat"}</Button>
        </div>
      )}
      {items.length === 0 ? (
        <div className="text-center py-4 text-xs text-slate-400 border border-dashed border-slate-200 rounded-md">Belum ada riwayat karir.</div>
      ) : (
        <div className="space-y-1.5">
          {items.map((c) => (
            <div key={c.id} className="flex items-center gap-2.5 border border-slate-100 rounded-md px-3 py-2" data-testid={`career-row-${c.id}`}>
              <Badge className={`${kindColor(c.jenis)} hover:bg-inherit text-[10px] shrink-0`}>{c.jenis}</Badge>
              <div className="flex-1 min-w-0 text-xs text-slate-700 truncate">{c.keterangan || "-"}</div>
              <div className="text-[10px] text-slate-400 shrink-0">{formatDateID(c.tanggal)}</div>
              {can?.delete && <Trash size={14} className="text-rose-500 cursor-pointer shrink-0" onClick={() => del(c.id)} data-testid={`career-del-${c.id}`} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Panel dokumen: kartu compact per jenis + preview ---------- */
const DOC_TINTS = [
  ["bg-sky-50", "text-sky-600"], ["bg-emerald-50", "text-emerald-600"], ["bg-amber-50", "text-amber-600"],
  ["bg-violet-50", "text-violet-600"], ["bg-rose-50", "text-rose-600"], ["bg-cyan-50", "text-cyan-600"],
];
const docTint = (type, docTypes) => DOC_TINTS[Math.max(0, (docTypes || []).indexOf(type)) % DOC_TINTS.length];
const fmtSize = (n) => n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

function DocsPanel({ person, docTypes, can, onEmployeeUpdate }) {
  const [items, setItems] = useState([]);
  const [docType, setDocType] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null); // doc record

  const load = useCallback(async () => {
    try { const r = await api.get(`/hrd/people/${person.id}/docs`); setItems(r.data.items || []); }
    catch (e) { toast.error(errMsg(e)); }
  }, [person.id]);
  useEffect(() => { load(); }, [load]);

  const AUTO_READ = ["KTP", "Kartu Keluarga", "Ijazah", "Pengalaman Kerja"];
  const upload = async (file) => {
    if (!file) return;
    if (!docType) { toast.error("Pilih jenis dokumen dulu"); return; }
    setBusy(true);
    if (AUTO_READ.includes(docType)) toast.info(`Mengupload & membaca ${docType} dengan AI…`);
    try {
      const fd = new FormData(); fd.append("doc_type", docType); fd.append("file", file);
      const r = await api.post(`/hrd/people/${person.id}/docs`, fd, { timeout: 120000 });
      const d = r.data || {};
      toast.success(d.ai_summary ? `${docType} terupload — ${d.ai_summary}` : `${docType} terupload`);
      if (d.employee && onEmployeeUpdate) onEmployeeUpdate(d.employee);
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const del = async (d) => {
    try { await api.delete(`/hrd/emp-docs/${d.id}`); toast.success("Dokumen dihapus"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const rereadDoc = async (d) => {
    toast.info(`Membaca ${d.doc_type} dengan AI…`);
    try {
      const r = await api.post(`/hrd/emp-docs/${d.id}/read`, {}, { timeout: 120000 });
      const data = r.data || {};
      toast.success(data.ai_summary || `${d.doc_type} dibaca`);
      if (data.employee && onEmployeeUpdate) onEmployeeUpdate(data.employee);
    } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div data-testid="docs-panel">
      <div className="text-[11px] font-bold uppercase tracking-wider text-rose-600 border-b border-slate-200 pb-1 mb-2">
        Dokumen ({items.length})
      </div>
      {can?.create && (
        <div className="flex items-end gap-2 flex-wrap bg-slate-50 border border-slate-200 rounded-md p-2.5 mb-3">
          <div className="w-48">
            <Label className="text-[11px] text-slate-500">Jenis Dokumen</Label>
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger className="h-8 text-xs" data-testid="doc-type-select"><SelectValue placeholder="Pilih jenis…" /></SelectTrigger>
              <SelectContent>{(docTypes || []).map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <label className="inline-flex">
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} data-testid="doc-file-input" />
            <Button size="sm" className="h-8 bg-sky-600 hover:bg-sky-700 gap-1.5" asChild disabled={busy}>
              <span className="cursor-pointer text-xs">{busy ? "Mengupload…" : <><UploadSimple size={14} /> Upload</>}</span>
            </Button>
          </label>
          <span className="text-[10px] text-slate-400">PDF/JPG/PNG/WEBP, maks 10 MB</span>
        </div>
      )}
      {items.length === 0 ? (
        <div className="text-center py-6 text-xs text-slate-400 border border-dashed border-slate-200 rounded-md">Belum ada dokumen.</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {items.map((d) => {
            const [bg, tint] = docTint(d.doc_type, docTypes);
            return (
              <div key={d.id} onClick={() => setPreview(d)} data-testid={`doc-row-${d.id}`}
                className="border border-slate-200 rounded-md p-2.5 flex items-start gap-2 cursor-pointer hover:shadow-sm hover:border-slate-300 transition-all group">
                <div className={`h-9 w-9 rounded-md ${bg} flex items-center justify-center shrink-0`}>
                  {d.ext === ".pdf" ? <FilePdf size={18} className={tint} /> : <FileText size={18} className={tint} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-slate-800 truncate">{d.doc_type}</div>
                  {d.keterangan && <div className="text-[10px] text-slate-600 truncate italic">{d.keterangan}</div>}
                  <div className="text-[10px] text-slate-400 truncate">{d.filename}</div>
                  <div className="text-[10px] text-slate-400">{fmtSize(d.size)} • {formatDateID(d.uploaded_at)}</div>
                </div>
                <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Eye size={14} className="text-sky-600" data-testid={`doc-open-${d.id}`} />
                  {can?.create && AUTO_READ.includes(d.doc_type) && (
                    <Sparkle size={14} weight="fill" className="text-amber-500" title="Baca dengan AI & isi data" data-testid={`doc-read-${d.id}`}
                      onClick={(e) => { e.stopPropagation(); rereadDoc(d); }} />
                  )}
                  {can?.delete && <Trash size={14} className="text-rose-500" data-testid={`doc-del-${d.id}`}
                    onClick={(e) => { e.stopPropagation(); del(d); }} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <DocPreviewDialog doc={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function DocPreviewDialog({ doc, onClose }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let objUrl = null;
    setUrl(null); setErr("");
    if (doc) {
      api.get(`/hrd/emp-docs/${doc.id}/download`, { responseType: "blob" })
        .then((r) => { objUrl = URL.createObjectURL(r.data); setUrl(objUrl); })
        .catch((e) => setErr(errMsg(e)));
    }
    return () => { if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [doc]);
  if (!doc) return null;
  const isImg = [".jpg", ".jpeg", ".png", ".webp"].includes(doc.ext);
  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl" data-testid="doc-preview-dialog">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-6">
            <DialogTitle className="truncate">{doc.doc_type} — {doc.filename}</DialogTitle>
            {url && (
              <a href={url} download={doc.filename}>
                <Button size="sm" variant="outline" className="gap-1.5 shrink-0" data-testid="doc-preview-download">
                  <DownloadSimple size={14} /> Unduh
                </Button>
              </a>
            )}
          </div>
        </DialogHeader>
        <div className="bg-slate-100 rounded-md flex items-center justify-center overflow-hidden" style={{ height: "65vh" }}>
          {err ? <div className="text-sm text-rose-600">{err}</div>
            : !url ? <div className="text-sm text-slate-400">Memuat pratinjau…</div>
              : isImg ? <img src={url} alt={doc.filename} className="max-h-full max-w-full object-contain" />
                : <iframe src={url} title={doc.filename} className="w-full h-full border-0" />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ============================ Surat Kerja ============================ */
const JENIS_LABEL = { skk: "Surat Keterangan Kerja", paklaring: "Surat Pengalaman Kerja", sp: "Surat Peringatan", panggilan: "Surat Panggilan", memo: "Internal Memo", pengumuman: "Pengumuman" };

function LettersSection({ can }) {
  const [people, setPeople] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [empId, setEmpId] = useState("");
  const [jenis, setJenis] = useState("skk");
  const [keperluan, setKeperluan] = useState("");
  const [tglKeluar, setTglKeluar] = useState("");
  const [busy, setBusy] = useState(false);
  const [delId, setDelId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rp, rl] = await Promise.all([api.get("/hrd/people"), api.get("/hrd/letters")]);
      setPeople(rp.data.items || []); setItems(rl.data.items || []);
    } catch (e) { toast.error(errMsg(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const selEmp = useMemo(() => people.find((p) => p.id === empId), [people, empId]);
  useEffect(() => { if (jenis === "paklaring" && selEmp?.tanggal_keluar) setTglKeluar(selEmp.tanggal_keluar); }, [jenis, selEmp]);

  const openPdf = async (id) => {
    try {
      const r = await api.get(`/hrd/letters/${id}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(r.data); window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { toast.error(errMsg(e)); }
  };

  const previewPdf = async () => {
    if (!empId) { toast.error("Pilih karyawan dulu"); return; }
    try {
      const r = await api.post("/hrd/letters/preview",
        { employee_id: empId, jenis, keperluan, tanggal_keluar: jenis === "paklaring" ? tglKeluar : "" },
        { responseType: "blob" });
      const url = URL.createObjectURL(r.data); window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { toast.error(errMsg(e)); }
  };

  const create = async () => {
    if (!empId) { toast.error("Pilih karyawan dulu"); return; }
    setBusy(true);
    try {
      const r = await api.post("/hrd/letters", { employee_id: empId, jenis, keperluan, tanggal_keluar: jenis === "paklaring" ? tglKeluar : "" });
      toast.success(`Surat ${r.data.nomor} diterbitkan`);
      setKeperluan(""); load(); openPdf(r.data.id);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const doDelete = async () => {
    try { await api.delete(`/hrd/letters/${delId}`); toast.success("Surat dihapus dari arsip"); setDelId(null); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div data-testid="hrd-letters">
      {can?.create && (
        <Card className="p-4 mb-4">
          <div className="text-sm font-bold text-slate-800 mb-3">Buat Surat Baru</div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div>
              <Label className="text-xs text-slate-500">Karyawan</Label>
              <Select value={empId} onValueChange={setEmpId}>
                <SelectTrigger data-testid="letter-emp-select"><SelectValue placeholder="Pilih karyawan…" /></SelectTrigger>
                <SelectContent>{people.map((p) => <SelectItem key={p.id} value={p.id}>{p.nama}{p.nik ? ` — ${p.nik}` : ""}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-500">Jenis Surat</Label>
              <Select value={jenis} onValueChange={setJenis}>
                <SelectTrigger data-testid="letter-jenis-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="skk">Surat Keterangan Kerja</SelectItem>
                  <SelectItem value="paklaring">Surat Pengalaman Kerja (Paklaring)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {jenis === "paklaring" && (
              <div>
                <Label className="text-xs text-slate-500">Tanggal Keluar</Label>
                <Input type="date" value={tglKeluar} onChange={(e) => setTglKeluar(e.target.value)} data-testid="letter-tglkeluar" />
              </div>
            )}
            <div className={jenis === "paklaring" ? "" : "md:col-span-2"}>
              <Label className="text-xs text-slate-500">Keperluan (opsional)</Label>
              <Input value={keperluan} onChange={(e) => setKeperluan(e.target.value)} placeholder="mis. untuk pengajuan kredit bank" data-testid="letter-keperluan" />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="gap-1.5 text-sky-700 border-sky-300 hover:bg-sky-50 flex-1" onClick={previewPdf} disabled={busy} data-testid="letter-preview-btn">
                <Eye size={16} /> Preview
              </Button>
              <Button className="bg-rose-600 hover:bg-rose-700 gap-1.5 flex-1" onClick={create} disabled={busy} data-testid="letter-create-btn">
                <FilePdf size={16} /> {busy ? "Membuat…" : "Terbitkan"}
              </Button>
            </div>
          </div>
          {selEmp && !selEmp.tanggal_masuk && (
            <div className="text-xs text-amber-600 mt-2">⚠ Karyawan ini belum punya Tanggal Masuk di database — masa kerja akan tampil "-". Lengkapi dulu di Database Karyawan.</div>
          )}
        </Card>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2.5 font-semibold">Nomor</th>
              <th className="text-left px-4 py-2.5 font-semibold">Jenis</th>
              <th className="text-left px-4 py-2.5 font-semibold">Nama</th>
              <th className="text-left px-4 py-2.5 font-semibold">Kode Verifikasi</th>
              <th className="text-left px-4 py-2.5 font-semibold">Diterbitkan</th>
              <th className="text-right px-4 py-2.5 font-semibold">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (<tr><td colSpan={6} className="text-center py-10 text-slate-400">Memuat…</td></tr>)
              : items.length === 0 ? (<tr><td colSpan={6} className="text-center py-10 text-slate-400">Belum ada surat diterbitkan.</td></tr>)
                : items.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50" data-testid={`letter-row-${l.id}`}>
                    <td className="px-4 py-2.5 font-medium text-slate-800 whitespace-nowrap">{l.nomor}</td>
                    <td className="px-4 py-2.5 text-slate-600">{JENIS_LABEL[l.jenis] || l.jenis}</td>
                    <td className="px-4 py-2.5 text-slate-800">{l.nama}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{l.kode}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">{formatDateTimeWIB(l.created_at)}<br />oleh {l.created_by}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-sky-600" onClick={() => openPdf(l.id)} data-testid={`letter-pdf-${l.id}`}><FilePdf size={16} /></Button>
                        {can?.delete && <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-500" onClick={() => setDelId(l.id)} data-testid={`letter-del-${l.id}`}><Trash size={16} /></Button>}
                      </div>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </Card>

      <AlertDialog open={!!delId} onOpenChange={(o) => !o && setDelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus surat dari arsip?</AlertDialogTitle>
            <AlertDialogDescription>Kode verifikasi surat ini tidak akan dikenali sistem lagi (dianggap tidak sah).</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={doDelete} data-testid="letter-del-confirm">Hapus</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ============================ Verifikasi ============================ */
export function VerifySection() {
  const [kode, setKode] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const rp = (v) => "Rp " + (Number(v) || 0).toLocaleString("id-ID");
  const check = async () => {
    if (!kode.trim()) return;
    setBusy(true); setResult(null);
    try {
      const rl = await api.post("/hrd/letters/verify", { kode });
      if (rl.data.valid) { setResult({ kind: "letter", ...rl.data }); return; }
      const rs = await api.post("/hrd/payslips/verify", { kode });
      if (rs.data.valid) { setResult({ kind: "slip", ...rs.data }); return; }
      setResult({ kind: "none", valid: false, message: rl.data.message || rs.data.message || "Kode tidak terdaftar" });
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="max-w-xl" data-testid="hrd-verify">
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-1"><QrCode size={20} className="text-rose-600" />
          <div className="text-sm font-bold text-slate-800">Cek Keaslian Surat / Slip Gaji</div></div>
        <p className="text-xs text-slate-500 mb-4">Masukkan Kode Verifikasi yang tertera di surat atau slip gaji (atau dari QR). Sistem memeriksa apakah dokumen benar diterbitkan HRD.</p>
        <div className="flex gap-2">
          <Input value={kode} onChange={(e) => setKode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX"
            className="font-mono tracking-wider" onKeyDown={(e) => e.key === "Enter" && check()} data-testid="verify-input" />
          <Button className="bg-rose-600 hover:bg-rose-700 shrink-0" onClick={check} disabled={busy} data-testid="verify-btn">{busy ? "Memeriksa…" : "Periksa"}</Button>
        </div>
        {result && result.kind === "slip" && (
          <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-md p-4" data-testid="verify-result-slip">
            <div className="flex items-center gap-2 text-emerald-700 font-bold text-sm mb-2"><SealCheck size={18} weight="fill" /> SLIP GAJI ASLI — terdaftar di sistem</div>
            <div className="text-xs text-slate-600 space-y-1">
              <div><b>No. Dokumen:</b> {result.slip.no_dok}</div>
              <div><b>Nama:</b> {result.slip.nama} {result.slip.nik ? `(${result.slip.nik})` : ""}</div>
              <div><b>Periode:</b> {result.slip.periode}</div>
              <div><b>Take Home Pay:</b> {rp(result.slip.take_home)}</div>
            </div>
            <div className="text-[11px] text-emerald-700 mt-2">Cocokkan nama & nominal di atas dengan slip yang diterima.</div>
          </div>
        )}
        {result && result.kind === "letter" && (
          <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-md p-4" data-testid="verify-result-valid">
            <div className="flex items-center gap-2 text-emerald-700 font-bold text-sm mb-2"><SealCheck size={18} weight="fill" /> DOKUMEN ASLI — terdaftar di sistem</div>
            <div className="text-xs text-slate-600 space-y-1">
              <div><b>Nomor:</b> {result.letter.nomor}</div>
              <div><b>Jenis:</b> {JENIS_LABEL[result.letter.jenis] || result.letter.jenis}</div>
              <div><b>Nama:</b> {result.letter.nama} {result.letter.nik ? `(${result.letter.nik})` : ""}</div>
              <div><b>Jabatan:</b> {result.letter.jabatan || "-"}</div>
              <div><b>Diterbitkan:</b> {formatDateTimeWIB(result.letter.created_at)} oleh {result.letter.created_by}</div>
            </div>
            <div className="text-[11px] text-emerald-700 mt-2">Cocokkan data di atas dengan isi surat yang diterima. Jika berbeda, surat telah dimodifikasi.</div>
          </div>
        )}
        {result && result.kind === "none" && (
          <div className="mt-4 bg-rose-50 border border-rose-200 rounded-md p-4 flex items-start gap-2" data-testid="verify-result-invalid">
            <XCircle size={18} weight="fill" className="text-rose-600 shrink-0 mt-0.5" />
            <div><div className="text-rose-700 font-bold text-sm">TIDAK TERDAFTAR</div>
              <div className="text-xs text-rose-600 mt-1">{result.message}</div></div>
          </div>
        )}
      </Card>
    </div>
  );
}
