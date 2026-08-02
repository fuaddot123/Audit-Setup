import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabaseClient";
import { CATS, nowPeriode, periodeLabel, addMonthsToPeriod } from "../../lib/sopConfig";
import { countRusak } from "../AuditInventaris";
import { buildSummaryReportHtml, openPrintWindow } from "../../lib/pdfReportTemplate";
import { sortBranches } from "../../lib/branchOrder";

const BASELINE = 150; // baseline temuan per cabang, sesuai formula yang disepakati

function kategoriInfo(pct) {
  const v = pct * 100;
  if (v >= 90) return { lbl: "Sangat Baik", color: "#1a9e6e" };
  if (v >= 80) return { lbl: "Baik", color: "#2f9e46" };
  if (v >= 70) return { lbl: "Cukup", color: "#b07212" };
  return { lbl: "Perlu Perbaikan", color: "#a32020" };
}

function countSopTemuan(sopRecord) {
  if (!sopRecord) return 0;
  const checks = sopRecord.data?.checks || {};
  let count = 0;
  CATS.forEach((c) => c.items.forEach((_, i) => { if (!checks[c.id + "_" + i]) count++; }));
  return count;
}

function countStokTemuan(stokRecord) {
  // Cuma "Total Barang Plus Minus/Tertukar" yang masuk Persediaan Stok.
  // "Total Bonus Fisik Tidak Ada" (bonus_count) TIDAK dipakai di sini sama
  // sekali -- SOP Aset nanti dihitung terpisah dari Modul Inventaris
  // (belum dibangun), bukan dari field ini.
  if (!stokRecord || stokRecord.data?.tidak_visit) return 0;
  const d = stokRecord.data || {};
  return Number(d.temuan_count) || 0;
}

function keuanganSisa(entry) {
  if (!entry || entry.tidak_visit) return null;
  if (entry.sisa_saldo !== null && entry.sisa_saldo !== undefined && entry.sisa_saldo !== "") {
    return parseFloat(entry.sisa_saldo) || 0;
  }
  return (parseFloat(entry.saldo_sebelumnya) || 0) + (parseFloat(entry.saldo_masuk) || 0) - (parseFloat(entry.pengeluaran) || 0);
}

