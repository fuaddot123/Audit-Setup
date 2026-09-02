// Menguji lib/baris-display.js — pembangun baris tabel Monitoring Display
// pada cetakan Berita Acara.
//
// Uji ini lahir dari dua cacat yang lolos justru KARENA uji sebelumnya
// menyuapkan barisnya sendiri: uji-cetak-baru.mjs mengirim displayBarisHtml
// buatannya, jadi ia menguji dugaan saya, bukan keluaran aplikasinya.
//   1. `perlakuan_catatan` tidak pernah tercetak.
//   2. kelas warnanya "status-bad", padahal gaya cetak baru hanya punya
//      "k-bad" — kolom umur tercetak tanpa warna.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const sini = path.dirname(fileURLToPath(import.meta.url));

function cariBerkas(relatif) {
  const calon = [
    path.join(sini, "..", "Audit-Setup", relatif),
    path.join(sini, "..", relatif),
    path.join(sini, "..", "..", relatif),
    path.join(process.cwd(), relatif),
    path.join(sini, relatif),
  ];
  for (const c of calon) if (fs.existsSync(c)) return c;
  throw new Error("Tidak ketemu: " + relatif + "\nDicari di:\n  " + calon.join("\n  "));
}

const asal = cariBerkas("lib/baris-display.js");
const isi = fs.readFileSync(asal);
const tmp = path.join(os.tmpdir(), "baris-display-uji-" + isi.length + ".mjs");
fs.writeFileSync(tmp, isi);
const M = await import("file://" + tmp.replace(/\\/g, "/"));

let lolos = 0, gagal = 0;
function cek(nama, syarat, info) {
  if (syarat) { lolos++; console.log("  OK    " + nama); }
  else { gagal++; console.log("  GAGAL " + nama + (info !== undefined ? "  -> " + info : "")); }
}

const KONDISI = { baik: "Baik — seperti baru", lecet_ringan: "Lecet ringan / debu membandel" };
const PERLAKUAN = { dijual_display: "Dijual sebagai unit display (harga khusus)" };
const OPSI_BARU = {
  tglAudit: "2026-09-19",
  labelKondisi: (k) => KONDISI[k] || "—",
  labelPerlakuan: (k) => PERLAKUAN[k] || "",
  kelasOk: "k-ok", kelasBad: "k-bad", sertakanCatatan: true,
};
const OPSI_LAMA = { ...OPSI_BARU, kelasOk: "status-ok", kelasBad: "status-bad", sertakanCatatan: false };

const UNIT_TURUN = {
  brand: "MSI", model: "Katana 15", serial_number: "K1552089",
  tanggal_pajang: "2026-06-20", batas_hari: 60, turun: true,
  perlakuan_kode: "dijual_display", harga_jual_display: 11450000,
  perlakuan_catatan: "Diskon 18% dari harga normal",
};
const UNIT_LEWAT = {
  brand: "ASUS", model: "ROG Strix G16", serial_number: "4KN0CV02X",
  tanggal_pajang: "2026-07-09", batas_hari: 60, turun: false,
  kondisi_kode: "lecet_ringan", kondisi_catatan: "Goresan tipis di sudut layar kiri",
};
const UNIT_PROGRAM = {
  brand: "Lenovo", model: "ThinkPad X1 Carbon", serial_number: "PF3TQ9L2",
  tanggal_pajang: "2026-08-26", batas_hari: 60, turun: false,
  kondisi_kode: "baik", program_brand: true, program_nama: "Lenovo Pro Display Q3",
  kondisi_catatan: "Stiker program masih terpasang",
};

console.log("\n=== 1. Cacat 1: catatan perlakuan WAJIB tercetak ===");
// Auditor mengetiknya di form dan tersimpan ke database. Kalau tidak
// tercetak, ia data yang diketik lalu tidak pernah terbaca siapa pun.
{
  const h = M.barisDisplayHtml([UNIT_TURUN], OPSI_BARU);
  cek("perlakuannya tercetak", h.includes("Dijual sebagai unit display"), h.slice(-160));
  cek("harganya tercetak", h.includes("Rp 11.450.000"), h.slice(-160));
  cek("CATATAN perlakuannya tercetak", h.includes("Diskon 18% dari harga normal"), h.slice(-160));
  cek("dipisah titik tengah", h.includes("· Diskon 18%"));
  cek("baris turun dikelabukan", h.includes("background:#faf9fc"));
  cek("kolom kondisi jadi strip", h.includes("<td>—</td>"));
}

