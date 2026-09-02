// Menguji pengurai impor dengan BERKAS SUNGGUHAN dari pemilik:
// monitoring-display-barang-serial_2026-09-01.xlsx
//
// Uji sebelumnya (uji-impor-lib.mjs) memakai contoh susunan saya sendiri, dan
// karena itu ia hijau sementara berkas asli ditolak seluruhnya — 0 dari 31
// baris. Contoh yang dikarang sendiri hanya membuktikan penguraiannya cocok
// dengan bayangan saya tentang berkasnya, bukan dengan berkasnya.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
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

const require = createRequire(import.meta.url);
const XLSX = require(cariBerkas("node_modules/xlsx"));

// Berkas contoh memuat nama produk dan nomor seri sungguhan milik KLA.
// Repo ini PUBLIK, jadi berkasnya sengaja TIDAK ikut di-commit — mintakan ke
// pemilik dan taruh di uji/contoh-monitoring-display.xlsx.
//
// Kalau tidak ada, uji ini BERHENTI dan menyatakan dirinya DILEWATI. Ia tidak
// mencetak "lolos": uji yang diam-diam melompat lalu tampak hijau adalah cara
// paling halus membuat orang mengira ada penjagaan padahal tidak ada.
let BERKAS;
try {
  BERKAS = cariBerkas("uji/contoh-monitoring-display.xlsx");
} catch {
  console.log("\n====================================================");
  console.log("  DILEWATI — berkas contoh tidak ada, TIDAK ADA yang diuji.");
  console.log("  Taruh berkas laporan monitoring display di:");
  console.log("     uji/contoh-monitoring-display.xlsx");
  console.log("  Berkasnya tidak disertakan karena repo ini publik dan isinya");
  console.log("  nomor seri sungguhan.");
  console.log("====================================================");
  process.exit(0);
}
const asal = cariBerkas("lib/impor-display.js");
const tmp = path.join(os.tmpdir(), "impor-asli-" + fs.statSync(asal).size + ".mjs");
fs.copyFileSync(asal, tmp);
const M = await import("file://" + tmp.replace(/\\/g, "/"));

let lolos = 0, gagal = 0;
function cek(nama, syarat, info) {
  if (syarat) { lolos++; console.log("  OK    " + nama); }
  else { gagal++; console.log("  GAGAL " + nama + (info !== undefined ? "  -> " + info : "")); }
}

// Dibaca persis seperti komponen membacanya.
const wb = XLSX.readFile(BERKAS);
const matriks = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" });

console.log("\n=== 1. Berkas asli terbaca utuh ===");
const r = M.olahMatriks(matriks, { cabang: "Semarang" });
cek("tidak ditolak", r.galat === null, r.galat);
cek("dikenali sebagai bentuk stok-serial", r.bentuk === "stok-serial", r.bentuk);
cek("31 baris data terbaca", r.terbaca === 31, r.terbaca);
cek("31 baris SAH — tidak ada yang hilang diam-diam", r.rows.length === 31, r.rows.length);
cek("tidak ada yang ditolak", r.ditolak.length === 0, JSON.stringify(r.ditolak.slice(0, 2)));

console.log("\n=== 2. Baris judul BUKAN baris pertama ===");
// Baris 1 berkas ini berisi nama laporan, bukan kolom. Pengurai lama
// menganggap baris pertama pasti kepala tabel, dan menolak seluruh berkas.
const judul = M.cariJudul(matriks);
cek("kepala tabel ada di baris ke-2 (indeks 1)", judul.baris === 1, judul.baris);
cek("kolom Nama ketemu", judul.peta.nama === 1, judul.peta.nama);
cek("kolom SN ketemu", judul.peta.serial === 2, judul.peta.serial);
cek("kolom Umur Display ketemu", judul.peta.umurDisplay === 4, judul.peta.umurDisplay);
cek("kolom Cabang ketemu", judul.peta.cabang === 6, judul.peta.cabang);

