// Menguji pagar "mode lihat sebagai" — tombol pindah akun HANYA hak baca.
//
// Ketetapan pemilik: Kristianto boleh MEMBUKA data Fuad dan Yuni, tidak boleh
// menulis atas nama mereka. Berita Acara bertanda tangan orang yang tidak
// mengerjakannya merusak barang yang dijual aplikasi ini.
//
// Yang diuji BARIS ASLINYA dari berkas komponen, bukan salinan yang diketik
// ulang di sini. Bug yang memicu uji ini adalah salah presedensi operator:
//     role === "auditor" || role === "super_admin" && !liatSebagai
// terbaca mesin sebagai  auditor || (super_admin && !liatSebagai)  —
// untuk auditor, kuncinya diabaikan sama sekali. Menyalin ekspresinya ke
// dalam uji akan menyalin bug-nya juga, dan ujinya hijau untuk alasan salah.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sini = path.dirname(fileURLToPath(import.meta.url));

function cariBerkas(relatif) {
  const calon = [
    path.join(sini, "..", "Audit-Setup", relatif),
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

// Menarik ekspresi di kanan tanda "=" dari baris const yang diminta, lalu
// mengubahnya jadi fungsi. Kalau barisnya tidak ketemu, uji BERHENTI.
function ambilPagar(berkas, namaConst) {
  const isi = fs.readFileSync(cariBerkas(berkas), "utf8");
  const baris = isi.split("\n").find((b) => b.includes("const " + namaConst + " ="));
  if (!baris) throw new Error("baris 'const " + namaConst + "' tidak ketemu di " + berkas);
  const kanan = baris.slice(baris.indexOf("=") + 1).trim().replace(/;$/, "");
  // eslint-disable-next-line no-new-func
  return { fn: new Function("profile", "selectedAuditor", "return (" + kanan + ");"), teks: kanan };
}

const MODUL = [
  ["components/BeritaAcara.js", "canEdit"],
  ["components/AuditKeuangan.js", "canEdit"],
  ["components/BiayaDinas.js", "canManage"],
  ["components/sop/SopAuditCabang.js", "canEdit"],
  ["components/stok/StokKesehatan.js", "canEdit"],
  ["components/stok/StokServiceRatio.js", "canEdit"],
];

const LIAT = { id: "orang-lain", full_name: "Auditor Lain" };

console.log("\n=== 1. Modul biasa: auditor & super_admin ===");
for (const [berkas, nama] of MODUL) {
  const { fn } = ambilPagar(berkas, nama);
  const label = path.basename(berkas);
  // Akun sendiri — boleh mengisi.
  cek(label + ": auditor sendiri BOLEH", fn({ role: "auditor", id: "aku", liatSebagai: null }, null) === true);
  cek(label + ": super_admin sendiri BOLEH", fn({ role: "super_admin", id: "aku", liatSebagai: null }, null) === true);

  // Mode lihat sebagai — WAJIB terkunci. Peran efektifnya jadi "auditor"
  // (lihat pages/dashboard.js), jadi justru cabang inilah yang harus dijaga.
  cek(label + ": lihat-sebagai (auditor) TERKUNCI",
    fn({ role: "auditor", id: "orang-lain", liatSebagai: LIAT }, null) === false,
    String(fn({ role: "auditor", id: "orang-lain", liatSebagai: LIAT }, null)));
  cek(label + ": lihat-sebagai (super_admin) TERKUNCI",
    fn({ role: "super_admin", id: "orang-lain", liatSebagai: LIAT }, null) === false,
    String(fn({ role: "super_admin", id: "orang-lain", liatSebagai: LIAT }, null)));

  // Peran lain tetap tidak boleh.
  cek(label + ": peran lain TIDAK boleh",
    fn({ role: "viewer", id: "aku", liatSebagai: null }, null) === false,
    String(fn({ role: "viewer", id: "aku", liatSebagai: null }, null)));
}

console.log("\n=== 2. AuditKPI: masih ditambah syarat auditor yang dipilih ===");
{
  const { fn } = ambilPagar("components/AuditKPI.js", "canEdit");
  const aku = { role: "auditor", id: "aku", liatSebagai: null };
  cek("AuditKPI: auditor membuka KPI-nya sendiri BOLEH", fn(aku, { id: "aku" }) === true);
  cek("AuditKPI: auditor membuka KPI orang lain TIDAK boleh", fn(aku, { id: "lain" }) === false);
  cek("AuditKPI: super_admin BOLEH", fn({ role: "super_admin", id: "adm", liatSebagai: null }, { id: "lain" }) === true);
  cek("AuditKPI: lihat-sebagai (auditor) TERKUNCI",
    fn({ role: "auditor", id: "lain", liatSebagai: LIAT }, { id: "lain" }) === false,
    String(fn({ role: "auditor", id: "lain", liatSebagai: LIAT }, { id: "lain" })));
  cek("AuditKPI: lihat-sebagai (super_admin) TERKUNCI",
    fn({ role: "super_admin", id: "adm", liatSebagai: LIAT }, { id: "lain" }) === false,
    String(fn({ role: "super_admin", id: "adm", liatSebagai: LIAT }, { id: "lain" })));
}

console.log("\n=== 3. Yang memang sudah benar sejak awal ===");
{
  const t = ambilPagar("components/Timeline.js", "canManage");
  cek("Timeline: auditor sendiri BOLEH", t.fn({ role: "auditor", liatSebagai: null }, null) === true);
  cek("Timeline: lihat-sebagai TERKUNCI", t.fn({ role: "auditor", liatSebagai: LIAT }, null) === false);
  const m = ambilPagar("components/MasterDisplay.js", "bolehUbah");
  cek("MasterDisplay: super_admin BOLEH", m.fn({ role: "super_admin", liatSebagai: null }, null) === true);
  cek("MasterDisplay: lihat-sebagai TERKUNCI", m.fn({ role: "super_admin", liatSebagai: LIAT }, null) === false);
  cek("MasterDisplay: auditor TIDAK boleh", m.fn({ role: "auditor", liatSebagai: null }, null) === false);
}

console.log("\n=== 4. Presedensi: pagar wajib mengurung cabang perannya ===");
// Pagar yang benar berbentuk  (A || B) && !liatSebagai.  Yang salah berbentuk
// A || (B && !liatSebagai). Diperiksa dari BENTUK teksnya juga, bukan cuma
// hasilnya — supaya bug yang sama tidak kembali lewat jalan lain.
for (const [berkas, nama] of [...MODUL, ["components/AuditKPI.js", "canEdit"]]) {
  const { teks } = ambilPagar(berkas, nama);
  const label = path.basename(berkas);
  cek(label + ": menyebut liatSebagai", teks.includes("liatSebagai"), teks);
  cek(label + ": cabang peran dikurung sebelum &&",
    /^\s*\(.*\)\s*&&\s*!profile\?\.liatSebagai\s*$/.test(teks), teks);
}

console.log("\n====================================================");
console.log("  LOLOS: " + lolos + "   GAGAL: " + gagal);
console.log("====================================================");
process.exit(gagal ? 1 : 0);
