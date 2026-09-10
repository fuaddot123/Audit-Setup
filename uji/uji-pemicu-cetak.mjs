// Menguji dua hal yang sama-sama membuat tombol "Cetak PDF" tampak rusak,
// dan dua-duanya pernah benar-benar terjadi di produksi.
//
// 1. DOKUMENNYA TIDAK PERNAH MEMANGGIL DIALOG CETAK.
//    Template LAMA memanggil `window.print()` sendiri sesudah halamannya
//    dipaskan — dialog itulah yang dipakai orang untuk "Save as PDF", dan
//    itulah yang mereka sebut "download". Modul cetak format BARU menyalin
//    tata letaknya tetapi TIDAK menyalin pemicunya, jadi sejak periode
//    September tabnya terbuka lalu berhenti di situ. Tidak ada galat, tidak
//    ada dialog, tidak ada berkas.
//
// 2. NAMA DI TITIK PEMANGGILAN TIDAK DIDEKLARASIKAN.
//    `stokPct,` (singkatan dari `stokPct: stokPct`) merujuk variabel yang
//    tidak pernah ada — yang di sekitarnya bernama `stockPct`, dengan "c".
//    Di modul ES itu ReferenceError, dan sebelum ada try/catch tombolnya
//    mati total tanpa satu pesan pun.
//
//    Uji lain memanggil cetakBaruHtml dengan argumen buatannya sendiri, jadi
//    ia TIDAK PERNAH menjalankan titik pemanggilan yang sebenarnya. Di situlah
//    salah ketiknya duduk selama seminggu.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const sini = path.dirname(fileURLToPath(import.meta.url));

function cariBerkas(relatif) {
  const calon = [
    path.join(sini, "..", relatif),
    path.join(sini, "..", "..", relatif),
    path.join(process.cwd(), relatif),
    path.join(sini, "..", "Audit-Setup", relatif),
  ];
  for (const c of calon) if (fs.existsSync(c)) return c;
  throw new Error("Tidak ketemu: " + relatif + "\nDicari di:\n  " + calon.join("\n  "));
}

let lolos = 0, gagal = 0;
function cek(nama, syarat, info) {
  if (syarat) { lolos++; console.log("  OK    " + nama); }
  else { gagal++; console.log("  GAGAL " + nama + (info !== undefined ? "  -> " + info : "")); }
}

// ── Modul cetak disalin ke .mjs supaya bisa diimpor apa adanya ──
const repoLib = path.dirname(cariBerkas("lib/format-ba.js"));
const repo = path.dirname(repoLib);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pemicu-cetak-"));
fs.mkdirSync(path.join(tmp, "lib"));
fs.mkdirSync(path.join(tmp, "components"));
fs.copyFileSync(path.join(repo, "lib", "format-ba.js"), path.join(tmp, "lib", "format-ba.mjs"));
fs.copyFileSync(path.join(repo, "lib", "baris-display.js"), path.join(tmp, "lib", "baris-display.mjs"));
fs.writeFileSync(
  path.join(tmp, "components", "BeritaAcaraCetakBaru.mjs"),
  fs.readFileSync(path.join(repo, "components", "BeritaAcaraCetakBaru.js"), "utf8")
    .replace('from "../lib/format-ba"', 'from "../lib/format-ba.mjs"')
);
const M = await import("file://" + path.join(tmp, "components", "BeritaAcaraCetakBaru.mjs").replace(/\\/g, "/"));
const FB = await import("file://" + path.join(tmp, "lib", "format-ba.mjs").replace(/\\/g, "/"));

const inv = {};
FB.semuaKunciItem().forEach((k) => { inv[k] = { status: "Berfungsi", keterangan: "", photos: [] }; });

const DASAR = {
  cabang: "Semarang", periodeTeks: "September 2026",
  tanggalCetakTeks: "19 September 2026", waktuAudit: "09.00 - 13.30",
  auditor: "Auditor Contoh", teamLeader: "TL Contoh", storeManager: "SM Contoh",
  inventaris: inv,
  stokBarisHtml: "<tr><td>-</td><td>-</td><td>-</td><td>-</td></tr>",
  stokTotal: 5, stokSelisih: 1, stokPct: 80, kat1Pct: 67, kat2Pct: 100,
  displayBarisHtml: "<tr><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td></tr>",
  displayFotoHtml: "", displayDipajang: 4, displayLewat: 1, displayBatas: 60,
  skorD: null, displayInfo: { color: "#999", lbl: "Belum dinilai" },
};

console.log("\n=== 1. Dialog cetak dipanggil kalau diminta ===");
{
  const h = M.cetakBaruHtml({ ...DASAR, otomatisCetak: true });
  cek("dokumennya memuat skrip", h.includes("<script"), "(tidak ada <script>)");
  cek("memanggil window.print()", /window\.print\s*\(\s*\)/.test(h),
    (h.match(/print[^<]{0,40}/) || ["(tidak ada print)"])[0]);
  // Mencetak sebelum font & gambar siap menghasilkan halaman yang tata
  // letaknya belum jadi — persis yang dijaga template lama.
  cek("menunggu font siap dulu", h.includes("fonts") && h.includes("ready"));
  cek("menunggu gambar selesai dimuat", /complete|onload|decode/.test(h));
  // indexOf memulangkan -1 kalau tidak ketemu, dan -1 selalu lebih kecil
  // daripada apa pun — penegasan yang cuma membandingkan keduanya HIJAU
  // justru ketika skripnya tidak ada sama sekali.
  cek("skripnya di dalam body, bukan sesudah </body>",
    h.indexOf("<script") > 0 && h.indexOf("<script") < h.indexOf("</body>"),
    h.indexOf("<script") + " vs " + h.indexOf("</body>"));
}

