import { nexaNumber } from "./nexaOpnameImport.js";
import { nexaCategory } from "./nexaCategories.js";

const text = (v) => String(v ?? "").trim();
const key = (v) => text(v).toLowerCase().replace(/[^a-z0-9]/g, "");
const skuKey = (v) => text(v).toUpperCase();
export const valuationLabels = { matched: "Dari report persediaan", opening: "Acuan saldo awal", historical: "Acuan report sebelumnya", zero_book: "Nilai buku sumber Rp0", missing: "Kode tidak ditemukan", zero_qty: "Qty persediaan nol", invalid: "Saldo persediaan tidak valid", duplicate: "Kode ganda pada report", ambiguous_source: "Kode dipakai beberapa produk opname", no_report: "Report belum dimuat", manual: "Harga sebelumnya" };

export function readPersediaanTable(rows, metadata) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(metadata.period || "")) throw new Error("Isi periode Report Persediaan sesuai sumber, bukan tanggal unduh file.");
  const headerIndex = rows.findIndex((r) => r.map(key).includes("kodebarang") && r.map(key).includes("namabarang"));
  if (headerIndex < 0) throw new Error("Kolom Kode Barang dan Nama Barang pada Report Persediaan tidak ditemukan.");
  const headers = rows[headerIndex].map(key);
  const skuColumn = headers.indexOf("kodebarang"), nameColumn = headers.indexOf("namabarang");
  let qtyColumn = headers.findIndex((h) => ["sisaqty", "qtysisa", "saldoakhirqty"].includes(h));
  let valueColumn = headers.findIndex((h) => ["sisanilai", "sisanominal", "sisatotal", "saldoakhirnilai"].includes(h));
  // Nexa's own Excel export drops the grouped headers. This exact 14-column
  // layout is documented by the source page: Awal, Pembelian, In, Out, Sisa.
  const nativeLayout = headers.length === 14 && headers.slice(0, 4).join() === ["", "kode", "kodebarang", "namabarang"].join()
    && headers.slice(4).every((h, i) => h === (i % 2 ? "total" : "qty"));
  if (nativeLayout) { qtyColumn = 12; valueColumn = 13; }
  if (qtyColumn < 0 || valueColumn < 0) throw new Error("Kolom Sisa Qty dan Sisa Nilai belum dikenali. Gunakan ekspor Report Persediaan Nexa dengan seluruh kolom.");
  const entries = new Map();
  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const r = rows[i], sku = skuKey(r[skuColumn]);
    if (!sku || ["total", "grandtotal", "jumlah"].includes(key(sku))) continue;
    const qty = nexaNumber(r[qtyColumn]), amount = nexaNumber(r[valueColumn]);
    const status = qty == null || amount == null || qty < 0 || amount < 0 ? "invalid" : qty === 0 ? "zero_qty" : "matched";
    const unitCost = status === "matched" ? amount / qty : null;
    const entry = { sku, name: text(r[nameColumn]), qty, amount, unitCost: Number.isFinite(unitCost) ? unitCost : null,
      status: status === "matched" && !Number.isFinite(unitCost) ? "invalid" : status, sourceRow: i + 1,
      openingQty: nativeLayout ? nexaNumber(r[4]) : null, openingAmount: nativeLayout ? nexaNumber(r[5]) : null };
    entries.set(sku, entries.has(sku) ? { ...entry, status: "duplicate", unitCost: null } : entry);
  }
  if (!entries.size) throw new Error("Report Persediaan tidak memiliki rincian barang.");
  return { ...metadata, basis: "Sisa Nilai / Sisa Qty", entries, count: entries.size, priced: [...entries.values()].filter((r) => r.status === "matched").length };
}

