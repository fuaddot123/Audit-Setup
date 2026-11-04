import { canImportNexa } from "./nexaRecapSave.js";
import { valueRecord } from "./persediaanValuation.js";

export async function savePersediaanValues(client, { profile, ids, report }) {
  if (!canImportNexa(profile)) throw new Error("Akun ini tidak dapat menyimpan nilai persediaan.");
  if (!report?.entries || !/^\d{4}-\d{2}$/.test(report.period)) throw new Error("Muat Report Persediaan terlebih dahulu.");
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user || user.id !== profile.id) throw new Error("Sesi berubah. Muat ulang halaman.");
  const saved = [], failures = [];
  for (const id of [...new Set(ids)]) {
    try {
      const read = await client.from("berita_acara").select("*").eq("id", id).maybeSingle();
      if (read.error) throw read.error;
      const old = read.data;
      if (!old || old.period !== report.period || old.tidak_visit || !old.updated_at || (profile.role !== "super_admin" && old.submitted_by !== user.id)) throw new Error("BA tidak sesuai periode/hak akses atau versinya belum terbaca.");
      const next = valueRecord(old, report);
      const result = await client.from("berita_acara").update({ stock_opname_kat1: next.stock_opname_kat1, stock_opname_kat2: next.stock_opname_kat2 })
        .eq("id", id).eq("updated_at", old.updated_at).select().maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("BA berubah saat nilai disimpan. Perbarui data lalu coba lagi.");
      saved.push(result.data);
    } catch (e) { failures.push({ id, message: e.message }); }
  }
  return { saved, failures };
}
