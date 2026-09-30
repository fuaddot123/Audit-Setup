import test from "node:test";
import assert from "node:assert/strict";
import XLSX from "xlsx";
import { readKasKecilBalances } from "../lib/kasKecilSheet.js";
import { sheetKeyForBranch } from "../lib/kasKecilBranch.js";

test("membaca transaksi terakhir dan mengabaikan baris rumus kosong", () => {
  const book = XLSX.utils.book_new();
  const normal = XLSX.utils.aoa_to_sheet([
    ["CABANG", "SEMARANG"],
    ["TANGGAL", "KETERANGAN", "DEBIT", "CREDIT", "SALDO"],
    ["28/9/2026", "Kas masuk", 100000, null, 100000],
    ["29/9/2026", "Pengeluaran", null, 25000, 75000],
    [null, null, null, null, 75000],
  ]);
  XLSX.utils.book_append_sheet(book, normal, "SEMARANG");
  const shifted = XLSX.utils.aoa_to_sheet([
    ["TANGGAL", "KETERANGAN", null, "DEBIT", "CREDIT", "SALDO"],
    ["29/9/2026", "Pengeluaran", null, null, 3000, -3000],
    [null, null, null, null, null, -3000],
  ]);
  XLSX.utils.book_append_sheet(book, shifted, "KEDIRI");
  const bytes = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  assert.deepEqual(readKasKecilBalances(bytes), {
    SEMARANG: { balance: 75000, row: 4 },
    KEDIRI: { balance: -3000, row: 2 },
  });
});

test("nama cabang aplikasi dipetakan ke tab spreadsheet", () => {
  assert.equal(sheetKeyForBranch("Yogyakarta"), "JOGJA");
  assert.equal(sheetKeyForBranch("Surabaya MERR"), "SURABAYA");
  assert.equal(sheetKeyForBranch("Surabaya Babatan"), "BABATAN");
  assert.equal(sheetKeyForBranch(" Semarang "), "SEMARANG");
});
