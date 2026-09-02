// Memasang skema SQL di Postgres SUNGGUHAN (PGlite) dan memeriksa apa yang
// benar-benar terbentuk. Sebelum ini skema itu hanya pernah DIBACA — selisih
// antara "kelihatan benar" dan "benar-benar jalan" selalu ketahuan belakangan,
// di tangan orang lain, pada saat yang paling tidak enak.
//
// Yang TIDAK diuji di sini: perilaku RLS terhadap auth.uid() Supabase yang
// sesungguhnya, dan apakah skema ini cocok dengan bentuk database produksi.
// Keduanya hanya bisa dilihat oleh pemegang akses Supabase.
//
// Skrip uji-*.sql sengaja TIDAK dijalankan dari sini. Ia satu sesi psql
// berurutan yang saling bergantung — yang satu memberi grant, yang berikutnya
// memakainya — dan lima di antaranya tidak menyatakan harapan apa pun sehingga
// tidak pernah bisa merah. Penjaga sungguhannya ada di uji-pembekuan.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// PGlite sengaja TIDAK ditambahkan ke package.json: menambah dependensi hanya
// demi uji berarti setiap build Vercel ikut mengunduhnya, sementara aplikasinya
// tidak memerlukannya sama sekali.
//
// Kalau belum terpasang, uji ini BERHENTI dan mengatakannya. Ia tidak mencetak
// "lolos": uji yang melompat diam-diam lalu tampak hijau adalah cara paling
// halus membuat orang mengira ada penjagaan padahal tidak ada.
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

const db = new PGlite();

console.log("\n=== 1. Keempat berkas skema terpasang ===");
for (const nama of DASAR) {
  try {
    await db.exec(isi(nama));
    cek(nama, true);
  } catch (e) {
    cek(nama, false, String(e.message).split("\n")[0]);
  }
}
if (gagal) {
  console.log("\n  Skema tidak terpasang utuh — pemeriksaan di bawah tidak berarti.\n");
  process.exit(1);
}

const q = async (sql) => (await db.query(sql)).rows;
const versi = (await q("select version()"))[0].version.split(",")[0];
console.log("  " + versi);

console.log("\n=== 2. Tabel yang dipakai aplikasi ada semua ===");
const tabel = (await q(`select tablename from pg_tables where schemaname='public'`)).map((t) => t.tablename);
console.log("  " + tabel.length + " tabel: " + tabel.slice().sort().join(", "));
for (const t of ["profiles", "branches", "berita_acara", "audit_generic", "audit_keuangan", "audit_kpi",
                 "display_unit", "display_kondisi", "display_kondisi_opsi", "display_standar",
                 "display_standar_brand", "akses_auditor"]) {
  cek("tabel " + t, tabel.includes(t));
}

console.log("\n=== 3. Semua tabel dilindungi RLS ===");
// Satu tabel yang lupa di-enable RLS berarti seluruh isinya terbuka untuk
// siapa pun yang punya kunci anon — tanpa galat, tanpa gejala.
const terbuka = await q(`select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
                         where n.nspname='public' and c.relkind='r' and not c.relrowsecurity order by 1`);
cek("tidak ada tabel tanpa RLS", terbuka.length === 0,
  terbuka.map((r) => r.relname).join(", "));
const jml = (await q(`select count(*)::int n from pg_policies where schemaname='public'`))[0].n;
cek("kebijakan RLS terpasang (>40)", jml > 40, jml + " policy");

console.log("\n=== 4. Fungsi & trigger yang menopang aturannya ===");
const fungsi = (await q(`select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                         where n.nspname='public'`)).map((f) => f.proname);
for (const f of ["bekukan_nilai_kondisi", "boleh_lihat", "current_role_name", "handle_new_user"]) {
  cek("fungsi " + f + "()", fungsi.includes(f));
}
const trig = (await q(`select tgname from pg_trigger where not tgisinternal`)).map((t) => t.tgname);
cek("trigger pembeku nilai terpasang", trig.some((t) => /beku/.test(t)),
  trig.sort().join(", "));

console.log("\n=== 5. Fungsi SECURITY DEFINER dikunci search_path ===");
// SECURITY DEFINER tanpa search_path yang dipatok bisa dibajak lewat skema
// bayangan milik penyerang. Ini bukan gaya penulisan, ini pagar.
const definer = await q(`select p.proname, p.proconfig
                         from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                         where n.nspname='public' and p.prosecdef`);
cek("ada fungsi SECURITY DEFINER", definer.length > 0, definer.length);
const tanpaPath = definer.filter((f) => !(f.proconfig || []).some((c) => c.startsWith("search_path=")));
cek("semuanya mematok search_path", tanpaPath.length === 0,
  tanpaPath.map((f) => f.proname).join(", "));

console.log("\n=== 6. View dipakai aplikasi untuk membaca skor ===");
const view = (await q(`select viewname from pg_views where schemaname='public'`)).map((v) => v.viewname);
cek("v_display_skor_periode ada", view.includes("v_display_skor_periode"), view.sort().join(", "));
cek("v_akun_bisa_dilihat ada (mode lihat-sebagai)", view.includes("v_akun_bisa_dilihat"));

await db.close();
console.log("\n====================================================");
console.log("  LOLOS: " + lolos + "   GAGAL: " + gagal);
console.log("====================================================\n");
process.exit(gagal ? 1 : 0);
