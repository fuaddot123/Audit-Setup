import { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";
import { KPI_ITEMS, calcKPI, totalKpiInfo, fmtPct, nowPeriode, periodeLabel, addMonthsToPeriod } from "../lib/kpiConfig";
import { buildSummaryReportHtml, openPrintWindow } from "../lib/pdfReportTemplate";

const EMPTY_FORM = { coverage: "", kepatuhan_sop: "", temuan_berulang: "", temuan_audit: "", ketepatan_laporan: "" };

export default function AuditKPI({ profile }) {
  const [auditors, setAuditors] = useState([]);
  const [loadingAuditors, setLoadingAuditors] = useState(true);
  const [selectedAuditor, setSelectedAuditor] = useState(null);
  const [period, setPeriod] = useState(nowPeriode());
  const [form, setForm] = useState(EMPTY_FORM);
  const [history, setHistory] = useState([]);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const canEdit = profile?.role === "auditor" || profile?.role === "super_admin";
  const [allRecords, setAllRecords] = useState([]);
  const [exportPeriod, setExportPeriod] = useState(nowPeriode());
  const [exportBusy, setExportBusy] = useState(false);

  useEffect(() => { loadAuditors(); loadAllRecords(); }, []);
  useEffect(() => { if (selectedAuditor) loadAuditorData(selectedAuditor.id); }, [selectedAuditor]);
  useEffect(() => { if (selectedAuditor) applyPeriod(period); }, [period, history]);

  async function loadAllRecords() {
    const { data, error: err } = await supabase.from("audit_kpi").select("*").order("period", { ascending: false });
    if (!err) setAllRecords(data || []);
  }

  const exportPeriodOptions = useMemo(() => {
    const set = new Set([nowPeriode(), exportPeriod]);
    allRecords.forEach((r) => set.add(r.period));
    return [...set].filter(Boolean).sort().reverse();
  }, [allRecords, exportPeriod]);

  function exportPdfLaporan() {
    setError(null);
    const now = new Date();
    const printedAtLabel = now.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" }) + ", " + now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

    const rows = auditors.map((a) => {
      const rec = allRecords.find((r) => r.auditor_id === a.id && r.period === exportPeriod);
      if (!rec) return { auditor: a, rec: null };
      const calc = calcKPI({
        coverage: rec.realisasi_coverage, kepatuhan_sop: rec.realisasi_kepatuhan_sop,
        temuan_berulang: rec.realisasi_temuan_berulang, temuan_audit: rec.realisasi_temuan_audit,
        ketepatan_laporan: rec.realisasi_ketepatan_laporan,
      });
      return { auditor: a, rec, calc, info: totalKpiInfo(calc.total) };
    });
    const audited = rows.filter((r) => r.rec);
    if (!audited.length) { setError("Belum ada data KPI pada periode ini."); return; }

    const grouped = { Tercapai: 0, "Mendekati Target": 0, "Di Bawah Target": 0 };
    audited.forEach((r) => { grouped[r.info.lbl] = (grouped[r.info.lbl] || 0) + 1; });
    const colorMap = { Tercapai: "#1a9e6e", "Mendekati Target": "#b07212", "Di Bawah Target": "#a32020" };
    const total = auditors.length;

    const tableRows = auditors.map((a, i) => {
      const row = rows.find((r) => r.auditor.id === a.id);
      if (!row.rec) return { cells: [String(i + 1), a.full_name || "\u2026", null, null, null, null, null, null], badge: null };
      const c = row.calc;
      return {
        cells: [
          String(i + 1), a.full_name || "\u2026",
          fmtPct(c.results.coverage.hasil), fmtPct(c.results.kepatuhan_sop.hasil), fmtPct(c.results.temuan_berulang.hasil),
          fmtPct(c.results.temuan_audit.hasil), fmtPct(c.results.ketepatan_laporan.hasil), fmtPct(c.total),
        ],
        badge: { label: row.info.lbl, color: colorMap[row.info.lbl] },
      };
    });

    const donutSegments = Object.entries(grouped).filter(([, c]) => c > 0).map(([label, count]) => ({ label, count, pct: Math.round((count / audited.length) * 100), color: colorMap[label] }));

    let top = null, low = null;
    audited.forEach((r) => {
      if (!top || r.calc.total > top.calc.total) top = r;
      if (!low || r.calc.total < low.calc.total) low = r;
    });

    const html = buildSummaryReportHtml({
      reportTitle: "LAPORAN KPI AUDIT INTERNAL",
      scopeLabel: "SEMUA AUDITOR",
      periodLabel: periodeLabel(exportPeriod),
      printedAtLabel,
      summaryCards: [
        { icon: "building", label: "TOTAL AUDITOR", value: String(total), sub: "Orang", color: "#2A1F52" },
        { icon: "shieldCheck", label: "TERCAPAI", value: String(grouped.Tercapai), sub: "Auditor", color: "#1a9e6e" },
        { icon: "alertCircle", label: "MENDEKATI TARGET", value: String(grouped["Mendekati Target"]), sub: "Auditor", color: "#b07212" },
        { icon: "alertTriangle", label: "DI BAWAH TARGET", value: String(grouped["Di Bawah Target"]), sub: "Auditor", color: "#a32020" },
      ],
      tableHeaders: ["No", "Auditor", "Coverage", "Kepatuhan SOP", "Temuan Berulang", "Temuan Audit", "Ketepatan Laporan", "Total KPI"],
      tableRows,
      donutSegments,
      donutCenterLines: [String(total), "Auditor"],
      legendItems: [
        { icon: "shieldCheck", color: "#1a9e6e", title: "TERCAPAI", desc: "Total KPI \u2265 100%" },
        { icon: "alertCircle", color: "#b07212", title: "MENDEKATI TARGET", desc: "Total KPI 80% s.d. 99%" },
        { icon: "alertTriangle", color: "#a32020", title: "DI BAWAH TARGET", desc: "Total KPI < 80%" },
      ],
      summaryList: [
        { icon: "shieldCheck", label: "Auditor Sudah Input", value: `${audited.length} / ${total}` },
        { icon: "arrowUp", label: "KPI Tertinggi", value: top ? `${top.auditor.full_name} (${fmtPct(top.calc.total)})` : "\u2014" },
        { icon: "arrowDown", label: "KPI Terendah", value: low ? `${low.auditor.full_name} (${fmtPct(low.calc.total)})` : "\u2014", strong: true },
      ],
      notes: [
        "Laporan ini merupakan ringkasan KPI seluruh auditor pada periode yang dipilih.",
        "Total KPI dihitung dari penjumlahan Hasil (Bobot \u00d7 pencapaian) kelima indikator.",
        `Harap tindak lanjuti auditor dengan status "Di Bawah Target".`,
      ],
      pageLabel: "Halaman 1 dari 1",
    });
    const opened = openPrintWindow("Laporan KPI Audit Internal", html);
    if (!opened) setError("Popup diblokir browser. Izinkan popup untuk mencetak PDF.");
  }

  async function exportExcelLaporan() {
    setExportBusy(true);
    setError(null);
    try {
      const XLSX = await import("xlsx");
      const rows = auditors.map((a) => {
        const rec = allRecords.find((r) => r.auditor_id === a.id && r.period === exportPeriod);
        if (!rec) return { Auditor: a.full_name || "\u2026", Periode: periodeLabel(exportPeriod), Status: "Belum diisi" };
        const c = calcKPI({
          coverage: rec.realisasi_coverage, kepatuhan_sop: rec.realisasi_kepatuhan_sop,
          temuan_berulang: rec.realisasi_temuan_berulang, temuan_audit: rec.realisasi_temuan_audit,
          ketepatan_laporan: rec.realisasi_ketepatan_laporan,
        });
        const info = totalKpiInfo(c.total);
        const row = { Auditor: a.full_name || "\u2026", Periode: periodeLabel(exportPeriod) };
        KPI_ITEMS.forEach((item) => {
          row[item.label + " (Realisasi)"] = c.results[item.key].real;
          row[item.label + " (Hasil)"] = fmtPct(c.results[item.key].hasil);
        });
        row["Total KPI"] = fmtPct(c.total);
        row["Status"] = info.lbl;
        return row;
      });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "KPI Audit Internal");
      XLSX.writeFile(wb, `KPI_Audit_Internal_${periodeLabel(exportPeriod).replace(/\s+/g, "_")}.xlsx`);
    } catch (err) {
      setError("Gagal export Excel: " + err.message);
    } finally {
      setExportBusy(false);
    }
  }

  function exportAuditorPDF() {
    if (!selectedAuditor) return;
    setError(null);
    const now = new Date();
    const printedAtLabel = now.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" }) + ", " + now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

    if (!history.length) { setError("Belum ada data KPI untuk auditor ini."); return; }

    const rowsCalc = history.map((row) => {
      const c = calcKPI({
        coverage: row.realisasi_coverage, kepatuhan_sop: row.realisasi_kepatuhan_sop,
        temuan_berulang: row.realisasi_temuan_berulang, temuan_audit: row.realisasi_temuan_audit,
        ketepatan_laporan: row.realisasi_ketepatan_laporan,
      });
      return { row, calc: c, info: totalKpiInfo(c.total) };
    });

    const grouped = { Tercapai: 0, "Mendekati Target": 0, "Di Bawah Target": 0 };
    rowsCalc.forEach((r) => { grouped[r.info.lbl] = (grouped[r.info.lbl] || 0) + 1; });
    const colorMap = { Tercapai: "#1a9e6e", "Mendekati Target": "#b07212", "Di Bawah Target": "#a32020" };

    const tableRows = rowsCalc.map((r) => ({
      cells: [
        periodeLabel(r.row.period),
        fmtPct(r.calc.results.coverage.hasil), fmtPct(r.calc.results.kepatuhan_sop.hasil), fmtPct(r.calc.results.temuan_berulang.hasil),
        fmtPct(r.calc.results.temuan_audit.hasil), fmtPct(r.calc.results.ketepatan_laporan.hasil), fmtPct(r.calc.total),
      ],
      badge: { label: r.info.lbl, color: colorMap[r.info.lbl] },
    }));

    const best = rowsCalc.reduce((a, b) => (!a || b.calc.total > a.calc.total ? b : a), null);
    const worst = rowsCalc.reduce((a, b) => (!a || b.calc.total < a.calc.total ? b : a), null);
    const avgTotal = rowsCalc.reduce((s, r) => s + r.calc.total, 0) / rowsCalc.length;

    const donutSegments = Object.entries(grouped).filter(([, c]) => c > 0).map(([label, count]) => ({ label, count, pct: Math.round((count / rowsCalc.length) * 100), color: colorMap[label] }));

    const html = buildSummaryReportHtml({
      reportTitle: "LAPORAN KPI AUDIT INTERNAL",
      scopeLabel: (selectedAuditor.full_name || "\u2026").toUpperCase(),
      periodLabel: `${rowsCalc.length} periode terakhir`,
      printedAtLabel,
      summaryCards: [
        { icon: "building", label: "TOTAL PERIODE", value: String(rowsCalc.length), sub: "Bulan", color: "#2A1F52" },
        { icon: "shieldCheck", label: "TERCAPAI", value: String(grouped.Tercapai), sub: "Bulan", color: "#1a9e6e" },
        { icon: "alertCircle", label: "MENDEKATI TARGET", value: String(grouped["Mendekati Target"]), sub: "Bulan", color: "#b07212" },
        { icon: "alertTriangle", label: "DI BAWAH TARGET", value: String(grouped["Di Bawah Target"]), sub: "Bulan", color: "#a32020" },
      ],
      tableHeaders: ["Periode", "Coverage", "Kepatuhan SOP", "Temuan Berulang", "Temuan Audit", "Ketepatan Laporan", "Total KPI"],
      tableRows,
      donutSegments,
      donutCenterLines: [String(rowsCalc.length), "Periode"],
      legendItems: [
        { icon: "shieldCheck", color: "#1a9e6e", title: "TERCAPAI", desc: "Total KPI \u2265 100%" },
        { icon: "alertCircle", color: "#b07212", title: "MENDEKATI TARGET", desc: "Total KPI 80% s.d. 99%" },
        { icon: "alertTriangle", color: "#a32020", title: "DI BAWAH TARGET", desc: "Total KPI < 80%" },
      ],
      summaryList: [
        { icon: "shieldCheck", label: "Rata-rata Total KPI", value: fmtPct(avgTotal) },
        { icon: "arrowUp", label: "Bulan Terbaik", value: best ? `${periodeLabel(best.row.period)} (${fmtPct(best.calc.total)})` : "\u2014" },
        { icon: "arrowDown", label: "Bulan Terendah", value: worst ? `${periodeLabel(worst.row.period)} (${fmtPct(worst.calc.total)})` : "\u2014", strong: true },
      ],
      notes: [
        `Laporan ini merupakan riwayat KPI individu atas nama ${selectedAuditor.full_name || "\u2026"}.`,
        "Total KPI dihitung dari penjumlahan Hasil (Bobot \u00d7 pencapaian) kelima indikator tiap bulan.",
      ],
      pageLabel: "Halaman 1 dari 1",
    });
    const opened = openPrintWindow(`Laporan KPI - ${selectedAuditor.full_name || ""}`, html);
    if (!opened) setError("Popup diblokir browser. Izinkan popup untuk mencetak PDF.");
  }

  async function exportAuditorExcel() {
    if (!selectedAuditor) return;
    setExportBusy(true);
    setError(null);
    try {
      const XLSX = await import("xlsx");
      if (!history.length) { setError("Belum ada data KPI untuk auditor ini."); setExportBusy(false); return; }
      const rows = history.map((row) => {
        const c = calcKPI({
          coverage: row.realisasi_coverage, kepatuhan_sop: row.realisasi_kepatuhan_sop,
          temuan_berulang: row.realisasi_temuan_berulang, temuan_audit: row.realisasi_temuan_audit,
          ketepatan_laporan: row.realisasi_ketepatan_laporan,
        });
        const info = totalKpiInfo(c.total);
        const out = { Auditor: selectedAuditor.full_name || "\u2026", Periode: periodeLabel(row.period) };
        KPI_ITEMS.forEach((item) => {
          out[item.label + " (Realisasi)"] = c.results[item.key].real;
          out[item.label + " (Hasil)"] = fmtPct(c.results[item.key].hasil);
        });
        out["Total KPI"] = fmtPct(c.total);
        out["Status"] = info.lbl;
        return out;
      });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Riwayat KPI");
      XLSX.writeFile(wb, `KPI_${(selectedAuditor.full_name || "auditor").replace(/\s+/g, "_")}.xlsx`);
    } catch (err) {
      setError("Gagal export Excel: " + err.message);
    } finally {
      setExportBusy(false);
    }
  }

  async function loadAuditors() {
    setLoadingAuditors(true);
    const { data, error: err } = await supabase.from("profiles").select("*").order("full_name");
    if (!err) setAuditors(data || []);
    setLoadingAuditors(false);
  }

  async function loadAuditorData(auditorId) {
    setLoadingRecord(true);
    setError(null);
    const { data, error: err } = await supabase.from("audit_kpi").select("*").eq("auditor_id", auditorId).order("period", { ascending: false }).limit(12);
    if (!err) setHistory(data || []);
    setLoadingRecord(false);
  }

  function applyPeriod(p) {
    const row = history.find((r) => r.period === p);
    if (row) {
      setForm({
        coverage: row.realisasi_coverage ?? "",
        kepatuhan_sop: row.realisasi_kepatuhan_sop != null ? row.realisasi_kepatuhan_sop * 100 : "",
        temuan_berulang: row.realisasi_temuan_berulang ?? "",
        temuan_audit: row.realisasi_temuan_audit ?? "",
        ketepatan_laporan: row.realisasi_ketepatan_laporan ?? "",
      });
    } else {
      setForm(EMPTY_FORM);
    }
    setSaved(false);
  }

  function pickAuditor(a) {
    setSelectedAuditor(a);
    setPeriod(nowPeriode());
  }

  function backToList() {
    setSelectedAuditor(null);
    setHistory([]);
  }

  function setField(key, val) {
    const cleaned = val.replace(/[^\d.]/g, "");
    setForm((f) => ({ ...f, [key]: cleaned }));
    setSaved(false);
  }

  const { results, total } = calcKPI({ ...form, kepatuhan_sop: (parseFloat(form.kepatuhan_sop) || 0) / 100 });
  const totalInfo = totalKpiInfo(total);

  async function deleteRecord() {
    const existing = history.find((r) => r.period === period);
    if (!existing || profile?.role !== "super_admin") return;
    if (!window.confirm(`Hapus data KPI ${selectedAuditor.full_name} periode ${periodeLabel(period)}? Aksi ini tidak bisa dibatalkan.`)) return;
    setSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase.from("audit_kpi").delete().eq("id", existing.id);
      if (err) throw err;
      setForm(EMPTY_FORM);
      setSaved(false);
      await loadAuditorData(selectedAuditor.id);
    } catch (err) {
      setError("Gagal menghapus: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveRecord() {
    setSaving(true);
    setError(null);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      const payload = {
        auditor_id: selectedAuditor.id,
        period,
        realisasi_coverage: parseFloat(form.coverage) || 0,
        realisasi_kepatuhan_sop: (parseFloat(form.kepatuhan_sop) || 0) / 100,
        realisasi_temuan_berulang: parseFloat(form.temuan_berulang) || 0,
        realisasi_temuan_audit: parseFloat(form.temuan_audit) || 0,
        realisasi_ketepatan_laporan: parseFloat(form.ketepatan_laporan) || 0,
        submitted_by: user.id,
        updated_at: new Date().toISOString(),
      };
      const { error: err } = await supabase.from("audit_kpi").upsert(payload, { onConflict: "auditor_id,period" });
      if (err) throw err;
      setSaved(true);
      await loadAuditorData(selectedAuditor.id);
    } catch (err) {
      setError("Gagal menyimpan: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Tampilan: pilih auditor ──
  if (!selectedAuditor) {
    return (
      <div style={{ flex: 1 }}>
        <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>KPI Audit Internal</div>
            <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>Kinerja tiap auditor, per bulan</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select className="input" style={{ width: 180 }} value={exportPeriod} onChange={(e) => setExportPeriod(e.target.value)}>
              {exportPeriodOptions.map((p) => <option key={p} value={p}>{periodeLabel(p)}</option>)}
            </select>
            <button className="btn" onClick={exportPdfLaporan}>Cetak PDF Laporan</button>
            <button className="btn-ghost" disabled={exportBusy} onClick={exportExcelLaporan}>{exportBusy ? "..." : "Download Excel"}</button>
          </div>
        </div>
        {error && <div style={{ margin: "14px 28px 0", background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}
        <div style={{ padding: 24 }}>
          {loadingAuditors ? (
            <div style={{ color: "var(--text-secondary)" }}>Memuat\u2026</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
              {auditors.map((a) => (
                <div
                  key={a.id}
                  onClick={() => pickAuditor(a)}
                  style={{ position: "relative", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", cursor: "pointer", overflow: "hidden" }}
                >
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, #7c3aed, #F4B740)" }} />
                  <div style={{ fontWeight: 600, fontSize: 14.5 }}>{a.full_name || "\u2026"}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 4 }}>{{ admin: "Admin", auditor: "Auditor", ceo: "CEO", super_admin: "Super Admin" }[a.role] || a.role} &middot; Lihat KPI &rarr;</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Tampilan: form KPI ──
  return (
    <div style={{ flex: 1 }}>
      <div style={{ background: "var(--surface)", padding: "16px 28px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <button className="btn-ghost" style={{ marginBottom: 8, fontSize: 12.5 }} onClick={backToList}>&larr; Pilih auditor lain</button>
            <div className="display" style={{ fontSize: 19, fontWeight: 600 }}>KPI &mdash; {selectedAuditor.full_name}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 8, padding: "4px 6px" }}>
            <button className="btn-ghost" onClick={() => setPeriod(addMonthsToPeriod(period, -1))} style={{ padding: "6px 10px" }}>{"<"}</button>
            <div className="mono" style={{ fontWeight: 600, minWidth: 140, textAlign: "center", fontSize: 13.5 }}>{periodeLabel(period)}</div>
            <button className="btn-ghost" onClick={() => setPeriod(addMonthsToPeriod(period, 1))} style={{ padding: "6px 10px" }}>{">"}</button>
          </div>
        </div>
      </div>

      {error && <div style={{ margin: "14px 28px 0", background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}

      <div style={{ padding: 24, maxWidth: 820 }}>
        {loadingRecord ? (
          <div style={{ color: "var(--text-secondary)" }}>Memuat data\u2026</div>
        ) : (
          <>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", marginBottom: 20 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "var(--surface-alt)" }}>
                    <th style={th}>KPI</th>
                    <th style={{ ...th, textAlign: "center" }}>Bobot</th>
                    <th style={{ ...th, textAlign: "center" }}>Target</th>
                    <th style={{ ...th, textAlign: "center", minWidth: 140 }}>Realisasi</th>
                    <th style={{ ...th, textAlign: "center" }}>% Realisasi</th>
                    <th style={{ ...th, textAlign: "center" }}>Hasil</th>
                  </tr>
                </thead>
                <tbody>
                  {KPI_ITEMS.map((item) => {
                    const r = results[item.key];
                    return (
                      <tr key={item.key} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={td}>
                          <div style={{ fontWeight: 600 }}>{item.label}</div>
                          <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{item.hint}</div>
                        </td>
                        <td style={{ ...td, textAlign: "center" }} className="mono">{(item.bobot * 100).toFixed(0)}%</td>
                        <td style={{ ...td, textAlign: "center" }} className="mono">{item.targetIsPercent ? (item.target * 100).toFixed(0) + "%" : item.target}</td>
                        <td style={{ ...td, textAlign: "center" }}>
                          <input
                            className="input" type="text" inputMode="decimal" placeholder="0" disabled={!canEdit}
                            value={form[item.key]} onChange={(e) => setField(item.key, e.target.value)}
                            style={{ textAlign: "center", padding: "8px 10px", maxWidth: 110 }}
                          />
                        </td>
                        <td style={{ ...td, textAlign: "center" }} className="mono">{fmtPct(r.pctReal)}</td>
                        <td style={{ ...td, textAlign: "center", fontWeight: 700 }} className="mono">{fmtPct(r.hasil)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: "2px solid var(--border)", background: "var(--surface-alt)" }}>
                    <td style={{ ...td, fontWeight: 700 }} colSpan={5}>Total KPI</td>
                    <td style={{ ...td, textAlign: "center", fontWeight: 800, fontSize: 15 }} className="mono">{fmtPct(total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: `${totalInfo.color}22`, border: `1px solid ${totalInfo.color}55`, borderRadius: 12, padding: "14px 18px", marginBottom: 20 }}>
              <div>
                <div style={{ fontWeight: 700, color: totalInfo.color, fontSize: 15 }}>{totalInfo.lbl}</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Total KPI {selectedAuditor.full_name} &middot; {periodeLabel(period)}</div>
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: totalInfo.color }}>{fmtPct(total)}</div>
            </div>

            {canEdit && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 32 }}>
                <button className="btn" disabled={saving} onClick={saveRecord}>{saving ? "Menyimpan\u2026" : "Simpan"}</button>
                {profile?.role === "super_admin" && history.some((r) => r.period === period) && (
                  <button className="btn-ghost" disabled={saving} onClick={deleteRecord} style={{ color: "var(--danger-text)" }}>Hapus Data</button>
                )}
                {saved && <span style={{ color: "var(--success-text)", fontSize: 13 }}>Tersimpan \u2713</span>}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.4 }}>
                Riwayat Total KPI &mdash; {selectedAuditor.full_name}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-ghost" onClick={exportAuditorPDF}>Cetak PDF ({selectedAuditor.full_name})</button>
                <button className="btn-ghost" disabled={exportBusy} onClick={exportAuditorExcel}>{exportBusy ? "..." : "Download Excel"}</button>
              </div>
            </div>
            {history.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-faint)" }}>Belum ada data tersimpan.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {history.map((row) => {
                  const calc = calcKPI({
                    coverage: row.realisasi_coverage, kepatuhan_sop: row.realisasi_kepatuhan_sop,
                    temuan_berulang: row.realisasi_temuan_berulang, temuan_audit: row.realisasi_temuan_audit,
                    ketepatan_laporan: row.realisasi_ketepatan_laporan,
                  });
                  const info = totalKpiInfo(calc.total);
                  return (
                    <div key={row.period} onClick={() => setPeriod(row.period)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 16px", cursor: "pointer" }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{periodeLabel(row.period)}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: info.color, background: `${info.color}22`, padding: "2px 10px", borderRadius: 20 }}>{info.lbl}</span>
                        <span className="mono" style={{ fontWeight: 700, color: info.color }}>{fmtPct(calc.total)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const th = { textAlign: "left", padding: "10px 14px", fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.3 };
const td = { padding: "10px 14px", verticalAlign: "top" };
