import { useState } from "react";
import { previewStockCorrections, saveStockCorrections } from "../lib/correctStockData";
import { canImportNexa } from "../lib/nexaRecapSave";
import { supabase } from "../lib/supabaseClient";

function downloadBackup(data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = `Cadangan-Koreksi-Stock-${data.period}-${Date.now()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export default function StockDataCorrection({ period, profile, records, disabled, onSaving, onSaved }) {
  const [preview, setPreview] = useState(null), [error, setError] = useState(""), [notice, setNotice] = useState("");
  if (!canImportNexa(profile)) return null;
  const targets = records.filter((r) => r.period === period && !r.tidak_visit && (profile.role === "super_admin" || r.submitted_by === profile.id));
  async function check(restore = false) {
    onSaving(true); setError(""); setNotice(""); setPreview(null);
    try { const result = await previewStockCorrections(targets, { reviewer: profile.id, restore }); setPreview({ ...result, restore, ids: targets.map((r) => r.id) }); }
    catch (e) { setError(e.message); }
    finally { onSaving(false); }
  }
  async function save() {
    onSaving(true); setError(""); setNotice("");
    try {
      const result = await saveStockCorrections(supabase, { profile, period, ids: preview.ids, restore: preview.restore, onBackup: downloadBackup });
      result.saved.forEach(onSaved);
      setNotice(`${preview.restore ? "Pemulihan" : "Koreksi"} tersimpan dan terverifikasi pada ${result.saved.length} BA; ${result.skipped.length} BA tidak perlu diubah.`);
      if (result.failures.length) setError(result.failures.map((r) => `${r.id}: ${r.message}`).join(" "));
      setPreview(null);
    } catch (e) { setError(e.message); }
    finally { onSaving(false); }
  }
  return <section className="stock-card"><h2>Koreksi data stock opname lama</h2><p style={{ fontSize: 12, lineHeight: 1.7 }}>Periode {period}, seluruh cabang yang dapat diakses akun ini. Selaraskan status dan rincian BA tersimpan dengan kategori adjust. Barang di luar kategori ditandai “Di luar filter”. Hitungan fisik/admin, keterangan Nexa dan nilai persediaan sumber tetap disimpan. Cadangan diunduh sebelum penyimpanan.</p>
    <button type="button" className="btn-ghost" disabled={disabled || !targets.length} onClick={() => check(false)}>Periksa data lama</button>
    <details style={{ marginTop: 12 }}><summary>Pulihkan status dan rincian sebelum koreksi</summary><p style={{ fontSize: 12 }}>Pemulihan hanya tersedia jika baris belum diubah lagi setelah koreksi.</p><button type="button" className="btn-ghost" disabled={disabled || !targets.length} onClick={() => check(true)}>Periksa pemulihan data</button></details>
    {preview && <div style={{ marginTop: 12, fontSize: 12 }}><p>{preview.changed} BA akan {preview.restore ? "dipulihkan" : "dikoreksi"}.{!preview.restore && ` ${preview.included} rincian Nexa memenuhi kategori adjust.`}</p><button type="button" className="btn" disabled={disabled || !preview.changed} onClick={save}>{preview.restore ? "Pulihkan data sebelum koreksi" : "Koreksi & simpan data lama"}</button></div>}
    {notice && <p role="status" className="stock-success">{notice}</p>}{error && <p role="alert" className="stock-error">{error}</p>}
  </section>;
}