console.log("\n=== 3. Tanggal acuan diambil dari judul berkas ===");
cek("acuan = 2026-09-01", r.acuan === "2026-09-01", r.acuan);

console.log("\n=== 4. Umur -> tanggal pajang, dihitung mundur ===");
const satu = r.rows[0];
cek("baris 1 umur 22 hari", satu._umurDisplay === 22, satu._umurDisplay);
cek("baris 1 mulai pajang 2026-08-10", satu.tanggal_pajang === "2026-08-10", satu.tanggal_pajang);
cek("umur 1 hari -> 2026-08-31", M.mundurHari("2026-09-01", 1) === "2026-08-31", M.mundurHari("2026-09-01", 1));
cek("umur 0 hari -> hari acuan itu sendiri", M.mundurHari("2026-09-01", 0) === "2026-09-01");
cek("umur 69 hari -> 2026-06-24", M.mundurHari("2026-09-01", 69) === "2026-06-24", M.mundurHari("2026-09-01", 69));
// Melewati batas bulan DAN batas tahun sekaligus.
cek("mundur melewati tahun", M.mundurHari("2026-01-05", 10) === "2025-12-26", M.mundurHari("2026-01-05", 10));

console.log("\n=== 5. Semua tanggal cocok dengan umurnya ===");
let melesetTgl = 0;
r.rows.forEach((x) => {
  if (M.mundurHari(r.acuan, x._umurDisplay) !== x.tanggal_pajang) melesetTgl++;
});
cek("31 tanggal konsisten dengan umurnya", melesetTgl === 0, melesetTgl + " meleset");

console.log("\n=== 6. Unit lewat batas 60 hari tetap terlihat ===");
const lewat = r.rows.filter((x) => x._umurDisplay > 60);
cek("4 unit lewat batas 60 hari", lewat.length === 4, lewat.length);
cek("yang tertua 69 hari", Math.max(...r.rows.map((x) => x._umurDisplay)) === 69);

console.log("\n=== 7. Serial ikut, tidak ada yang kosong/kembar ===");
cek("semua serial terbaca", r.rows.every((x) => x.serial_number), r.rows.filter((x) => !x.serial_number).length);
cek("31 serial berbeda", new Set(r.rows.map((x) => x.serial_number)).size === 31);
// Diadu ke SEL ASLINYA di berkas, bukan ke nilai yang diketik ulang di sini.
// Dua alasan: ia menguji hal yang sebenarnya penting (nilainya dibawa utuh
// dari berkas ke baris hasil), dan nomor seri sungguhan tidak ikut tertulis
// di repo yang publik.
const snAsli = String(matriks[2][2]).trim();
cek("serial baris 1 dibawa utuh dari berkas",
  snAsli.length > 8 && r.rows[0].serial_number === snAsli,
  "panjang " + snAsli.length + " vs " + String(r.rows[0].serial_number).length);

