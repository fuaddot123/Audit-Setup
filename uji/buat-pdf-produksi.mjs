// Membangkitkan berkas HTML cetakan FORMAT BARU dari modul repo PRODUKSI,
// supaya bisa dicetak Chrome jadi PDF dan diperiksa halamannya.
// Dua ukuran: cabang sepi (3 unit) dan cabang ramai (21 unit) — yang diuji
// bukan cuma isinya, tapi apakah tanda tangan tetap di halaman TERAKHIR
// ketika isinya tumbuh.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cetak-pdf-"));
fs.mkdirSync(path.join(tmp, "lib"));
fs.mkdirSync(path.join(tmp, "components"));
fs.copyFileSync(path.join(repo, "lib", "format-ba.js"), path.join(tmp, "lib", "format-ba.mjs"));
fs.writeFileSync(
  path.join(tmp, "components", "BeritaAcaraCetakBaru.mjs"),
  fs.readFileSync(path.join(repo, "components", "BeritaAcaraCetakBaru.js"), "utf8")
    .replace('from "../lib/format-ba"', 'from "../lib/format-ba.mjs"')
);
const M = await import("file://" + path.join(tmp, "components", "BeritaAcaraCetakBaru.mjs").replace(/\\/g, "/"));
const FB = await import("file://" + path.join(tmp, "lib", "format-ba.mjs").replace(/\\/g, "/"));

const inv = {};
FB.semuaKunciItem().forEach((k) => { inv[k] = { status: "Berfungsi", keterangan: "", photos: [] }; });
inv["Listrik & Utilitas|AC ruang display"] = { status: "Rusak", keterangan: "Tidak dingin, suhu ruangan 29 derajat", photos: [] };
inv["Penerangan|Lampu etalase"] = { status: "Rusak", keterangan: "2 titik mati, belum diganti", photos: [] };
inv["Peralatan Keamanan|APAR"] = { status: "Tidak ada", keterangan: "Belum tersedia di cabang ini", photos: [] };

const MERK = [
  ["ASUS", "ROG Strix G16", "4KN0CV02X", "2026-07-09", 72, "Lecet ringan"],
  ["Lenovo", "ThinkPad X1 Carbon", "PF3TQ9L2", "2026-07-26", 55, "Baik"],
  ["Acer", "Swift Go 14", "NXKF6SN001", "2026-08-25", 25, "Baik"],
  ["HP", "Pavilion Plus 14", "5CD3210XYZ", "2026-09-07", 12, "Baik"],
  ["MSI", "Katana 15", "K1552089", "2026-06-20", 91, "Lecet berat"],
  ["ASUS", "Vivobook 14 X1404", "M4KL220931", "2026-08-02", 48, "Baik"],
  ["ASUS", "TUF Gaming A15", "N7TF551120", "2026-07-15", 66, "Baik"],
  ["Lenovo", "IdeaPad Slim 5", "YT8830021", "2026-08-11", 39, "Baik"],
  ["Lenovo", "LOQ 15", "LQ1550889", "2026-07-03", 78, "Lecet ringan"],
  ["HP", "Victus 15", "8CG4410231", "2026-08-21", 29, "Baik"],
  ["HP", "EliteBook 640", "5CD9911028", "2026-06-28", 83, "Baik"],
  ["Acer", "Nitro V 15", "NX7781AC01", "2026-07-20", 61, "Baik"],
  ["Acer", "Aspire Lite 14", "NX2210AL55", "2026-09-02", 17, "Baik"],
  ["MSI", "Modern 14", "MS1440221", "2026-08-08", 42, "Baik"],
  ["MSI", "Thin 15", "MS1550310", "2026-07-26", 55, "Baik"],
  ["Dell", "Inspiron 14", "DL14X9921", "2026-08-30", 20, "Baik"],
  ["Dell", "Latitude 3440", "DL34400112", "2026-07-31", 50, "Baik"],
  ["Samsung", "Galaxy Book4", "SM4X118820", "2026-09-04", 15, "Baik"],
  ["Axioo", "Mybook Hype 5", "AX5H220110", "2026-08-16", 34, "Baik"],
  ["Infinix", "Inbook Y3 Max", "IF3M990021", "2026-09-06", 13, "Baik"],
  ["Huawei", "MateBook D14", "HW14D330210", "2026-07-09", 72, "Lecet ringan"],
];

function barisDisplay(n) {
  return MERK.slice(0, n).map(([b, m, sn, tgl, umur, kondisi]) => {
    const lewat = umur > 60;
    return `<tr><td style="font-weight:600;">${b} ${m}</td><td>${sn}</td><td>${tgl}</td>`
      + `<td class="${lewat ? "k-bad" : "k-ok"}">${umur} hr / 60${lewat ? " &middot; lewat " + (umur - 60) : ""}</td>`
      + `<td>${kondisi}</td><td>-</td></tr>`;
  }).join("");
}

const stok = "<tr><td><b>KATEGORI 1</b></td><td>LAPTOP GAMING</td><td class=\"k-ok\">LENGKAP</td><td>-</td></tr>"
  + "<tr><td></td><td>LAPTOP THIN &amp; LIGHT</td><td class=\"k-ok\">LENGKAP</td><td>-</td></tr>"
  + "<tr><td></td><td>AKSESORIS MOUSE</td><td class=\"k-bad\">SELISIH</td><td>Kurang 2 pcs</td></tr>"
  + "<tr><td><b>KATEGORI 2</b></td><td>TAS &amp; SLEEVE</td><td class=\"k-ok\">LENGKAP</td><td>-</td></tr>"
  + "<tr><td></td><td>KABEL &amp; ADAPTOR</td><td class=\"k-ok\">LENGKAP</td><td>-</td></tr>";

for (const [nama, jml] of [["sepi", 3], ["ramai", 21]]) {
  const html = M.cetakBaruHtml({
    cabang: "Semarang", periodeTeks: "September 2026",
    tanggalCetakTeks: "19 September 2026", waktuAudit: "09.00 - 13.30",
    auditor: "Fuad Hasan", teamLeader: "Dewi Anggraini", storeManager: "Rizal Pratama",
    inventaris: inv,
    stokBarisHtml: stok, stokTotal: 5, stokSelisih: 1, stokPct: 80, kat1Pct: 67, kat2Pct: 100,
    displayBarisHtml: barisDisplay(jml), displayFotoHtml: "",
    displayDipajang: jml, displayLewat: MERK.slice(0, jml).filter((x) => x[4] > 60).length,
    displayBatas: 60,
    skorD: { skor_display: 81, skor_umur: 85, skor_kondisi: 72, unit_dalam_batas: jml - 3, unit_dinilai: jml },
    displayInfo: { color: "#d98324", lbl: "Perhatian" },
  });
  const tujuan = path.join(sini, "prod-" + nama + ".html");
  fs.writeFileSync(tujuan, html, "utf8");
  console.log("  " + nama + ": " + jml + " unit display, " + Math.round(html.length / 1024) + " KB");
}

fs.rmSync(tmp, { recursive: true, force: true });
