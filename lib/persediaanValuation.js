import { nexaNumber } from "./nexaOpnameImport.js";

const text = (v) => String(v ?? "").trim();
const key = (v) => text(v).toLowerCase().replace(/[^a-z0-9]/g, "");
const skuKey = (v) => text(v).toUpperCase();
export const valuationLabels = { matched: "Dari report persediaan", missing: "Kode tidak ditemukan", zero_qty: "Qty persediaan nol", invalid: "Saldo persediaan tidak valid", duplicate: "Kode ganda pada report", no_report: "Report belum dimuat", manual: "Harga sebelumnya" };

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
      status: status === "matched" && !Number.isFinite(unitCost) ? "invalid" : status, sourceRow: i + 1 };
    entries.set(sku, entries.has(sku) ? { ...entry, status: "duplicate", unitCost: null } : entry);
  }
  if (!entries.size) throw new Error("Report Persediaan tidak memiliki rincian barang.");
  return { ...metadata, basis: "Sisa Nilai / Sisa Qty", entries, count: entries.size, priced: [...entries.values()].filter((r) => r.status === "matched").length };
}

export function normalizeNexaQuantities(row) {
  if (!Array.isArray(row.nexa?.items)) return row;
  const bySku = new Map(row.nexa.items.map((i) => [skuKey(i.sku), i]));
  return { ...row, barang: (Array.isArray(row.barang) ? row.barang : []).map((b) => {
    const sku = skuKey(b.sku || b.nama?.split(" — ")[0]), source = bySku.get(sku);
    return source ? { ...b, sku: source.sku, qty: source.difference } : b;
  }) };
}

export function valueNexaRow(row, report) {
  if (!Array.isArray(row.nexa?.items) || !report || row.nexa.date?.slice(0, 7) !== report.period) return normalizeNexaQuantities(row);
  const items = row.nexa.items.map((item) => {
    const entry = report.entries.get(skuKey(item.sku));
    const status = entry?.status || "missing";
    const valuation = { status, unitCost: entry?.unitCost ?? null, reportQty: entry?.qty ?? null, reportAmount: entry?.amount ?? null,
      period: report.period, basis: report.basis, fileName: report.fileName, fileSha256: report.fileSha256, sourceRow: entry?.sourceRow ?? null };
    return { ...item, valuation };
  });
  const normalized = normalizeNexaQuantities({ ...row, nexa: { ...row.nexa, items } });
  const bySku = new Map(items.map((i) => [skuKey(i.sku), i]));
  return { ...normalized, barang: normalized.barang.map((b) => ({ ...b, harga: bySku.get(skuKey(b.sku))?.valuation.unitCost ?? "" })) };
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
