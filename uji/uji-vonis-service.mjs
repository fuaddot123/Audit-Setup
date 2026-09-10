// Menjaga satu hal: layar Service Ratio tidak boleh MEMVONIS cabang dari angka
// rata-rata Laptop & Aksesoris.
//
// Sebabnya terukur, bukan selera. Ambang keduanya berbeda 4,55x (terkendali)
// dan 6,06x (monitoring):
//
//     laptop     : terkendali <= 1%    monitoring <= 2%
//     aksesoris  : terkendali <= 0,22% monitoring <= 0,33%
//
// Merata-ratakan dua angka berskala segitu bedanya, lalu menilai hasilnya
// dengan ambang AKSESORIS, membalik vonis pada 3 dari 6 keadaan yang diuji di
// bawah. Arah yang paling berbahaya: cabang yang sebenarnya "Perlu Perhatian"
// tampil "Monitoring", dan penghitung alert ikut melewatkannya.
//
// Vonis yang benar SUDAH tersimpan di tiap record (`indikator`), dan layar
// Laporan Bulanan/Tahunan serta Laporan Audit Stok sudah memakai dua rasio
// terpisah. Hanya layar ini yang tertinggal.
//
// Yang diuji di sini SIFATNYA, bukan alamatnya: fungsinya benar-benar
// DIJALANKAN, dan aturan "data lama" diadu dengan MENJALANKAN aturan yang
// sudah dipakai dua layar lain — bukan dengan menyalin kalimatnya ke sini.
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
  ];
  for (const c of calon) if (fs.existsSync(c)) return c;
  throw new Error("Tidak ketemu: " + relatif + "\nDicari di:\n  " + calon.join("\n  "));
}

let lolos = 0, gagal = 0;
function cek(nama, syarat, info) {
  if (syarat) { lolos++; console.log("  OK    " + nama); }
  else { gagal++; console.log("  GAGAL " + nama + (info !== undefined ? "  -> " + info : "")); }
}

// Gerbang yang MATI sebelum mencetak apa pun keluar dengan kode bukan-nol
// tanpa satu baris gagal — dan kendali yang cuma melihat kode keluarnya
// membacanya sebagai berhasil. Tiap penegasan yang memanggil kode yang sedang
// diuji dibungkus supaya galat jadi baris MERAH, bukan ledakan.
function cekJalan(nama, fn, info) {
  let hasil, galat = null;
  try { hasil = fn(); } catch (e) { galat = e; }
  if (galat) { gagal++; console.log("  GAGAL " + nama + "  -> galat: " + galat.message); return; }
  cek(nama, hasil, info);
}

// ── stokConfig dijalankan sungguhan (disalin ke .mjs, isinya tidak diubah) ──
const berkasConfig = cariBerkas("lib/stokConfig.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vonis-service-"));
fs.copyFileSync(berkasConfig, path.join(tmp, "stokConfig.mjs"));
const SC = await import("file://" + path.join(tmp, "stokConfig.mjs").replace(/\\/g, "/"));

const svc = fs.readFileSync(cariBerkas("components/stok/StokServiceRatio.js"), "utf8");
const lap = fs.readFileSync(cariBerkas("components/stok/StokLaporan.js"), "utf8");
const bul = fs.readFileSync(cariBerkas("components/LaporanBulanan.js"), "utf8");

// Mengambil badan sebuah fungsi tingkat modul, dari "function nama" sampai
// "\nfunction " atau "\nexport " berikutnya. Diikat ke batas fungsi supaya
// tidak ikut menelan tetangganya.
function potongFungsi(sumber, nama) {
  const mulai = sumber.indexOf("function " + nama);
  if (mulai === -1) return null;
  const sisa = sumber.slice(mulai + 1);
  const kandidat = [sisa.indexOf("\nfunction "), sisa.indexOf("\nexport ")].filter((i) => i !== -1);
  const akhir = kandidat.length ? Math.min(...kandidat) : sisa.length;
  return sisa.slice(0, akhir);
}

// ── 1. Satu definisi vonis gabungan, bukan dua yang bisa tidak sepakat ──
console.log("\n=== 1. Vonis gabungan punya SATU definisi ===");
{
  cek("stokConfig mengekspor worstServiceStatus", typeof SC.worstServiceStatus === "function",
    typeof SC.worstServiceStatus);
  cek("stokConfig mengekspor vonisService", typeof SC.vonisService === "function",
    typeof SC.vonisService);
  // Definisi kedua di berkas layar adalah cara paling halus melahirkan dua
  // jawaban untuk satu pertanyaan. Sudah terjadi di modul lain (bankNota).
  cek("StokLaporan.js tidak mendefinisikan salinannya sendiri",
    !/function\s+worstServiceStatus/.test(lap),
    (lap.match(/function\s+worstServiceStatus[^\n]*/) || [""])[0]);
  cek("StokServiceRatio.js tidak mendefinisikan salinannya sendiri",
    !/function\s+worstServiceStatus/.test(svc));
  cek("StokLaporan.js mengambilnya dari stokConfig",
    /import[\s\S]{0,400}worstServiceStatus[\s\S]{0,400}stokConfig/.test(lap));
}

