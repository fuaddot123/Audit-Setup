// ============================================================
// KONFIGURASI MODUL AUDIT SOP
// Dipindahkan dari aplikasi HTML mandiri milik teman, disesuaikan
// untuk dipakai bareng di komponen React (Cabang, Dashboard, Ranking, Laporan).
// ============================================================

export const CATS = [
  { id: "display", label: "Display Laptop", color: "#481969", items: [
    "Tidak ada display laptop yang kosong = Hanya ada tatakan laptop",
    "Jumlah unit laptop yang di display sesuai SOP",
    "Semua unit display yang dijual berpricetag",
    "1 Barang = 1 Pricetag",
    "Tidak ada barang pribadi di area display maupun lemari display",
    "Tidak ada debu di layar, keyboard, body, bawah unit (fan)",
    "Kabel rapi, tidak terlihat berantakan",
    "Semua unit display dalam kondisi ON kecuali unit yang di bubble wrap",
    "Desktop / Monitor / TV menampilkan konten standar (promo / branding / video)",
    "Area bawah meja bersih tidak ada sarang laba-laba",
    "Tidak ada sarang laba-laba di area meja, wall display dan langit-langit",
    "Backdrop display menyala normal / tidak rusak / lusuh / robek / mati",
    "Tidak ada unit rusak di display",
    "Unit laptop berwarna putih di display dengan wrapping putih",
    "Karet bawah laptop diberi solasi kertas",
    "Tidak ada hewan / serangga di area display",
    "Semua lampu ruangan berfungsi normal",
    "Suhu ruangan 24 derajat",
    "Ruangan harum / tidak berbau tidak sedap",
    "Tidak makan / minum di area display",
    "Tidak makeup / berias di area display",
  ]},
  { id: "aksesori", label: "Display Aksesoris", color: "#ffc50b", items: [
    "Tidak ada gantungan aksesoris yang kosong",
    "Semua unit aksesoris berpricetag",
    "Tidak ada produk berdebu",
    "Tidak ada kemasan produk yang rusak/lusuh/robek",
    "Tidak ada tinta/toner/catridge yang expired",
  ]},
  { id: "gudang", label: "Gudang", color: "#b07212", items: [
    "Box tersusun rapi dan tidak berantakan/berserakan di lantai",
    "Tidak ada box rusak / lembab",
    "Tidak ada hama (tikus, kecoa, semut)",
    "Tidak ada barang tanpa identitas",
    "Lantai bersih tidak berminyak, kotor, berdebu",
    "Rak bersih, tidak ada sarang laba-laba",
    "Tidak makan dan minum di area kerja",
    "Ada tempat sampah kering",
    "Tidak ada mismatch barang vs sistem",
    "Penerimaan barang maksimal 1x24 jam",
    "Tidak ada barang keluar tanpa sistem",
    "Pengiriman surat jalan rutin setiap hari senin",
    "Kardus bekas disusun rapi di tempat terpisah",
  ]},
  { id: "kasir", label: "Kasir", color: "#1558a0", items: [
    "Meja kasir bersih",
    "Tidak ada nota / Dokumen berserakan",
    "Uang kas kecil sesuai",
    "Ada tempat sampah kering",
    "Semua transaksi ada nota resmi thermal",
    "Nota tidak boleh diedit tanpa izin HO",
    "Tidak ada transaksi manual di luar sistem tanpa sepengetahuan tim HO",
  ]},
  { id: "toilet", label: "Toilet", color: "#1a7fa0", items: [
    "Ada tempat sampah",
    "Lantai bersih tidak berkerak / bernoda parah",
    "Air mengalir lancar",
    "Tidak berbau",
    "Closet tidak berkerak dan berfungsi",
    "Tidak ada pakaian menggantung",
    "Tidak ada perlengkapan makan tersisa di lantai",
    "Saluran air lancar",
  ]},
  { id: "attitude", label: "SOP Pelayanan / Attitude", color: "#9e1d5e", items: [
    "Tidak merokok di area depan toko",
    "Membukakan pintu untuk customer",
    "Menyambut customer \u2264 5 detik",
    "Tidak cuek saat customer masuk",
    "Posisi berdiri standby",
    "Tidak duduk/bersandar ketika ada customer di sekitar",
    "Tidak main game/nonton film/bersantai di area display",
    "Tidak membicarakan customer di area operasional",
  ]},
  { id: "service", label: "Service & Teknisi", color: "#1a9e6e", items: [
    "Semua unit service tercatat di sistem",
    "Tidak ada unit mengendap tanpa update",
    "Tidak ada unit tanpa identitas di meja teknisi",
    "Tools tidak tercecer",
    "Tidak makan/minum di area kerja",
    "Ada tempat sampah kering",
  ]},
  { id: "grooming", label: "Grooming", color: "#6b2a96", items: [
    "Wanita berhijab wajib pakai jilbab hitam, inner hitam, celana gelap",
    "Pria tidak boleh berjambang, berkumis tebal, rambut gondrong",
    "Seluruh tim menggunakan seragam KLA, celana warna gelap",
    "Tidak berbau tidak sedap (rokok, bau badan dsb)",
    "Tidak memakai sandal di area operasional",
  ]},
  { id: "depantoko", label: "Area Depan Toko", color: "#c0392b", items: [
    "Tidak ada alat kebersihan di area depan toko",
    "Tidak ada helm/payung/perlengkapan pribadi apapun di area depan toko (sela rolling door)",
    "Halaman toko bersih tidak ada sampah berserakan (puntung rokok, daun) dan rumput liar",
    "Tidak ada sampah, tapak kaki dan kotoran yang menempel di lantai",
  ]},
  { id: "nonoperasional", label: "Area Non Operasional", color: "#5d6d7e", items: [
    "Tidak ada lantai yang berkerak/noda hitam/lumutan/pecah/rusak",
    "Tidak ada barang pribadi di setiap anak tangga (botol minum, makanan, snack, dsb)",
    "Tidak ada kotoran, debu dan sampah di bawah tangga (jika dipakai menyimpan kardus/materi promosi maka harus tersusun rapi)",
    "Kunci toko dibawa oleh tim internal store",
  ]},
];

