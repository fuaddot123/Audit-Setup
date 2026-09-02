// Menguji cetakan Berita Acara FORMAT BARU milik repo produksi dengan
// benar-benar MERENDERNYA, bukan sekadar memastikan ia terkompilasi.
//
// Berkasnya .js di paket tanpa "type":"module", jadi disalin apa adanya ke
// .mjs. Satu-satunya yang diubah adalah penunjuk impor relatifnya (Node
// butuh ekstensi); perubahan itu diperiksa dan dilaporkan, tidak diam-diam.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const sini = path.dirname(fileURLToPath(import.meta.url));

// Berkas sasaran dicari di beberapa tempat supaya uji ini jalan baik dari
// folder uji di dalam paket maupun dari dalam repo sesudah dipasang.
// Kalau tak satu pun ketemu, uji BERHENTI — bukan lolos diam-diam.
function cariBerkas(relatif) {
  const calon = [
    path.join(sini, "..", "Audit-Setup", relatif),   // folder kerja penyusun
    path.join(sini, "..", relatif),                  // paket/uji -> paket/..
    path.join(sini, "..", "..", relatif),            // repo/uji  -> repo/..
    path.join(process.cwd(), relatif),               // dijalankan dari akar repo
    path.join(sini, relatif),                        // relatif terhadap folder uji
    path.join(sini, path.basename(relatif)),         // berkas contoh di sebelahnya
  ];
  for (const c of calon) if (fs.existsSync(c)) return c;
  throw new Error(
    "Tidak ketemu: " + relatif + "\nDicari di:\n  " + calon.join("\n  ")
    + "\nJalankan dari akar repo, atau taruh folder uji/ di dalam repo."
  );
}

const repo = path.dirname(path.dirname(cariBerkas("lib/format-ba.js")));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cetak-uji-"));
fs.mkdirSync(path.join(tmp, "lib"));
fs.mkdirSync(path.join(tmp, "components"));

fs.copyFileSync(path.join(repo, "lib", "format-ba.js"), path.join(tmp, "lib", "format-ba.mjs"));

const asli = fs.readFileSync(path.join(repo, "components", "BeritaAcaraCetakBaru.js"), "utf8");
const diubah = asli.replace('from "../lib/format-ba"', 'from "../lib/format-ba.mjs"');
if (diubah === asli) throw new Error("penunjuk impor tidak ketemu — susunan berkas berubah?");
if (diubah.length !== asli.length + 4) throw new Error("perubahan lebih dari sekadar ekstensi impor");
fs.writeFileSync(path.join(tmp, "components", "BeritaAcaraCetakBaru.mjs"), diubah);

fs.copyFileSync(path.join(repo, "lib", "baris-display.js"), path.join(tmp, "lib", "baris-display.mjs"));

const M = await import("file://" + path.join(tmp, "components", "BeritaAcaraCetakBaru.mjs").replace(/\\/g, "/"));
const FB = await import("file://" + path.join(tmp, "lib", "format-ba.mjs").replace(/\\/g, "/"));
const BD = await import("file://" + path.join(tmp, "lib", "baris-display.mjs").replace(/\\/g, "/"));

let lolos = 0, gagal = 0;
function cek(nama, syarat, info) {
  if (syarat) { lolos++; console.log("  OK    " + nama); }
  else { gagal++; console.log("  GAGAL " + nama + (info !== undefined ? "  -> " + info : "")); }
}

// ── Data contoh: menirukan satu audit September yang wajar ──
function inventarisContoh() {
  const inv = {};
  FB.semuaKunciItem().forEach((k) => { inv[k] = { status: "Berfungsi", keterangan: "", photos: [] }; });
  inv["Listrik & Utilitas|AC ruang display"] = { status: "Rusak", keterangan: "Tidak dingin", photos: [] };
  inv["Penerangan|Lampu etalase"] = { status: "Rusak", keterangan: "2 titik mati", photos: [] };
  inv["Peralatan Keamanan|APAR"] = { status: "Tidak ada", keterangan: "Belum tersedia di cabang ini", photos: [] };
  return inv;
}

