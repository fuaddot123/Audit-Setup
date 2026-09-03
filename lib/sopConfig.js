// ============================================================
// KONFIGURASI MODUL AUDIT SOP
// Checklist versi baru (Sept 2026) — sumber: sheet "MASTER OPERASIONAL STORE".
// Sistem skoring diganti TOTAL: dulu tier-weighted (SOP dibobotin per kategori +
// cap kalau ada item kritis gagal), SEKARANG murni jumlah poin item yang lolos,
// tiap kategori punya total poin sendiri, 10 kategori dijumlah pas 100.
// Data audit LAMA (checklist 81-item, sistem tier) dianggap tidak relevan lagi
// per keputusan user — TIDAK ada migrasi/kompatibilitas mundur, mulai bersih dari 0.
// ============================================================

export const CATS = [
  {
    id: "display_laptop", label: "Display Laptop", color: "#481969",
    items: [
      "Tidak ada display laptop kosong / hanya tatakan",
      "Jumlah unit display sesuai SOP (6-8 unit tergantung island)",
      "Semua unit display yang dijual memiliki 1 pricetag sesuai sistem",
      "Tidak ada barang pribadi di area display",
      "Tidak ada debu pada layar, keyboard, body, fan",
      "Kabel rapi dan tidak berantakan",
      "Semua unit display ON sesuai ketentuan",
      "Monitor/TV menampilkan konten standard promosi",
      "Area bawah meja bersih dari sarang laba dan kotoran",
      "Tidak ada sarang laba-laba di area display",
      "Tidak ada unit rusak di display",
      "Laptop putih menggunakan wrapping putih",
      "Karet bawah laptop menggunakan solasi kertas",
      "Tidak ada hewan/serangga di area display",
      "Ruangan harum / tidak bau",
      "Tidak makan/minum di area display",
      "Tidak makeup/berias di area display",
    ],
    // Poin A2 dikoreksi dari 1,5 jadi 1 (dikonfirmasi user) biar total kategori pas 19,5.
    points: [2, 1, 1.5, 0.5, 2, 0.5, 1, 1, 1, 2, 1, 0.5, 0.5, 2, 1, 1, 1],
  },
  {
    id: "display_aksesoris", label: "Display Aksesoris", color: "#ffc50b",
    items: [
      "Tidak ada gantungan aksesoris yang kosong",
      "Semua unit aksesoris berpricetag",
      "Tidak ada produk berdebu",
      "Tidak ada kemasan produk yang rusak/lusuh/robek",
      "Tidak ada tinta/toner/catridge yang expired",
    ],
    points: [2, 3, 2, 1, 2],
  },
  {
    id: "gudang", label: "Gudang", color: "#b07212",
    items: [
      "Box tersusun rapi",
      "Tidak ada box rusak/lembab akibat handling/penyimpanan",
      "Tidak ada hama/serangga akibat housekeeping",
      "Tidak ada barang tanpa identitas",
      "Lantai bersih tidak bernoda",
      "Rak bersih / tidak ada sarang laba-laba",
      "Tidak makan/minum di area kerja",
      "Ada tempat sampah kering",
      "Tidak ada mismatch barang vs sistem",
      "Penerimaan barang maksimal 1x24 jam",
      "Tidak ada barang keluar tanpa sistem",
      "Pengiriman surat jalan sesuai ketentuan",
      "Kardus bekas tersusun di tempat terpisah",
    ],
    // Poin C10 dikoreksi dari 2 jadi 1 (dikonfirmasi user) biar total kategori pas 18.
    points: [0.5, 1, 3, 1, 0.5, 1, 0.5, 0.5, 4, 1, 4, 0.5, 0.5],
  },
  {
    id: "kasir", label: "Kasir", color: "#1558a0",
    items: [
      "Meja kasir bersih",
      "Tidak ada dokumen/nota berserakan/tidak terdistribusi dengan baik",
      "Uang kas kecil sesuai",
      "Ada tempat sampah kering",
      "Semua transaksi memiliki nota resmi",
      "Nota tidak diedit tanpa izin HO",
      "Tidak ada transaksi manual di luar sistem tanpa approval HO",
    ],
    points: [1, 0.5, 2, 0.5, 2, 1.5, 2],
  },
  {
    id: "toilet", label: "Toilet", color: "#1a7fa0",
    items: [
      "Ada tempat sampah",
      "Lantai bersih tidak bernoda parah dan tidak ada sampah berceceran di lantai/wastafel",
      "Tidak berbau tidak sedap",
      "Tidak ada pakaian menggantung",
      "Tidak ada perlengkapan makan tersisa",
      "Tidak merokok di dalam toilet",
    ],
    points: [0.5, 1, 1, 2, 0.5, 2],
  },
  {
    id: "pelayanan", label: "Pelayanan & Attitude", color: "#9e1d5e",
    items: [
      "Tidak merokok (termasuk vape) di area depan dan dalam toko",
      "Membukakan pintu customer",
      "Menyambut customer \u22645 detik",
      "Tidak cuek ketika customer masuk",
      "Posisi berdiri standby",
      "Tidak duduk/bersandar ketika ada customer",
      "Tidak main game/nonton film/bersantai di display",
      "Tidak membicarakan customer di area operasional",
    ],
    points: [2, 1, 3, 3, 1.5, 2, 2, 0.5],
  },
  {
    id: "service", label: "Service & Teknisi", color: "#1a9e6e",
    items: [
      "Semua unit service tercatat di sistem",
      "Tidak ada unit mengendap tanpa update",
      "Tidak ada unit service tanpa identitas",
      "Tools tidak tercecer",
      "Tidak makan/minum di area kerja",
      "Ada tempat sampah kering",
    ],
    points: [3, 1, 1, 0.5, 1, 0.5],
  },
  {
    id: "grooming", label: "Grooming", color: "#6b2a96",
    items: [
      "Grooming hijab sesuai standar",
      "Grooming pria sesuai standar",
      "Seragam KLA & celana gelap & pakai lanyard dan id card",
      "Tidak berbau tidak sedap",
      "Tidak memakai sandal",
    ],
    points: [0.5, 0.5, 2, 0.5, 1],
  },
  {
    id: "depan_toko", label: "Area Depan Toko", color: "#c0392b",
    items: [
      "Tidak ada alat kebersihan di area depan",
      "Tidak ada barang pribadi di area depan (helm)",
      "Halaman bersih",
      "Lantai depan bersih",
    ],
    points: [2, 1, 1, 1],
  },
  {
    id: "non_operasional", label: "Area Non Operasional", color: "#5d6d7e",
    items: [
      "Area lantai bersih dari kotoran/kerak/noda",
      "Tidak ada barang pribadi di tangga",
      "Area bawah tangga bersih/rapi",
      "Kunci toko sesuai ketentuan",
    ],
    points: [1, 2, 0.5, 1],
  },
];

