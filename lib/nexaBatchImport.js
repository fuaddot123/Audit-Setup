import { readNexaTable, makeNexaRows, warehouseMatchesBranch } from "./nexaOpnameImport.js";
import { valueNexaRow } from "./persediaanValuation.js";
import { canImportNexa } from "./nexaRecapSave.js";

const key = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
export function readCompleteNexa(rows) {
  const headerIndex = rows.findIndex((r) => r.map(key).includes("statusnexa") && r.map(key).includes("kodebarang"));
  if (headerIndex < 0) throw new Error("Impor gabungan memerlukan kolom Status Nexa, Tanggal, dan Gudang dari sumber Nexa.");
  const headers = rows[headerIndex].map(key), statusIndex = headers.indexOf("statusnexa");
  const codeIndex = headers.findIndex((h) => ["kodestokopname", "nostokopname"].includes(h));
  if (codeIndex < 0) throw new Error("Kolom nomor opname tidak ditemukan.");
  const statuses = new Map(), excluded = new Set();
  const selected = rows.slice(headerIndex + 1).filter((r) => {
    const code = String(r[codeIndex] ?? "").trim();
    if (!code) return false;
    const status = String(r[statusIndex] ?? "").trim().toUpperCase();
    if (statuses.has(code) && statuses.get(code) !== status) throw new Error(`Status ${code} tidak konsisten.`);
    statuses.set(code, status);
    if (!["COMPLETE", "COMPLETE MATCH", "COMPLETE UNMATCH"].includes(status)) { excluded.add(code); return false; }
    return true;
  });
  if (!selected.length) throw new Error("Belum ada opname COMPLETE untuk diimpor.");
  const groups = readNexaTable([rows[headerIndex], ...selected]).map((g) => ({ ...g, sourceStatus: statuses.get(g.code) }));
  return { groups, excluded: excluded.size };
}

export function planNexaBatch({ groups, branches, records, report, profile, period, ids, fileName, fileSha256, importedAt }) {
  if (!canImportNexa(profile)) throw new Error("Akun ini tidak dapat mengimpor data.");
  if (!report || report.period !== period) throw new Error("Muat Report Persediaan dengan bulan yang sama terlebih dahulu.");
  const [year, month] = period.split("-").map(Number);
  const auditDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const existing = new Map();
  for (const record of records.filter((r) => r.period === period)) for (const row of [record.stock_opname_kat1, record.stock_opname_kat2].flatMap((r) => Array.isArray(r) ? r : [])) {
    if (row.nexa) existing.set(row.nexa.code, record.branch_id);
  }
  const grouped = new Map(), seen = new Set(); let skipped = 0;
  for (const g of groups) {
    if (!["COMPLETE", "COMPLETE MATCH", "COMPLETE UNMATCH"].includes(g.sourceStatus)) throw new Error(`${g.code} belum COMPLETE.`);
    if (seen.has(g.code)) throw new Error(`${g.code} ganda pada sumber.`);
    seen.add(g.code);
    const matches = branches.filter((b) => warehouseMatchesBranch(g.warehouse, b.name));
    if (matches.length !== 1) throw new Error(`${g.code}: gudang belum cocok dengan satu cabang (${g.warehouse}).`);
    const branch = matches[0];
    if (g.date.slice(0, 7) !== period || g.date > auditDate) throw new Error(`${g.code}: periode sumber berbeda.`);
    if (existing.has(g.code)) {
      if (existing.get(g.code) !== branch.id) throw new Error(`${g.code} sudah tercatat di cabang lain. Periksa BA sumber.`);
      skipped++; continue;
    }
    if (!ids[branch.id]) throw new Error("Identitas impor belum siap. Pilih ulang sumber.");
    if (!grouped.has(branch.id)) grouped.set(branch.id, { branch, groups: [] });
    grouped.get(branch.id).groups.push(g);
  }
  const entries = [...grouped.values()].map(({ branch, groups: selected }) => ({ branch, auditDate, newId: ids[branch.id],
    kat1: makeNexaRows(selected, { branch, period, auditDate, fileName, fileSha256, importedAt }).map((row) => valueNexaRow(row, report)), kat2: [] }));
  return { entries, skipped, opnames: entries.reduce((s, e) => s + e.kat1.length, 0), items: entries.reduce((s, e) => s + e.kat1.reduce((n, r) => n + r.nexa.items.length, 0), 0) };
}
