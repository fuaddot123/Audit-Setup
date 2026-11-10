import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { sortBranches } from "../lib/branchOrder";
import { nowPeriode, periodeLabel, addMonthsToPeriod } from "../lib/sopConfig";

// ============================================================
// ANALISIS TOKO
//
// Pembantu analisis untuk SATU cabang yang dikunjungi, satu periode.
// Prinsipnya (disepakati): aplikasi hanya menyiapkan dan menyimpan —
// kesimpulan selalu ditulis dan dikonfirmasi auditor. Tidak ada skor,
// peringkat, atau label otomatis.
//
// Penyimpanan: audit_generic, module = "analisis_toko".
// Struktur tabel TIDAK diubah. Kalau database membatasi nilai kolom
// `module` (CHECK constraint), nilai "analisis_toko" perlu ditambahkan.
//
// Privasi: modul ini berisi catatan tentang orang. Auditor hanya membaca
// catatannya sendiri (submitted_by), dan jawaban wawancara dicatat dengan
// KODE ("Leader", "Sales A"), bukan nama. Isinya tidak masuk ke Berita
// Acara. Pagar sungguhannya tetap di RLS.
// ============================================================

const MODULE = "analisis_toko";

// ------------------------------------------------------------
// Isi panduan & bank pertanyaan. Diedit di sini kalau ada perubahan —
// id pertanyaan JANGAN diubah, karena jawaban yang tersimpan memakainya.
// ------------------------------------------------------------

export const JENIS = {
  bulanan: { label: "Analisis rutin", hint: "Membaca kondisi toko secara menyeluruh pada kunjungan ini." },
  pendalaman: { label: "Pendalaman masalah", hint: "Menggali satu pola yang menonjol (temuan berulang, selisih, dsb.)." },
  tiru_acuan: { label: "Menularkan kebiasaan acuan", hint: "Belajar dari cabang acuan, lalu mencoba menerapkannya di cabang ini." },
};

export const ASPEK = [
  "Stok", "Selisih barang", "Kas kecil", "Kepatuhan SOP", "Inventaris / aset", "Display", "KPI",
  "Tindak lanjut temuan", "Proses harian", "Store leader", "Tim", "Konteks toko",
];

export const SUMBER = ["Data KLA Radar", "Pengamatan", "Wawancara", "Info dari bos", "Dokumen"];

export const PERTANYAAN_PEMANTIK = [
  { id: "p1", teks: "Apa yang berubah di toko ini dalam 3 bulan terakhir?" },
  { id: "p2", teks: "Di bagian mana toko ini paling berbeda dari toko lain yang mirip?" },
  { id: "p3", teks: "Kalau satu orang atau satu hal hilang dari toko ini, apa yang paling mudah rusak?" },
];

export const PEMBUKA =
  "Aku datang bukan untuk mencari kesalahan. Aku ingin tahu bagaimana toko ini berjalan, apa yang menyulitkan, dan apa yang bisa dibantu dari pusat.";

export const PERTANYAAN = {
  leader: [
    { id: "L1", kel: "Gambaran umum", inti: true, teks: "Bagaimana kondisi toko bulan ini menurutmu? Apa yang berjalan baik, dan apa yang belum?" },
    { id: "L2", kel: "Gambaran umum", teks: "Kalau harus menyebut satu hal yang paling menyita waktumu, apa itu?" },
    { id: "L3", kel: "Kendala", inti: true, teks: "Apa kendala terbesar yang kamu hadapi sekarang?" },
    { id: "L4", kel: "Kendala", teks: "Ada hal yang sudah kamu laporkan ke pusat tapi belum ditanggapi?" },
    { id: "L5", kel: "Kendala", teks: "Ada hal di luar kendalimu yang mempengaruhi hasil toko? (alat, jumlah staf, kebijakan, pasokan)" },
    { id: "L6", kel: "Tim", inti: true, teks: "Bagaimana kondisi tim sekarang? Siapa yang paling bisa diandalkan, dan bagaimana kalau orang itu libur?" },
    { id: "L7", kel: "Tim", teks: "Ada anggota tim yang kesulitan menjalankan tugasnya? Apa yang menurutmu menyulitkannya?" },
    { id: "L8", kel: "Tim", teks: "Bagaimana anggota baru belajar cara kerja di sini?" },
    { id: "L9", kel: "Rutinitas dan stok", teks: "Ceritakan satu hari kerja biasa, dari buka sampai tutup." },
    { id: "L10", kel: "Rutinitas dan stok", inti: true, teks: "Terakhir kali ada selisih stok atau barang tidak cocok dengan sistem, apa yang terjadi? Bagaimana tahu dan menanganinya?" },
    { id: "L11", kel: "Tindak lanjut audit", inti: true, teks: "Dari hasil audit bulan lalu, apa yang sudah dikerjakan dan apa yang belum? Apa yang menghambat?" },
    { id: "L12", kel: "Penutup", inti: true, teks: "Apa yang ingin kamu sampaikan ke pusat atau ke tim audit?" },
    { id: "L13", kel: "Penutup", teks: "Kalau satu hal bisa diubah bulan depan, apa itu?" },
  ],
  sales: [
    { id: "S1", kel: "Pembuka", teks: "Sudah berapa lama di sini, dan tugas harianmu apa?" },
    { id: "S2", kel: "Kendala", inti: true, teks: "Apa yang paling menyulitkan dalam pekerjaanmu minggu ini?" },
    { id: "S3", kel: "Stok", inti: true, teks: "Kalau barang masuk, apa yang kamu lakukan pertama kali? Siapa yang mencatat dan kapan?" },
    { id: "S4", kel: "Stok", inti: true, teks: "Kalau barang di rak tidak sama dengan sistem, biasanya bagaimana?" },
    { id: "S5", kel: "SOP", inti: true, teks: "Ada bagian SOP yang sulit dijalankan atau tidak jelas? Yang mana?" },
    { id: "S6", kel: "Dukungan", inti: true, teks: "Kalau ada kesulitan, kamu biasanya tanya ke siapa?" },
    { id: "S7", kel: "Fasilitas", teks: "Ada alat atau fasilitas yang sering bermasalah?" },
    { id: "S8", kel: "Penutup", inti: true, teks: "Kalau kamu bisa mengubah satu hal di toko ini, apa itu?" },
  ],
  // Khusus kunjungan ke cabang acuan (jenis "Menularkan kebiasaan acuan").
  acuan: [
    { id: "A1", kel: "Kebiasaan acuan", inti: true, teks: "Apa yang kalian lakukan setiap hari supaya stok tetap sesuai?" },
    { id: "A2", kel: "Kebiasaan acuan", inti: true, teks: "Kalau ada selisih, apa yang terjadi pertama kali?" },
    { id: "A3", kel: "Kebiasaan acuan", inti: true, teks: "Kalau ada anggota baru, bagaimana mereka diajari cara kerja di sini?" },
    { id: "A4", kel: "Kebiasaan acuan", inti: true, teks: "Apa yang berubah dan apa yang tetap setelah leader diganti?" },
    { id: "A5", kel: "Kebiasaan acuan", inti: true, teks: "Kebiasaan mana yang kalau dihentikan, toko ini akan cepat kacau?" },
    { id: "A6", kel: "Serah terima leader", teks: "(Leader) Apa yang diwariskan saat serah terima, dan apa yang kamu pertahankan? Kenapa?" },
  ],
};

export const PERTANYAAN_LANJUTAN = [
  "Boleh ceritakan contohnya?",
  "Terakhir kali itu terjadi kapan?",
  "Terus apa yang kamu lakukan?",
  "Menurutmu kenapa bisa begitu?",
  "Sudah pernah disampaikan ke siapa?",
];

