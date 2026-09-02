// ============================================================
// Pembangun baris tabel Monitoring Display untuk cetakan Berita Acara.
//
// MURNI — tidak menyentuh React maupun Supabase, supaya bisa diuji di Node.
// Sebelumnya ia tinggal di dalam exportPDF() pada BeritaAcara.js, dan karena
// itu dua cacat lolos sampai dokumen jadi:
//
//   1. Kolom keterangan tidak pernah memuat `perlakuan_catatan`. Auditor
//      mengetiknya di form, tersimpan ke database, dan tidak pernah terbaca
//      di dokumen mana pun. Data yang diketik lalu hilang tanpa jejak.
//
//   2. Kelas warnanya dipatok "status-ok"/"status-bad". Cetakan format baru
//      mendefinisikan "k-ok"/"k-bad", jadi kolom umur tercetak TANPA warna —
//      unit yang lewat batas tidak lagi menonjol merah. Tidak ada galat,
//      tidak ada yang kosong; hanya penanda yang diam-diam padam.
//
// Nama kelas karena itu menjadi PARAMETER, bukan tetapan.
// ============================================================

const escDefault = (t) => String(t == null ? "" : t)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Umur dihitung terhadap TANGGAL AUDIT, bukan hari ini. Berita Acara Agustus
// yang dicetak ulang bulan Desember harus memuat angka yang sama.
export function umurTerhadap(tglPajang, tglAudit) {
  if (!tglPajang || !tglAudit) return 0;
  const a = new Date(tglPajang + "T00:00:00Z");
  const b = new Date(tglAudit + "T00:00:00Z");
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

// Isi kolom "Program / Perlakuan".
//
// Tiga keadaan, dan ketiganya harus utuh:
//   unit diturunkan  -> perlakuan + harga + CATATAN perlakuan
//   ikut program     -> "Program: nama" + catatan kondisi
//   biasa            -> catatan kondisi saja
//
// `sertakanCatatan` sengaja bisa dimatikan: jalur cetak LAMA (periode sebelum
// September 2026) tidak boleh berubah bentuknya sedikit pun, walaupun berarti
// catatan itu tetap tidak tercetak di sana. Berita Acara yang sudah
// ditandatangani lebih penting daripada memperbaikinya surut.
export function ketPerlakuan(r, opsi) {
  const o = opsi || {};
  const esc = o.esc || escDefault;
  const labelPerlakuan = o.labelPerlakuan || ((k) => k || "");
  const sertakanCatatan = o.sertakanCatatan !== false;

  if (r.turun) {
    const harga = r.harga_jual_display
      ? " — Rp " + Number(r.harga_jual_display).toLocaleString("id-ID")
      : "";
    const catatan = sertakanCatatan && r.perlakuan_catatan
      ? " · " + esc(r.perlakuan_catatan)
      : "";
    return esc(labelPerlakuan(r.perlakuan_kode)) + harga + catatan;
  }
  if (r.program_brand) {
    const catatan = sertakanCatatan && r.kondisi_catatan
      ? " · " + esc(r.kondisi_catatan)
      : "";
    return "Program: " + esc(r.program_nama) + catatan;
  }
  return esc(r.kondisi_catatan) || "-";
}

export function barisDisplayHtml(rows, opsi) {
  const o = opsi || {};
  const esc = o.esc || escDefault;
  const kelasOk = o.kelasOk || "k-ok";
  const kelasBad = o.kelasBad || "k-bad";
  const labelKondisi = o.labelKondisi || ((k) => k || "—");
  const tglAudit = o.tglAudit;

  const isi = (rows || []).map((r) => {
    const umur = umurTerhadap(r.tanggal_pajang, tglAudit);
    const batas = r.batas_hari;
    const lewat = batas != null && umur > batas && !r.turun;
    const ket = ketPerlakuan(r, o);
    return `<tr${r.turun ? ' style="background:#faf9fc;color:#8a83a0;"' : ""}>`
      + `<td style="font-weight:600;">${esc(r.brand)} ${esc(r.model)}</td>`
      + `<td>${esc(r.serial_number) || "-"}</td>`
      + `<td>${esc(r.tanggal_pajang) || "-"}</td>`
      + `<td class="${lewat ? kelasBad : kelasOk}">${umur} hr`
      + `${batas != null ? " / " + batas : ""}`
      + `${lewat ? " · lewat " + (umur - batas) : ""}</td>`
      + `<td>${r.turun ? "—" : esc(labelKondisi(r.kondisi_kode))}</td>`
      + `<td>${ket || "-"}</td>`
      + `</tr>`;
  }).join("");

  return isi || `<tr><td colspan="6" style="text-align:center;color:#999;padding:10px;">Belum ada unit display tercatat</td></tr>`;
}