// ── 2. Perilakunya, dijalankan ──
console.log("\n=== 2. Vonis gabungan = yang TERBURUK, bukan rata-rata ===");
{
  // Vonis palsu yang selama ini tampil di kartu: rata-rata dua skala, dinilai
  // dengan ambang aksesoris.
  const vonisRataRata = (rl, ra) => SC.serviceStatusInfo((rl + ra) / 2).lbl;
  const KASUS = [
    // [laptop, aksesoris, vonis yang benar]
    [0.0020, 0.0040, "Perlu Perhatian"],   // aksesoris genting, laptop tenang
    [0.0250, 0.0010, "Perlu Perhatian"],   // laptop genting
    [0.0300, 0.0005, "Perlu Perhatian"],
    [0.0050, 0.0015, "Terkendali"],        // dua-duanya aman
    [0.0150, 0.0010, "Monitoring"],        // laptop monitoring
    [0.0100, 0.0022, "Terkendali"],        // tepat di batas dua-duanya
    [0.0101, 0.0022, "Monitoring"],        // laptop lewat sesenti
    [0.0100, 0.0023, "Monitoring"],        // aksesoris lewat sesenti
  ];
  let beda = 0;
  for (const [rl, ra, benar] of KASUS) {
    cekJalan("laptop " + SC.formatRatioPct(rl) + " + aksesoris " + SC.formatRatioPct(ra) + " -> " + benar,
      () => SC.worstServiceStatus(rl, ra).lbl === benar,
      (() => { try { return SC.worstServiceStatus(rl, ra).lbl; } catch (e) { return "?"; } })());
    if (vonisRataRata(rl, ra) !== benar) beda++;
  }
  // Kalau rata-rata tidak pernah berbeda dari yang benar, seluruh uji ini
  // tidak menjaga apa pun — ia akan hijau juga pada kode yang lama.
  cek("cara rata-rata memang menghasilkan vonis BERBEDA (uji ini bisa merah)",
    beda >= 3, beda + " dari " + KASUS.length + " kasus berbeda");
  // Warnanya ikut vonisnya — kartu mewarnai badge dari status yang sama.
  cekJalan("warnanya ikut vonis yang menang",
    () => SC.worstServiceStatus(0.0020, 0.0040).color === SC.serviceStatusInfo(0.0040).color);
}

// ── 3. Data lama: aturannya SAMA dengan dua layar yang sudah benar ──
console.log("\n=== 3. Aturan 'data lama' sepakat dengan layar lain ===");
{
  const POLA_LAMA = /(\w+)\.data\?\.ratio_laptop == null && \1\.data\?\.total_unit_cabang != null/;
  const diLaporan = lap.match(POLA_LAMA);
  const diBulanan = bul.match(POLA_LAMA);
  cek("aturan legacy ketemu di StokLaporan.js", !!diLaporan, diLaporan ? diLaporan[0] : "(tidak ada)");
  cek("aturan legacy ketemu di LaporanBulanan.js", !!diBulanan, diBulanan ? diBulanan[0] : "(tidak ada)");

  // Aturan MEREKA dijalankan apa adanya, tidak diketik ulang di sini.
  const aturanLain = diLaporan
    ? new Function("rec", "return (" + diLaporan[0].replace(/(\w+)\.data\?\./g, "rec.") + ");")
    : null;

  const UMPAN = [
    { nama: "data lama gabungan", d: { ratio: 0.0023, total_unit_cabang: 4000, stok_service: 9 } },
    { nama: "data baru terpisah", d: { ratio_laptop: 0.015, ratio_aksesoris: 0.001, ratio: 0.008, total_unit_laptop: 200, total_unit_aksesoris: 4000 } },
    { nama: "data baru, aksesoris saja", d: { ratio_aksesoris: 0.004, ratio: 0.002 } },
  ];
  for (const u of UMPAN) {
    const lamaMenurutMereka = aturanLain ? !!aturanLain(u.d) : null;
    cekJalan(u.nama + ": sepakat soal 'data lama'",
      () => SC.vonisService(u.d).legacy === lamaMenurutMereka,
      "layar lain=" + lamaMenurutMereka);
  }

  cekJalan("data lama dinilai dengan ambang aksesoris (seperti sebelumnya)",
    () => SC.vonisService(UMPAN[0].d).status.lbl === SC.serviceStatusInfo(0.0023).lbl);
  cekJalan("data baru dinilai dari dua rasionya, bukan dari `ratio` gabungan", () => {
    const v = SC.vonisService(UMPAN[1].d);
    return v.status.lbl === "Monitoring" && v.ratioLaptop === 0.015 && v.ratioAksesoris === 0.001;
  });

  // Record yang tidak punya bentuk mana pun (mis. Tidak Visit) TIDAK BOLEH
  // dikarang jadi 0,00% — nol di situ berarti "tidak ada datanya".
  cekJalan("record tanpa angka apa pun: tidak dikarang jadi 0,00%", () => {
    const v = SC.vonisService({ tidak_visit: true });
    return v.tanpaData === true && v.status == null;
  });
}

