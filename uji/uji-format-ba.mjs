// Menguji lib/format-ba.js milik repo produksi.
//
// Berkasnya berekstensi .js di paket tanpa "type":"module", jadi Node
// membacanya sebagai CommonJS dan `import` menolaknya. Yang diuji tetap
// ISI ASLINYA: disalin apa adanya ke berkas .mjs sementara, byte per byte,
// lalu diimpor. Kalau disalinnya gagal, ujinya berhenti — bukan lolos diam.
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

const asal = cariBerkas("lib/format-ba.js");
const isi = fs.readFileSync(asal);
const tmp = path.join(os.tmpdir(), "format-ba-uji-" + isi.length + ".mjs");
fs.writeFileSync(tmp, isi);
if (fs.readFileSync(tmp).length !== isi.length) throw new Error("salinan tidak utuh");

const M = await import("file://" + tmp.replace(/\\/g, "/"));

let lolos = 0, gagal = 0;
function cek(nama, syarat, info) {
  if (syarat) { lolos++; console.log("  OK    " + nama); }
  else { gagal++; console.log("  GAGAL " + nama + (info !== undefined ? "  -> " + info : "")); }
}

console.log("\n=== 1. Tanggal berlaku ===");
cek("konstantanya September 2026", M.FORMAT_BA_MULAI === "2026-09", M.FORMAT_BA_MULAI);
cek("September 2026 pakai format baru", M.pakaiFormatBaru("2026-09") === true);
cek("Oktober 2026 pakai format baru", M.pakaiFormatBaru("2026-10") === true);
cek("Januari 2027 pakai format baru", M.pakaiFormatBaru("2027-01") === true);
cek("Agustus 2026 pakai format LAMA", M.pakaiFormatBaru("2026-08") === false);
cek("Desember 2025 pakai format LAMA", M.pakaiFormatBaru("2025-12") === false);

console.log("\n=== 2. Masukan cacat jatuh ke format LAMA, bukan baru ===");
for (const buruk of [null, undefined, "", "2026-9", "2026", "sept", 202609, {}, "9999-99-99"]) {
  cek("tolak " + JSON.stringify(buruk), M.pakaiFormatBaru(buruk) === false, M.pakaiFormatBaru(buruk));
}

console.log("\n=== 3. Katalog item ===");
cek("10 kategori", M.INVENTARIS_ITEMS.length === 10, M.INVENTARIS_ITEMS.length);
cek("36 item", M.semuaKunciItem().length === 36, M.semuaKunciItem().length);
cek("tidak ada kunci kembar", new Set(M.semuaKunciItem()).size === 36);
cek("APAR ada di Peralatan Keamanan", M.semuaKunciItem().includes("Peralatan Keamanan|APAR"));
cek("blower & solder sudah tidak ada",
  !M.semuaKunciItem().some((k) => /blower|solder/i.test(k)),
  M.semuaKunciItem().filter((k) => /blower|solder/i.test(k)).join(","));
cek("Access Point & Switch sudah tidak ada",
  !M.semuaKunciItem().some((k) => /access point|switch/i.test(k)));

console.log("\n=== 4. Bentuk data dikenali ===");
const lama = { "Peralatan Kasir": { status: "Rusak" }, "Penerangan": { status: "Berfungsi" } };
const baru = { "Peralatan Kasir|Printer struk": { status: "Rusak" } };
cek("bentuk lama bukan per item", M.bentukPerItem(lama) === false);
cek("bentuk baru dikenali per item", M.bentukPerItem(baru) === true);
cek("data kosong dianggap bentuk lama", M.bentukPerItem(null) === false);

console.log("\n=== 5. Status kategori sebanding di kedua bentuk ===");
cek("lama: kasir rusak", M.statusKategori(lama, "Peralatan Kasir") === "Rusak");
cek("baru: satu item rusak -> kategori rusak",
  M.statusKategori(baru, "Peralatan Kasir") === "Rusak");
cek("baru: tak ada yang rusak -> berfungsi",
  M.statusKategori({ "Peralatan Kasir|Laci uang": { status: "Berfungsi" } }, "Peralatan Kasir") === "Berfungsi");
// Inilah pagar yang menjaga angka Kepatuhan SOP tidak melompat di September.
const empatRusak = {};
["Komputer kasir", "Printer struk", "Laci uang", "Barcode scanner"].forEach((i) => {
  empatRusak["Peralatan Kasir|" + i] = { status: "Rusak" };
});
cek("4 item rusak tetap dihitung SATU kategori",
  M.statusKategori(empatRusak, "Peralatan Kasir") === "Rusak");
// Regresi bug DIAM: SopKepatuhan.js dulu membaca data["Peralatan Kasir"]
// langsung. Pada bentuk per item nilainya undefined, jadi temuan jatuh ke NOL
// tanpa satu pun galat — kepatuhan tampak sempurna justru saat datanya rinci.
cek("indeks langsung memang undefined pada bentuk per item",
  empatRusak["Peralatan Kasir"] === undefined);
cek("statusKategori tetap menemukannya",
  M.statusKategori(empatRusak, "Peralatan Kasir") === "Rusak");

console.log("\n=== 6. Keadaan 'Tidak ada' ===");
const sebagianTiada = { "Kendaraan & Mesin|Motor operasional": { status: "Tidak ada" } };
cek("sebagian tidak ada -> kategori tetap berfungsi",
  M.statusKategori(sebagianTiada, "Kendaraan & Mesin") === "Berfungsi",
  M.statusKategori(sebagianTiada, "Kendaraan & Mesin"));
const semuaTiada = {
  "Kendaraan & Mesin|Motor operasional": { status: "Tidak ada" },
  "Kendaraan & Mesin|Printer kantor": { status: "Tidak ada" },
};
cek("semua tidak ada -> kategori tidak ada",
  M.statusKategori(semuaTiada, "Kendaraan & Mesin") === "Tidak ada",
  M.statusKategori(semuaTiada, "Kendaraan & Mesin"));
cek("'Tidak ada' TIDAK dihitung rusak",
  M.statusKategori(semuaTiada, "Kendaraan & Mesin") !== "Rusak");

console.log("\n=== 7. Nama periode ===");
cek("2026-09 -> September 2026", M.namaPeriode("2026-09") === "September 2026", M.namaPeriode("2026-09"));
cek("2026-01 -> Januari 2026", M.namaPeriode("2026-01") === "Januari 2026");
cek("2026-12 -> Desember 2026", M.namaPeriode("2026-12") === "Desember 2026");

fs.unlinkSync(tmp);
console.log("\n====================================================");
console.log("  LOLOS: " + lolos + "   GAGAL: " + gagal);
console.log("====================================================");
process.exit(gagal ? 1 : 0);
