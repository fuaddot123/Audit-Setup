import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { sortBranches } from "../lib/branchOrder";
import { buildStockRecap, ISOLATION_START_PERIOD, periodLabel, recapDocumentNumber, recapModeLabel, rupiah } from "../lib/stockOpnameRecap";
import { createRecapPdf, createRecapWorkbook } from "../lib/stockOpnameRecapExport";

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
  const [selectedBranch, setSelectedBranch] = useState("all");
  const [branches, setBranches] = useState([]);
  const [records, setRecords] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(null);
  const [generatedFor, setGeneratedFor] = useState("");
  const [loadedFor, setLoadedFor] = useState("");
  const [revision, setRevision] = useState(0);
  const loadSeq = useRef(0);
  const ownerId = profile?.role === "auditor" && period >= ISOLATION_START_PERIOD ? profile.id : null;
  const queryKey = `${period}|${profile?.id}|${profile?.role}`;
  const branchId = selectedBranch === "all" ? null : Number(selectedBranch);
  const scopeKey = `${queryKey}|${mode}|${branchId ?? "all"}`;
  const isCurrent = loadedFor === queryKey;
  const recap = useMemo(() => buildStockRecap({ branches, records: isCurrent ? records : [], profiles, period, mode, ownerId, branchId }),
    [branches, records, profiles, period, mode, ownerId, branchId, isCurrent]);
  const branchOptions = useMemo(() => {
    const ids = new Set(branches.map((branch) => branch.id));
    return [...branches, ...[...new Set((isCurrent ? records : []).map((record) => record.branch_id))]
      .filter((id) => !ids.has(id)).map((id) => ({ id, name: `Cabang #${id}` }))];
  }, [branches, records, isCurrent]);
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
    setLoading(true); setError(""); setRecords([]); setLoadedFor("");
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
    if (loading || exporting || !isCurrent || !recap.sources.length) return;
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

  const busy = loading || !isCurrent;
  const totals = recap.totals;
  return (
    <main style={{ flex: 1, minWidth: 0 }}>
      <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)" }}>
        <h1 className="display" style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Rekap Stock Opname</h1>
        <div style={{ color: "var(--text-secondary)", fontSize: 12.5, marginTop: 5 }}>Berita acara stock opname per cabang atau gabungan seluruh cabang per bulan, lengkap dengan rincian selisih dan sumber audit.</div>
      </div>
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>
        <section style={panel}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "end" }}>
            <div style={{ fontSize: 12, display: "grid", gap: 7 }}>
              <label htmlFor="stock-recap-period">Periode</label>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button aria-label="Bulan sebelumnya" type="button" className="btn-ghost" disabled={!!exporting} onClick={() => movePeriod(-1)}>&lt;</button>
                <input id="stock-recap-period" aria-label="Periode rekap" className="input" type="month" value={period} disabled={!!exporting}
                  onInput={(e) => changePeriod(e.currentTarget.value)} onChange={(e) => changePeriod(e.target.value)} />
                <button aria-label="Bulan berikutnya" type="button" className="btn-ghost" disabled={!!exporting} onClick={() => movePeriod(1)}>&gt;</button>
              </div>
            </div>
            <label style={{ fontSize: 12, display: "grid", gap: 7 }}>Cabang
              <select aria-label="Cabang rekap" className="input" value={selectedBranch} disabled={busy || !!exporting} onChange={(e) => setSelectedBranch(e.target.value)}>
                <option value="all">Semua cabang (gabungan)</option>
                {branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12, display: "grid", gap: 7 }}>Sumber audit
              <select aria-label="Sumber audit" className="input" value={mode} disabled={!!exporting} onChange={(e) => setMode(e.target.value)}>
                <option value="all">Semua berita acara</option>
                <option value="latest">Audit terakhir per cabang</option>
              </select>
            </label>
            <button className="btn-ghost" disabled={loading || !!exporting} onClick={() => setRevision((value) => value + 1)}>Perbarui data</button>
          </div>
          <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 0 }}>
            {mode === "all" ? "Setiap berita acara pada bulan ini dihitung, termasuk beberapa kunjungan ke cabang yang sama." : "Satu berita acara terbaru per cabang dipakai berdasarkan tanggal audit, lalu waktu dibuat."}
            {branchId != null ? ` Cakupan: ${recap.branchName}.` : " Cakupan: seluruh cabang yang dapat diakses akun ini."}
            {ownerId && " Akun auditor hanya menampilkan data auditnya sendiri sesuai hak akses."}
          </p>
        </section>
        {error && <div role="alert" style={{ ...panel, color: "var(--danger-text)", background: "var(--danger-bg)" }}>{error}</div>}
        <section style={{ ...panel, display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 7 }}>Nomor Berita Acara Rekap</div>
            <strong style={{ fontSize: 13, overflowWrap: "anywhere" }}>{number || "Dibuat saat generate atau ekspor"}</strong>
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 7 }}>Nomor tetap untuk bulan, cabang, dan sumber audit yang sama; PDF dan Excel memakai nomor yang sama.</div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button className="btn-ghost" disabled={busy || !!exporting || !recap.sources.length} onClick={() => setGeneratedFor(scopeKey)}>Generate Nomor BA</button>
            <button className="btn" disabled={busy || !!exporting || !recap.sources.length} onClick={() => exportReport("pdf")}>{exporting === "pdf" ? "Menyiapkan PDF…" : "Export PDF"}</button>
            <button className="btn-ghost" disabled={busy || !!exporting || !recap.sources.length} onClick={() => exportReport("excel")}>{exporting === "excel" ? "Menyiapkan Excel…" : "Export Excel"}</button>
          </div>
        </section>
        {busy ? <div style={{ color: "var(--text-secondary)" }}>{error ? "Data belum dapat dimuat. Klik Perbarui data untuk mencoba kembali." : "Memuat rekap stock opname…"}</div> : <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
            {[
              ["Cabang diperiksa", `${totals.auditedBranches} / ${totals.branches}`], ["Berita acara", totals.auditCount],
              ["Baris selisih", totals.differenceRows], ["Nilai selisih terisi", rupiah(totals.knownValue)],
            ].map(([label, value]) => <div key={label} style={panel}><div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>{label}</div><strong style={{ fontSize: 22 }}>{value}</strong></div>)}
          </div>
          {!recap.sources.length && <div style={panel}>Belum ada berita acara untuk {periodLabel(period)}{branchId != null ? ` di ${recap.branchName}` : " pada cakupan ini"}. Cabang tanpa BA tetap tercantum pada ringkasan.</div>}
          {(totals.unpriced > 0 || totals.unclassified > 0) && <div style={{ ...panel, fontSize: 12, color: "var(--warning-text, #b07212)" }}>
            {totals.unpriced > 0 && <div>{totals.unpriced} rincian belum memiliki harga atau jumlah valid. Nilainya ditampilkan sebagai “Belum diisi”, bukan dianggap nol.</div>}
            {totals.unclassified > 0 && <div>{totals.unclassified} baris memiliki status yang perlu diperiksa.</div>}
          </div>}
          <section style={{ ...panel, padding: 0, overflow: "hidden" }}>
            <h2 style={{ fontSize: 15, margin: 0, padding: "18px 20px" }}>Ringkasan {branchId != null ? recap.branchName : "Cabang"} - {periodLabel(period)}</h2>
            <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", whiteSpace: "nowrap" }}>
              <thead><tr>{["Cabang", "Jumlah BA", "Baris diperiksa", "Lengkap", "Baris selisih", "Rincian selisih", "Nilai terisi", "Belum bernilai", "Status"].map((heading) => <th key={heading} style={{ ...cell, background: "var(--surface-alt)" }}>{heading}</th>)}</tr></thead>
              <tbody>{recap.summaries.map((row) => <tr key={row.branchId}>{[row.branch, row.auditCount, row.checked, row.complete, row.differenceRows, row.detailCount, rupiah(row.knownValue), row.unpriced, row.status].map((value, index) => <td key={index} style={{ ...cell, fontWeight: index === 0 || index === 4 ? 600 : 400 }}>{value}</td>)}</tr>)}</tbody>
              <tfoot><tr>{["TOTAL", totals.auditCount, totals.checked, totals.complete, totals.differenceRows, totals.detailCount, rupiah(totals.knownValue), totals.unpriced, ""].map((value, index) => <td key={index} style={{ ...cell, fontWeight: 700, background: "var(--surface-alt)" }}>{value}</td>)}</tr></tfoot>
            </table></div>
          </section>
          <section style={{ ...panel, padding: 0, overflow: "hidden" }}>
            <h2 style={{ fontSize: 15, margin: 0, padding: "18px 20px" }}>Rincian Selisih ({totals.detailCount})</h2>
            <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1000 }}>
              <thead><tr>{["Cabang / Tanggal", "Baris pemeriksaan", "Barang selisih / Kategori", "Jumlah", "Harga", "Nilai", "Keterangan"].map((heading) => <th key={heading} style={{ ...cell, background: "var(--surface-alt)" }}>{heading}</th>)}</tr></thead>
              <tbody>{recap.details.map((row, index) => <tr key={`${row.auditId}-${index}`}>
                <td style={cell}>{row.branch}<div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>{row.auditDate || "Tanggal belum diisi"}</div></td>
                <td style={cell}>{row.item}<div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>{row.group}</div></td>
                <td style={cell}>{row.missingItem || "Nama barang belum diisi"}<div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>{row.category}</div></td>
                <td style={cell}>{row.qty ?? "Belum valid"}{row.qtyAssumed && <div style={{ fontSize: 10, color: "var(--text-faint)" }}>Asumsi 1</div>}</td>
                <td style={cell}>{rupiah(row.price)}</td><td style={cell}>{rupiah(row.value)}</td><td style={{ ...cell, minWidth: 220, whiteSpace: "pre-wrap" }}>{row.note || "-"}</td>
              </tr>)}{!recap.details.length && <tr><td colSpan={7} style={cell}>Tidak ada selisih pada data yang dipilih.</td></tr>}</tbody>
            </table></div>
          </section>
          <details style={panel}><summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Sumber Berita Acara ({totals.auditCount})</summary>
            <div style={{ overflowX: "auto", marginTop: 16 }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Cabang", "Tanggal", "Auditor", "Status", "ID BA sumber"].map((heading) => <th key={heading} style={cell}>{heading}</th>)}</tr></thead>
              <tbody>{recap.sources.map((row) => <tr key={row.id}>{[row.branch, row.auditDate || "Belum diisi", row.auditor, row.status, row.id].map((value, index) => <td key={index} style={cell}>{value}</td>)}</tr>)}</tbody>
            </table></div>
          </details>
          <p style={{ fontSize: 11, color: "var(--text-faint)", lineHeight: 1.6, margin: 0 }}>
            Nilai selisih mengikuti jumlah × harga yang dicatat pada BA. Jumlah kosong mengikuti form BA: 1. Nilai ini bukan penetapan kerugian atau denda. Sumber yang dipakai: {recapModeLabel(mode)}.
          </p>
        </>}
      </div>
    </main>
  );
}
