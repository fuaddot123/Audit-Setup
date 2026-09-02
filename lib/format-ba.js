// ============================================================
// Satu tempat untuk aturan "format Berita Acara yang mana yang berlaku".
//
// KETETAPAN PEMILIK 31 Agustus 2026: format baru (inventaris per item,
// Monitoring Display, Berita Acara tiga poin) BERLAKU MULAI PERIODE
// SEPTEMBER 2026. Periode sebelumnya tetap memakai format lama.
//
// Alasannya sama dengan alasan skor display dibekukan: Berita Acara yang
// sudah ditandatangani tidak boleh berubah bentuk hanya karena aplikasinya
// diperbarui. Audit Agustus 2026 dan sebelumnya harus tercetak persis
// seperti saat ditandatangani.
//
// KENAPA KONSTANTA DI KODE, BUKAN BARIS DI DATABASE:
// angka seperti "batas 60 hari" memang tepat disimpan di tabel — ia
// disetel pemilik dan berubah tanpa deploy. Tanggal ini beda jenis: ia
// menentukan JALUR KODE mana yang dijalankan dan bentuk data mana yang
// ditulis. Kalau ia bisa diubah dari layar, satu salah ketik mengubah
// bentuk data audit yang sedang berjalan, tanpa gejala. Satu konstanta,
// satu tempat, dan perubahannya lewat deploy yang terlihat.
// ============================================================

export const FORMAT_BA_MULAI = "2026-09";

// period selalu berbentuk "YYYY-MM", jadi perbandingan string sudah benar
// secara urutan waktu. Kalau period kosong/tidak dikenal, pilih format LAMA —
// menebak ke format baru berarti menulis bentuk data baru ke periode yang
// belum tentu siap.
export function pakaiFormatBaru(period) {
  if (typeof period !== "string" || !/^\d{4}-\d{2}$/.test(period)) return false;
  return period >= FORMAT_BA_MULAI;
}

const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

export function namaPeriode(period) {
  if (typeof period !== "string" || !/^\d{4}-\d{2}$/.test(period)) return String(period || "");
  return BULAN[Number(period.slice(5, 7)) - 1] + " " + period.slice(0, 4);
}

// ============================================================
// Katalog inventaris per item.
//
// Kategori lama tetap 10 dan URUTANNYA TIDAK BERUBAH — modul lain
// (Kepatuhan SOP) masih menghitung per kategori, dan mengubah urutan
// atau nama kategori akan menggeser angka mereka diam-diam.
// Yang baru hanya: tiap kategori sekarang punya daftar item.
//
// Daftar ini ditarik langsung dari prototipe yang disetujui pemilik,
// bukan diketik ulang.
// ============================================================

export const INVENTARIS_ITEMS = [
  { kategori: "Jaringan Internet", items: ["Router utama", "Kabel LAN & rack"] },
  { kategori: "Peralatan Kasir", items: ["Komputer kasir", "Printer struk", "Laci uang", "Barcode scanner", "UPS kasir"] },
  { kategori: "Peralatan Teknisi", items: ["Meja teknisi", "Toolkit & obeng set", "Multitester"] },
  { kategori: "Audio Visual", items: ["TV display", "Backdrop LED", "Speaker toko", "Player konten promo"] },
  { kategori: "Penerangan", items: ["Lampu area display", "Lampu etalase", "Lampu gudang", "Lampu papan nama"] },
  { kategori: "Listrik & Utilitas", items: ["AC ruang display", "AC ruang teknisi", "Stop kontak & instalasi", "Stabilizer / genset"] },
  { kategori: "Peralatan Keamanan", items: ["CCTV", "DVR & monitor CCTV", "APAR", "Rolling door & gembok"] },
  { kategori: "Furniture & Fixture", items: ["Meja display", "Lemari display kaca", "Kursi tunggu pelanggan", "Rak aksesoris", "Meja kasir"] },
  { kategori: "Kendaraan & Mesin", items: ["Motor operasional", "Printer kantor"] },
  { kategori: "Peralatan Kebersihan", items: ["Vacuum cleaner", "Alat pel & sapu", "Tempat sampah"] },
];

// Kategori lama, urutannya TIDAK BOLEH berubah — Kepatuhan SOP masih
// menghitung per kategori dan mengubah urutan/namanya menggeser angka
// mereka diam-diam. AuditInventaris.js mengekspor ulang konstanta ini.
export const INVENTARIS_CATEGORIES = INVENTARIS_ITEMS.map((g) => g.kategori);

export const PEMISAH_KUNCI = "|";

