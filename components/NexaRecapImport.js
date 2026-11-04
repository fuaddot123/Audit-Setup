import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { NexaOpnameImport, NexaImportedRow } from "./NexaOpnameImport";
import { canImportNexa, saveNexaRecap } from "../lib/nexaRecapSave";
import { nexaBaReference } from "../lib/nexaOpnameImport";
import { valueNexaRow } from "../lib/persediaanValuation";

export default function NexaRecapImport({ profile, branch, period, records, profiles, onSaved, onSaving, disabled = false, inventoryReport }) {
  const [target, setTarget] = useState(""), [date, setDate] = useState("");
  const [kat1, setKat1] = useState([]), [kat2, setKat2] = useState([]);
  const [newId, setNewId] = useState(""), [saving, setSaving] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const valuedKat1 = useMemo(() => kat1.map((r) => valueNexaRow(r, inventoryReport)), [kat1, inventoryReport]);
  const valuedKat2 = useMemo(() => kat2.map((r) => valueNexaRow(r, inventoryReport)), [kat2, inventoryReport]);
  if (!canImportNexa(profile)) return null;
  if (!branch) return <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}><b>Impor Excel Nexa ke rekap</b><p style={{ fontSize: 12 }}>Pilih satu cabang pada filter rekap untuk mengimpor hasil stock opname Nexa.</p></section>;
  const targets = records.filter((r) => r.branch_id === branch.id && r.period === period && !r.tidak_visit && (profile.role === "super_admin" || r.submitted_by === profile.id))
    .sort((a, b) => String(b.audit_date || "").localeCompare(String(a.audit_date || "")) || String(b.created_at || "").localeCompare(String(a.created_at || "")));
  const selected = targets.find((r) => r.id === target);
  const auditDate = target === "new" ? date : selected?.audit_date || "";
  const existing = [selected?.stock_opname_kat1, selected?.stock_opname_kat2].flatMap((r) => Array.isArray(r) ? r : []);
  function resetDraft() { setKat1([]); setKat2([]); setError(""); setNotice(""); }
  function update(setter, index, f, v) { setter((old) => old.map((r, i) => i === index ? { ...r, [f]: v } : r)); }
  async function save() {
    if (saving || disabled) return;
    setSaving(true); onSaving(true); setError(""); setNotice("");
    try {
      if (!inventoryReport || inventoryReport.period !== period) throw new Error("Muat Report Persediaan bulan ini agar nilai dihitung otomatis.");
      const result = await saveNexaRecap(supabase, { profile, branch, period, auditDate, targetId: target === "new" ? null : target, newId, kat1: valuedKat1, kat2: valuedKat2 });
      setKat1([]); setKat2([]); setTarget(""); setNewId("");
      setNotice(`Impor tersimpan untuk ${branch.name}. Referensi: ${nexaBaReference(result.id)}`);
      onSaved(result);
    } catch (e) { setError(e.message || "Impor gagal disimpan."); }
    finally { setSaving(false); onSaving(false); }
  }
  return <section className="stock-card">
    <div className="stock-section-heading"><div><span className="stock-eyebrow">IMPOR HASIL PEMERIKSAAN</span><h2>Stock Opname Nexa — {branch.name}</h2><p>Pilih BA tujuan, lalu muat hasil hitung fisik. Harga diisi otomatis dari Report Persediaan.</p></div></div>
    <fieldset disabled={saving || disabled} style={{ border: 0, margin: 0, padding: 0 }}>
      <label className="stock-destination">BA tujuan
        <select className="input" value={target} onChange={(e) => { resetDraft(); setTarget(e.target.value); if (e.target.value === "new") setNewId(crypto.randomUUID()); }}>
          <option value="">Pilih BA tujuan</option><option value="new">Buat BA stock opname baru</option>
          {targets.map((r) => <option key={r.id} value={r.id}>{r.audit_date || "Tanggal belum diisi"} · {profiles.find((p) => p.id === r.submitted_by)?.full_name || "Auditor"} · #{r.id.slice(-8)}</option>)}
        </select>
      </label>
      {target === "new" && <label style={{ display: "grid", gap: 6, fontSize: 12, margin: "12px 0" }}>Tanggal audit BA baru<input className="input" type="date" min={`${period}-01`} value={date} onInput={(e) => { setDate(e.currentTarget.value); resetDraft(); }} onChange={(e) => { setDate(e.target.value); resetDraft(); }} /></label>}
      {target && <p style={{ fontSize: 12 }}>Tanggal audit: {auditDate || "Belum diisi"}. Hasil impor ditambahkan ke data BA tujuan dan langsung masuk perhitungan serta export PDF/Excel rekap setelah disimpan.</p>}
      {!!auditDate && <NexaOpnameImport key={`${target}/${auditDate}`} branch={branch} period={period} auditDate={auditDate} existingRows={[...existing, ...kat1, ...kat2]}
        onImport={(category, rows) => { (category === 1 ? setKat1 : setKat2)((old) => [...old, ...rows]); setNotice(""); }} />}
      {[{ rows: valuedKat1, setter: setKat1, n: 1 }, { rows: valuedKat2, setter: setKat2, n: 2 }].map(({ rows, setter, n }) => !!rows.length && <div key={n} className="stock-draft-group"><b>Kategori {n} — pratinjau belum disimpan</b>{rows.map((row, i) => <NexaImportedRow key={row.nexa.code} row={row} canEdit={!saving} removeLabel={`Hapus ${row.nexa.code} dari pratinjau`} onRemove={() => setter((old) => old.filter((_, j) => i !== j))} onNote={(v) => update(setter, i, "keterangan", v)} />)}</div>)}
      {(kat1.length + kat2.length > 0) && <div className="stock-save-bar"><span>{inventoryReport ? "Harga dan nilai selisih akan disimpan bersama rincian opname." : "Muat Report Persediaan untuk menghitung harga otomatis."}</span><button className="btn" disabled={saving || !inventoryReport} onClick={save}>{saving ? "Menyimpan…" : "Simpan impor ke rekap"}</button></div>}
    </fieldset>
    {error && <p role="alert" style={{ color: "var(--danger-text)" }}>{error}</p>}
    {notice && <p role="status" style={{ color: "#1a9e6e", overflowWrap: "anywhere" }}>{notice}</p>}
  </section>;
}
