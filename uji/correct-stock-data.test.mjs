import test from "node:test";
import assert from "node:assert/strict";
import { correctStockRecord, previewStockCorrections, saveStockCorrections } from "../lib/correctStockData.js";
import { nexaAppendixHtml } from "../lib/nexaOpnameImport.js";
import { buildStockRecap } from "../lib/stockOpnameRecap.js";

const item = (sku, note, cost) => ({ sku, name: sku, note, systemQty: 2, countedQty: 1, difference: -1, valuation: { unitCost: cost } });
const goods = [item("INV", "Inventaris", 100), item("SVC", "Service", 99999), item("ZERO", "Hilang", 0)];
const source = { id: "source", branch_id: 1, period: "2026-10", audit_date: "2026-10-31", submitted_by: "u", updated_at: "before", stock_opname_kat1: [{ nama: "Nexa SOH/1/202610", status: "Selisih", keterangan: "Asli", barang: goods.map((i) => ({ sku: i.sku, nama: `${i.sku} — ${i.name}`, qty: 1, harga: i.valuation.unitCost })), nexa: { version: 1, branchId: 1, code: "SOH/1/202610", date: "2026-10-10", items: goods } }], stock_opname_kat2: [] };
const manual = { ...source, id: "manual", stock_opname_kat1: [{ nama: "Campuran", status: "Selisih", keterangan: "Service dan inventaris", barang: goods.map((i) => ({ nama: i.name, qty: i.difference, harga: 500, sourceNote: "Inventaris", nexaLink: { auditId: "source", code: "SOH/1/202610", sku: i.sku, name: i.name } })) }] };
const options = { reviewer: "u", timestamp: "fixed" };

test("correction keeps immutable evidence, signed real values and zero cost, and is reversible/idempotent", async () => {
  const original = structuredClone(source), next = await correctStockRecord(source, [source], options), row = next.stock_opname_kat1[0];
  assert.deepEqual(row.nexa, source.stock_opname_kat1[0].nexa);
  assert.deepEqual(row.barang.map((b) => [b.sku, b.qty, b.harga]), [["INV", -1, 100], ["ZERO", -1, 0]]);
  assert.deepEqual(source, original);
  assert.deepEqual(await correctStockRecord(next, [next], options), next);
  // jsonb can reorder keys without changing content.
  const reordered = JSON.parse(JSON.stringify(next, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v));
  assert.deepEqual(await correctStockRecord(reordered, [reordered], { ...options, restore: true }), original);
  const edited = structuredClone(next); edited.stock_opname_kat1[0].keterangan = "Diubah";
  await assert.rejects(() => correctStockRecord(edited, [edited], { restore: true }), /berubah/);
});

test("linked manual details follow actual Nexa reasons rather than generic BA notes; totals remain deduplicated", async () => {
  const result = await previewStockCorrections([source, manual], options);
  assert.equal(result.changed, 2); assert.equal(result.included, 2);
  assert.deepEqual(result.records[1].stock_opname_kat1[0].barang.map((b) => b.nama), ["INV", "ZERO"]);
  const recap = buildStockRecap({ branches: [{ id: 1, name: "A" }], records: result.records, period: source.period, adjustOnly: true });
  assert.equal(recap.totals.knownValue, -100);
  assert.equal(recap.filterInfo.excludedNexaDifferences, 1);
});

test("excluded rows are neutral, unknown cost is blank, wrong source metadata/counts are rejected", async () => {
  const onlyService = structuredClone(source); onlyService.stock_opname_kat1[0].nexa.items = [goods[1]];
  const corrected = await correctStockRecord(onlyService, [onlyService], options);
  assert.equal(corrected.stock_opname_kat1[0].status, "Di luar filter");
  assert.deepEqual(corrected.stock_opname_kat1[0].barang, []);
  const missing = structuredClone(source); missing.stock_opname_kat1[0].nexa.items[0].valuation.unitCost = null;
  assert.equal((await correctStockRecord(missing, [missing], options)).stock_opname_kat1[0].barang[0].harga, "");
  for (const change of [r => r.nexa.branchId = 2, r => r.nexa.date = "2026-09-01", r => r.nexa.items[0].countedQty = 50]) {
    const bad = structuredClone(source); change(bad.stock_opname_kat1[0]); await assert.rejects(() => correctStockRecord(bad, [bad], options));
  }
  const noVisit = { ...source, tidak_visit: true }; assert.equal(await correctStockRecord(noVisit, [noVisit], options), noVisit);
  const html = nexaAppendixHtml(source.stock_opname_kat1, "id", String, true);
  assert.ok(html.includes("OUT - Inventaris Kantor")); assert.ok(!html.includes("SVC"));
});

function client({ conflict = false, owner = "u", verifyBad = false } = {}) {
  let record = { ...structuredClone(source), submitted_by: owner }, written = false;
  const calls = [];
  return { calls, auth: { getUser: async () => ({ data: { user: { id: "u" } } }) }, from() {
    const q = { filters: [], payload: null }, c = { select() { return c; }, eq(k, v) { q.filters.push([k, v]); return c; }, order() { return c; }, range() { return c; }, then(resolve) { return Promise.resolve({ data: [record] }).then(resolve); }, update(p) { q.payload = p; return c; }, async maybeSingle() {
      if (!q.payload) return { data: verifyBad && written ? source : record };
      calls.push(q); written = true; if (conflict) return { data: null };
      record = { ...record, ...q.payload, updated_at: "after" }; return { data: record };
    } }; return c;
  } };
}
test("ordinary authenticated save backs up first, preserves ownership, uses CAS and verifies persisted results", async () => {
  const db = client(), args = { profile: { id: "u", role: "auditor" }, period: source.period, ids: [source.id], onBackup(b) { assert.equal(db.calls.length, 0); assert.equal(b.records[0].updated_at, "before"); } };
  const saved = await saveStockCorrections(db, args); assert.equal(saved.saved.length, 1);
  assert.deepEqual(Object.keys(db.calls[0].payload).sort(), ["stock_opname_kat1", "stock_opname_kat2"]);
  assert.ok(db.calls[0].filters.some(([k, v]) => k === "updated_at" && v === "before"));
  assert.equal((await saveStockCorrections(client({ conflict: true }), { ...args, onBackup() {} })).failures.length, 1);
  assert.equal((await saveStockCorrections(client({ verifyBad: true }), { ...args, onBackup() {} })).failures.length, 1);
  const denied = client({ owner: "other" }); await assert.rejects(() => saveStockCorrections(denied, args), /hak akses/); assert.equal(denied.calls.length, 0);
  await assert.rejects(() => saveStockCorrections(db, { ...args, onBackup() { throw Error("No backup"); } }), /No backup/);
});
