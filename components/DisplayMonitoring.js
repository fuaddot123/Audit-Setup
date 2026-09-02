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
      } else {
        // Dimuat di sini saja — lihat catatan di kepala berkas.
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        // raw:false supaya tanggal keluar sebagai teks yang sudah
        // diformat; angka serial mentah tetap ditangani tanggalDari().
        matriks = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
      }
      const hasil = olahMatriks(matriks, { cabang, tanggalAcuan });
      if (hasil.galat) setGalat(hasil.galat); else setPratinjau(hasil);
    } catch (err) {
      setGalat("Berkasnya tidak bisa dibaca: " + (err?.message || String(err)));
    } finally {
      setSibuk(false);
    }
  }

  function olahTempelan(teks) {
    setGalat(null);
    if (!teks.trim()) { setPratinjau(null); return; }
    const hasil = olahMatriks(pecahTeksTabel(teks), { cabang, tanggalAcuan });
    if (hasil.galat) { setGalat(hasil.galat); setPratinjau(null); } else setPratinjau(hasil);
  }

  return (
    <div style={{ border: "1px solid var(--border)", background: "var(--surface-alt)", borderRadius: 10, padding: 14, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <b style={{ fontSize: 13 }}>Impor unit display dari Excel</b>
        <button className="btn-ghost" style={{ fontSize: 12 }} onClick={onTutup}>Tutup</button>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.55, marginBottom: 10 }}>
        Dua bentuk berkas dikenali. <b>(a)</b> Laporan monitoring display: kolom
        <b> Nama</b>, <b>SN</b>, <b>Umur Display</b>, <b>Cabang</b> — baris judul boleh ada di
        atasnya, dan tanggal mulai pajang dihitung mundur dari umurnya.
        <b> (b)</b> Susunan sendiri: kolom <b>Brand</b>, <b>Model</b>, <b>Serial</b>,
        <b> Tanggal Pajang</b>. Urutan kolom bebas.
        <br />Kondisi fisik sengaja <b>tidak</b> diimpor — itu hasil pemeriksaan di tempat,
        bukan isi berkas.
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <input type="file" accept=".xlsx,.xls,.csv,.txt" disabled={sibuk}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) olahBerkas(f); e.target.value = ""; }} />
        {sibuk && <span style={{ fontSize: 12, color: "var(--text-faint)" }}>membaca…</span>}
      </div>
      <textarea className="input" rows={3} placeholder="…atau tempel langsung dari Excel (Ctrl+V)"
        style={{ width: "100%", fontSize: 12, marginBottom: 10 }}
        onChange={(e) => olahTempelan(e.target.value)} />

      {galat && (
        <div style={{ fontSize: 12, color: "var(--danger-text)", background: "rgba(163,32,32,.08)", border: "1px solid rgba(163,32,32,.3)", borderRadius: 8, padding: "8px 11px" }}>
          ⚠ {galat}
        </div>
      )}

      {pratinjau && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
            {pratinjau.terbaca} baris terbaca · {pratinjau.rows.length} siap dimasukkan
            {pratinjau.ditolak.length > 0 && <span style={{ color: "var(--danger-text)" }}> · {pratinjau.ditolak.length} ditolak</span>}
          </div>

          {/* Tanggal acuan WAJIB terlihat. Seluruh tanggal mulai pajang
              dihitung mundur dari sini; kalau acuannya salah, semuanya
              meleset serentak dan tidak ada satu pun galat yang muncul. */}
          {pratinjau.acuan && (
            <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 6 }}>
              Umur dihitung dari <b>{pratinjau.acuan}</b>
              {pratinjau.bentuk === "stok-serial" && " (diambil dari judul berkas)"}.
            </div>
          )}

          {/* Brand tidak ada di berkas monitoring display — ia ditebak dari
              nama produk. Batas umur bisa berbeda per brand, jadi tebakan
              yang salah memasang batas yang salah. Harus diperiksa mata. */}
          {pratinjau.bentuk === "stok-serial" && (
            <div style={{ fontSize: 11.5, color: "#b06a12", background: "rgba(176,106,18,.08)", border: "1px solid rgba(176,106,18,.3)", borderRadius: 7, padding: "7px 10px", marginBottom: 8, lineHeight: 1.55 }}>
              Berkas ini tidak memuat kolom Brand. Brand <b>ditebak dari nama produk</b> —
              periksa kolom Brand di bawah sebelum memasukkan, karena batas umur pajang
              bisa berbeda per brand.
              {pratinjau.brandKosong > 0 && (
                <> <b>{pratinjau.brandKosong} unit tidak ketebak</b> dan brand-nya dibiarkan
                kosong — isi sendiri di daftar unit sesudah diimpor.</>
              )}
            </div>
          )}

          {pratinjau.cabangLain && Object.keys(pratinjau.cabangLain).length > 0 && (
            <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 8 }}>
              Baris cabang lain dilewati:{" "}
              {Object.entries(pratinjau.cabangLain).map(([c, n]) => `${c} (${n})`).join(", ")}.
            </div>
          )}
          <div style={{ maxHeight: 190, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
              <thead><tr>
                {["Brand", "Nama / Model", "Serial", "Umur", "Mulai Pajang"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "5px 8px", borderBottom: "1px solid var(--border)", color: "var(--text-faint)", fontWeight: 600 }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {pratinjau.rows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ padding: "4px 8px" }}>
                      {r.brand ? (
                        <span title={r._brandDitebak ? "ditebak dari nama produk" : ""}>
                          {r.brand}{r._brandDitebak && <span style={{ color: "#b06a12" }}> ?</span>}
                        </span>
                      ) : (
                        <span style={{ color: "var(--danger-text)" }}>belum ada</span>
                      )}
                    </td>
                    <td style={{ padding: "4px 8px" }}>{r.model}</td>
                    <td style={{ padding: "4px 8px" }}>{r.serial_number || "-"}</td>
                    <td style={{ padding: "4px 8px" }}>
                      {r._umurDisplay == null ? "-" : `${r._umurDisplay} hr`}
                    </td>
                    <td style={{ padding: "4px 8px" }}>{r.tanggal_pajang}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Baris yang ditolak DITAMPILKAN beserta sebabnya. Yang dibuang
              diam-diam akan dikira tidak pernah ada di berkasnya. */}
          {pratinjau.ditolak.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.6 }}>
              {pratinjau.ditolak.map((d, i) => (
                <div key={i}>Baris {d.baris} — {d.isi}: <b>{d.sebab}</b></div>
              ))}
            </div>
          )}

          <button className="btn" style={{ marginTop: 10, fontSize: 12 }}
            disabled={!pratinjau.rows.length}
            onClick={() => onMasuk(pratinjau.rows)}>
            Masukkan {pratinjau.rows.length} unit ke daftar
          </button>
        </div>
      )}
    </div>
  );
}

