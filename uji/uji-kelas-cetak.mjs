// Menjaga satu hal: TIAP KELAS CSS yang dikirim pemanggil ke cetakan format
// baru harus benar-benar ada di gaya cetakan itu.
//
// Kelas yang tidak terdefinisi tidak menimbulkan galat apa pun. Ia hanya
// membuat penandanya padam atau ukurannya lepas — dan itu baru ketahuan
// sesudah dokumennya dicetak dan ditandatangani orang.
//
// Sudah menggigit DUA KALI, dan keduanya lolos dari uji yang ada:
//
//   1. Baris tabel display memakai "status-bad", sementara gaya cetak baru
//      hanya punya "k-bad" -> kolom umur tercetak tanpa warna, unit yang
//      lewat batas berhenti menonjol.
//
//   2. Foto Monitoring Display memakai "foto-unit-img", yang HANYA
//      didefinisikan di template LAMA -> di format baru fotonya tercetak
//      SEUKURAN ASLINYA. Foto ponsel beberapa ribu piksel merobek halaman.
//
// Uji lain memanggil cetakBaruHtml dengan potongan HTML buatannya sendiri,
// jadi ia tidak pernah melihat kelas apa yang SEBENARNYA dikirim aplikasi.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sini = path.dirname(fileURLToPath(import.meta.url));

function cariBerkas(relatif) {
  const calon = [
    path.join(sini, "..", relatif),
    path.join(sini, "..", "..", relatif),
    path.join(process.cwd(), relatif),
  ];
  for (const c of calon) if (fs.existsSync(c)) return c;
  throw new Error("Tidak ketemu: " + relatif + "\nDicari di:\n  " + calon.join("\n  "));
}

let lolos = 0, gagal = 0;
function cek(nama, syarat, info) {
  if (syarat) { lolos++; console.log("  OK    " + nama); }
  else { gagal++; console.log("  GAGAL " + nama + (info !== undefined ? "  -> " + info : "")); }
}

const ba = fs.readFileSync(cariBerkas("components/BeritaAcara.js"), "utf8");
const gaya = fs.readFileSync(cariBerkas("components/BeritaAcaraCetakBaru.js"), "utf8");
const bd = fs.readFileSync(cariBerkas("lib/baris-display.js"), "utf8");

// Mengambil badan sebuah `const x = ...;` sampai titik koma di kedalaman 0.
function badanConst(sumber, nama) {
  const mulai = sumber.indexOf("const " + nama + " =");
  if (mulai === -1) return null;
  let i = mulai, dalam = 0, kutip = null, template = 0;
  for (; i < sumber.length; i++) {
    const c = sumber[i];
    if (kutip) { if (c === kutip && sumber[i - 1] !== "\\") kutip = null; continue; }
    if (c === '"' || c === "'") { kutip = c; continue; }
    if (c === "`") { template = template ? 0 : 1; continue; }
    if (template) continue;
    if ("([{".includes(c)) dalam++;
    else if (")]}".includes(c)) dalam--;
    else if (c === ";" && dalam === 0) break;
  }
  return sumber.slice(mulai, i + 1);
}

// Kelas yang benar-benar dikirim ke cetakan format baru.
const POTONGAN = ["stokBarisHtml", "displayFotoHtml", "displayBarisBaru"];

console.log("\n=== 1. Potongan yang dikirim ke cetakan baru terbaca ===");
const badan = {};
for (const n of POTONGAN) {
  badan[n] = badanConst(ba, n);
  cek("badan " + n + " ketemu", !!badan[n], badan[n] ? "" : "(tidak ketemu)");
}

console.log("\n=== 2. Kelas yang dipakainya ===");
const dipakai = new Set();
for (const n of POTONGAN) {
  const b = badan[n] || "";
  // class="a b" pada HTML harfiah
  for (const m of b.matchAll(/class="([^"${}]+)"/g)) {
    m[1].split(/\s+/).filter(Boolean).forEach((k) => dipakai.add(k));
  }
  // kelas yang diserahkan sebagai opsi, mis. kelasOk: "k-ok"
  for (const m of b.matchAll(/kelas[A-Za-z]*:\s*"([^"]+)"/g)) dipakai.add(m[1]);
}
// baris-display.js memakai kelas dari opsinya, jadi kelas bawaannya ikut dijaga.
for (const m of bd.matchAll(/o\.kelas[A-Za-z]*\s*\|\|\s*"([^"]+)"/g)) dipakai.add(m[1]);