// Reference costs are opt-in and keep their actual numerator, denominator,
// period and source file. A genuine zero book cost is never replaced.
function resolveCost(report, sku) {
  const current = report.entries.get(sku);
  const cost = (entry, source, historical = false) => {
    if (!entry || ["invalid", "duplicate"].includes(entry.status)) return null;
    if (entry.status === "matched") return { entry, source, unitCost: entry.unitCost,
      costQty: entry.qty, costAmount: entry.amount, basis: "Sisa Nilai / Sisa Qty",
      status: historical ? "historical" : entry.unitCost === 0 ? "zero_book" : "matched" };
    if (entry.status === "zero_qty" && entry.amount === 0 && report.allowReferenceCosts
      && entry.openingQty > 0 && entry.openingAmount > 0 && Number.isFinite(entry.openingAmount / entry.openingQty)) {
      return { entry, source, unitCost: entry.openingAmount / entry.openingQty, costQty: entry.openingQty,
        costAmount: entry.openingAmount, basis: "Saldo Awal Nilai / Saldo Awal Qty", status: historical ? "historical" : "opening" };
    }
    return null;
  };
  const direct = cost(current, report);
  if (direct) return direct;
  // Never bypass an invalid/duplicate current key with an older price.
  if (!report.allowReferenceCosts || current && (current.status !== "zero_qty" || current.amount !== 0)) return { entry: current, source: report };
  const previous = [...(report.references || [])].filter((r) => /^\d{4}-\d{2}$/.test(r.period) && r.period < report.period)
    .sort((a, b) => b.period.localeCompare(a.period));
  for (const source of previous) {
    const found = cost(source.entries.get(sku), source, true);
    if (found && found.unitCost > 0) return found;
  }
  return { entry: current, source: report };
}

export function sourceGoodsItem(row, goods) {
  const sku = skuKey(goods.sku || goods.nama?.split(" — ")[0]);
  const candidates = (row.nexa?.items || []).filter((i) => skuKey(i.sku) === sku);
  if (candidates.length === 1) return candidates[0];
  const name = text(goods.nexaItemName || goods.nama?.split(" — ").slice(1).join(" — "));
  return candidates.find((i) => text(i.name) === name);
}

export function normalizeNexaQuantities(row) {
  if (!Array.isArray(row.nexa?.items)) return row;
  return { ...row, barang: (Array.isArray(row.barang) ? row.barang : []).map((b) => {
    const source = sourceGoodsItem(row, b);
    return source ? { ...b, sku: source.sku, qty: source.difference } : b;
  }) };
}

export function valueNexaRow(row, report) {
  if (!Array.isArray(row.nexa?.items) || !report || row.nexa.date?.slice(0, 7) !== report.period) return normalizeNexaQuantities(row);
  const items = row.nexa.items.map((item) => {
    const resolved = resolveCost(report, skuKey(item.sku)), { entry, source } = resolved;
    const ambiguous = row.nexa.items.filter((i) => skuKey(i.sku) === skuKey(item.sku)).length > 1;
    const status = ambiguous ? "ambiguous_source" : resolved.status || entry?.status || "missing";
    const valuation = { status, unitCost: ambiguous ? null : resolved.unitCost ?? null, reportQty: entry?.qty ?? null, reportAmount: entry?.amount ?? null,
      costQty: resolved.costQty ?? null, costAmount: resolved.costAmount ?? null, targetPeriod: report.period,
      period: source.period, basis: resolved.basis || source.basis, fileName: source.fileName, fileSha256: source.fileSha256, sourceRow: entry?.sourceRow ?? null };
    return { ...item, category: nexaCategory(item), valuation };
  });
  const normalized = normalizeNexaQuantities({ ...row, nexa: { ...row.nexa, items } });
  return { ...normalized, barang: normalized.barang.map((b) => ({ ...b, kategori: sourceGoodsItem(normalized, b)?.category || b.kategori || "", harga: sourceGoodsItem(normalized, b)?.valuation.unitCost ?? "" })) };
}

export function valueRecord(record, report) {
  if (!report || record.period !== report.period) return record;
  return { ...record, ...Object.fromEntries([1, 2].map((n) => {
    const rows = record[`stock_opname_kat${n}`];
    return [`stock_opname_kat${n}`, Array.isArray(rows) ? rows.map((r) => valueNexaRow(r, report)) : rows ?? []];
  })) };
}

export function sourceItemValue(item, previousPrice = null) {
  const legacy = previousPrice !== "" && previousPrice != null && Number.isFinite(Number(previousPrice)) && Number(previousPrice) >= 0 ? Number(previousPrice) : null;
  const unitCost = item.valuation ? item.valuation.unitCost ?? null : legacy;
  return { unitCost, signedValue: item.difference === 0 ? 0 : unitCost == null ? null : unitCost * item.difference,
    status: item.valuation?.status || (legacy == null ? "no_report" : "manual") };
}
