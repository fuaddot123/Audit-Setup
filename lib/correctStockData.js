import { classifyStockAdjust } from "./stockAdjustFilter.js";
import { nexaCategory } from "./nexaCategories.js";
import { sourceGoodsItem, sourceItemValue } from "./persediaanValuation.js";
import { canImportNexa } from "./nexaRecapSave.js";
import { stockSourceKey } from "./manualStockReconciliation.js";

export const STOCK_CORRECTION_POLICY = "adjust-reasons-v1";
export const OUTSIDE_ADJUST_FILTER = "Di luar filter";
const rowsOf = (r, n) => Array.isArray(r[`stock_opname_kat${n}`]) ? r[`stock_opname_kat${n}`] : [];
const canonical = (v) => JSON.stringify(v, (_, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x);
const finite = (v) => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const withoutReview = (row) => { const { stockAdjustCorrection, ...rest } = row; return rest; };
async function signature(row) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(withoutReview(row))));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
function sourceMap(records, period) {
  const map = new Map();
  for (const r of records.filter((r) => r.period === period && !r.tidak_visit)) for (const row of [...rowsOf(r, 1), ...rowsOf(r, 2)]) {
    if (!Array.isArray(row.nexa?.items)) continue;
    for (const item of row.nexa.items) {
      const key = stockSourceKey({ ...item, auditId: r.id, code: row.nexa.code });
      if (map.has(key)) throw new Error("Identitas sumber Nexa ganda. Periksa data sebelum koreksi.");
      map.set(key, { ...item, branchId: r.branch_id });
    }
  }
  return map;
}

// Update active statuses/details while keeping the original status, detail
// editors and every immutable Nexa count/note/valuation available for recovery.
export async function correctStockRecord(record, sources, { reviewer, timestamp = new Date().toISOString(), restore = false } = {}) {
  if (record.tidak_visit) return record;
  const map = sourceMap(sources, record.period), next = { ...record };
  for (const n of [1, 2]) {
    next[`stock_opname_kat${n}`] = await Promise.all(rowsOf(record, n).map(async (row) => {
      const previous = row.stockAdjustCorrection;
      if (previous) {
        if (previous.policy !== STOCK_CORRECTION_POLICY || previous.appliedSignature !== await signature(row)) throw new Error(`${row.nama || "Baris"} berubah setelah koreksi. Periksa perubahan sebelum memproses ulang.`);
        if (!restore) return row;
        const restored = { ...withoutReview(row), status: previous.originalStatus };
        if (previous.hadBarang) restored.barang = previous.originalBarang;
        else delete restored.barang;
        return restored;
      }
      if (restore) return row;
      const sourceItems = Array.isArray(row.nexa?.items) ? row.nexa.items : null;
      if (sourceItems) {
        if (row.nexa.date?.slice(0, 7) !== record.period || row.nexa.branchId !== record.branch_id) throw new Error("Cabang/periode sumber Nexa tidak sesuai BA.");
        if (!sourceItems.some((i) => i.difference !== 0)) return row;
        for (const i of sourceItems) if (![i.systemQty, i.countedQty, i.difference].every(Number.isFinite) || Math.abs(i.countedQty - i.systemQty - i.difference) > 1e-7) throw new Error("Jumlah sumber Nexa tidak konsisten.");
      } else if (row.status !== "Selisih") return row;
      const oldGoods = Array.isArray(row.barang) ? row.barang : [];
      const candidates = sourceItems ? sourceItems.filter((i) => i.difference !== 0).map((source) => ({ source, old: oldGoods.find((b) => sourceGoodsItem(row, b) === source) || {} }))
        : (oldGoods.length ? oldGoods : [row]).map((old) => {
          const linked = old.nexaLink && map.get(stockSourceKey(old.nexaLink));
          if (linked && linked.branchId !== record.branch_id) throw new Error("Tautan barang manual berbeda cabang.");
          return { old, source: linked || (old.nexaLink ? { difference: finite(old.qty), note: old.sourceNote, valuation: old.valuation } : {
            difference: finite(old.qty), note: old.sourceNote || old.keterangan || row.keterangan, adjustmentCategory: old.adjustmentCategory,
          }) };
        });
      const included = candidates.map(({ source, old }) => ({ source, old, category: classifyStockAdjust(source) })).filter((i) => i.category);
      const goods = included.map(({ source, old, category }) => ({ ...old,
        ...(sourceItems ? { sku: source.sku, nexaItemName: source.name, nama: `${source.sku} — ${source.name}`, kategori: nexaCategory(source) } : {}),
        qty: source.difference, harga: sourceItemValue(source, old.harga).unitCost ?? "", adjustCategory: category,
      }));
      const updated = { ...row, status: goods.length ? "Selisih" : OUTSIDE_ADJUST_FILTER, barang: goods };
      updated.stockAdjustCorrection = { version: 1, policy: STOCK_CORRECTION_POLICY, originalStatus: row.status,
        hadBarang: Object.prototype.hasOwnProperty.call(row, "barang"), originalBarang: row.barang ?? null,
        included: goods.length, excluded: candidates.length - goods.length, reviewedBy: reviewer, reviewedAt: timestamp,
        appliedSignature: await signature(updated) };
      return updated;
    }));
  }
  return next;
}

