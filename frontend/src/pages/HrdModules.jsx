import React, { useCallback, useEffect, useMemo, useState } from "react";
import api, { formatDateID, formatApiErrorDetail, downloadXlsx } from "../lib/api";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Textarea } from "../components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Trash, Plus, Megaphone, Star, CalendarBlank, PencilSimple, Buildings, FileXls } from "@phosphor-icons/react";
import { Avatar } from "./HrdDokumen";

const errMsg = (e) => formatApiErrorDetail(e?.response?.data?.detail) || e?.message || "Terjadi kesalahan";
const BULAN = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

const Th = ({ children, right, center }) => (
  <th className={`px-3 py-2.5 font-semibold ${right ? "text-right" : center ? "text-center" : "text-left"}`}>{children}</th>
);

function EmpSelect({ people, value, onChange, testid }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger data-testid={testid}><SelectValue placeholder="Pilih karyawan…" /></SelectTrigger>
      <SelectContent>{people.map((p) => <SelectItem key={p.id} value={p.id}>{p.nama}{p.nik ? ` — ${p.nik}` : ""}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function usePeople() {
  const [people, setPeople] = useState([]);
  useEffect(() => { api.get("/hrd/people").then((r) => setPeople(r.data.items || [])).catch(() => {}); }, []);
  return people;
}

/* ============================ Cuti & Izin ============================ */
export function CutiSection({ can }) {
  const people = usePeople();
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState({ items: [], balances: [], quota: 12 });
  const [empId, setEmpId] = useState("");
  const [jenis, setJenis] = useState("Cuti Tahunan");
  const [mulai, setMulai] = useState("");
  const [selesai, setSelesai] = useState("");
  const [hari, setHari] = useState("1");
  const [ket, setKet] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get("/hrd/leaves", { params: { year } }).then((r) => setData(r.data)).catch((e) => toast.error(errMsg(e)));
  }, [year]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (mulai && selesai) {
      const d = Math.round((new Date(selesai) - new Date(mulai)) / 86400000) + 1;
      if (d > 0) setHari(String(d));
    }
  }, [mulai, selesai]);

  const add = async () => {
    if (!empId || !mulai) { toast.error("Pilih karyawan & tanggal mulai"); return; }
    setBusy(true);
    try {
      await api.post("/hrd/leaves", { employee_id: empId, jenis, tanggal_mulai: mulai, tanggal_selesai: selesai || mulai, jumlah_hari: parseFloat(hari) || 1, keterangan: ket });
      toast.success("Cuti/izin tercatat"); setKet(""); setMulai(""); setSelesai(""); setHari("1"); load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const del = async (id) => {
    try { await api.delete(`/hrd/leaves/${id}`); toast.success("Dihapus"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const jenisBadge = (j) => {
    const map = { "Cuti Tahunan": "bg-emerald-100 text-emerald-700", "Sakit": "bg-rose-100 text-rose-700", "Izin": "bg-sky-100 text-sky-700", "Cuti Khusus": "bg-violet-100 text-violet-700" };
    return <Badge className={`${map[j] || "bg-slate-100 text-slate-600"} hover:bg-inherit text-[10px]`}>{j}</Badge>;
  };

  return (
    <div data-testid="hrd-cuti">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="text-sm text-slate-500">Kuota cuti tahunan: <b>{data.quota} hari</b> / karyawan</div>
        <div className="flex items-center gap-2">
          <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v))}>
            <SelectTrigger className="w-28" data-testid="cuti-year"><SelectValue /></SelectTrigger>
            <SelectContent>{[0, 1, 2].map((i) => { const y = new Date().getFullYear() - i; return <SelectItem key={y} value={String(y)}>{y}</SelectItem>; })}</SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="gap-1.5 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
            onClick={() => downloadXlsx("/hrd/leaves/export", { year }, `Rekap_Cuti_${year}.xlsx`).then(() => toast.success("Excel terunduh")).catch((e) => toast.error(e.message))}
            data-testid="cuti-export">
            <FileXls size={15} weight="fill" /> Export Excel
          </Button>
        </div>
      </div>

      {can?.create && (
        <Card className="p-4 mb-4">
          <div className="text-sm font-bold text-slate-800 mb-3">Catat Cuti / Izin</div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
            <div className="col-span-2"><Label className="text-xs text-slate-500">Karyawan</Label>
              <EmpSelect people={people} value={empId} onChange={setEmpId} testid="cuti-emp" /></div>
            <div><Label className="text-xs text-slate-500">Jenis</Label>
              <Select value={jenis} onValueChange={setJenis}>
                <SelectTrigger data-testid="cuti-jenis"><SelectValue /></SelectTrigger>
                <SelectContent>{["Cuti Tahunan", "Sakit", "Izin", "Cuti Khusus"].map((j) => <SelectItem key={j} value={j}>{j}</SelectItem>)}</SelectContent>
              </Select></div>
            <div><Label className="text-xs text-slate-500">Mulai</Label><Input type="date" value={mulai} onChange={(e) => setMulai(e.target.value)} data-testid="cuti-mulai" /></div>
            <div><Label className="text-xs text-slate-500">Selesai</Label><Input type="date" value={selesai} onChange={(e) => setSelesai(e.target.value)} /></div>
            <div><Label className="text-xs text-slate-500">Jml Hari</Label><Input type="number" min="0.5" step="0.5" value={hari} onChange={(e) => setHari(e.target.value)} data-testid="cuti-hari" /></div>
            <div className="col-span-2 md:col-span-5"><Label className="text-xs text-slate-500">Keterangan</Label><Input value={ket} onChange={(e) => setKet(e.target.value)} placeholder="opsional" /></div>
            <Button className="bg-rose-600 hover:bg-rose-700 gap-1.5" onClick={add} disabled={busy} data-testid="cuti-add"><Plus size={15} weight="bold" /> Catat</Button>
          </div>
        </Card>
      )}

      <Tabs defaultValue="riwayat">
        <TabsList className="mb-3">
          <TabsTrigger value="riwayat" data-testid="cuti-tab-riwayat">Riwayat {year}</TabsTrigger>
          <TabsTrigger value="saldo" data-testid="cuti-tab-saldo">Saldo Cuti</TabsTrigger>
        </TabsList>
        <TabsContent value="riwayat">
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                <tr><Th>Nama</Th><Th>Jenis</Th><Th>Tanggal</Th><Th center>Hari</Th><Th>Keterangan</Th><Th right>Aksi</Th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.length === 0 ? <tr><td colSpan={6} className="text-center py-8 text-slate-400">Belum ada catatan cuti/izin tahun {year}.</td></tr>
                  : data.items.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50" data-testid={`cuti-row-${l.id}`}>
                      <td className="px-3 py-2.5 font-medium text-slate-800">{l.nama}</td>
                      <td className="px-3 py-2.5">{jenisBadge(l.jenis)}</td>
                      <td className="px-3 py-2.5 text-slate-600 text-xs">{formatDateID(l.tanggal_mulai)}{l.tanggal_selesai && l.tanggal_selesai !== l.tanggal_mulai ? ` — ${formatDateID(l.tanggal_selesai)}` : ""}</td>
                      <td className="px-3 py-2.5 text-center font-medium">{l.jumlah_hari}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-500">{l.keterangan || "-"}</td>
                      <td className="px-3 py-2.5 text-right">
                        {can?.delete && <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-500" onClick={() => del(l.id)} data-testid={`cuti-del-${l.id}`}><Trash size={15} /></Button>}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>
        </TabsContent>
        <TabsContent value="saldo">
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                <tr><Th>Nama</Th><Th center>Kuota</Th><Th center>Terpakai</Th><Th center>Sisa</Th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.balances.map((b) => (
                  <tr key={b.employee_id} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-medium text-slate-800">{b.nama}</td>
                    <td className="px-3 py-2.5 text-center">{b.quota}</td>
                    <td className="px-3 py-2.5 text-center">{b.terpakai}</td>
                    <td className="px-3 py-2.5 text-center">
                      <Badge className={`${b.sisa <= 2 ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"} hover:bg-inherit`}>{b.sisa}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ============================ Absensi ============================ */
const ATT_COLS = [["hadir", "Hadir"], ["terlambat", "Terlambat"], ["absen", "Absen"], ["izin", "Izin"], ["sakit", "Sakit"], ["cuti", "Cuti"]];

export function AbsensiSection({ can }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [rows, setRows] = useState([]);
  const [dirty, setDirty] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get("/hrd/attendance", { params: { year, month } })
      .then((r) => { setRows(r.data.items || []); setDirty({}); })
      .catch((e) => toast.error(errMsg(e)));
  }, [year, month]);
  useEffect(() => { load(); }, [load]);

  const setVal = (empId, key, val) => {
    setRows((rs) => rs.map((r) => r.employee_id === empId ? { ...r, [key]: val } : r));
    setDirty((d) => ({ ...d, [empId]: true }));
  };
  const saveAll = async () => {
    const ids = Object.keys(dirty);
    if (!ids.length) { toast.info("Tidak ada perubahan"); return; }
    setBusy(true);
    try {
      for (const id of ids) {
        const r = rows.find((x) => x.employee_id === id);
        await api.post("/hrd/attendance", {
          employee_id: id, year, month,
          ...Object.fromEntries(ATT_COLS.map(([k]) => [k, parseFloat(r[k]) || 0])),
        });
      }
      toast.success(`Rekap ${ids.length} karyawan tersimpan`); load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <div data-testid="hrd-absensi">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Select value={String(month)} onValueChange={(v) => setMonth(parseInt(v))}>
            <SelectTrigger className="w-36" data-testid="abs-month"><SelectValue /></SelectTrigger>
            <SelectContent>{BULAN.slice(1).map((b, i) => <SelectItem key={i + 1} value={String(i + 1)}>{b}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v))}>
            <SelectTrigger className="w-24" data-testid="abs-year"><SelectValue /></SelectTrigger>
            <SelectContent>{[0, 1, 2].map((i) => { const y = now.getFullYear() - i; return <SelectItem key={y} value={String(y)}>{y}</SelectItem>; })}</SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
            onClick={() => downloadXlsx("/hrd/attendance/export", { year, month }, `Rekap_Absensi_${String(month).padStart(2, "0")}_${year}.xlsx`).then(() => toast.success("Excel terunduh")).catch((e) => toast.error(e.message))}
            data-testid="abs-export">
            <FileXls size={15} weight="fill" /> Export Excel
          </Button>
          {can?.edit && (
            <Button size="sm" className="bg-rose-600 hover:bg-rose-700" onClick={saveAll} disabled={busy || !Object.keys(dirty).length} data-testid="abs-save">
              {busy ? "Menyimpan…" : `Simpan Rekap${Object.keys(dirty).length ? ` (${Object.keys(dirty).length})` : ""}`}
            </Button>
          )}
        </div>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
            <tr><Th>Nama</Th>{ATT_COLS.map(([k, l]) => <Th key={k} center>{l}</Th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-slate-400">Belum ada karyawan di database.</td></tr>
              : rows.map((r) => (
                <tr key={r.employee_id} className="hover:bg-slate-50" data-testid={`abs-row-${r.employee_id}`}>
                  <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">{r.nama}</td>
                  {ATT_COLS.map(([k]) => (
                    <td key={k} className="px-2 py-1.5 text-center">
                      <Input type="number" min="0" step="0.5" value={r[k]} disabled={!can?.edit}
                        onChange={(e) => setVal(r.employee_id, k, e.target.value)}
                        className="h-8 w-16 mx-auto text-center text-xs" data-testid={`abs-${k}-${r.employee_id}`} />
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </Card>
      <div className="text-[11px] text-slate-400 mt-2">Isi rekap bulanan per karyawan (satuan hari), lalu klik Simpan Rekap.</div>
    </div>
  );
}

/* ============================ Penilaian Kinerja ============================ */
const KRITERIA = [["disiplin", "Disiplin"], ["kualitas", "Kualitas Kerja"], ["kerjasama", "Kerjasama"], ["inisiatif", "Inisiatif"], ["kehadiran", "Kehadiran"]];

export function KinerjaSection({ can }) {
  const people = usePeople();
  const [items, setItems] = useState([]);
  const [empId, setEmpId] = useState("");
  const [periode, setPeriode] = useState("");
  const [skor, setSkor] = useState({});
  const [catatan, setCatatan] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get("/hrd/reviews").then((r) => setItems(r.data.items || [])).catch((e) => toast.error(errMsg(e)));
  }, []);
  useEffect(() => { load(); }, [load]);

  const rata = useMemo(() => {
    const v = KRITERIA.map(([k]) => parseFloat(skor[k])).filter((x) => x > 0);
    return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : "-";
  }, [skor]);

  const add = async () => {
    if (!empId || !periode.trim()) { toast.error("Pilih karyawan & isi periode"); return; }
    setBusy(true);
    try {
      await api.post("/hrd/reviews", { employee_id: empId, periode, skor: Object.fromEntries(KRITERIA.map(([k]) => [k, parseFloat(skor[k]) || 0])), catatan });
      toast.success("Penilaian tersimpan"); setSkor({}); setCatatan(""); setPeriode(""); load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const del = async (id) => {
    try { await api.delete(`/hrd/reviews/${id}`); toast.success("Dihapus"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const scoreColor = (v) => v >= 4 ? "text-emerald-600" : v >= 3 ? "text-amber-600" : "text-rose-600";

  return (
    <div data-testid="hrd-kinerja">
      {can?.create && (
        <Card className="p-4 mb-4">
          <div className="text-sm font-bold text-slate-800 mb-3">Penilaian Baru</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <div className="col-span-2"><Label className="text-xs text-slate-500">Karyawan</Label>
              <EmpSelect people={people} value={empId} onChange={setEmpId} testid="rev-emp" /></div>
            <div className="col-span-2"><Label className="text-xs text-slate-500">Periode</Label>
              <Input value={periode} onChange={(e) => setPeriode(e.target.value)} placeholder={`mis. Semester 1 ${new Date().getFullYear()}`} data-testid="rev-periode" /></div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
            {KRITERIA.map(([k, l]) => (
              <div key={k}><Label className="text-xs text-slate-500">{l} (1-5)</Label>
                <Input type="number" min="1" max="5" step="0.5" value={skor[k] || ""} onChange={(e) => setSkor({ ...skor, [k]: e.target.value })} data-testid={`rev-skor-${k}`} /></div>
            ))}
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex-1 min-w-56"><Label className="text-xs text-slate-500">Catatan</Label>
              <Textarea rows={1} value={catatan} onChange={(e) => setCatatan(e.target.value)} /></div>
            <div className="text-sm text-slate-600">Rata-rata: <b className="text-lg">{rata}</b></div>
            <Button className="bg-rose-600 hover:bg-rose-700 gap-1.5" onClick={add} disabled={busy} data-testid="rev-add"><Star size={15} weight="fill" /> Simpan</Button>
          </div>
        </Card>
      )}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
            <tr><Th>Nama</Th><Th>Periode</Th>{KRITERIA.map(([k, l]) => <Th key={k} center>{l.split(" ")[0]}</Th>)}<Th center>Rata</Th><Th>Catatan</Th><Th right>Aksi</Th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 ? <tr><td colSpan={10} className="text-center py-8 text-slate-400">Belum ada penilaian.</td></tr>
              : items.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50" data-testid={`rev-row-${r.id}`}>
                  <td className="px-3 py-2.5 font-medium text-slate-800">{r.nama}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">{r.periode}</td>
                  {KRITERIA.map(([k]) => <td key={k} className="px-3 py-2.5 text-center text-xs">{r.skor?.[k] || "-"}</td>)}
                  <td className={`px-3 py-2.5 text-center font-bold ${scoreColor(r.rata)}`}>{r.rata}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-500 max-w-40 truncate">{r.catatan || "-"}</td>
                  <td className="px-3 py-2.5 text-right">
                    {can?.delete && <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-500" onClick={() => del(r.id)} data-testid={`rev-del-${r.id}`}><Trash size={15} /></Button>}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* ============================ Struktur Organisasi ============================ */
export function OrgSection() {
  const people = usePeople();
  const byDept = useMemo(() => {
    const m = {};
    people.forEach((p) => {
      const d = p.dept || "Lainnya";
      (m[d] = m[d] || []).push(p);
    });
    return Object.entries(m).sort((a, b) => b[1].length - a[1].length);
  }, [people]);
  return (
    <div data-testid="hrd-org">
      {byDept.length === 0 ? <div className="text-center text-slate-400 text-sm py-12">Belum ada karyawan di database.</div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {byDept.map(([dept, emps]) => (
            <Card key={dept} className="p-4" data-testid={`org-dept-${dept}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Buildings size={18} weight="duotone" className="text-sky-600" />
                  <div className="font-bold text-slate-800 text-sm">{dept}</div>
                </div>
                <Badge variant="secondary" className="text-[10px]">{emps.length} orang</Badge>
              </div>
              <div className="space-y-1.5">
                {emps.map((p) => (
                  <div key={p.id} className="flex items-center gap-2.5 border border-slate-100 rounded-md px-2.5 py-1.5">
                    <Avatar p={p} className="h-7 w-7 text-[10px]" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-800 truncate">{p.nama}</div>
                      <div className="text-[10px] text-slate-400">{p.jabatan || "-"}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================ Pengumuman (kelola) ============================ */
export function PengumumanSection({ can }) {
  const [items, setItems] = useState([]);
  const [judul, setJudul] = useState("");
  const [isi, setIsi] = useState("");
  const [penting, setPenting] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get("/hrd/announcements").then((r) => setItems(r.data.items || [])).catch((e) => toast.error(errMsg(e)));
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!judul.trim()) { toast.error("Judul wajib diisi"); return; }
    setBusy(true);
    try {
      await api.post("/hrd/announcements", { judul, isi, penting });
      toast.success("Pengumuman diterbitkan"); setJudul(""); setIsi(""); setPenting(false); load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const del = async (id) => {
    try { await api.delete(`/hrd/announcements/${id}`); toast.success("Dihapus"); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div data-testid="hrd-pengumuman" className="max-w-3xl">
      {can?.create && (
        <Card className="p-4 mb-4">
          <div className="text-sm font-bold text-slate-800 mb-3">Buat Pengumuman</div>
          <div className="space-y-3">
            <div><Label className="text-xs text-slate-500">Judul</Label>
              <Input value={judul} onChange={(e) => setJudul(e.target.value)} data-testid="ann-judul" /></div>
            <div><Label className="text-xs text-slate-500">Isi</Label>
              <Textarea rows={3} value={isi} onChange={(e) => setIsi(e.target.value)} data-testid="ann-isi" /></div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                <input type="checkbox" checked={penting} onChange={(e) => setPenting(e.target.checked)} data-testid="ann-penting" />
                Tandai PENTING (tampil kuning di Beranda)
              </label>
              <Button className="bg-rose-600 hover:bg-rose-700 gap-1.5" onClick={add} disabled={busy} data-testid="ann-add">
                <Megaphone size={15} weight="fill" /> Terbitkan
              </Button>
            </div>
          </div>
        </Card>
      )}
      <div className="space-y-2">
        {items.length === 0 ? <div className="text-center text-slate-400 text-sm py-10 border border-dashed border-slate-200 rounded-md">Belum ada pengumuman.</div>
          : items.map((a) => (
            <Card key={a.id} className={`p-4 flex items-start gap-3 ${a.penting ? "border-amber-300 bg-amber-50/50" : ""}`} data-testid={`ann-row-${a.id}`}>
              <Megaphone size={18} weight="fill" className={`shrink-0 mt-0.5 ${a.penting ? "text-amber-600" : "text-sky-600"}`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-800">{a.judul} {a.penting && <Badge className="ml-1 bg-amber-500 hover:bg-amber-500 text-white text-[9px]">PENTING</Badge>}</div>
                {a.isi && <div className="text-xs text-slate-600 mt-1 whitespace-pre-line">{a.isi}</div>}
                <div className="text-[10px] text-slate-400 mt-1.5">{a.created_by} • {formatDateID(a.created_at)}</div>
              </div>
              {can?.delete && <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-500 shrink-0" onClick={() => del(a.id)} data-testid={`ann-del-${a.id}`}><Trash size={15} /></Button>}
            </Card>
          ))}
      </div>
    </div>
  );
}