export function DisplaySection({
  rows, perlakuanOpsi, kondisiOpsi, canEdit, uploadingIdx,
  onUpdate, onAdd, onRemove, onUploadFoto, onHapusFoto, onImpor,
  cabang, tanggalAudit,
}) {
  const [filter, setFilter] = useState("all"); // "all" | "perhatian" | "belum"
  const [bukaImpor, setBukaImpor] = useState(false);

  const dipajang = rows.filter((r) => !r.turun).length;
  const lewat = rows.filter((r) => !r.turun && r.status_umur === "Lewat Batas").length;
  const mendekati = rows.filter((r) => !r.turun && r.status_umur === "Mendekati Batas").length;
  const belumDicek = rows.filter((r) => !r.kondisi_kode).length;

  const indexed = rows.map((row, i) => ({ row, i }));
  const shown =
    filter === "perhatian"
      ? indexed.filter(({ row }) => row.status_umur !== "Aman" || row.turun)
      : filter === "belum"
      ? indexed.filter(({ row }) => !row.kondisi_kode)
      : indexed;

  // Tandai semua unit yang belum dicek sebagai kondisi terbaik yang tersedia —
  // jawaban untuk "kalau memang masih sama, tinggal duplicate".
  function tandaiSemuaSama() {
    const terbaik = kondisiOpsi[0];
    if (!terbaik) return;
    rows.forEach((r, i) => {
      if (!r.kondisi_kode && !r.turun) onUpdate(i, "kondisi_kode", terbaik.kode);
    });
  }

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>🖥️ Monitoring Display</div>
        {canEdit && (
          <div style={{ display: "flex", gap: 8 }}>
            {belumDicek > 0 && (
              <button className="btn-ghost" onClick={tandaiSemuaSama} style={{ fontSize: 12 }}>
                ✓ Semua masih sama ({belumDicek})
              </button>
            )}
            <button className="btn-ghost" onClick={onAdd} style={{ fontSize: 12 }}>+ Tambah Unit</button>
            {onImpor && (
              <button className="btn-ghost" onClick={() => setBukaImpor((b) => !b)} style={{ fontSize: 12 }}>
                ⬆ Impor Excel
              </button>
            )}
          </div>
        )}
      </div>

      {canEdit && bukaImpor && onImpor && (
        <PanelImpor onTutup={() => setBukaImpor(false)}
          cabang={cabang} tanggalAcuan={tanggalAudit}
          onMasuk={(rows) => { onImpor(rows); setBukaImpor(false); }} />
      )}

      {/* Ringkasan hidup — pola sama dengan ringkasan Stock Opname di atasnya */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 16px", marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
          {dipajang} unit dipajang
          {lewat > 0 && <> &middot; <span style={{ color: WARNA_STATUS["Lewat Batas"] }}>{lewat} lewat batas</span></>}
          {mendekati > 0 && <> &middot; <span style={{ color: WARNA_STATUS["Mendekati Batas"] }}>{mendekati} mendekati</span></>}
          {lewat === 0 && mendekati === 0 && dipajang > 0 && <> &middot; semua dalam batas umur</>}
        </span>
        {rows.length > 0 && (
          <div style={{ display: "flex", gap: 4, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 3 }}>
            <FilterBtn aktif={filter === "all"} onClick={() => setFilter("all")} warna="#7c3aed">Semua ({rows.length})</FilterBtn>
            {(lewat + mendekati) > 0 && (
              <FilterBtn aktif={filter === "perhatian"} onClick={() => setFilter("perhatian")} warna="#a32020">Perlu perhatian ({lewat + mendekati})</FilterBtn>
            )}
            {belumDicek > 0 && (
              <FilterBtn aktif={filter === "belum"} onClick={() => setFilter("belum")} warna="#d98324">Belum dicek ({belumDicek})</FilterBtn>
            )}
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
          Belum ada unit display tercatat di cabang ini. Klik &ldquo;+ Tambah Unit&rdquo; untuk mendaftarkan yang pertama.
          Bulan depan daftarnya muncul sendiri &mdash; tidak perlu diketik ulang.
        </div>
      ) : shown.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Tidak ada unit yang cocok dengan saringan ini.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {shown.map(({ row, i }) => (
            <KartuUnit
              key={row.id || `baru-${i}`}
              row={row}
              idx={i}
              canEdit={canEdit}
              kondisiOpsi={kondisiOpsi}
              perlakuanOpsi={perlakuanOpsi}
              mengunggah={uploadingIdx === i}
              onUpdate={onUpdate}
              onRemove={onRemove}
              onUploadFoto={onUploadFoto}
              onHapusFoto={onHapusFoto}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterBtn({ aktif, onClick, warna, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ border: "none", background: aktif ? warna : "transparent", color: aktif ? "#fff" : "var(--text-secondary)", fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 6, cursor: "pointer" }}
    >
      {children}
    </button>
  );
}

function KartuUnit({ row, idx, canEdit, kondisiOpsi, perlakuanOpsi, mengunggah, onUpdate, onRemove, onUploadFoto, onHapusFoto }) {
  const umur = row.baru ? hitungUmurHari(row.tanggal_pajang) : row.umur_hari;
  const warna = row.turun ? "#888" : warnaStatus(row.status_umur);
  const sisa = row.batas_hari == null ? null : row.batas_hari - umur;

  return (
    <div style={{ background: "var(--surface-alt)", padding: "12px 12px 12px 14px", borderRadius: 10, borderLeft: `3px solid ${warna}` }}>

      {/* Baris identitas unit */}
      {row.baru ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 1fr auto", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <input className="input" placeholder="Brand *" value={row.brand} disabled={!canEdit}
            onChange={(e) => onUpdate(idx, "brand", e.target.value)} style={{ fontSize: 12.5 }} />
          <input className="input" placeholder="Model *" value={row.model} disabled={!canEdit}
            onChange={(e) => onUpdate(idx, "model", e.target.value)} style={{ fontSize: 12.5 }} />
          <input className="input" placeholder="Serial Number" value={row.serial_number} disabled={!canEdit}
            onChange={(e) => onUpdate(idx, "serial_number", e.target.value)} style={{ fontSize: 12.5 }} />
          {canEdit && (
            <span onClick={() => onRemove(idx)} title="Hapus baris"
              style={{ cursor: "pointer", color: "var(--danger-text)", fontSize: 18, textAlign: "center" }}>&times;</span>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          <div>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>{row.brand} {row.model}</span>
            {row.serial_number && (
              <span style={{ fontSize: 11, color: "var(--text-faint)", marginLeft: 8 }}>SN {row.serial_number}</span>
            )}
            {row.program_brand && (
              <span style={{ fontSize: 10.5, fontWeight: 700, marginLeft: 8, padding: "2px 8px", borderRadius: 20, background: "#7c3aed22", color: "#7c3aed" }}>
                Program {row.program_nama}
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "var(--text-faint)" }}>pajang {row.tanggal_pajang}</span>
            <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 20, background: `${warna}22`, color: warna }}>
              {umur} hari
              {row.batas_hari != null && ` / ${row.batas_hari}`}
              {sisa != null && sisa < 0 && ` · lewat ${Math.abs(sisa)} hari`}
            </span>
          </div>
        </div>
      )}

      {/* Baris tambahan khusus unit baru: tanggal pajang, SKU, program */}
      {row.baru && (
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto 1.4fr", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>Mulai pajang</span>
          <input className="input" type="date" value={row.tanggal_pajang} disabled={!canEdit}
            onChange={(e) => onUpdate(idx, "tanggal_pajang", e.target.value)} style={{ fontSize: 12.5 }} />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)", cursor: canEdit ? "pointer" : "default", whiteSpace: "nowrap" }}>
            <input type="checkbox" checked={row.program_brand} disabled={!canEdit}
              onChange={(e) => onUpdate(idx, "program_brand", e.target.checked)} />
            Program brand
          </label>
          <input className="input" placeholder={row.program_brand ? "Nama program *" : "Nama program"}
            value={row.program_nama} disabled={!canEdit || !row.program_brand}
            onChange={(e) => onUpdate(idx, "program_nama", e.target.value)} style={{ fontSize: 12.5 }} />
        </div>
      )}

      {/* Kondisi fisik kunjungan ini */}
      {!row.turun && (
        <div style={{ display: "grid", gridTemplateColumns: "auto 1.2fr 1.6fr auto", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11.5, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>Kondisi</span>
          <select className="input" value={row.kondisi_kode} disabled={!canEdit}
            onChange={(e) => onUpdate(idx, "kondisi_kode", e.target.value)} style={{ fontSize: 12.5 }}>
            <option value="">— belum dicek —</option>
            {kondisiOpsi.map((k) => <option key={k.kode} value={k.kode}>{k.label}</option>)}
            <option value={OPSI_BARU}>+ Kondisi lain…</option>
          </select>
          <input className="input" placeholder="Catatan kondisi" value={row.kondisi_catatan} disabled={!canEdit}
            onChange={(e) => onUpdate(idx, "kondisi_catatan", e.target.value)} style={{ fontSize: 12.5 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {canEdit && (
              <label className="btn-ghost" style={{ fontSize: 11.5, cursor: "pointer", whiteSpace: "nowrap" }}>
                {mengunggah ? "Mengunggah…" : "📷 Foto"}
                <input type="file" accept="image/*,video/*" multiple hidden disabled={mengunggah}
                  onChange={(e) => { onUploadFoto(idx, e.target.files); e.target.value = ""; }} />
              </label>
            )}
            {canEdit && (
              <button type="button" className="btn-ghost" onClick={() => onUpdate(idx, "turun", true)}
                style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>
                ↓ Turunkan
              </button>
            )}
          </div>
        </div>
      )}

      {/* Kondisi baru — muncul kalau auditor memilih "+ Kondisi lain…" */}
      {!row.turun && row.kondisi_kode === OPSI_BARU && (
        <div style={{ marginTop: 8, padding: "10px 12px", background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 9 }}>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1.6fr auto 1.4fr", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 11.5, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>Kondisi baru</span>
            <input className="input" placeholder="Tulis kondisinya, mis. Engsel longgar" value={row.kondisi_baru_label}
              disabled={!canEdit} onChange={(e) => onUpdate(idx, "kondisi_baru_label", e.target.value)} style={{ fontSize: 12.5 }} />
            <span style={{ fontSize: 11.5, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>Setara dengan</span>
            <select className="input" value={row.kondisi_baru_setara} disabled={!canEdit}
              onChange={(e) => onUpdate(idx, "kondisi_baru_setara", e.target.value)} style={{ fontSize: 12.5 }}>
              <option value="">— pilih tingkat —</option>
              {kondisiOpsi.map((k) => <option key={k.kode} value={k.kode}>{k.label}</option>)}
            </select>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 7, lineHeight: 1.5 }}>
            Istilah ini otomatis masuk daftar pilihan setelah disimpan, jadi audit berikutnya
            tinggal memilihnya. <b>Setara dengan</b> menentukan nilainya dalam hitungan skor —
            tanpa itu unit ini tidak ikut dihitung.
          </div>
        </div>
      )}

      {/* Foto temuan */}
      {row.photos.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {row.photos.map((m, mi) => (
            <div key={mi} style={{ position: "relative" }}>
              {m.type === "video" ? (
                <video src={m.url} style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 6 }} />
              ) : (
                <img src={m.url} alt="" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 6 }} />
              )}
              {canEdit && (
                <span onClick={() => onHapusFoto(idx, mi)}
                  style={{ position: "absolute", top: -6, right: -6, background: "var(--danger-text)", color: "#fff", width: 18, height: 18, borderRadius: "50%", fontSize: 12, lineHeight: "18px", textAlign: "center", cursor: "pointer" }}>&times;</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Perlakuan pasca display — muncul begitu unit ditandai turun */}
      {row.turun && (
        <div style={{ marginTop: 8, paddingTop: 10, borderTop: "1px dashed var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)" }}>Perlakuan pasca display</span>
            {canEdit && row.masih_dipajang && (
              <button type="button" className="btn-ghost" onClick={() => onUpdate(idx, "turun", false)} style={{ fontSize: 11.5 }}>
                Batal turunkan
              </button>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1.6fr", gap: 8, alignItems: "center" }}>
            <select className="input" value={row.perlakuan_kode} disabled={!canEdit}
              onChange={(e) => onUpdate(idx, "perlakuan_kode", e.target.value)} style={{ fontSize: 12.5 }}>
              <option value="">— pilih perlakuan * —</option>
              {perlakuanOpsi.map((p) => <option key={p.kode} value={p.kode}>{p.label}</option>)}
              <option value={OPSI_BARU}>+ Perlakuan lain…</option>
            </select>
            <input className="input" type="text" inputMode="numeric" placeholder="Harga jual display"
              value={row.harga_jual_display} disabled={!canEdit || row.perlakuan_kode !== "dijual_display"}
              onChange={(e) => onUpdate(idx, "harga_jual_display", e.target.value.replace(/[^\d]/g, ""))}
              style={{ fontSize: 12.5 }} />
            <input className="input" placeholder="Catatan perlakuan" value={row.perlakuan_catatan} disabled={!canEdit}
              onChange={(e) => onUpdate(idx, "perlakuan_catatan", e.target.value)} style={{ fontSize: 12.5 }} />
          </div>
          {row.perlakuan_kode === OPSI_BARU && (
            <div style={{ marginTop: 8, padding: "10px 12px", background: "var(--surface)", border: "1px dashed var(--border)", borderRadius: 9 }}>
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 11.5, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>Perlakuan baru</span>
                <input className="input" placeholder="Tulis perlakuannya, mis. Dipinjamkan ke pameran" value={row.perlakuan_baru_label}
                  disabled={!canEdit} onChange={(e) => onUpdate(idx, "perlakuan_baru_label", e.target.value)} style={{ fontSize: 12.5 }} />
              </div>
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 7 }}>
                Otomatis masuk daftar pilihan setelah disimpan.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
