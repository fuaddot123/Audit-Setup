import XLSX from "xlsx";

function rupiahNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s/g, "");
  if (!/^-?[\d.,]+$/.test(cleaned)) return null;
  const parsed = Number(cleaned.replace(/[.,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function readKasKecilBalances(bytes) {
  const workbook = XLSX.read(bytes, { type: "array", cellDates: true });
  const balances = {};

  for (const tab of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[tab], {
      header: 1, raw: true, defval: null, blankrows: true,
    });
    const headerIndex = rows.findIndex((row) => row.some((cell) => String(cell || "").trim().toUpperCase() === "TANGGAL"));
    if (headerIndex < 0) continue;
    const header = rows[headerIndex].map((cell) => String(cell || "").trim().toUpperCase());
    const saldoCol = header.indexOf("SALDO");
    const debitCol = header.indexOf("DEBIT");
    const creditCol = Math.max(header.indexOf("CREDIT"), header.indexOf("KREDIT"));
    if (saldoCol < 0 || debitCol < 0 || creditCol < 0) continue;

    for (let index = headerIndex + 1; index < rows.length; index++) {
      const row = rows[index];
      const balance = rupiahNumber(row[saldoCol]);
      if (balance === null) continue;
      const debit = rupiahNumber(row[debitCol]);
      const credit = rupiahNumber(row[creditCol]);
      const hasMovement = (debit !== null && debit !== 0) || (credit !== null && credit !== 0);
      const hasDescription = row[0] != null && String(row[0]).trim() && row[1] != null && String(row[1]).trim();
      if (!hasMovement && !hasDescription) continue; // Abaikan baris kosong berisi rumus saldo.
      balances[tab.trim().toUpperCase()] = { balance, row: index + 1 };
    }
  }

  return balances;
}
