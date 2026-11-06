import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { classifyStockAdjust, ADJUST_CATEGORIES } from "../lib/stockAdjustFilter.js";
import { buildStockRecap, recapDocumentNumber } from "../lib/stockOpnameRecap.js";
import { createRecapWorkbook, createRecapPdf } from "../lib/stockOpnameRecapExport.js";
import { readNexaTable } from "../lib/nexaOpnameImport.js";

test("only the six approved reasons qualify, with the correct IN/OUT direction", () => {
  for (let i = 0; i < ADJUST_CATEGORIES.length; i++) {
    const difference = i === 0 ? 1 : -1;
    assert.equal(classifyStockAdjust({ adjustmentCategory: ADJUST_CATEGORIES[i], difference }), ADJUST_CATEGORIES[i]);
    assert.equal(classifyStockAdjust({ adjustmentCategory: ADJUST_CATEGORIES[i], difference: -difference }), null);
  }
  assert.equal(classifyStockAdjust({ note: "1 Inventaris", difference: -1 }), "OUT - Inventaris Kantor");
  assert.equal(classifyStockAdjust({ note: "2 hilang", difference: -2 }), "OUT - Hilang");
  assert.equal(classifyStockAdjust({ note: "Kondisi rusak tidak masuk sistem service", difference: -1 }), "OUT - Rusak");
  assert.equal(classifyStockAdjust({ note: "Temuan 1 unit", difference: 1 }), "IN - Temuan");
});

test("empty, negated, mixed and unsupported reasons never qualify just because qty differs", () => {
  for (const note of ["", "-", "MINUS 1", "Service", "SRV/00130/202610", "1 unit terjual BK/123/202610", "Tertukar dengan barang lebih", "Salah SN", "Mutasi Tegal", "Retur tidak kembali", "Pemutihan", "EXP", "1 error", "Tidak hilang", "Barang bukan rusak", "Belum dibuat inventaris", "2 service dan 1 inventaris", "1 hilang dan 1 inventaris"]) {
    assert.equal(classifyStockAdjust({ note, difference: -1 }), null, note);
  }
  assert.equal(classifyStockAdjust({ sku: "RUSAK", name: "Inventaris Kantor", category: "Hilang", note: "-", difference: -1 }), null);
  assert.equal(classifyStockAdjust({ adjustmentCategory: "OUT - Service", note: "Inventaris", difference: -1 }), null);
  assert.equal(classifyStockAdjust({ note: "Inventaris", difference: 0 }), null);
});

const sourceItem = (sku, difference, note, price) => ({ sku, name: `Barang ${sku}`, difference, systemQty: difference < 0 ? -difference : 0, countedQty: difference > 0 ? difference : 0, note,
  valuation: { unitCost: price }, serial: "" });
const inventory = sourceItem("INV", -2, "2 Inventaris", 100);
const service = sourceItem("SERVICE-EXCLUDED", -1, "Service", 9000000);
const found = sourceItem("FOUND", 1, "Temuan", 50);
const rows = [inventory, service, found];
const source = { id: "source", branch_id: 1, period: "2026-10", audit_date: "2026-10-31", stock_opname_kat1: [{ nama: "Nexa SOH/00001/202610", status: "Selisih",
  barang: rows.map((r) => ({ sku: r.sku, nama: `${r.sku} — ${r.name}`, qty: r.difference, harga: r.valuation.unitCost })),
  nexa: { version: 1, code: "SOH/00001/202610", date: "2026-10-10", items: rows } }], stock_opname_kat2: [] };
const manual = { id: "manual", branch_id: 1, period: "2026-10", audit_date: "2026-10-11", stock_opname_kat1: [{ nama: "Campuran", status: "Selisih", keterangan: "Inventaris dan service", barang: [inventory, service].map((i) => ({ nama: i.name, qty: i.difference, harga: i.valuation.unitCost,
  sourceNote: i.note, nexaLink: { auditId: "source", code: "SOH/00001/202610", sku: i.sku, name: i.name } })) }], stock_opname_kat2: [] };
const run = (records = [source, manual], extra = {}) => buildStockRecap({ branches: [{ id: 1, name: "Semarang" }, { id: 2, name: "Yogyakarta" }], records, period: "2026-10", branchId: 1, adjustOnly: true, ...extra });

test("source and linked manual details share the filter and never double count or mutate source data", () => {
  const before = structuredClone([source, manual]); const recap = run();
  assert.deepEqual(recap.nexaItems.map((i) => i.sku), ["INV", "FOUND"]);
  assert.equal(recap.totals.nexaNetValue, -150);
  assert.equal(recap.totals.knownValue, -150);
  assert.equal(recap.details.length, 3);
  assert.equal(recap.details.filter((i) => !i.isNexa).length, 1);
  assert.ok(recap.details.every((i) => !i.note.includes("Inventaris dan service")));
  assert.equal(recap.filterInfo.excludedNexaDifferences, 1);
  assert.equal(recap.filterInfo.excludedManualDetails, 1);
  assert.deepEqual([source, manual], before);
  const other = structuredClone(source); other.id = "other"; other.branch_id = 2;
  assert.equal(run([source, manual, other]).nexaItems.length, 2);
});

test("a source containing only excluded findings stays traceable with zero eligible discrepancies", () => {
  const s = structuredClone(source); s.stock_opname_kat1[0].nexa.items = [service]; s.stock_opname_kat1[0].barang = [source.stock_opname_kat1[0].barang[1]];
  const recap = run([s]);
  assert.equal(recap.filterInfo.sourceNexaItems, 1);
  assert.equal(recap.filterInfo.excludedNexaDifferences, 1);
  assert.equal(recap.nexaItems.length, 0);
  assert.equal(recap.totals.differenceRows, 0);
  assert.equal(recap.totals.knownValue, 0);
  assert.equal(recap.sources.length, 1);
  assert.equal(recap.summaries[0].status, "Tidak ada selisih sesuai filter");
});

test("PDF/Excel contain only eligible goods and document the temporary policy and category", () => {
  const recap = run(), number = recapDocumentNumber("2026-10", "all", null, 1, true);
  assert.ok(number.endsWith("/ADJUST"));
  const book = createRecapWorkbook(XLSX, recap, number, "06/11/2026");
  const detail = XLSX.utils.sheet_to_json(book.Sheets["Rincian Nexa"], { header: 1 });
  assert.equal(detail.length, 12);
  assert.equal(detail[10][32], "OUT - Inventaris Kantor");
  assert.ok(!JSON.stringify(book).includes("SERVICE-EXCLUDED"));
  assert.ok(JSON.stringify(book).includes("Filter sementara"));
  const pdf = createRecapPdf(jsPDF, autoTable, recap, number, "06/11/2026");
  const text = pdf.internal.pages.flat().join("\n");
  assert.ok(!text.includes("SERVICE-EXCLUDED"));
  assert.ok(text.includes("OUT - Inventaris Kantor"));
  assert.ok(text.includes("Filter kategori adjust"));
});

test("optional structured reason columns are preserved separately from product categories", () => {
  const groups = readNexaTable([["Kode Barang", "Nama Barang", "Jumlah Sistem", "Jumlah Opname", "Kategori Adjust", "Keterangan"],
    ["INV", "Mouse", 1, 0, "OUT - Inventaris Kantor", "Dipakai kantor"]], { code: "SOH/00001/202610", date: "2026-10-01", warehouse: "Ruko SMG" });
  assert.equal(groups[0].items[0].adjustmentCategory, "OUT - Inventaris Kantor");
  assert.equal(classifyStockAdjust(groups[0].items[0]), "OUT - Inventaris Kantor");
});