const dasar = {
  cabang: "Semarang",
  periodeTeks: "September 2026",
  tanggalCetakTeks: "19 September 2026",
  waktuAudit: "09.00 - 13.30",
  auditor: "Fuad Hasan",
  teamLeader: "Dewi Anggraini",
  storeManager: "Rizal Pratama",
  inventaris: inventarisContoh(),
  stokBarisHtml: "<tr><td><b>KATEGORI 1</b></td><td>LAPTOP GAMING</td><td class=\"k-ok\">LENGKAP</td><td>-</td></tr>",
  stokTotal: 5, stokSelisih: 1, stokPct: 80, kat1Pct: 67, kat2Pct: 100,
  // Dibangun oleh PEMBANGUN ASLI, bukan diketik di sini. Versi sebelumnya
  // menyuapkan barisnya sendiri dengan kelas "k-bad" yang benar, sehingga
  // cacat sungguhan lolos: aplikasi memakai "status-bad" yang tidak
  // didefinisikan di gaya cetak baru, dan kolom umur tercetak tanpa warna.
  displayBarisHtml: BD.barisDisplayHtml([{
    brand: "ASUS", model: "ROG Strix G16", serial_number: "4KN0CV02X",
    tanggal_pajang: "2026-07-09", batas_hari: 60, turun: false,
    kondisi_kode: "lecet_ringan", kondisi_catatan: "",
  }, {
    brand: "MSI", model: "Katana 15", serial_number: "K1552089",
    tanggal_pajang: "2026-06-20", batas_hari: 60, turun: true,
    perlakuan_kode: "dijual_display", harga_jual_display: 11450000,
    perlakuan_catatan: "Diskon 18% dari harga normal",
  }], {
    tglAudit: "2026-09-19",
    labelKondisi: (k) => (k === "lecet_ringan" ? "Lecet ringan" : "—"),
    labelPerlakuan: () => "Dijual sebagai unit display (harga khusus)",
    kelasOk: "k-ok", kelasBad: "k-bad", sertakanCatatan: true,
  }),
  displayFotoHtml: "",
  displayDipajang: 20, displayLewat: 3, displayBatas: 60,
  skorD: { skor_display: 81, skor_umur: 85, skor_kondisi: 72, unit_dalam_batas: 17, unit_dinilai: 20 },
  displayInfo: { color: "#d98324", lbl: "Perhatian" },
};

const h = M.cetakBaruHtml(dasar);

console.log("\n=== 1. Kerangka dokumen ===");
cek("dokumen utuh ber-DOCTYPE", h.startsWith("<!DOCTYPE html>"));
cek("gaya cetak ikut tertanam", h.includes(".k-strip{") && h.includes(".k-belum{"));
cek("A4 potret", h.includes("size: A4 portrait"));
cek("kop menyebut periode huruf besar", h.includes("SEPTEMBER 2026"), h.slice(h.indexOf("k-per"), h.indexOf("k-per") + 60));
cek("tanggal cetak muncul", h.includes("Dicetak 19 September 2026"));

console.log("\n=== 2. Tiga poin, urut, tanpa lampiran terpisah ===");
const iRingkas = h.indexOf("RINGKASAN HASIL AUDIT");
const i1 = h.indexOf("1. AUDIT STOCK OPNAME");
const i2 = h.indexOf("2. AUDIT INVENTARIS");
const i3 = h.indexOf("3. AUDIT MONITORING DISPLAY");
const iTtd = h.indexOf("PELAKSANA");
cek("ringkasan skor ada", iRingkas > 0);
cek("ringkasan mendahului poin 1", iRingkas < i1);
cek("poin 1 -> 2 -> 3 berurutan", i1 < i2 && i2 < i3, [i1, i2, i3].join(" "));
cek("tanda tangan SESUDAH poin 3", i3 < iTtd, i3 + " vs " + iTtd);
cek("tidak ada lagi kata LAMPIRAN", !h.toUpperCase().includes("LAMPIRAN"));
cek("ringkasan hanya SEKALI", (h.match(/RINGKASAN HASIL AUDIT/g) || []).length === 1);

console.log("\n=== 3. Inventaris rinci dua kolom ===");
// Dihitung dari SEL KEADAAN-nya, bukan dari nama itemnya. Nama yang memuat
// "&" tercetak sebagai "&amp;" — huruf kecil di tengah teks huruf besar —
// dan pola yang mengandalkan bentuk nama akan melewatkannya diam-diam.
const barisInv = (h.match(/class="k-ok">BERFUNGSI</g) || []).length
  + (h.match(/class="k-bad">RUSAK</g) || []).length
  + (h.match(/class="k-netral">TIDAK ADA</g) || []).length;
cek("36 baris item tercetak", barisInv === 36, barisInv);
cek("dua tabel kolom", (h.match(/<th style="width:30%">Kategori<\/th>/g) || []).length === 2);
cek("AC ruang display tercetak RUSAK", h.includes("AC RUANG DISPLAY</td><td class=\"k-bad\">RUSAK"));
cek("APAR tercetak TIDAK ADA", h.includes("APAR</td><td class=\"k-netral\">TIDAK ADA"));
cek("item baik tetap BERFUNGSI", h.includes("ROUTER UTAMA</td><td class=\"k-ok\">BERFUNGSI"));

