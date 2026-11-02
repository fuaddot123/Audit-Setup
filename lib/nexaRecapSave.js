import { warehouseMatchesBranch } from "./nexaOpnameImport.js";

export const canImportNexa = (profile) => ["auditor", "super_admin"].includes(profile?.role) && !profile?.liatSebagai;
const rowsOf = (record, n) => Array.isArray(record?.[`stock_opname_kat${n}`]) ? record[`stock_opname_kat${n}`] : [];
const canonical = (value) => JSON.stringify(value, function (_, v) {
  return v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v;
});

// Uses the caller's ordinary authenticated Supabase client and existing RLS.
// Existing BA fields/ownership are untouched; append uses a fresh read + CAS.
export async function saveNexaRecap(client, { profile, branch, period, auditDate, targetId, newId, kat1, kat2 }) {
  if (!canImportNexa(profile)) throw new Error("Akun ini tidak dapat mengimpor data.");
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user || user.id !== profile.id) throw new Error("Sesi berubah. Muat ulang halaman sebelum menyimpan.");
  if (!branch?.id || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || !/^\d{4}-\d{2}-\d{2}$/.test(auditDate || "") || !Number.isFinite(Date.parse(`${auditDate}T00:00:00Z`)) || new Date(`${auditDate}T00:00:00Z`).toISOString().slice(0, 10) !== auditDate || auditDate.slice(0, 7) !== period) throw new Error("Cabang dan tanggal audit harus sesuai periode rekap.");
  const incoming = [...kat1, ...kat2];
  if (!incoming.length) throw new Error("Belum ada hasil impor untuk disimpan.");
  const codes = new Set();
  for (const row of incoming) {
    const s = row.nexa;
    if (!s || s.branchId !== branch.id || !warehouseMatchesBranch(s.warehouse, branch.name) || s.date?.slice(0, 7) !== period || s.date > auditDate) throw new Error("Sumber Nexa tidak sesuai cabang atau tanggal audit tujuan.");
    if (codes.has(s.code)) throw new Error(`${s.code} muncul dua kali dalam impor.`);
    codes.add(s.code);
    if ((row.barang || []).some((b) => b.harga !== "" && b.harga != null && (!Number.isFinite(Number(b.harga)) || Number(b.harga) < 0))) throw new Error("Harga satuan harus kosong atau berupa angka nol/positif.");
  }
  const id = targetId || newId;
  if (!id) throw new Error("Pilih BA tujuan atau buat BA stock opname baru.");
  const read = await client.from("berita_acara").select("id,branch_id,period,audit_date,submitted_by,tidak_visit,stock_opname_kat1,stock_opname_kat2,updated_at,created_at").eq("id", id).maybeSingle();
  if (read.error) throw read.error;
  const current = read.data;
  if (current) {
    if (current.branch_id !== branch.id || current.period !== period || current.tidak_visit || (profile.role !== "super_admin" && current.submitted_by !== user.id)) throw new Error("BA tujuan tidak sesuai cabang/periode atau hak akses.");
    if (!targetId) {
      if (current.submitted_by === user.id && current.audit_date === auditDate && canonical(rowsOf(current, 1)) === canonical(kat1) && canonical(rowsOf(current, 2)) === canonical(kat2)) return current;
      throw new Error("BA untuk impor ini sudah tersimpan. Perbarui rekap dan pilih BA tersebut sebelum menambah data lain.");
    }
    if (current.audit_date !== auditDate) throw new Error("Tanggal BA tujuan berubah. Perbarui rekap sebelum menyimpan.");
    if (!current.updated_at) throw new Error("Versi BA belum terbaca. Perbarui rekap sebelum menyimpan.");
    for (const r of [...rowsOf(current, 1), ...rowsOf(current, 2)]) if (r.nexa && codes.has(r.nexa.code)) throw new Error(`${r.nexa.code} sudah ada dalam BA tujuan. Perbarui rekap untuk melihatnya.`);
    const write = await client.from("berita_acara").update({ stock_opname_kat1: [...rowsOf(current, 1), ...kat1], stock_opname_kat2: [...rowsOf(current, 2), ...kat2] })
      .eq("id", id).eq("updated_at", current.updated_at).select().maybeSingle();
    if (write.error) throw write.error;
    if (!write.data) throw new Error("BA berubah saat impor disimpan. Perbarui rekap lalu coba lagi.");
    return write.data;
  }
  if (targetId) throw new Error("BA tujuan tidak ditemukan atau tidak dapat diakses.");
  const write = await client.from("berita_acara").insert({ id, branch_id: branch.id, period, audit_date: auditDate, submitted_by: user.id,
    kegiatan: "Stock Opname Nexa", tidak_visit: false, stock_opname_kat1: kat1, stock_opname_kat2: kat2 }).select().single();
  if (write.error) throw write.error;
  return write.data;
}
