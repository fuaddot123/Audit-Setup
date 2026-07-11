// ============================================================
// KONFIGURASI MODUL AUDIT STOK
// ============================================================

// ── Helper periode (sama pola dengan sopConfig.js) ──
export function nowPeriode() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
}
export function periodeLabel(p) {
  if (!p) return "\u2014";
  const [y, m] = p.split("-");
  return new Date(+y, +m - 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
}
export function periodFromDate(dateStr) {
  if (!dateStr) return nowPeriode();
  return dateStr.slice(0, 7);
}
export function todayInputValue() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

// ============================================================
// SERVICE RATIO
// ============================================================

// Ambang batas % Ratio Service (disimpan sebagai pecahan, mis. 0.22% = 0.0022)
export const SERVICE_THRESHOLDS = { terkendali: 0.0022, monitoring: 0.0033 };

export function calcServiceRatio(stokService, totalUnitCabang) {
  const total = Number(totalUnitCabang) || 0;
  if (total <= 0) return 0;
  return (Number(stokService) || 0) / total;
}

export function serviceStatusInfo(ratio) {
  if (ratio <= SERVICE_THRESHOLDS.terkendali) return { lbl: "Terkendali", color: "#1a9e6e" };
  if (ratio <= SERVICE_THRESHOLDS.monitoring) return { lbl: "Monitoring", color: "#b07212" };
  return { lbl: "Perlu Perhatian", color: "#a32020" };
}

export function formatRatioPct(ratio) {
  return (ratio * 100).toFixed(2) + "%";
}

// ============================================================
// KESEHATAN STOK
// ============================================================

export function skorRugi(untungRugi) {
  const n = Number(untungRugi) || 0;
  if (n >= 0) return 0;
  const rugi = Math.abs(n);
  if (rugi <= 50000) return 1;
  if (rugi <= 150000) return 2;
  if (rugi <= 300000) return 3;
  return 4;
}

export function calcSkorTemuan(temuanCount, bonusCount) {
  return (Number(temuanCount) || 0) + (Number(bonusCount) || 0);
}

export function calcSkorTotal(skorTemuan, skorRugiVal) {
  return skorTemuan + skorRugiVal * 5;
}

// Skor tertinggi = baseline tetap 100 (sesuai perhitungan aslinya)
export function calcKesehatanPct(skorTotal) {
  return Math.max(0, 1 - skorTotal / 100);
}

export function kesehatanStatusInfo(pct) {
  if (pct >= 0.85) return { lbl: "Terkendali", color: "#1a9e6e", desc: "Pengelolaan barang sangat baik, temuan minimal" };
  if (pct >= 0.70) return { lbl: "Waspada", color: "#2f9e9e", desc: "Ada temuan ringan, masih dalam batas toleransi" };
  if (pct >= 0.50) return { lbl: "Monitoring", color: "#b07212", desc: "Temuan mulai signifikan, perlu monitoring" };
  return { lbl: "Perlu Perhatian", color: "#a32020", desc: "Risiko tinggi, wajib tindak lanjut" };
}

export function formatKesehatanPct(pct) {
  return (pct * 100).toFixed(1) + "%";
}
