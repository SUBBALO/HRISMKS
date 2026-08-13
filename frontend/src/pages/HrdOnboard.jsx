import React, { useState } from "react";
import api, { formatApiErrorDetail } from "../lib/api";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Sparkle, Trash, UploadSimple, FileText, Plus } from "@phosphor-icons/react";

const errMsg = (e) => formatApiErrorDetail(e?.response?.data?.detail) || e?.message || "Terjadi kesalahan";

const CATS = [
  { key: "ktp", label: "KTP", docType: "KTP", multiple: false, hint: "1 file — data pribadi terisi otomatis" },
  { key: "kk", label: "Kartu Keluarga", docType: "Kartu Keluarga", multiple: false, hint: "No. KK & alamat terbaca otomatis" },
  { key: "ijazah", label: "Ijazah", docType: "Ijazah", multiple: true, hint: "AI beri keterangan jenjang & tahun" },
  { key: "pengalaman", label: "Pengalaman Kerja", docType: "Pengalaman Kerja", multiple: true, hint: "bisa lebih dari 1, terbaca otomatis" },
  { key: "lainnya", label: "Dokumen Lain", docType: "Lainnya", multiple: true, hint: "NPWP, BPJS, sertifikat, dll" },
];

const FORM_INIT = {
  nama: "", nik: "", nik_ktp: "", no_kk: "", tempat_lahir: "", tanggal_lahir: "", jenis_kelamin: "",
  golongan_darah: "", kewarganegaraan: "WNI", agama: "", status_kawin: "", nama_pasangan: "",
  jumlah_tanggungan: "", nama_ibu_kandung: "", pendidikan: "", jurusan: "",
  alamat: "", alamat_domisili: "", telp: "", email: "",
  dept: "", jabatan: "", status_karyawan: "", tanggal_masuk: "", tanggal_keluar: "",
  bank: "", no_rekening: "", npwp: "", no_bpjs_tk: "", no_bpjs_kes: "",
  kontak_darurat_nama: "", kontak_darurat_hubungan: "", kontak_darurat_telp: "", catatan: "",
  riwayat_pendidikan: [], riwayat_pengalaman: [], anggota_keluarga: [],
};

const AGAMA_MAP = { islam: "Islam", kristen: "Kristen", katolik: "Katolik", hindu: "Hindu", buddha: "Buddha", budha: "Buddha", konghucu: "Konghucu", "kong hu cu": "Konghucu" };
const normAgama = (v) => AGAMA_MAP[String(v || "").trim().toLowerCase()] || (v || "");

function Sec({ children }) {
  return <div className="col-span-2 md:col-span-3 mt-1 pb-1 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-rose-600">{children}</div>;
}

