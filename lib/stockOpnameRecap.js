import { nexaBaReference } from "./nexaOpnameImport.js";
import { normalizeNexaQuantities, sourceItemValue, sourceGoodsItem } from "./persediaanValuation.js";
import { nexaCategory, discrepancyCategory } from "./nexaCategories.js";

export const ISOLATION_START_PERIOD = "2026-08";
export const recapModeLabel = (mode) => mode === "latest" ? "Audit terakhir per cabang" : "Semua berita acara";
export const rupiah = (value) => value == null ? "Belum diisi" : `Rp${(value === 0 ? 0 : value).toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;
export const stockDetailName = (row) => row.missingItem || row.item || "Identitas tidak tercatat di BA";
export const stockDetailNameNote = (row) => row.nameSource === "row" ? "Acuan: nama baris BA; rincian lihat keterangan."
  : row.nameSource === "missing" ? "Perlu dilengkapi pada BA sumber." : "";
export function stockValueInfo(row) {
  if (!row.auditCount) return { value: null, status: "Belum ada BA" };
  if (!row.checked) return { value: null, status: "Belum ada item diperiksa" };
  if (!row.detailCount && row.unclassified) return { value: null, status: "Status belum dinilai" };
  if (row.unpriced && row.unpriced === row.detailCount) return { value: null, status: "Belum dihitung" };
  return { value: row.knownValue, status: row.unpriced || row.unclassified ? "Sebagian" : "Lengkap" };
}
export function stockValueLabel(row) {
  const { value, status } = stockValueInfo(row);
  return value == null ? status : `${rupiah(value)}${status === "Sebagian" ? " (sebagian)" : ""}`;
}
export const periodLabel = (period) => {
  const [year, month] = period.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
};

// One monthly recap number per period, source mode and access scope. It is
// deterministic across browsers and repeated exports; no local counter races.
export function recapDocumentNumber(period, mode = "all", ownerId = null, branchId = null) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("Periode tidak valid.");
  if (!["all", "latest"].includes(mode)) throw new Error("Cakupan rekap tidak valid.");
  if (branchId != null && (!/^[1-9]\d*$/.test(String(branchId)) || !Number.isSafeInteger(Number(branchId)))) throw new Error("Cabang tidak valid.");
  const [year, month] = period.split("-");
  return `BA-REKAP-SO/KLA/${year}/${month}/${branchId == null ? "" : `CB-${Number(branchId)}/`}${mode === "latest" ? "TERAKHIR" : "SEMUA"}${ownerId ? `/AUD-${ownerId}` : ""}`;
}

const finite = (value) => {
  if (value == null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const clean = (value) => typeof value === "string" ? value.trim() : "";
const newerFirst = (a, b) => String(b.audit_date || "").localeCompare(String(a.audit_date || ""))
  || String(b.created_at || "").localeCompare(String(a.created_at || ""))
  || String(b.id).localeCompare(String(a.id));

function stockRows(record) {
  return [1, 2].flatMap((category) => (Array.isArray(record[`stock_opname_kat${category}`]) ? record[`stock_opname_kat${category}`] : [])
    .filter((row) => row && typeof row === "object")
    .map((row) => ({ ...normalizeNexaQuantities(row), group: `Kategori ${category}` })));
}

function discrepancyItems(row) {
  const items = Array.isArray(row.barang) && row.barang.length ? row.barang.filter((item) => item && typeof item === "object") : [row];
  const meaningful = (item) => clean(item.nama) || clean(item.kategori) || finite(item.qty) != null || finite(item.harga) != null;
  const selected = items.length > 1 ? items.filter(meaningful) : items;
  // A Selisih row without filled item details remains visible, with unknown
  // valuation, rather than vanishing from the report or becoming Rp0.
  return selected.length ? selected : [{}];
}

export function buildStockRecap({ branches, records, profiles = [], period, mode = "all", ownerId = null, branchId = null }) {
  recapDocumentNumber(period, mode, ownerId, branchId);
  const selectedBranchId = branchId == null ? null : Number(branchId);
  const names = new Map(profiles.map((profile) => [profile.id, profile.full_name]));
  const scoped = records.filter((record) => record.period === period && (!ownerId || record.submitted_by === ownerId)
    && (selectedBranchId == null || record.branch_id === selectedBranchId));
  const ordered = [...scoped].sort(newerFirst);
  const latest = new Map();
  for (const record of ordered) if (!latest.has(record.branch_id)) latest.set(record.branch_id, record);
  const selected = mode === "latest" ? [...latest.values()] : ordered;
  const knownBranches = new Set(branches.map((branch) => branch.id));
  // Retain records if a historical branch is no longer in the master list.
  const availableBranches = [...branches, ...[...new Set(selected.map((record) => record.branch_id))]
    .filter((id) => !knownBranches.has(id)).map((id) => ({ id, name: `Cabang #${id}` }))];
  const reportBranches = selectedBranchId == null ? availableBranches
    : [availableBranches.find((branch) => branch.id === selectedBranchId) || { id: selectedBranchId, name: `Cabang #${selectedBranchId}` }];
  const details = [];
  const sources = [];
  const nexaItems = [];
  const summaries = reportBranches.map((branch) => {
    const entries = selected.filter((record) => record.branch_id === branch.id).sort(newerFirst);
    let checked = 0, complete = 0, differenceRows = 0, unclassified = 0, visited = 0;
    const firstDetail = details.length;
    entries.forEach((record) => {
      const rows = record.tidak_visit ? [] : stockRows(record);
      const auditor = clean(record.auditor_name) || names.get(record.submitted_by) || "Nama tidak tersedia";
      const differences = rows.filter((row) => row.status === "Selisih");
      rows.filter((row) => row.nexa?.version === 1 && Array.isArray(row.nexa.items)).forEach((row) => {
        row.nexa.items.forEach((item) => nexaItems.push({ ...item, category: nexaCategory(item), discrepancyCategory: discrepancyCategory(item), ...sourceItemValue(item, row.barang?.find((b) => sourceGoodsItem(row, b) === item)?.harga), branch: branch.name, auditId: record.id,
          baReference: nexaBaReference(record.id), code: row.nexa.code, date: row.nexa.date, warehouse: row.nexa.warehouse,
          fileName: row.nexa.fileName, fileSha256: row.nexa.fileSha256, importedAt: row.nexa.importedAt, manualMetadata: row.nexa.manualMetadata || [], auditNote: clean(row.keterangan) }));
      });
      if (!record.tidak_visit) visited += 1;
      checked += rows.length;
      complete += rows.filter((row) => row.status === "Lengkap").length;
      differenceRows += differences.length;
      unclassified += rows.filter((row) => !["Lengkap", "Selisih"].includes(row.status)).length;
      sources.push({ id: record.id, branch: branch.name, auditDate: record.audit_date || "", auditor,
        status: record.tidak_visit ? "Tidak Visit" : rows.length ? "Diaudit" : "Belum ada item",
        checked: rows.length, differenceRows: differences.length });
      differences.forEach((row) => discrepancyItems(row).forEach((item) => {
        const rawQty = finite(item.qty);
        const rawPrice = finite(item.harga);
        const price = rawPrice != null && rawPrice >= 0 ? rawPrice : null;
        // Follow the BA's implicit one-unit pricing only when a price is actually
        // recorded. A note-only finding has no recorded quantity, not one unit.
        const qtyAssumed = (item.qty == null || String(item.qty).trim() === "") && price != null;
        const qty = qtyAssumed ? 1 : rawQty;
        const hasGoods = Array.isArray(row.barang) && row.barang.length > 0;
        const itemName = hasGoods ? clean(item.nama) : "";
        const rowName = clean(row.nama);
        details.push({ auditId: record.id, branch: branch.name, auditDate: record.audit_date || "", auditor,
          group: row.group, item: rowName,
          missingItem: itemName || rowName,
          nameSource: itemName ? "item" : rowName ? "row" : "missing",
          category: clean(item.kategori) || (row.nexa ? nexaCategory(item) : ""), qty, qtyAssumed, price, isNexa: !!row.nexa,
          value: qty != null && price != null ? qty * price : null,
          note: [clean(row.keterangan), row.nexa ? `Sumber ${row.nexa.code}; lihat rincian Nexa untuk arah selisih.` : ""].filter(Boolean).join(" ") });
      }));
    });
    const branchDetails = details.slice(firstDetail);
    return { branchId: branch.id, branch: branch.name, auditCount: entries.length, visited, checked, complete, differenceRows, unclassified,
      detailCount: branchDetails.length, knownValue: branchDetails.reduce((sum, item) => sum + (item.value ?? 0), 0),
      unpriced: branchDetails.filter((item) => item.value == null).length,
      lastAudit: entries[0]?.audit_date || "",
      status: !entries.length ? "Belum ada BA" : !visited ? "Tidak Visit" : !checked ? "Belum ada item"
        : differenceRows ? "Ada selisih" : unclassified ? "Periksa status" : "Lengkap" };
  });
  return { period, mode, ownerId, branchId: selectedBranchId, branchName: selectedBranchId == null ? null : reportBranches[0].name, summaries, details, sources, nexaItems,
    totals: { branches: summaries.length, auditedBranches: summaries.filter((row) => row.checked > 0).length,
      auditCount: sources.length, checked: summaries.reduce((sum, row) => sum + row.checked, 0),
      complete: summaries.reduce((sum, row) => sum + row.complete, 0),
      differenceRows: summaries.reduce((sum, row) => sum + row.differenceRows, 0),
      unclassified: summaries.reduce((sum, row) => sum + row.unclassified, 0),
      detailCount: details.length, knownValue: details.reduce((sum, item) => sum + (item.value ?? 0), 0),
      unpriced: details.filter((item) => item.value == null).length,
      nexaShortageQty: nexaItems.reduce((s, i) => s + (i.difference < 0 ? -i.difference : 0), 0),
      nexaSurplusQty: nexaItems.reduce((s, i) => s + (i.difference > 0 ? i.difference : 0), 0),
      nexaShortageValue: nexaItems.reduce((s, i) => s + (i.signedValue < 0 ? -i.signedValue : 0), 0),
      nexaSurplusValue: nexaItems.reduce((s, i) => s + (i.signedValue > 0 ? i.signedValue : 0), 0),
      nexaNetValue: nexaItems.reduce((s, i) => s + (i.signedValue ?? 0), 0),
      nexaValued: nexaItems.filter((i) => i.difference !== 0 && i.signedValue != null).length,
      nexaUnpriced: nexaItems.filter((i) => i.difference !== 0 && i.signedValue == null).length } };
}
