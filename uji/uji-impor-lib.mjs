// Menguji lib/impor-display.js milik repo produksi.
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

const asal = cariBerkas("lib/impor-display.js");
const isi = fs.readFileSync(asal);
const tmp = path.join(os.tmpdir(), "impor-display-uji-" + isi.length + ".mjs");
fs.writeFileSync(tmp, isi);
const M = await import("file://" + tmp.replace(/\\/g, "/"));

let lolos = 0, gagal = 0;
function cek(nama, syarat, info) {
  if (syarat) { lolos++; console.log("  OK    " + nama); }
  else { gagal++; console.log("  GAGAL " + nama + (info !== undefined ? "  -> " + info : "")); }
}

console.log("\n=== 1. Tanggal dari tiga bentuk ===");
cek("serial Excel 46266 -> 2026-09-01", M.tanggalDari(46266) === "2026-09-01", M.tanggalDari(46266));
cek("serial Excel 46235 -> 2026-08-01", M.tanggalDari("46235") === "2026-08-01", M.tanggalDari("46235"));
cek("18/07/2026 -> 2026-07-18", M.tanggalDari("18/07/2026") === "2026-07-18", M.tanggalDari("18/07/2026"));
cek("1-9-2026 -> 2026-09-01", M.tanggalDari("1-9-2026") === "2026-09-01", M.tanggalDari("1-9-2026"));
cek("2026-08-12 dibiarkan", M.tanggalDari("2026-08-12") === "2026-08-12");
cek("spasi di sekelilingnya diabaikan", M.tanggalDari("  2026-08-12 ") === "2026-08-12");

console.log("\n=== 2. Yang BUKAN tanggal ditolak, bukan dikarang ===");
for (const buruk of ["", null, undefined, "kemarin", "32/13/2026", "12", "1500", "99999", "abc", "2026/13/01"]) {
  cek("tolak " + JSON.stringify(buruk), M.tanggalDari(buruk) === null, M.tanggalDari(buruk));
}

console.log("\n=== 3. Judul kolom bebas nama & urutan ===");
const p = M.petakanKolom(["No Seri", "Merk", "Nama Barang", "Tgl Pajang", "Program Display"]);
cek("serial dikenali", p.serial === 0, p.serial);
cek("brand dikenali", p.brand === 1, p.brand);
cek("model dikenali", p.model === 2, p.model);
cek("pajang dikenali", p.pajang === 3, p.pajang);
cek("program dikenali", p.program === 4, p.program);
cek("judul beda huruf besar-kecil tetap kena", M.petakanKolom(["BRAND"]).brand === 0);

console.log("\n=== 4. Pecah teks: TSV, CSV, titik koma ===");
cek("TSV", M.pecahTeksTabel("a\tb\nc\td").length === 2);
cek("CSV", M.pecahTeksTabel("a,b\nc,d")[1][1] === "d");
cek("titik koma", M.pecahTeksTabel("a;b\nc;d")[0][0] === "a");
cek("baris kosong dibuang", M.pecahTeksTabel("a,b\n\n\nc,d").length === 2);
cek("tanda kutip pembungkus dilepas", M.pecahTeksTabel('"a","b"')[0][0] === "a");

console.log("\n=== 5. Olah matriks utuh ===");
const m = M.pecahTeksTabel(
  "Brand,Model,Serial Number,Tanggal Pajang,Program\n"
  + "ASUS,Zenbook 14 OLED,M2N0AS1122,2026-09-01,\n"
  + "Lenovo,Yoga Slim 7,PF5TR8K1,18/08/2026,Lenovo Pro Display Q3\n"
  + "HP,,8CG3021XYZ,2026-09-05,\n"
  + "Acer,Aspire Go 15,NX7781AC01,46266,\n"
);
const r = M.olahMatriks(m);
cek("tidak ada galat menyeluruh", r.galat === null, r.galat);
cek("4 baris terbaca", r.terbaca === 4, r.terbaca);
cek("3 sah", r.rows.length === 3, r.rows.length);
cek("1 ditolak", r.ditolak.length === 1, r.ditolak.length);
cek("sebab penolakan disebut", r.ditolak[0].sebab.includes("model kosong"), r.ditolak[0].sebab);
cek("nomor barisnya benar (baris ke-4 berkas)", r.ditolak[0].baris === 4, r.ditolak[0].baris);
cek("program ikut terbaca", r.rows[1].program_nama === "Lenovo Pro Display Q3");
cek("tanggal dd/mm dikonversi", r.rows[1].tanggal_pajang === "2026-08-18", r.rows[1].tanggal_pajang);
cek("serial Excel dikonversi", r.rows[2].tanggal_pajang === "2026-09-01", r.rows[2].tanggal_pajang);
cek("kolom program kosong tidak merusak baris", r.rows[0].program_nama === "");

