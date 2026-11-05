import { periodLabel, recapModeLabel, rupiah, stockDetailName, stockDetailNameNote, stockValueInfo, stockValueLabel } from "./stockOpnameRecap.js";
import { valuationLabels } from "./persediaanValuation.js";

export const recapPolicy = "Harga Nexa = Sisa Nilai / Sisa Qty pada Report Persediaan bulan yang sama. Nilai selisih = harga satuan x (fisik - admin); kurang negatif, lebih positif. Qty report nol/kode tidak ditemukan belum bernilai. Baris manual mengikuti catatan BA. Setiap nomor opname dihitung tersendiri, termasuk pemeriksaan berulang. Nilai gabungan bukan saldo stok akhir atau nominal adjust final. Mode terakhir memilih satu BA per cabang.";
const scopeLabel = (recap) => recap.branchId != null ? `${recap.branchName}${recap.ownerId ? " - Data auditor sendiri" : ""}`
  : recap.ownerId ? "Data auditor sendiri" : "Gabungan semua cabang";
const recapTitle = (recap) => recap.branchId == null ? "REKAP STOCK OPNAME" : `REKAP STOCK OPNAME - ${recap.branchName}`;
const shortDate = (date) => date ? date.split("-").reverse().join("/") : "Belum diisi";
const excelDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? new Date(`${date}T00:00:00`) : "";

