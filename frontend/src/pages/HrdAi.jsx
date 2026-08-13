import React, { useCallback, useEffect, useState } from "react";
import api, { formatDateID, formatApiErrorDetail } from "../lib/api";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Trash, UploadSimple, FilePdf, Sparkle, UserPlus, Copy, Archive, PencilSimple } from "@phosphor-icons/react";

const errMsg = (e) => formatApiErrorDetail(e?.response?.data?.detail) || e?.message || "Terjadi kesalahan";

const skorBadge = (s) => {
  if (s == null) return <span className="text-slate-300 text-xs">-</span>;
  const cls = s >= 75 ? "bg-emerald-100 text-emerald-700" : s >= 50 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700";
  return <Badge className={`${cls} hover:bg-inherit font-bold`}>{s}</Badge>;
};

/* ============================ Rekrutmen (Screening CV) ============================ */
export function RekrutmenSection({ can }) {
  const [items, setItems] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [jobDesc, setJobDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);

  const load = useCallback(() => {
    api.get("/hrd/candidates").then((r) => { setItems(r.data.items || []); setStatuses(r.data.statuses || []); })
      .catch((e) => toast.error(errMsg(e)));
  }, []);
  useEffect(() => { load(); }, [load]);

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    toast.info("AI sedang membaca CV… (10-30 detik)");
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("job_desc", jobDesc);
      const r = await api.post("/hrd/candidates/upload-cv", fd, { timeout: 120000 });
      toast.success(`CV ${r.data.nama || file.name} berhasil dibaca`); load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const setStatus = async (c, status) => {
    try { await api.put(`/hrd/candidates/${c.id}/status`, { status }); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const hire = async (c) => {
    try { await api.post(`/hrd/candidates/${c.id}/hire`); toast.success(`${c.nama} masuk Database Karyawan`); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const del = async (c) => {
    try { await api.delete(`/hrd/candidates/${c.id}`); toast.success("Kandidat dihapus"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const openCv = async (c) => {
    try {
      const r = await api.get(`/hrd/candidates/${c.id}/cv`, { responseType: "blob" });
      const url = URL.createObjectURL(r.data); window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div data-testid="hrd-rekrutmen">
      {can?.create && (
        <Card className="p-4 mb-4">
          <div className="text-sm font-bold text-slate-800 mb-2 flex items-center gap-1.5"><Sparkle size={16} weight="fill" className="text-amber-500" /> Screening CV Otomatis (AI)</div>
          <Label className="text-xs text-slate-500">Uraian Jabatan yang dilamar (opsional — untuk skor kecocokan)</Label>
          <Textarea rows={2} value={jobDesc} onChange={(e) => setJobDesc(e.target.value)}
            placeholder="mis. Milling Operator: mengoperasikan CNC milling, paham gambar teknik, pengalaman 2 tahun" data-testid="rekrut-jobdesc" />
          <label className="inline-flex mt-3">
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} data-testid="rekrut-cv-input" />
            <Button className="bg-rose-600 hover:bg-rose-700 gap-1.5" asChild disabled={busy}>
              <span className="cursor-pointer">{busy ? "AI membaca CV…" : <><UploadSimple size={16} /> Upload CV Pelamar</>}</span>
            </Button>
          </label>
        </Card>
      )}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-3 py-2.5 font-semibold">Nama</th>
              <th className="text-left px-3 py-2.5 font-semibold">Kontak</th>
              <th className="text-center px-3 py-2.5 font-semibold">Skor</th>
              <th className="text-left px-3 py-2.5 font-semibold">Status</th>
              <th className="text-right px-3 py-2.5 font-semibold">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 ? <tr><td colSpan={5} className="text-center py-8 text-slate-400">Belum ada kandidat. Upload CV pelamar di atas.</td></tr>
              : items.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setDetail(c)} data-testid={`rekrut-row-${c.id}`}>
                  <td className="px-3 py-2.5 font-medium text-slate-800">{c.nama || "(tanpa nama)"}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-500">{c.email}<br />{c.telp}</td>
                  <td className="px-3 py-2.5 text-center">{skorBadge(c.skor)}</td>
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <Select value={c.status} onValueChange={(v) => setStatus(c, v)}>
                      <SelectTrigger className="h-8 w-28 text-xs" data-testid={`rekrut-status-${c.id}`}><SelectValue /></SelectTrigger>
                      <SelectContent>{statuses.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-sky-600" title="Lihat CV" onClick={() => openCv(c)} data-testid={`rekrut-cv-${c.id}`}><FilePdf size={16} /></Button>
                      {can?.create && <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600" title="Jadikan Karyawan" onClick={() => hire(c)} data-testid={`rekrut-hire-${c.id}`}><UserPlus size={16} /></Button>}
                      {can?.delete && <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-500" onClick={() => del(c)} data-testid={`rekrut-del-${c.id}`}><Trash size={16} /></Button>}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </Card>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="rekrut-detail-dialog">
          {detail && (<>
            <DialogHeader><DialogTitle>{detail.nama} {skorBadge(detail.skor)}</DialogTitle></DialogHeader>
            <div className="space-y-3 text-sm">
              {detail.ringkasan && <div className="bg-slate-50 border border-slate-200 rounded-md p-3 text-xs text-slate-700">{detail.ringkasan}</div>}
              {detail.alasan_skor && <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-800"><b>Analisa kecocokan:</b> {detail.alasan_skor}</div>}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><b>Email:</b> {detail.email || "-"}</div><div><b>Telp:</b> {detail.telp || "-"}</div>
                <div className="col-span-2"><b>Alamat:</b> {detail.alamat || "-"}</div>
                <div><b>Tgl Lahir:</b> {detail.tanggal_lahir ? formatDateID(detail.tanggal_lahir) : "-"}</div>
              </div>
              {["pendidikan", "pengalaman", "skill"].map((k) => (detail[k] || []).length > 0 && (
                <div key={k}>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-rose-600 border-b border-slate-200 pb-1 mb-1.5">{k}</div>
                  <ul className="text-xs text-slate-700 space-y-1">{detail[k].map((x, i) => <li key={i}>• {x}</li>)}</ul>
                </div>
              ))}
            </div>
          </>)}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ============================ Draft Surat AI ============================ */
const DRAFT_KINDS = [["sp", "Surat Peringatan (SP)"], ["panggilan", "Surat Panggilan"], ["memo", "Internal Memo"], ["pengumuman", "Pengumuman"]];

export function DraftAiSection({ can }) {
  const [people, setPeople] = useState([]);
  const [jenis, setJenis] = useState("sp");
  const [empId, setEmpId] = useState("");
  const [tingkat, setTingkat] = useState("SP1");
  const [kronologi, setKronologi] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [letters, setLetters] = useState([]);
  const [editing, setEditing] = useState(null); // letter record
  const [editBody, setEditBody] = useState("");

  const loadLetters = useCallback(() => {
    api.get("/hrd/letters").then((r) => setLetters(r.data.items || [])).catch(() => {});
  }, []);
  useEffect(() => { loadLetters(); }, [loadLetters]);

  const openBlob = async (url, method = "get", data = null) => {
    const r = method === "post"
      ? await api.post(url, data, { responseType: "blob", timeout: 60000 })
      : await api.get(url, { responseType: "blob" });
    const u = URL.createObjectURL(r.data); window.open(u, "_blank");
    setTimeout(() => URL.revokeObjectURL(u), 60000);
  };
  const preview = async () => {
    if (!draft.trim()) return;
    try { await openBlob("/hrd/ai/preview-letter", "post", { jenis, employee_id: empId, tingkat_sp: jenis === "sp" ? tingkat : "", body: draft }); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const saveEdit = async () => {
    try {
      await api.put(`/hrd/letters/${editing.id}`, { body: editBody });
      toast.success(`${editing.nomor} diperbarui`); setEditing(null); loadLetters();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const delLetter = async (l) => {
    try { await api.delete(`/hrd/letters/${l.id}`); toast.success("Surat dihapus (masuk Recycle Bin)"); loadLetters(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const JLABEL = { skk: "Ket. Kerja", paklaring: "Pengalaman", sp: "SP", panggilan: "Panggilan", memo: "Memo", pengumuman: "Pengumuman" };

  useEffect(() => { api.get("/hrd/people").then((r) => setPeople(r.data.items || [])).catch(() => {}); }, []);

  const generate = async () => {
    if (!kronologi.trim()) { toast.error("Isi kronologi/poin singkat dulu"); return; }
    setBusy(true); setDraft("");
    toast.info("AI sedang menulis draft… (10-30 detik)");
    try {
      const r = await api.post("/hrd/ai/draft-letter", { jenis, employee_id: empId, tingkat_sp: jenis === "sp" ? tingkat : "", kronologi }, { timeout: 120000 });
      setDraft(r.data.draft); toast.success("Draft selesai — silakan koreksi");
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const copy = () => { navigator.clipboard.writeText(draft); toast.success("Draft disalin"); };
  const arsipkan = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      const r = await api.post("/hrd/ai/save-letter", { jenis, employee_id: empId, tingkat_sp: jenis === "sp" ? tingkat : "", body: draft });
      toast.success(`Surat ${r.data.nomor} diterbitkan${jenis === "sp" && empId ? " + tercatat di Riwayat Karir" : ""}`);
      await openBlob(`/hrd/letters/${r.data.id}/pdf`);
      setDraft(""); loadLetters();
    } catch (e) { toast.error(errMsg(e)); } finally { setSaving(false); }
  };

  return (
    <div data-testid="hrd-draftai" className="max-w-4xl">
      <Card className="p-4 mb-4">
        <div className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-1.5"><Sparkle size={16} weight="fill" className="text-amber-500" /> Draft Surat Otomatis (AI)</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div><Label className="text-xs text-slate-500">Jenis Surat</Label>
            <Select value={jenis} onValueChange={setJenis}>
              <SelectTrigger data-testid="draft-jenis"><SelectValue /></SelectTrigger>
              <SelectContent>{DRAFT_KINDS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
            </Select></div>
          {jenis === "sp" && (
            <div><Label className="text-xs text-slate-500">Tingkat</Label>
              <Select value={tingkat} onValueChange={setTingkat}>
                <SelectTrigger data-testid="draft-tingkat"><SelectValue /></SelectTrigger>
                <SelectContent>{["SP1", "SP2", "SP3"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select></div>
          )}
          <div className="col-span-2"><Label className="text-xs text-slate-500">Karyawan Terkait (opsional)</Label>
            <Select value={empId || "none"} onValueChange={(v) => setEmpId(v === "none" ? "" : v)}>
              <SelectTrigger data-testid="draft-emp"><SelectValue placeholder="Pilih…" /></SelectTrigger>
              <SelectContent><SelectItem value="none">— Tanpa karyawan —</SelectItem>
                {people.map((p) => <SelectItem key={p.id} value={p.id}>{p.nama}</SelectItem>)}</SelectContent>
            </Select></div>
        </div>
        <Label className="text-xs text-slate-500">Kronologi / poin singkat (bahasa bebas)</Label>
        <Textarea rows={3} value={kronologi} onChange={(e) => setKronologi(e.target.value)}
          placeholder="mis. terlambat 5x bulan ini tanpa keterangan, sudah ditegur lisan 2x oleh leader" data-testid="draft-kronologi" />
        <Button className="mt-3 bg-rose-600 hover:bg-rose-700 gap-1.5" onClick={generate} disabled={busy} data-testid="draft-generate">
          <Sparkle size={16} weight="fill" /> {busy ? "AI menulis…" : "Buat Draft"}
        </Button>
      </Card>

      {draft && (
        <Card className="p-4" data-testid="draft-result">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className="text-sm font-bold text-slate-800">Hasil Draft — silakan edit langsung</div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={copy} data-testid="draft-copy"><Copy size={14} /> Salin</Button>
              <Button variant="outline" size="sm" className="gap-1.5 text-sky-700 border-sky-300 hover:bg-sky-50" onClick={preview} data-testid="draft-preview">
                <FilePdf size={14} /> Preview PDF
              </Button>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 gap-1.5" onClick={arsipkan} disabled={saving} data-testid="draft-arsipkan">
                <Archive size={14} weight="fill" /> {saving ? "Menyimpan…" : "Terbitkan (Nomor + Arsip)"}
              </Button>
            </div>
          </div>
          <Textarea rows={16} value={draft} onChange={(e) => setDraft(e.target.value)} className="font-mono text-xs" data-testid="draft-textarea" />
          <div className="text-[11px] text-slate-400 mt-2">Preview PDF = lihat hasil tanpa nomor. Terbitkan = surat dapat nomor resmi, masuk Masterlist di bawah (ber-QR), dan SP otomatis tercatat di Riwayat Karir.</div>
        </Card>
      )}

      {/* Masterlist semua surat */}
      <Card className="mt-4 overflow-x-auto" data-testid="draft-masterlist">
        <div className="px-4 pt-3 pb-1 text-sm font-bold text-slate-800">Masterlist Surat ({letters.length})</div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2 font-semibold">Nomor</th>
              <th className="text-left px-4 py-2 font-semibold">Jenis</th>
              <th className="text-left px-4 py-2 font-semibold">Nama</th>
              <th className="text-left px-4 py-2 font-semibold">Kode</th>
              <th className="text-left px-4 py-2 font-semibold">Oleh</th>
              <th className="text-right px-4 py-2 font-semibold">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {letters.length === 0 ? <tr><td colSpan={6} className="text-center py-6 text-slate-400">Belum ada surat diterbitkan.</td></tr>
              : letters.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50" data-testid={`ml-row-${l.id}`}>
                  <td className="px-4 py-2 font-medium text-slate-800 whitespace-nowrap">{l.nomor}</td>
                  <td className="px-4 py-2 text-xs">{JLABEL[l.jenis] || l.jenis}{l.tingkat_sp ? ` ${l.tingkat_sp}` : ""}</td>
                  <td className="px-4 py-2 text-xs">{l.nama || "-"}</td>
                  <td className="px-4 py-2 font-mono text-[10px] text-slate-500">{l.kode}</td>
                  <td className="px-4 py-2 text-[10px] text-slate-500">{l.created_by}{l.edited_by ? ` (edit: ${l.edited_by})` : ""}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-sky-600" onClick={() => openBlob(`/hrd/letters/${l.id}/pdf`).catch((e) => toast.error(errMsg(e)))} data-testid={`ml-pdf-${l.id}`}><FilePdf size={15} /></Button>
                      {l.body && can?.edit && <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-600" onClick={() => { setEditing(l); setEditBody(l.body); }} data-testid={`ml-edit-${l.id}`}><PencilSimple size={15} /></Button>}
                      {can?.delete && <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-500" onClick={() => delLetter(l)} data-testid={`ml-del-${l.id}`}><Trash size={15} /></Button>}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl" data-testid="ml-edit-dialog">
          <DialogHeader><DialogTitle>Edit Isi — {editing?.nomor}</DialogTitle></DialogHeader>
          <Textarea rows={14} value={editBody} onChange={(e) => setEditBody(e.target.value)} className="font-mono text-xs" data-testid="ml-edit-body" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>Batal</Button>
            <Button className="bg-rose-600 hover:bg-rose-700" onClick={saveEdit} data-testid="ml-edit-save">Simpan Perubahan</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
