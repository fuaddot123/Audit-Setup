import test from "node:test";
import assert from "node:assert/strict";
import * as X from "xlsx";
import { readPersediaanTable, valueNexaRow, valueRecord } from "../lib/persediaanValuation.js";
import { buildStockRecap } from "../lib/stockOpnameRecap.js";
import { createRecapWorkbook } from "../lib/stockOpnameRecapExport.js";
import { savePersediaanValues } from "../lib/savePersediaanValues.js";

const header = ["#", "Kode", "Kode Barang", "Nama Barang", "Qty", "Total", "Qty", "Total", "Qty", "Total", "Qty", "Total", "Qty", "Total"];
const source = (sku, qty, value) => [1, "TEST", sku, `Barang ${sku}`, 99, 999999, 8, 88888, 7, 77777, 6, 66666, qty, value];
const meta = { period: "2026-10", fileName: "report-uji.xlsx", fileSha256: "hash-report-uji" };
const report = () => readPersediaanTable([["Report Persediaan"], header, source("TEST-A", 3, 100), source("TEST-B", 2, 50000), source("TEST-ZERO", 0, 0)], meta);
const row = () => ({ nama: "Nexa SOH/00001/202610", status: "Selisih", keterangan: "Catatan auditor", barang: [
  { nama: "TEST-A — Barang A", qty: 2, harga: 9999 }, { nama: "TEST-B — Barang B", qty: 1, harga: "" }, { nama: "MISSING — Belum ada", qty: 1, harga: 1234 }],
  nexa: { code: "SOH/00001/202610", version: 1, branchId: 1, date: "2026-10-31", warehouse: "Ruko SMG", fileName: "opname-uji.xlsx", items: [
    { sku: "TEST-A", name: "Barang A", systemQty: 5, countedQty: 3, difference: -2 }, { sku: "TEST-B", name: "Barang B", systemQty: 2, countedQty: 3, difference: 1 }, { sku: "MISSING", name: "Belum ada", systemQty: 1, countedQty: 0, difference: -1 }] } });
const ba = () => ({ id: "test-ba", branch_id: 1, period: "2026-10", audit_date: "2026-10-31", submitted_by: "auditor", updated_at: "v1", tidak_visit: false, stock_opname_kat1: [row()], stock_opname_kat2: [{ nama: "Manual tetap", status: "Lengkap" }] });

test("uses only Sisa columns in Nexa's native export, with no intermediate currency rounding", () => {
  const r = report();
  assert.equal(r.entries.get("TEST-A").unitCost, 100 / 3);
  const before = row(), valued = valueNexaRow(before, r);
  assert.equal(valued.barang[0].harga, 100 / 3);
  assert.equal(valued.barang[0].qty, -2);
  assert.equal(valued.nexa.items[0].valuation.reportAmount, 100);
  assert.equal(valued.nexa.items[0].valuation.reportQty, 3);
  assert.equal(before.barang[0].harga, 9999);
  assert.equal(valued.keterangan, before.keterangan);
});

test("zero denominator, negative/missing values, missing SKU and duplicates stay unknown", () => {
  const r = readPersediaanTable([header, source("ZERO", 0, 100), source("NEG", -1, 100), source("BLANK", "", 5), source("DUP", 1, 5), source("DUP", 1, 6), source("FREE", 2, 0)], meta);
  assert.equal(r.entries.get("ZERO").status, "zero_qty");
  assert.equal(r.entries.get("NEG").status, "invalid");
  assert.equal(r.entries.get("BLANK").status, "invalid");
  assert.equal(r.entries.get("DUP").status, "duplicate");
  assert.equal(r.entries.get("FREE").unitCost, 0);
  assert.equal(valueNexaRow(row(), report()).barang[2].harga, "");
  assert.equal(valueNexaRow(row(), report()).nexa.items[2].valuation.status, "missing");
});

test("period selection is required; wrong-period reports never reprice stock or manual rows", () => {
  assert.throws(() => readPersediaanTable([header, source("A", 1, 2)], { ...meta, period: "" }), /periode/);
  assert.throws(() => readPersediaanTable([["Kode Barang", "Nama Barang", "Qty", "Total"], ["A", "A", 1, 2]], meta), /Sisa/);
  const record = ba(), old = structuredClone(record);
  assert.equal(valueRecord(record, { ...report(), period: "2026-09" }), record);
  const valued = valueRecord(record, report());
  assert.deepEqual(valued.stock_opname_kat2, old.stock_opname_kat2);
  assert.deepEqual(record, old);
});