export function kunciItem(kategori, nama) {
  return kategori + PEMISAH_KUNCI + nama;
}

// Semua kunci item, urut sesuai katalog.
export function semuaKunciItem() {
  const out = [];
  INVENTARIS_ITEMS.forEach((g) => g.items.forEach((i) => out.push(kunciItem(g.kategori, i))));
  return out;
}

// Data per item dikenali dari kunci yang memuat pemisah. Bentuk lama
// memakai nama kategori polos sebagai kunci, jadi keduanya tidak mungkin
// tertukar.
export function bentukPerItem(data) {
  if (!data || typeof data !== "object") return false;
  return Object.keys(data).some((k) => k.includes(PEMISAH_KUNCI));
}

// Status satu KATEGORI, berlaku untuk kedua bentuk data.
//
// Ini yang membuat angka Kepatuhan SOP tetap sebanding sebelum dan sesudah
// September: dulu satu kategori bernilai "Rusak" atau tidak; sekarang satu
// kategori dihitung rusak kalau ADA SATU SAJA itemnya yang rusak. Kalau
// yang dihitung item, angka temuan SOP akan melompat naik di September
// hanya karena butirannya berubah — bukan karena tokonya memburuk.
export function statusKategori(data, kategori) {
  if (!data) return "Berfungsi";
  if (!bentukPerItem(data)) return data[kategori]?.status || "Berfungsi";
  const grup = INVENTARIS_ITEMS.find((g) => g.kategori === kategori);
  if (!grup) return "Berfungsi";
  const st = grup.items.map((i) => data[kunciItem(kategori, i)]?.status || "Berfungsi");
  if (st.includes("Rusak")) return "Rusak";
  // Kategori yang SEMUA itemnya tidak ada dianggap tidak ada; kalau
  // sebagian ada, kategorinya tetap berfungsi.
  if (st.length && st.every((s) => s === "Tidak ada")) return "Tidak ada";
  return "Berfungsi";
}

// ============================================================
// Hitungan inventaris. Semuanya MURNI — tidak menyentuh React maupun
// Supabase — supaya bisa diuji langsung di Node.
// ============================================================

// Kunci yang benar-benar dipakai oleh sebentuk data: 10 kategori untuk
// bentuk lama, 36 item untuk bentuk baru.
export function kunciTerpakai(data) {
  if (!data) return [];
  return bentukPerItem(data) ? semuaKunciItem() : INVENTARIS_CATEGORIES;
}

function hitungStatus(data, status) {
  return kunciTerpakai(data).filter((k) => (data[k]?.status || "Berfungsi") === status).length;
}

export function countTidakAda(data) { return data ? hitungStatus(data, "Tidak ada") : 0; }
export function countBerfungsi(data) { return data ? hitungStatus(data, "Berfungsi") : 0; }
export function countRusakItem(data) { return data ? hitungStatus(data, "Rusak") : 0; }

// Daftar item yang BELUM TERSEDIA di cabang, untuk blok terpisah di
// Berita Acara. Ketetapan pemilik 31 Agu 2026: tidak menurunkan skor,
// tetapi harus terbaca — APAR wajib menurut aturan keselamatan, dan
// kalau hanya jadi satu baris kelabu di tengah tabel 36 item, ia
// tenggelam.
export function itemBelumTersedia(data) {
  if (!data) return [];
  const perItem = bentukPerItem(data);
  return kunciTerpakai(data)
    .filter((k) => data[k]?.status === "Tidak ada")
    .map((k) => ({
      kunci: k,
      kategori: perItem ? k.split(PEMISAH_KUNCI)[0] : k,
      nama: perItem ? k.split(PEMISAH_KUNCI).slice(1).join(PEMISAH_KUNCI) : k,
      keterangan: data[k]?.keterangan || "",
    }));
}

// Skor inventaris. Item "Tidak ada" DIKELUARKAN dari penyebut: barang
// yang belum dimiliki cabang bukan temuan, dan juga bukan prestasi.
// Kalau ikut jadi penyebut, cabang yang barangnya belum lengkap terlihat
// lebih buruk; kalau ikut dihitung berfungsi, skornya justru naik karena
// barangnya tidak ada.
export function skorInventaris(data) {
  const berfungsi = countBerfungsi(data);
  const rusak = countRusakItem(data);
  const berlaku = berfungsi + rusak;
  return {
    berfungsi, rusak,
    tidakAda: countTidakAda(data),
    total: kunciTerpakai(data).length,
    berlaku,
    persen: berlaku ? Math.round((berfungsi / berlaku) * 100) : 100,
  };
}
