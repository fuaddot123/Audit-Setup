import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { buildStockRecap, recapDocumentNumber } from "../lib/stockOpnameRecap.js";
import { createRecapPdf, createRecapWorkbook } from "../lib/stockOpnameRecapExport.js";

const branches = [{ id: 1, name: "Semarang" }, { id: 2, name: "Yogyakarta" }, { id: 3, name: "Bandung" }];
const profiles = [{ id: "fuad", full_name: "Fuad" }, { id: "yuni", full_name: "Yuni" }];
const makeRecord = (override = {}) => ({ id: "ba-1", branch_id: 1, period: "2026-10", audit_date: "2026-10-01", created_at: "2026-10-01T10:00:00Z", submitted_by: "fuad", tidak_visit: false,
  stock_opname_kat1: [{ nama: "Laptop", status: "Lengkap" }], stock_opname_kat2: [], ...override });
const run = (records, override = {}) => buildStockRecap({ branches, profiles, records, period: "2026-10", ...override });

test("one Selisih row expands multiple goods without counting blank extra item editors", () => {
  const result = run([makeRecord({ stock_opname_kat2: [{ nama: "Aksesoris", status: "Selisih", keterangan: "Telusuri mutasi", barang: [
    { nama: "Mouse", qty: 2, harga: 50000 }, { nama: "Keyboard", qty: "", harga: 100000 }, { nama: "", qty: "", harga: "" },
  ] }] })]);
  assert.equal(result.totals.checked, 2);
  assert.equal(result.totals.differenceRows, 1);
  assert.equal(result.totals.detailCount, 2);
  assert.equal(result.totals.knownValue, 200000);
  assert.equal(result.details[1].qtyAssumed, true);
  assert.equal(result.sources[0].auditor, "Fuad");
});

test("missing values remain unknown while explicit zero and legacy detail remain valid", () => {
  const result = run([makeRecord({ stock_opname_kat1: [
    { nama: "Lama", status: "Selisih", qty: 3, harga: 125000, kategori: "Laptop" },
    { nama: "Belum dirinci", status: "Selisih", barang: [{}, {}] },
    { nama: "Nol", status: "Selisih", barang: [{ nama: "Unit", qty: 0, harga: 0 }] },
    { nama: "Galat", status: "Selisih", qty: "bukan angka", harga: 100 },
  ] })]);
  assert.equal(result.totals.detailCount, 4);
  assert.equal(result.totals.unpriced, 2);
  assert.equal(result.details[1].value, null);
  assert.equal(result.details[2].value, 0);
  assert.equal(result.totals.knownValue, 375000);
});

test("all visits and latest-per-branch are separate populations with deterministic date tie breaks", () => {
  const old = makeRecord();
  const latest = makeRecord({ id: "ba-2", audit_date: "2026-10-12", created_at: "2026-10-12T10:00:00Z", stock_opname_kat1: [{ nama: "Laptop", status: "Selisih", qty: 2, harga: 1000 }] });
  const tie = makeRecord({ id: "ba-3", audit_date: "2026-10-12", created_at: "2026-10-12T12:00:00Z" });
  assert.equal(run([old, latest, tie]).totals.auditCount, 3);
  const result = run([latest, old, tie], { mode: "latest" });
  assert.equal(result.sources[0].id, "ba-3");
  assert.equal(result.totals.differenceRows, 0);
  assert.equal(result.totals.auditCount, 1);
});

test("no-visit stale arrays and other periods/owners cannot affect totals", () => {
  const result = run([
    makeRecord(), makeRecord({ id: "other", submitted_by: "yuni" }), makeRecord({ id: "prior", period: "2026-09" }),
    makeRecord({ id: "not-visited", branch_id: 2, tidak_visit: true, stock_opname_kat1: [{ status: "Selisih", qty: 99, harga: 100000 }] }),
  ], { ownerId: "fuad" });
  assert.equal(result.totals.checked, 1);
  assert.equal(result.totals.differenceRows, 0);
  assert.equal(result.totals.auditCount, 2);
  assert.equal(result.summaries[1].status, "Tidak Visit");
  assert.equal(result.summaries[2].status, "Belum ada BA");
});

test("historical branches and unknown row statuses remain visible", () => {
  const result = run([makeRecord({ branch_id: 99, stock_opname_kat1: [{ nama: "Unit", status: "Belum dinilai" }] })]);
  assert.equal(result.summaries[3].branch, "Cabang #99");
  assert.equal(result.summaries[3].status, "Periksa status");
  assert.equal(result.totals.unclassified, 1);
});

test("monthly numbering is repeatable and distinct by month, population and auditor scope", () => {
  assert.equal(recapDocumentNumber("2026-10"), "BA-REKAP-SO/KLA/2026/10/SEMUA");
  assert.equal(recapDocumentNumber("2026-10"), recapDocumentNumber("2026-10"));
  assert.notEqual(recapDocumentNumber("2026-10"), recapDocumentNumber("2026-10", "latest"));
  assert.notEqual(recapDocumentNumber("2026-10"), recapDocumentNumber("2026-11"));
  assert.notEqual(recapDocumentNumber("2026-10", "all", "fuad"), recapDocumentNumber("2026-10", "all", "yuni"));
  assert.throws(() => recapDocumentNumber("2026-13"));
  const branchNumber = recapDocumentNumber("2026-10", "all", null, 2);
  assert.equal(branchNumber, "BA-REKAP-SO/KLA/2026/10/CB-2/SEMUA");
  assert.equal(branchNumber, recapDocumentNumber("2026-10", "all", null, "2"));
  assert.notEqual(branchNumber, recapDocumentNumber("2026-10"));
  assert.notEqual(branchNumber, recapDocumentNumber("2026-10", "all", null, 1));
  assert.throws(() => recapDocumentNumber("2026-10", "all", null, 0));
});

