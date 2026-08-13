import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import api, { formatApiErrorDetail } from "../lib/api";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Checkbox } from "../components/ui/checkbox";
import { Switch } from "../components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { ShieldCheck, Plus, PencilSimple, Trash, ArrowLeft, LockKey } from "@phosphor-icons/react";
import { RecycleBin, BackupButton } from "../components/AdminTools";

const errMsg = (e) => formatApiErrorDetail(e?.response?.data?.detail) || e?.message || "Terjadi kesalahan";
const ROLES = [
  { v: "hrd", l: "HRD (Portal HRD)" },
  { v: "admin", l: "Admin" },
  { v: "super_admin", l: "Super Admin" },
  { v: "staff", l: "Staff" },
];
const ACTION_LABEL = { view: "Lihat", create: "Buat", edit: "Edit", delete: "Hapus", report: "Laporan/PDF" };
const GAJI_KEYS = ["hrd_karyawan", "hrd_slip_gaji", "hrd_email", "hrd_settings"];
const EMPTY = { username: "", password: "", name: "", role: "hrd", access: {} };

/* ============ Access matrix editor (granular per menu/action) ============ */
export function HrdAccessMatrix({ defs, access, onChange }) {
  if (!defs) return <div className="text-sm text-slate-400 py-4">Memuat definisi menu…</div>;
  const { menus, actions } = defs;
  const toggle = (menu, action, val) => {
    const next = { ...access, [menu]: { ...(access[menu] || {}), [action]: val } };
    onChange(next);
  };
  const toggleRow = (menu, val) => {
    const row = {}; actions.forEach((a) => (row[a] = val));
    onChange({ ...access, [menu]: row });
  };
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden" data-testid="hrd-access-matrix">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500 text-xs">
          <tr>
            <th className="text-left px-3 py-2 font-semibold">Menu HRD</th>
            {actions.map((a) => <th key={a} className="px-2 py-2 font-semibold text-center">{ACTION_LABEL[a] || a}</th>)}
            <th className="px-2 py-2 font-semibold text-center">Semua</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {menus.map((m) => {
            const row = access[m.key] || {};
            const allOn = actions.every((a) => row[a]);
            const isGaji = GAJI_KEYS.includes(m.key);
            return (
              <tr key={m.key} className="hover:bg-slate-50">
                <td className="px-3 py-2 font-medium text-slate-700">
                  <span className="flex items-center gap-1.5">
                    {isGaji && <LockKey size={13} weight="fill" className="text-emerald-600" title="Area Gaji (terkunci PIN)" />}
                    {m.label}
                  </span>
                </td>
                {actions.map((a) => (
                  <td key={a} className="px-2 py-2 text-center">
                    <Checkbox checked={!!row[a]} onCheckedChange={(v) => toggle(m.key, a, !!v)}
                      data-testid={`acc-${m.key}-${a}`} />
                  </td>
                ))}
                <td className="px-2 py-2 text-center">
                  <Checkbox checked={allOn} onCheckedChange={(v) => toggleRow(m.key, !!v)} data-testid={`acc-${m.key}-all`} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ============================ Admin Page ============================ */
export default function AdminPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [defs, setDefs] = useState(null);
  const [dlg, setDlg] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [delUser, setDelUser] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get("/users"); setUsers(r.data || []); }
    catch (e) { toast.error(errMsg(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get("/hrd/menu-defs").then((r) => setDefs(r.data)).catch(() => {}); }, []);

  if (user && !user.is_super_admin) {
    return (
      <div className="min-h-[calc(100vh-60px)] flex items-center justify-center p-6">
        <Card className="max-w-md w-full p-8 text-center space-y-3">
          <ShieldCheck size={40} weight="duotone" className="mx-auto text-rose-500" />
          <h2 className="text-lg font-bold text-slate-800">Khusus Super Admin</h2>
          <p className="text-sm text-slate-500">Hanya Super Admin yang bisa mengelola user & hak akses.</p>
          <Button variant="outline" onClick={() => navigate("/")}>Kembali</Button>
        </Card>
      </div>
    );
  }

  const openNew = () => { setForm(EMPTY); setEditId(null); setActive(true); setDlg(true); };
  const openEdit = (u) => {
    setForm({ username: u.username, password: "", name: u.name, role: u.role, access: u.access || {} });
    setEditId(u.id); setActive(u.active !== false); setDlg(true);
  };
  const save = async () => {
    if (!editId && (!form.username || form.username.length < 3)) return toast.error("Username minimal 3 karakter");
    if (!editId && (!form.password || form.password.length < 6)) return toast.error("Password minimal 6 karakter");
    setBusy(true);
    try {
      if (editId) {
        const body = { name: form.name, role: form.role, access: form.access, active };
        if (form.password) body.password = form.password;
        await api.put(`/users/${editId}`, body);
      } else {
        await api.post("/users", { username: form.username, password: form.password, name: form.name, role: form.role, access: form.access });
      }
      toast.success("User tersimpan"); setDlg(false); load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const doDelete = async () => {
    try { await api.delete(`/users/${delUser.id}`); toast.success("User dihapus"); setDelUser(null); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const roleBadge = (r) => {
    const map = { super_admin: "bg-rose-100 text-rose-700", admin: "bg-amber-100 text-amber-700", hrd: "bg-teal-100 text-teal-700", staff: "bg-slate-100 text-slate-600" };
    return <Badge className={`${map[r] || map.staff} hover:${map[r] || map.staff}`}>{r}</Badge>;
  };
  const accessSummary = (acc) => {
    const keys = Object.keys(acc || {}).filter((k) => acc[k]?.view);
    if (!keys.length) return <span className="text-slate-400 text-xs">—</span>;
    const hasGaji = keys.some((k) => GAJI_KEYS.includes(k));
    return <span className="text-xs text-slate-600">{keys.length} menu {hasGaji && <Badge variant="secondary" className="ml-1 text-emerald-600">+Gaji</Badge>}</span>;
  };

  return (
    <div className="min-h-[calc(100vh-60px)] bg-slate-50">
      <div className="max-w-[1200px] mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 flex items-center justify-center bg-slate-800 text-white rounded-md"><ShieldCheck size={22} weight="duotone" /></span>
            <div>
              <h1 className="text-xl font-bold" style={{ fontFamily: "Chivo, sans-serif" }}>Admin — User & Hak Akses</h1>
              <p className="text-xs text-slate-500">Kelola akun dan hak akses granular Portal HRD.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate("/")}><ArrowLeft size={15} /> Portal HRD</Button>
            <BackupButton />
            <Button className="bg-teal-600 hover:bg-teal-700 gap-1.5" onClick={openNew} data-testid="admin-add-user"><Plus size={16} weight="bold" /> Tambah User</Button>
          </div>
        </div>

        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2.5 font-semibold">Username</th>
                <th className="text-left px-4 py-2.5 font-semibold">Nama</th>
                <th className="text-left px-4 py-2.5 font-semibold">Role</th>
                <th className="text-left px-4 py-2.5 font-semibold">Akses HRD</th>
                <th className="text-center px-4 py-2.5 font-semibold">Status</th>
                <th className="text-right px-4 py-2.5 font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (<tr><td colSpan={6} className="text-center py-10 text-slate-400">Memuat…</td></tr>)
                : users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50" data-testid={`admin-user-row-${u.username}`}>
                    <td className="px-4 py-2.5 font-medium text-slate-800">{u.username}</td>
                    <td className="px-4 py-2.5 text-slate-600">{u.name}</td>
                    <td className="px-4 py-2.5">{roleBadge(u.role)}</td>
                    <td className="px-4 py-2.5">{accessSummary(u.access)}</td>
                    <td className="px-4 py-2.5 text-center">{u.active === false ? <Badge variant="secondary" className="text-rose-500">Nonaktif</Badge> : <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Aktif</Badge>}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(u)} data-testid={`admin-edit-${u.username}`}><PencilSimple size={16} /></Button>
                        {u.id !== user?.id && <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-500" onClick={() => setDelUser(u)} data-testid={`admin-del-${u.username}`}><Trash size={16} /></Button>}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>

        <RecycleBin />
      </div>

      <Dialog open={dlg} onOpenChange={setDlg}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="admin-user-dialog">
          <DialogHeader><DialogTitle>{editId ? "Edit User" : "Tambah User"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Username {editId && <span className="text-xs text-slate-400">(tidak bisa diubah)</span>}</Label>
                <Input value={form.username} disabled={!!editId} onChange={(e) => setForm({ ...form, username: e.target.value })} data-testid="admin-f-username" />
              </div>
              <div><Label>Nama</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="admin-f-name" /></div>
              <div>
                <Label>Password {editId && <span className="text-xs text-slate-400">(kosongkan bila tetap)</span>}</Label>
                <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="admin-f-password" />
              </div>
              <div>
                <Label>Role</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger data-testid="admin-f-role"><SelectValue /></SelectTrigger>
                  <SelectContent>{ROLES.map((r) => <SelectItem key={r.v} value={r.v}>{r.l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            {editId && (
              <div className="flex items-center gap-3">
                <Switch checked={active} onCheckedChange={setActive} data-testid="admin-f-active" />
                <Label className="!mb-0">Akun Aktif</Label>
              </div>
            )}
            <div>
              <Label className="mb-2 block">Hak Akses Portal HRD (per menu / aksi)</Label>
              <HrdAccessMatrix defs={defs} access={form.access} onChange={(a) => setForm({ ...form, access: a })} />
              <p className="text-xs text-slate-500 mt-2">Menu bertanda <LockKey size={11} weight="fill" className="inline text-emerald-600" /> adalah <b>Area Gaji</b> — terkunci PIN Gaji. Beri akses hanya pada user yang berhak (mis. Bu Lia/Herliana).</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg(false)}>Batal</Button>
            <Button className="bg-teal-600 hover:bg-teal-700" onClick={save} disabled={busy} data-testid="admin-save-user">{busy ? "Menyimpan…" : "Simpan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!delUser} onOpenChange={(o) => !o && setDelUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Hapus user {delUser?.username}?</AlertDialogTitle>
            <AlertDialogDescription>Akun akan dinonaktifkan dan dipindahkan ke arsip. Tindakan ini bisa dikembalikan oleh admin sistem.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={doDelete} data-testid="admin-del-confirm">Hapus</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
