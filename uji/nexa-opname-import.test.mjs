import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { readNexaTable, makeNexaRows, nexaNumber, warehouseMatchesBranch, nexaAppendixHtml } from "../lib/nexaOpnameImport.js";
import { buildStockRecap } from "../lib/stockOpnameRecap.js";
import { createRecapWorkbook, createRecapPdf } from "../lib/stockOpnameRecapExport.js";

// Same columns as Nexa's detail export, with deliberately fictional test goods.
const headers = ["No", "Kode Barang", "Nama Barang", "Jumlah Sistem", "Jumlah Opname", "Selisih", "Serial", "Keterangan", "Action"];
const table = [["Data Detail Stok Opname SOH/00001/202610"], [], headers,
  [1, "TEST-A", "Barang cocok", 4, 4, 0, "", "-", "Serial"],
  [2, "TEST-B", "Barang kurang", 3, 1, -2, "TEST-SN", "Periksa mutasi", "Serial"],
  [3, "TEST-C", "Barang lebih", 0, 1, 1, "", "", "Serial"]];
const context = { date: "2026-10-31", warehouse: "Ruko SMG,Ruko SMG Display,Ruko SMG Service" };
const options = { branch: { id: 1, name: "Semarang" }, period: "2026-10", auditDate: "2026-10-31", fileName: "test-nexa.xlsx", fileSha256: "test-sha", importedAt: "2026-11-01T00:00:00Z" };
const groups = () => readNexaTable(table, context);
const imported = () => makeNexaRows(groups(), options);

test("preserves every source item, signed delta, serial, and unknown valuation", () => {
  const rows = imported();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "Selisih");
  assert.equal(rows[0].nexa.items.length, 3);
  assert.deepEqual(rows[0].nexa.items.map((i) => i.difference), [0, -2, 1]);
  assert.equal(rows[0].nexa.items[1].serial, "TEST-SN");
  assert.deepEqual(rows[0].nexa.manualMetadata, ["Tanggal opname", "Gudang"]);
  assert.deepEqual(rows[0].barang.map((i) => i.qty), [-2, 1]);
  assert.ok(rows[0].barang.every((i) => i.harga === ""));
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), rows);
});

test("missing and invalid counts never become zero, including inconsistent source delta", () => {
  for (const value of [null, "", "-", "salah", Infinity]) {
    const copy = structuredClone(table); copy[3][3] = value;
    assert.throws(() => readNexaTable(copy, context), /tidak valid|kosong/);
  }
  const wrong = structuredClone(table); wrong[4][5] = 2;
  assert.throws(() => readNexaTable(wrong, context), /selisih Excel/);
  const negative = structuredClone(table); negative[3][4] = -1;
  assert.throws(() => readNexaTable(negative, context), /tidak valid/);
  assert.equal(nexaNumber(0), 0);
  assert.equal(nexaNumber("1.234,5"), 1234.5);
  assert.equal(nexaNumber("1,5"), 1.5);
});

test("rejects header-only exports, missing metadata, invalid dates, duplicate SKUs and duplicate columns", () => {
  assert.throws(() => readNexaTable([["Kode Stok Opname", "Gudang", "Tanggal"]], context), /rincian barang/);
  assert.throws(() => readNexaTable(table), /wajib diisi/);
  assert.throws(() => readNexaTable(table, { ...context, date: "2026-13-01" }), /wajib diisi/);
  assert.throws(() => readNexaTable(table, { ...context, date: "2026-11-01" }), /tidak sesuai bulan/);
  assert.throws(() => readNexaTable(table, { ...context, code: "SOH/00002/202610" }), /judul sumber/);
  assert.throws(() => readNexaTable([...table, table[3]], context), /lebih dari sekali/);
  const duplicate = structuredClone(table); duplicate[2].push("Jumlah Sistem");
  assert.throws(() => readNexaTable(duplicate, context), /ganda/);
});

