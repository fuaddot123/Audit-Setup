import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabaseClient";
import {
  CATS, TOTAL_ITEMS, ALERT_THRESHOLD, calcWeightedFromRecord, calcTierScores,
  scoreInfo, formatRupiah, nowPeriode, periodeLabel,
} from "../../lib/sopConfig";
import { buildSummaryReportHtml, openPrintWindow } from "../../lib/pdfReportTemplate";
import BranchMultiSelect from "../BranchMultiSelect";

export default function SopLaporan() {
  const [branches, setBranches] = useState([]);
  const [sopRecords, setSopRecords] = useState([]); // semua audit_generic module='sop', semua periode
  const [rankingRows, setRankingRows] = useState([]);
  const [targetRows, setTargetRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [excelPeriod, setExcelPeriod] = useState(nowPeriode());
  const [pdfPeriod, setPdfPeriod] = useState(nowPeriode());
  const [pdfBranchIds, setPdfBranchIds] = useState([]);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [brRes, sopRes, rankRes, tgtRes] = await Promise.all([
        supabase.from("branches").select("*").order("name"),
        supabase.from("audit_generic").select("*").eq("module", "sop").order("updated_at", { ascending: false }),
        supabase.from("ranking_scores").select("*"),
        supabase.from("sales_targets").select("*"),
      ]);
      if (brRes.error) throw brRes.error;
      if (sopRes.error) throw sopRes.error;
      setBranches(brRes.data || []);
      setPdfBranchIds((brRes.data || []).map((b) => b.id));
      setSopRecords(sopRes.data || []);
      setRankingRows(rankRes.data || []);
      setTargetRows(tgtRes.data || []);
    } catch (err) {
      setError("Gagal memuat data: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  const periodOptions = useMemo(() => {
    const set = new Set([nowPeriode()]);
    sopRecords.forEach((r) => set.add(r.period));
    return [...set].filter(Boolean).sort().reverse();
  }, [sopRecords]);

  function latestFor(branchId, period) {
    return sopRecords.find((r) => r.branch_id === branchId && r.period === period) || null;
  }

  // ── EXCEL: laporan 1 periode ──
  async function exportExcel() {
    setBusy(true);
    setError(null);
    try {
      const XLSX = await import("xlsx");
      const rows = [];
      const noteRows = [];

      branches.forEach((b) => {
        const rec = latestFor(b.id, excelPeriod);
        const rk = rankingRows.find((r) => r.branch_id === b.id && r.periode === excelPeriod);
        const tg = targetRows.find((r) => r.branch_id === b.id && r.periode === excelPeriod);
        const target = tg?.target_amount || 0;
        const sales = rk?.sales_actual || 0;
        const ach = sales && target ? Math.round((sales / target) * 100) : null;

        const entry = {
          Cabang: b.name,
          Periode: periodeLabel(excelPeriod),
          "Target Sales": target ? formatRupiah(target) : "\u2014",
          "Sales Aktual": sales ? formatRupiah(sales) : "\u2014",
          "Achievement %": ach !== null ? ach + "%" : "\u2014",
          "CX Score": rk?.cx_score || "\u2014",
          "Happiness Index": rk?.hi_score || "\u2014",
        };

        if (!rec) {
          entry["Tanggal Audit"] = "\u2014";
          entry["SOP %"] = "\u2014";
          entry["Status"] = "Belum diaudit";
        } else {
          const w = calcWeightedFromRecord(rec.data);
          const s = scoreInfo(w);
          entry["Tanggal Audit"] = formatDate(rec.data?.audit_date);
          entry["SOP %"] = w + "%";
          entry["Auditor"] = rec.data?.auditor_name || "\u2014";
          entry["Status"] = s.lbl;
          if (rec.data?.cats) {
            CATS.forEach((c) => {
              const bd = rec.data.cats[c.id];
              entry["SOP " + c.label] = bd ? `${bd.score}/${bd.total}` : "\u2014";
            });
          }
          if (rec.data?.notes) {
            Object.entries(rec.data.notes).forEach(([key, note]) => {
              if (!note) return;
              const idx = key.lastIndexOf("_");
              const catId = key.slice(0, idx);
              const itemIdx = parseInt(key.slice(idx + 1), 10);
              const cat = CATS.find((c) => c.id === catId);
              noteRows.push({
                Cabang: b.name,
                Periode: periodeLabel(excelPeriod),
                "Tanggal Audit": formatDate(rec.data?.audit_date),
                Kategori: cat?.label || "\u2014",
                "Poin Checklist": cat?.items?.[itemIdx] || "\u2014",
                Keterangan: note,
                Auditor: rec.data?.auditor_name || "\u2014",
              });
            });
          }
        }
        rows.push(entry);
      });

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Laporan");
      if (noteRows.length) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(noteRows), "Keterangan Tidak Sesuai");
      }
      XLSX.writeFile(wb, `KLA_Audit_SOP_${periodeLabel(excelPeriod).replace(/\s+/g, "_")}.xlsx`);
    } catch (err) {
      setError("Gagal export Excel: " + err.message + (err.message?.includes("Cannot find module") ? " \u2014 jalankan `npm install xlsx` dulu di project kamu." : ""));
    } finally {
      setBusy(false);
    }
  }

  // ── EXCEL: seluruh riwayat semua periode ──
  async function exportAllHistory() {
    setBusy(true);
    setError(null);
    try {
      const XLSX = await import("xlsx");
      const rows = [];
      sopRecords.forEach((rec) => {
        const b = branches.find((x) => x.id === rec.branch_id);
        if (!b) return;
        const w = calcWeightedFromRecord(rec.data);
        const s = scoreInfo(w);
        rows.push({
          Cabang: b.name,
          "Periode Audit": periodeLabel(rec.period),
          "Audit Period": rec.period,
          "Tanggal Audit": formatDate(rec.data?.audit_date),
          "SOP %": w + "%",
          Poin: (rec.data?.done ?? "\u2014") + "/" + TOTAL_ITEMS,
          Status: s.lbl,
          Auditor: rec.data?.auditor_name || "\u2014",
        });
      });
      if (!rows.length) { setError("Belum ada data audit sama sekali."); setBusy(false); return; }
      rows.sort((a, b) => a.Cabang.localeCompare(b.Cabang, "id"));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Seluruh Riwayat");
      XLSX.writeFile(wb, "KLA_Audit_SOP_Semua_Riwayat.xlsx");
    } catch (err) {
      setError("Gagal export: " + err.message);
    } finally {
      setBusy(false);
    }
  }

  // ── PDF: buka jendela cetak berisi ringkasan eksekutif + lampiran checklist ──
  function exportPDF() {
    setError(null);
    const targets = branches.filter((b) => pdfBranchIds.includes(b.id) && latestFor(b.id, pdfPeriod));

    if (!targets.length) { setError("Tidak ada cabang dengan data audit pada periode ini."); return; }

    const pagesHtml = targets.map((b) => {
      const rec = latestFor(b.id, pdfPeriod);
      if (!rec) return "";
      const w = calcWeightedFromRecord(rec.data);
      const s = scoreInfo(w);
      const tiers = calcTierScores(rec.data);
      return buildBranchPageHtml(b, rec, w, s, tiers);
    }).join("");

    const win = window.open("", "_blank");
    if (!win) { setError("Popup diblokir browser. Izinkan popup untuk mencetak PDF."); return; }
    win.document.write(`<!DOCTYPE html><html><head><title>Laporan Audit SOP</title><meta charset="utf-8">
      <style>
        * { box-sizing: border-box; }
        body { font-family: Arial, Helvetica, sans-serif; color: #222; margin: 0; }
        .page { padding: 28px 34px; page-break-after: always; }
        .hdr { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #2A1F52; padding-bottom: 10px; margin-bottom: 14px; }
        .hdr .co { font-weight: 800; font-size: 14px; color: #2A1F52; }
        .hdr .sub { font-size: 9px; color: #888; }
        .hdr .per { text-align: right; font-size: 11px; color: #2A1F52; font-weight: 700; }
        .title { font-size: 16px; font-weight: 800; margin-bottom: 10px; color: #2A1F52; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin-bottom: 14px; font-size: 11px; }
        .info-grid span { color: #888; display: block; font-size: 9px; }
        .scores { display: flex; gap: 10px; margin-bottom: 16px; }
        .sbox { flex: 1; border: 1px solid #ddd; border-radius: 6px; padding: 10px; text-align: center; }
        .sbox .l { font-size: 9px; color: #888; text-transform: uppercase; }
        .sbox .v { font-size: 20px; font-weight: 800; }
        .alert { background: #fdecea; color: #a32020; padding: 8px 12px; border-radius: 6px; font-size: 11px; font-weight: 700; margin-bottom: 14px; }
        .sect { font-size: 12px; font-weight: 800; color: #2A1F52; margin: 14px 0 6px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
        table.ptbl { width: 100%; border-collapse: collapse; font-size: 9.5px; margin-bottom: 10px; }
        table.ptbl th { background: #f5f3fa; text-align: left; padding: 5px 7px; }
        table.ptbl td { padding: 4px 7px; border-bottom: 1px solid #eee; vertical-align: top; }
        .cat-head { padding: 5px 8px; color: #fff; font-size: 10px; font-weight: 700; display: flex; justify-content: space-between; margin-top: 8px; border-radius: 4px 4px 0 0; }
        .footer { font-size: 8.5px; color: #999; display: flex; justify-content: space-between; margin-top: 18px; border-top: 1px solid #eee; padding-top: 6px; }
        @media print { .page { padding: 14px 20px; } }
      </style></head><body>${pagesHtml}
      <script>window.onload = () => setTimeout(() => window.print(), 300);<\/script>
      </body></html>`);
    win.document.close();
  }

  // ── PDF RINGKASAN: gaya "Laporan Audit Kas Kecil" (header ungu-emas, kartu, tabel, donut) ──
  function exportSummaryPDF() {
    setError(null);
    const now = new Date();
    const printedAtLabel = now.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" }) + ", " + now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
    const scopeBranches = branches.filter((b) => pdfBranchIds.includes(b.id));
    if (!scopeBranches.length) { setError("Pilih minimal 1 cabang dulu."); return; }
    const scopeLabel = pdfBranchIds.length === branches.length ? "SEMUA CABANG" : scopeBranches.map((b) => b.name).join(", ").toUpperCase();

    const rowsData = scopeBranches.map((b) => {
      const rec = latestFor(b.id, pdfPeriod);
      if (!rec) return { branch: b, rec: null };
      const w = calcWeightedFromRecord(rec.data);
      const tiers = calcTierScores(rec.data);
      return { branch: b, rec, score: w, tiers, info: scoreInfo(w) };
    });

    const audited = rowsData.filter((r) => r.rec);
    const grouped = { Sempurna: 0, Baik: 0, "Perlu Perbaikan": 0 };
    audited.forEach((r) => { grouped[r.info.lbl] = (grouped[r.info.lbl] || 0) + 1; });
    const total = scopeBranches.length;
    const avgScore = audited.length ? Math.round(audited.reduce((s, r) => s + r.score, 0) / audited.length) : 0;
    let top = null, low = null;
    audited.forEach((r) => {
      if (!top || r.score > top.score) top = r;
      if (!low || r.score < low.score) low = r;
    });

    const colorMap = { Sempurna: "#1a9e6e", Baik: "#b07212", "Perlu Perbaikan": "#a32020" };

    const tableRows = scopeBranches.map((b, i) => {
      const row = rowsData.find((r) => r.branch.id === b.id);
      if (!row.rec) {
        return { cells: [String(i + 1), b.name, null, null, null, null, null, null], badge: null };
      }
      return {
        cells: [
          String(i + 1), b.name,
          formatDate(row.rec.data?.audit_date),
          row.score + "%",
          (row.tiers?.tier1 ?? "\u2014") + "%",
          (row.tiers?.tier2 ?? "\u2014") + "%",
          (row.tiers?.tier3 ?? "\u2014") + "%",
          row.info.lbl,
        ],
        badge: { label: row.info.lbl, color: colorMap[row.info.lbl] },
      };
    });

    const donutSegments = Object.entries(grouped)
      .filter(([, count]) => count > 0)
      .map(([label, count]) => ({ label, count, pct: audited.length ? Math.round((count / audited.length) * 100) : 0, color: colorMap[label] }));

    const html = buildSummaryReportHtml({
      reportTitle: "LAPORAN AUDIT SOP",
      scopeLabel,
      periodLabel: periodeLabel(pdfPeriod),
      printedAtLabel,
      summaryCards: [
        { icon: "building", label: "TOTAL CABANG", value: String(total), sub: "Cabang", color: "#2A1F52" },
        { icon: "shieldCheck", label: "SEMPURNA", value: String(grouped.Sempurna), sub: `Cabang (${audited.length ? Math.round((grouped.Sempurna / audited.length) * 100) : 0}%)`, color: "#1a9e6e" },
        { icon: "alertCircle", label: "BAIK", value: String(grouped.Baik), sub: `Cabang (${audited.length ? Math.round((grouped.Baik / audited.length) * 100) : 0}%)`, color: "#b07212" },
        { icon: "alertTriangle", label: "PERLU PERBAIKAN", value: String(grouped["Perlu Perbaikan"]), sub: `Cabang (${audited.length ? Math.round((grouped["Perlu Perbaikan"] / audited.length) * 100) : 0}%)`, color: "#a32020" },
      ],
      tableHeaders: ["No", "Cabang", "Tanggal Audit", "Skor SOP", "Tier 1", "Tier 2", "Tier 3", "Status"],
      tableRows,
      donutSegments,
      donutCenterLines: [String(total), "Cabang"],
      legendItems: [
        { icon: "shieldCheck", color: "#1a9e6e", title: "SEMPURNA", desc: "Skor SOP \u2265 90%" },
        { icon: "alertCircle", color: "#b07212", title: "BAIK", desc: `Skor SOP ${ALERT_THRESHOLD}% s.d. 89%` },
        { icon: "alertTriangle", color: "#a32020", title: "PERLU PERBAIKAN", desc: `Skor SOP < ${ALERT_THRESHOLD}%` },
      ],
      summaryList: [
        { icon: "shieldCheck", label: "Cabang Sudah Diaudit", value: `${audited.length} / ${total}` },
        { icon: "alertCircle", label: "Rata-rata Skor SOP", value: avgScore + "%" },
        { icon: "arrowUp", label: "Skor Tertinggi", value: top ? `${top.branch.name} (${top.score}%)` : "\u2014" },
        { icon: "arrowDown", label: "Skor Terendah", value: low ? `${low.branch.name} (${low.score}%)` : "\u2014", strong: true },
      ],
      notes: [
        "Laporan ini merupakan ringkasan hasil audit SOP untuk seluruh cabang pada periode yang dipilih.",
        "Status indikator berdasarkan skor tertimbang checklist SOP (Tier 1: Customer Experience, Tier 2: Operasional, Tier 3: Compliance).",
        `Harap lakukan tindak lanjut untuk cabang dengan indikator "Perlu Perbaikan".`,
      ],
      pageLabel: "Halaman 1 dari 1",
    });

    const opened = openPrintWindow("Laporan Audit SOP", html);
    if (!opened) setError("Popup diblokir browser. Izinkan popup untuk mencetak PDF.");
  }



  return (
    <div style={{ flex: 1 }}>
      <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)" }}>
        <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Laporan Audit</div>
        <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>Export hasil audit SOP ke Excel atau cetak PDF per cabang</div>
      </div>

      {error && <div style={{ margin: "14px 28px 0", background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}

      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
        <ReportCard title="Export Excel Bulanan" desc="Berisi audit SOP, skor Sales/CX/HI, dan catatan poin yang tidak sesuai untuk 1 periode.">
          <Row label="Periode">
            <select className="input" value={excelPeriod} onChange={(e) => setExcelPeriod(e.target.value)}>
              {periodOptions.map((p) => <option key={p} value={p}>{periodeLabel(p)}</option>)}
            </select>
          </Row>
          <button className="btn" disabled={busy} onClick={exportExcel}>{busy ? "Memproses\u2026" : "Download Excel (.xlsx)"}</button>
        </ReportCard>

        <ReportCard title="Export PDF Audit" desc="Ringkasan eksekutif + lampiran checklist lengkap, siap dicetak/disimpan sebagai PDF lewat dialog print browser.">
          <Row label="Periode">
            <select className="input" value={pdfPeriod} onChange={(e) => setPdfPeriod(e.target.value)}>
              {periodOptions.map((p) => <option key={p} value={p}>{periodeLabel(p)}</option>)}
            </select>
          </Row>
          <Row label="Cabang">
            <BranchMultiSelect branches={branches} selectedIds={pdfBranchIds} onChange={setPdfBranchIds} />
          </Row>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={exportPDF}>Cetak Detail per Cabang</button>
            <button className="btn-ghost" onClick={exportSummaryPDF}>Cetak Ringkasan Semua Cabang</button>
          </div>
        </ReportCard>

        <ReportCard title="Export Semua Riwayat" desc="Seluruh riwayat audit SOP dari semua periode dan cabang, dalam satu file.">
          <button className="btn-ghost" disabled={busy} onClick={exportAllHistory}>{busy ? "Memproses\u2026" : "Download Semua Riwayat"}</button>
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

function formatDate(v) {
  if (!v) return "\u2014";
  return new Date(v + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function buildBranchPageHtml(branch, rec, weightedScore, statusInfo, tiers) {
  const printDate = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
  const catRows = CATS.map((c) => {
    const bd = rec.data?.cats?.[c.id];
    if (!bd) return "";
    const pct = Math.round(((bd.score || 0) / (bd.total || 1)) * 100);
    const rows = c.items.map((item, i) => {
      const key = c.id + "_" + i;
      const checks = rec.data?.checks || {};
      const isOk = Object.keys(checks).length ? !!checks[key] : true;
      const note = rec.data?.notes?.[key] || "";
      const photo = rec.data?.photos?.[key] || "";
      return `<tr style="${isOk ? "" : "background:#fff7f7;"}">
        <td style="width:22px;text-align:center;font-weight:900;color:${isOk ? "#1a9e6e" : "#a32020"}">${isOk ? "&#10003;" : "&#10007;"}</td>
        <td style="${isOk ? "" : "color:#a32020;font-weight:700;"}">${esc(item)}</td>
        <td style="width:26%;font-size:9px;color:#7a5800;font-style:italic;">${note ? esc(note) : "\u2014"}</td>
        <td style="width:60px;text-align:center;">${photo ? `<img src="${esc(photo)}" style="width:50px;height:50px;object-fit:cover;border-radius:4px;border:1px solid #ddd;" />` : "\u2014"}</td>
      </tr>`;
    }).join("");
    return `<div class="cat-head" style="background:${c.color}"><span>${esc(c.label)}</span><span>${bd.score}/${bd.total} \u2014 ${pct}%</span></div>
      <table class="ptbl"><thead><tr><th style="width:22px;">Status</th><th>Checklist</th><th>Catatan</th><th>Foto</th></tr></thead><tbody>${rows}</tbody></table>`;
  }).join("");

  return `<div class="page">
    <div class="hdr">
      <div><div class="co">PT. KLA Teknologi Indonesia</div><div class="sub">Audit Management System &mdash; Laporan Audit SOP</div></div>
      <div class="per">${esc(periodeLabel(rec.period))}<br><span style="font-size:9px;color:#999;font-weight:400;">Dicetak: ${printDate}</span></div>
    </div>
    <div class="title">LAPORAN AUDIT SOP &mdash; ${esc(branch.name)}</div>
    <div class="info-grid">
      <div><span>Cabang</span><strong>${esc(branch.name)}</strong></div>
      <div><span>Periode Audit</span><strong>${esc(periodeLabel(rec.period))}</strong></div>
      <div><span>Tanggal Audit</span><strong>${formatDate(rec.data?.audit_date)}</strong></div>
      <div><span>Auditor</span><strong>${esc(rec.data?.auditor_name || "\u2014")}</strong></div>
    </div>
    <div class="scores">
      <div class="sbox"><div class="l">SOP Audit</div><div class="v" style="color:${statusInfo.color}">${weightedScore}%</div><div style="font-size:9px;color:${statusInfo.color}">${esc(statusInfo.lbl)}</div></div>
      <div class="sbox"><div class="l">Tier 1</div><div class="v" style="color:#7c3aed">${tiers?.tier1 ?? "\u2014"}%</div><div style="font-size:9px;color:#999">Customer Experience</div></div>
      <div class="sbox"><div class="l">Tier 2</div><div class="v" style="color:#b07212">${tiers?.tier2 ?? "\u2014"}%</div><div style="font-size:9px;color:#999">Operational</div></div>
      <div class="sbox"><div class="l">Tier 3</div><div class="v" style="color:#1a9e6e">${tiers?.tier3 ?? "\u2014"}%</div><div style="font-size:9px;color:#999">Compliance</div></div>
    </div>
    ${weightedScore < ALERT_THRESHOLD ? `<div class="alert">Total skor SOP di bawah ${ALERT_THRESHOLD}% &mdash; perlu tindakan korektif.</div>` : ""}
    <div class="sect">Lampiran Checklist Lengkap</div>
    ${catRows}
    <div class="footer"><span>PT. KLA Teknologi Indonesia &bull; Confidential</span><span>${esc(branch.name)} &bull; ${esc(periodeLabel(rec.period))}</span></div>
  </div>`;
}
