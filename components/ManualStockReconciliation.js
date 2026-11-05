import { useState } from "react";
import { readManualPlan, reconcileManualRecord, saveManualReconciliation } from "../lib/manualStockReconciliation";
import { canImportNexa } from "../lib/nexaRecapSave";
import { supabase } from "../lib/supabaseClient";

export default function ManualStockReconciliation({ period, profile, records, disabled, onSaving, onSaved }) {
  const [text, setText] = useState(""), [plan, setPlan] = useState(null), [error, setError] = useState(""), [notice, setNotice] = useState("");
  if (!canImportNexa(profile)) return null;
  function preview() {
    setError(""); setNotice(""); setPlan(null);
    try {
      const data = readManualPlan(text, period);
      for (const id of new Set(data.rows.map((r) => r.auditId))) {
        const target = records.find((r) => r.id === id);
        if (!target || (profile.role !== "super_admin" && target.submitted_by !== profile.id)) throw new Error("BA tujuan tidak dapat diakses pada cakupan ini.");
        reconcileManualRecord(target, data, records);
      }
      setPlan(data);
    } catch (e) { setError(e.message); }
  }
  async function save() {
    onSaving(true); setError(""); setNotice("");
    try {
      const result = await saveManualReconciliation(supabase, { profile, plan });
      result.saved.forEach(onSaved);
      setNotice(`Pencocokan tersimpan pada ${result.saved.length} BA. Catatan asli tetap disimpan; tautan Nexa tidak dijumlah dua kali.`);
      if (result.failures.length) setError(result.failures.map((r) => r.message).join(" "));
      else { setPlan(null); setText(""); }
    } catch (e) { setError(e.message); }
    finally { onSaving(false); }
  }
  return <section className="stock-card"><h2>Lengkapi rincian BA manual</h2>
    <p style={{ fontSize: 12, lineHeight: 1.7 }}>Gunakan pencocokan yang sudah diperiksa antara catatan BA dan nomor opname/SKU Nexa pada cabang yang sama. Stok admin, fisik, kategori dan harga diambil dari data Nexa yang tersimpan. Catatan dengan bukti yang belum cukup tetap ditandai untuk verifikasi.</p>
    <details><summary>Impor pencocokan yang sudah diperiksa</summary>
      <textarea className="input" aria-label="Pencocokan BA manual" rows={4} style={{ width: "100%", marginTop: 12 }} disabled={disabled} value={text} onChange={(e) => { setText(e.target.value); setPlan(null); }} />
      <button type="button" className="btn-ghost" disabled={disabled || !text.trim()} onClick={preview}>Periksa pencocokan BA</button>
    </details>
    {plan && <div style={{ marginTop: 14, fontSize: 12 }}><p>{plan.rows.length} baris BA diperiksa; {plan.rows.reduce((s, r) => s + r.links.length, 0)} rincian barang ditautkan; {plan.rows.filter((r) => r.pendingReason).length} baris memiliki catatan verifikasi.</p><button type="button" className="btn" disabled={disabled} onClick={save}>Simpan rincian BA dari Nexa</button></div>}
    {notice && <p role="status" className="stock-success">{notice}</p>}{error && <p role="alert" className="stock-error">{error}</p>}
  </section>;
}