export const TOTAL_ITEMS = CATS.reduce((s, c) => s + c.items.length, 0);

// Tier 1 (60%): Customer Experience Excellence
// Tier 2 (25%): Operational Foundation
// Tier 3 (15%): Compliance & Critical
export const TIER_WEIGHTS = {
  display: 0.22,
  gudang: 0.14,
  kasir: 0.12,
  attitude: 0.14,
  aksesori: 0.08,
  service: 0.08,
  toilet: 0.07,
  grooming: 0.06,
  depantoko: 0.06,
  nonoperasional: 0.03,
};

export const TIER1_CATS = ["display", "aksesori", "attitude", "grooming"];
export const TIER2_CATS = ["toilet", "gudang", "depantoko"];
export const TIER3_CATS = ["kasir", "service", "nonoperasional"];

export const ALERT_THRESHOLD = 80;

// ── Item kritis: kalau salah satu item ini gagal di kategorinya, skor
// kategori itu di-cap maksimal CRITICAL_CAP (walau item lain semua lolos).
// Index sesuai urutan item di array CATS masing-masing kategori.
export const CRITICAL_CAP = 0.70;
export const CRITICAL_ITEMS = {
  display: [2, 3, 5, 12],       // pricetag x2, debu produk, unit rusak
  aksesori: [1, 4],             // pricetag, barang expired
  gudang: [2, 3, 8, 10],        // hama, barang tanpa identitas, mismatch stok, barang keluar tanpa sistem
  kasir: [2, 4, 5, 6],          // kas kecil, nota resmi, nota diedit, transaksi manual
  attitude: [0, 3, 6, 7],       // merokok, cuek ke customer, bersantai, gosipin customer
  service: [0, 2],              // unit tercatat sistem, unit tanpa identitas
  nonoperasional: [0, 3],       // lantai rusak (safety), kunci toko
  // toilet, grooming, depantoko: tidak ada item kritis
};

