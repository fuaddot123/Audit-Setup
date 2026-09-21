// components/DisplayMonitoring.js
// ============================================================
// SECTION "MONITORING DISPLAY" — dipasang di dalam form Berita Acara,
// sebaris dengan Audit Stock Opname dan Inventaris.
//
// Pola yang diikuti sengaja sama dengan InventarisChecklist:
// state dipegang komponen induk (BeritaAcara), berkas ini cuma merender
// dan menyediakan fungsi muat/simpan. Jadi tombol Simpan yang sudah ada
// di Berita Acara tetap satu-satunya tombol simpan.
//
// Beda dengan Stock Opname: daftar unit TIDAK diketik ulang tiap bulan.
// Unit yang masih dipajang otomatis muncul lengkap dengan umurnya hari ini,
// karena tanggal_pajang tersimpan permanen di tabel display_unit. Auditor
// tinggal: konfirmasi kondisi, tandai yang turun, atau tambah unit baru.
// ============================================================

import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { compressImage } from "./AuditInventaris";
import { pecahTeksTabel, olahMatriks } from "../lib/impor-display";

// ── Bantuan ────────────────────────────────────────────────────────────

// Nilai penanda di dropdown untuk "istilah yang belum ada di daftar".
export const OPSI_BARU = "__baru__";

