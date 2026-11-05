import test from "node:test";
import assert from "node:assert/strict";
import { readManualPlan, reconcileManualRecord, saveManualReconciliation } from "../lib/manualStockReconciliation.js";
import { buildStockRecap } from "../lib/stockOpnameRecap.js";

const target = { id: "manual", branch_id: 1, period: "2026-10", audit_date: "2026-10-08", submitted_by: "user", updated_at: "original",
  stock_opname_kat1: [{ nama: "LAPTOP", status: "Selisih", keterangan: "1 unit service", barang: [{ nama: "", qty: "", harga: "" }] }], stock_opname_kat2: [] };
const item = { sku: "PR-LAP-TEST", name: "Laptop Test", systemQty: 5, countedQty: 4, difference: -1, note: "1 service", valuation: { unitCost: 2000000, period: "2026-10", costQty: 5, costAmount: 10000000 } };
const source = { id: "source", branch_id: 1, period: "2026-10", audit_date: "2026-10-31", stock_opname_kat1: [{ nama: "Nexa", status: "Selisih", barang: [{ nama: "PR-LAP-TEST — Laptop Test", sku: item.sku, qty: -1, harga: 2000000 }], nexa: { version: 1, code: "SOH/00001/202610", date: "2026-10-07", items: [item] } }], stock_opname_kat2: [] };
const plan = { version: 1, period: "2026-10", rows: [{ auditId: "manual", item: "LAPTOP", note: "1 unit service", reason: "Model dan service cocok", links: [{ code: "SOH/00001/202610", sku: item.sku, name: item.name }] }] };
const reconcile = (p = plan, s = [source], t = target) => reconcileManualRecord(t, p, s, { reviewer: "user", timestamp: "now" });

test("links use source quantities/cost, retain original editors/notes, and do not double count", () => {
  const next = reconcile();
  const row = next.stock_opname_kat1[0];
  assert.equal(row.keterangan, target.stock_opname_kat1[0].keterangan);
  assert.deepEqual(row.manualReconciliation.originalBarang, target.stock_opname_kat1[0].barang);
  assert.equal(row.barang[0].qty, -1);
  assert.equal(row.barang[0].harga, 2000000);
  assert.equal(row.barang[0].stok_admin, 5);
  assert.equal(row.barang[0].stok_fisik, 4);
  assert.equal(target.stock_opname_kat1[0].barang[0].harga, "");
  const recap = buildStockRecap({ branches: [{ id: 1, name: "Semarang" }], records: [next, source], period: plan.period });
  assert.equal(recap.totals.knownValue, -2000000);
  assert.equal(recap.details.find((r) => r.nexaLink).excludedFromTotal, true);
  assert.equal(recap.details.find((r) => r.nexaLink).price, 2000000);
  const twice = reconcile(plan, [source], next);
  assert.deepEqual(twice.stock_opname_kat1[0].manualReconciliation.originalBarang, target.stock_opname_kat1[0].barang);
  assert.equal(twice.stock_opname_kat1[0].barang.length, 1);
  const noEditors = structuredClone(target); delete noEditors.stock_opname_kat1[0].barang;
  const first = reconcile(plan, [source], noEditors);
  assert.equal(reconcile(plan, [source], first).stock_opname_kat1[0].manualReconciliation.originalBarang, null);
});

test("partial and unresolved notes remain unknown with a precise reason", () => {
  const partial = structuredClone(plan); partial.rows[0].pendingReason = "Satu model lain belum diketahui";
  const next = reconcile(partial);
  const recap = buildStockRecap({ branches: [{ id: 1, name: "Semarang" }], records: [next, source], period: plan.period });
  assert.equal(recap.totals.unpriced, 1);
  assert.ok(recap.details.some((r) => r.pendingReason === partial.rows[0].pendingReason && r.value == null));
  const unresolved = structuredClone(partial); unresolved.rows[0].links = [];
  assert.deepEqual(reconcile(unresolved).stock_opname_kat1[0].barang, target.stock_opname_kat1[0].barang);
});

test("a real source zero remains zero and linked prices follow the selected source report", () => {
  const zero = structuredClone(source); zero.stock_opname_kat1[0].nexa.items[0].valuation.unitCost = 0;
  assert.equal(reconcile(plan, [zero]).stock_opname_kat1[0].barang[0].harga, 0);
  const changed = structuredClone(source); changed.stock_opname_kat1[0].nexa.items[0].valuation.unitCost = 2100000;
  const recap = buildStockRecap({ branches: [{ id: 1, name: "Semarang" }], records: [reconcile(), changed], period: plan.period });
  assert.equal(recap.details.find((r) => r.nexaLink).price, 2100000);
});

test("reject wrong branch/period, duplicate identity, edited note, invalid quantity, missing price and priced manual override", () => {
  assert.throws(() => readManualPlan(JSON.stringify(plan), "2026-09"), /periode/);
  assert.throws(() => readManualPlan(JSON.stringify({ ...plan, rows: [...plan.rows, ...plan.rows] }), plan.period), /dua kali/);
  for (const edit of [s => s.branch_id = 2, s => s.period = "2026-09", s => s.stock_opname_kat1[0].nexa.items[0].countedQty = 3,
    s => s.stock_opname_kat1[0].nexa.items[0].valuation.unitCost = null]) {
    const s = structuredClone(source); edit(s); assert.throws(() => reconcile(plan, [s]));
  }
  const old = structuredClone(target); old.stock_opname_kat1[0].keterangan = "Baru"; assert.throws(() => reconcile(plan, [source], old), /berubah/);
  const priced = structuredClone(target); priced.stock_opname_kat1[0].barang[0].harga = 100; assert.throws(() => reconcile(plan, [source], priced), /harga manual/);
  assert.throws(() => reconcile(plan, [source, source]), /tidak unik/);
});

function client({ conflict = false, roleOwner = "user" } = {}) {
  const old = structuredClone(target); old.submitted_by = roleOwner;
  const calls = [];
  return { calls, auth: { getUser: async () => ({ data: { user: { id: "user" } } }) }, from() {
    const query = { filters: [], payload: null };
    const chain = { select() { return chain; }, eq(k, v) { query.filters.push([k, v]); return chain; }, order() { return chain; },
      range: async () => ({ data: [old, source] }), update(p) { query.payload = p; return chain; },
      async maybeSingle() { if (!query.payload) return { data: old }; calls.push(query); return { data: conflict ? null : { ...old, ...query.payload } }; } };
    return chain;
  } };
}
test("saving retains RLS ownership, only updates stock arrays, and detects concurrent edits", async () => {
  const profile = { id: "user", role: "auditor" };
  const db = client(); const saved = await saveManualReconciliation(db, { profile, plan });
  assert.equal(saved.saved.length, 1);
  assert.deepEqual(Object.keys(db.calls[0].payload).sort(), ["stock_opname_kat1", "stock_opname_kat2"]);
  assert.ok(db.calls[0].filters.some(([k, v]) => k === "updated_at" && v === "original"));
  assert.equal((await saveManualReconciliation(client({ conflict: true }), { profile, plan })).failures.length, 1);
  const denied = client({ roleOwner: "other" });
  assert.equal((await saveManualReconciliation(denied, { profile, plan })).failures.length, 1);
  assert.equal(denied.calls.length, 0);
  await assert.rejects(() => saveManualReconciliation(client(), { profile: { ...profile, liatSebagai: true }, plan }), /Akun/);
});
