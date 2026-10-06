// ============================================================
// KONFIGURASI MODUL KPI AUDIT INTERNAL (company-wide, per bulan)
// ============================================================

export function nowPeriode() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
}
export function periodeLabel(p) {
  if (!p) return "\u2014";
  const [y, m] = p.split("-");
  return new Date(+y, +m - 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
}
export function addMonthsToPeriod(period, delta) {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// key harus sama dengan nama kolom realisasi_<key> di tabel audit_kpi
//
// DUA TEMPLATE KPI:
//  - LEGACY (5 indikator): periode SEBELUM 2026-09 — dipertahankan apa adanya
//    supaya riwayat Jan-Agu 2026 tetap terbaca benar.
//  - V2 (2 indikator): periode 2026-09 ke atas. Memakai ulang kolom lama
//    `temuan_audit` (= Temuan Pelanggaran SOP) dan `coverage` (= Jumlah Cabang
//    di Audit), jadi TIDAK perlu kolom baru di database.
// Koefisien (realisasi ÷ target) sengaja TIDAK dibatasi 100%: target
// terlampaui → hasil final juga melebihi 100%.
export const KPI_V2_START = "2026-09";

export function isKpiV2(period) {
  return !!period && period >= KPI_V2_START;
}

export const KPI_ITEMS_V2 = [
  { key: "temuan_audit", label: "Temuan Pelanggaran SOP", short: "Temuan Pelanggaran SOP", bobot: 0.7, target: 40, type: "standard", unit: "temuan", hint: "Total temuan pelanggaran SOP bulan ini" },
  { key: "coverage", label: "Jumlah Cabang di Audit", short: "Jumlah Cabang di Audit", bobot: 0.3, target: 8, type: "standard", unit: "cabang", hint: "Jumlah cabang yang diaudit bulan ini" },
];

// Template LEGACY (5 indikator). Tetap diekspor dengan nama lama KPI_ITEMS
// supaya file lain yang masih meng-import KPI_ITEMS tidak error.
export const KPI_ITEMS = [
  { key: "coverage", short: "Coverage", label: "Coverage Audit (Cakupan Cabang Diaudit)", bobot: 0.25, target: 8, type: "standard", unit: "cabang", hint: "Jumlah cabang yang diaudit bulan ini" },
  { key: "kepatuhan_sop", short: "Kepatuhan SOP", label: "Kepatuhan SOP", bobot: 0.25, target: 0.9, type: "standard", unit: "persen", targetIsPercent: true, hint: "Rata-rata skor SOP semua cabang, isi dalam persen (mis. ketik 93 untuk 93%)" },
  { key: "temuan_berulang", short: "Temuan Berulang", label: "Temuan Berulang", bobot: 0.2, target: 0.2, type: "crossref", unit: "kejadian", targetIsPercent: true, hint: "Jumlah temuan yang berulang dari bulan sebelumnya" },
  { key: "temuan_audit", short: "Jumlah Temuan Audit", label: "Jumlah Temuan Audit", bobot: 0.2, target: 40, type: "standard", unit: "temuan", hint: "Total semua temuan audit bulan ini" },
  { key: "ketepatan_laporan", short: "Ketepatan Laporan", label: "Ketepatan Laporan Audit", bobot: 0.1, target: 8, type: "standard", unit: "laporan", hint: "Jumlah laporan audit yang selesai tepat waktu" },
];

// Daftar indikator yang berlaku untuk suatu periode.
export function kpiItemsFor(period) {
  return isKpiV2(period) ? KPI_ITEMS_V2 : KPI_ITEMS;
}

// realisasiMap: { coverage, kepatuhan_sop, temuan_berulang, temuan_audit, ketepatan_laporan }
// period: "YYYY-MM". Tanpa period → template LEGACY (perilaku lama, aman untuk pemanggil lama).
export function calcKPI(realisasiMap, period) {
  const temuanAudit = Number(realisasiMap.temuan_audit) || 0;
  const results = {};
  kpiItemsFor(period).forEach((item) => {
    const real = Number(realisasiMap[item.key]) || 0;
    let pctReal, hasil;
    if (item.type === "crossref") {
      pctReal = temuanAudit > 0 ? real / temuanAudit : 0;
      hasil = pctReal > 0 ? item.bobot * (item.target / pctReal) : item.bobot;
    } else {
      pctReal = item.target > 0 ? real / item.target : 0;
      hasil = item.bobot * pctReal;
    }
    results[item.key] = { real, pctReal, hasil };
  });
  const total = Object.values(results).reduce((s, r) => s + r.hasil, 0);
  return { results, total };
}

export function totalKpiInfo(total) {
  if (total >= 1) return { lbl: "Tercapai", color: "#1a9e6e" };
  if (total >= 0.8) return { lbl: "Mendekati Target", color: "#b07212" };
  return { lbl: "Di Bawah Target", color: "#a32020" };
}

export function fmtPct(v) {
  return (v * 100).toFixed(1) + "%";
}