export const TOTAL_ITEMS = CATS.reduce((s, c) => s + c.items.length, 0); // 75
export const TOTAL_POINTS = 100; // Tetap konstanta — 10 kategori sengaja didesain jumlah pas 100.

// ============================================================
// CHECKLIST LAMA (sebelum diganti Sept 2026) — DIPERTAHANKAN KHUSUS BUAT BACA ULANG data
// audit LAMA (Jan-Agustus 2026), BUKAN buat isian baru. Auditor SELALU isi pakai CATS (baru)
// di atas — CATS_LEGACY ini nggak pernah dipakai di form input, cuma dipakai internal di
// calcWeightedFromRecord()/getCatsForRecord() biar audit lama tetep kebaca skornya bener
// (bukan ke-skip/nol), termasuk foto & temuannya buat Laporan Bulanan & Laporan Tahunan nanti.
// ============================================================
const CATS_LEGACY = [
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
const TIER_WEIGHTS_LEGACY = {
  display: 0.22, gudang: 0.14, kasir: 0.12, attitude: 0.14, aksesori: 0.08,
  service: 0.08, toilet: 0.07, grooming: 0.06, depantoko: 0.06, nonoperasional: 0.03,
};
const CRITICAL_CAP_LEGACY = 0.70;
const CRITICAL_ITEMS_LEGACY = {
  display: [2, 3, 5, 12], aksesori: [1, 4], gudang: [2, 3, 8, 10], kasir: [2, 4, 5, 6],
  attitude: [0, 3, 6, 7], service: [0, 2], nonoperasional: [0, 3],
};
function categoryHasCriticalFailLegacy(catId, checks) {
  const idxList = CRITICAL_ITEMS_LEGACY[catId];
  if (!idxList || !checks) return false;
  return idxList.some((i) => !checks[catId + "_" + i]);
}
function calcWeightedFromRecordLegacy(record) {
  if (!record || !record.cats) return record ? record.score || 0 : 0;
  let total = 0;
  CATS_LEGACY.forEach((c) => {
    const w = TIER_WEIGHTS_LEGACY[c.id] || 0;
    if (w === 0) return;
    const bd = record.cats[c.id];
    if (!bd || !bd.total) return;
    let pct = bd.score / bd.total;
    if (categoryHasCriticalFailLegacy(c.id, record.checks)) pct = Math.min(pct, CRITICAL_CAP_LEGACY);
    total += pct * w * 100;
  });
  return Math.round(total);
}

// Kasih tau caller mana daftar kategori yang PAS buat record ini (baru/lama), biar kode lain
// (Laporan Bulanan, Kepatuhan SOP, dst) baca foto/catatan/temuan dari kategori yang BENER,
// bukan salah nyasar/ketuker.
export function getCatsForRecord(record) {
  return isLegacyChecklistRecord(record) ? CATS_LEGACY : CATS;
}

// Daftar item yang GAGAL (buat temuan/findings) dari record manapun (baru/lama) — 1 fungsi
// dipakai bareng, biar nggak ada lagi kode duplikat yang gampang miss kayak kejadian kemarin.
export function listFailedItems(record) {
  if (!record) return [];
  const cats = getCatsForRecord(record);
  const checks = record.checks || {};
  const out = [];
  cats.forEach((c) => c.items.forEach((text, i) => {
    const key = c.id + "_" + i;
    if (!checks[key]) out.push({ key, text, catId: c.id, catLabel: c.label });
  }));
  return out;
}

// ── Item Critical (dari kolom "Critical" di sheet) — MURNI PENANDA/BADGE, TIDAK ADA
// efek khusus ke skor (dikonfirmasi user: "poinnya dijumlah normal kayak item lain").
// Index sesuai urutan item di array CATS masing-masing kategori (0-based).
export const CRITICAL_ITEMS = {
  gudang: [8, 10],           // Tidak ada mismatch barang vs sistem, Tidak ada barang keluar tanpa sistem
  kasir: [2, 4, 5, 6],       // Uang kas kecil, nota resmi, nota diedit, transaksi manual
  service: [0, 2],           // Unit tercatat sistem, unit tanpa identitas
  non_operasional: [3],      // Kunci toko sesuai ketentuan
  // display_laptop, display_aksesoris, toilet, pelayanan, grooming, depan_toko: tidak ada item kritis
};

export function isCriticalItem(catId, idx) {
  return (CRITICAL_ITEMS[catId] || []).includes(idx);
}

// ── Penanda "item kondisi" — item soal kondisi/fungsi aset & fasilitas (rusak/berfungsi),
// bukan soal kepatuhan proses/perilaku. Murni badge visual, TIDAK ngaruh ke skor.
// Checklist baru ini nggak sebanyak yang lama soal kondisi aset spesifik — cuma 1 yang
// jelas cocok. Kalau ada item lain yang harusnya masuk sini, gampang ditambahin belakangan.
export const CONDITION_ITEMS = new Set([
  "display_laptop_10", // Tidak ada unit rusak di display
]);

export const ALERT_THRESHOLD = 80;

// checklistState: { [catId+'_'+itemIndex]: true/false }
// Skor = jumlah POIN item yang lolos (dicentang), dijumlah dari semua kategori. Karena
// total 10 kategori didesain pas 100, hasilnya OTOMATIS jadi persen — nggak perlu dikonversi.
export function calcWeightedScore(checklistState) {
  let total = 0;
  CATS.forEach((c) => {
    c.items.forEach((_, i) => {
      if (checklistState?.[c.id + "_" + i]) total += c.points[i];
    });
  });
  return Math.round(total);
}

// ── Helper skor: hitung skor dari record tersimpan (record.cats = {catId: {score, total}}).
// Nama fungsi & signature DIPERTAHANKAN sama persis kayak sistem lama, biar semua modul yang
// manggil fungsi ini (Ranking Cabang, Kepatuhan SOP, Laporan Bulanan, Dashboard Audit, dst)
// tetep jalan tanpa perlu diubah. ──
// Dideteksi dari ada/nggaknya kategori yang cuma ada di checklist baru — kalau nggak ada,
// dianggap format lama (checklist sebelum Sept 2026).
export function isLegacyChecklistRecord(record) {
  if (!record || !record.cats) return false;
  return record.cats.display_laptop === undefined && record.cats.display_aksesoris === undefined;
}

// Skor SELALU dihitung (nggak pernah null lagi) — otomatis milih rumus yang PAS buat
// formatnya: rumus poin BARU buat checklist baru, rumus tier-weighted+cap LAMA (dipertahankan
// di atas, CATS_LEGACY dkk) buat checklist lama. Biar Laporan Bulanan/Tahunan bisa baca tren
// utuh dari Januari 2026 (bukan cuma mulai September), termasuk foto & temuannya.
export function calcWeightedFromRecord(record) {
  if (!record || !record.cats) return record ? record.score || 0 : 0;
  if (isLegacyChecklistRecord(record)) return calcWeightedFromRecordLegacy(record);
  let total = 0;
  CATS.forEach((c) => {
    const bd = record.cats[c.id];
    if (!bd) return;
    total += bd.score || 0;
  });
  return Math.round(total);
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

// ============================================================
// RANKING CABANG — TIDAK BERUBAH, tidak berhubungan sama checklist SOP
// ============================================================

export const RANKING_BOBOT = { sales: 40, sop: 30, cx: 20, hi: 10 };

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