// Kode kolom dibuat dari labelnya supaya terbaca saat dilihat langsung di
// database ("engsel_longgar"), bukan deretan acak.
function buatKode(label) {
  const dasar = String(label || "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return dasar || "opsi";
}

const samaLabel = (a, b) =>
  String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

// Menambahkan istilah baru ke master data — atau memakai yang sudah ada.
//
// Tiga lapis pencocokan, dan ketiganya perlu:
//   1. daftar yang sedang dimuat di layar  — menangkap yang paling umum
//   2. query ke database                   — auditor lain mungkin baru menambah
//   3. tangkapan galat unique index        — dua auditor menyimpan bersamaan
// Tanpa lapis ketiga, dua orang yang mengetik istilah sama pada detik yang
// sama akan membuat salah satunya gagal menyimpan seluruh Berita Acara.
async function pastikanOpsi({ tabel, label, tambahan, daftar, userId }) {
  const bersih = String(label || "").trim();
  if (!bersih) throw new Error("Istilah baru tidak boleh kosong.");

  const diLayar = (daftar || []).find((o) => samaLabel(o.label, bersih));
  if (diLayar) return diLayar.kode;

  const cari = await supabase.from(tabel).select("kode,label").ilike("label", bersih);
  const diDb = (cari.data || []).find((o) => samaLabel(o.label, bersih));
  if (diDb) return diDb.kode;

  const kode = buatKode(bersih);
  const isi = { kode, label: bersih, urutan: 90, aktif: true, usulan: true, diusulkan_oleh: userId, ...tambahan };
  const { data, error } = await supabase.from(tabel).insert(isi).select("kode").single();
  if (!error) return data.kode;

  const ulang = await supabase.from(tabel).select("kode,label").ilike("label", bersih);
  const ketemu = (ulang.data || []).find((o) => samaLabel(o.label, bersih));
  if (ketemu) return ketemu.kode;

  // Label beda tapi kode bentrok (mis. "Lecet-berat" vs "Lecet berat").
  const isi2 = { ...isi, kode: kode.slice(0, 36) + "_2" };
  const { data: d2, error: e2 } = await supabase.from(tabel).insert(isi2).select("kode").single();
  if (e2) throw new Error(`Gagal menambah "${bersih}" ke daftar: ${e2.message}`);
  return d2.kode;
}

export function barisDisplayBaru() {
  return {
    id: null,                 // null = unit baru, belum ada di database
    kondisi_id: null,         // id baris display_kondisi periode ini (kalau sudah pernah disimpan)
    brand: "",
    model: "",
    serial_number: "",
    sku: "",
    program_brand: false,
    program_nama: "",
    tanggal_pajang: new Date().toISOString().slice(0, 10),
    umur_hari: 0,
    batas_hari: null,
    status_umur: "Aman",
    masih_dipajang: true,
    kondisi_kode: "",
    kondisi_baru_label: "",
    kondisi_baru_setara: "",
    kondisi_catatan: "",
    photos: [],
    turun: false,
    perlakuan_kode: "",
    perlakuan_baru_label: "",
    perlakuan_catatan: "",
    harga_jual_display: "",
    baru: true,
  };
}

// Untuk unit baru yang belum tersimpan, umur dihitung di sini. Untuk unit
// yang sudah ada, angkanya datang dari view v_display_monitoring supaya
// aturan batas per-brand ikut terpakai.
export function hitungUmurHari(tanggalPajang) {
  if (!tanggalPajang) return 0;
  const mulai = new Date(tanggalPajang + "T00:00:00");
  const kini = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00");
  return Math.max(0, Math.round((kini - mulai) / 86400000));
}

const WARNA_STATUS = {
  "Lewat Batas": "#a32020",
  "Mendekati Batas": "#d98324",
  "Aman": "#1a9e6e",
};

function warnaStatus(status) {
  return WARNA_STATUS[status] || "#888";
}

// ── Hapus lengkap Monitoring Display buat 1 audit yang dihapus ─────────
// Dipanggil dari deleteRecord() di BeritaAcara.js, SEBELUM/SESUDAH baris
// berita_acara-nya sendiri dihapus (urutan nggak penting, dua tabel beda).
// Treat penghapusan audit ini kayak "audit bulan itu nggak pernah kejadian":
//   - Unit yang catatan kondisinya CUMA ada di periode ini (nggak punya
//     riwayat dari bulan lain) → berarti unit itu baru lahir di audit ini,
//     dihapus TOTAL (bukan tebak dari tanggal — dicek dari riwayat beneran).
//   - Unit yang punya riwayat dari bulan lain → cuma catatan kondisi
//     periode ini yang dihapus; kalau dia ditandai "turun" PAS di audit
//     ini (tanggal_turun jatuh di periode ini), itu di-undo balik jadi
//     "masih dipajang".
// Foto-foto kondisi yang kehapus ikut dibersihkan dari Storage.
export async function hapusDisplayUntukPeriode({ branchId, period }) {
  // 1) Semua unit cabang ini + catatan kondisi periode yang dihapus.
  const { data: unitRows, error: uErr } = await supabase
    .from("display_unit").select("id, tanggal_turun").eq("branch_id", branchId);
  if (uErr) throw uErr;
  const unitIds = (unitRows || []).map((u) => u.id);
  if (!unitIds.length) return;

  const { data: kondisiPeriodeIni, error: kErr } = await supabase
    .from("display_kondisi").select("id, display_unit_id, photos")
    .eq("period", period).in("display_unit_id", unitIds);
  if (kErr) throw kErr;
  if (!kondisiPeriodeIni || !kondisiPeriodeIni.length) return; // nggak ada yang perlu dibersihin

  const unitIdsPeriodeIni = [...new Set(kondisiPeriodeIni.map((k) => k.display_unit_id))];

  // 2) Buat tiap unit yang kesentuh, cek: dia punya catatan kondisi dari
  //    periode LAIN nggak? Kalau nggak ada sama sekali → baru lahir bulan ini.
  const { data: riwayatLain, error: rErr } = await supabase
    .from("display_kondisi").select("display_unit_id")
    .in("display_unit_id", unitIdsPeriodeIni).neq("period", period);
  if (rErr) throw rErr;
  const punyaRiwayatLain = new Set((riwayatLain || []).map((r) => r.display_unit_id));

  const idUnitBaruLahir = unitIdsPeriodeIni.filter((id) => !punyaRiwayatLain.has(id));
  const idUnitLama = unitIdsPeriodeIni.filter((id) => punyaRiwayatLain.has(id));

  // 3) Kumpulin & hapus semua foto dari Storage (kondisi periode ini doang).
  const semuaFoto = kondisiPeriodeIni.flatMap((k) => Array.isArray(k.photos) ? k.photos : []);
  if (semuaFoto.length) {
    const paths = semuaFoto.map((m) => {
      const idx = m.url.indexOf("/findings/");
      return idx === -1 ? null : m.url.slice(idx + "/findings/".length);
    }).filter(Boolean);
    if (paths.length) await supabase.storage.from("findings").remove(paths);
  }

  // 4) Unit yang baru lahir bulan ini → hapus TOTAL (kondisi ikut kehapus
  //    otomatis lewat foreign key CASCADE kalau ada; kalau nggak ada, hapus
  //    manual dulu barisnya biar nggak nyangkut FK constraint).
  if (idUnitBaruLahir.length) {
    await supabase.from("display_kondisi").delete().in("display_unit_id", idUnitBaruLahir);
    await supabase.from("display_unit").delete().in("id", idUnitBaruLahir);
  }

  // 5) Unit lama → cuma catatan kondisi periode ini yang dihapus.
  if (idUnitLama.length) {
    await supabase.from("display_kondisi").delete().eq("period", period).in("display_unit_id", idUnitLama);
  }

  // 6) Unit yang "turun"-nya PAS jatuh di periode yang dihapus → undo,
  //    balikin jadi "masih dipajang" (unit lama doang, yang baru lahir
  //    udah kehapus total di langkah 4).
  const idUnitTurunBulanIni = (unitRows || [])
    .filter((u) => idUnitLama.includes(u.id) && (u.tanggal_turun || "").slice(0, 7) === period)
    .map((u) => u.id);
  if (idUnitTurunBulanIni.length) {
    await supabase.from("display_unit").update({
      tanggal_turun: null, perlakuan_kode: null, perlakuan_tanggal: null,
      perlakuan_catatan: null, harga_jual_display: null,
    }).in("id", idUnitTurunBulanIni);
  }
}

// ── Muat data ──────────────────────────────────────────────────────────

export async function muatDisplay({ branchId, period }) {
  const [unitRes, perlakuanRes, kondisiOpsiRes] = await Promise.all([
    supabase.from("v_display_monitoring").select("*")
      .eq("branch_id", branchId).order("umur_hari", { ascending: false }),
    supabase.from("display_perlakuan").select("*").eq("aktif", true).order("urutan"),
    supabase.from("display_kondisi_opsi").select("*").eq("aktif", true).order("urutan"),
  ]);
  if (unitRes.error) throw unitRes.error;
  if (perlakuanRes.error) throw perlakuanRes.error;
  if (kondisiOpsiRes.error) throw kondisiOpsiRes.error;

  const semuaUnit = unitRes.data || [];

  // Yang ditampilkan: unit yang masih dipajang, DITAMBAH unit yang baru
  // diturunkan pada periode ini (supaya perlakuannya masih bisa dikoreksi
  // sebelum bulan ditutup).
  const relevan = semuaUnit.filter(
    (u) => u.masih_dipajang || (u.tanggal_turun || "").slice(0, 7) === period
  );

  // Catatan kondisi yang SUDAH tersimpan untuk periode ini — supaya form
  // tidak menampilkan kosong padahal auditor sudah pernah mengisi.
  let kondisiPeriode = [];
  if (relevan.length) {
    const res = await supabase.from("display_kondisi").select("*")
      .eq("period", period).in("display_unit_id", relevan.map((u) => u.id));
    if (res.error) throw res.error;
    kondisiPeriode = res.data || [];
  }
  const kondisiByUnit = {};
  kondisiPeriode.forEach((k) => { kondisiByUnit[k.display_unit_id] = k; });

  const rows = relevan.map((u) => {
    const k = kondisiByUnit[u.id] || null;
    return {
      id: u.id,
      kondisi_id: k ? k.id : null,
      brand: u.brand || "",
      model: u.model || "",
      serial_number: u.serial_number || "",
      sku: u.sku || "",
      program_brand: !!u.program_brand,
      program_nama: u.program_nama || "",
      tanggal_pajang: u.tanggal_pajang,
      umur_hari: u.umur_hari,
      batas_hari: u.batas_hari,
      status_umur: u.status_umur,
      masih_dipajang: u.masih_dipajang,
      kondisi_kode: k ? k.kondisi_kode : "",
      kondisi_baru_label: "",
      kondisi_baru_setara: "",
      kondisi_catatan: k ? (k.catatan || "") : "",
      photos: k && Array.isArray(k.photos) ? k.photos : [],
      turun: !u.masih_dipajang,
      perlakuan_kode: u.perlakuan_kode || "",
      perlakuan_baru_label: "",
      perlakuan_catatan: "",
      harga_jual_display: u.harga_jual_display == null ? "" : String(u.harga_jual_display),
      baru: false,
    };
  });

  return {
    rows,
    perlakuanOpsi: perlakuanRes.data || [],
    kondisiOpsi: kondisiOpsiRes.data || [],
  };
}

// ── Periksa sebelum simpan ─────────────────────────────────────────────
// Database sudah punya pagar (constraint display_unit_turun_wajib_perlakuan),
// tapi galat dari Postgres tidak enak dibaca auditor. Diperiksa dulu di sini
// supaya pesannya jelas; constraint tetap jadi jaring terakhir.

export function periksaDisplay(rows) {
  const galat = [];
  rows.forEach((r, i) => {
    const nama = `${r.brand} ${r.model}`.trim() || `Baris ${i + 1}`;
    if (r.baru) {
      if (!r.brand.trim()) galat.push(`${nama}: brand belum diisi.`);
      if (!r.model.trim()) galat.push(`${nama}: model belum diisi.`);
      if (!r.tanggal_pajang) galat.push(`${nama}: tanggal mulai pajang belum diisi.`);
      if (r.program_brand && !r.program_nama.trim())
        galat.push(`${nama}: ditandai ikut program brand tapi nama programnya kosong.`);
    }
    if (r.turun && !r.perlakuan_kode)
      galat.push(`${nama}: ditandai turun display tapi perlakuannya belum dipilih.`);
    if (r.kondisi_kode === OPSI_BARU) {
      if (!r.kondisi_baru_label.trim())
        galat.push(`${nama}: kondisi baru dipilih tapi istilahnya belum ditulis.`);
      // Tanpa padanan, skornya tidak diketahui dan unit ini akan hilang dari
      // rata-rata kondisi — skor cabang jadi salah tanpa gejala.
      if (!r.kondisi_baru_setara)
        galat.push(`${nama}: kondisi baru "${r.kondisi_baru_label.trim()}" belum dipilih setara dengan tingkat apa.`);
    }
    if (r.turun && r.perlakuan_kode === OPSI_BARU && !r.perlakuan_baru_label.trim())
      galat.push(`${nama}: perlakuan baru dipilih tapi istilahnya belum ditulis.`);
    if (r.harga_jual_display !== "" && isNaN(Number(r.harga_jual_display)))
      galat.push(`${nama}: harga jual display bukan angka.`);
  });
  return galat;
}

// ── Simpan ─────────────────────────────────────────────────────────────
// Dipanggil dari saveRecord() milik BeritaAcara, sesudah berita_acara
// tersimpan. Dibuat per baris supaya satu unit gagal tidak menjatuhkan
// seluruh kunjungan.

export async function simpanDisplay({ rows, branchId, period, auditDate, userId, kondisiOpsi, perlakuanOpsi }) {
  const hasil = [];
  // Istilah baru didaftarkan ke master lebih dulu, sekali per label, supaya
  // tiga unit yang diberi kondisi baru yang sama tidak membuat tiga baris.
  const petaKondisi = {};
  const petaPerlakuan = {};
  for (const r of rows) {
    if (r.kondisi_kode === OPSI_BARU) {
      const kunci = r.kondisi_baru_label.trim().toLowerCase();
      if (!petaKondisi[kunci]) {
        const setara = (kondisiOpsi || []).find((k) => k.kode === r.kondisi_baru_setara);
        petaKondisi[kunci] = await pastikanOpsi({
          tabel: "display_kondisi_opsi", label: r.kondisi_baru_label,
          tambahan: { skor: setara ? setara.skor : 50 },
          daftar: kondisiOpsi, userId,
        });
      }
    }
    if (r.turun && r.perlakuan_kode === OPSI_BARU) {
      const kunci = r.perlakuan_baru_label.trim().toLowerCase();
      if (!petaPerlakuan[kunci]) {
        petaPerlakuan[kunci] = await pastikanOpsi({
          tabel: "display_perlakuan", label: r.perlakuan_baru_label,
          tambahan: {}, daftar: perlakuanOpsi, userId,
        });
      }
    }
  }
  const kodeKondisi = (r) => r.kondisi_kode === OPSI_BARU
    ? petaKondisi[r.kondisi_baru_label.trim().toLowerCase()] : r.kondisi_kode;
  const kodePerlakuan = (r) => r.perlakuan_kode === OPSI_BARU
    ? petaPerlakuan[r.perlakuan_baru_label.trim().toLowerCase()] : r.perlakuan_kode;

  for (const r of rows) {
    let unitId = r.id;

    if (r.baru) {
      const { data, error } = await supabase.from("display_unit").insert({
        branch_id: branchId,
        brand: r.brand.trim(),
        model: r.model.trim(),
        serial_number: r.serial_number.trim() || null,
        sku: r.sku.trim() || null,
        program_brand: r.program_brand,
        program_nama: r.program_brand ? r.program_nama.trim() : null,
        tanggal_pajang: r.tanggal_pajang,
        kondisi_awal: kodeKondisi(r) || null,
        dicatat_oleh: userId,
      }).select("id").single();
      if (error) throw new Error(`${r.brand} ${r.model}: ${error.message}`);
      unitId = data.id;
    }

    // Unit ditandai turun pada kunjungan ini
    if (r.turun && r.masih_dipajang) {
      const { error } = await supabase.from("display_unit").update({
        tanggal_turun: auditDate,
        perlakuan_kode: kodePerlakuan(r),
        perlakuan_tanggal: auditDate,
        perlakuan_catatan: r.perlakuan_catatan.trim() || null,
        harga_jual_display: r.harga_jual_display === "" ? null : Number(r.harga_jual_display),
      }).eq("id", unitId);
      if (error) throw new Error(`${r.brand} ${r.model}: ${error.message}`);
    }

    // Catatan kondisi kunjungan ini
    if (r.kondisi_kode) {
      // Skor & batas DIBEKUKAN di sini. Kalau nanti Super Admin mengubah
      // master data, Berita Acara yang sudah tercetak tidak ikut berubah —
      // master hanya berlaku untuk audit berikutnya.
      const opsiTerpakai = (kondisiOpsi || []).find((k) => k.kode === kodeKondisi(r));
      const skorBeku = r.kondisi_kode === OPSI_BARU
        ? ((kondisiOpsi || []).find((k) => k.kode === r.kondisi_baru_setara) || {}).skor
        : (opsiTerpakai || {}).skor;
      const isi = {
        display_unit_id: unitId,
        audit_date: auditDate,
        period,
        kondisi_kode: kodeKondisi(r),
        skor_saat_audit: skorBeku == null ? null : skorBeku,
        batas_hari_saat_audit: r.batas_hari == null ? null : r.batas_hari,
        catatan: r.kondisi_catatan.trim() || null,
        photos: r.photos,
        dicatat_oleh: userId,
      };
      const res = r.kondisi_id
        ? await supabase.from("display_kondisi").update(isi).eq("id", r.kondisi_id)
        : await supabase.from("display_kondisi").insert(isi);
      if (res.error) throw new Error(`${r.brand} ${r.model}: ${res.error.message}`);
    }

    hasil.push(unitId);
  }
  return hasil;
}

// ── Unggah foto ────────────────────────────────────────────────────────
// Logika kompresi + batas ukuran sengaja memakai compressImage dari
// AuditInventaris. Catatan untuk nanti: blok unggah serupa sudah ada di
// AuditInventaris dan SopAuditCabang — kalau ada waktu, ketiganya layak
// ditarik jadi satu modul di lib/.

export async function uploadDisplayMedia({ branchId, period, idx, fileList }) {
  const files = Array.from(fileList || []);
  const uploaded = [];
  for (const file of files) {
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) continue;

    let uploadFile = file;
    let ext = file.name.split(".").pop() || (isVideo ? "mp4" : "jpg");
    if (isImage) {
      try {
        const compressed = await compressImage(file, 0.75);
        if (compressed.size < file.size) { uploadFile = compressed; ext = "jpg"; }
      } catch (err) {
        // Kompresi gagal — lanjut pakai berkas asli, jangan sampai gagal total.
      }
    }
    const maxSize = isVideo ? 30 * 1024 * 1024 : 5 * 1024 * 1024;
    if (uploadFile.size > maxSize)
      throw new Error(`Ukuran ${isVideo ? "video" : "foto"} maksimal ${isVideo ? "30MB" : "5MB"}.`);

    const path = `display/${branchId}/${period}/unit-${idx}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const { error: upErr } = await supabase.storage.from("findings")
      .upload(path, uploadFile, { upsert: true, contentType: isImage ? "image/jpeg" : file.type });
    if (upErr) throw upErr;
    const { data: pub } = supabase.storage.from("findings").getPublicUrl(path);
    uploaded.push({ url: pub.publicUrl, type: isVideo ? "video" : "image" });
  }
  return uploaded;
}

// ============================================================
// TAMPILAN
// ============================================================

// ============================================================
// Impor Excel — layar dalam section, bukan modal tersendiri.
// ============================================================

function PanelImpor({ onMasuk, onTutup, cabang, tanggalAcuan }) {
  const [pratinjau, setPratinjau] = useState(null);
  const [galat, setGalat] = useState(null);
  const [sibuk, setSibuk] = useState(false);

  async function olahBerkas(file) {
    setSibuk(true); setGalat(null); setPratinjau(null);
    try {
      const nama = (file.name || "").toLowerCase();
      let matriks;
      if (nama.endsWith(".csv") || nama.endsWith(".txt")) {
        matriks = pecahTeksTabel(await file.text());
      } 
