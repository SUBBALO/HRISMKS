import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { UsersThree, Lock, User } from "@phosphor-icons/react";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    if (!username || !password) return;
    setBusy(true);
    const r = await login(username.trim(), password);
    setBusy(false);
    if (r.ok) { toast.success("Selamat datang"); navigate("/"); }
    else toast.error(r.error || "Login gagal");
  };

  return (
    <div className="min-h-screen w-full flex bg-slate-900 text-slate-100">
      {/* Left brand panel with MKS building */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 p-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-center bg-cover" style={{ backgroundImage: "url('/mks-building.webp')" }} />
        <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(15,118,110,0.92) 0%, rgba(19,78,74,0.9) 55%, rgba(15,23,42,0.95) 100%)" }} />
        <div className="relative flex items-center gap-3">
          <span className="w-12 h-12 flex items-center justify-center bg-white rounded-lg p-1 shadow-sm">
            <img src="/logo-mks.png" alt="MKS" className="w-full h-full object-contain" />
          </span>
          <div>
            <div className="font-bold tracking-tight text-lg" style={{ fontFamily: "Chivo, sans-serif" }}>MKS HRIS</div>
            <div className="text-xs text-teal-100/90">PT Mitra Karya Sarana</div>
          </div>
        </div>
        <div className="relative space-y-4 max-w-md">
          <h1 className="text-4xl font-extrabold leading-tight drop-shadow" style={{ fontFamily: "Chivo, sans-serif" }}>
            Human Resources<br />Information System
          </h1>
          <p className="text-teal-50/90 text-sm leading-relaxed">
            A centralized system for managing employee information and HR administration.
          </p>
        </div>
        <p className="relative text-[8px] tracking-wide text-teal-100/60">Developed by Susanto | Purchasing</p>
      </div>

      {/* Right form */}
      <div className="flex-1 flex items-center justify-center p-6 bg-slate-50 text-slate-900">
        <form onSubmit={submit} className="w-full max-w-sm space-y-6" data-testid="login-form">
          <div className="lg:hidden flex items-center gap-3 mb-2">
            <span className="w-10 h-10 flex items-center justify-center bg-white border border-slate-200 rounded-lg p-0.5"><img src="/logo-mks.png" alt="MKS" className="w-full h-full object-contain" /></span>
            <div><div className="font-bold" style={{ fontFamily: "Chivo, sans-serif" }}>MKS HRIS</div></div>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900" style={{ fontFamily: "Chivo, sans-serif" }}>Masuk</h2>
            <p className="text-sm text-slate-500 mt-1">Gunakan akun yang diberikan admin.</p>
          </div>
          <div className="space-y-4">
            <div>
              <Label htmlFor="u">Username</Label>
              <div className="relative">
                <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input id="u" value={username} autoFocus onChange={(e) => setUsername(e.target.value)}
                  placeholder="herliana / heri" className="pl-9" data-testid="login-username" />
              </div>
            </div>
            <div>
              <Label htmlFor="p">Password</Label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input id="p" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••" className="pl-9" data-testid="login-password" />
              </div>
            </div>
          </div>
          <Button type="submit" className="w-full bg-teal-600 hover:bg-teal-700 h-11 text-base" disabled={busy} data-testid="login-submit">
            {busy ? "Memproses…" : "Masuk"}
          </Button>
        </form>
      </div>
    </div>
  );
}
