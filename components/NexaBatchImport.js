import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { readCompleteNexa, planNexaBatch } from "../lib/nexaBatchImport";
import { canImportNexa, saveNexaRecap } from "../lib/nexaRecapSave";
import { rupiah } from "../lib/stockOpnameRecap";
import ExcelSourcePicker from "./ExcelSourcePicker";

export default function NexaBatchImport({ profile, period, branches, records, inventoryReport, disabled, onSaving, onSaved }) {
  const [source, setSource] = useState(null), [reading, setReading] = useState(false), [saving, setSaving] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const computed = useMemo(() => {
    if (!source) return {};
    try { return { plan: planNexaBatch({ ...source, branches, records, report: inventoryReport, profile, period }) }; }
    catch (e) { return { problem: e.message }; }
  }, [source, branches, records, inventoryReport, profile, period]);
  if (!canImportNexa(profile)) return null;
  async function load(file) {
    if (!file) return;
    setReading(true); setError(""); setNotice(""); setSource(null);
    try {
      if (!/\.(xlsx|xls)$/i.test(file.name) || file.size > 8 * 1024 * 1024) throw new Error("Gunakan Excel maksimal 8 MB.");
      const X = await import("xlsx"), buffer = await file.arrayBuffer();
      const book = X.read(buffer, { type: "array", cellFormula: true });
      const sheet = book.Sheets[book.SheetNames[0]], range = X.utils.decode_range(sheet["!ref"] || "A1");
      if (range.e.r >= 100000 || range.e.c >= 100) throw new Error("Sheet terlalu besar.");
      if (Object.entries(sheet).some(([k, c]) => !k.startsWith("!") && c?.f)) throw new Error("Gunakan sumber berupa nilai, bukan rumus.");
      const parsed = readCompleteNexa(X.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }));
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      const fileSha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
      setSource({ ...parsed, fileName: file.name, fileSha256, importedAt: new Date().toISOString(), ids: Object.fromEntries(branches.map((b) => [b.id, crypto.randomUUID()])) });
    } catch (e) { setError(e.message); }
    finally { setReading(false); }
  }
  async function save() {
    if (!computed.plan?.entries.length || disabled || saving) return;
    const snapshot = computed.plan.entries;
    setSaving(true); onSaving(true); setError("");
    const failed = []; let saved = 0;
    try {
      for (const entry of snapshot) {
        setNotice(`Menyimpan ${entry.branch.name} (${saved + failed.length + 1}/${snapshot.length})…`);
        try {
          const result = await saveNexaRecap(supabase, { ...entry, profile, period, targetId: null });
          saved++; onSaved(result);
        } catch (e) { failed.push(`${entry.branch.name}: ${e.message}`); }
      }
      setNotice(`${saved} BA cabang tersimpan. Data BA sebelumnya tetap utuh. ${failed.length ? "Bagian gagal dapat dicoba kembali tanpa mengulang cabang yang sudah tersimpan." : "Pilih Semua cabang untuk mengekspor rekap."}`);
      if (failed.length) setError(failed.join(" "));
    } finally { setSaving(false); onSaving(false); }
  }
  const plan = computed.plan;
  return <section className="stock-card">
    <div className="stock-section-heading"><div><span className="stock-eyebrow">IMPOR GABUNGAN SEMUA CABANG</span><h2>Stock Opname Nexa COMPLETE</h2><p>Satu Excel dengan nomor opname, tanggal, gudang, Status Nexa, dan rincian barang. Hanya COMPLETE yang dipakai; satu BA rekap baru dibuat per cabang.</p></div></div>
    <fieldset className="stock-fieldset" disabled={disabled || reading || saving}>
      <ExcelSourcePicker name="opname gabungan" label={reading ? "Membaca sumber…" : "Pilih Excel opname gabungan"} disabled={disabled || reading || saving} onFile={load} />
      {source && <p className="stock-help">{source.fileName} · {source.groups.length} opname COMPLETE · {source.excluded} nomor belum COMPLETE dilewati pada sheet rincian. Nomor yang sudah tersimpan dilewati. Tanggal BA memakai batas akhir bulan; tanggal hitung asli tetap tercatat per nomor opname.</p>}
      {computed.problem && <p role="alert" className="stock-error">{computed.problem}</p>}
      {plan && <><p><b>{plan.entries.length} cabang · {plan.opnames} opname baru · {plan.items.toLocaleString("id-ID")} baris barang</b> · {plan.skipped} opname sudah tersimpan.</p>
        <div className="stock-table-scroll"><table className="stock-item-table"><thead><tr><th>Cabang</th><th>Opname</th><th>Barang</th><th>Nilai terhitung</th><th>Belum bernilai</th></tr></thead><tbody>{plan.entries.map((e) => {
          const items = e.kat1.flatMap((r) => r.nexa.items), differences = items.filter((i) => i.difference !== 0);
          const known = differences.filter((i) => i.valuation.unitCost != null), missing = differences.length - known.length;
          return <tr key={e.branch.id}><td>{e.branch.name}</td><td>{e.kat1.length}</td><td>{items.length}</td><td>{missing && !known.length ? "Belum dihitung" : `${rupiah(known.reduce((s, i) => s + i.difference * i.valuation.unitCost, 0))}${missing ? " (sebagian)" : ""}`}</td><td>{missing}</td></tr>;
        })}</tbody></table></div>
        <p className="stock-help">Setiap nomor opname dihitung tersendiri, termasuk hitung berulang. Nilai gabungan merupakan rekap pemeriksaan, bukan saldo akhir atau nominal adjust final. BA manual sebelumnya tidak ditimpa.</p>
        <button type="button" className="btn" disabled={!plan.entries.length} onClick={save}>Simpan impor ke {plan.entries.length} cabang</button></>}
    </fieldset>
    {notice && <p role="status" className="stock-success">{notice}</p>}{error && <p role="alert" className="stock-error">{error}</p>}
  </section>;
}
