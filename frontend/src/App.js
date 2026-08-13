import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { Toaster } from "./components/ui/sonner";
import { Button } from "./components/ui/button";
import { UsersThree, SignOut, ShieldCheck } from "@phosphor-icons/react";
import LoginPage from "./pages/LoginPage";
import HrdPortalPage from "./pages/HrdPortalPage";
import AdminPage from "./pages/AdminPage";
import AccountMenu from "./components/AccountMenu";

function Header() {
  const { user, logout } = useAuth();
  const loc = useLocation();
  if (!user) return null;
  return (
    <header className="h-[60px] bg-white border-b border-slate-200 sticky top-0 z-40">
      <div className="max-w-[1400px] mx-auto h-full px-6 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="w-9 h-9 flex items-center justify-center bg-white border border-slate-200 rounded-md p-0.5"><img src="/logo-mks.png" alt="MKS" className="w-full h-full object-contain" /></span>
          <div className="leading-tight">
            <div className="font-bold text-slate-800 text-sm" style={{ fontFamily: "Chivo, sans-serif" }}>MKS HRIS</div>
            <div className="text-[10px] text-slate-400">PT Mitra Karya Sarana</div>
          </div>
        </Link>
        <div className="flex items-center gap-3">
          {user.is_super_admin && loc.pathname !== "/admin" && (
            <Link to="/admin"><Button variant="outline" size="sm" className="gap-1.5" data-testid="nav-admin"><ShieldCheck size={15} /> Admin</Button></Link>
          )}
          <div className="text-right hidden sm:block">
            <div className="text-sm font-semibold text-slate-700 leading-tight">{user.name || user.username}</div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wide">{user.role}</div>
          </div>
          <AccountMenu user={user} />
          <Button variant="ghost" size="icon" className="text-slate-500 hover:text-rose-600" onClick={logout} title="Keluar" data-testid="nav-logout"><SignOut size={18} /></Button>
        </div>
      </div>
    </header>
  );
}

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading || user === null) return <div className="min-h-screen flex items-center justify-center text-slate-400">Memuat…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function LoginGate() {
  const { user, loading } = useAuth();
  if (loading || user === null) return <div className="min-h-screen flex items-center justify-center text-slate-400">Memuat…</div>;
  if (user) return <Navigate to="/" replace />;
  return <LoginPage />;
}

function Shell({ children }) {
  return (<><Header />{children}</>);
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Toaster position="top-right" richColors />
          <Routes>
            <Route path="/login" element={<LoginGate />} />
            <Route path="/" element={<Protected><Shell><HrdPortalPage /></Shell></Protected>} />
            <Route path="/admin" element={<Protected><Shell><AdminPage /></Shell></Protected>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </div>
  );
}

export default App;