const daftar = [...dipakai].sort();
console.log("  " + daftar.join(", "));
cek("ada kelas yang terkumpul", daftar.length >= 4, daftar.length + " kelas");
cek("kelas foto display ikut terkumpul",
  daftar.some((k) => k.startsWith("foto-unit")), daftar.join(", "));

console.log("\n=== 3. Tiap kelas itu ADA di gaya cetakan baru ===");
const takAda = daftar.filter((k) => !new RegExp("\\." + k.replace(/[-]/g, "\\-") + "\\s*[{,]").test(gaya));
cek("tidak ada kelas yang tidak terdefinisi", takAda.length === 0,
  takAda.length ? "hilang: " + takAda.join(", ") : "");

// Pagar di atas hanya berarti kalau ia bisa merah.
cek("polanya menolak kelas karangan",
  !new RegExp("\\.kelas\\-yang\\-tidak\\-pernah\\-ada\\s*[{,]").test(gaya));
cek("polanya mengenali yang memang ada", /\.k-ok\s*[{,]/.test(gaya));

console.log("\n=== 4. Ukuran foto display: seperti Audit SOP ===");
// Ketetapan pemilik 10 Sep 2026: "gambar di monitoring display itu diperkecil,
// dibuat seperti audit SOP". Cetakan SOP memakai 38x38.
{
  const sop = fs.readFileSync(cariBerkas("components/sop/SopLaporan.js"), "utf8");
  // Diikat ke <img ... object-fit:cover>, BUKAN ke ukuran pertama yang
  // kebetulan ada di berkasnya. Versi pertama uji ini memakai pola longgar
  // dan menangkap `.hdr2-badge { width: 38px; height: 38px }` — lencana kop
  // yang kebetulan seukuran sama. Akibatnya ia HIJAU walaupun ukuran foto
  // SOP diubah, karena yang diadu bukan fotonya. Ketahuan hanya karena
  // kendali negatifnya dijalankan.
  const mSop = sop.match(/<img[^>]*style="width:\s*(\d+)px;\s*height:\s*(\d+)px;\s*object-fit:\s*cover/);
  cek("ukuran acuan SOP terbaca dari FOTO-nya, bukan dari elemen lain",
    !!mSop, mSop ? mSop[1] + "x" + mSop[2] : "(tidak ketemu)");

  const mBaru = gaya.match(/\.foto-unit-img\s*\{[^}]*width:\s*(\d+)px[^}]*height:\s*(\d+)px/);
  cek(".foto-unit-img didefinisikan di gaya cetak baru", !!mBaru,
    mBaru ? mBaru[1] + "x" + mBaru[2] : "(tidak ada)");
  cek("ukurannya sama dengan cetakan SOP",
    !!mBaru && !!mSop && mBaru[1] === mSop[1] && mBaru[2] === mSop[2],
    (mBaru ? mBaru[1] + "x" + mBaru[2] : "?") + " vs SOP " + (mSop ? mSop[1] + "x" + mSop[2] : "?"));
  cek("lebih kecil daripada template lama (92px)",
    !!mBaru && Number(mBaru[1]) < 92, mBaru ? mBaru[1] + "px" : "?");
  cek("fotonya tidak terbelah antar halaman",
    /\.foto-unit\s*\{[^}]*break-inside:\s*avoid/.test(gaya) || /\.foto-unit\s*\{[^}]*page-break-inside:\s*avoid/.test(gaya));
}

console.log("\n=== 5. Cetakan LAMA tidak ikut berubah ===");
// Berita Acara periode sebelum September yang sudah ditandatangani tidak boleh
// berubah bentuknya, termasuk ukuran fotonya.
cek("template lama tetap 92px", /\.foto-unit-img \{ width: 92px; height: 92px;/.test(ba),
  (ba.match(/\.foto-unit-img[^\n]*/) || ["(tidak ketemu)"])[0].trim().slice(0, 70));

console.log("\n====================================================");
console.log("  LOLOS: " + lolos + "   GAGAL: " + gagal);
console.log("====================================================");
process.exit(gagal ? 1 : 0);
