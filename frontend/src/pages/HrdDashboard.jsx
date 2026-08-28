import React, { useEffect, useState } from "react";
import api, { formatDateID, formatApiErrorDetail } from "../lib/api";
import { toast } from "sonner";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import {
  UsersThree, IdentificationBadge, Timer, Files, Cake, WarningCircle, Megaphone, ChartBar,
} from "@phosphor-icons/react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";

const errMsg = (e) => formatApiErrorDetail(e?.response?.data?.detail) || e?.message || "Terjadi kesalahan";
const BULAN = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const PIE_COLORS = ["#059669", "#0284C7", "#D97706", "#7C3AED", "#E11D48", "#64748B"];

function StatCard({ icon: Icon, label, value, tint, bg, testid }) {
  return (
    <Card className="p-4 flex items-center gap-3" data-testid={testid}>
      <div className={`h-11 w-11 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
        <Icon size={22} weight="duotone" className={tint} />
      </div>
      <div>
        <div className="text-2xl font-bold text-slate-800 leading-none" style={{ fontFamily: "Chivo, sans-serif" }}>{value}</div>
        <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mt-1">{label}</div>
      </div>
    </Card>
  );
}

function Widget({ title, icon: Icon, tint, children, testid }) {
  return (
    <Card className="p-4" data-testid={testid}>
      <div className="flex items-center gap-2 mb-3">
        <Icon size={17} weight="duotone" className={tint} />
        <div className="text-sm font-bold text-slate-800">{title}</div>
      </div>
      {children}
    </Card>
  );
}

export default function DashboardSection() {
  const [d, setD] = useState(null);
  const [anns, setAnns] = useState([]);

  useEffect(() => {
    api.get("/hrd/dashboard").then((r) => setD(r.data)).catch((e) => toast.error(errMsg(e)));
    api.get("/hrd/announcements").then((r) => setAnns(r.data.items || [])).catch(() => {});
  }, []);

  if (!d) return <div className="text-slate-400 text-sm py-16 text-center">Memuat dashboard…</div>;

  const deptData = Object.entries(d.by_dept).map(([name, jumlah]) => ({ name, jumlah }));
  const statusData = Object.entries(d.by_status).map(([name, value]) => ({ name, value }));

  return (
    <div className="space-y-4" data-testid="hrd-dashboard">
      {/* Pengumuman */}
      {anns.length > 0 && (
        <div className="space-y-2" data-testid="dash-announcements">
          {anns.slice(0, 3).map((a) => (
            <div key={a.id} className={`rounded-md border px-4 py-3 flex items-start gap-2.5 ${a.penting ? "bg-amber-50 border-amber-300" : "bg-sky-50 border-sky-200"}`}>
              <Megaphone size={17} weight="fill" className={`shrink-0 mt-0.5 ${a.penting ? "text-amber-600" : "text-sky-600"}`} />
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-800">{a.judul} {a.penting && <Badge className="ml-1 bg-amber-500 hover:bg-amber-500 text-white text-[9px]">PENTING</Badge>}</div>
                {a.isi && <div className="text-xs text-slate-600 mt-0.5 whitespace-pre-line">{a.isi}</div>}
                <div className="text-[10px] text-slate-400 mt-1">{a.created_by} • {formatDateID(a.created_at)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Statistik */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={UsersThree} label="Total Karyawan" value={d.total_karyawan} tint="text-sky-600" bg="bg-sky-50" testid="dash-stat-total" />
        <StatCard icon={IdentificationBadge} label="Karyawan Tetap" value={d.by_status["Tetap"] || 0} tint="text-emerald-600" bg="bg-emerald-50" testid="dash-stat-tetap" />
        <StatCard icon={Timer} label="Kontrak" value={d.by_status["Kontrak"] || 0} tint="text-amber-600" bg="bg-amber-50" testid="dash-stat-kontrak" />
        <StatCard icon={Files} label="Surat Diterbitkan" value={d.letters_count} tint="text-rose-600" bg="bg-rose-50" testid="dash-stat-letters" />
      </div>

      {/* Grafik */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Widget title="Karyawan per Departemen" icon={ChartBar} tint="text-sky-600" testid="dash-chart-dept">
          {deptData.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={deptData} margin={{ top: 5, right: 10, left: -25, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip cursor={{ fill: "#F1F5F9" }} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="jumlah" fill="#0284C7" radius={[4, 4, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Widget>
        <Widget title="Komposisi Status Karyawan" icon={ChartBar} tint="text-emerald-600" testid="dash-chart-status">
          {statusData.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                  {statusData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Widget>
      </div>

      {/* Widgets */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Widget title="Kontrak Hampir Habis (≤90 hari)" icon={WarningCircle} tint="text-rose-600" testid="dash-contracts">
          {d.contracts_expiring.length === 0 ? <Empty text="Tidak ada kontrak yang hampir habis." /> : (
            <div className="space-y-2">
              {d.contracts_expiring.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 border border-slate-100 rounded-md px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-800 truncate">{c.nama}</div>
                    <div className="text-[10px] text-slate-400">{c.jabatan || "-"} • berakhir {formatDateID(c.berakhir)}</div>
                  </div>
                  <Badge className={`shrink-0 text-[10px] ${c.sisa_hari <= 30 ? "bg-rose-100 text-rose-700 hover:bg-rose-100" : "bg-amber-100 text-amber-700 hover:bg-amber-100"}`}>
                    {c.sisa_hari < 0 ? "Lewat" : `${c.sisa_hari} hari`}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Widget>
        <Widget title={`Ulang Tahun ${BULAN[d.bulan]}`} icon={Cake} tint="text-violet-600" testid="dash-birthdays">
          {d.birthdays.length === 0 ? <Empty text="Tidak ada yang berulang tahun bulan ini." /> : (
            <div className="space-y-2">
              {d.birthdays.map((b, i) => (
                <div key={i} className="flex items-center gap-2.5 border border-slate-100 rounded-md px-3 py-2">
                  <div className="h-8 w-8 rounded-full bg-violet-50 text-violet-700 flex items-center justify-center text-xs font-bold shrink-0">{b.tanggal}</div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-800 truncate">{b.nama}</div>
                    <div className="text-[10px] text-slate-400">{b.jabatan || "-"}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Widget>
        <Widget title="Kelengkapan Dokumen" icon={Files} tint="text-sky-600" testid="dash-docs">
          <div className="text-[11px] text-slate-400 mb-2">Wajib: {d.required_docs.join(", ")}</div>
          {d.doc_incomplete.length === 0 ? <Empty text="Semua karyawan lengkap dokumennya. 👍" /> : (
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {d.doc_incomplete.map((c) => (
                <div key={c.id} className="border border-slate-100 rounded-md px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-bold text-slate-800 truncate">{c.nama}</div>
                    <span className="text-[10px] font-bold text-slate-500">{c.pct}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full mt-1.5 overflow-hidden">
                    <div className={`h-full rounded-full ${c.pct >= 75 ? "bg-emerald-500" : c.pct >= 50 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${c.pct}%` }} />
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">Kurang: {c.missing.join(", ")}</div>
                </div>
              ))}
            </div>
          )}
        </Widget>
      </div>
    </div>
  );
}

function Empty({ text = "Belum ada data." }) {
  return <div className="text-xs text-slate-400 text-center py-6 border border-dashed border-slate-200 rounded-md">{text}</div>;
}
