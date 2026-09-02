// Membuktikan JANJI PALING PENTING dari skema ini, di Postgres sungguhan:
//
//   Mengubah Master Data TIDAK BOLEH mengubah Berita Acara yang sudah lewat.
//
// Sudah pernah terjadi saat diuji dulu: menurunkan skor "Lecet ringan" membuat
// Berita Acara Agustus berubah dari 81% jadi 78,8%, tanpa ada yang menyentuh
// audit Agustus. Penjagaannya trigger `bekukan_kondisi_trg`.
//
// Skrip uji-beku.sql dan uji-retroaktif.sql yang ikut di repo hanya MENCETAK
// hasil untuk dibaca manusia — keduanya tidak menyatakan satu harapan pun,
// jadi keduanya tidak pernah bisa merah. Berkas ini yang menjaganya.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// PGlite (Postgres tertanam) sengaja TIDAK ditambahkan ke package.json:
// menambah dependensi hanya demi uji berarti setiap build Vercel ikut
// mengunduhnya, dan aplikasinya sendiri tidak memerlukannya sama sekali.
//
// Kalau belum terpasang, uji ini BERHENTI dan mengatakannya. Ia tidak
// mencetak "lolos": uji yang melompat diam-diam lalu tampak hijau adalah cara
// paling halus membuat orang mengira ada penjagaan padahal tidak ada.
let PGlite;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
} catch {
  console.log("\n====================================================");
  console.log("  DILEWATI — Postgres tertanam belum terpasang.");
  console.log("  Pasang dulu (hanya untuk uji, bukan untuk aplikasi):");
  console.log("     npm install --no-save @electric-sql/pglite");
  console.log("  TIDAK ADA yang diuji tanpa itu.");
  console.log("====================================================");
  process.exit(0);
}

const sini = path.dirname(fileURLToPath(import.meta.url));

function folderSql() {
  for (const c of [path.join(sini, "..", "Audit-Setup", "sql"),
                   path.join(sini, "..", "sql"),
                   path.join(process.cwd(), "sql")]) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error("folder sql/ tidak ketemu");
}
const SQL = folderSql();
const isi = (n) => fs.readFileSync(path.join(SQL, n), "utf8");
const DASAR = ["tiruan-supabase.sql", "01-schema.sql", "02-schema-display.sql", "03-schema-akses.sql"];

let lolos = 0, gagal = 0;
function cek(nama, syarat, info) {
  if (syarat) { lolos++; console.log("  OK    " + nama); }
  else { gagal++; console.log("  GAGAL " + nama + (info !== undefined ? "  -> " + info : "")); }
}

// Menyiapkan satu cabang, satu unit display, dan master yang diketahui isinya.
// Dijalankan sebagai pemilik database: yang diuji di sini TRIGGER, bukan RLS.
async function siapkan({ pakaiTrigger = true } = {}) {
  const db = new PGlite();
  for (const n of DASAR) await db.exec(isi(n));
  if (!pakaiTrigger) {
    await db.exec("drop trigger if exists bekukan_kondisi_trg on public.display_kondisi;");
  }
  await db.exec(`
    insert into auth.users (id, email)
      values ('11111111-1111-1111-1111-111111111111','auditor@kla.test');
    update public.display_standar set maks_hari_pajang = 60 where id = 1;
    update public.display_kondisi_opsi set skor = 80 where kode = 'lecet_ringan';
    insert into public.display_unit (branch_id, brand, model, tanggal_pajang, dicatat_oleh)
      values (1, 'ASUS', 'ROG Strix G16', date '2026-06-08',
              '11111111-1111-1111-1111-111111111111');
  `);
  const unit = (await db.query("select id from public.display_unit limit 1")).rows[0].id;
  return { db, unit };
}

const simpanAudit = (db, unit, periode) => db.query(
  `insert into public.display_kondisi (display_unit_id, audit_date, period, kondisi_kode, dicatat_oleh)
   values ($1, $2, $3, 'lecet_ringan', '11111111-1111-1111-1111-111111111111')
   returning skor_saat_audit, batas_hari_saat_audit`,
  [unit, periode + "-19", periode]);

const bacaUlang = async (db, periode) => (await db.query(
  `select skor_saat_audit, batas_hari_saat_audit from public.display_kondisi where period = $1`,
  [periode])).rows[0];

console.log("\n=== 1. Nilai dibekukan saat audit disimpan ===");
{
  const { db, unit } = await siapkan();
  const baris = (await simpanAudit(db, unit, "2026-08")).rows[0];
  cek("skor ikut master saat itu (80)", baris.skor_saat_audit === 80, baris.skor_saat_audit);
  cek("batas umur ikut master saat itu (60)", baris.batas_hari_saat_audit === 60, baris.batas_hari_saat_audit);
  cek("keduanya terisi sendiri, kolomnya tidak disebut saat menyimpan",
    baris.skor_saat_audit != null && baris.batas_hari_saat_audit != null);
  await db.close();
}