test("branch scope includes only the selected branch and preserves auditor isolation", () => {
  const data = [makeRecord(), makeRecord({ id: "ba-2", branch_id: 2 }), makeRecord({ id: "ba-3", branch_id: 2, submitted_by: "yuni" })];
  const branch = run(data, { branchId: 2 });
  assert.equal(branch.totals.branches, 1);
  assert.equal(branch.totals.auditCount, 2);
  assert.equal(branch.branchName, "Yogyakarta");
  assert.ok(branch.sources.every((source) => source.branch === "Yogyakarta"));
  assert.equal(run(data, { branchId: "2", ownerId: "fuad" }).totals.auditCount, 1);
  const missing = run(data, { branchId: 3 });
  assert.equal(missing.summaries.length, 1);
  assert.equal(missing.summaries[0].status, "Belum ada BA");
  assert.equal(missing.totals.auditCount, 0);
});

test("branch PDF and workbook carry branch scope and exclude other branch sources", () => {
  const data = [makeRecord({ stock_opname_kat1: [{ nama: "Semarang only", status: "Selisih", qty: 50, harga: 1000 }] }),
    makeRecord({ id: "ba-yogya", branch_id: 2, stock_opname_kat1: [{ nama: "Keyboard", status: "Selisih", qty: 2, harga: 1000 }] })];
  const recap = run(data, { branchId: 2 });
  const number = recapDocumentNumber(recap.period, recap.mode, recap.ownerId, recap.branchId);
  const workbook = createRecapWorkbook(XLSX, recap, number, "01/11/2026");
  const summary = XLSX.utils.sheet_to_json(workbook.Sheets["Ringkasan Cabang"], { header: 1 });
  assert.equal(workbook.Sheets["Ringkasan Cabang"].D6.v, "Yogyakarta");
  assert.equal(summary.at(-1)[7], 2000);
  assert.ok(!JSON.stringify(workbook).includes("Semarang"));
  const pdf = createRecapPdf(jsPDF, autoTable, recap, number, "01/11/2026");
  const text = pdf.internal.pages.flat().join("\n");
  assert.ok(text.includes(number));
  assert.ok(text.includes("Yogyakarta"));
  assert.ok(!text.includes("Semarang"));
});

test("Excel roundtrip keeps prices numeric, source IDs, missing cells and text safe from formulas", () => {
  const recap = run([makeRecord({ stock_opname_kat1: [{ nama: "Laptop", status: "Selisih", keterangan: '=HYPERLINK("https://example.com")', barang: [{ nama: "A", qty: 2, harga: 1000 }, { nama: "B", qty: 1, harga: "" }] }] })]);
  const number = recapDocumentNumber(recap.period);
  const wb = createRecapWorkbook(XLSX, recap, number, "01/11/2026");
  const reopened = XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
  assert.deepEqual(reopened.SheetNames, ["Ringkasan Cabang", "Detail Selisih", "Sumber Berita Acara"]);
  const detail = reopened.Sheets["Detail Selisih"];
  assert.equal(detail.L11.v, 2000); assert.equal(detail.L11.t, "n");
  assert.equal(detail.L12, undefined);
  assert.equal(detail.M11.t, "s"); assert.equal(detail.M11.f, undefined);
  assert.equal(detail.N11.v, "ba-1");
  assert.equal(reopened.Sheets["Sumber Berita Acara"]["!autofilter"].ref, "A10:H11");
  assert.equal(detail.D3.v, number);
  assert.equal(detail.C11.t, "n");
});

test("PDF generation paginates long notes and handles a report with no discrepancies", () => {
  const rows = Array.from({ length: 70 }, (_, i) => ({ nama: `Barang ${i}`, status: "Selisih", qty: 1, harga: 1000, keterangan: "Catatan panjang untuk menguji tabel berulang. ".repeat(8) }));
  const recap = run([makeRecord({ stock_opname_kat1: rows })]);
  const pdf = createRecapPdf(jsPDF, autoTable, recap, recapDocumentNumber(recap.period), "01/11/2026");
  assert.ok(pdf.getNumberOfPages() > 3);
  assert.ok(pdf.output().includes("BA-REKAP-SO/KLA/2026/10/SEMUA"));
  const empty = run([makeRecord()]);
  const emptyPdf = createRecapPdf(jsPDF, autoTable, empty, recapDocumentNumber(empty.period), "01/11/2026");
  assert.ok(emptyPdf.internal.pages.flat().join("\n").includes("Tidak ada selisih"));
  assert.equal(emptyPdf.getNumberOfPages(), 3);
});
