// ============================================================
// Urutan cabang custom (bukan alfabetis) — dipakai di semua modul
// yang punya kartu pilih-cabang, biar konsisten di seluruh app.
// Cabang yang nggak ada di daftar ini (misal cabang baru yang belum
// ditambahin ke sini) otomatis ditaruh di akhir, urut alfabetis.
// ============================================================

export const BRANCH_ORDER = [
  "Semarang",
  "Yogyakarta",
  "Slawi",
  "Tegal",
  "Pekalongan",
  "Cirebon",
  "Kediri",
  "Ngaliyan",
  "Sukoharjo",
  "Surabaya MERR",
  "Mojokerto",
  "Surabaya Babatan",
  "Purwokerto",
  "Solo",
  "Tasikmalaya",
];

export function sortBranches(branches) {
  return [...(branches || [])].sort((a, b) => {
    const ia = BRANCH_ORDER.indexOf(a.name);
    const ib = BRANCH_ORDER.indexOf(b.name);
    if (ia === -1 && ib === -1) return a.name.localeCompare(b.name);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}
