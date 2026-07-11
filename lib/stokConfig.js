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
