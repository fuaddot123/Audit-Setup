import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabaseClient";
import {
  serviceStatusInfo, formatRatioPct, kesehatanStatusInfo, formatKesehatanPct,
  nowPeriode, periodeLabel,
} from "../../lib/stokConfig";
import { buildSummaryReportHtml, openPrintWindow } from "../../lib/pdfReportTemplate";
import BranchMultiSelect from "../BranchMultiSelect";

export default function StokLaporan() {
  const [branches, setBranches] = useState([]);
  const [serviceRecords, setServiceRecords] = useState([]);
  const [kesehatanRecords, setKesehatanRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [servicePeriod, setServicePeriod] = useState(nowPeriode());
  const [kesehatanPeriod, setKesehatanPeriod] = useState(nowPeriode());
  const [serviceBranchIds, setServiceBranchIds] = useState([]);
  const [kesehatanBranchIds, setKesehatanBranchIds] = useState([]);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [brRes, svcRes, kshRes] = await Promise.all([
        supabase.from("branches").select("*").order("name"),
        supabase.from("audit_generic").select("*").eq("module", "stok_service").order("updated_at", { ascending: false }),
        supabase.from("audit_generic").select("*").eq("module", "stok_kesehatan").order("updated_at", { ascending: false }),
      ]);
      if (brRes.error) throw brRes.error;
      setBranches(brRes.data || []);
      setServiceBranchIds((brRes.data || []).map((b) => b.id));
      setKesehatanBranchIds((brRes.data || []).map((b) => b.id));
      setServiceRecords(svcRes.data || []);
      setKesehatanRecords(kshRes.data || []);
    } catch (err) {
      setError("Gagal memuat data: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  const servicePeriodOptions = useMemo(() => {
    const set = new Set([nowPeriode()]);
    serviceRecords.forEach((r) => set.add(r.period));
    return [...set].filter(Boolean).sort().reverse();
  }, [serviceRecords]);

  const kesehatanPeriodOptions = useMemo(() => {
    const set = new Set([nowPeriode()]);
    kesehatanRecords.forEach((r) => set.add(r.period));
    return [...set].filter(Boolean).sort().reverse();
  }, [kesehatanRecords]);

  function latestFor(records, branchId, period) {
    return records.find((r) => r.branch_id === branchId && r.period === period) || null;
  }
  function formatDate(v) {
    if (!v) return "\u2014";
    return new Date(v + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
  }

  // ── SERVICE RATIO: PDF ──
  function exportServicePDF() {
    setError(null);
    const now = new Date();
    const printedAtLabel = now.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" }) + ", " + now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
    const scopeBranches = branches.filter((b) => serviceBranchIds.includes(b.id));
    if (!scopeBranches.length) { setError("Pilih minimal 1 cabang dulu."); return; }
    const scopeLabel = serviceBranchIds.length === branches.length ? "SEMUA CABANG" : scopeBranches.map((b) => b.name).join(", ").toUpperCase();

    const rows = scopeBranches.map((b) => {
      const rec = latestFor(serviceRecords, b.id, servicePeriod);
      if (!rec) return { branch: b, rec: null };
      const status = serviceStatusInfo(rec.data.ratio || 0);
      return { branch: b, rec, status };
    });
    const audited = rows.filter((r) => r.rec);
    if (!audited.length) { setError("Belum ada data Service Ratio pada periode ini."); return; }

    const grouped = { Terkendali: 0, Monitoring: 0, "Perlu Perhatian": 0 };
    audited.forEach((r) => { grouped[r.status.lbl] = (grouped[r.status.lbl] || 0) + 1; });
    const colorMap = { Terkendali: "#1a9e6e", Monitoring: "#b07212", "Perlu Perhatian": "#a32020" };
    const total = scopeBranches.length;

    const tableRows = scopeBranches.map((b, i) => {
      const row = rows.find((r) => r.branch.id === b.id);
      if (!row.rec) return { cells: [String(i + 1), b.name, null, null, null, null, null, null], badge: null };
      const d = row.rec.data;
      return {
        cells: [String(i + 1), b.name, String(d.laptop ?? "\u2014"), String(d.aksesoris ?? "\u2014"), String(d.user ?? "\u2014"), String(d.stok_service ?? "\u2014"), String(d.total_unit_cabang ?? "\u2014"), formatRatioPct(d.ratio || 0)],
        badge: { label: row.status.lbl, color: colorMap[row.status.lbl] },
      };
    });

    const donutSegments = Object.entries(grouped).filter(([, c]) => c > 0).map(([label, count]) => ({ label, count, pct: Math.round((count / audited.length) * 100), color: colorMap[label] }));

    let top = null, low = null;
    audited.forEach((r) => {
      const ratio = r.rec.data.ratio || 0;
      if (!top || ratio < top.ratio) top = { ...r, ratio }; // ratio terbaik = paling kecil
      if (!low || ratio > low.ratio) low = { ...r, ratio };
    });

    const html = buildSummaryReportHtml({
      reportTitle: "LAPORAN SERVICE RATIO",
      scopeLabel,
      periodLabel: periodeLabel(servicePeriod),
      printedAtLabel,
      summaryCards: [
        { icon: "building", label: "TOTAL CABANG", value: String(total), sub: "Cabang", color: "#2A1F52" },
        { icon: "shieldCheck", label: "TERKENDALI", value: String(grouped.Terkendali), sub: `Cabang (${Math.round((grouped.Terkendali / audited.length) * 100)}%)`, color: "#1a9e6e" },
        { icon: "alertCircle", label: "MONITORING", value: String(grouped.Monitoring), sub: `Cabang (${Math.round((grouped.Monitoring / audited.length) * 100)}%)`, color: "#b07212" },
        { icon: "alertTriangle", label: "PERLU PERHATIAN", value: String(grouped["Perlu Perhatian"]), sub: `Cabang (${Math.round((grouped["Perlu Perhatian"] / audited.length) * 100)}%)`, color: "#a32020" },
      ],
      tableHeaders: ["No", "Cabang", "Laptop", "Aksesoris", "User Service", "Stok Service", "Total Unit/Cabang", "% Ratio"],
      tableRows,
      donutSegments,
      donutCenterLines: [String(total), "Cabang"],
      legendItems: [
        { icon: "shieldCheck", color: "#1a9e6e", title: "TERKENDALI", desc: "% Ratio Service \u2264 0,22%" },
        { icon: "alertCircle", color: "#b07212", title: "MONITORING", desc: "% Ratio Service 0,22% s.d. 0,33%" },
        { icon: "alertTriangle", color: "#a32020", title: "PERLU PERHATIAN", desc: "% Ratio Service \u2265 0,33%" },
      ],
      summaryList: [
        { icon: "shieldCheck", label: "Cabang Sudah Diaudit", value: `${audited.length} / ${total}` },
        { icon: "arrowDown", label: "Ratio Terbaik (terkecil)", value: top ? `${top.branch.name} (${formatRatioPct(top.ratio)})` : "\u2014" },
        { icon: "arrowUp", label: "Ratio Terburuk (terbesar)", value: low ? `${low.branch.name} (${formatRatioPct(low.ratio)})` : "\u2014", strong: true },
      ],
      notes: [
        "Laporan ini merupakan ringkasan Service Ratio seluruh cabang pada periode yang dipilih.",
        "% Ratio Service dihitung dari Stok Service dibagi Total Unit per Cabang. Makin kecil ratio, makin baik.",
        `Harap lakukan tindak lanjut untuk cabang dengan indikator "Perlu Perhatian".`,
      ],
      pageLabel: "Halaman 1 dari 1",
    });
    const opened = openPrintWindow("Laporan Service Ratio", html);
    if (!opened) setError("Popup diblokir browser. Izinkan popup untuk mencetak PDF.");
  }

  // ── SERVICE RATIO: Excel ──
  async function exportServiceExcel() {
    setBusy(true);
    setError(null);
    try {
      const XLSX = await import("xlsx");
      const rows = branches.map((b) => {
        const rec = latestFor(serviceRecords, b.id, servicePeriod);
        if (!rec) return { Cabang: b.name, Periode: periodeLabel(servicePeriod), Status: "Belum diaudit" };
        const d = rec.data;
        const status = serviceStatusInfo(d.ratio || 0);
        return {
          Cabang: b.name, Periode: periodeLabel(servicePeriod), "Tanggal Audit": formatDate(d.audit_date),
          Laptop: d.laptop, Aksesoris: d.aksesoris, "User Service": d.user, "Stok Service": d.stok_service,
          "Total Unit/Cabang": d.total_unit_cabang, "% Ratio": formatRatioPct(d.ratio || 0), Indikator: status.lbl,
          Auditor: d.auditor_name || "\u2014",
        };
      });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Service Ratio");
      XLSX.writeFile(wb, `Service_Ratio_${periodeLabel(servicePeriod).replace(/\s+/g, "_")}.xlsx`);
    } catch (err) {
      setError("Gagal export Excel: " + err.message);
    } finally {
      setBusy(false);
    }
  }

  // ── KESEHATAN STOK: PDF ──
  function exportKesehatanPDF() {
    setError(null);
    const now = new Date();
    const printedAtLabel = now.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" }) + ", " + now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
    const scopeBranches = branches.filter((b) => kesehatanBranchIds.includes(b.id));
    if (!scopeBranches.length) { setError("Pilih minimal 1 cabang dulu."); return; }
    const scopeLabel = kesehatanBranchIds.length === branches.length ? "SEMUA CABANG" : scopeBranches.map((b) => b.name).join(", ").toUpperCase();

    const rows = scopeBranches.map((b) => {
      const rec = latestFor(kesehatanRecords, b.id, kesehatanPeriod);
      if (!rec) return { branch: b, rec: null };
      if (rec.data.tidak_visit) return { branch: b, rec, tidakVisit: true };
      const status = kesehatanStatusInfo(rec.data.kesehatan_pct || 0);
      return { branch: b, rec, status };
    });
    const audited = rows.filter((r) => r.rec && !r.tidakVisit);
    if (!audited.length) { setError("Belum ada data Kesehatan Stok pada periode ini."); return; }

    const grouped = { Terkendali: 0, Waspada: 0, Monitoring: 0, "Perlu Perhatian": 0 };
    audited.forEach((r) => { grouped[r.status.lbl] = (grouped[r.status.lbl] || 0) + 1; });
    const colorMap = { Terkendali: "#1a9e6e", Waspada: "#2f9e9e", Monitoring: "#b07212", "Perlu Perhatian": "#a32020" };
    const total = scopeBranches.length;

    const tableRows = scopeBranches.map((b, i) => {
      const row = rows.find((r) => r.branch.id === b.id);
      if (!row.rec) return { cells: [String(i + 1), b.name, null, null, null, null, null], badge: null };
      if (row.tidakVisit) return { cells: [String(i + 1), b.name, "Tidak Visit", "\u2014", "\u2014", "\u2014", "\u2014"], badge: { label: "Tidak Visit", color: "#888" } };
      const d = row.rec.data;
      return {
        cells: [String(i + 1), b.name, String(d.temuan_count ?? "\u2014"), String(d.bonus_count ?? "\u2014"), d.untung_rugi >= 0 ? `Rp ${d.untung_rugi.toLocaleString("id-ID")}` : `-Rp ${Math.abs(d.untung_rugi).toLocaleString("id-ID")}`, String(d.skor_total ?? "\u2014"), formatKesehatanPct(d.kesehatan_pct || 0)],
        badge: { label: row.status.lbl, color: colorMap[row.status.lbl] },
      };
    });

    const donutSegments = Object.entries(grouped).filter(([, c]) => c > 0).map(([label, count]) => ({ label, count, pct: Math.round((count / audited.length) * 100), color: colorMap[label] }));

    let top = null, low = null;
    audited.forEach((r) => {
      const pct = r.rec.data.kesehatan_pct || 0;
      if (!top || pct > top.pct) top = { ...r, pct };
      if (!low || pct < low.pct) low = { ...r, pct };
    });

    const html = buildSummaryReportHtml({
      reportTitle: "LAPORAN KESEHATAN STOK",
      scopeLabel,
      periodLabel: periodeLabel(kesehatanPeriod),
      printedAtLabel,
      summaryCards: [
        { icon: "building", label: "TOTAL CABANG", value: String(total), sub: "Cabang", color: "#2A1F52" },
        { icon: "shieldCheck", label: "TERKENDALI", value: String(grouped.Terkendali), sub: "Cabang", color: "#1a9e6e" },
        { icon: "alertCircle", label: "MONITORING", value: String(grouped.Monitoring), sub: "Cabang", color: "#b07212" },
        { icon: "alertTriangle", label: "PERLU PERHATIAN", value: String(grouped["Perlu Perhatian"]), sub: "Cabang", color: "#a32020" },
      ],
      tableHeaders: ["No", "Cabang", "Temuan", "Bonus Tdk Ada", "Untung/Rugi", "Skor Total", "% Kesehatan"],
      tableRows,
      donutSegments,
      donutCenterLines: [String(total), "Cabang"],
      legendItems: [
        { icon: "shieldCheck", color: "#1a9e6e", title: "TERKENDALI", desc: "\u2265 85% \u2014 pengelolaan sangat baik" },
        { icon: "alertCircle", color: "#2f9e9e", title: "WASPADA", desc: "70\u201384% \u2014 temuan ringan" },
        { icon: "alertCircle", color: "#b07212", title: "MONITORING", desc: "50\u201369% \u2014 temuan signifikan" },
        { icon: "alertTriangle", color: "#a32020", title: "PERLU PERHATIAN", desc: "< 50% \u2014 risiko tinggi" },
      ],
      summaryList: [
        { icon: "shieldCheck", label: "Cabang Sudah Diaudit", value: `${audited.length} / ${total}` },
        { icon: "arrowUp", label: "Kesehatan Terbaik", value: top ? `${top.branch.name} (${formatKesehatanPct(top.pct)})` : "\u2014" },
        { icon: "arrowDown", label: "Kesehatan Terendah", value: low ? `${low.branch.name} (${formatKesehatanPct(low.pct)})` : "\u2014", strong: true },
      ],
      notes: [
        "Laporan ini merupakan ringkasan Kesehatan Stok seluruh cabang pada periode yang dipilih.",
        "% Kesehatan Barang = MAX(0, 1 \u2212 Skor Total/100). Skor Total = Skor Temuan + (Skor Rugi \u00d7 5).",
        `Harap lakukan tindak lanjut untuk cabang dengan indikator "Perlu Perhatian".`,
      ],
      pageLabel: "Halaman 1 dari 1",
    });
    const opened = openPrintWindow("Laporan Kesehatan Stok", html);
    if (!opened) setError("Popup diblokir browser. Izinkan popup untuk mencetak PDF.");
  }

  // ── KESEHATAN STOK: Excel ──
  async function exportKesehatanExcel() {
    setBusy(true);
    setError(null);
    try {
      const XLSX = await import("xlsx");
      const rows = branches.map((b) => {
        const rec = latestFor(kesehatanRecords, b.id, kesehatanPeriod);
        if (!rec) return { Cabang: b.name, Periode: periodeLabel(kesehatanPeriod), Status: "Belum diaudit" };
        if (rec.data.tidak_visit) return { Cabang: b.name, Periode: periodeLabel(kesehatanPeriod), Status: "Tidak Visit" };
        const d = rec.data;
        const status = kesehatanStatusInfo(d.kesehatan_pct || 0);
        return {
          Cabang: b.name, Periode: periodeLabel(kesehatanPeriod), "Tanggal Audit": formatDate(d.audit_date),
          "Total Barang Plus Minus/Tertukar": d.temuan_count, "Total Bonus Fisik Tidak Ada": d.bonus_count,
          "Untung/Rugi": d.untung_rugi, "Skor Temuan": d.skor_temuan, "Skor Rugi": d.skor_rugi, "Skor Total": d.skor_total,
          "% Kesehatan Barang": formatKesehatanPct(d.kesehatan_pct || 0), Indikator: status.lbl, Auditor: d.auditor_name || "\u2014",
        };
      });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Kesehatan Stok");
      XLSX.writeFile(wb, `Kesehatan_Stok_${periodeLabel(kesehatanPeriod).replace(/\s+/g, "_")}.xlsx`);
    } catch (err) {
      setError("Gagal export Excel: " + err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div style={{ padding: 40, color: "var(--text-secondary)" }}>Memuat\u2026</div>;

  return (
    <div style={{ flex: 1 }}>
      <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)" }}>
        <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Laporan Audit Stok</div>
        <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>Export Service Ratio dan Kesehatan Stok, terpisah per sub-modul</div>
      </div>

      {error && <div style={{ margin: "14px 28px 0", background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}

      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
        <ReportCard title="Export Service Ratio" desc="Ringkasan rasio unit service dibanding total unit per cabang.">
          <Row label="Periode">
            <select className="input" value={servicePeriod} onChange={(e) => setServicePeriod(e.target.value)}>
              {servicePeriodOptions.map((p) => <option key={p} value={p}>{periodeLabel(p)}</option>)}
            </select>
          </Row>
          <Row label="Cabang">
            <BranchMultiSelect branches={branches} selectedIds={serviceBranchIds} onChange={setServiceBranchIds} />
          </Row>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={exportServicePDF}>Cetak PDF Ringkasan</button>
            <button className="btn-ghost" disabled={busy} onClick={exportServiceExcel}>{busy ? "Memproses\u2026" : "Download Excel"}</button>
          </div>
        </ReportCard>

        <ReportCard title="Export Kesehatan Stok" desc="Ringkasan skor temuan barang & kerugian per cabang.">
          <Row label="Periode">
            <select className="input" value={kesehatanPeriod} onChange={(e) => setKesehatanPeriod(e.target.value)}>
              {kesehatanPeriodOptions.map((p) => <option key={p} value={p}>{periodeLabel(p)}</option>)}
            </select>
          </Row>
          <Row label="Cabang">
            <BranchMultiSelect branches={branches} selectedIds={kesehatanBranchIds} onChange={setKesehatanBranchIds} />
          </Row>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={exportKesehatanPDF}>Cetak PDF Ringkasan</button>
            <button className="btn-ghost" disabled={busy} onClick={exportKesehatanExcel}>{busy ? "Memproses\u2026" : "Download Excel"}</button>
          </div>
        </ReportCard>
      </div>
    </div>
  );
}

function ReportCard({ title, desc, children }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 14 }}>{desc}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>{children}</div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <label style={{ fontSize: 12.5, color: "var(--text-secondary)", width: 60 }}>{label}</label>
      {children}
    </div>
  );
}
