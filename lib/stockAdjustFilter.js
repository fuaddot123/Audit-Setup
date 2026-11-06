// Temporary reporting policy approved by the user. Never rewrite source BA or
// infer an adjustment reason from product names, prices, or a count difference.
export const TEMPORARY_ADJUST_FILTER = true;
export const ADJUST_CATEGORIES = ["IN - Temuan", "OUT - Biaya Perlengkapan Kantor", "OUT - Rusak", "OUT - Inventaris Kantor", "OUT - Hilang", "OUT - Souvenir"];
export const ADJUST_FILTER_DESCRIPTION = "Filter sementara: hanya IN - Temuan; OUT - Biaya Perlengkapan Kantor, Rusak, Inventaris Kantor, Hilang, dan Souvenir. Alasan harus jelas pada kategori/keterangan barang dan sesuai arah qty. Service, terjual, tertukar/SN, mutasi, retur, clearance/pemutihan, alasan kosong atau campuran tidak dihitung. Data sumber tetap disimpan.";
const normalize = (v) => String(v ?? "").normalize("NFKC").toLowerCase().replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ").trim();
const reasons = [
  /\btemuan\b/, /\b(?:biaya\s+)?perlengkapan\s+kantor\b/, /\brusak\b/, /\binventaris(?:\s+kantor)?\b/, /\bhilang\b/, /\bsouvenir\b/,
];
const excludedProcess = /\b(?:service|servis|svc|srv|terjual|penjualan|tertukar|tukar|sn|serial|mutasi|retur|refund|clearance|clerance|pemutihan|exp|expired|konsi|ecer|eceran)\b|\bplus\s*minus\b|\bsalah\s+pengeluaran\b|\b(?:bk|mb)\//;

export function classifyStockAdjust(item) {
  const difference = item.difference;
  if (typeof difference !== "number" || !Number.isFinite(difference) || difference === 0) return null;
  const explicit = normalize(item.adjustmentCategory);
  let index;
  if (explicit) {
    // A supplied structured category is authoritative; do not override an
    // unknown/unsupported category using a keyword elsewhere in the note.
    index = ADJUST_CATEGORIES.findIndex((c) => normalize(c) === explicit);
    if (index < 0) return null;
  } else {
    let note = normalize(item.note);
    if (!note || /^[-.]+$/.test(note)) return null;
    if (/\b(?:tidak|bukan|belum)\s+(?:\w+\s+){0,2}(?:temuan|rusak|inventaris|hilang|souvenir)\b/.test(note)) return null;
    // "Rusak tidak masuk sistem service" describes damage, not goods currently
    // in service. Keep that explicit damage reason without admitting service.
    note = note.replace(/\b(?:tidak|belum)\s+masuk\s+(?:ke\s+)?(?:sistem\s+)?(?:service|servis)\b/g, "");
    if (excludedProcess.test(note)) return null;
    const matches = reasons.map((pattern, i) => pattern.test(note) ? i : -1).filter((i) => i >= 0);
    if (matches.length !== 1) return null;
    index = matches[0];
  }
  return (index === 0 ? difference > 0 : difference < 0) ? ADJUST_CATEGORIES[index] : null;
}