export default function SopKepatuhan() {
  const [branches, setBranches] = useState([]);
  const [sopRecords, setSopRecords] = useState([]);
  const [stokRecords, setStokRecords] = useState([]);
  const [keuanganEntries, setKeuanganEntries] = useState([]);
  const [inventarisRecords, setInventarisRecords] = useState([]);
  const [period, setPeriod] = useState(nowPeriode());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [brRes, sopRes, stokRes, keuRes, invRes] = await Promise.all([
        supabase.from("branches").select("*").order("name"),
        supabase.from("audit_generic").select("*").eq("module", "sop"),
        supabase.from("audit_generic").select("*").eq("module", "stok_kesehatan"),
        supabase.from("audit_keuangan").select("*"),
        supabase.from("audit_generic").select("*").eq("module", "inventaris"),
      ]);
      if (brRes.error) throw brRes.error;
      setBranches(sortBranches(brRes.data || []));
      setSopRecords(sopRes.data || []);
      setStokRecords(stokRes.data || []);
      setKeuanganEntries(keuRes.data || []);
      setInventarisRecords(invRes.data || []);
    } catch (err) {
      setError("Gagal memuat data: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  function computeForPeriod(p) {
    const rows = branches.map((b) => {
      const sopMatches = sopRecords.filter((r) => r.branch_id === b.id && r.period === p);
      const sopRec = sopMatches.length
        ? [...sopMatches].sort((a, b2) => (b2.data?.audit_date || "").localeCompare(a.data?.audit_date || ""))[0]
        : null;
      const stokMatches = stokRecords.filter((r) => r.branch_id === b.id && r.period === p);
      const stokRec = stokMatches.length
        ? [...stokMatches].sort((a, b2) => (b2.data?.audit_date || "").localeCompare(a.data?.audit_date || ""))[0]
        : null;
      const keuMatches = keuanganEntries.filter((r) => r.branch_id === b.id && r.period === p);
      const keuEntry = keuMatches.length
        ? [...keuMatches].sort((a, b2) => (b2.audit_date || "").localeCompare(a.audit_date || ""))[0]
        : null;
      const invMatches = inventarisRecords.filter((r) => r.branch_id === b.id && r.period === p);
      const invRec = invMatches.length
        ? [...invMatches].sort((a, b2) => (b2.data?.audit_date || "").localeCompare(a.data?.audit_date || ""))[0]
        : null;

      if (!sopRec) return { branch: b, status: "belum" };
      if (sopRec.data?.tidak_visit) return { branch: b, status: "tidak_visit" };

      const sopTemuan = countSopTemuan(sopRec);
      const stokTemuan = countStokTemuan(stokRec);
      const sisa = keuanganSisa(keuEntry);
      const keuanganTemuan = sisa !== null && sisa < 0 ? 1 : 0;
      const asetTemuan = invRec && !invRec.data?.tidak_visit ? countRusak(invRec.data?.categories) : 0;

      const totalTemuan = sopTemuan + stokTemuan + keuanganTemuan + asetTemuan;
      const pct = Math.max(0, 1 - totalTemuan / BASELINE);
      // Cabang Baru: tetap diaudit & dihitung total temuannya, tapi dikecualikan dari rata-rata/skor company-wide
      // (dianggap belum apple-to-apple sama cabang lama). Sumber flag-nya dari record SOP.
      const isCabangBaru = !!sopRec.data?.cabang_baru;

      return { branch: b, status: "audited", sopTemuan, stokTemuan, keuanganTemuan, asetTemuan, totalTemuan, pct, isCabangBaru };
    });

    const visitedRows = rows.filter((r) => r.status === "audited");
    const tidakVisitRows = rows.filter((r) => r.status === "tidak_visit");
    const belumRows = rows.filter((r) => r.status === "belum");
    const cabangBaruRows = visitedRows.filter((r) => r.isCabangBaru);
    const scorableRows = visitedRows.filter((r) => !r.isCabangBaru);
    const avgPct = scorableRows.length ? scorableRows.reduce((s, r) => s + r.pct, 0) / scorableRows.length : null;

    return { rows, visitedRows, tidakVisitRows, belumRows, cabangBaruRows, avgPct };
  }

  const current = useMemo(() => computeForPeriod(period), [branches, sopRecords, stokRecords, keuanganEntries, inventarisRecords, period]);
  const prevPeriod = addMonthsToPeriod(period, -1);
  const prev = useMemo(() => computeForPeriod(prevPeriod), [branches, sopRecords, stokRecords, keuanganEntries, inventarisRecords, prevPeriod]);

  const totalTemuanNow = current.visitedRows.reduce((s, r) => s + r.totalTemuan, 0);
  const totalTemuanPrev = prev.visitedRows.reduce((s, r) => s + r.totalTemuan, 0);

  const temuanBerulang = current.visitedRows.reduce((s, r) => s + r.sopTemuan, 0);

  if (loading) return <div style={{ padding: 40, color: "var(--text-secondary)" }}>Memuat\u2026</div>;

  const companyInfo = current.avgPct !== null ? kategoriInfo(current.avgPct) : null;

  function exportPDF() {
    const now = new Date();
    const printedAtLabel = now.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" }) + ", " + now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
    const BARU_COLOR = "#F4B740";

    const catGroup = { "Sangat Baik": 0, "Baik": 0, "Cukup": 0, "Perlu Perbaikan": 0 };
    const catColor = { "Sangat Baik": "#1a9e6e", "Baik": "#2f9e46", "Cukup": "#b07212", "Perlu Perbaikan": "#a32020" };
    const scorableRows = current.visitedRows.filter((r) => !r.isCabangBaru);
    scorableRows.forEach((r) => { catGroup[kategoriInfo(r.pct).lbl]++; });
    const countBaru = current.cabangBaruRows.length;

    const tableRows = current.rows.map((r) => {
      if (r.status !== "audited") {
        return { cells: [r.branch.name, null, null, null, null, null, null], badge: { label: r.status === "tidak_visit" ? "Tidak Visit" : "Belum Diaudit", color: "#888" } };
      }
      const info = kategoriInfo(r.pct);
      return {
        cells: [
          r.isCabangBaru ? `\u2b50 ${r.branch.name} (CABANG BARU)` : r.branch.name,
          String(r.sopTemuan), String(r.stokTemuan), String(r.keuanganTemuan), String(r.asetTemuan),
          String(r.totalTemuan), `${Math.round(r.pct * 100)}%`,
        ],
        badge: r.isCabangBaru ? { label: "CABANG BARU", color: BARU_COLOR } : { label: info.lbl, color: info.color },
      };
    });

    const donutSegments = [
      ...Object.entries(catGroup).filter(([, c]) => c > 0).map(([label, count]) => ({ label, count, pct: scorableRows.length ? Math.round((count / scorableRows.length) * 100) : 0, color: catColor[label] })),
      ...(countBaru > 0 ? [{ label: "Cabang Baru", count: countBaru, pct: current.visitedRows.length ? Math.round((countBaru / current.visitedRows.length) * 100) : 0, color: BARU_COLOR }] : []),
    ];

    const html = buildSummaryReportHtml({
      reportTitle: "LAPORAN KEPATUHAN SOP",
      scopeLabel: "SEMUA CABANG",
      periodLabel: periodeLabel(period),
      printedAtLabel,
      summaryCards: [
        { icon: "shieldCheck", label: "SKOR KEPATUHAN", value: current.avgPct !== null ? `${Math.round(current.avgPct * 100)}%` : "\u2014", sub: companyInfo?.lbl || "Belum ada data", color: companyInfo?.color || "#2A1F52" },
        { icon: "alertTriangle", label: "TOTAL TEMUAN", value: String(totalTemuanNow), sub: `Bulan lalu: ${totalTemuanPrev}`, color: "#a32020" },
        { icon: "alertCircle", label: "TEMUAN BERULANG", value: String(temuanBerulang), sub: "SOP Operasional bulan ini", color: temuanBerulang > 0 ? "#a32020" : "#1a9e6e" },
        { icon: "building", label: "CABANG DIAUDIT", value: `${current.visitedRows.length} / ${branches.length}`, sub: `Tidak Visit: ${current.tidakVisitRows.length}`, color: "#2A1F52" },
        ...(countBaru > 0 ? [{ icon: "building", label: "CABANG BARU", value: String(countBaru), sub: "Belum masuk itungan skor", color: BARU_COLOR }] : []),
      ],
      tableHeaders: ["Cabang", "SOP Operasional", "Persediaan Stok", "Keuangan", "Aset", "Total Temuan", "% Skor"],
      tableRows,
      donutSegments,
      donutCenterLines: [String(current.visitedRows.length), "Cabang Audited"],
      legendItems: [
        { icon: "shieldCheck", color: "#1a9e6e", title: "SANGAT BAIK", desc: "\u2265 90% skor kepatuhan" },
        { icon: "shieldCheck", color: "#2f9e46", title: "BAIK", desc: "80\u201389% skor kepatuhan" },
        { icon: "alertCircle", color: "#b07212", title: "CUKUP", desc: "70\u201379% skor kepatuhan" },
        { icon: "alertTriangle", color: "#a32020", title: "PERLU PERBAIKAN", desc: "< 70% skor kepatuhan" },
        ...(countBaru > 0 ? [{ icon: "building", color: BARU_COLOR, title: "CABANG BARU", desc: "Belum ikut dihitung ke skor company-wide" }] : []),
      ],
      summaryList: [
        { icon: "shieldCheck", label: "Cabang Audited", value: `${current.visitedRows.length} / ${branches.length}` },
        { icon: "alertTriangle", label: "Total Temuan Bulan Ini", value: String(totalTemuanNow) },
        { icon: "alertCircle", label: "Total Temuan Bulan Lalu", value: String(totalTemuanPrev) },
        { icon: "wallet", label: "Skor Kepatuhan Company-wide", value: current.avgPct !== null ? `${Math.round(current.avgPct * 100)}%` : "\u2014", strong: true },
      ],
      notes: [
        `Formula: % Skor = 1 \u2212 (Total Temuan \u00f7 ${BASELINE}). Gabungan dari SOP Operasional + Persediaan Stok + Keuangan (saldo minus) + Aset.`,
        "Kategori: \u226590% Sangat Baik \u00b7 80-89% Baik \u00b7 70-79% Cukup \u00b7 <70% Perlu Perbaikan.",
        "Cabang tanpa data Audit SOP bulan ini dianggap Tidak Visit dan dikecualikan dari rata-rata.",
        ...(countBaru > 0 ? [`${countBaru} cabang ditandai "CABANG BARU" \u2014 tetap dihitung & ditampilkan skornya di tabel, tapi dikecualikan dari skor company-wide di atas.`] : []),
      ],
      pageLabel: "Halaman 1 dari 1",
    });
    const opened = openPrintWindow("Laporan Kepatuhan SOP", html);
    if (!opened) setError("Popup diblokir browser. Izinkan popup untuk mencetak PDF.");
  }

  return (
    <div style={{ flex: 1 }}>
      <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Skor Kepatuhan SOP</div>
          <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>Gabungan: SOP Operasional + Persediaan Stok + Keuangan + Aset</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 8, padding: "4px 6px" }}>
            <button className="btn-ghost" onClick={() => setPeriod(addMonthsToPeriod(period, -1))} style={{ padding: "6px 10px" }}>{"<"}</button>
            <div className="mono" style={{ fontWeight: 600, minWidth: 130, textAlign: "center", fontSize: 13.5 }}>{periodeLabel(period)}</div>
            <button className="btn-ghost" onClick={() => setPeriod(addMonthsToPeriod(period, 1))} style={{ padding: "6px 10px" }}>{">"}</button>
          </div>
          <button className="btn" onClick={exportPDF}>Export PDF</button>
        </div>
      </div>

      {error && <div style={{ margin: "14px 28px 0", background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}

      <div style={{ padding: 24 }}>
        {/* Ringkasan company-wide */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14, marginBottom: 22 }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: companyInfo?.color || "#888" }} />
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 8 }}>% Skor Kepatuhan (Company-wide)</div>
            <div style={{ fontSize: 30, fontWeight: 800, color: companyInfo?.color || "var(--text-primary)" }}>{current.avgPct !== null ? `${Math.round(current.avgPct * 100)}%` : "\u2014"}</div>
            <div style={{ fontSize: 12, color: companyInfo?.color, fontWeight: 600, marginTop: 4 }}>{companyInfo?.lbl || "Belum ada data"}</div>
          </div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 8 }}>Total Temuan</div>
            <div style={{ fontSize: 30, fontWeight: 800 }}>{totalTemuanNow}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 4 }}>Bulan lalu: {totalTemuanPrev}</div>
          </div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: temuanBerulang > 0 ? "#a32020" : "#1a9e6e" }} />
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 8 }}>Temuan Berulang</div>
            <div style={{ fontSize: 30, fontWeight: 800, color: temuanBerulang > 0 ? "var(--danger-text)" : "var(--text-primary)" }}>{temuanBerulang}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 4 }}>Total SOP Operasional bulan ini</div>
          </div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 8 }}>Cabang Diaudit</div>
            <div style={{ fontSize: 30, fontWeight: 800 }}>{current.visitedRows.length} / {branches.length}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 4 }}>Tidak Visit: {current.tidakVisitRows.length} &middot; Belum Diaudit: {current.belumRows.length}{current.cabangBaruRows.length > 0 && <> &middot; Cabang Baru: {current.cabangBaruRows.length}</>}</div>
          </div>
        </div>

        {/* Tabel per cabang */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--surface-alt)" }}>
                <th style={th}>Cabang</th>
                <th style={{ ...th, textAlign: "center" }}>SOP Operasional</th>
                <th style={{ ...th, textAlign: "center" }}>Persediaan Stok</th>
                <th style={{ ...th, textAlign: "center" }}>Keuangan</th>
                <th style={{ ...th, textAlign: "center" }}>Aset</th>
                <th style={{ ...th, textAlign: "center" }}>Total Temuan</th>
                <th style={{ ...th, textAlign: "center" }}>% Skor</th>
                <th style={{ ...th, textAlign: "center" }}>Kategori</th>
              </tr>
            </thead>
            <tbody>
              {current.rows.map((r) => {
                const info = r.status === "audited" ? kategoriInfo(r.pct) : null;
                return (
                  <tr key={r.branch.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={td}>
                      <b>{r.branch.name}</b>
                      {r.isCabangBaru && (
                        <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, color: "#F4B740", background: "#F4B74022", padding: "2px 7px", borderRadius: 20 }}>Cabang Baru</span>
                      )}
                    </td>
                    {r.status === "audited" ? (
                      <>
                        <td style={{ ...td, textAlign: "center" }} className="mono">{r.sopTemuan}</td>
                        <td style={{ ...td, textAlign: "center" }} className="mono">{r.stokTemuan}</td>
                        <td style={{ ...td, textAlign: "center" }} className="mono">{r.keuanganTemuan}</td>
                        <td style={{ ...td, textAlign: "center" }} className="mono">{r.asetTemuan}</td>
                        <td style={{ ...td, textAlign: "center", fontWeight: 700 }} className="mono">{r.totalTemuan}</td>
                        <td style={{ ...td, textAlign: "center", fontWeight: 800, color: info.color }} className="mono">{Math.round(r.pct * 100)}%</td>
                        <td style={{ ...td, textAlign: "center" }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: info.color, background: `${info.color}22`, padding: "3px 10px", borderRadius: 20 }}>{info.lbl}</span>
                        </td>
                      </>
                    ) : (
                      <td colSpan={7} style={{ ...td, textAlign: "center", color: "var(--text-faint)" }}>
                        {r.status === "tidak_visit" ? "Tidak Visit" : "Belum Diaudit"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 12 }}>
          Formula: % Skor = 1 &minus; (Total Temuan &divide; {BASELINE}). Kategori: &ge;90% Sangat Baik &middot; 80-89% Baik &middot; 70-79% Cukup &middot; &lt;70% Perlu Perbaikan.
          Cabang tanpa data Audit SOP bulan ini dianggap Tidak Visit dan dikecualikan dari rata-rata. Cabang bertanda "Cabang Baru" tetap dihitung & ditampilkan skornya di tabel, tapi ikut dikecualikan dari rata-rata company-wide di atas.
        </div>
      </div>
    </div>
  );
}

const th = { textAlign: "left", padding: "10px 14px", fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.3 };
const td = { padding: "10px 14px" };