// ── 4. Layarnya berhenti memvonis dari rasio gabungan ──
console.log("\n=== 4. StokServiceRatio.js tidak lagi memvonis dari `ratio` gabungan ===");
{
  // Yang dijaga adalah MEDAN TERSIMPANNYA: `data.ratio`, angka rata-rata dua
  // skala. Diikat ke `data` supaya `r.ratio` milik objek lokal (mis. baris
  // {label, ratio, status} di kartu Hasil Perhitungan) tidak ikut tertuduh —
  // itu rasio satu metrik, bukan campuran. `ratioLaptop`/`ratioGabungan` hasil
  // vonisService juga bukan sasaran: yang pertama memang satu metrik, yang
  // kedua hanya dipakai di cabang "data lama" dan selalu diberi label.
  const polaVonis = /(?:serviceStatusInfo|laptopStatusInfo)\(\s*[^)]*data\??\.ratio(?![_A-Za-z])/g;
  const vonisDariGabungan = svc.match(polaVonis) || [];
  cek("tidak ada vonis yang dihitung dari medan `data.ratio` gabungan",
    vonisDariGabungan.length === 0,
    vonisDariGabungan.length + "x: " + vonisDariGabungan.join(" | "));

  const polaTampil = /formatRatioPct\(\s*[^)]*data\??\.ratio(?![_A-Za-z])/g;
  const tampilGabungan = svc.match(polaTampil) || [];
  cek("medan `data.ratio` gabungan tidak ditampilkan sebagai 'ratio cabang'",
    tampilGabungan.length === 0,
    tampilGabungan.length + "x: " + tampilGabungan.join(" | "));

  cek("layar memakai vonisService", /vonisService\s*\(/.test(svc));
  cek("vonisService diimpor dari stokConfig",
    /import[\s\S]{0,400}vonisService[\s\S]{0,400}stokConfig/.test(svc));

  // Penghitung alert: kalau ia masih memakai rata-rata, cabang yang benar-benar
  // genting bisa tidak terhitung sama sekali. Yang diperiksa BLOK-nya, bukan
  // satu baris — vonisnya boleh dihitung sebaris di atasnya.
  const iAlert = svc.indexOf("const alertCount");
  const blokAlert = iAlert === -1 ? "" : svc.slice(Math.max(0, iAlert - 900), iAlert + 200);
  cek("blok penghitung alert ketemu", iAlert !== -1);
  cek("penghitung alert lahir dari vonisService", /vonisService\s*\(/.test(blokAlert),
    (svc.match(/const alertCount[^\n]*/) || ["(tidak ketemu)"])[0].trim().slice(0, 110));
  cek("penghitung alert tidak menyentuh medan gabungan",
    !/const alertCount[^\n]*data\??\.ratio(?![_A-Za-z])/.test(svc),
    (svc.match(/const alertCount[^\n]*/) || [""])[0].trim().slice(0, 110));
  cek("alert memakai label vonis, bukan ambang yang diketik ulang",
    /const alertCount[^\n]*status\?\.lbl === "Perlu Perhatian"/.test(svc),
    (svc.match(/const alertCount[^\n]*/) || [""])[0].trim().slice(0, 110));

  // Medan `ratio` tetap DITULIS saat menyimpan — Dashboard Audit dan Laporan
  // Tahunan masih membacanya untuk data lama. Yang dilarang cuma MEMVONIS
  // dengannya, bukan menyimpannya.
  cek("medan `ratio` gabungan tetap disimpan (kompatibilitas)",
    /ratio:\s*\(ratioLaptop \+ ratioAksesoris\) \/ 2/.test(svc));
  cek("`indikator` gabungan tetap disimpan", /indikator:/.test(svc));
}

// ── 5. Batang kemajuan: tiap metrik dibagi ambangnya SENDIRI ──
console.log("\n=== 5. Batang tiap metrik dibagi ambangnya sendiri ===");
{
  // Sebelum ini rasio LAPTOP dibagi ambang AKSESORIS (0,33%), jadi laptop
  // 1,50% -- yang sebenarnya "Monitoring" -- menggambar batang PENUH, sama
  // penuhnya dengan laptop 3% yang genting. Batang yang selalu penuh tidak
  // memberi tahu apa pun.
  const polaLebar = /width:\s*`\$\{Math\.min\(\(r\.ratio \/ ([A-Za-z_.]+)\) \* 100, 100\)\}%`/;
  const m = svc.match(polaLebar);
  cek("rumus lebar batang ketemu", !!m, m ? m[1] : "(tidak ketemu)");
  cek("pembaginya bukan satu ambang tetap untuk dua metrik",
    !!m && !/^SERVICE_THRESHOLDS\./.test(m[1]), m ? m[1] : "?");
  cek("baris Laptop membawa ambang laptop",
    /label:\s*"Laptop"[^}]*LAPTOP_THRESHOLDS/.test(svc),
    (svc.match(/\{\s*label:\s*"Laptop"[^}]*\}/) || ["(tidak ketemu)"])[0]);
  cek("baris Aksesoris membawa ambang aksesoris",
    /label:\s*"Aksesoris"[^}]*SERVICE_THRESHOLDS/.test(svc),
    (svc.match(/\{\s*label:\s*"Aksesoris"[^}]*\}/) || ["(tidak ketemu)"])[0]);
}