console.log("\n=== 2. Jalur cetak LAMA tidak berubah ===");
// Berita Acara periode sebelum September 2026 tidak boleh berubah bentuknya,
// walaupun berarti catatan itu tetap tidak tercetak di sana.
{
  const h = M.barisDisplayHtml([UNIT_TURUN], OPSI_LAMA);
  cek("perlakuan & harga tetap ada", h.includes("Dijual sebagai unit display") && h.includes("Rp 11.450.000"));
  cek("catatan perlakuan TIDAK ikut", !h.includes("Diskon 18%"), h.slice(-140));
}

console.log("\n=== 3. Cacat 2: kelas warna ikut yang diminta ===");
// Gaya cetak format baru hanya mendefinisikan k-ok/k-bad. Dengan status-*
// kolom umur tercetak tanpa warna dan unit lewat batas berhenti menonjol.
{
  const baru = M.barisDisplayHtml([UNIT_LEWAT], OPSI_BARU);
  const lama = M.barisDisplayHtml([UNIT_LEWAT], OPSI_LAMA);
  cek("format baru memakai k-bad", baru.includes('class="k-bad"'), baru.match(/class="[a-z-]*"/g)?.join(" "));
  cek("format baru TIDAK memakai status-bad", !baru.includes("status-bad"));
  cek("format lama memakai status-bad", lama.includes('class="status-bad"'));
  cek("format lama TIDAK memakai k-bad", !lama.includes('class="k-bad"'));
  const aman = M.barisDisplayHtml([UNIT_PROGRAM], OPSI_BARU);
  cek("unit dalam batas memakai k-ok", aman.includes('class="k-ok"'), aman.match(/class="[a-z-]*"/g)?.join(" "));
}

console.log("\n=== 4. Umur dihitung terhadap TANGGAL AUDIT ===");
// Berita Acara Agustus yang dicetak ulang bulan Desember harus memuat angka
// yang sama. Kalau umurnya dihitung dari "hari ini", dokumen yang sudah
// ditandatangani berubah angkanya tiap kali dibuka.
{
  cek("9 Juli -> 19 September = 72 hari", M.umurTerhadap("2026-07-09", "2026-09-19") === 72,
    M.umurTerhadap("2026-07-09", "2026-09-19"));
  cek("lewat 12 hari dari batas 60", M.barisDisplayHtml([UNIT_LEWAT], OPSI_BARU).includes("72 hr / 60 · lewat 12"),
    M.barisDisplayHtml([UNIT_LEWAT], OPSI_BARU).match(/\d+ hr[^<]*/)?.[0]);
  const lain = M.barisDisplayHtml([UNIT_LEWAT], { ...OPSI_BARU, tglAudit: "2026-08-19" });
  cek("tanggal audit lain -> umur lain", lain.includes("41 hr / 60"), lain.match(/\d+ hr[^<]*/)?.[0]);
  cek("tanggal audit kosong -> 0, bukan melompat", M.umurTerhadap("2026-07-09", null) === 0);
  cek("tanggal pajang kosong -> 0", M.umurTerhadap(null, "2026-09-19") === 0);
  cek("tanggal ngawur tidak melempar", M.umurTerhadap("bukan-tanggal", "2026-09-19") === 0);
}

console.log("\n=== 5. Program brand & catatan kondisi ===");
{
  const h = M.barisDisplayHtml([UNIT_PROGRAM], OPSI_BARU);
  cek("nama programnya tercetak", h.includes("Program: Lenovo Pro Display Q3"));
  cek("catatan kondisinya ikut", h.includes("Stiker program masih terpasang"), h.slice(-160));
  const biasa = M.barisDisplayHtml([UNIT_LEWAT], OPSI_BARU);
  cek("tanpa program: catatan kondisi jadi isi kolomnya",
    biasa.includes("Goresan tipis di sudut layar kiri"));
  const kosong = M.barisDisplayHtml([{ ...UNIT_LEWAT, kondisi_catatan: "" }], OPSI_BARU);
  cek("tanpa catatan sama sekali -> strip", kosong.includes("<td>-</td>"));
}

