const text = (v) => String(v ?? "").trim();
const key = (v) => text(v).toLowerCase().replace(/[^a-z0-9]/g, "");
const aliases = {
  sku: ["kodebarang", "kdbarangrule", "sku"], name: ["namabarang"],
  system: ["jumlahsistem", "stoksistem", "qtysistem"], counted: ["jumlahopname", "stokfisik", "qtyopname"],
  delta: ["selisih"], serial: ["serial", "serialnumber", "sn"], note: ["keterangan", "ketbarang", "ketbrg"],
  code: ["kodestokopname", "kodestockopname", "kdstockopname", "kdstokopname", "nomoropname", "nostokopname", "nostockopname"],
  date: ["tanggal", "tanggalopname"], warehouse: ["gudang", "namagudang"],
  adjustmentCategory: ["kategoriadjust", "kategoriadjuststok", "kategoriadjuststock", "alasanadjust", "alasanadjuststok", "alasanadjuststock"],
};

export function nexaNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = text(value).replace(/\s/g, "");
  if (!s) return null;
  // Numeric cells are preferred. Text follows Indonesian number formatting.
  const normalized = /^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(",", ".");
  return /^[+-]?\d+(\.\d+)?$/.test(normalized) && Number.isFinite(Number(normalized)) ? Number(normalized) : null;
}

