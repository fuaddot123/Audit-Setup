// ============================================================
// Pengurai berkas impor unit display.
//
// SEMUANYA MURNI — tidak menyentuh React, Supabase, maupun berkas. Yang masuk
// ke sini sudah berupa matriks baris/kolom; pembacaan .xlsx-nya dikerjakan di
// komponen dengan `import("xlsx")` yang dimuat saat dipakai saja.
//
// Dipisah begini bukan demi kerapian: selama penguraiannya tinggal di dalam
// komponen, ia hanya bisa diuji lewat peramban, dan aturan seperti "umur 22
// hari pada 1 September berarti mulai dipajang 10 Agustus" akan luput diuji
// sampai ada auditor yang melaporkan tanggal ngawur di Berita Acara.
//
// DUA BENTUK BERKAS yang dikenali:
//
//   1. "stok-serial" — keluaran sungguhan dari sistem, contoh yang dipakai
//      pemilik: monitoring-display-barang-serial_2026-09-01.xlsx
//        baris 1 : judul berkas (bukan kolom!)
//        baris 2 : #  Nama  SN  Sisa Stok  Umur Display  Umur SN  Cabang
//      Tidak ada kolom Brand. Tidak ada kolom tanggal — yang ada UMUR dalam
//      hari, jadi tanggal mulai pajang dihitung mundur dari tanggal acuan.
//
//   2. "umum" — Brand / Model / Serial / Tanggal Pajang / Program.
//      Dipertahankan untuk tempelan manual dan berkas susunan sendiri.
// ============================================================

const rapikan = (t) => String(t == null ? "" : t).trim();
const kunci = (t) => rapikan(t).toLowerCase().replace(/\s+/g, " ");

const PETA_UMUM = {
  brand: ["brand", "merk", "merek", "brand/merk"],
  model: ["model", "nama barang", "nama produk", "tipe", "type"],
  serial: ["serial number", "serial", "no seri", "nomor seri", "sn", "s/n"],
  pajang: ["tanggal pajang", "tgl pajang", "mulai pajang", "tanggal display", "tgl display"],
  program: ["program", "program brand", "program display", "nama program"],
};

const PETA_STOK = {
  nama: ["nama", "nama barang", "nama produk"],
  serial: ["sn", "s/n", "serial", "serial number", "no seri", "nomor seri"],
  sisaStok: ["sisa stok", "stok", "sisa"],
  umurDisplay: ["umur display", "umur pajang", "lama display", "lama pajang"],
  umurSn: ["umur sn", "umur serial", "umur stok"],
  cabang: ["cabang", "store", "toko", "branch"],
};

function petakan(barisJudul, peta) {
  const hasil = {};
  (barisJudul || []).forEach((sel, i) => {
    const k = kunci(sel);
    if (!k) return;
    Object.keys(peta).forEach((bidang) => {
      if (hasil[bidang] !== undefined) return;
      if (peta[bidang].includes(k)) hasil[bidang] = i;
    });
  });
  return hasil;
}

export function petakanKolom(barisJudul) {
  return petakan(barisJudul, PETA_UMUM);
}

// Berkas sungguhan sering diawali baris judul berkas, baris kosong, atau
// keterangan periode — barisnya BUKAN kolom. Menganggap baris pertama selalu
// judul kolom membuat berkas yang sah ditolak dengan alasan yang membingungkan
// pemakainya ("kolom Brand tidak ditemukan" padahal kolomnya ada di baris 2).
// Karena itu kepala tabel DICARI, bukan diasumsikan.
const BARIS_DIPINDAI = 10;

export function cariJudul(matriks) {
  const isi = (matriks || []).filter((b) => Array.isArray(b));
  for (let i = 0; i < Math.min(BARIS_DIPINDAI, isi.length); i++) {
    // Bentuk "umum" diperiksa LEBIH DULU, dan bentuk "stok-serial" menuntut
    // kolom Umur Display. Sebabnya nyata: judul "Nama Barang" + "No Seri"
    // cocok untuk kedua bentuk, sehingga berkas Brand/Model biasa sempat
    // dikira laporan monitoring lalu ditolak seluruhnya. Umur Display adalah
    // satu-satunya kolom yang benar-benar membedakan keduanya.
    const umum = petakan(isi[i], PETA_UMUM);
    if (umum.brand !== undefined && umum.model !== undefined) {
      return { baris: i, bentuk: "umum", peta: umum };
    }
    const stok = petakan(isi[i], PETA_STOK);
    if (stok.nama !== undefined && stok.umurDisplay !== undefined) {
      return { baris: i, bentuk: "stok-serial", peta: stok };
    }
  }
  return null;
}