console.log("\n=== 6. Label kondisi & perlakuan dari master ===");
{
  const h = M.barisDisplayHtml([UNIT_LEWAT], OPSI_BARU);
  cek("label kondisi dari master", h.includes("Lecet ringan / debu membandel"));
  const takDikenal = M.barisDisplayHtml([{ ...UNIT_LEWAT, kondisi_kode: "entah" }], OPSI_BARU);
  cek("kode tak dikenal jadi strip, bukan kode mentah",
    takDikenal.includes("<td>—</td>") && !takDikenal.includes("entah"), takDikenal.slice(-200));
}

console.log("\n=== 7. Tanpa unit sama sekali ===");
{
  const h = M.barisDisplayHtml([], OPSI_BARU);
  cek("ada baris penjelas, bukan tabel kosong melompong", h.includes("Belum ada unit display tercatat"));
  cek("menutupi 6 kolom", h.includes('colspan="6"'));
  cek("null tidak melempar", M.barisDisplayHtml(null, OPSI_BARU).includes("Belum ada unit"));
}

console.log("\n=== 8. Teks berbahaya tidak lolos mentah ===");
{
  const h = M.barisDisplayHtml([{
    ...UNIT_LEWAT, brand: '<script>alert(1)</script>', kondisi_catatan: 'A"B & C<D',
  }], OPSI_BARU);
  cek("tag script diloloskan sebagai teks", !h.includes("<script>alert(1)</script>"));
  cek("kutip & ampersand dikawal", h.includes("A&quot;B &amp; C&lt;D"), h.slice(-170));
}

console.log("\n=== 9. PEMANGGILNYA memakai kelas yang benar ===");
// Bagian 1-8 menguji pustakanya. Pustaka yang benar tetap bisa dipanggil
// dengan kelas yang salah — dan justru itulah cacat aslinya. Karena itu
// BeritaAcara.js dibaca langsung: jalur mana memberi kelas apa.
{
  const ba = fs.readFileSync(cariBerkas("components/BeritaAcara.js"), "utf8");
  const panggilan = [...ba.matchAll(/barisDisplayHtml\(dUnit,\s*\{([\s\S]*?)\}\);/g)].map((m) => m[1]);
  cek("barisDisplayHtml dipanggil dua kali (jalur lama & baru)", panggilan.length === 2, panggilan.length);

  const lama = panggilan.find((p) => p.includes("status-"));
  const baru = panggilan.find((p) => p.includes("k-ok"));
  cek("jalur LAMA memakai status-*", !!lama, "(tidak ketemu)");
  cek("jalur LAMA tidak menyertakan catatan perlakuan",
    !!lama && /sertakanCatatan:\s*false/.test(lama), (lama || "").trim().slice(0, 90));
  cek("jalur BARU memakai k-ok/k-bad",
    !!baru && baru.includes("k-bad"), (baru || "(tidak ketemu)").trim().slice(0, 90));
  cek("jalur BARU tidak memakai status-*", !!baru && !baru.includes("status-"));
  cek("jalur BARU menyertakan catatan perlakuan",
    !!baru && /sertakanCatatan:\s*true/.test(baru), (baru || "").trim().slice(0, 90));
  cek("keduanya memberi tanggal audit, bukan hari ini",
    panggilan.every((p) => p.includes("tglAudit: auditDate")),
    panggilan.map((p) => (p.match(/tglAudit:[^,]*/) || ["?"])[0]).join(" | "));

  // Gaya cetak format baru memang hanya punya k-*; kalau suatu saat ia
  // menambah .status-*, pagar di atas jadi kurang berarti dan perlu ditinjau.
  const gaya = fs.readFileSync(cariBerkas("components/BeritaAcaraCetakBaru.js"), "utf8");
  cek("gaya cetak baru memang tidak mendefinisikan .status-*",
    !gaya.includes(".status-bad") && !gaya.includes(".status-ok"));
  cek("gaya cetak baru mendefinisikan .k-ok & .k-bad",
    gaya.includes(".k-ok{") && gaya.includes(".k-bad{"));
}

fs.unlinkSync(tmp);
console.log("\n====================================================");
console.log("  LOLOS: " + lolos + "   GAGAL: " + gagal);
console.log("====================================================");
process.exit(gagal ? 1 : 0);