export async function previewStockCorrections(records, options = {}) {
  const next = await Promise.all(records.map((r) => correctStockRecord(r, records, options)));
  return { records: next, changed: next.filter((r, i) => [1, 2].some((n) => canonical(rowsOf(r, n)) !== canonical(rowsOf(records[i], n)))).length,
    included: next.reduce((s, r) => s + [1, 2].flatMap((n) => rowsOf(r, n)).filter((row) => row.nexa && row.stockAdjustCorrection).reduce((v, row) => v + row.stockAdjustCorrection.included, 0), 0) };
}

export async function saveStockCorrections(client, { profile, period, ids, restore = false, onBackup }) {
  if (!canImportNexa(profile) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || !Array.isArray(ids) || !ids.length || typeof onBackup !== "function") throw new Error("Hak akses, periode, daftar BA atau cadangan belum valid.");
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data?.user || auth.data.user.id !== profile.id) throw new Error("Sesi berubah. Muat ulang halaman.");
  const records = [];
  for (let offset = 0; ; offset += 500) {
    let query = client.from("berita_acara").select("id,branch_id,period,submitted_by,tidak_visit,stock_opname_kat1,stock_opname_kat2,updated_at").eq("period", period).order("id").range(offset, offset + 499);
    if (profile.role !== "super_admin") query = query.eq("submitted_by", profile.id);
    const result = await query;
    if (result.error) throw result.error;
    records.push(...result.data);
    if (result.data.length < 500) break;
  }
  const targets = [...new Set(ids)].map((id) => records.find((r) => r.id === id));
  if (targets.some((r) => !r || r.tidak_visit || !r.updated_at || (profile.role !== "super_admin" && r.submitted_by !== profile.id))) throw new Error("BA tujuan tidak sesuai hak akses/periode atau versinya belum terbaca.");
  await onBackup({ version: 1, period, createdAt: new Date().toISOString(), records: targets });
  const saved = [], failures = [], skipped = [];
  for (const original of targets) {
    try {
      const read = await client.from("berita_acara").select("*").eq("id", original.id).maybeSingle();
      if (read.error) throw read.error;
      const old = read.data;
      if (!old || old.updated_at !== original.updated_at || old.period !== period || old.tidak_visit || (profile.role !== "super_admin" && old.submitted_by !== profile.id)) throw new Error("BA berubah setelah cadangan dibuat. Perbarui data dan ulangi.");
      const next = await correctStockRecord(old, records, { reviewer: profile.id, restore });
      if ([1, 2].every((n) => canonical(rowsOf(next, n)) === canonical(rowsOf(old, n)))) { skipped.push(old.id); continue; }
      const payload = { stock_opname_kat1: next.stock_opname_kat1, stock_opname_kat2: next.stock_opname_kat2 };
      const write = await client.from("berita_acara").update(payload).eq("id", old.id).eq("updated_at", old.updated_at).select().maybeSingle();
      if (write.error) throw write.error;
      if (!write.data) throw new Error("BA berubah saat disimpan. Perbarui data.");
      const verify = await client.from("berita_acara").select("*").eq("id", old.id).maybeSingle();
      if (verify.error || !verify.data || [1, 2].some((n) => canonical(rowsOf(verify.data, n)) !== canonical(rowsOf(next, n)))) throw new Error("Hasil simpan belum dapat diverifikasi. Perbarui data sebelum melanjutkan.");
      saved.push(verify.data);
    } catch (e) { failures.push({ id: original.id, message: e.message }); }
  }
  return { saved, skipped, failures };
}
