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
export function addMonthsToPeriod(period, delta) {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
export function todayInputValue() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

// ============================================================
// SERVICE RATIO — AKSESORIS
// ============================================================

// Ambang batas % Ratio Service Aksesoris (disimpan sebagai pecahan, mis. 0.22% = 0.0022)
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

// ============================================================
// SERVICE RATIO — LAPTOP (threshold TERPISAH dari Aksesoris)
// ============================================================
// Laptop barang jauh lebih kompleks (baterai/layar/keyboard/motherboard, dst) jadi wajar rate
// servisnya jauh lebih tinggi dari aksesoris — dari analisis 8 cabang (Sept 2026), ratio Laptop
// berkisar 0,66%-2,30%, sedangkan threshold Aksesoris (0,22%/0,33%) jauh lebih kecil. Dipilih
// angka bulat (1%/2%) yang gampang diinget & dijelasin, BUKAN diturunin dari celah statistik
// data — biar nggak perlu direvisi tiap kali ada data baru yang polanya beda dikit.
export const LAPTOP_THRESHOLDS = { terkendali: 0.01, monitoring: 0.02 };

export function laptopStatusInfo(ratio) {
  if (ratio <= LAPTOP_THRESHOLDS.terkendali) return { lbl: "Terkendali", color: "#1a9e6e" };
  if (ratio <= LAPTOP_THRESHOLDS.monitoring) return { lbl: "Monitoring", color: "#b07212" };
  return { lbl: "Perlu Perhatian", color: "#a32020" };
}

export function formatRatioPct(ratio) {
  return (ratio * 100).toFixed(2) + "%";
}

// ============================================================
// VONIS GABUNGAN LAPTOP + AKSESORIS
// ============================================================
// Laptop dan Aksesoris diklasifikasi SENDIRI-SENDIRI dulu dengan ambangnya
// masing-masing, baru diambil yang TERBURUK.
//
// Yang dilarang di sini: merata-ratakan kedua rasionya lebih dulu. Ambangnya
// beda 4,55x (terkendali) dan 6,06x (monitoring), jadi rata-ratanya bukan
// besaran apa pun — menilainya dengan ambang aksesoris membalik vonis. Kasus
// yang paling berbahaya: laptop 0,20% + aksesoris 0,40% (sebenarnya "Perlu
// Perhatian") rata-ratanya 0,30%, dan itu terbaca cuma "Monitoring".
//
// Fungsi ini dulu tinggal di components/stok/StokLaporan.js. Dipindah ke sini
// begitu layar kedua membutuhkannya — dua salinan aturan yang sama adalah cara
// paling halus melahirkan dua jawaban untuk satu pertanyaan.
export function worstServiceStatus(ratioLaptop, ratioAksesoris) {
  const infoLaptop = laptopStatusInfo(ratioLaptop);
  const infoAksesoris = serviceStatusInfo(ratioAksesoris);
  if (infoLaptop.lbl === "Perlu Perhatian" || infoAksesoris.lbl === "Perlu Perhatian") {
    return infoAksesoris.lbl === "Perlu Perhatian" ? infoAksesoris : infoLaptop;
  }
  if (infoLaptop.lbl === "Monitoring" || infoAksesoris.lbl === "Monitoring") {
    return infoLaptop.lbl === "Monitoring" ? infoLaptop : infoAksesoris;
  }
  return infoLaptop;
}

// Vonis satu record Service Ratio yang TERSIMPAN, apa pun umurnya.
//
// Tiga keadaan, dan ketiganya sengaja dibedakan:
//
//   1. data baru  — punya ratio_laptop/ratio_aksesoris; dinilai dari keduanya;
//   2. data lama  — sebelum Laptop/Aksesoris dipisah; cuma punya `ratio`
//                   gabungan. Dibiarkan apa adanya dan dinilai dengan ambang
//                   aksesoris, persis seperti waktu ia dibuat. TIDAK
//                   direkonstruksi jadi dua angka — sama seperti perlakuan
//                   Laporan Bulanan dan Laporan Audit Stok;
//   3. tanpa data — tidak punya angka apa pun (mis. Tidak Visit). Memulangkan
//                   status null supaya layar menulis "—", bukan 0,00%. Nol di
//                   situ berarti "tidak ada datanya", bukan "rasionya nol".
export function vonisService(data) {
  const d = data || {};
  if (d.ratio_laptop != null || d.ratio_aksesoris != null) {
    const ratioLaptop = Number(d.ratio_laptop) || 0;
    const ratioAksesoris = Number(d.ratio_aksesoris) || 0;
    return {
      legacy: false, tanpaData: false, ratioLaptop, ratioAksesoris,
      ratioGabungan: Number(d.ratio) || 0,
      status: worstServiceStatus(ratioLaptop, ratioAksesoris),
    };
  }
  if (d.total_unit_cabang != null || d.ratio != null) {
    const ratioGabungan = Number(d.ratio) || 0;
    return {
      legacy: true, tanpaData: false, ratioLaptop: null, ratioAksesoris: null,
      ratioGabungan, status: serviceStatusInfo(ratioGabungan),
    };
  }
  return { legacy: false, tanpaData: true, ratioLaptop: null, ratioAksesoris: null, ratioGabungan: null, status: null };
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