// ── 6. Grafik riwayat tidak menumpuk dua skala jadi satu garis ──
console.log("\n=== 6. Grafik riwayat memisah Laptop & Aksesoris ===");
{
  const grafik = potongFungsi(svc, "RatioHistoryChart");
  cek("fungsi grafiknya ketemu", !!grafik, grafik ? grafik.length + " aksara" : "(tidak ketemu)");
  const g = grafik || "";
  cek("grafik menggambar rasio Laptop", /ratioLaptop/.test(g));
  cek("grafik menggambar rasio Aksesoris", /ratioAksesoris/.test(g));
  cek("grafik memakai vonisService, bukan medan mentah", /vonisService\s*\(/.test(g));
  cek("grafik tidak lagi memetakan `data.ratio` gabungan jadi satu garis",
    !/data\??\.ratio(?![_A-Za-z])/.test(g),
    (g.match(/[^\n]*data\??\.ratio(?![_A-Za-z])[^\n]*/) || ["(sudah tidak ada)"])[0].trim());
  cek("kedua ambang dipakai sebagai acuan",
    /LAPTOP_THRESHOLDS/.test(g) && /SERVICE_THRESHOLDS/.test(g));
  // Titik data lama tidak dipaksa masuk ke salah satu garis; ia disebut
  // apa adanya, sama seperti perlakuan Laporan Audit Stok.
  cek("titik data lama disebut, tidak dibuang diam-diam",
    /gabungan/i.test(g), "(kata 'gabungan' tidak muncul di grafik)");
}

// ── 7. Kendali: pola-pola di atas memang bisa merah ──
console.log("\n=== 7. Kendali — polanya bisa membedakan ===");
{
  const polaVonis = /(?:serviceStatusInfo|laptopStatusInfo)\(\s*[^)]*data\??\.ratio(?![_A-Za-z])/;
  cek("pola vonis MENANGKAP ketiga bentuk yang benar-benar dulu ada",
    polaVonis.test("const st = serviceStatusInfo(e.data.ratio || 0);")
    && polaVonis.test("serviceStatusInfo(r.entry.data.ratio || 0).lbl")
    && polaVonis.test("<td>${esc(serviceStatusInfo(r.data.ratio || 0).lbl)}</td>"));
  cek("pola vonis TIDAK menangkap pemakaian yang sah",
    !polaVonis.test("const statusAksesoris = serviceStatusInfo(ratioAksesoris);")
    && !polaVonis.test("laptopStatusInfo(d.ratio_laptop || 0)")
    && !polaVonis.test("laptopStatusInfo(rVonis.ratioLaptop)"));
  const polaTampil = /formatRatioPct\(\s*[^)]*data\??\.ratio(?![_A-Za-z])/;
  cek("pola tampil MENANGKAP bentuk yang lama",
    polaTampil.test("{formatRatioPct(e.data.ratio || 0)}")
    && polaTampil.test("${esc(formatRatioPct(r.data.ratio || 0))}"));
  cek("pola tampil TIDAK menangkap yang sah",
    !polaTampil.test("formatRatioPct(d.ratio_aksesoris || 0)")
    && !polaTampil.test("formatRatioPct(r.ratio)")
    && !polaTampil.test("formatRatioPct(v.ratioGabungan)"));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log("\n====================================================");
console.log("  LOLOS: " + lolos + "   GAGAL: " + gagal);
console.log("====================================================");
process.exit(gagal ? 1 : 0);