test("flattened Sisa headers and exact SKU matching are supported without guessing by product name", () => {
  const r = readPersediaanTable([["Kode Barang", "Nama Barang", "Sisa Qty", "Sisa Nilai"], [" test-a ", "Nama lain", 4, 100]], meta);
  assert.equal(valueNexaRow(row(), r).barang[0].harga, 25);
  assert.equal(valueNexaRow(row(), r).barang[1].harga, "");
});

test("reused opname codes cannot overwrite another product's quantity or acquire an ambiguous price", () => {
  const source = row();
  source.nexa.items.push({ sku: "TEST-A", name: "Produk berbeda", systemQty: 6, countedQty: 0, difference: -6 });
  source.barang.push({ sku: "TEST-A", nexaItemName: "Produk berbeda", nama: "TEST-A — Produk berbeda", qty: 6, harga: 999 });
  const valued = valueNexaRow(source, report());
  assert.deepEqual(valued.barang.map((b) => b.qty), [-2, 1, -1, -6]);
  assert.equal(valued.barang[0].harga, "");
  assert.equal(valued.barang[3].harga, "");
  assert.equal(valued.nexa.items[0].valuation.status, "ambiguous_source");
  assert.equal(valued.nexa.items[3].valuation.status, "ambiguous_source");
  const recap = buildStockRecap({ branches: [{ id: 1, name: "Semarang" }], records: [{ ...ba(), stock_opname_kat1: [valued] }], period: "2026-10" });
  assert.equal(recap.details[0].qty, -2);
  assert.equal(recap.details[3].qty, -6);
  assert.equal(recap.nexaItems[0].signedValue, null);
  assert.equal(recap.nexaItems[3].signedValue, null);
});

test("recap and Excel keep signed monetary differences and the report denominator/numerator", () => {
  const valued = valueRecord(ba(), report());
  const recap = buildStockRecap({ branches: [{ id: 1, name: "Semarang" }], records: [valued], period: "2026-10" });
  assert.equal(recap.details[0].value, -2 * 100 / 3);
  assert.equal(recap.nexaItems[1].signedValue, 25000);
  assert.equal(recap.nexaItems[2].signedValue, null);
  assert.equal(recap.totals.nexaUnpriced, 1);
  const book = createRecapWorkbook(X, recap, "number", "date");
  const roundtrip = X.read(X.write(book, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
  const rows = X.utils.sheet_to_json(roundtrip.Sheets["Rincian Nexa"], { header: 1, defval: null });
  assert.equal(rows[10][18], 100 / 3);
  assert.equal(rows[10][19], 3); assert.equal(rows[10][20], 100); assert.equal(rows[10][21], -2 * 100 / 3);
  assert.equal(rows[10][25], "report-uji.xlsx");
});

function clientMock({ conflictId = null, roleUser = "auditor" } = {}) {
  const data = new Map([["test-ba", ba()], ["conflict", { ...ba(), id: "conflict" }]]), writes = [];
  return { writes, data, auth: { getUser: async () => ({ data: { user: { id: roleUser } } }) }, from() {
    let payload = null, filters = [];
    const chain = { select() { return chain; }, eq(k, v) { filters.push([k, v]); return chain; }, update(p) { payload = p; return chain; }, async maybeSingle() {
      const id = filters.find(([k]) => k === "id")[1];
      if (!payload) return { data: structuredClone(data.get(id)) };
      if (id === conflictId) return { data: null };
      writes.push({ payload, filters }); const saved = { ...data.get(id), ...payload }; data.set(id, saved); return { data: saved };
    } }; return chain;
  } };
}
test("valuation save checks role/session, preserves other fields and reports partial concurrency failures", async () => {
  const db = clientMock({ conflictId: "conflict" });
  const input = { profile: { id: "auditor", role: "auditor" }, ids: ["test-ba", "conflict"], report: report() };
  const result = await savePersediaanValues(db, input);
  assert.equal(result.saved.length, 1); assert.equal(result.failures.length, 1);
  assert.ok(db.writes[0].filters.some(([k, v]) => k === "updated_at" && v === "v1"));
  assert.deepEqual(Object.keys(db.writes[0].payload).sort(), ["stock_opname_kat1", "stock_opname_kat2"]);
  assert.equal(db.data.get("test-ba").submitted_by, "auditor");
  await assert.rejects(() => savePersediaanValues(clientMock(), { ...input, profile: { id: "auditor", role: "ceo" } }), /tidak dapat/);
  await assert.rejects(() => savePersediaanValues(clientMock({ roleUser: "other" }), input), /Sesi berubah/);
});
