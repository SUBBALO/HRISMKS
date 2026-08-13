import React, { useEffect, useState } from "react";
import api, { formatApiErrorDetail } from "../lib/api";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Password, LockKey, CaretDown } from "@phosphor-icons/react";
import { ChangeGajiPinDialog } from "../pages/HrdPortalPage";

const errMsg = (e) => formatApiErrorDetail(e?.response?.data?.detail) || e?.message || "Terjadi kesalahan";

function ChangePasswordDialog({ open, onClose }) {
  const [oldPw, setOldPw] = useState("");
  const [np, setNp] = useState("");
  const [cp, setCp] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setOldPw(""); setNp(""); setCp(""); } }, [open]);
  const save = async () => {
    if (np.length < 6) return toast.error("Password baru minimal 6 karakter");
    if (np !== cp) return toast.error("Konfirmasi password tidak cocok");
    setBusy(true);
    try {
      await api.post("/auth/change-password", { current_password: oldPw, new_password: np });
      toast.success("Password berhasil diganti");
      onClose();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm" data-testid="changepw-dialog">
        <DialogHeader><DialogTitle>Ubah Password</DialogTitle></DialogHeader>
        <div><Label>Password Lama</Label><Input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} data-testid="changepw-old" /></div>
        <div><Label>Password Baru</Label><Input type="password" value={np} onChange={(e) => setNp(e.target.value)} data-testid="changepw-new" /></div>
        <div><Label>Konfirmasi Password Baru</Label><Input type="password" value={cp} onChange={(e) => setCp(e.target.value)} data-testid="changepw-confirm" /></div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button className="bg-slate-800 hover:bg-slate-700" onClick={save} disabled={busy} data-testid="changepw-save">{busy ? "Menyimpan…" : "Simpan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AccountMenu({ user }) {
  const [pwOpen, setPwOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [canPin, setCanPin] = useState(false);

  useEffect(() => {
    api.get("/hrd/my-access")
      .then((r) => setCanPin(!!(r.data.can_manage_gaji_pin && r.data.gaji_pin_set)))
      .catch(() => setCanPin(false));
  }, []);

  const initial = (user.name || user.username || "?").charAt(0).toUpperCase();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-1 group" data-testid="account-menu-btn">
            <span className="w-9 h-9 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center font-bold text-sm group-hover:bg-slate-200 transition-colors">{initial}</span>
            <CaretDown size={12} className="text-slate-400 group-hover:text-slate-600" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel>
            <div className="text-sm font-semibold text-slate-800">{user.name || user.username}</div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wide font-normal">{user.role}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setPwOpen(true)} className="gap-2 cursor-pointer" data-testid="menu-ubah-password">
            <Password size={16} className="text-slate-500" /> Ubah Password
          </DropdownMenuItem>
          {canPin && (
            <DropdownMenuItem onClick={() => setPinOpen(true)} className="gap-2 cursor-pointer" data-testid="menu-ubah-pin">
              <LockKey size={16} className="text-emerald-600" /> Ubah PIN Gaji
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
      {canPin && (
        <ChangeGajiPinDialog open={pinOpen} onClose={() => setPinOpen(false)}
          onSave={async (oldPin, newPin) => {
            await api.post("/hrd/set-pin", { pin: newPin, current_pin: oldPin });
            setPinOpen(false);
            toast.success("PIN Gaji berhasil diubah");
          }} />
      )}
    </>
  );
}
