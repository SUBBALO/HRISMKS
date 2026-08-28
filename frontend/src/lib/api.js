import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const api = axios.create({
  baseURL: API,
  withCredentials: true,
});

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    if (err.response?.status === 401 && !err.config._retry && !err.config.url?.includes("/auth/")) {
      err.config._retry = true;
      try {
        await api.post("/auth/refresh");
        return api(err.config);
      } catch (e) {
        console.debug("Session refresh failed; propagating original 401", e);
      }
    }
    return Promise.reject(err);
  }
);

export function formatApiErrorDetail(detail) {
  if (detail == null) return "Terjadi kesalahan. Silakan coba lagi.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).filter(Boolean).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export const formatRupiah = (n) => {
  if (n == null || isNaN(n)) return "Rp 0";
  return "Rp " + Number(n).toLocaleString("id-ID", { maximumFractionDigits: 0 });
};

export const formatDateID = (iso) => {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
};

/** Format ISO timestamp as "DD-MM-YYYY HH:MM WIB" in Asia/Jakarta (UTC+7). */
export const formatDateTimeWIB = (iso) => {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const date = d.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Jakarta" });
  const time = d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jakarta" });
  return `${date} ${time} WIB`;
};

/** Trigger Excel download from a backend endpoint that returns application/vnd...spreadsheetml.sheet.
 *  Uses fetch with credentials to include the auth cookie. */
export async function downloadXlsx(path, params = {}, filename = "export.xlsx") {
  const url = new URL(`${API}${path}`);
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v); });
  const res = await fetch(url.toString(), { credentials: "include" });
  if (!res.ok) {
    let msg = "Gagal export";
    try { const j = await res.json(); msg = j.detail || msg; } catch {}
    throw new Error(msg);
  }
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

export default api;

/** Generic authenticated file download (xlsx/pdf/etc) via fetch + cookie credentials. */
export async function downloadFile(path, params = {}, filename = "export.bin") {
  const url = new URL(`${API}${path}`);
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v); });
  const res = await fetch(url.toString(), { credentials: "include" });
  if (!res.ok) {
    let msg = "Gagal export";
    try { const j = await res.json(); msg = j.detail || msg; } catch {}
    throw new Error(msg);
  }
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}