export default function OnboardDialog({ open, onClose, onDone }) {
  const [f, setF] = useState(FORM_INIT);
  const [docs, setDocs] = useState([]); // {file, docType, kategori, keterangan}
  const [reading, setReading] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e?.target ? e.target.value : e }));
  const reset = () => { setF(FORM_INIT); setDocs([]); };
  const addRow = (key, blank) => setF((p) => ({ ...p, [key]: [...(p[key] || []), blank] }));
  const setRow = (key, i, k, v) => setF((p) => { const a = [...(p[key] || [])]; a[i] = { ...a[i], [k]: v }; return { ...p, [key]: a }; });
  const rmRow = (key, i) => setF((p) => ({ ...p, [key]: (p[key] || []).filter((_, j) => j !== i) }));

  const addFiles = async (cat, files) => {
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) return;
    for (const file of (cat.multiple ? list : [list[0]])) {
      await addFile(cat, file);
    }
  };

  const addFile = async (cat, file) => {
    if (!file) return;
    setReading(cat.key);
    toast.info(`AI membaca ${cat.label}…`);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("kategori", cat.key);
      const r = await api.post("/hrd/ai/read-doc", fd, { timeout: 120000 });
      const p = r.data || {};
      if (cat.key === "ktp") {
        setF((prev) => ({
          ...prev,
          ...Object.fromEntries(["nik_ktp", "nama", "tempat_lahir", "tanggal_lahir", "jenis_kelamin", "alamat", "status_kawin"]
            .map((k) => [k, p[k] || prev[k]])),
          agama: normAgama(p.agama) || prev.agama,
        }));
        setDocs((d) => [...d.filter((x) => x.kategori !== "ktp"), { file, docType: cat.docType, kategori: cat.key, keterangan: p.keterangan || "" }]);
      } else if (cat.key === "kk") {
        setF((prev) => ({
          ...prev,
          no_kk: p.no_kk || prev.no_kk,
          alamat: prev.alamat || p.alamat || "",
          nama_ibu_kandung: prev.nama_ibu_kandung || p.nama_ibu_kandung || "",
          status_kawin: prev.status_kawin || p.status_kawin || "",
          anggota_keluarga: (Array.isArray(p.anggota_keluarga) && p.anggota_keluarga.length) ? p.anggota_keluarga : (prev.anggota_keluarga || []),
        }));
        setDocs((d) => [...d.filter((x) => x.kategori !== "kk"), { file, docType: cat.docType, kategori: cat.key, keterangan: p.keterangan || "" }]);
      } else if (cat.key === "ijazah") {
        setF((prev) => ({
          ...prev,
          pendidikan: prev.pendidikan || p.pendidikan || "",
          jurusan: prev.jurusan || p.jurusan || "",
          riwayat_pendidikan: [...(prev.riwayat_pendidikan || []),
            { jenjang: p.jenjang || "", jurusan: p.jurusan || "", institusi: p.institusi || "", tahun: p.tahun || "" }],
        }));
        setDocs((d) => [...d, { file, docType: cat.docType, kategori: cat.key, keterangan: p.keterangan || "" }]);
      } else if (cat.key === "pengalaman") {
        setF((prev) => ({
          ...prev,
          riwayat_pengalaman: [...(prev.riwayat_pengalaman || []),
            { posisi: p.posisi || "", perusahaan: p.perusahaan || "", periode: p.periode || "" }],
        }));
        setDocs((d) => [...d, { file, docType: cat.docType, kategori: cat.key, keterangan: p.keterangan || "" }]);
      } else {
        setF((prev) => ({
          ...prev,
          npwp: prev.npwp || p.npwp || "",
          no_bpjs_tk: prev.no_bpjs_tk || p.no_bpjs_tk || "",
          no_bpjs_kes: prev.no_bpjs_kes || p.no_bpjs_kes || "",
        }));
        const known = ["NPWP", "BPJS Ketenagakerjaan", "BPJS Kesehatan", "Sertifikat"];
        const dt = known.includes(p.jenis_dokumen) ? p.jenis_dokumen : cat.docType;
        setDocs((d) => [...d, { file, docType: dt, kategori: cat.key, keterangan: p.keterangan || "" }]);
      }
      toast.success(`${cat.label} terbaca`);
    } catch (e) { toast.error(errMsg(e)); } finally { setReading(""); }
  };

  const save = async () => {
    if (!f.nama.trim()) { toast.error("Nama wajib diisi"); return; }
    setSaving(true);
    try {
      const r = await api.post("/hrd/people", f);
      const empId = r.data.id;
      for (const d of docs) {
        const fd = new FormData();
        fd.append("doc_type", d.docType); fd.append("keterangan", d.keterangan); fd.append("file", d.file);
        await api.post(`/hrd/people/${empId}/docs`, fd);
      }
      toast.success(`Karyawan ${f.nama} tersimpan + ${docs.length} dokumen masuk arsip`);
      reset(); onDone();
    } catch (e) { toast.error(errMsg(e)); } finally { setSaving(false); }
  };

  const sel = (k, opts) => (
    <Select value={f[k] || ""} onValueChange={(v) => setF((p) => ({ ...p, [k]: v }))}>
      <SelectTrigger data-testid={`onboard-f-${k}`}><SelectValue placeholder="Pilih" /></SelectTrigger>
      <SelectContent>{opts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
    </Select>
  );
  const fld = (k, label, extra = {}) => (
    <div><Label className="text-xs text-slate-500">{label}</Label>
      <Input value={f[k]} onChange={set(k)} data-testid={`onboard-f-${k}`} {...extra} /></div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" data-testid="onboard-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkle size={18} weight="fill" className="text-amber-500" /> Tambah Karyawan</DialogTitle>
        </DialogHeader>

        {/* Upload per kategori */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {CATS.map((c) => {
            const count = docs.filter((d) => d.kategori === c.key).length;
            return (
              <label key={c.key} className={`border-2 border-dashed rounded-md p-3 text-center cursor-pointer hover:border-rose-300 hover:bg-rose-50/40 transition-colors ${count ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200"}`}>
                <input type="file" hidden accept=".pdf,.jpg,.jpeg,.png,.webp" multiple={c.multiple} data-testid={`onboard-up-${c.key}`}
                  onChange={(e) => { addFiles(c, e.target.files); e.target.value = ""; }} disabled={!!reading} />
                <UploadSimple size={18} className="mx-auto text-slate-400 mb-1" />
                <div className="text-xs font-bold text-slate-700">{c.label} {count > 0 && <span className="text-emerald-600">({count})</span>}</div>
                <div className="text-[9px] text-slate-400 leading-tight mt-0.5">{reading === c.key ? "AI membaca…" : (c.multiple ? `${c.hint} — bisa pilih banyak` : c.hint)}</div>
              </label>
            );
          })}
        </div>

        {/* Daftar dokumen terbaca */}
        {docs.length > 0 && (
          <div className="space-y-1.5">
            {docs.map((d, i) => (
              <div key={i} className="flex items-center gap-2 border border-slate-100 rounded-md px-2.5 py-1.5 text-xs" data-testid={`onboard-doc-${i}`}>
                <FileText size={15} className="text-sky-600 shrink-0" />
                <span className="font-bold shrink-0">{d.docType}</span>
                <Input className="h-7 text-xs flex-1" value={d.keterangan} placeholder="keterangan…"
                  onChange={(e) => setDocs((arr) => arr.map((x, j) => j === i ? { ...x, keterangan: e.target.value } : x))} />
                <Trash size={14} className="text-rose-500 cursor-pointer shrink-0" onClick={() => setDocs((arr) => arr.filter((_, j) => j !== i))} />
              </div>
            ))}
          </div>
        )}

        {/* Form lengkap (terisi otomatis dari dokumen) */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Sec>Data Pribadi</Sec>
          <div><Label className="text-xs text-slate-500">Nama Lengkap *</Label><Input value={f.nama} onChange={set("nama")} data-testid="onboard-f-nama" /></div>
          {fld("nik", "NIK Karyawan", { placeholder: "MKS 0001" })}
          {fld("nik_ktp", "No. KTP")}
          {fld("no_kk", "No. Kartu Keluarga")}
          {fld("tempat_lahir", "Tempat Lahir")}
          <div><Label className="text-xs text-slate-500">Tanggal Lahir</Label><Input type="date" value={f.tanggal_lahir} onChange={set("tanggal_lahir")} /></div>
          <div><Label className="text-xs text-slate-500">Jenis Kelamin</Label>{sel("jenis_kelamin", ["Laki-laki", "Perempuan"])}</div>
          <div><Label className="text-xs text-slate-500">Golongan Darah</Label>{sel("golongan_darah", ["A", "B", "AB", "O", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"])}</div>
          {fld("kewarganegaraan", "Kewarganegaraan", { placeholder: "WNI" })}
          <div><Label className="text-xs text-slate-500">Agama</Label>{sel("agama", ["Islam", "Kristen", "Katolik", "Hindu", "Buddha", "Konghucu"])}</div>
          <div><Label className="text-xs text-slate-500">Status Kawin</Label>{sel("status_kawin", ["Belum Kawin", "Kawin", "Cerai Hidup", "Cerai Mati"])}</div>
          {fld("nama_pasangan", "Nama Pasangan")}
          {fld("jumlah_tanggungan", "Jumlah Tanggungan", { placeholder: "0" })}
          {fld("nama_ibu_kandung", "Nama Ibu Kandung")}
          {fld("pendidikan", "Pendidikan Terakhir", { placeholder: "SMA / D3 / S1" })}
          {fld("jurusan", "Jurusan", { placeholder: "mis. Teknik Mesin" })}
          {fld("telp", "Telp / WA")}
          {fld("email", "Email")}
          <div className="col-span-2 md:col-span-3"><Label className="text-xs text-slate-500">Alamat (sesuai KTP)</Label><Textarea rows={2} value={f.alamat} onChange={set("alamat")} /></div>
          <div className="col-span-2 md:col-span-3"><Label className="text-xs text-slate-500">Alamat Domisili (bila berbeda)</Label><Textarea rows={2} value={f.alamat_domisili} onChange={set("alamat_domisili")} /></div>

          <Sec>Kepegawaian</Sec>
          {fld("dept", "Departemen", { placeholder: "Production" })}
          {fld("jabatan", "Jabatan")}
          <div><Label className="text-xs text-slate-500">Status Karyawan</Label>{sel("status_karyawan", ["Tetap", "Kontrak", "Harian", "Magang"])}</div>
          <div><Label className="text-xs text-slate-500">Tanggal Masuk</Label><Input type="date" value={f.tanggal_masuk} onChange={set("tanggal_masuk")} /></div>

          <Sec>Pembayaran & Jaminan</Sec>
          {fld("bank", "Bank")}
          {fld("no_rekening", "No. Rekening")}
          {fld("npwp", "NPWP")}
          {fld("no_bpjs_tk", "BPJS Ketenagakerjaan")}
          {fld("no_bpjs_kes", "BPJS Kesehatan")}

          <Sec>Kontak Darurat</Sec>
          {fld("kontak_darurat_nama", "Nama Kontak Darurat")}
          {fld("kontak_darurat_hubungan", "Hubungan", { placeholder: "mis. Istri / Orang Tua" })}
          {fld("kontak_darurat_telp", "Telp Kontak Darurat")}
        </div>

        {/* Tabel Riwayat Pendidikan (dari Ijazah) */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-[11px] font-bold uppercase tracking-wider text-rose-600">Riwayat Pendidikan (dari Ijazah)</div>
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => addRow("riwayat_pendidikan", { jenjang: "", jurusan: "", institusi: "", tahun: "" })} data-testid="onboard-add-edu"><Plus size={13} /> Baris</Button>
          </div>
          {(f.riwayat_pendidikan || []).length === 0 ? (
            <div className="text-[11px] text-slate-400 border border-dashed border-slate-200 rounded-md text-center py-2">Upload Ijazah agar terisi otomatis, atau tambah manual.</div>
          ) : (
            <div className="space-y-1.5">
              {(f.riwayat_pendidikan || []).map((r, i) => (
                <div key={i} className="grid grid-cols-12 gap-1.5 items-center" data-testid={`onboard-edu-${i}`}>
                  <Input className="h-8 text-xs col-span-2" value={r.jenjang} placeholder="Jenjang" onChange={(e) => setRow("riwayat_pendidikan", i, "jenjang", e.target.value)} />
                  <Input className="h-8 text-xs col-span-4" value={r.jurusan} placeholder="Jurusan" onChange={(e) => setRow("riwayat_pendidikan", i, "jurusan", e.target.value)} />
                  <Input className="h-8 text-xs col-span-4" value={r.institusi} placeholder="Institusi" onChange={(e) => setRow("riwayat_pendidikan", i, "institusi", e.target.value)} />
                  <Input className="h-8 text-xs col-span-1" value={r.tahun} placeholder="Thn" onChange={(e) => setRow("riwayat_pendidikan", i, "tahun", e.target.value)} />
                  <Trash size={14} className="text-rose-500 cursor-pointer col-span-1 mx-auto" onClick={() => rmRow("riwayat_pendidikan", i)} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tabel Riwayat Pengalaman Kerja */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-[11px] font-bold uppercase tracking-wider text-rose-600">Riwayat Pengalaman Kerja</div>
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => addRow("riwayat_pengalaman", { posisi: "", perusahaan: "", periode: "" })} data-testid="onboard-add-exp"><Plus size={13} /> Baris</Button>
          </div>
          {(f.riwayat_pengalaman || []).length === 0 ? (
            <div className="text-[11px] text-slate-400 border border-dashed border-slate-200 rounded-md text-center py-2">Upload dokumen Pengalaman Kerja agar terisi otomatis, atau tambah manual.</div>
          ) : (
            <div className="space-y-1.5">
              {(f.riwayat_pengalaman || []).map((r, i) => (
                <div key={i} className="grid grid-cols-12 gap-1.5 items-center" data-testid={`onboard-exp-${i}`}>
                  <Input className="h-8 text-xs col-span-4" value={r.posisi} placeholder="Posisi/Jabatan" onChange={(e) => setRow("riwayat_pengalaman", i, "posisi", e.target.value)} />
                  <Input className="h-8 text-xs col-span-4" value={r.perusahaan} placeholder="Perusahaan" onChange={(e) => setRow("riwayat_pengalaman", i, "perusahaan", e.target.value)} />
                  <Input className="h-8 text-xs col-span-3" value={r.periode} placeholder="Periode (2019-2022)" onChange={(e) => setRow("riwayat_pengalaman", i, "periode", e.target.value)} />
                  <Trash size={14} className="text-rose-500 cursor-pointer col-span-1 mx-auto" onClick={() => rmRow("riwayat_pengalaman", i)} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tabel Data Keluarga (dari KK) */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-[11px] font-bold uppercase tracking-wider text-rose-600">Data Keluarga (dari Kartu Keluarga)</div>
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => addRow("anggota_keluarga", { nama: "", hubungan: "", nik: "", tanggal_lahir: "", pekerjaan: "" })} data-testid="onboard-add-kel"><Plus size={13} /> Baris</Button>
          </div>
          {(f.anggota_keluarga || []).length === 0 ? (
            <div className="text-[11px] text-slate-400 border border-dashed border-slate-200 rounded-md text-center py-2">Upload Kartu Keluarga agar daftar anggota terisi otomatis, atau tambah manual.</div>
          ) : (
            <div className="space-y-1.5">
              {(f.anggota_keluarga || []).map((r, i) => (
                <div key={i} className="flex items-center gap-1.5" data-testid={`onboard-kel-${i}`}>
                  <Input className="h-8 text-xs flex-[3]" value={r.nama || ""} placeholder="Nama" onChange={(e) => setRow("anggota_keluarga", i, "nama", e.target.value)} />
                  <Input className="h-8 text-xs flex-[2]" value={r.hubungan || ""} placeholder="Hubungan" onChange={(e) => setRow("anggota_keluarga", i, "hubungan", e.target.value)} />
                  <Input className="h-8 text-xs flex-[3]" value={r.nik || ""} placeholder="NIK" onChange={(e) => setRow("anggota_keluarga", i, "nik", e.target.value)} />
                  <Input className="h-8 text-xs flex-[2]" type="date" value={r.tanggal_lahir || ""} onChange={(e) => setRow("anggota_keluarga", i, "tanggal_lahir", e.target.value)} />
                  <Input className="h-8 text-xs flex-[2]" value={r.pekerjaan || ""} placeholder="Pekerjaan" onChange={(e) => setRow("anggota_keluarga", i, "pekerjaan", e.target.value)} />
                  <Trash size={14} className="text-rose-500 cursor-pointer shrink-0" onClick={() => rmRow("anggota_keluarga", i)} />
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="text-[11px] text-slate-400">Data hasil pembacaan AI mohon diperiksa kembali sebelum disimpan. Data yang belum lengkap bisa dilengkapi nanti lewat tombol Edit.</div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Batal</Button>
          <Button className="bg-rose-600 hover:bg-rose-700" onClick={save} disabled={saving || !!reading} data-testid="onboard-save">
            {saving ? "Menyimpan…" : `Simpan Karyawan${docs.length ? ` + ${docs.length} Dokumen` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