console.log("\n=== 2. Tanpa diminta, TIDAK mencetak sendiri ===");
// Halaman contoh yang dipasang di Vercel memakai modul yang sama. Kalau ia
// selalu memanggil dialog cetak, siapa pun yang membuka tautannya langsung
// diserbu dialog — itu bukan dokumen yang bisa dibaca.
{
  const h = M.cetakBaruHtml(DASAR);
  cek("tanpa otomatisCetak: tidak ada print()", !/window\.print\s*\(\s*\)/.test(h));
  cek("otomatisCetak:false juga tidak",
    !/window\.print\s*\(\s*\)/.test(M.cetakBaruHtml({ ...DASAR, otomatisCetak: false })));
  cek("isinya tetap utuh", h.includes("BERITA ACARA AUDIT STORE") && h.includes("3. AUDIT MONITORING DISPLAY"));
}

console.log("\n=== 3. Aplikasi benar-benar memintanya ===");
// Modul yang bisa mencetak tidak berguna kalau pemanggilnya tidak memintanya.
{
  const ba = fs.readFileSync(cariBerkas("components/BeritaAcara.js"), "utf8");
  const m = ba.match(/cetakBaruHtml\(\{[\s\S]*?\n\s*\}\);/);
  cek("pemanggilan cetakBaruHtml ketemu", !!m);
  cek("aplikasi meminta otomatisCetak: true",
    !!m && /otomatisCetak:\s*true/.test(m[0]),
    (m ? m[0].slice(-160) : "(tidak ada)"));
}

console.log("\n=== 4. Tiap nama di titik pemanggilan PUNYA deklarasi ===");
// Inilah pagar untuk `stokPct`. Nama yang tidak dideklarasikan tidak
// menimbulkan galat saat build — ia baru meledak saat tombolnya ditekan.
{
  const ba = fs.readFileSync(cariBerkas("components/BeritaAcara.js"), "utf8");
  const m = ba.match(/cetakBaruHtml\(\{([\s\S]*?)\n\s*\}\);/);
  cek("blok argumennya terbaca", !!m);

  const isiBlok = m ? m[1] : "";
  // Ambil nama akar dari tiap nilai properti:
  //   "stokPct,"            -> stokPct   (singkatan)
  //   "stokPct: stockPct,"  -> stockPct
  //   "displayDipajang: dDipajang.length," -> dDipajang
  const dirujuk = [];
  isiBlok.split("\n").forEach((baris) => {
    const b = baris.replace(/\/\/.*$/, "").trim().replace(/,$/, "");
    if (!b) return;
    const kolon = b.indexOf(":");
    const nilai = kolon === -1 ? b : b.slice(kolon + 1).trim();
    const akar = (nilai.match(/^([A-Za-z_$][A-Za-z0-9_$]*)/) || [])[1];
    if (akar && !["true", "false", "null", "undefined"].includes(akar)) dirujuk.push(akar);
  });
  cek("ada nama yang dirujuk", dirujuk.length >= 15, dirujuk.length + " nama");

  // Pola pengikatan: const/let/var/function, useState `const [x,`,
  // destructuring `{ x }`, impor, dan parameter komponen.
  function adaDeklarasi(nama) {
    const pola = [
      new RegExp("(?:const|let|var|function)\\s+" + nama + "\\b"),
      new RegExp("const\\s*\\[\\s*" + nama + "\\s*[,\\]]"),
      new RegExp("(?:const|import)\\s*\\{[^}]*\\b" + nama + "\\b[^}]*\\}"),
      new RegExp("function\\s+\\w+\\s*\\(\\s*\\{[^}]*\\b" + nama + "\\b"),
    ];
    return pola.some((p) => p.test(ba));
  }
  const yatim = dirujuk.filter((n) => !adaDeklarasi(n));
  cek("tidak ada nama tanpa deklarasi", yatim.length === 0,
    yatim.length ? "yatim: " + yatim.join(", ") : "");

  // Pagar di atas hanya berarti kalau ia bisa merah. Diadu ke nama yang
  // pasti tidak ada — kalau ini pun "punya deklarasi", polanya terlalu longgar.
  cek("polanya bisa membedakan (nama karangan ditolak)",
    !adaDeklarasi("stokPctYangTidakPernahAda"));
  cek("polanya mengenali yang memang ada", adaDeklarasi("stockPct") && adaDeklarasi("viewPeriod"));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log("\n====================================================");
console.log("  LOLOS: " + lolos + "   GAGAL: " + gagal);
console.log("====================================================");
process.exit(gagal ? 1 : 0);