console.log("\n=== 8. Brand: ditebak dari nama, yang ragu DIBIARKAN kosong ===");
// Ketetapan pemilik 1 Sep 2026: pola kode model 14-EP/14-EM = HP, V16 = ASUS.
cek("semua 31 nama ketebak brand-nya", r.brandKosong === 0, r.brandKosong);
cek("Ideapad -> Lenovo", M.tebakBrand("Ideapad Slim 3 83UQ003CID") === "Lenovo");
cek("Vivobook -> ASUS", M.tebakBrand("Vivobook Go 14 E1404FA") === "ASUS");
cek("Aspire -> Acer", M.tebakBrand("Aspire Lite AL14-32P") === "Acer");
cek("Mybook -> Axioo", M.tebakBrand("Mybook Hype 5 (X5-2)") === "Axioo");
cek("Victus -> HP", M.tebakBrand("Victus 15 FA2717TX") === "HP");
cek("LOQ -> Lenovo", M.tebakBrand("LOQ ESS 83S000D1ID") === "Lenovo");
cek("14-EP1177TU -> HP", M.tebakBrand("14-EP1177TU") === "HP", M.tebakBrand("14-EP1177TU"));
cek("14 EP0261TU -> HP", M.tebakBrand("14 EP0261TU") === "HP", M.tebakBrand("14 EP0261TU"));
cek("14-EM0321AU -> HP", M.tebakBrand("14-EM0321AU") === "HP", M.tebakBrand("14-EM0321AU"));
cek("V16 V3607VJ -> ASUS", M.tebakBrand("V16 V3607VJ-I535B1T-HM") === "ASUS", M.tebakBrand("V16 V3607VJ-I535B1T-HM"));
// Pola HP DIIKAT KE AWAL nama, dan ini pagarnya. Nama yang menyebut brand
// lain lebih dulu tetapi memuat kode mirip HP di tengahnya harus jatuh ke
// brand aslinya. Tanpa jangkar "^", POLA_BRAND diperiksa duluan dan nama ini
// jadi HP — salah brand berarti salah batas umur pajang.
cek("Mybook 14 EM Lite tetap Axioo, bukan HP",
  M.tebakBrand("Mybook 14 EM Lite") === "Axioo", M.tebakBrand("Mybook 14 EM Lite"));
cek("Aspire 14-EP Series tetap Acer",
  M.tebakBrand("Aspire 14-EP Series") === "Acer", M.tebakBrand("Aspire 14-EP Series"));
cek("Vivobook Go 14 E1404FA tetap ASUS", M.tebakBrand("Vivobook Go 14 E1404FA-VIPS3853M") === "ASUS");
cek("nama acak tanpa petunjuk tetap kosong", M.tebakBrand("Barang Contoh XYZ") === "", M.tebakBrand("Barang Contoh XYZ"));
cek("nama kosong tidak ditebak", M.tebakBrand("") === "");
// Yang penting bukan cuma "menebak", tapi menandai bahwa ia tebakan.
cek("baris yang ketebak diberi tanda", r.rows[0]._brandDitebak === true);
cek("14-EP1177TU kini ikut ditandai tebakan",
  r.rows.find((x) => x.model === "14-EP1177TU")._brandDitebak === true);

console.log("\n=== 9. Cabang lain DITOLAK, tidak ikut masuk ===");
const rLain = M.olahMatriks(matriks, { cabang: "Yogyakarta" });
cek("semua 31 baris ditolak", rLain.rows.length === 0 && rLain.ditolak.length === 31, rLain.rows.length);
cek("sebabnya menyebut cabangnya", rLain.ditolak[0].sebab.includes("Semarang"), rLain.ditolak[0].sebab);
cek("cabang lain didaftar & dihitung", rLain.cabangLain.Semarang === 31, JSON.stringify(rLain.cabangLain));
const rTanpa = M.olahMatriks(matriks, {});
cek("tanpa menyebut cabang, semua diterima", rTanpa.rows.length === 31, rTanpa.rows.length);

console.log("\n=== 10. Tanpa acuan, DITOLAK — bukan diisi hari ini ===");
// Judulnya dibuang supaya tidak ada tanggal di mana pun.
const tanpaJudul = matriks.slice(1).map((b) => b.slice());
const rTanpaAcuan = M.olahMatriks(tanpaJudul, { cabang: "Semarang" });
cek("ditolak menyeluruh", !!rTanpaAcuan.galat, rTanpaAcuan.galat);
cek("alasannya menyebut acuan", rTanpaAcuan.galat.includes("acuan"));
const rPakaiOpsi = M.olahMatriks(tanpaJudul, { cabang: "Semarang", tanggalAcuan: "2026-09-01" });
cek("acuan dari pemanggil dipakai", rPakaiOpsi.rows.length === 31 && rPakaiOpsi.acuan === "2026-09-01",
  rPakaiOpsi.rows.length + " / " + rPakaiOpsi.acuan);