function dateValue(value) {
  if (typeof value === "number") {
    // Excel serial dates, interpreted without the host machine timezone.
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "";
  }
  const s = text(value);
  if (/^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
}
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

// Parse actual Nexa detail columns. A header-list export has no count columns
// and is rejected, rather than being interpreted as stock quantities.
export function readNexaTable(rows, context = {}) {
  const index = rows.findIndex((row) => {
    const fields = row.map(key);
    return ["sku", "name", "system", "counted"].every((f) => aliases[f].some((a) => fields.includes(a)));
  });
  if (index < 0) throw new Error("File belum berisi rincian barang. Gunakan ekspor Excel detail Stock Opname Nexa (Kode Barang, Nama Barang, Jumlah Sistem, Jumlah Opname).");
  const header = rows[index].map(key);
  const columns = Object.fromEntries(Object.entries(aliases).map(([f, names]) => [f, header.findIndex((h) => names.includes(h))]));
  for (const f of ["sku", "name", "system", "counted"]) {
    if (header.filter((h) => aliases[f].includes(h)).length !== 1) throw new Error(`Kolom ${f} pada Excel ganda atau tidak jelas.`);
  }
  if (header.filter((h) => aliases.adjustmentCategory.includes(h)).length > 1) throw new Error("Kolom kategori adjust pada Excel ganda atau tidak jelas.");
  const title = rows.slice(0, index).flat().map(text).join(" ");
  const titleCode = title.match(/SOH\/\d+\/\d{6}/i)?.[0] || "";
  if (columns.code < 0 && titleCode && context.code && titleCode !== context.code) throw new Error("Nomor opname tidak sama dengan judul sumber Excel.");
  const get = (row, f) => columns[f] < 0 ? null : row[columns[f]];
  const sourceCodes = [...new Set(rows.slice(index + 1).map((row) => text(get(row, "code"))).filter((c) => /^SOH\/\d+\/\d{6}$/.test(c)))];
  if (sourceCodes.length > 1 && (columns.date < 0 || columns.warehouse < 0) && !context.code) throw new Error("Ekspor gabungan tidak memuat tanggal/gudang per opname. Pilih satu nomor opname sumber, lalu isi tanggal dan gudangnya sesuai Nexa.");
  if (columns.code >= 0 && context.code && !sourceCodes.includes(context.code)) throw new Error("Nomor opname yang dipilih tidak ditemukan pada Excel.");
  const groups = new Map();
  let last = {}, filterCode = "";
  for (let r = index + 1; r < rows.length; r += 1) {
    const row = rows[r];
    if (!row.some((v) => text(v))) continue;
    if (row.map(key).includes("jumlahsistem") && row.map(key).includes("jumlahopname")) continue;
    filterCode = text(get(row, "code")) || filterCode;
    if (columns.code >= 0 && context.code && filterCode !== context.code) continue;
    const sku = text(get(row, "sku")), name = text(get(row, "name"));
    if (!sku || !name) throw new Error(`Baris ${r + 1}: kode/nama barang kosong. Hapus baris total atau pilih sheet rincian barang.`);
    const systemQty = nexaNumber(get(row, "system")), countedQty = nexaNumber(get(row, "counted"));
    if (systemQty == null || countedQty == null || countedQty < 0) throw new Error(`Baris ${r + 1}: jumlah sistem/fisik tidak valid atau kosong.`);
    const difference = Math.round((countedQty - systemQty) * 1e8) / 1e8;
    const sourceDifference = nexaNumber(get(row, "delta"));
    if (columns.delta >= 0 && (sourceDifference == null || Math.abs(sourceDifference - difference) > 1e-7)) throw new Error(`Baris ${r + 1}: selisih Excel tidak sama dengan Jumlah Opname dikurangi Jumlah Sistem.`);
    // Merged header cells in monthly exports can leave repeated metadata blank.
    const rowCode = text(get(row, "code"));
    if (rowCode && rowCode !== last.code) last = {};
    const code = rowCode || last.code || text(context.code) || titleCode;
    const sourceDate = get(row, "date");
    if (text(sourceDate) && !validDate(dateValue(sourceDate))) throw new Error(`Baris ${r + 1}: tanggal sumber Excel tidak valid.`);
    const date = dateValue(sourceDate) || last.date || text(context.date);
    const warehouse = text(get(row, "warehouse")) || last.warehouse || text(context.warehouse);
    const manualMetadata = [columns.code < 0 && !titleCode ? "Nomor opname" : "", !dateValue(sourceDate) && !last.date ? "Tanggal opname" : "", !text(get(row, "warehouse")) && !last.warehouse ? "Gudang" : ""].filter(Boolean);
    last = { code, date, warehouse };
    if (!/^SOH\/\d+\/\d{6}$/.test(code)) throw new Error("Nomor opname Nexa (SOH/…/YYYYMM) wajib diisi sesuai sumber.");
    if (!validDate(date) || !warehouse) throw new Error("Tanggal opname dan gudang sumber wajib diisi sesuai Nexa.");
    if (code.split("/")[2] !== date.slice(0, 7).replace("-", "")) throw new Error(`Nomor ${code} tidak sesuai bulan tanggal opname.`);
    if (!groups.has(code)) groups.set(code, { code, date, warehouse, manualMetadata, items: [] });
    const group = groups.get(code);
    if (group.date !== date || group.warehouse !== warehouse) throw new Error(`Metadata ${code} tidak konsisten di dalam file.`);
    if (group.items.some((item) => item.sku.toUpperCase() === sku.toUpperCase() && item.name === name)) throw new Error(`${code}: kode dan nama barang ${sku} muncul lebih dari sekali. Periksa ekspor sumber.`);
    group.items.push({ sku, name, systemQty, countedQty, difference, serial: text(get(row, "serial")), note: text(get(row, "note")),
      ...(columns.adjustmentCategory >= 0 ? { adjustmentCategory: text(get(row, "adjustmentCategory")) } : {}) });
  }
  if (!groups.size) throw new Error("Excel tidak memiliki rincian opname.");
  return [...groups.values()];
}

const branchAliases = {
  semarang: ["ruko smg"], yogyakarta: ["sagan yk", "yogyakomtek"], surabayamerr: ["surabaya", "merr surabaya"],
  surabayababatan: ["babatan surabaya", "surabaya babatan"],
};
export function warehouseMatchesBranch(warehouse, branchName) {
  const b = key(branchName);
  const names = branchAliases[b] || [text(branchName).toLowerCase()];
  const warehouses = text(warehouse).split(/[,;\n]/).map((w) => w.trim().toLowerCase().replace(/^gudang sementara\s+/, "").replace(/^service\s+/, "").replace(/\s+(display|service)$/, ""));
  return warehouses.length > 0 && warehouses.every((w) => names.includes(w));
}

export function makeNexaRows(groups, { branch, period, auditDate, existingRows = [], fileName, fileSha256, importedAt }) {
  const existing = new Set(existingRows.filter((r) => r.nexa).map((r) => r.nexa.code));
  return groups.map((g) => {
    if (existing.has(g.code)) throw new Error(`${g.code} sudah ada dalam BA ini. Hapus impor lama secara sengaja sebelum menggantinya.`);
    existing.add(g.code);
    if (!warehouseMatchesBranch(g.warehouse, branch.name)) throw new Error(`${g.code}: gudang ${g.warehouse} tidak sesuai cabang ${branch.name}.`);
    if (g.date.slice(0, 7) !== period || g.date > auditDate) throw new Error(`${g.code}: tanggal sumber harus dalam periode BA dan tidak melewati tanggal audit.`);
    const differences = g.items.filter((i) => i.difference !== 0);
    return { nama: `Nexa ${g.code} (jumlah)`, status: differences.length ? "Selisih" : "Lengkap", keterangan: "",
      barang: differences.map((i) => ({ sku: i.sku, nexaItemName: i.name, nama: `${i.sku} — ${i.name}`, kategori: "", qty: i.difference, harga: "" })),
      nexa: { version: 1, ...g, branchId: branch.id, fileName, fileSha256, importedAt } };
  });
}

export const nexaBaReference = (id) => id ? `BA-SO/KLA/${id}` : "Simpan BA untuk memperoleh nomor referensi";
export function nexaAppendixHtml(rows, id, escape) {
  const imported = rows.filter((r) => r.nexa);
  if (!imported.length) return "";
  const td = (v) => `<td style="padding:4px;border-bottom:1px solid #ddd;vertical-align:top">${escape(v)}</td>`;
  const money = (v) => v == null ? "Belum tersedia" : `Rp${(v === 0 ? 0 : v).toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;
  const tables = imported.map((r) => {
    const files = [...new Set(r.nexa.items.filter((i) => i.valuation).map((i) => `${i.valuation.fileName} (${i.valuation.period})`))];
    const body = r.nexa.items.map((i) => {
      const v = i.valuation, unitCost = v?.unitCost ?? null, value = i.difference === 0 ? 0 : unitCost == null ? null : unitCost * i.difference;
      return `<tr style="break-inside:avoid">${td(`${i.sku} — ${i.name}${i.category ? ` / ${i.category}` : ""}`)}${td(i.systemQty)}${td(i.countedQty)}${td(i.difference)}${td(money(unitCost))}${td(money(value))}${td(v ? `${v.basis || "Sisa Nilai / Sisa Qty"}: ${money(v.costAmount ?? v.reportAmount)} / ${v.costQty ?? v.reportQty ?? "-"} (${v.period})` : "Report belum dimuat")}${td([i.serial, i.note].filter(Boolean).join(" / "))}</tr>`;
    }).join("");
    const head = ["Kode / Barang", "Stok admin", "Stok fisik", "Qty selisih", "Harga / unit", "Nilai selisih", "Dasar persediaan", "Serial / Catatan"].map((h) => `<th style="text-align:left;padding:4px;background:#f4f2f9">${h}</th>`).join("");
    return `<h4 style="break-after:avoid">${escape(r.nexa.code)} · ${escape(r.nexa.date)}</h4><p>${escape(r.nexa.warehouse)}<br>File opname: ${escape(r.nexa.fileName)} · SHA-256: ${escape(r.nexa.fileSha256)}${files.length ? `<br>Report Persediaan: ${escape(files.join("; "))}` : ""}${r.nexa.manualMetadata?.length ? `<br>Diisi saat impor: ${escape(r.nexa.manualMetadata.join(", "))}` : ""}<br>Catatan BA: ${escape(r.keterangan || "-")}</p><table class="k-tbl" style="width:100%;border-collapse:collapse;font-size:7px"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }).join("");
  return `<div style="margin-top:14px;overflow-wrap:anywhere"><h3>Rincian Stock Opname Nexa — Acuan Adjust Stock</h3><p>Referensi BA: ${escape(nexaBaReference(id))}</p><p>Harga = nominal / qty Report Persediaan sesuai dasar pada rincian. Nilai selisih = harga × (fisik − admin). Status berdasarkan jumlah; serial dan keterangan tetap perlu diperiksa.</p>${tables}</div>`;
}