export function createRecapWorkbook(XLSX, recap, number, printedAt) {
  const workbook = XLSX.utils.book_new();
  const metadata = [
    ["PT. KLA Teknologi Indonesia"], [recapTitle(recap)], ["Nomor Berita Acara Rekap", number],
    ["Periode", periodLabel(recap.period)], ["Sumber audit", recapModeLabel(recap.mode)],
    ["Cakupan", scopeLabel(recap)], ["Dicetak", printedAt],
    ["Perhitungan", "Nexa: Sisa Nilai / Sisa Qty x (fisik - admin). Manual: jumlah x harga BA; jumlah kosong dengan harga terisi = asumsi 1. Nama tanpa rincian barang memakai nama baris BA. Nilai belum tersedia tidak dianggap nol."], [],
  ];
  const addSheet = (name, headers, rows, widths, moneyColumns = [], hasTotal = false, dateColumns = []) => {
    const top = metadata.map((row, index) => index >= 2 && index <= 7 ? [row[0], null, null, row[1]] : row);
    const sheet = XLSX.utils.aoa_to_sheet([...top, headers, ...rows], { dateNF: "dd/mm/yyyy" });
    sheet["!cols"] = widths.map((wch) => ({ wch }));
    sheet["!merges"] = [0, 1].map((r) => ({ s: { r, c: 0 }, e: { r, c: headers.length - 1 } }));
    for (let r = 2; r <= 7; r += 1) sheet["!merges"].push({ s: { r, c: 0 }, e: { r, c: 2 } }, { s: { r, c: 3 }, e: { r, c: headers.length - 1 } });
    const lastRow = metadata.length + rows.length;
    sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ r: metadata.length, c: 0 }, { r: Math.max(metadata.length, lastRow - (hasTotal ? 1 : 0)), c: headers.length - 1 }) };
    for (let r = metadata.length + 1; r <= lastRow; r += 1) {
      for (const column of moneyColumns) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c: column })];
        if (cell?.t === "n") cell.z = '"Rp" #,##0.00;[Red]("Rp" #,##0.00)';
      }
      for (const column of dateColumns) {
        const dateCell = sheet[XLSX.utils.encode_cell({ r, c: column })];
        if (dateCell?.t === "n") dateCell.z = "dd/mm/yyyy";
      }
    }
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  };
  const t = recap.totals;
  addSheet("Ringkasan Cabang", ["No", "Cabang", "Jumlah BA", "Baris diperiksa", "Lengkap", "Baris selisih", "Rincian selisih", "Nilai terisi", "Nilai belum terisi", "Status", "Audit terakhir", "Status belum dikenal", "Status nilai"],
    [...recap.summaries.map((row, i) => [i + 1, row.branch, row.auditCount, row.checked, row.complete, row.differenceRows, row.detailCount, stockValueInfo(row).value, row.unpriced, row.status, excelDate(row.lastAudit), row.unclassified, stockValueInfo(row).status]),
      ["", "TOTAL", t.auditCount, t.checked, t.complete, t.differenceRows, t.detailCount, stockValueInfo(t).value, t.unpriced, "", "", t.unclassified, stockValueInfo(t).status]],
    [6, 25, 14, 18, 12, 17, 18, 23, 20, 20, 18, 24, 28], [7], true, [10]);
  addSheet("Detail Selisih", ["No", "Cabang", "Tanggal audit", "Auditor", "Kelompok", "Baris pemeriksaan", "Nama barang / Acuan BA", "Kategori barang", "Jumlah", "Jumlah asumsi 1", "Harga satuan", "Nilai selisih", "Keterangan", "ID BA sumber", "Sumber identitas"],
    [...recap.details.map((row, i) => [i + 1, row.branch, excelDate(row.auditDate), row.auditor, row.group, row.item, stockDetailName(row), row.category, row.qty, row.qtyAssumed ? "Ya" : "Tidak", row.price, row.value, row.note, row.auditId, stockDetailNameNote(row) || "Rincian barang BA"]),
      ["", "TOTAL NILAI TERISI", "", "", "", "", "", "", "", "", "", stockValueInfo(t).value, `${stockValueInfo(t).status}; ${t.unpriced} rincian belum bernilai`, "", ""]],
    [6, 25, 18, 26, 17, 32, 42, 24, 12, 18, 23, 23, 60, 40, 55], [10, 11], true, [2]);
  addSheet("Sumber Berita Acara", ["No", "Cabang", "Tanggal audit", "Auditor", "Status", "Baris diperiksa", "Baris selisih", "ID BA sumber"],
    recap.sources.map((row, i) => [i + 1, row.branch, excelDate(row.auditDate), row.auditor, row.status, row.checked, row.differenceRows, row.id]),
    [6, 25, 18, 26, 22, 18, 17, 40], [], false, [2]);
  if (recap.nexaItems?.length) addSheet("Rincian Nexa", ["No", "Cabang", "Referensi BA", "Nomor opname Nexa", "Tanggal opname", "Gudang sumber", "Kode barang", "Nama barang", "Stok admin", "Stok fisik", "Qty selisih fisik - admin", "Serial", "Keterangan Nexa", "Catatan BA", "File sumber", "SHA-256 file", "Waktu impor", "Metadata diisi saat impor", "Harga per unit", "Sisa Qty persediaan", "Sisa Nilai persediaan", "Nilai selisih", "Periode report", "Dasar harga", "Status nilai", "File Report Persediaan", "SHA-256 Report Persediaan"],
    recap.nexaItems.map((r, i) => [i + 1, r.branch, r.baReference, r.code, excelDate(r.date), r.warehouse, r.sku, r.name, r.systemQty, r.countedQty, r.difference, r.serial, r.note, r.auditNote, r.fileName, r.fileSha256, r.importedAt, r.manualMetadata.join(", "), r.unitCost, r.valuation?.reportQty ?? null, r.valuation?.reportAmount ?? null, r.signedValue, r.valuation?.period || "", r.valuation?.basis || "", valuationLabels[r.status], r.valuation?.fileName || "", r.valuation?.fileSha256 || ""]),
    [6, 25, 55, 25, 18, 50, 40, 60, 16, 16, 23, 35, 50, 50, 40, 68, 28, 45, 22, 22, 25, 25, 18, 30, 30, 45, 68], [18, 20, 21], false, [4]);
  workbook.Props = { Title: `${recapTitle(recap)} ${periodLabel(recap.period)}`, Subject: number, Company: "PT. KLA Teknologi Indonesia" };
  return workbook;
}

// Built-in PDF fonts use WinAnsi. Preserve Indonesian/Latin text and normalize
// punctuation; the Excel export retains the original Unicode strings in full.
const pdfText = (value) => String(value ?? "").replace(/[\u2010-\u2015]/g, "-")
  .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
  .replace(/[^\x20-\x7e\xa0-\xff\n]/g, " ");

