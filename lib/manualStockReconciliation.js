import { canImportNexa } from "./nexaRecapSave.js";
import { nexaCategory } from "./nexaCategories.js";
import { sourceItemValue } from "./persediaanValuation.js";

const clean = (v) => String(v ?? "").trim();
const arrays = (record) => [1, 2].flatMap((n) => Array.isArray(record[`stock_opname_kat${n}`]) ? record[`stock_opname_kat${n}`] : []);
export const stockSourceKey = (r) => JSON.stringify([r.auditId, r.code, r.sku, r.name]);

export function readManualPlan(text, period) {
  if (text.length > 1024 * 1024) throw new Error("Pencocokan maksimal 1 MB.");
  const plan = JSON.parse(text);
  if (plan.version !== 1 || plan.period !== period || !Array.isArray(plan.rows) || !plan.rows.length || plan.rows.length > 1000) throw new Error("Format atau periode pencocokan tidak sesuai.");
  const keys = new Set();
  for (const row of plan.rows) {
    if (!clean(row.auditId) || !clean(row.item) || typeof row.note !== "string" || !Array.isArray(row.links)
      || row.links.length > 200 || (!row.links.length && !clean(row.pendingReason))) throw new Error("Identitas BA, catatan dan tautan sumber wajib valid.");
    const key = JSON.stringify([row.auditId, row.item, row.note]);
    if (keys.has(key)) throw new Error("Satu baris BA muncul dua kali dalam pencocokan.");
    keys.add(key);
    for (const link of row.links) if (![link.code, link.sku, link.name].every((v) => typeof v === "string" && v.trim())) throw new Error("Nomor opname, SKU dan nama sumber harus lengkap.");
  }
  return plan;
}

export function reconcileManualRecord(record, plan, sources, { reviewer, timestamp } = {}) {
  if (record.period !== plan.period || record.tidak_visit) throw new Error("BA tujuan berbeda periode atau tidak visit.");
  const targets = plan.rows.filter((r) => r.auditId === record.id);
  if (!targets.length) throw new Error("BA tidak tercantum pada pencocokan.");
  const available = sources.filter((r) => r.period === plan.period && r.branch_id === record.branch_id && !r.tidak_visit)
    .flatMap((r) => arrays(r).filter((row) => row.nexa?.version === 1 && Array.isArray(row.nexa.items) && row.nexa.date?.slice(0, 7) === plan.period)
      .flatMap((row) => row.nexa.items.map((item) => ({ ...item, auditId: r.id, code: row.nexa.code, date: row.nexa.date }))));
  const matches = new Map();
  for (const target of targets) {
    const rows = arrays(record).filter((r) => !r.nexa && r.status === "Selisih" && clean(r.nama) === clean(target.item) && clean(r.keterangan) === clean(target.note));
    if (rows.length !== 1) throw new Error(`Baris ${target.item} berubah atau tidak unik. Perbarui pencocokan.`);
    const old = rows[0];
    if (!old.manualReconciliation && (old.barang || []).some((b) => b.harga !== "" && b.harga != null)) throw new Error(`${target.item} sudah memiliki harga manual. Periksa sebelum mengganti.`);
    const used = new Set();
    const goods = target.links.map((link) => {
      const found = available.filter((s) => s.code === link.code && s.sku === link.sku && s.name === link.name);
      if (found.length !== 1) throw new Error(`Sumber ${link.code} / ${link.sku} tidak unik atau berbeda cabang.`);
      const source = found[0], key = stockSourceKey(source), price = sourceItemValue(source).unitCost;
      if (used.has(key)) throw new Error("Sumber barang yang sama ditautkan dua kali pada satu baris.");
      used.add(key);
      if (!Number.isFinite(source.systemQty) || !Number.isFinite(source.countedQty) || !Number.isFinite(source.difference)
        || source.countedQty - source.systemQty !== source.difference || source.difference === 0 || price == null || !Number.isFinite(price) || price < 0) throw new Error(`Jumlah atau harga sumber ${link.sku} belum valid.`);
      return { nama: `${source.sku} — ${source.name}`, sku: source.sku, kategori: nexaCategory(source), qty: source.difference, harga: price,
        stok_admin: source.systemQty, stok_fisik: source.countedQty, valuation: source.valuation,
        nexaLink: { auditId: source.auditId, code: source.code, date: source.date, sku: source.sku, name: source.name }, sourceNote: clean(source.note) };
    });
    if (goods.length && clean(target.pendingReason)) goods.push({ nama: "Bagian catatan yang perlu verifikasi", qty: "", harga: "", reconciliationPending: true });
    matches.set(old, { ...old, ...(goods.length ? { barang: goods } : {}), manualReconciliation: {
      version: 1, originalBarang: old.manualReconciliation?.version === 1 ? old.manualReconciliation.originalBarang : old.barang ?? null,
      links: target.links, reason: clean(target.reason), pendingReason: clean(target.pendingReason), reviewedBy: reviewer, reviewedAt: timestamp,
    } });
  }
  return { ...record, ...Object.fromEntries([1, 2].map((n) => {
    const key = `stock_opname_kat${n}`;
    return [key, (record[key] || []).map((row) => matches.get(row) || row)];
  })) };
}

// Read source prices from the ordinary authenticated database client, never from
// imported JSON. Retain ownership/RLS and guard each target with updated_at.
export async function saveManualReconciliation(client, { profile, plan }) {
  if (!canImportNexa(profile)) throw new Error("Akun tidak dapat melengkapi BA.");
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user || user.id !== profile.id) throw new Error("Sesi berubah. Muat ulang halaman.");
  const records = [];
  for (let offset = 0; ; offset += 500) {
    const result = await client.from("berita_acara").select("*").eq("period", plan.period).order("id").range(offset, offset + 499);
    if (result.error) throw result.error;
    records.push(...result.data);
    if (result.data.length < 500) break;
  }
  const saved = [], failures = [];
  for (const id of new Set(plan.rows.map((r) => r.auditId))) {
    try {
      const read = await client.from("berita_acara").select("*").eq("id", id).maybeSingle();
      if (read.error) throw read.error;
      const old = read.data;
      if (!old?.updated_at || (profile.role !== "super_admin" && old.submitted_by !== user.id)) throw new Error("Versi BA atau hak akses tidak sesuai.");
      const next = reconcileManualRecord(old, plan, records, { reviewer: user.id, timestamp: new Date().toISOString() });
      const result = await client.from("berita_acara").update({ stock_opname_kat1: next.stock_opname_kat1, stock_opname_kat2: next.stock_opname_kat2 })
        .eq("id", id).eq("updated_at", old.updated_at).select().maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("BA berubah saat disimpan. Perbarui data.");
      saved.push(result.data);
    } catch (e) { failures.push({ id, message: e.message }); }
  }
  return { saved, failures };
}
