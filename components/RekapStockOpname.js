import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { sortBranches } from "../lib/branchOrder";
import { buildStockRecap, ISOLATION_START_PERIOD, periodLabel, recapDocumentNumber, recapModeLabel, rupiah, stockDetailName, stockDetailNameNote, stockValueLabel } from "../lib/stockOpnameRecap";
import { createRecapPdf, createRecapWorkbook, categorySummary } from "../lib/stockOpnameRecapExport";
import NexaRecapImport from "./NexaRecapImport";
import NexaBatchImport from "./NexaBatchImport";
import PersediaanReportInput from "./PersediaanReportInput";
import StockNexaDetails from "./StockNexaDetails";
import { valueRecord } from "../lib/persediaanValuation";
import { savePersediaanValues } from "../lib/savePersediaanValues";
import { canImportNexa } from "../lib/nexaRecapSave";
import ManualStockReconciliation from "./ManualStockReconciliation";

function previousPeriod() {
  const date = new Date();
  date.setDate(1); date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
const panel = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 };
const cell = { padding: "10px 12px", borderBottom: "1px solid var(--border)", verticalAlign: "top", textAlign: "left", fontSize: 12 };

export default function RekapStockOpname({ profile }) {
  const [period, setPeriod] = useState(previousPeriod);
  const [mode, setMode] = useState("all");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [branches, setBranches] = useState([]);
  const [records, setRecords] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(null);
  const [generatedFor, setGeneratedFor] = useState("");
  const [loadedFor, setLoadedFor] = useState("");
  const [revision, setRevision] = useState(0);
  const [importSaving, setImportSaving] = useState(false);
  const [valuationSaving, setValuationSaving] = useState(false), [inventoryReport, setInventoryReport] = useState(null);
  const [tab, setTab] = useState("summary"), [valuationNotice, setValuationNotice] = useState("");
  const loadSeq = useRef(0);
  const ownerId = profile?.role === "auditor" && period >= ISOLATION_START_PERIOD ? profile.id : null;
  const queryKey = `${period}|${profile?.id}|${profile?.role}`;
  const isCurrent = loadedFor === queryKey;
  const branchOptions = useMemo(() => {
    const ids = new Set(branches.map((branch) => branch.id));
    return [...branches, ...[...new Set((isCurrent ? records : []).map((record) => record.branch_id))]
      .filter((id) => !ids.has(id)).map((id) => ({ id, name: `Cabang #${id}` }))];
  }, [branches, records, isCurrent]);
  const currentBranch = branchOptions.find((branch) => String(branch.id) === selectedBranch) || branchOptions[0] || null;
  const branchId = currentBranch?.id ?? null;
  const scopeKey = `${queryKey}|${mode}|${branchId ?? "none"}`;
  const activeReport = inventoryReport?.queryKey === queryKey ? inventoryReport : null;
  const saving = importSaving || valuationSaving;
  const valuedRecords = useMemo(() => isCurrent ? records.map((r) => valueRecord(r, activeReport)) : [], [records, activeReport, isCurrent]);
  const recap = useMemo(() => buildStockRecap({ branches, records: valuedRecords, profiles, period, mode, ownerId, branchId }),
    [branches, valuedRecords, profiles, period, mode, ownerId, branchId]);
  const valuationIds = recap.sources.filter((s) => {
    const r = records.find((r) => r.id === s.id);
    return r && canImportNexa(profile) && (profile.role === "super_admin" || r.submitted_by === profile.id)
      && [r.stock_opname_kat1, r.stock_opname_kat2].some((rows) => Array.isArray(rows) && rows.some((row) => row.nexa));
  }).map((s) => s.id);
  const number = generatedFor === scopeKey ? recapDocumentNumber(period, mode, ownerId, branchId) : "";

  function changePeriod(value) {
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) setPeriod(value);
  }
  function movePeriod(delta) {
    const [year, month] = period.split("-").map(Number);
    const date = new Date(year, month - 1 + delta, 1);
    changePeriod(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
  }

  useEffect(() => {
    const seq = ++loadSeq.current;
    let cancelled = false;
    setLoading(true); setError(""); setValuationNotice(""); setRecords([]); setLoadedFor("");
    (async () => {
      try {
        const [branchResult, profileResult] = await Promise.all([
          supabase.from("branches").select("id,name").order("name"),
          supabase.from("profiles").select("id,full_name"),
        ]);
        if (branchResult.error) throw branchResult.error;
        if (profileResult.error) throw profileResult.error;
        const allRecords = [];
        for (let offset = 0; ; offset += 500) {
          let query = supabase.from("berita_acara")
            .select("id,branch_id,period,audit_date,submitted_by,tidak_visit,stock_opname_kat1,stock_opname_kat2,created_at")
            .eq("period", period).order("id").range(offset, offset + 499);
          if (ownerId) query = query.eq("submitted_by", ownerId);
          const result = await query;
          if (result.error) throw result.error;
          allRecords.push(...(result.data || []));
          if ((result.data || []).length < 500) break;
        }
        if (cancelled || seq !== loadSeq.current) return;
        setBranches(sortBranches(branchResult.data || []));
        setProfiles(profileResult.data || []);
        setRecords(allRecords); setLoadedFor(queryKey);
      } catch (err) {
        if (!cancelled && seq === loadSeq.current) setError(`Gagal memuat rekap: ${err.message}`);
      } finally {
        if (!cancelled && seq === loadSeq.current) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [period, profile?.id, profile?.role, revision]);

  async function exportReport(type) {
    if (loading || exporting || saving || !isCurrent || !currentBranch || !recap.sources.length) return;
    setExporting(type); setError(""); setGeneratedFor(scopeKey);
    const docNumber = recapDocumentNumber(period, mode, ownerId, branchId);
    const stamp = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
    const branchSlug = recap.branchName?.normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
    const filename = `Rekap-Stock-Opname-${period}${branchId == null ? "" : `-Cabang-${branchId}-${branchSlug}`}-${mode === "all" ? "Semua-BA" : "Audit-Terakhir"}${ownerId ? "-Data-Saya" : ""}`;
    try {
      if (type === "excel") {
        const XLSX = await import("xlsx");
        const workbook = createRecapWorkbook(XLSX, recap, docNumber, stamp);
        XLSX.writeFile(workbook, `${filename}.xlsx`, { compression: true });
      } else {
        const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
        createRecapPdf(jsPDF, autoTable, recap, docNumber, stamp).save(`${filename}.pdf`);
      }
    } catch (err) {
      setError(`Gagal mengekspor laporan: ${err.message}`);
    } finally {
      setExporting(null);
    }
  }

  async function saveValues() {
    if (!activeReport || saving || loading) return;
    setValuationSaving(true); setError(""); setValuationNotice("");
    try {
      const result = await savePersediaanValues(supabase, { profile, ids: valuationIds, report: activeReport });
      setRecords((old) => old.map((r) => result.saved.find((s) => s.id === r.id) || r));
      setValuationNotice(`Nilai Report Persediaan tersimpan pada ${result.saved.length} BA.`);
      if (result.failures.length) setError(`${result.failures.length} BA belum diperbarui: ${result.failures.map((f) => f.message).join(" ")}`);
    } catch (e) { setError(e.message); }
    finally { setValuationSaving(false); }
  }

  const busy = loading || !isCurrent;
  const totals = recap.totals;
  const manualDetails = recap.details.filter((r) => !r.isNexa);
  const categoryRows = categorySummary(recap.nexaItems);
  return (
    <main className="stock-recap" style={{ flex: 1, minWidth: 0 }}>
      <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)" }}>
        <h1 className="display" style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Rekap Stock Opname{currentBranch ? ` — ${currentBranch.name}` : ""}</h1>
        <div style={{ color: "var(--text-secondary)", fontSize: 12.5, marginTop: 5 }}>Pilih cabang untuk melihat ringkasan, rincian barang, dan berita acara bulanannya. PDF dan Excel mengikuti cabang yang dipilih.</div>
      </div>
      <div className="stock-recap-body">
        <section style={panel}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "end" }}>
            <div style={{ fontSize: 12, display: "grid", gap: 7 }}>
              <label htmlFor="stock-recap-period">Periode</label>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button aria-label="Bulan sebelumnya" type="button" className="btn-ghost" disabled={!!exporting || saving} onClick={() => movePeriod(-1)}>&lt;</button>
                <input id="stock-recap-period" aria-label="Periode rekap" className="input" type="month" value={period} disabled={!!exporting || saving}
                  onInput={(e) => changePeriod(e.currentTarget.value)} onChange={(e) => changePeriod(e.target.value)} />
                <button aria-label="Bulan berikutnya" type="button" className="btn-ghost" disabled={!!exporting || saving} onClick={() => movePeriod(1)}>&gt;</button>
              </div>
            </div>
            <label style={{ fontSize: 12, display: "grid", gap: 7 }}>Cabang
              <select aria-label="Cabang rekap" className="input" value={branchId ?? ""} disabled={busy || !!exporting || saving || !branchOptions.length} onChange={(e) => { setSelectedBranch(e.target.value); setValuationNotice(""); }}>
                {!branchOptions.length && <option value="">Belum ada cabang</option>}
                {branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12, display: "grid", gap: 7 }}>Sumber audit
              <select aria-label="Sumber audit" className="input" value={mode} disabled={!!exporting || saving} onChange={(e) => setMode(e.target.value)}>
                <option value="all">Semua berita acara</option>
                <option value="latest">Audit terakhir cabang ini</option>
              </select>
            </label>
            <button className="btn-ghost" disabled={loading || !!exporting || saving} onClick={() => setRevision((value) => value + 1)}>Perbarui data</button>
          </div>
          <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 0 }}>
            {mode === "all" ? "Setiap berita acara pada bulan ini dihitung, termasuk beberapa kunjungan ke cabang yang sama." : "Satu berita acara terbaru per cabang dipakai berdasarkan tanggal audit, lalu waktu dibuat."}
            {currentBranch ? ` Cakupan: ${currentBranch.name}.` : " Pilih cabang setelah data tersedia."}
            {ownerId && " Akun auditor hanya menampilkan data auditnya sendiri sesuai hak akses."}
          </p>
        </section>
        {error && <div role="alert" style={{ ...panel, color: "var(--danger-text)", background: "var(--danger-bg)" }}>{error}</div>}
        {valuationNotice && <div role="status" className="stock-success">{valuationNotice}</div>}
        <section style={{ ...panel, display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 7 }}>Nomor Berita Acara Rekap</div>
            <strong style={{ fontSize: 13, overflowWrap: "anywhere" }}>{number || "Dibuat saat generate atau ekspor"}</strong>
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 7 }}>Nomor tetap untuk bulan, cabang, dan sumber audit yang sama; PDF dan Excel memakai nomor yang sama.</div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button className="btn-ghost" disabled={busy || !!exporting || saving || !recap.sources.length} onClick={() => setGeneratedFor(scopeKey)}>Generate Nomor BA</button>
            <button className="btn" disabled={busy || !!exporting || saving || !recap.sources.length} onClick={() => exportReport("pdf")}>{exporting === "pdf" ? "Menyiapkan PDF…" : "Export PDF"}</button>
            <button className="btn-ghost" disabled={busy || !!exporting || saving || !recap.sources.length} onClick={() => exportReport("excel")}>{exporting === "excel" ? "Menyiapkan Excel…" : "Export Excel"}</button>
          </div>
        </section>
        <nav className="stock-tabs" aria-label="Tampilan rekap">{[["summary", "Ringkasan cabang"], ["details", "Detail stok admin & fisik"], ["import", "Impor Excel & sumber nilai"]].map(([id, label]) => <button key={id} type="button" aria-pressed={tab === id} className={tab === id ? "is-active" : ""} disabled={saving} onClick={() => setTab(id)}>{label}</button>)}</nav>
        <div hidden={tab !== "import"} className="stock-import-workspace">
          <ManualStockReconciliation key={`${queryKey}/${branchId}/manual`} period={period} profile={profile} records={valuedRecords.filter((r) => r.branch_id === branchId)} disabled={busy || !!exporting || saving || !currentBranch} onSaving={setImportSaving} onSaved={(record) => setRecords((old) => old.map((r) => r.id === record.id ? record : r))} />
          <PersediaanReportInput key={queryKey} period={period} report={activeReport} disabled={busy || !!exporting || saving} onReport={(r) => { setInventoryReport({ ...r, queryKey }); setValuationNotice(""); }} saveCount={valuationIds.length} onSave={canImportNexa(profile) ? saveValues : null} saving={valuationSaving} />
          {activeReport?.allowReferenceCosts && <PersediaanReportInput key={`${queryKey}/reference`} reference period={period} report={activeReport.references?.[0]} disabled={busy || !!exporting || saving} onReport={(r) => { setInventoryReport((old) => ({ ...old, references: [r] })); setValuationNotice(""); }} />}
          <details><summary style={{ cursor: "pointer", fontSize: 13 }}>Impor sumber untuk beberapa cabang</summary><div style={{ marginTop: 16 }}><NexaBatchImport key={queryKey} profile={profile} period={period} branches={branches} records={records} inventoryReport={activeReport} disabled={busy || !!exporting || saving} onSaving={setImportSaving} onSaved={(record) => setRecords((old) => [...old.filter((r) => r.id !== record.id), record])} /></div></details>
          <NexaRecapImport key={`${queryKey}/${selectedBranch}/${!!profile?.liatSebagai}`} profile={profile} branch={branchOptions.find((b) => b.id === branchId)} period={period} records={records} profiles={profiles} onSaving={setImportSaving} disabled={busy || !!exporting || valuationSaving} inventoryReport={activeReport}
            onSaved={(record) => { setRecords((old) => [...old.filter((r) => r.id !== record.id), record]); }} />
        </div>
        {busy ? <div style={{ color: "var(--text-secondary)" }}>{error ? "Data belum dapat dimuat. Klik Perbarui data untuk mencoba kembali." : "Memuat rekap stock opname…"}</div> : <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
            {[
              ["Berita acara cabang", totals.auditCount], ["Qty kurang (Nexa)", recap.nexaItems.length ? totals.nexaShortageQty : "—"],
              ["Qty lebih (Nexa)", recap.nexaItems.length ? totals.nexaSurplusQty : "—"], [recap.nexaItems.length ? "Nilai selisih Nexa" : "Nilai terisi (BA)", recap.nexaItems.length ? `${rupiah(totals.nexaNetValue)}${totals.nexaUnpriced ? " (sebagian)" : ""}` : stockValueLabel(totals)],
            ].map(([label, value]) => <div key={label} style={panel}><div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>{label}</div><strong style={{ fontSize: 22 }}>{value}</strong></div>)}
          </div>
          <div style={{ ...panel, fontSize: 12, lineHeight: 1.7 }}>
            {recap.nexaItems.length ? <>{totals.nexaValued} dari {totals.nexaValued + totals.nexaUnpriced} barang selisih sudah dihitung. {recap.nexaItems.filter((i) => i.difference !== 0 && i.unitCost === 0).length} baris bernilai buku Rp0 sesuai sumber. {totals.nexaUnpriced > 0 && `${totals.nexaUnpriced} barang selisih belum memiliki harga persediaan yang valid.`} Harga acuan saldo awal/historis ditandai pada rincian.</>
              : <>Belum ada rincian impor Nexa pada cakupan ini. Nilai BA manual belum dihitung otomatis dari persediaan. Impor stok opname dan muat Report Persediaan bulan yang sama untuk mencocokkan kode barang dan menghitung harga × qty selisih. <button className="btn-ghost" onClick={() => setTab("import")}>Buka impor & sumber nilai</button></>}
          </div>
          {!recap.sources.length && <div style={panel}>Belum ada berita acara untuk {periodLabel(period)}{branchId != null ? ` di ${recap.branchName}` : " pada cakupan ini"}. Cabang tanpa BA tetap tercantum pada ringkasan.</div>}
          {(totals.unpriced > 0 || totals.unclassified > 0) && <div style={{ ...panel, fontSize: 12, color: "var(--warning-text, #b07212)" }}>
            {manualDetails.filter((r) => r.value == null).length > 0 && <div>{manualDetails.filter((r) => r.value == null).length} rincian BA manual perlu verifikasi. Alasan ditampilkan pada detail dan PDF. {manualDetails.filter((r) => r.nexaLink).length} rincian manual sudah ditautkan ke Nexa dan tidak dijumlah ulang.</div>}
            {totals.unclassified > 0 && <div>{totals.unclassified} baris memiliki status yang perlu diperiksa.</div>}
          </div>}
          <section hidden={tab !== "summary"} style={panel}>
            <h2 style={{ fontSize: 15, margin: "0 0 16px" }}>Ringkasan {currentBranch?.name || "Cabang"} - {periodLabel(period)}</h2>
            {recap.summaries.map((row) => <div key={row.branchId}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between", fontSize: 12, marginBottom: 16 }}><strong>{row.status}</strong><span style={{ color: "var(--text-secondary)" }}>Audit terakhir: {row.lastAudit ? row.lastAudit.split("-").reverse().join("/") : "Belum ada audit"}</span></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 12 }}>
                {[["Baris diperiksa", row.checked], ["Lengkap", row.complete], ["Baris selisih", row.differenceRows], ["Rincian selisih", row.detailCount], ["Perlu verifikasi nilai", row.unpriced]].map(([label, value]) => <div key={label} style={{ background: "var(--surface-alt)", borderRadius: 8, padding: 14 }}><div style={{ color: "var(--text-secondary)", fontSize: 11, marginBottom: 8 }}>{label}</div><strong style={{ fontSize: 20 }}>{value}</strong></div>)}
              </div>
            </div>)}
          </section>
          {!!categoryRows.length && <section hidden={tab !== "summary"} style={panel}><h2 style={{ fontSize: 15, marginTop: 0 }}>Kategori barang & selisih Nexa</h2><div className="stock-table-scroll"><table className="stock-item-table"><thead><tr>{["Kategori barang", "Kategori selisih", "Baris barang", "Qty selisih", "Nilai terhitung", "Belum bernilai"].map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{categoryRows.map((r) => <tr key={`${r.category}/${r.direction}`}><td>{r.category}</td><td>{r.direction}</td><td>{r.count}</td><td>{r.qty}</td><td>{rupiah(r.value)}{r.unpriced ? " (sebagian)" : ""}</td><td>{r.unpriced}</td></tr>)}</tbody></table></div></section>}
          <section hidden={tab !== "details"} className="stock-card">
            <div className="stock-section-heading"><div><span className="stock-eyebrow">RINCIAN BARANG</span><h2>Stok admin, stok fisik & nilai selisih</h2><p>{activeReport ? `Harga otomatis dari ${activeReport.fileName} · ${activeReport.period}` : "Harga mengikuti sumber persediaan yang tersimpan pada BA. Muat report untuk menghitung ulang."}</p></div><span className="stock-pill">{recap.nexaItems.length} barang</span></div>
            {recap.nexaItems.length ? <StockNexaDetails key={`${period}/${branchId}/${mode}`} items={recap.nexaItems} /> : <div className="stock-empty">Belum ada rincian Excel Nexa pada cakupan ini. <button className="btn-ghost" onClick={() => setTab("import")}>Impor Excel Nexa</button></div>}
          </section>
          <section hidden={tab !== "details" || !manualDetails.length} style={{ ...panel, padding: 0, overflow: "hidden" }}>
            <h2 style={{ fontSize: 15, margin: 0, padding: "18px 20px" }}>Catatan selisih audit manual ({manualDetails.length})</h2>
            <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
              <thead><tr>{["Cabang / Tanggal", "Baris pemeriksaan", "Barang / Acuan BA", "Jumlah", "Harga", "Nilai", "Keterangan"].map((heading) => <th key={heading} style={{ ...cell, background: "var(--surface-alt)" }}>{heading}</th>)}</tr></thead>
              <tbody>{manualDetails.map((row, index) => <tr key={`${row.auditId}-${index}`}>
                <td style={cell}>{row.branch}<div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>{row.auditDate || "Tanggal belum diisi"}</div></td>
                <td style={cell}>{row.item}<div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>{row.group}</div></td>
                <td style={cell}>{stockDetailName(row)}<div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>{row.category}</div><div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 4 }}>{stockDetailNameNote(row)}</div></td>
                <td style={cell}>{row.qty ?? "Perlu verifikasi"}{row.nexaLink && <div style={{ fontSize: 10, marginTop: 4 }}>Admin {row.systemQty} · Fisik {row.countedQty}<br />{row.discrepancyCategory}</div>}{row.qtyAssumed && <div style={{ fontSize: 10, color: "var(--text-faint)" }}>Asumsi 1</div>}</td>
                <td style={cell}>{row.price == null && row.pendingReason ? "Perlu verifikasi" : rupiah(row.price)}</td><td style={cell}>{row.value == null && row.pendingReason ? "Perlu verifikasi" : rupiah(row.value)}{row.excludedFromTotal && <div style={{ fontSize: 10 }}>Sudah dihitung di Nexa</div>}</td><td style={{ ...cell, minWidth: 220, whiteSpace: "pre-wrap" }}>{row.note || "-"}</td>
              </tr>)}{!recap.details.length && <tr><td colSpan={7} style={cell}>Tidak ada selisih pada data yang dipilih.</td></tr>}</tbody>
            </table></div>
          </section>
          <details hidden={tab === "import"} style={panel}><summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Sumber Berita Acara ({totals.auditCount})</summary>
            <div style={{ overflowX: "auto", marginTop: 16 }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Cabang", "Tanggal", "Auditor", "Status", "ID BA sumber"].map((heading) => <th key={heading} style={cell}>{heading}</th>)}</tr></thead>
              <tbody>{recap.sources.map((row) => <tr key={row.id}>{[row.branch, row.auditDate || "Belum diisi", row.auditor, row.status, row.id].map((value, index) => <td key={index} style={cell}>{value}</td>)}</tr>)}</tbody>
            </table></div>
          </details>
          <p style={{ fontSize: 11, color: "var(--text-faint)", lineHeight: 1.6, margin: 0 }}>
            Nilai Nexa = nominal persediaan ÷ qty persediaan × (fisik − admin). Harga acuan saldo awal/historis mencantumkan dasar dan bulan sumber. Nilai buku Rp0 tetap ditampilkan sesuai sumber. Kategori barang mengikuti kode kategori Nexa; kategori selisih berdasarkan perbandingan fisik dan admin. Sumber: {recapModeLabel(mode)}.
          </p>
        </>}
      </div>
    </main>
  );
}