// Hal yang DIAMATI sebelum bertanya. Tombolnya menambah baris fakta bersumber "Pengamatan".
export const DIAMATI = [
  "Kondisi toko saat tiba (sebelum orang tahu auditor datang, kalau memungkinkan)",
  "Ada briefing atau pembagian tugas? Siapa yang memimpin, berapa lama",
  "Cara barang masuk dicatat dan kapan",
  "Cara serah terima kas atau barang antar shift",
  "Cara tim menangani selisih atau kesalahan kecil",
  "Hal yang dijalankan tim tanpa ada yang mengingatkan",
  "Barang tidak pada tempatnya, label hilang, tinta/toner kedaluwarsa",
];

export const TEMA_UMUM = [
  "Pencatatan stok", "Alat / fasilitas", "Jumlah staf", "SOP tidak jelas", "Komunikasi dengan pusat",
  "Pelatihan anggota baru", "Serah terima", "Beban kerja", "Tindak lanjut temuan", "Penataan gudang / display",
];

export const CONTOH_HIPOTESIS = [
  ["Sales bilang pencatatan barang dilakukan sore hari", "Mismatch stok terjadi karena pencatatan tertunda", "Bandingkan jam barang masuk dengan jam diinput; cek temuan mismatch"],
  ["Leader sudah lapor alat rusak tapi belum ditanggapi", "Temuan inventaris berulang karena tidak ada tindak lanjut dari pusat", "Cek riwayat temuan alat itu; tanyakan ke pusat"],
  ["Cerita sales berbeda-beda soal SOP", "SOP tidak dipahami seragam", "Tanyakan SOP yang sama ke beberapa orang"],
  ["Leader tidak bisa menjelaskan selisih bulan lalu", "Pemantauan stok oleh leader lemah", "Lihat cara leader mengecek stok harian"],
  ["Semua bilang aman, tapi data berulang", "Jawaban terlalu hati-hati, atau toko dibereskan menjelang audit", "Amati kondisi toko; bandingkan dengan temuan"],
];

export const OPSI_TIRU = [
  ["ya", "Ya, kebiasaan"],
  ["pendampingan", "Perlu pendampingan"],
  ["konteks", "Tidak, konteks"],
  ["belum", "Belum tahu"],
];

export const STATUS_HIPOTESIS = [
  ["belum", "Belum diuji"],
  ["didukung", "Didukung"],
  ["gugur", "Gugur"],
];

// Langkah-langkah (dipakai untuk stepper & tab Panduan)
export const LANGKAH = [
  { id: "persiapan", label: "1. Persiapan", ringkas: "Pahami profil toko dan baca riwayat datanya sebelum berangkat." },
  { id: "fakta", label: "2. Fakta", ringkas: "Catat yang diketahui dan diamati. Pisahkan fakta dari dugaan." },
  { id: "wawancara", label: "3. Wawancara", ringkas: "Tanya leader dan sales dengan pertanyaan terbuka. Catat dengan kode, bukan nama." },
  { id: "hipotesis", label: "4. Hipotesis", ringkas: "Dari jawaban yang berulang atau berbeda dengan data, rumuskan dugaan penyebab." },
  { id: "rencana", label: "5. Uji & rencana", ringkas: "Tentukan cara menguji dugaan, dan kebiasaan yang akan dicoba." },
  { id: "kesimpulan", label: "6. Kesimpulan", ringkas: "Tulis kesimpulan, tingkat keyakinan, dan yang diminta dari bos." },
  { id: "ringkasan", label: "7. Ringkasan", ringkas: "Susun ringkasan untuk bos. Hanya yang sudah dikonfirmasi auditor." },
];

export const POLA_PIKIR = [
  ["Dari mencari salah ke memahami toko", "Temuan itu gejala. Yang dicari adalah kenapa toko berperilaku begitu."],
  ["Tiga sumber, satu kesimpulan", "Angka, pengamatan, dan cerita orang masing-masing bisa menipu. Kesimpulan yang kuat didukung minimal dua sumber; satu sumber saja ditandai dugaan."],
  ["Mulai dari hipotesis", "Lihat data dulu, rumuskan dugaan, lalu pilih pertanyaan untuk mengujinya. Daftar pertanyaan di sini adalah bank, bukan formulir yang ditanyakan semua."],
  ["Konteks dulu sebelum menilai", "Toko baru, leader baru, renovasi, musim ramai, dan jumlah staf mengubah makna angka yang sama."],
  ["Tren, bukan satu bulan", "Satu bulan jelek bisa kebetulan. Tiga bulan turun berturut-turut adalah pola."],
  ["Adil ke orang", "Tulis apa yang terlihat (\"serah terima kas tidak dicatat\"), bukan watak (\"leader ceroboh\")."],
];

export const EMPAT_LAPIS = [
  ["Hasil", "Seberapa baik kondisinya?", "skor data, selisih, Service Ratio"],
  ["Proses", "Bagaimana pekerjaan dijalankan?", "SOP, kebiasaan toko, temuan berulang"],
  ["Orang", "Siapa yang menggerakkan?", "observasi leader, wawancara tim"],
  ["Konteks", "Apa yang mempengaruhi?", "usia toko, ukuran, perubahan tim, lokasi"],
];

export const STANDAR = [
  "Dua tingkat kepastian: Fakta (ada bukti atau data) dan Dugaan (kesimpulan auditor). Selalu diberi label.",
  "Minimal dua sumber sebelum menyimpulkan sesuatu tentang orang. 'Kata bos' menghitung satu sumber.",
  "Wawancara dicatat dengan kode (Leader, Sales A, Sales B), bukan nama. Jangan menjanjikan kerahasiaan yang tidak bisa dijaga.",
  "Satu rekomendasi per kesimpulan, dengan ukuran berhasil yang ditetapkan SEBELUM penerapan.",
  "Tulis juga apa yang tidak diketahui dan batas bukti (jumlah kunjungan, siapa yang sempat diwawancarai).",
  "Tidak ada skor atau peringkat otomatis. Yang masuk PPT hanya hasil yang sudah dikonfirmasi auditor.",
  "Tanyakan kejadian, bukan opini: 'ceritakan terakhir kali ada selisih' lebih jujur daripada 'apakah kamu patuh SOP?'.",
  "Jangan tanya 'siapa yang salah'. Tanyakan 'bagaimana prosesnya'.",
];

export const SUMBER_HIPOTESIS = [
  ["Perubahan", "Apa yang berubah baru-baru ini? Leader/staf baru, renovasi, SOP atau sistem baru."],
  ["Perbandingan antar toko", "Kenapa toko A stabil sedangkan toko B yang mirip tidak?"],
  ["Hal yang tidak ada di data", "Toko tanpa temuan sama sekali, bulan kosong, skor yang selalu sama persis."],
  ["Alur kerja harian", "Dari barang masuk sampai terjual dan kas disetor, di mana yang paling rawan?"],
  ["Beda dua sumber", "Di mana cerita dan data tidak cocok?"],
  ["Pertanyaan bos", "Apa yang bos tanyakan atau ingin tahu tentang toko ini?"],
  ["Hal yang positif", "Kenapa toko ini baik, dan apa yang bisa ditiru?"],
];

// ------------------------------------------------------------
// Struktur data & fungsi murni (bisa diuji tanpa React/Supabase)
// ------------------------------------------------------------