console.log("\n=== 2. Master berubah — audit LAMA tidak boleh ikut berubah ===");
{
  const { db, unit } = await siapkan();
  await simpanAudit(db, unit, "2026-08");
  const sebelum = await bacaUlang(db, "2026-08");

  // Persis kejadian yang dulu merusak: skor diturunkan, batas dipersempit.
  await db.exec(`
    update public.display_kondisi_opsi set skor = 50 where kode = 'lecet_ringan';
    update public.display_standar set maks_hari_pajang = 45 where id = 1;
  `);
  const sesudah = await bacaUlang(db, "2026-08");

  cek("skor Agustus TETAP 80 walau master jadi 50",
    sesudah.skor_saat_audit === 80, `${sebelum.skor_saat_audit} -> ${sesudah.skor_saat_audit}`);
  cek("batas Agustus TETAP 60 walau master jadi 45",
    sesudah.batas_hari_saat_audit === 60, `${sebelum.batas_hari_saat_audit} -> ${sesudah.batas_hari_saat_audit}`);

  console.log("\n=== 3. Audit BARU memakai master yang baru ===");
  const baru = (await simpanAudit(db, unit, "2026-09")).rows[0];
  cek("skor September ikut master baru (50)", baru.skor_saat_audit === 50, baru.skor_saat_audit);
  cek("batas September ikut master baru (45)", baru.batas_hari_saat_audit === 45, baru.batas_hari_saat_audit);

  console.log("\n=== 4. Dua periode berdampingan, angkanya berbeda ===");
  const dua = (await db.query(
    `select period, skor_saat_audit s, batas_hari_saat_audit b
     from public.display_kondisi order by period`)).rows;
  cek("dua baris tersimpan", dua.length === 2, dua.length);
  cek("Agustus 80/60 dan September 50/45",
    dua[0].s === 80 && dua[0].b === 60 && dua[1].s === 50 && dua[1].b === 45,
    dua.map((r) => `${r.period}=${r.s}/${r.b}`).join(" "));
  await db.close();
}

console.log("\n=== 5. Nilai yang disebut sendiri tidak ditimpa trigger ===");
// Dipakai saat memindahkan data lama: nilainya sudah diketahui, jangan
// dihitung ulang dari master hari ini.
{
  const { db, unit } = await siapkan();
  const r = (await db.query(
    `insert into public.display_kondisi
       (display_unit_id, audit_date, period, kondisi_kode, dicatat_oleh, skor_saat_audit, batas_hari_saat_audit)
     values ($1, '2026-07-19', '2026-07', 'lecet_ringan',
             '11111111-1111-1111-1111-111111111111', 33, 21)
     returning skor_saat_audit, batas_hari_saat_audit`, [unit])).rows[0];
  cek("skor yang disebut tetap 33", r.skor_saat_audit === 33, r.skor_saat_audit);
  cek("batas yang disebut tetap 21", r.batas_hari_saat_audit === 21, r.batas_hari_saat_audit);
  await db.close();
}

console.log("\n=== 6. KENDALI NEGATIF: trigger dilepas, sejarah harus berubah ===");
// Kalau bagian ini TIDAK menunjukkan perubahan, berarti bagian 2 hijau bukan
// karena triggernya bekerja — melainkan karena ujinya tidak menguji apa pun.
{
  const { db, unit } = await siapkan({ pakaiTrigger: false });
  await simpanAudit(db, unit, "2026-08");
  const sebelum = await bacaUlang(db, "2026-08");
  cek("tanpa trigger, nilainya memang tidak terisi",
    sebelum.skor_saat_audit === null && sebelum.batas_hari_saat_audit === null,
    `${sebelum.skor_saat_audit}/${sebelum.batas_hari_saat_audit}`);

  // Tanpa nilai beku, view skor terpaksa membaca master hari ini — dan itulah
  // jalan bagaimana Berita Acara lama ikut berubah.
  const pakaiMaster = (await db.query(
    `select ko.skor from public.display_kondisi k
     join public.display_kondisi_opsi ko on ko.kode = k.kondisi_kode
     where k.period = '2026-08'`)).rows[0].skor;
  await db.exec("update public.display_kondisi_opsi set skor = 50 where kode = 'lecet_ringan';");
  const sesudahMaster = (await db.query(
    `select ko.skor from public.display_kondisi k
     join public.display_kondisi_opsi ko on ko.kode = k.kondisi_kode
     where k.period = '2026-08'`)).rows[0].skor;
  cek("tanpa nilai beku, angka Agustus IKUT berubah (80 -> 50)",
    pakaiMaster === 80 && sesudahMaster === 50, `${pakaiMaster} -> ${sesudahMaster}`);
  await db.close();
}

console.log("\n====================================================");
console.log("  LOLOS: " + lolos + "   GAGAL: " + gagal);
console.log("====================================================\n");
process.exit(gagal ? 1 : 0);