console.log("\n=== 5b. Judul yang cocok untuk DUA bentuk sekaligus ===");
// Regresi nyata: "Nama Barang" adalah alias model DAN alias nama, "No Seri"
// alias serial di kedua bentuk. Berkas Brand/Model biasa sempat dikira
// laporan monitoring lalu ditolak seluruhnya — 1 baris terbaca, 0 sah.
const dwiArti = M.olahMatriks(M.pecahTeksTabel(
  "Tanggal Pajang,Merk,Nama Barang,No Seri\n"
  + "2026-09-09,Samsung,Galaxy Book4,SM4X1188\n"));
cek("dikenali sebagai bentuk umum, bukan stok", dwiArti.bentuk === "umum", dwiArti.bentuk);
cek("barisnya sah", dwiArti.rows.length === 1, dwiArti.rows.length + " sah");
cek("brand & model masuk ke tempat yang benar",
  dwiArti.rows[0]?.brand === "Samsung" && dwiArti.rows[0]?.model === "Galaxy Book4",
  JSON.stringify(dwiArti.rows[0]));
// Sebaliknya: begitu ada Umur Display, ia memang laporan monitoring.
const jelasStok = M.olahMatriks(M.pecahTeksTabel(
  "laporan_2026-09-01\nNama,SN,Umur Display,Cabang\nIdeapad Slim 3,ABC123,22,Semarang\n"),
  { cabang: "Semarang" });
cek("dengan Umur Display -> bentuk stok-serial", jelasStok.bentuk === "stok-serial", jelasStok.bentuk);
cek("acuan terbaca dari judul", jelasStok.acuan === "2026-09-01", jelasStok.acuan);
cek("tanggal pajang dihitung mundur", jelasStok.rows[0]?.tanggal_pajang === "2026-08-10",
  jelasStok.rows[0]?.tanggal_pajang);

console.log("\n=== 6. Berkas salah ditolak dengan alasan terbaca ===");
const salah = M.olahMatriks(M.pecahTeksTabel("Nama,Jumlah\nMeja,3\n"));
cek("ditolak", !!salah.galat);
cek("menyebut Brand dan Model", salah.galat.includes("Brand") && salah.galat.includes("Model"), salah.galat);
cek("berkas kosong juga ditolak", !!M.olahMatriks([]).galat);
cek("tidak melempar untuk masukan null", M.olahMatriks(null).rows.length === 0);

console.log("\n=== 7. Tanggal kosong = ditolak, BUKAN diisi hari ini ===");
const tanpaTgl = M.olahMatriks(M.pecahTeksTabel("Brand,Model,Tanggal Pajang\nMSI,Katana 15,\n"));
cek("baris tanpa tanggal ditolak", tanpaTgl.rows.length === 0 && tanpaTgl.ditolak.length === 1);
cek("sebabnya disebut", tanpaTgl.ditolak[0].sebab.includes("tanggal pajang kosong"), tanpaTgl.ditolak[0].sebab);

console.log("\n=== 8. Tanggal ngawur disebut apa adanya di sebab ===");
const ngawur = M.olahMatriks(M.pecahTeksTabel("Brand,Model,Tanggal Pajang\nMSI,Katana 15,kemarin\n"));
cek("ditolak", ngawur.rows.length === 0);
cek("nilai aslinya ikut ditulis", ngawur.ditolak[0].sebab.includes("kemarin"), ngawur.ditolak[0].sebab);

fs.unlinkSync(tmp);
console.log("\n====================================================");
console.log("  LOLOS: " + lolos + "   GAGAL: " + gagal);
console.log("====================================================");
process.exit(gagal ? 1 : 0);