function uid() {
  return (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function freshAnalisis() {
  return {
    jenis: "bulanan",
    tanggal: "",
    konteks: { leader: "", leaderSejak: "", usiaToko: "", ukuran: "", jumlahStaf: "", perubahan: "" },
    acuanId: "",
    acuanCatatan: "Ditetapkan oleh bos sebagai cabang acuan.",
    pemantik: { p1: "", p2: "", p3: "" },
    fakta: [],
    pola: "",
    wawancara: [],
    hipotesis: [],
    kebiasaan: [],
    rencana: { dipilih: "", pendamping: "", durasi: "", ukuran: "" },
    kesimpulan: "",
    keyakinan: "dugaan",
    diminta: "",
    belumDiketahui: [],
    dikonfirmasi: false,
  };
}

// Menggabungkan data tersimpan dengan bentuk terbaru supaya field baru
// tidak membuat data lama error.
export function normalizeAnalisis(raw) {
  const f = freshAnalisis();
  if (!raw || typeof raw !== "object") return f;
  return {
    ...f,
    ...raw,
    konteks: { ...f.konteks, ...(raw.konteks || {}) },
    pemantik: { ...f.pemantik, ...(raw.pemantik || {}) },
    rencana: { ...f.rencana, ...(raw.rencana || {}) },
    fakta: Array.isArray(raw.fakta) ? raw.fakta : [],
    wawancara: Array.isArray(raw.wawancara) ? raw.wawancara : [],
    hipotesis: Array.isArray(raw.hipotesis) ? raw.hipotesis : [],
    kebiasaan: Array.isArray(raw.kebiasaan) ? raw.kebiasaan : [],
    belumDiketahui: Array.isArray(raw.belumDiketahui) ? raw.belumDiketahui : [],
  };
}

// Kode pewawancara: "Leader", "Leader 2", "Sales A", "Sales B", ...
export function kodeBerikut(wawancara, peran) {
  const sama = (wawancara || []).filter((w) => w.peran === peran).length;
  if (peran === "leader") return sama === 0 ? "Leader" : `Leader ${sama + 1}`;
  return `Sales ${String.fromCharCode(65 + (sama % 26))}${sama >= 26 ? Math.floor(sama / 26) + 1 : ""}`;
}

// Tema dari jawaban wawancara. Menghitung berapa ORANG BERBEDA yang
// menyebut tiap tema — tema yang disebut lebih dari satu orang adalah
// bahan hipotesis yang paling kuat.
export function hitungTema(wawancara) {
  const peta = new Map();
  (wawancara || []).forEach((w) => {
    Object.entries(w.jawaban || {}).forEach(([qid, j]) => {
      const nama = String(j?.tema || "").trim();
      if (!nama) return;
      const key = nama.toLowerCase();
      if (!peta.has(key)) peta.set(key, { tema: nama, orang: new Set(), kutipan: [] });
      const e = peta.get(key);
      e.orang.add(w.id);
      if (j.teks && j.teks.trim()) e.kutipan.push({ kode: w.kode, qid, teks: j.teks.trim() });
    });
  });
  return [...peta.values()]
    .map((e) => ({ tema: e.tema, orang: e.orang.size, kutipan: e.kutipan }))
    .sort((a, b) => b.orang - a.orang || a.tema.localeCompare(b.tema));
}

export function bankPertanyaan(jenis, peran, versi) {
  const dasar = peran === "leader" ? PERTANYAAN.leader : PERTANYAAN.sales;
  const semua = jenis === "tiru_acuan" ? [...PERTANYAAN.acuan.filter((q) => peran === "leader" || q.id !== "A6"), ...dasar] : dasar;
  return versi === "inti" ? semua.filter((q) => q.inti) : semua;
}

const LABEL_KEYAKINAN = { fakta: "Fakta", dugaan: "Dugaan" };

// Teks ringkasan untuk bos. Jawaban mentah dan kode wawancara TIDAK ikut —
// hanya tema yang disebut lebih dari satu orang dan jumlah orangnya.
export function buatRingkasan({ data, namaCabang, periode, namaAcuan }) {
  const d = normalizeAnalisis(data);
  const L = [];
  L.push(`ANALISIS TOKO — ${namaCabang} (${periode})`);
  L.push(`Jenis: ${JENIS[d.jenis]?.label || d.jenis}`);
  if (namaAcuan) L.push(`Cabang acuan: ${namaAcuan}${d.acuanCatatan ? ` (${d.acuanCatatan})` : ""}`);

  const k = d.konteks;
  const kons = [
    k.leader && `leader ${k.leader}${k.leaderSejak ? ` (sejak ${k.leaderSejak})` : ""}`,
    k.usiaToko && `usia toko ${k.usiaToko}`,
    k.ukuran && `ukuran ${k.ukuran}`,
    k.jumlahStaf && `${k.jumlahStaf} staf`,
    k.perubahan && `perubahan terakhir: ${k.perubahan}`,
  ].filter(Boolean);
  if (kons.length) L.push(`Konteks: ${kons.join("; ")}`);

  const fakta = d.fakta.filter((f) => f.isi && f.isi.trim());
  const barisFakta = (f) => `- [${f.aspek}] ${f.isi.trim()} (${f.sumber})${f.menonjol ? " *menonjol*" : ""}`;
  const f1 = fakta.filter((f) => f.kepastian !== "dugaan");
  const f2 = fakta.filter((f) => f.kepastian === "dugaan");
  if (f1.length) { L.push("", "YANG DIKETAHUI (FAKTA)"); f1.forEach((f) => L.push(barisFakta(f))); }
  if (f2.length) { L.push("", "DUGAAN AWAL"); f2.forEach((f) => L.push(barisFakta(f))); }
  if (d.pola.trim()) L.push("", "POLA / YANG MENARIK", d.pola.trim());

  const orang = d.wawancara.filter((w) => Object.values(w.jawaban || {}).some((j) => j?.teks && j.teks.trim()));
  const tema = hitungTema(d.wawancara).filter((t) => t.orang >= 2);
  if (tema.length) {
    L.push("", "TEMA YANG DISEBUT LEBIH DARI SATU ORANG");
    tema.forEach((t) => L.push(`- ${t.tema} (${t.orang} orang)`));
  }

  const hip = d.hipotesis.filter((h) => h.teks && h.teks.trim());
  if (hip.length) {
    L.push("", "HIPOTESIS DAN HASIL UJI");
    const lbl = Object.fromEntries(STATUS_HIPOTESIS);
    hip.forEach((h, i) => {
      L.push(`${i + 1}. ${h.teks.trim()} — ${lbl[h.status] || h.status}`);
      if (h.bukti && h.bukti.trim()) L.push(`   Bukti: ${h.bukti.trim()}`);
    });
  }

  const keb = d.kebiasaan.filter((x) => x.kebiasaan && x.kebiasaan.trim());
  if (keb.length) {
    const lbl = Object.fromEntries(OPSI_TIRU);
    L.push("", "KEBIASAAN YANG DIBANDINGKAN");
    keb.forEach((x) => L.push(`- ${x.kebiasaan.trim()}: acuan "${(x.diAcuan || "-").trim()}", cabang ini "${(x.diCabang || "-").trim()}" → ${lbl[x.bisaDitiru] || "-"}`));
  }

  const r = d.rencana;
  if (r.dipilih.trim() || r.ukuran.trim()) {
    L.push("", "RENCANA UJI");
    if (r.dipilih.trim()) L.push(`Kebiasaan yang dicoba: ${r.dipilih.trim()}`);
    if (r.pendamping.trim()) L.push(`Pendamping: ${r.pendamping.trim()}`);
    if (String(r.durasi).trim()) L.push(`Durasi: ${String(r.durasi).trim()} minggu`);
    if (r.ukuran.trim()) L.push(`Ukuran berhasil: ${r.ukuran.trim()}`);
  }

  if (d.kesimpulan.trim()) L.push("", `KESIMPULAN (${LABEL_KEYAKINAN[d.keyakinan] || "Dugaan"})`, d.kesimpulan.trim());
  if (d.diminta.trim()) L.push("", "YANG DIMINTA DARI BOS", d.diminta.trim());

  const belum = d.belumDiketahui.filter((x) => x && x.trim());
  if (belum.length) { L.push("", "BELUM DIKETAHUI"); belum.forEach((x) => L.push(`- ${x.trim()}`)); }

  const lead = orang.filter((w) => w.peran === "leader").length;
  const sales = orang.filter((w) => w.peran === "sales").length;
  L.push("", `BATAS BUKTI: 1 kunjungan; diwawancarai ${lead} leader dan ${sales} sales.${d.dikonfirmasi ? "" : " Belum dikonfirmasi auditor."}`);
  return L.join("\n");
}

// ------------------------------------------------------------
// Komponen kecil
// ------------------------------------------------------------

const lbl = { display: "block", fontSize: 11, color: "var(--text-secondary)", marginBottom: 3 };
const kartu = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", marginBottom: 12 };
const judulKartu = { fontWeight: 600, fontSize: 13.5, marginBottom: 8 };
const kecil = { fontSize: 12, color: "var(--text-secondary)" };

function Field({ label, children, style }) {
  return (
    <div style={style}>
      <label style={lbl}>{label}</label>
      {children}
    </div>
  );
}

function Teks({ value, onChange, disabled, placeholder, rows }) {
  return rows ? (
    <textarea className="input" rows={rows} value={value || ""} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={{ resize: "vertical" }} />
  ) : (
    <input className="input" value={value || ""} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  );
}

function Pilih({ value, onChange, disabled, opsi }) {
  return (
    <select className="input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {opsi.map((o) => (Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{o}</option>))}
    </select>
  );
}

// ------------------------------------------------------------
// Tab Panduan (tanpa perlu memilih cabang)
// ------------------------------------------------------------

function Panduan() {
  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <div style={kartu}>
        <div style={judulKartu}>Gambaran singkat</div>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          Kamu mengunjungi satu cabang, lalu mencari tahu <b>kenapa</b> toko itu berjalan seperti sekarang. Aplikasi hanya membantu menyiapkan bahan dan menyimpan catatan;
          <b> kesimpulan selalu ditulis dan dikonfirmasi oleh auditor</b>. Tidak ada skor atau peringkat otomatis.
        </div>
      </div>

      <div style={kartu}>
        <div style={judulKartu}>Alur 7 langkah</div>
        {LANGKAH.map((l) => (
          <div key={l.id} style={{ display: "flex", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
            <div style={{ fontWeight: 600, minWidth: 130 }}>{l.label}</div>
            <div style={{ color: "var(--text-secondary)" }}>{l.ringkas}</div>
          </div>
        ))}
      </div>

      <div style={kartu}>
        <div style={judulKartu}>Pola pikir</div>
        {POLA_PIKIR.map(([a, b]) => (
          <div key={a} style={{ marginBottom: 8, fontSize: 13 }}><b>{a}.</b> <span style={{ color: "var(--text-secondary)" }}>{b}</span></div>
        ))}
      </div>

      <div style={kartu}>
        <div style={judulKartu}>Empat lapis untuk membaca satu toko</div>
        {EMPAT_LAPIS.map(([a, b, c]) => (
          <div key={a} style={{ display: "flex", gap: 10, padding: "5px 0", fontSize: 13 }}>
            <div style={{ fontWeight: 600, minWidth: 70 }}>{a}</div>
            <div style={{ flex: 1 }}>{b}</div>
            <div style={{ flex: 1, color: "var(--text-secondary)" }}>{c}</div>
          </div>
        ))}
      </div>

      <div style={kartu}>
        <div style={judulKartu}>Dari mana hipotesis datang (selain temuan)</div>
        {SUMBER_HIPOTESIS.map(([a, b]) => (
          <div key={a} style={{ marginBottom: 6, fontSize: 13 }}><b>{a}:</b> <span style={{ color: "var(--text-secondary)" }}>{b}</span></div>
        ))}
        <div style={{ ...kecil, marginTop: 8 }}>Kalau masih bingung, jawab tiga pertanyaan pemantik di langkah 1 untuk satu toko, lalu pilih jawaban yang paling menarik.</div>
      </div>

      <div style={kartu}>
        <div style={judulKartu}>Contoh: dari yang didengar ke hipotesis</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>{["Yang kamu dengar", "Hipotesis yang bisa digali", "Cara menguji"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border)", color: "var(--text-secondary)", fontWeight: 600 }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {CONTOH_HIPOTESIS.map((r) => (
                <tr key={r[0]}>{r.map((c, i) => <td key={i} style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", verticalAlign: "top" }}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={kartu}>
        <div style={judulKartu}>Standar analisis</div>
        {STANDAR.map((s) => <div key={s} style={{ fontSize: 13, marginBottom: 6 }}>• {s}</div>)}
      </div>

      <div style={kartu}>
        <div style={judulKartu}>Cara membuka wawancara</div>
        <div style={{ fontSize: 13, fontStyle: "italic" }}>"{PEMBUKA}"</div>
        <div style={{ ...judulKartu, marginTop: 12 }}>Pertanyaan lanjutan (pakai di mana saja)</div>
        {PERTANYAAN_LANJUTAN.map((q) => <div key={q} style={{ fontSize: 13 }}>• {q}</div>)}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Komponen utama
// ------------------------------------------------------------

export default function AnalisisToko({ profile }) {
  const canEdit = (profile?.role === "auditor" || profile?.role === "super_admin") && !profile?.liatSebagai;
  const isolate = profile?.role === "auditor";

  const [tab, setTab] = useState("analisis"); // analisis | panduan
  const [branches, setBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [viewPeriod, setViewPeriod] = useState(nowPeriode());
  const [ringkasList, setRingkasList] = useState({}); // branch_id -> { count, final }
  const [selectedBranch, setSelectedBranch] = useState(null);

  const [entries, setEntries] = useState([]);
  const [entryId, setEntryId] = useState(null);
  const [data, setData] = useState(freshAnalisis());
  const [langkah, setLangkah] = useState("persiapan");
  const [versi, setVersi] = useState("inti"); // inti | lengkap
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(true);
  const [error, setError] = useState(null);
  const [loadingEntry, setLoadingEntry] = useState(false);
  const [disalin, setDisalin] = useState(false);
  const [belumInput, setBelumInput] = useState("");

  useEffect(() => { loadBranches(); }, []);
  useEffect(() => { if (!selectedBranch) loadRingkas(); }, [viewPeriod, selectedBranch]);

  async function loadBranches() {
    setLoadingBranches(true);
    const { data: rows, error: err } = await supabase.from("branches").select("*").order("name");
    if (err) setError(err.message); else setBranches(sortBranches(rows || []));
    setLoadingBranches(false);
  }

  function queryAnalisis(extra) {
    let q = supabase.from("audit_generic").select("*").eq("module", MODULE).eq("period", viewPeriod);
    if (isolate) q = q.eq("submitted_by", profile.id);
    return extra ? extra(q) : q;
  }

  async function loadRingkas() {
    const { data: rows, error: err } = await queryAnalisis();
    if (err) { setError(err.message); return; }
    const peta = {};
    (rows || []).forEach((r) => {
      const e = peta[r.branch_id] || { count: 0, final: false };
      e.count += 1;
      if (r.data?.dikonfirmasi) e.final = true;
      peta[r.branch_id] = e;
    });
    setRingkasList(peta);
  }

  async function pickBranch(b) {
    setSelectedBranch(b);
    setLoadingEntry(true);
    setError(null);
    setLangkah("persiapan");
    const { data: rows, error: err } = await queryAnalisis((q) => q.eq("branch_id", b.id).order("created_at", { ascending: false }));
    if (err) setError(err.message);
    const list = rows || [];
    setEntries(list);
    if (list.length) { setEntryId(list[0].id); setData(normalizeAnalisis(list[0].data)); }
    else { setEntryId(null); setData({ ...freshAnalisis(), tanggal: new Date().toISOString().slice(0, 10) }); }
    setSaved(true);
    setLoadingEntry(false);
  }

  function pilihEntry(id) {
    if (id === "baru") { setEntryId(null); setData({ ...freshAnalisis(), tanggal: new Date().toISOString().slice(0, 10) }); setSaved(true); return; }
    const e = entries.find((x) => x.id === id);
    if (e) { setEntryId(e.id); setData(normalizeAnalisis(e.data)); setSaved(true); }
  }

  function backToList() {
    if (!saved && !window.confirm("Ada perubahan yang belum disimpan. Tetap keluar?")) return;
    setSelectedBranch(null);
  }

  const ubah = (fn) => { setData((d) => fn(d)); setSaved(false); };
  const set = (k, v) => ubah((d) => ({ ...d, [k]: v }));
  const setIn = (k, sub, v) => ubah((d) => ({ ...d, [k]: { ...d[k], [sub]: v } }));
  const ubahItem = (k, id, patch) => ubah((d) => ({ ...d, [k]: d[k].map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const hapusItem = (k, id) => ubah((d) => ({ ...d, [k]: d[k].filter((x) => x.id !== id) }));

  async function simpan() {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      const isi = { ...data, auditor_name: profile?.full_name || null };
      let row;
      if (entryId) {
        // submitted_by sengaja tidak dikirim saat update: kepemilikan catatan tidak berpindah.
        const res = await supabase.from("audit_generic").update({ data: isi, status: "submitted" }).eq("id", entryId).select().single();
        if (res.error) throw res.error;
        row = res.data;
      } else {
        const res = await supabase.from("audit_generic").insert({ module: MODULE, branch_id: selectedBranch.id, period: viewPeriod, status: "submitted", submitted_by: user.id, data: isi }).select().single();
        if (res.error) throw res.error;
        row = res.data;
      }
      setEntryId(row.id);
      setEntries((prev) => [row, ...prev.filter((e) => e.id !== row.id)]);
      setSaved(true);
    } catch (e) {
      setError(e.message || String(e));
    }
    setSaving(false);
  }

  async function hapus() {
    if (!entryId) return;
    if (!window.confirm("Hapus analisis ini? Tindakan ini tidak bisa dibatalkan.")) return;
    const { error: err } = await supabase.from("audit_generic").delete().eq("id", entryId);
    if (err) { setError(err.message); return; }
    const sisa = entries.filter((e) => e.id !== entryId);
    setEntries(sisa);
    if (sisa.length) { setEntryId(sisa[0].id); setData(normalizeAnalisis(sisa[0].data)); }
    else { setEntryId(null); setData({ ...freshAnalisis(), tanggal: new Date().toISOString().slice(0, 10) }); }
    setSaved(true);
  }

  const namaAcuan = branches.find((b) => b.id === data.acuanId)?.name || "";
  const ringkasan = selectedBranch ? buatRingkasan({ data, namaCabang: selectedBranch.name, periode: periodeLabel(viewPeriod), namaAcuan }) : "";
  const tema = hitungTema(data.wawancara);

  async function salinRingkasan() {
    try { await navigator.clipboard.writeText(ringkasan); setDisalin(true); setTimeout(() => setDisalin(false), 2000); }
    catch { setError("Tidak bisa menyalin otomatis. Blok teks ringkasan lalu salin manual."); }
  }

  const isOwnerOrAdmin = profile?.role === "super_admin" || (profile?.role === "auditor");

  // ── Header & tab ──
  const header = (
    <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
      <div>
        <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Analisis Toko</div>
        <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>Pembantu analisis untuk cabang yang dikunjungi &mdash; kesimpulan tetap di tangan auditor</div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button className={tab === "analisis" ? "btn" : "btn-ghost"} onClick={() => setTab("analisis")}>Analisis</button>
        <button className={tab === "panduan" ? "btn" : "btn-ghost"} onClick={() => setTab("panduan")}>Panduan &amp; Standar</button>
      </div>
    </div>
  );

  if (tab === "panduan") return <div style={{ flex: 1 }}>{header}<Panduan /></div>;

  // ── Pilih cabang ──
  if (!selectedBranch) {
    return (
      <div style={{ flex: 1 }}>
        {header}
        <div style={{ padding: "14px 28px 0", display: "flex", justifyContent: "flex-end" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 8, padding: "4px 6px" }}>
            <button className="btn-ghost" onClick={() => setViewPeriod(addMonthsToPeriod(viewPeriod, -1))} style={{ padding: "6px 10px" }}>{"<"}</button>
            <div className="mono" style={{ fontWeight: 600, minWidth: 130, textAlign: "center", fontSize: 13.5 }}>{periodeLabel(viewPeriod)}</div>
            <button className="btn-ghost" onClick={() => setViewPeriod(addMonthsToPeriod(viewPeriod, 1))} style={{ padding: "6px 10px" }}>{">"}</button>
          </div>
        </div>
        <div style={{ padding: 24 }}>
          {error && <div style={{ color: "var(--danger-text)", fontSize: 13, marginBottom: 12 }}>{error}</div>}
          {loadingBranches ? (
            <div style={{ color: "var(--text-secondary)" }}>Memuat cabang…</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
              {branches.map((b) => {
                const r = ringkasList[b.id];
                return (
                  <div key={b.id} onClick={() => pickBranch(b)} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", cursor: "pointer" }}>
                    <div style={{ fontWeight: 600, fontSize: 14.5, marginBottom: 6 }}>{b.name}</div>
                    {r ? (
                      <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: r.final ? "#1a9e6e22" : "#F4B74022", color: r.final ? "#1a9e6e" : "#b8860b" }}>
                        {r.final ? "Dikonfirmasi" : "Draft"}{r.count > 1 ? ` · ${r.count}` : ""}
                      </span>
                    ) : (
                      <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>Belum ada &middot; Mulai &rarr;</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Form ──
  const idxLangkah = LANGKAH.findIndex((l) => l.id === langkah);
  const jenisTiru = data.jenis === "tiru_acuan";

  const panelPersiapan = (
    <>
      <div style={kartu}>
        <div style={judulKartu}>Jenis analisis</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {Object.entries(JENIS).map(([k, v]) => (
            <button key={k} className={data.jenis === k ? "btn" : "btn-ghost"} disabled={!canEdit} onClick={() => set("jenis", k)} style={{ fontSize: 12.5 }}>{v.label}</button>
          ))}
        </div>
        <div style={{ ...kecil, marginTop: 6 }}>{JENIS[data.jenis]?.hint}</div>
        <Field label="Tanggal kunjungan" style={{ marginTop: 10, maxWidth: 200 }}>
          <input className="input" type="date" value={data.tanggal || ""} disabled={!canEdit} onChange={(e) => set("tanggal", e.target.value)} />
        </Field>
      </div>

      <div style={kartu}>
        <div style={judulKartu}>Profil dan konteks toko</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
          <Field label="Store leader"><Teks value={data.konteks.leader} disabled={!canEdit} onChange={(v) => setIn("konteks", "leader", v)} /></Field>
          <Field label="Menjabat sejak"><Teks value={data.konteks.leaderSejak} disabled={!canEdit} placeholder="mis. Agustus 2026" onChange={(v) => setIn("konteks", "leaderSejak", v)} /></Field>
          <Field label="Usia toko"><Teks value={data.konteks.usiaToko} disabled={!canEdit} placeholder="mis. 3 tahun" onChange={(v) => setIn("konteks", "usiaToko", v)} /></Field>
          <Field label="Ukuran toko"><Teks value={data.konteks.ukuran} disabled={!canEdit} placeholder="besar / sedang / kecil" onChange={(v) => setIn("konteks", "ukuran", v)} /></Field>
          <Field label="Jumlah staf"><Teks value={data.konteks.jumlahStaf} disabled={!canEdit} onChange={(v) => setIn("konteks", "jumlahStaf", v)} /></Field>
        </div>
        <Field label="Perubahan terakhir (leader/staf baru, renovasi, SOP atau sistem baru, promo besar)" style={{ marginTop: 10 }}>
          <Teks rows={2} value={data.konteks.perubahan} disabled={!canEdit} onChange={(v) => setIn("konteks", "perubahan", v)} />
        </Field>
      </div>

      {(jenisTiru || data.acuanId) && (
        <div style={kartu}>
          <div style={judulKartu}>Cabang acuan</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
            <Field label="Cabang acuan">
              <Pilih value={data.acuanId} disabled={!canEdit} onChange={(v) => set("acuanId", v)} opsi={[["", "— pilih —"], ...branches.filter((b) => b.id !== selectedBranch.id).map((b) => [b.id, b.name])]} />
            </Field>
            <Field label="Catatan status acuan"><Teks value={data.acuanCatatan} disabled={!canEdit} onChange={(v) => set("acuanCatatan", v)} /></Field>
          </div>
          <div style={{ ...kecil, marginTop: 6 }}>Informasi dari bos dicatat sebagai titik awal, bukan hasil temuanmu. Yang menjadi temuanmu adalah isi kebiasaannya dan hasil penerapannya.</div>
        </div>
      )}

      <div style={kartu}>
        <div style={judulKartu}>Pertanyaan pemantik (untuk mencari hipotesis)</div>
        {PERTANYAAN_PEMANTIK.map((p) => (
          <Field key={p.id} label={p.teks} style={{ marginBottom: 8 }}>
            <Teks rows={2} value={data.pemantik[p.id]} disabled={!canEdit} onChange={(v) => setIn("pemantik", p.id, v)} />
          </Field>
        ))}
        <div style={kecil}>Baca juga riwayat 3–6 bulan toko ini (tren skor, selisih, temuan berulang) di Laporan Bulanan sebelum berangkat.</div>
      </div>
    </>
  );

  const panelFakta = (
    <>
      <div style={kartu}>
        <div style={judulKartu}>Hal yang diamati sebelum bertanya</div>
        <div style={{ ...kecil, marginBottom: 8 }}>Klik untuk menambah baris catatan pengamatan.</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {DIAMATI.map((t) => (
            <button key={t} className="btn-ghost" disabled={!canEdit} style={{ fontSize: 11.5, textAlign: "left" }}
              onClick={() => ubah((d) => ({ ...d, fakta: [...d.fakta, { id: uid(), aspek: "Proses harian", isi: "", sumber: "Pengamatan", kepastian: "fakta", menonjol: false, topik: t }] }))}>
              + {t}
            </button>
          ))}
        </div>
      </div>

      <div style={kartu}>
        <div style={judulKartu}>Fakta dan dugaan ({data.fakta.length})</div>
        {data.fakta.length === 0 && <div style={kecil}>Belum ada catatan. Tambahkan dari data (stok, temuan, selisih), pengamatan, atau info dari bos.</div>}
        {data.fakta.map((f) => (
          <div key={f.id} style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}>
            {f.topik && <div style={{ ...kecil, marginBottom: 4 }}>Diamati: {f.topik}</div>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8, marginBottom: 6 }}>
              <Field label="Aspek"><Pilih value={f.aspek} disabled={!canEdit} onChange={(v) => ubahItem("fakta", f.id, { aspek: v })} opsi={ASPEK} /></Field>
              <Field label="Sumber"><Pilih value={f.sumber} disabled={!canEdit} onChange={(v) => ubahItem("fakta", f.id, { sumber: v })} opsi={SUMBER} /></Field>
              <Field label="Kepastian"><Pilih value={f.kepastian} disabled={!canEdit} onChange={(v) => ubahItem("fakta", f.id, { kepastian: v })} opsi={[["fakta", "Fakta (ada bukti/data)"], ["dugaan", "Dugaan"]]} /></Field>
            </div>
            <Teks rows={2} value={f.isi} disabled={!canEdit} placeholder="Tulis apa yang terlihat/diketahui, bukan penilaian watak orang" onChange={(v) => ubahItem("fakta", f.id, { isi: v })} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
              <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={!!f.menonjol} disabled={!canEdit} onChange={(e) => ubahItem("fakta", f.id, { menonjol: e.target.checked })} /> Menonjol (janggal, memburuk, atau berulang)
              </label>
              {canEdit && <button className="btn-ghost" style={{ fontSize: 12, color: "var(--danger-text)" }} onClick={() => hapusItem("fakta", f.id)}>Hapus</button>}
            </div>
          </div>
        ))}
        {canEdit && (
          <button className="btn-ghost" style={{ fontSize: 12, marginTop: 6 }}
            onClick={() => ubah((d) => ({ ...d, fakta: [...d.fakta, { id: uid(), aspek: ASPEK[0], isi: "", sumber: SUMBER[0], kepastian: "fakta", menonjol: false }] }))}>
            + Tambah catatan
          </button>
        )}
      </div>

      <div style={kartu}>
        <div style={judulKartu}>Pola / yang menarik</div>
        <Teks rows={3} value={data.pola} disabled={!canEdit} placeholder="Hubungkan antar aspek, mis. selisih naik dan pencatatan terlambat" onChange={(v) => set("pola", v)} />
      </div>
    </>
  );

  const panelWawancara = (
    <>
      <div style={kartu}>
        <div style={judulKartu}>Cara membuka</div>
        <div style={{ fontSize: 13, fontStyle: "italic" }}>"{PEMBUKA}"</div>
        <div style={{ ...kecil, marginTop: 8 }}>
          Tanyakan kejadian, bukan opini. Pertanyaan lanjutan: {PERTANYAAN_LANJUTAN.join(" · ")}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={kecil}>Daftar pertanyaan:</span>
          <button className={versi === "inti" ? "btn" : "btn-ghost"} style={{ fontSize: 12 }} onClick={() => setVersi("inti")}>Inti (wawancara 10–15 menit)</button>
          <button className={versi === "lengkap" ? "btn" : "btn-ghost"} style={{ fontSize: 12 }} onClick={() => setVersi("lengkap")}>Lengkap</button>
        </div>
        {canEdit && (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn-ghost" onClick={() => ubah((d) => ({ ...d, wawancara: [...d.wawancara, { id: uid(), peran: "leader", kode: kodeBerikut(d.wawancara, "leader"), jawaban: {}, tambahan: "" }] }))}>+ Wawancara leader</button>
            <button className="btn-ghost" onClick={() => ubah((d) => ({ ...d, wawancara: [...d.wawancara, { id: uid(), peran: "sales", kode: kodeBerikut(d.wawancara, "sales"), jawaban: {}, tambahan: "" }] }))}>+ Wawancara sales</button>
          </div>
        )}
        <div style={{ ...kecil, marginTop: 8 }}>Catat dengan kode (Leader, Sales A, Sales B), bukan nama. Tulis kata-kata asli secara singkat, tanpa tafsiran.</div>
      </div>

      {data.wawancara.length === 0 && <div style={kecil}>Belum ada wawancara.</div>}
      {data.wawancara.map((w) => {
        const qs = bankPertanyaan(data.jenis, w.peran, versi);
        let kelTerakhir = null;
        return (
          <div key={w.id} style={kartu}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontWeight: 600 }}>{w.kode} <span style={{ ...kecil, fontWeight: 400 }}>({w.peran === "leader" ? "store leader" : "sales"})</span></div>
              {canEdit && <button className="btn-ghost" style={{ fontSize: 12, color: "var(--danger-text)" }} onClick={() => { if (window.confirm(`Hapus catatan wawancara ${w.kode}?`)) hapusItem("wawancara", w.id); }}>Hapus</button>}
            </div>
            {qs.map((q) => {
              const j = w.jawaban?.[q.id] || { teks: "", tema: "" };
              const kelBaru = q.kel !== kelTerakhir;
              kelTerakhir = q.kel;
              return (
                <div key={q.id} style={{ marginBottom: 10 }}>
                  {kelBaru && <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em", margin: "8px 0 4px" }}>{q.kel}</div>}
                  <div style={{ fontSize: 13, marginBottom: 4 }}>{q.teks}</div>
                  <Teks rows={2} value={j.teks} disabled={!canEdit}
                    onChange={(v) => ubahItem("wawancara", w.id, { jawaban: { ...w.jawaban, [q.id]: { ...j, teks: v } } })} />
                  <input className="input" list="tema-umum" placeholder="Tema (mis. Pencatatan stok)" value={j.tema || ""} disabled={!canEdit}
                    onChange={(e) => ubahItem("wawancara", w.id, { jawaban: { ...w.jawaban, [q.id]: { ...j, tema: e.target.value } } })}
                    style={{ marginTop: 4, fontSize: 12 }} />
                </div>
              );
            })}
            <Field label="Catatan tambahan (hal di luar daftar pertanyaan)">
              <Teks rows={2} value={w.tambahan} disabled={!canEdit} onChange={(v) => ubahItem("wawancara", w.id, { tambahan: v })} />
            </Field>
          </div>
        );
      })}
      <datalist id="tema-umum">{TEMA_UMUM.map((t) => <option key={t} value={t} />)}</datalist>
    </>
  );

  const panelHipotesis = (
    <>
      <div style={kartu}>
        <div style={judulKartu}>Tema dari wawancara</div>
        {tema.length === 0 ? (
          <div style={kecil}>Belum ada tema. Isi kolom Tema pada jawaban wawancara. Tema yang disebut lebih dari satu orang adalah bahan hipotesis paling kuat.</div>
        ) : (
          tema.map((t) => (
            <div key={t.tema} style={{ padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
              <b>{t.tema}</b>{" "}
              <span style={{ display: "inline-block", marginLeft: 6, padding: "1px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: t.orang >= 2 ? "#7c3aed22" : "var(--surface-alt)", color: t.orang >= 2 ? "#7c3aed" : "var(--text-secondary)" }}>
                {t.orang} orang
              </span>
              <div style={{ ...kecil, marginTop: 2 }}>{t.kutipan.slice(0, 3).map((k) => `${k.kode}: ${k.teks}`).join(" · ")}</div>
            </div>
          ))
        )}
        <div style={{ ...kecil, marginTop: 8 }}>Perhatikan juga jawaban yang berbeda dengan data, atau yang berbeda antar orang. Itu juga bahan hipotesis.</div>
      </div>

      <div style={kartu}>
        <div style={judulKartu}>Hipotesis ({data.hipotesis.length})</div>
        {data.hipotesis.length === 0 && <div style={kecil}>Tulis 2–3 saja. Bentuknya: "mungkin X terjadi karena Y".</div>}
        {data.hipotesis.map((h, i) => (
          <div key={h.id} style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}>
            <Field label={`Hipotesis ${i + 1}`}>
              <Teks rows={2} value={h.teks} disabled={!canEdit} placeholder="mis. Mismatch barang berulang karena barang masuk dicatat di akhir hari" onChange={(v) => ubahItem("hipotesis", h.id, { teks: v })} />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8, marginTop: 6 }}>
              <Field label="Kalau benar, akan terlihat…"><Teks rows={2} value={h.jikaBenar} disabled={!canEdit} onChange={(v) => ubahItem("hipotesis", h.id, { jikaBenar: v })} /></Field>
              <Field label="Kalau salah, akan terlihat…"><Teks rows={2} value={h.jikaSalah} disabled={!canEdit} onChange={(v) => ubahItem("hipotesis", h.id, { jikaSalah: v })} /></Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 8, marginTop: 6 }}>
              <Field label="Status"><Pilih value={h.status || "belum"} disabled={!canEdit} onChange={(v) => ubahItem("hipotesis", h.id, { status: v })} opsi={STATUS_HIPOTESIS} /></Field>
              <Field label="Bukti yang ditemukan"><Teks value={h.bukti} disabled={!canEdit} onChange={(v) => ubahItem("hipotesis", h.id, { bukti: v })} /></Field>
            </div>
            {canEdit && <button className="btn-ghost" style={{ fontSize: 12, color: "var(--danger-text)", marginTop: 6 }} onClick={() => hapusItem("hipotesis", h.id)}>Hapus hipotesis</button>}
          </div>
        ))}
        {canEdit && (
          <button className="btn-ghost" style={{ fontSize: 12, marginTop: 6 }}
            onClick={() => ubah((d) => ({ ...d, hipotesis: [...d.hipotesis, { id: uid(), teks: "", jikaBenar: "", jikaSalah: "", status: "belum", bukti: "" }] }))}>
            + Tambah hipotesis
          </button>
        )}
      </div>

      <div style={kartu}>
        <div style={judulKartu}>Contoh: dari yang didengar ke hipotesis</div>
        {CONTOH_HIPOTESIS.map((r) => (
          <div key={r[0]} style={{ fontSize: 12.5, marginBottom: 6 }}><b>{r[0]}</b> → {r[1]} <span style={{ color: "var(--text-secondary)" }}>(uji: {r[2]})</span></div>
        ))}
      </div>
    </>
  );

  const panelRencana = (
    <>
      <div style={kartu}>
        <div style={judulKartu}>Perbandingan kebiasaan {namaAcuan ? `(${namaAcuan} dan ${selectedBranch.name})` : ""}</div>
        <div style={{ ...kecil, marginBottom: 8 }}>Pakai pertanyaan yang sama di kedua cabang. Yang ditiru adalah kebiasaan, bukan "culture".</div>
        {data.kebiasaan.map((x) => (
          <div key={x.id} style={{ borderTop: "1px solid var(--border)", padding: "8px 0" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
              <Field label="Kebiasaan"><Teks value={x.kebiasaan} disabled={!canEdit} placeholder="mis. Briefing pagi" onChange={(v) => ubahItem("kebiasaan", x.id, { kebiasaan: v })} /></Field>
              <Field label={`Di ${namaAcuan || "acuan"}`}><Teks value={x.diAcuan} disabled={!canEdit} onChange={(v) => ubahItem("kebiasaan", x.id, { diAcuan: v })} /></Field>
              <Field label={`Di ${selectedBranch.name}`}><Teks value={x.diCabang} disabled={!canEdit} onChange={(v) => ubahItem("kebiasaan", x.id, { diCabang: v })} /></Field>
              <Field label="Bisa ditiru?"><Pilih value={x.bisaDitiru || "belum"} disabled={!canEdit} onChange={(v) => ubahItem("kebiasaan", x.id, { bisaDitiru: v })} opsi={OPSI_TIRU} /></Field>
            </div>
            {canEdit && <button className="btn-ghost" style={{ fontSize: 12, color: "var(--danger-text)", marginTop: 4 }} onClick={() => hapusItem("kebiasaan", x.id)}>Hapus</button>}
          </div>
        ))}
        {canEdit && (
          <button className="btn-ghost" style={{ fontSize: 12, marginTop: 6 }}
            onClick={() => ubah((d) => ({ ...d, kebiasaan: [...d.kebiasaan, { id: uid(), kebiasaan: "", diAcuan: "", diCabang: "", bisaDitiru: "belum" }] }))}>
            + Tambah kebiasaan
          </button>
        )}
      </div>

      <div style={kartu}>
        <div style={judulKartu}>Rencana uji</div>
        <Field label="Kebiasaan yang akan dicoba (2–3 saja)"><Teks rows={2} value={data.rencana.dipilih} disabled={!canEdit} onChange={(v) => setIn("rencana", "dipilih", v)} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10, marginTop: 8 }}>
          <Field label="Pendamping"><Teks value={data.rencana.pendamping} disabled={!canEdit} onChange={(v) => setIn("rencana", "pendamping", v)} /></Field>
          <Field label="Durasi (minggu)"><Teks value={data.rencana.durasi} disabled={!canEdit} placeholder="6–8" onChange={(v) => setIn("rencana", "durasi", v)} /></Field>
        </div>
        <Field label="Ukuran berhasil (tetapkan SEBELUM mulai)" style={{ marginTop: 8 }}>
          <Teks rows={2} value={data.rencana.ukuran} disabled={!canEdit} placeholder="mis. mismatch barang tidak berulang; temuan baru di gudang berkurang" onChange={(v) => setIn("rencana", "ukuran", v)} />
        </Field>
      </div>
    </>
  );

  const panelKesimpulan = (
    <>
      <div style={kartu}>
        <div style={judulKartu}>Kesimpulan</div>
        <Teks rows={4} value={data.kesimpulan} disabled={!canEdit} placeholder="Satu kesimpulan, berdasarkan minimal dua sumber. Tulis perilaku yang terlihat, bukan watak orang." onChange={(v) => set("kesimpulan", v)} />
        <Field label="Tingkat keyakinan" style={{ marginTop: 8, maxWidth: 260 }}>
          <Pilih value={data.keyakinan} disabled={!canEdit} onChange={(v) => set("keyakinan", v)} opsi={[["fakta", "Fakta (ada bukti kuat)"], ["dugaan", "Dugaan"]]} />
        </Field>
      </div>
      <div style={kartu}>
        <div style={judulKartu}>Yang diminta dari bos</div>
        <Teks rows={3} value={data.diminta} disabled={!canEdit} placeholder="Tindakan konkret: pendampingan, tambah alat, tambah tenaga, evaluasi, atau cukup dipantau" onChange={(v) => set("diminta", v)} />
      </div>
      <div style={kartu}>
        <div style={judulKartu}>Belum diketahui / batas bukti</div>
        {data.belumDiketahui.map((x, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
            <span>• {x}</span>
            {canEdit && <button className="btn-ghost" style={{ fontSize: 11 }} onClick={() => ubah((d) => ({ ...d, belumDiketahui: d.belumDiketahui.filter((_, j) => j !== i) }))}>Hapus</button>}
          </div>
        ))}
        {canEdit && (
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <input className="input" value={belumInput} placeholder="mis. leader tidak sempat diwawancarai" onChange={(e) => setBelumInput(e.target.value)} />
            <button className="btn-ghost" onClick={() => { if (belumInput.trim()) { ubah((d) => ({ ...d, belumDiketahui: [...d.belumDiketahui, belumInput.trim()] })); setBelumInput(""); } }}>Tambah</button>
          </div>
        )}
      </div>
    </>
  );

  const panelRingkasan = (
    <>
      <div style={kartu}>
        <div style={judulKartu}>Ringkasan untuk bos</div>
        <div style={{ ...kecil, marginBottom: 8 }}>Kode dan jawaban mentah wawancara tidak ikut. Hanya tema yang disebut lebih dari satu orang dan jumlah orangnya.</div>
        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, margin: 0 }}>{ringkasan}</pre>
        <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn-ghost" onClick={salinRingkasan}>{disalin ? "Tersalin ✓" : "Salin teks"}</button>
          <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={!!data.dikonfirmasi} disabled={!canEdit} onChange={(e) => set("dikonfirmasi", e.target.checked)} />
            Sudah saya periksa dan konfirmasi sebagai auditor
          </label>
        </div>
        <div style={{ ...kecil, marginTop: 6 }}>Hanya analisis yang dikonfirmasi yang boleh dibawa ke PPT atau dibaca bos. Ingat menekan Simpan.</div>
      </div>
    </>
  );

  const panel = { persiapan: panelPersiapan, fakta: panelFakta, wawancara: panelWawancara, hipotesis: panelHipotesis, rencana: panelRencana, kesimpulan: panelKesimpulan, ringkasan: panelRingkasan }[langkah];

  return (
    <div style={{ flex: 1 }}>
      <div style={{ background: "var(--surface)", padding: "16px 28px", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <button className="btn-ghost" style={{ marginBottom: 6, fontSize: 12.5 }} onClick={backToList}>&larr; Pilih cabang lain</button>
            <div className="display" style={{ fontSize: 19, fontWeight: 600 }}>{selectedBranch.name}</div>
            <div style={{ ...kecil }}>Analisis Toko &middot; {periodeLabel(viewPeriod)} {!saved && <span style={{ color: "#b8860b", fontWeight: 600 }}>· belum disimpan</span>}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {entries.length > 0 && (
              <select className="input" value={entryId || "baru"} onChange={(e) => pilihEntry(e.target.value)} style={{ maxWidth: 220 }}>
                {entries.map((e) => <option key={e.id} value={e.id}>{(e.data?.auditor_name || "Auditor")} — {e.data?.tanggal || "tanpa tanggal"}</option>)}
                {canEdit && <option value="baru">+ Analisis baru</option>}
              </select>
            )}
            {canEdit && <button className="btn" disabled={saving} onClick={simpan}>{saving ? "Menyimpan…" : "Simpan"}</button>}
            {canEdit && entryId && isOwnerOrAdmin && <button className="btn-ghost" onClick={hapus} style={{ color: "var(--danger-text)" }}>Hapus</button>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
          {LANGKAH.map((l) => (
            <button key={l.id} className={langkah === l.id ? "btn" : "btn-ghost"} onClick={() => setLangkah(l.id)} style={{ fontSize: 12 }}>{l.label}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: 24, maxWidth: 960 }}>
        {error && <div style={{ color: "var(--danger-text)", fontSize: 13, marginBottom: 12 }}>{error}</div>}
        {loadingEntry ? (
          <div style={{ color: "var(--text-secondary)" }}>Memuat…</div>
        ) : (
          <>
            <div style={{ ...kecil, marginBottom: 12 }}>{LANGKAH[idxLangkah]?.ringkas}</div>
            {panel}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
              <button className="btn-ghost" disabled={idxLangkah <= 0} onClick={() => setLangkah(LANGKAH[idxLangkah - 1].id)}>&larr; Sebelumnya</button>
              <button className="btn-ghost" disabled={idxLangkah >= LANGKAH.length - 1} onClick={() => setLangkah(LANGKAH[idxLangkah + 1].id)}>Berikutnya &rarr;</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