export function createRecapPdf(jsPDF, autoTable, recap, number, printedAt) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  doc.setProperties({ title: `${recapTitle(recap)} ${periodLabel(recap.period)}`, subject: number, author: "PT. KLA Teknologi Indonesia" });
  const total = recap.totals;
  const table = (headers, rows, options = {}) => autoTable(doc, {
    head: [headers], body: rows.map((row) => row.map((cell) => cell && typeof cell === "object" ? { ...cell, content: pdfText(cell.content) } : pdfText(cell))), startY: 46,
    margin: { top: 42, bottom: 18, left: 12, right: 12 },
    styles: { font: "helvetica", fontSize: 8, cellPadding: 2.1, overflow: "linebreak", textColor: [40, 31, 56], lineWidth: 0.1, lineColor: [226, 220, 236] },
    headStyles: { fillColor: [42, 31, 82], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [247, 245, 250] },
    footStyles: { fillColor: [232, 226, 242], textColor: [42, 31, 82], fontStyle: "bold" },
    rowPageBreak: "avoid", showFoot: "lastPage", ...options,
  });
  const section = (title, note) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(42, 31, 82); doc.text(title, 12, 36);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(100); doc.text(pdfText(note), 12, 41);
  };
  if (recap.nexaItems?.length) {
    section("Ringkasan Stock Opname Nexa", "Nilai per nomor pemeriksaan, termasuk hitung berulang; bukan saldo akhir stok atau nominal adjust final.");
    const summary = recap.summaries.map((s) => {
      const items = recap.nexaItems.filter((i) => i.branch === s.branch), differences = items.filter((i) => i.difference !== 0);
      const value = { auditCount: new Set(items.map((i) => `${i.auditId}/${i.code}`)).size, checked: items.length, detailCount: differences.length,
        knownValue: differences.reduce((n, i) => n + (i.signedValue ?? 0), 0), unpriced: differences.filter((i) => i.signedValue == null).length };
      return [s.branch, value.auditCount, value.checked, value.detailCount, stockValueLabel(value), value.unpriced];
    });
    table(["Cabang", "Nomor opname", "Baris barang", "Baris selisih", "Nilai terhitung Nexa", "Belum bernilai"], summary,
      { foot: [["TOTAL", summary.reduce((n, r) => n + r[1], 0), recap.nexaItems.length, recap.nexaItems.filter((i) => i.difference !== 0).length,
        total.nexaUnpriced && !total.nexaValued ? "Belum dihitung" : `${rupiah(total.nexaNetValue)}${total.nexaUnpriced ? " (sebagian)" : ""}`, total.nexaUnpriced]] });
    doc.addPage();
  }
  section("Ringkasan per Cabang", `${total.auditedBranches}/${total.branches} cabang memiliki item diperiksa | ${total.auditCount} BA | ${total.differenceRows} baris selisih | ${total.unpriced} rincian belum bernilai`);
  table(["No", "Cabang", "BA", "Diperiksa", "Lengkap", "Baris selisih", "Rincian selisih", "Nilai terisi", "Belum bernilai", "Status", "Audit terakhir"],
    recap.summaries.map((row, i) => [i + 1, row.branch, row.auditCount, row.checked, row.complete, row.differenceRows, row.detailCount, stockValueLabel(row), row.unpriced, row.status, shortDate(row.lastAudit)]),
    { foot: [["", "TOTAL", total.auditCount, total.checked, total.complete, total.differenceRows, total.detailCount, stockValueLabel(total), total.unpriced, "", ""]] });
  doc.addPage();
  const manualDetails = recap.details.filter((row) => !row.isNexa);
  section("Catatan Selisih Audit Manual", `${manualDetails.length} rincian manual | Rincian dan nilai dari Nexa ditampilkan terpisah pada lampiran Nexa.`);
  table(["No", "Cabang / Tanggal", "Kelompok", "Baris pemeriksaan", "Barang / Acuan BA", "Jumlah", "Harga", "Nilai", "Keterangan"],
    manualDetails.length ? manualDetails.map((row, i) => [i + 1, `${row.branch}\n${shortDate(row.auditDate)}`, row.group, row.item,
      [stockDetailName(row), row.category, stockDetailNameNote(row)].filter(Boolean).join("\n"), row.qty == null ? "Tidak tercatat / tidak valid" : `${row.qty}${row.qtyAssumed ? " (asumsi)" : ""}`,
      rupiah(row.price), rupiah(row.value), row.note || "-"])
      : [[{ content: "Tidak ada selisih pada data yang dipilih.", colSpan: 9 }]],
    { columnStyles: { 0: { cellWidth: 8 }, 1: { cellWidth: 25 }, 2: { cellWidth: 22 }, 3: { cellWidth: 34 }, 4: { cellWidth: 40 }, 5: { cellWidth: 17 }, 6: { cellWidth: 25 }, 7: { cellWidth: 26 }, 8: { cellWidth: 76 } } });
  doc.addPage();
  section("Sumber Berita Acara", "ID sumber memungkinkan setiap rincian ditelusuri kembali ke berita acara audit.");
  doc.setFontSize(8); doc.setTextColor(100);
  const policyLines = doc.splitTextToSize(pdfText(recapPolicy), 273);
  doc.text(policyLines, 12, 47);
  table(["No", "Cabang", "Tanggal audit", "Auditor", "Status", "Diperiksa", "Baris selisih", "ID BA sumber"],
    recap.sources.map((row, i) => [i + 1, row.branch, shortDate(row.auditDate), row.auditor, row.status, row.checked, row.differenceRows, row.id]),
    { startY: 49 + policyLines.length * 4 });
  if (recap.nexaItems?.length) {
    doc.addPage();
    const differences = recap.nexaItems.filter((r) => r.difference !== 0);
    section("Rincian Selisih Nexa - Acuan Pemeriksaan", `${differences.length} baris selisih ditampilkan; ${recap.nexaItems.length - differences.length} baris cocok tidak dirinci. Seluruh barang tetap tersedia di aplikasi/Excel.`);
    table(["Cabang / Opname", "Kode / Barang", "Admin", "Fisik", "Selisih", "Harga / unit", "Nilai selisih", "Dasar persediaan", "Serial / Catatan"],
      differences.length ? differences.map((r) => [`${r.branch}\n${r.code}\n${shortDate(r.date)}\n${r.baReference}`, `${r.sku}\n${r.name}`, r.systemQty, r.countedQty, r.difference, rupiah(r.unitCost), rupiah(r.signedValue),
        r.valuation ? `${valuationLabels[r.status]}\n${rupiah(r.valuation.reportAmount)} / ${r.valuation.reportQty ?? "-"}\n${r.valuation.period}\n${r.valuation.fileName}` : valuationLabels[r.status],
        [r.serial, r.note, r.auditNote, r.manualMetadata.length ? `Diisi saat impor: ${r.manualMetadata.join(", ")}` : ""].filter(Boolean).join("\n")]) : [[{ content: "Tidak ada selisih pada sumber Nexa yang dipilih.", colSpan: 9 }]],
      { columnStyles: { 0: { cellWidth: 36 }, 1: { cellWidth: 48 }, 2: { cellWidth: 13 }, 3: { cellWidth: 13 }, 4: { cellWidth: 14 }, 5: { cellWidth: 25 }, 6: { cellWidth: 27 }, 7: { cellWidth: 47 }, 8: { cellWidth: 50 } } });
  }
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFillColor(42, 31, 82); doc.rect(0, 0, 297, 27, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.text(pdfText(recapTitle(recap)), 12, 10);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text(pdfText(`${periodLabel(recap.period)} | ${recapModeLabel(recap.mode)} | ${scopeLabel(recap)}`), 12, 16);
    doc.setFontSize(7); doc.text(pdfText(`Nomor BA: ${number}`), 12, 22);
    doc.setTextColor(115); doc.setFontSize(7);
    doc.text(pdfText(`PT. KLA Teknologi Indonesia | Dicetak ${printedAt}`), 12, 201);
    doc.text(`${page} / ${pageCount}`, 285, 201, { align: "right" });
  }
  return doc;
}
