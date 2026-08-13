import React, { useCallback, useEffect, useState } from "react";
import api, { formatDateTimeWIB, formatApiErrorDetail } from "../lib/api";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { ArrowCounterClockwise, Trash, DownloadSimple } from "@phosphor-icons/react";

const errMsg = (e) => formatApiErrorDetail(e?.response?.data?.detail) || e?.message || "Terjadi kesalahan";

export function BackupButton() {
  const [busy, setBusy] = useState(false);
  const doBackup = async () => {
    setBusy(true);
    try {
      const r = await api.get("/admin/backup", { responseType: "blob", timeout: 120000 });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(r.data);
      a.download = `backup_hris_mks_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click(); URL.revokeObjectURL(a.href);
      toast.success("Backup terunduh — simpan file di tempat aman");
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Button variant="outline" size="sm" className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
      onClick={doBackup} disabled={busy} data-testid="admin-backup-btn">
      <DownloadSimple size={15} weight="bold" /> {busy ? "Membuat backup…" : "Backup Database"}
    </Button>
  );
}

export function RecycleBin() {
  const [items, setItems] = useState([]);
  const [purgeDays, setPurgeDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/admin/recycle-bin")
      .then((r) => { setItems(r.data.items || []); setPurgeDays(r.data.purge_days || 30); })
      .catch((e) => toast.error(errMsg(e))).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const restore = async (it) => {
    try {
      await api.post("/admin/recycle-bin/restore", { collection: it.collection, id: it.id });
      toast.success(`"${it.name}" dikembalikan ke ${it.module}`); load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div className="mt-6" data-testid="admin-recyclebin">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-8 h-8 flex items-center justify-center bg-rose-50 text-rose-600 rounded-md"><Trash size={17} weight="duotone" /></span>
        <div>
          <div className="font-bold text-slate-800 text-sm">Recycle Bin</div>
          <div className="text-[11px] text-slate-400">Data yang dihapus tersimpan di sini dan otomatis terhapus permanen setelah {purgeDays} hari.</div>
        </div>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2.5 font-semibold">Modul</th>
              <th className="text-left px-4 py-2.5 font-semibold">Data</th>
              <th className="text-left px-4 py-2.5 font-semibold">Dihapus</th>
              <th className="text-center px-4 py-2.5 font-semibold">Sisa Waktu</th>
              <th className="text-right px-4 py-2.5 font-semibold">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? <tr><td colSpan={5} className="text-center py-8 text-slate-400">Memuat…</td></tr>
              : items.length === 0 ? <tr><td colSpan={5} className="text-center py-8 text-slate-400">Recycle bin kosong.</td></tr>
                : items.map((it) => (
                  <tr key={`${it.collection}-${it.id}`} className="hover:bg-slate-50" data-testid={`bin-row-${it.id}`}>
                    <td className="px-4 py-2.5"><Badge variant="secondary" className="text-[10px]">{it.module}</Badge></td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-800">{it.name}</div>
                      {it.detail && <div className="text-[10px] text-slate-400">{it.detail}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{formatDateTimeWIB(it.deleted_at)}{it.deleted_by ? ` • ${it.deleted_by}` : ""}</td>
                    <td className="px-4 py-2.5 text-center">
                      <Badge className={`text-[10px] ${it.days_left <= 7 ? "bg-rose-100 text-rose-700 hover:bg-rose-100" : "bg-slate-100 text-slate-600 hover:bg-slate-100"}`}>{it.days_left} hari</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button size="sm" variant="outline" className="gap-1.5 text-emerald-700 border-emerald-300 hover:bg-emerald-50 h-8"
                        onClick={() => restore(it)} data-testid={`bin-restore-${it.id}`}>
                        <ArrowCounterClockwise size={14} weight="bold" /> Restore
                      </Button>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