// Tanggal acuan dicari di dalam berkas: nama laporan biasanya memuatnya,
// mis. "monitoring-display-barang-serial_2026-09-01". Kalau tidak ketemu,
// pemanggil WAJIB memberikannya. Tidak pernah jatuh ke "hari ini" diam-diam:
// umur dihitung mundur dari acuan, jadi acuan yang salah menggeser SELURUH
// tanggal pajang tanpa satu pun galat.
export function cariTanggalAcuan(matriks, sampaiBaris) {
  const batas = sampaiBaris == null ? 3 : sampaiBaris;
  for (let i = 0; i <= batas && i < (matriks || []).length; i++) {
    for (const sel of matriks[i] || []) {
      const m = rapikan(sel).match(/(20\d{2})[-_\/.](\d{1,2})[-_\/.](\d{1,2})/);
      if (!m) continue;
      const [, y, bl, d] = m;
      if (Number(bl) < 1 || Number(bl) > 12 || Number(d) < 1 || Number(d) > 31) continue;
      return `${y}-${String(bl).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return null;
}

export function mundurHari(tglIso, hari) {
  const t = new Date(tglIso + "T00:00:00Z");
  if (Number.isNaN(t.getTime())) return null;
  return new Date(t.getTime() - hari * 86400000).toISOString().slice(0, 10);
}

// Tanggal datang dalam tiga bentuk dan ketiganya harus benar:
//   46266        angka serial Excel
//   18/07/2026   ditulis tangan, hari dulu
//   2026-08-12   sudah ISO
// Excel menghitung hari sejak 1899-12-30 (bukan 1900-01-01: ada tahun kabisat
// 1900 palsu yang sengaja dipertahankan Excel demi kompatibilitas Lotus 1-2-3).
export function tanggalDari(nilai) {
  const t = rapikan(nilai);
  if (!t) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;

  const dmy = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  if (/^\d+(\.\d+)?$/.test(t)) {
    const n = Math.floor(Number(t));
    // Di bawah 20000 (~1954) hampir pasti bukan tanggal melainkan angka lain
    // yang kebetulan ada di kolom itu. Menerimanya berarti mengarang tanggal.
    if (n < 20000 || n > 80000) return null;
    const ms = Date.UTC(1899, 11, 30) + n * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }

  return null;
}

// ============================================================
// Brand tidak ada di berkas. Ia DITEBAK dari nama produk lewat tabel di
// bawah — dan tebakan itu WAJIB terlihat di pratinjau sebelum diimpor.
//
// Kenapa tidak dibiarkan kosong saja: batas umur pajang bisa berbeda per
// brand (ASUS 30 hari, Dell 45, dst). Brand kosong berarti semua unit
// memakai batas umum, dan unit yang sebenarnya sudah lewat batas brand-nya
// lolos tanpa jejak.
//
// Kenapa tidak ditebak diam-diam: tebakan yang salah memasang batas yang
// salah, dan hasilnya temuan palsu — atau lebih buruk, temuan yang hilang.
// Karena itu yang tidak cocok DIBIARKAN KOSONG dan dihitung, bukan
// dipaksakan ke brand terdekat.
// ============================================================
export const PETA_BRAND = [
  { brand: "Lenovo", kata: ["ideapad", "thinkpad", "thinkbook", "legion", "loq", "yoga", "lenovo"] },
  { brand: "ASUS", kata: ["vivobook", "zenbook", "tuf", "rog", "expertbook", "asus", "proart"] },
  { brand: "Acer", kata: ["aspire", "nitro", "predator", "swift", "travelmate", "acer"] },
  { brand: "HP", kata: ["victus", "pavilion", "elitebook", "probook", "omen", "envy", "hp "] },
  { brand: "Dell", kata: ["inspiron", "latitude", "vostro", "xps", "dell"] },
  { brand: "Axioo", kata: ["mybook", "hype", "axioo"] },
  { brand: "Advan", kata: ["tbook", "workplus", "workmate", "workpro", "soulmate", "advan"] },
  { brand: "Infinix", kata: ["inbook", "xbook", "infinix"] },
  { brand: "MSI", kata: ["katana", "modern", "thin ", "cyborg", "msi"] },
  { brand: "Samsung", kata: ["galaxy book", "samsung"] },
  { brand: "Huawei", kata: ["matebook", "huawei"] },
  { brand: "Apple", kata: ["macbook", "apple"] },
];

// Sebagian nama produk hanya berupa KODE MODEL tanpa menyebut brand sama
// sekali ("14-EP1177TU", "V16 V3607VJ-I535B1T-HM"). Ketetapan pemilik
// 1 Sep 2026: 14-EP/14-EM milik HP, V16 milik ASUS.
//
// Polanya DIIKAT KE AWAL nama. Kalau tidak, "Vivobook Go 14 E1404FA" yang
// memuat "14 e" di tengahnya ikut tertangkap begitu urutan tabel berubah —
// dan salah brand berarti salah batas umur, bukan sekadar salah label.
export const POLA_BRAND = [
  { brand: "HP", pola: /^14[\s-]?e[pm]/i },
  { brand: "ASUS", pola: /^v16\b/i },
  { brand: "ASUS", pola: /^v3\d{3}[a-z]/i },
];

export function tebakBrand(nama) {
  const asli = rapikan(nama);
  for (const p of POLA_BRAND) {
    if (p.pola.test(asli)) return p.brand;
  }
  const n = " " + kunci(nama) + " ";
  for (const b of PETA_BRAND) {
    if (b.kata.some((k) => n.includes(k))) return b.brand;
  }
  return "";
}

// Memecah tempelan dari Excel (TSV) atau isi .csv jadi matriks.
export function pecahTeksTabel(teks) {
  const baris = String(teks || "").replace(/\r\n?/g, "\n").split("\n").filter((b) => b.trim() !== "");
  if (!baris.length) return [];
  const pemisah = baris[0].includes("\t") ? "\t" : (baris[0].includes(";") ? ";" : ",");
  return baris.map((b) => b.split(pemisah).map((s) => s.replace(/^"|"$/g, "").trim()));
}

// ============================================================
// Mengolah matriks jadi baris siap pakai + daftar yang ditolak beserta
// SEBABNYA. Baris cacat TIDAK dibuang diam-diam: yang ditolak tanpa alasan
// yang terbaca akan dikira tidak pernah ada di berkasnya.
//
// pilihan:
//   cabang        nama cabang yang sedang diaudit — baris cabang lain DITOLAK,
//                 bukan diikutkan. Satu berkas bisa memuat banyak cabang, dan
//                 memasukkan unit cabang lain ke Berita Acara cabang ini
//                 adalah kesalahan yang tidak terlihat sampai ada yang
//                 mencocokkan fisiknya di toko.
//   tanggalAcuan  dipakai kalau berkasnya tidak memuat tanggal sendiri.
// ============================================================
export function olahMatriks(matriks, pilihan) {
  const opsi = pilihan || {};
  const isi = (matriks || []).filter((b) => Array.isArray(b) && b.some((s) => rapikan(s) !== ""));
  if (!isi.length) {
    return { galat: "Berkasnya kosong — tidak ada satu baris pun yang terbaca.", rows: [], ditolak: [] };
  }

  const judul = cariJudul(isi);
  if (!judul) {
    return {
      galat: "Judul kolom tidak dikenali. Yang bisa dibaca: (a) berkas monitoring display "
        + "dengan kolom Nama, SN, Umur Display, Cabang; atau (b) kolom Brand dan Model.",
      rows: [], ditolak: [],
    };
  }

  const data = isi.slice(judul.baris + 1);
  const rows = [];
  const ditolak = [];
  const nomorBaris = (i) => judul.baris + 2 + i;

  if (judul.bentuk === "umum") {
    data.forEach((b, i) => {
      const amb = (bidang) => (judul.peta[bidang] === undefined ? "" : rapikan(b[judul.peta[bidang]]));
      const brand = amb("brand");
      const model = amb("model");
      const pajangMentah = amb("pajang");
      const pajang = tanggalDari(pajangMentah);

      const sebab = [];
      if (!brand) sebab.push("brand kosong");
      if (!model) sebab.push("model kosong");
      if (pajangMentah && !pajang) sebab.push(`tanggal "${pajangMentah}" tidak terbaca`);
      if (!pajangMentah) sebab.push("tanggal pajang kosong");

      if (sebab.length) {
        ditolak.push({
          baris: nomorBaris(i),
          isi: [brand, model].filter(Boolean).join(" ") || "(kosong)",
          sebab: sebab.join(", "),
        });
        return;
      }
      rows.push({
        brand, model,
        serial_number: amb("serial"),
        tanggal_pajang: pajang,
        program_nama: amb("program"),
      });
    });
    return { galat: null, bentuk: "umum", rows, ditolak, terbaca: data.length };
  }

  // ── bentuk "stok-serial" ──
  const acuan = cariTanggalAcuan(isi, judul.baris) || opsi.tanggalAcuan || null;
  if (!acuan) {
    return {
      galat: "Tanggal acuan tidak ketemu di berkas, dan tidak ada tanggal audit yang bisa dipakai. "
        + "Umur display dihitung mundur dari tanggal itu, jadi tanpa acuan seluruh tanggal pajang "
        + "akan meleset — lebih baik ditolak daripada salah diam-diam.",
      rows: [], ditolak: [],
    };
  }

  const cabangDiminta = kunci(opsi.cabang || "");
  let brandKosong = 0;
  const cabangLain = {};

  data.forEach((b, i) => {
    const amb = (bidang) => (judul.peta[bidang] === undefined ? "" : rapikan(b[judul.peta[bidang]]));
    const nama = amb("nama");
    const umurMentah = amb("umurDisplay");
    const cabang = amb("cabang");

    const sebab = [];
    if (!nama) sebab.push("nama barang kosong");

    let umur = null;
    if (umurMentah === "") {
      sebab.push("umur display kosong");
    } else if (!/^\d+(\.\d+)?$/.test(umurMentah)) {
      sebab.push(`umur display "${umurMentah}" bukan angka`);
    } else {
      umur = Math.floor(Number(umurMentah));
      // 3.650 hari = 10 tahun. Di atas itu hampir pasti kolomnya tertukar,
      // bukan unit yang benar-benar dipajang sepuluh tahun.
      if (umur > 3650) sebab.push(`umur display ${umur} hari tidak masuk akal`);
    }

    if (cabangDiminta && cabang && kunci(cabang) !== cabangDiminta) {
      cabangLain[cabang] = (cabangLain[cabang] || 0) + 1;
      sebab.push(`cabang "${cabang}", bukan cabang yang sedang diaudit`);
    }

    if (sebab.length) {
      ditolak.push({ baris: nomorBaris(i), isi: nama || "(kosong)", sebab: sebab.join(", ") });
      return;
    }

    const brand = tebakBrand(nama);
    if (!brand) brandKosong++;

    rows.push({
      brand,
      model: nama,
      serial_number: amb("serial"),
      tanggal_pajang: mundurHari(acuan, umur),
      program_nama: "",
      // Hanya untuk dilihat auditor di pratinjau — TIDAK disimpan ke database.
      // Menambahkan kolom baru diam-diam ke tabel display berarti data yang
      // tidak pernah disepakati bentuknya.
      _umurDisplay: umur,
      _umurSn: amb("umurSn"),
      _sisaStok: amb("sisaStok"),
      _cabang: cabang,
      _brandDitebak: !!brand,
    });
  });

  return {
    galat: null,
    bentuk: "stok-serial",
    acuan,
    rows,
    ditolak,
    terbaca: data.length,
    brandKosong,
    cabangLain,
  };
}