console.log("\n=== 3b. Tabel display: warna & catatan sampai ke dokumen ===");
// Kelas yang tidak didefinisikan tidak menimbulkan galat — ia hanya membuat
// penandanya padam. Karena itu diperiksa dua arah.
cek("memakai kelas yang memang ada di gaya cetak ini",
  h.includes('class="k-bad">72 hr / 60'), (h.match(/class="[a-z-]+">\d+ hr[^<]*/g) || []).join(" | "));
cek("tidak ada kelas status-* yang tak terdefinisi", !h.includes("status-bad") && !h.includes("status-ok"));
cek("gaya cetak memang tidak punya .status-*", !h.includes(".status-bad{"));
cek("unit lewat batas ditandai lewat berapa hari", h.includes("· lewat 12"));
cek("catatan perlakuan sampai ke dokumen", h.includes("Diskon 18% dari harga normal"),
  (h.match(/Dijual sebagai[^<]*/) || ["(tidak ada)"])[0]);

console.log("\n=== 4. Blok BELUM TERSEDIA ===");
cek("bloknya ada", h.includes("BELUM TERSEDIA DI CABANG INI"));
cek("menyebut 1 item", h.includes("BELUM TERSEDIA DI CABANG INI &mdash; 1 item"));
cek("menyebut APAR & kategorinya", h.includes("<b>APAR</b>") && h.includes("Peralatan Keamanan"));
cek("menyebut keterangannya", h.includes("Belum tersedia di cabang ini"));
cek("menegaskan tidak dihitung skor", h.includes("Tidak dihitung dalam skor inventaris"));
cek("letaknya antara poin 2 dan poin 3",
  h.indexOf("BELUM TERSEDIA DI CABANG INI") > i2 && h.indexOf("BELUM TERSEDIA DI CABANG INI") < i3);

console.log("\n=== 5. Skor: 'Tidak ada' netral ===");
cek("skor inventaris 94%", h.includes(">94%<"), (h.match(/>\d+%</g) || []).join(" "));
cek("kartu menyebut 33 berfungsi", h.includes("33 item"));
cek("kartu menyebut 2 rusak", h.includes("2 item"));
cek("kartu menyebut 1 tidak ada", h.includes("1 item"));
cek("pita menyebut 36 item", h.includes("36 item"));

console.log("\n=== 6. Tanpa item absen, bloknya hilang total ===");
const invPenuh = inventarisContoh();
invPenuh["Peralatan Keamanan|APAR"] = { status: "Berfungsi", keterangan: "", photos: [] };
const h2 = M.cetakBaruHtml({ ...dasar, inventaris: invPenuh });
cek("blok tidak dirender", !h2.includes("BELUM TERSEDIA DI CABANG INI"));
cek("skor naik jadi 94% -> 94%? hitung ulang", h2.includes(">94%<"), (h2.match(/>\d+%</g) || []).join(" "));

console.log("\n=== 7. Semua item tidak ada -> skor 100%, bukan 0% ===");
const invKosong = {};
FB.semuaKunciItem().forEach((k) => { invKosong[k] = { status: "Tidak ada", keterangan: "", photos: [] }; });
const h3 = M.cetakBaruHtml({ ...dasar, inventaris: invKosong });
cek("36 item terdaftar belum tersedia", h3.includes("&mdash; 36 item"));
cek("skor 100% (tidak ada penyebut yang berlaku)", h3.includes(">100%<"),
  (h3.match(/>\d+%</g) || []).join(" "));

console.log("\n=== 8. Teks berbahaya di data tidak lolos mentah ===");
const h4 = M.cetakBaruHtml({ ...dasar, cabang: '<script>alert(1)</script>', auditor: 'A"B' });
cek("tag script diloloskan sebagai teks", !h4.includes("<script>alert(1)</script>"));
cek("tanda kutip di nama ikut dikawal", h4.includes("A&quot;B"));

console.log("\n=== 9. Tanpa skor display, cetakan tetap jadi ===");
const h5 = M.cetakBaruHtml({ ...dasar, skorD: null, displayInfo: { color: "#999", lbl: "Belum dinilai" } });
cek("tidak melempar & tetap utuh", h5.startsWith("<!DOCTYPE html>"));
cek("menyebut belum ada unit dinilai", h5.includes("Belum ada unit dinilai"));

fs.rmSync(tmp, { recursive: true, force: true });
console.log("\n====================================================");
console.log("  LOLOS: " + lolos + "   GAGAL: " + gagal);
console.log("====================================================");
process.exit(gagal ? 1 : 0);