cek("hasilnya sama persis dengan acuan dari berkas",
  rPakaiOpsi.rows[0].tanggal_pajang === r.rows[0].tanggal_pajang);

console.log("\n=== 11. Umur cacat ditolak beserta sebabnya ===");
const rusak = matriks.map((b) => b.slice());
rusak[2][4] = "dua puluh";
rusak[3][4] = "";
rusak[4][4] = "99999";
const rRusak = M.olahMatriks(rusak, { cabang: "Semarang" });
cek("3 baris ditolak", rRusak.ditolak.length === 3, rRusak.ditolak.length);
cek("28 sisanya tetap masuk", rRusak.rows.length === 28, rRusak.rows.length);
cek("umur bukan angka disebut", rRusak.ditolak[0].sebab.includes("dua puluh"), rRusak.ditolak[0].sebab);
cek("umur kosong disebut", rRusak.ditolak[1].sebab.includes("kosong"), rRusak.ditolak[1].sebab);
cek("umur tak masuk akal ditolak", rRusak.ditolak[2].sebab.includes("tidak masuk akal"), rRusak.ditolak[2].sebab);
cek("nomor barisnya sesuai berkas (baris 3)", rRusak.ditolak[0].baris === 3, rRusak.ditolak[0].baris);

console.log("\n=== 12. Bentuk lama tetap jalan (tidak ada yang dirusak) ===");
const lamaHasil = M.olahMatriks(M.pecahTeksTabel(
  "Brand,Model,Serial Number,Tanggal Pajang,Program\n"
  + "ASUS,Zenbook 14 OLED,M2N0AS1122,2026-09-01,\n"
  + "Lenovo,Yoga Slim 7,PF5TR8K1,18/08/2026,Lenovo Pro Display Q3\n"));
cek("dikenali bentuk umum", lamaHasil.bentuk === "umum", lamaHasil.bentuk);
cek("2 baris sah", lamaHasil.rows.length === 2, lamaHasil.rows.length);
cek("tanggalnya tetap benar", lamaHasil.rows[1].tanggal_pajang === "2026-08-18");

console.log("\n=== 13. Yang masuk ke daftar unit: hanya bidang yang disepakati ===");
// Meniru persis pemetaan di imporDisplay() pada BeritaAcara.js. Yang diuji:
// kolom bantuan berawalan "_" TIDAK boleh ikut tersimpan — ia cuma untuk
// dilihat di pratinjau, dan menambah kolom diam-diam ke tabel display berarti
// data yang tidak pernah disepakati bentuknya.
const unit = r.rows.map((x) => ({
  brand: x.brand,
  model: x.model,
  serial_number: x.serial_number || "",
  tanggal_pajang: x.tanggal_pajang,
  program_nama: x.program_nama || "",
  program_brand: !!x.program_nama,
}));
cek("31 unit terbentuk", unit.length === 31);
cek("tidak ada bidang berawalan _", !unit.some((u) => Object.keys(u).some((k) => k.startsWith("_"))));
cek("semua punya tanggal pajang", unit.every((u) => /^\d{4}-\d{2}-\d{2}$/.test(u.tanggal_pajang)));
cek("tidak ada program yang terisi sendiri", unit.every((u) => u.program_nama === "" && u.program_brand === false));
cek("kondisi TIDAK ikut terisi", !unit.some((u) => "kondisi_kode" in u && u.kondisi_kode));
cek("tidak ada lagi brand kosong",
  unit.filter((u) => !u.brand).length === 0, unit.filter((u) => !u.brand).length);

fs.unlinkSync(tmp);
console.log("\n====================================================");
console.log("  LOLOS: " + lolos + "   GAGAL: " + gagal);
console.log("====================================================");
process.exit(gagal ? 1 : 0);