test("monthly tables group by source number with merged metadata; only selected branch is importable", () => {
  const multi = [["Kode Stok Opname", "Tanggal", "Gudang", ...headers],
    ["SOH/00001/202610", "31/10/2026", "Ruko SMG", ...table[3]],
    [null, null, null, ...table[4]],
    ["SOH/00002/202610", "2026-10-31", "Tegal", ...table[3]]];
  const result = readNexaTable(multi);
  assert.equal(result.length, 2);
  assert.equal(result[0].items.length, 2);
  assert.deepEqual(result[0].manualMetadata, []);
  assert.throws(() => makeNexaRows(result, options), /tidak sesuai cabang/);
  assert.equal(makeNexaRows(result.slice(0, 1), options).length, 1);
  assert.equal(warehouseMatchesBranch("Surabaya,Surabaya Display,Surabaya Service", "Surabaya MERR"), true);
  assert.equal(warehouseMatchesBranch("Surabaya Babatan", "Surabaya MERR"), false);
  assert.equal(warehouseMatchesBranch("Sagan YK,Sagan YK Display", "Yogyakarta"), true);
  assert.equal(warehouseMatchesBranch("Gudang Sementara Tegal,Tegal,Tegal Service", "Tegal"), true);
  assert.equal(warehouseMatchesBranch("Service Slawi,Slawi,Slawi Display", "Slawi"), true);
  assert.equal(warehouseMatchesBranch("Service Slawi,Slawi,Slawi Display", "Tegal"), false);
});

test("a reused Nexa code keeps distinct product names and counts as separate source items", () => {
  const reused = structuredClone(table);
  reused.push([4, "TEST-B", "Produk berbeda dengan kode sama", 6, 0, -6, "", "-", "Serial"]);
  const result = readNexaTable(reused, context);
  assert.equal(result[0].items.length, 4);
  const row = makeNexaRows(result, options)[0];
  assert.deepEqual(row.barang.map((b) => b.qty), [-2, 1, -6]);
  assert.equal(row.barang[2].nexaItemName, "Produk berbeda dengan kode sama");
});

test("blocks wrong month, future source date, and repeat import in either BA category", () => {
  assert.throws(() => makeNexaRows(groups(), { ...options, period: "2026-09" }), /periode/);
  assert.throws(() => makeNexaRows(groups(), { ...options, auditDate: "2026-10-30" }), /tanggal audit/);
  assert.throws(() => makeNexaRows(groups(), { ...options, existingRows: imported() }), /sudah ada/);
});

test("actual combined-export layout requires a selected source number when date and warehouse are absent", () => {
  const combined = [["Stok Opname 2026-10-01 s.d. 2026-10-31"],
    ["No.", "No. Stok Opname", "Kode Barang", "Nama Barang", "Jumlah Sistem", "Jumlah Opname", "Selisih", "Serial Number", "Keterangan"],
    [1, "SOH/00001/202610", "TEST-A", "Test A", 2, 1, -1, "TEST-SN", "-"],
    [2, "SOH/00002/202610", "TEST-B", "Test B", 3, 3, 0, "", "-"]];
  assert.throws(() => readNexaTable(combined, context), /Pilih satu nomor/);
  assert.throws(() => readNexaTable(combined, { ...context, code: "SOH/00003/202610" }), /tidak ditemukan/);
  const selected = readNexaTable(combined, { ...context, code: "SOH/00001/202610" });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].items.length, 1);
  assert.equal(selected[0].items[0].difference, -1);
});

test("source snapshots appear in recap PDF/Excel and escaped BA appendix; manual exports remain unchanged", () => {
  const row = imported()[0]; row.nexa.items[0].name = '<script>alert("test")</script>';
  const record = { id: "test-ba", branch_id: 1, period: "2026-10", audit_date: "2026-10-31", stock_opname_kat1: [row] };
  const recap = buildStockRecap({ branches: [options.branch], records: [record], period: "2026-10" });
  assert.equal(recap.nexaItems.length, 3);
  assert.equal(recap.totals.checked, 1);
  assert.equal(recap.totals.unpriced, 2);
  const book = createRecapWorkbook(XLSX, recap, "test-number", "test-date");
  const roundtrip = XLSX.read(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
  const matrix = XLSX.utils.sheet_to_json(roundtrip.Sheets["Rincian Nexa"], { header: 1 });
  assert.equal(matrix[11][10], -2);
  assert.equal(matrix[11][2], "BA-SO/KLA/test-ba");
  const pdf = createRecapPdf(jsPDF, autoTable, recap, "test-number", "test-date");
  assert.ok(pdf.getNumberOfPages() >= 4);
  const esc = (v) => String(v ?? "").replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const html = nexaAppendixHtml([row], record.id, esc);
  assert.ok(html.includes("BA-SO/KLA/test-ba"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.equal(nexaAppendixHtml([{ nama: "Lama", status: "Lengkap" }], record.id, esc), "");
});