function categoryHasCriticalFail(catId, checks) {
  const idxList = CRITICAL_ITEMS[catId];
  if (!idxList || !checks) return false;
  return idxList.some((i) => !checks[catId + "_" + i]);
}

// Bobot skor Ranking Cabang (Sales, SOP, Customer Experience, Housekeeping Index)
export const RANKING_BOBOT = { sales: 40, sop: 30, cx: 20, hi: 10 };

// Total skor Ranking Cabang: gabungan Sales Achievement, SOP, CX, Happiness Index
export function calcRank(sop, achievementPct, cx, hi) {
  return (
    Math.min(achievementPct || 0, 150) * (RANKING_BOBOT.sales / 100) +
    (sop || 0) * (RANKING_BOBOT.sop / 100) +
    (cx || 0) * (RANKING_BOBOT.cx / 100) +
    (hi || 0) * (RANKING_BOBOT.hi / 100)
  );
}

export function formatRupiah(v) {
  if (!v) return "\u2014";
  if (v >= 1_000_000_000) return "Rp " + (v / 1_000_000_000).toFixed(2).replace(/\.?0+$/, "") + "M";
  if (v >= 1_000_000) return "Rp " + (v / 1_000_000).toFixed(1).replace(/\.?0+$/, "") + "jt";
  return "Rp " + v.toLocaleString("id-ID");
}
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
  return dateStr.slice(0, 7); // 'YYYY-MM-DD' -> 'YYYY-MM'
}

export function addMonthsToPeriod(period, delta) {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function todayInputValue() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}
// checklistState: { [catId+'_'+itemIndex]: true/false }
export function calcWeightedScore(checklistState) {
  let total = 0;
  CATS.forEach((c) => {
    const w = TIER_WEIGHTS[c.id] || 0;
    if (w === 0) return;
    const done = c.items.filter((_, i) => checklistState[c.id + "_" + i]).length;
    let pct = c.items.length > 0 ? done / c.items.length : 0;
    if (categoryHasCriticalFail(c.id, checklistState)) pct = Math.min(pct, CRITICAL_CAP);
    total += pct * w * 100;
  });
  return Math.round(total);
}

// ── Helper skor: hitung skor tertimbang dari record tersimpan (record.cats = {catId: {score, total}}) ──
export function calcWeightedFromRecord(record) {
  if (!record || !record.cats) return record ? record.score || 0 : 0;
  let total = 0;
  CATS.forEach((c) => {
    const w = TIER_WEIGHTS[c.id] || 0;
    if (w === 0) return;
    const bd = record.cats[c.id];
    if (!bd || !bd.total) return;
    let pct = bd.score / bd.total;
    if (categoryHasCriticalFail(c.id, record.checks)) pct = Math.min(pct, CRITICAL_CAP);
    total += pct * w * 100;
  });
  return Math.round(total);
}

// ── Skor per tier dari record tersimpan ──
export function calcTierScores(record) {
  if (!record || !record.cats) return null;
  const tierScore = (catIds) => {
    let num = 0, den = 0;
    catIds.forEach((id) => {
      const bd = record.cats[id];
      if (!bd) return;
      num += bd.score; den += bd.total;
    });
    return den > 0 ? Math.round((num / den) * 100) : null;
  };
  return {
    tier1: tierScore(TIER1_CATS),
    tier2: tierScore(TIER2_CATS),
    tier3: tierScore(TIER3_CATS),
  };
}

export function scoreInfo(pct) {
  if (pct >= 90) return { lbl: "Sempurna", color: "#1a9e6e" };
  if (pct >= 80) return { lbl: "Baik", color: "#b07212" };
  return { lbl: "Perlu Perbaikan", color: "#a32020" };
}

export function scoreColor(score) {
  if (score === null || score === undefined) return "var(--text-faint)";
  if (score < ALERT_THRESHOLD) return "var(--danger-text)";
  if (score < 90) return "#d4a100";
  return "#1a9e6e";
}
