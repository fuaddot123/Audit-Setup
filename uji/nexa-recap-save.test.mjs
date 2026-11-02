import test from "node:test";
import assert from "node:assert/strict";
import { saveNexaRecap, canImportNexa } from "../lib/nexaRecapSave.js";

const profile = { id: "auditor-1", role: "auditor" };
const branch = { id: 1, name: "Semarang" };
const imported = { nama: "Nexa SOH/00001/202610 (jumlah)", status: "Selisih", keterangan: "Telusuri mutasi", barang: [{ nama: "Test", qty: 1, harga: "" }],
  nexa: { version: 1, code: "SOH/00001/202610", branchId: 1, warehouse: "Ruko SMG", date: "2026-10-10", items: [{ sku: "TEST", systemQty: 2, countedQty: 1, difference: -1 }] } };
const options = (extra = {}) => ({ profile, branch, period: "2026-10", auditDate: "2026-10-20", targetId: "ba-1", kat1: [structuredClone(imported)], kat2: [], ...extra });
const record = () => ({ id: "ba-1", branch_id: 1, period: "2026-10", audit_date: "2026-10-20", submitted_by: "auditor-1", tidak_visit: false,
  updated_at: "2026-10-20T12:00:00.123456+00:00", kegiatan: "Audit lengkap", stock_opname_kat1: [{ nama: "Checklist lama", status: "Lengkap" }], stock_opname_kat2: [{ nama: "Manual 2", status: "Lengkap" }] });

function fakeClient(initial, { userId = profile.id, conflict = false, writeError = null } = {}) {
  let stored = initial && structuredClone(initial);
  const calls = [];
  return { calls, get stored() { return stored; }, auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    from(table) {
      assert.equal(table, "berita_acara");
      const query = { method: "read", filters: [], payload: null };
      const chain = {
        select() { return chain; }, eq(k, v) { query.filters.push([k, v]); return chain; },
        update(payload) { query.method = "update"; query.payload = payload; return chain; },
        insert(payload) { query.method = "insert"; query.payload = payload; return chain; },
        async maybeSingle() { return execute(); }, async single() { return execute(); },
      };
      function execute() {
        calls.push(structuredClone(query));
        if (query.method === "read") return { data: stored && query.filters.every(([k, v]) => stored[k] === v) ? structuredClone(stored) : null, error: null };
        if (writeError) return { data: null, error: writeError };
        if (query.method === "update" && (conflict || !query.filters.every(([k, v]) => stored[k] === v))) return { data: null, error: null };
        stored = query.method === "insert" ? { ...query.payload, updated_at: "created", created_at: "2026-10-20T00:00:00Z" } : { ...stored, ...query.payload };
        return { data: structuredClone(stored), error: null };
      }
      return chain;
    },
  };
}

test("append reads current arrays, retains unrelated fields/owner, and checks the exact timestamp", async () => {
  const db = fakeClient(record());
  const saved = await saveNexaRecap(db, options());
  assert.equal(saved.stock_opname_kat1.length, 2);
  assert.equal(saved.stock_opname_kat1[0].nama, "Checklist lama");
  assert.equal(saved.stock_opname_kat2[0].nama, "Manual 2");
  assert.equal(saved.submitted_by, profile.id);
  assert.equal(saved.kegiatan, "Audit lengkap");
  const write = db.calls.find((c) => c.method === "update");
  assert.deepEqual(Object.keys(write.payload).sort(), ["stock_opname_kat1", "stock_opname_kat2"]);
  assert.ok(write.filters.some(([k, v]) => k === "updated_at" && v === record().updated_at));
});

test("a concurrent edit is reported rather than overwriting it", async () => {
  const db = fakeClient(record(), { conflict: true });
  await assert.rejects(() => saveNexaRecap(db, options()), /berubah saat impor/);
  assert.equal(db.stored.stock_opname_kat1.length, 1);
});

test("new stock-only BA uses a stable ID; retry after lost acknowledgement does not duplicate it", async () => {
  const db = fakeClient(null);
  const input = options({ targetId: null, newId: "new-ba" });
  const first = await saveNexaRecap(db, input);
  const again = await saveNexaRecap(db, structuredClone(input));
  assert.equal(first.id, "new-ba"); assert.equal(again.id, "new-ba");
  assert.equal(db.calls.filter((c) => c.method === "insert").length, 1);
  assert.equal(first.submitted_by, profile.id);
  assert.equal(first.kegiatan, "Stock Opname Nexa");
  await assert.rejects(() => saveNexaRecap(db, options({ targetId: null, newId: "new-ba", kat1: [{ ...imported, keterangan: "Changed after save" }] })), /sudah tersimpan/);
});

test("read-only roles, view-as mode, changed sessions, and another auditor's BA cannot write", async () => {
  assert.equal(canImportNexa({ role: "ceo" }), false);
  for (const p of [{ id: profile.id, role: "ceo" }, { ...profile, liatSebagai: {} }]) {
    const db = fakeClient(record());
    await assert.rejects(() => saveNexaRecap(db, options({ profile: p })), /tidak dapat/);
    assert.equal(db.calls.length, 0);
  }
  await assert.rejects(() => saveNexaRecap(fakeClient(record(), { userId: "another-session" }), options()), /Sesi berubah/);
  await assert.rejects(() => saveNexaRecap(fakeClient({ ...record(), submitted_by: "other" }), options()), /hak akses/);
  const admin = { ...profile, role: "super_admin" };
  const saved = await saveNexaRecap(fakeClient({ ...record(), submitted_by: "other" }), options({ profile: admin }));
  assert.equal(saved.submitted_by, "other");
});

test("duplicates in either category, no-visit, stale dates, and mismatched scopes are rejected", async () => {
  await assert.rejects(() => saveNexaRecap(fakeClient({ ...record(), stock_opname_kat2: [imported] }), options()), /sudah ada/);
  for (const change of [{ tidak_visit: true }, { branch_id: 2 }, { period: "2026-09" }, { updated_at: null }, { audit_date: "2026-10-19" }]) {
    const db = fakeClient({ ...record(), ...change });
    await assert.rejects(() => saveNexaRecap(db, options()));
    assert.ok(db.calls.every((c) => c.method === "read"));
  }
  for (const auditDate of ["2026-09-30", "2026-10-05", "2026-02-31"]) await assert.rejects(() => saveNexaRecap(fakeClient(record()), options({ auditDate })));
  await assert.rejects(() => saveNexaRecap(fakeClient(null), options()), /tidak ditemukan/);
  await assert.rejects(() => saveNexaRecap(fakeClient(record()), options({ kat1: [imported], kat2: [imported] })), /dua kali/);
});

test("write failures are surfaced and never reported as saved", async () => {
  const failure = new Error("RLS denied");
  await assert.rejects(() => saveNexaRecap(fakeClient(record(), { writeError: failure }), options()), /RLS denied/);
});
