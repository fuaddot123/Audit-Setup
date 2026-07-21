import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabaseClient";
import {
  CATS, TOTAL_ITEMS, ALERT_THRESHOLD, calcWeightedFromRecord, calcTierScores,
  scoreInfo, scoreColor, formatRupiah, nowPeriode, periodeLabel,
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

  // ── PDF: buka jendela cetak berisi ringkasan eksekutif + lampiran checklist ──
  function exportPDF() {
    setError(null);
    const targets = branches.filter((b) => pdfBranchIds.includes(b.id) && latestFor(b.id, pdfPeriod) && !latestFor(b.id, pdfPeriod).data?.tidak_visit);

    if (!targets.length) { setError("Tidak ada cabang dengan data audit pada periode ini."); return; }

    const pagesHtml = targets.map((b) => {
      const rec = latestFor(b.id, pdfPeriod);
      if (!rec) return "";
      const w = calcWeightedFromRecord(rec.data);
      const s = scoreInfo(w);
      const tiers = calcTierScores(rec.data);
      return buildExecutiveSummaryHtml(b, rec, w, s, tiers) + buildBranchPageHtml(b, rec, w, s, tiers);
    }).join("");

    const win = window.open("", "_blank");
    if (!win) { setError("Popup diblokir browser. Izinkan popup untuk mencetak PDF."); return; }
    win.document.write(`<!DOCTYPE html><html><head><title>Laporan Audit SOP</title><meta charset="utf-8">
      <style>
        * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        @page { margin: 8mm; }
        body { font-family: Arial, Helvetica, sans-serif; color: #222; margin: 0; }
        .page { padding: 28px 34px; page-break-after: always; }

        /* ── Header umum (dipakai di semua halaman) ── */
        .hdr2 { display: flex; justify-content: space-between; align-items: center; background: linear-gradient(120deg,#2A1F52,#3d2a72); margin: -28px -34px 18px; padding: 18px 34px; border-bottom: 4px solid #F4B740; }
        .hdr2-left { display: flex; align-items: center; gap: 12px; }
        .hdr2-badge { width: 38px; height: 38px; border-radius: 10px; background: #F4B740; color: #2A1F52; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 14px; flex-shrink: 0; }
        .hdr2-co { color: #fff; font-weight: 800; font-size: 13px; }
        .hdr2-sub { color: #cfc7e6; font-size: 8.5px; }
        .hdr2-right { text-align: right; }
        .hdr2-tag { color: #F4B740; font-size: 8.5px; font-weight: 800; letter-spacing: 0.06em; }
        .hdr2-per { color: #fff; font-size: 12px; font-weight: 800; }
        .hdr2-date { color: #cfc7e6; font-size: 8px; }

        .title2 { font-size: 20px; font-weight: 900; color: #2A1F52; margin-bottom: 2px; }
        .subtitle2 { font-size: 10px; color: #999; margin-bottom: 14px; }

        .info-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 10px; }
        .info-box { border: 1px solid #eadfc4; background: #fdfaf1; border-radius: 8px; padding: 9px 12px; }
        .info-box .l { font-size: 7.5px; font-weight: 800; color: #b8860b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 3px; }
        .info-box .v { font-size: 11px; font-weight: 700; color: #2A1F52; }

        .score-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 10px; }
        .score-card { border-radius: 10px; padding: 12px; text-align: center; border: 1px solid; }
        .score-card .l { font-size: 7.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #777; margin-bottom: 4px; }
        .score-card .v { font-size: 22px; font-weight: 900; }
        .score-card .s { font-size: 8px; font-weight: 700; }

        .metric-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
        .metric-card { border-radius: 10px; padding: 11px 12px; border-left: 4px solid; background: #fafafd; }
        .metric-card .l { font-size: 7.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #888; margin-bottom: 3px; }
        .metric-card .v { font-size: 20px; font-weight: 900; color: #2A1F52; }

        .box2 { border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; }
        .box2-title { font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
        .box2 ul { margin: 6px 0 0; padding-left: 16px; font-size: 10px; }
        .box2 li { margin-bottom: 2px; }

        .two-col { display: grid; grid-template-columns: 1.2fr 1fr; gap: 14px; margin-bottom: 14px; }
        table.temuan-tbl { width: 100%; border-collapse: collapse; font-size: 9.5px; }
        table.temuan-tbl thead tr { background: #2A1F52; }
        table.temuan-tbl th { color: #fff; text-align: left; padding: 6px 9px; font-size: 8.5px; }
        table.temuan-tbl td { padding: 6px 9px; border-bottom: 1px solid #f0e5c8; }
        table.temuan-tbl tr:nth-child(even) td { background: #fff8e8; }

        .area-list { border: 1px solid #d3ecdf; background: #f4fbf7; border-radius: 8px; padding: 12px 14px; }
        .area-list-title { font-size: 9px; font-weight: 900; color: #1a9e6e; text-transform: uppercase; margin-bottom: 8px; }
        .area-item { display: flex; align-items: center; gap: 6px; font-size: 10px; margin-bottom: 5px; color: #1a5c3f; }
        .area-item .dot { width: 14px; height: 14px; border-radius: 50%; background: #1a9e6e; color: #fff; font-size: 9px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }

        table.tier-tbl { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-bottom: 14px; }
        table.tier-tbl thead tr { background: #2A1F52; }
        table.tier-tbl th { color: #fff; text-align: left; padding: 8px 12px; font-size: 9px; text-transform: uppercase; }
        table.tier-tbl td { padding: 8px 12px; border-bottom: 1px solid #eee; font-weight: 700; }
        table.tier-tbl tr:nth-child(even) td { background: #f8f6fc; }

        .footer2 { position: absolute; bottom: 22px; left: 34px; right: 34px; font-size: 8px; color: #999; display: flex; justify-content: space-between; border-top: 1px solid #eee; padding-top: 6px; }

        /* ── Lampiran checklist (halaman detail) ── */
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

  // ── Halaman Executive Summary per cabang (halaman pertama, sebelum lampiran checklist) ──
  function buildExecutiveSummaryHtml(branch, rec, weightedScore, statusInfo, tiers) {
    const printDate = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
    const printTime = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
    const inputDate = rec.data?.audit_date ? formatDate(rec.data.audit_date) : "\u2014";

    const catStatus = CATS.map((c) => {
      const bd = rec.data?.cats?.[c.id];
      const pct = bd && bd.total ? Math.round((bd.score / bd.total) * 100) : 0;
      return { cat: c, pct, sempurna: pct === 100 };
    });
    const bermasalah = catStatus.filter((c) => !c.sempurna);
    const sempurna = catStatus.filter((c) => c.sempurna);

    const failedItems = [];
    CATS.forEach((c) => {
      c.items.forEach((text, i) => {
        const key = c.id + "_" + i;
        const checks = rec.data?.checks || {};
        const isOk = Object.keys(checks).length ? !!checks[key] : true;
        if (!isOk) failedItems.push(text);
      });
    });
    const top5 = failedItems.slice(0, 5);

    const kesimpulan = weightedScore >= 90
      ? "Cabang sangat baik dan perlu mempertahankan standar operasional."
      : weightedScore >= ALERT_THRESHOLD
      ? "Cabang cukup baik, namun ada beberapa area yang perlu diperbaiki segera."
      : "Cabang memerlukan perhatian serius dan tindak lanjut mendesak dari manajemen.";

    const tierRows = [
      { label: "Tier 1 \u2014 Customer Experience Excellence", bobot: "60%", skor: tiers?.tier1 },
      { label: "Tier 2 \u2014 Operational Foundation", bobot: "25%", skor: tiers?.tier2 },
      { label: "Tier 3 \u2014 Compliance & Critical", bobot: "15%", skor: tiers?.tier3 },
    ];

    return `<div class="page" style="position:relative;">
      <div class="hdr2">
        <div class="hdr2-left">
          <div class="hdr2-badge">KLA</div>
          <div><div class="hdr2-co">PT. KLA Teknologi Indonesia</div><div class="hdr2-sub">Audit Management System</div></div>
        </div>
        <div class="hdr2-right">
          <div class="hdr2-tag">EXECUTIVE SUMMARY</div>
          <div class="hdr2-per">${esc(periodeLabel(rec.period))}</div>
          <div class="hdr2-date">Dicetak: ${printDate}</div>
        </div>
      </div>

      <div class="title2">LAPORAN AUDIT SOP</div>
      <div class="subtitle2">Ringkasan eksekutif hasil audit checklist SOP cabang</div>

      <div class="info-row">
        <div class="info-box"><div class="l">Cabang</div><div class="v">${esc(branch.name)}</div></div>
        <div class="info-box"><div class="l">Periode Audit</div><div class="v">${esc(periodeLabel(rec.period))}</div></div>
        <div class="info-box"><div class="l">Tanggal Audit</div><div class="v">${inputDate}</div></div>
        <div class="info-box"><div class="l">Auditor</div><div class="v" style="font-size:9.5px;">${esc(rec.data?.auditor_name || "\u2014")}</div></div>
      </div>

      <div class="score-row">
        <div class="score-card" style="background:${statusInfo.color}12;border-color:${statusInfo.color}55;">
          <div class="l">SOP Audit</div><div class="v" style="color:${statusInfo.color}">${weightedScore}%</div><div class="s" style="color:${statusInfo.color}">${esc(statusInfo.lbl)}</div>
        </div>
        <div class="score-card" style="background:#7c3aed12;border-color:#7c3aed55;">
          <div class="l">Tier 1</div><div class="v" style="color:#7c3aed">${tiers?.tier1 ?? "\u2014"}%</div><div class="s" style="color:#7c3aed">Customer Experience</div>
        </div>
        <div class="score-card" style="background:#b0721212;border-color:#b0721255;">
          <div class="l">Tier 2</div><div class="v" style="color:#b07212">${tiers?.tier2 ?? "\u2014"}%</div><div class="s" style="color:#b07212">Operational</div>
        </div>
        <div class="score-card" style="background:#1a9e6e12;border-color:#1a9e6e55;">
          <div class="l">Tier 3</div><div class="v" style="color:#1a9e6e">${tiers?.tier3 ?? "\u2014"}%</div><div class="s" style="color:#1a9e6e">Compliance</div>
        </div>
      </div>

      <div class="metric-row">
        <div class="metric-card" style="border-color:#a32020;"><div class="l">Total Temuan</div><div class="v">${failedItems.length}</div></div>
        <div class="metric-card" style="border-color:#b07212;"><div class="l">Kategori Bermasalah</div><div class="v">${bermasalah.length}</div></div>
        <div class="metric-card" style="border-color:#1a9e6e;"><div class="l">Kategori Sempurna</div><div class="v">${sempurna.length}</div></div>
        <div class="metric-card" style="border-color:#7c3aed;"><div class="l">Kategori Diaudit</div><div class="v">${CATS.length}</div></div>
      </div>

      <div class="box2" style="background:#f5f3fa;border:1px solid #e0d8f0;">
        <div class="box2-title" style="color:#2A1F52;">Ringkasan Audit</div>
        <div style="font-size:10.5px;">Skor SOP cabang <b>${esc(branch.name)}</b> periode ${esc(periodeLabel(rec.period))} adalah <b>${weightedScore}% (${esc(statusInfo.lbl)})</b>.</div>
        ${bermasalah.length ? `<div style="font-size:10px;margin-top:6px;">Fokus perbaikan utama:</div><ul>${bermasalah.map((c) => `<li>${esc(c.cat.label)}</li>`).join("")}</ul>` : `<div style="font-size:10px;margin-top:6px;color:#1a9e6e;">Semua kategori sudah sesuai standar.</div>`}
      </div>

      <div class="two-col">
        <div>
          <div class="box2-title" style="color:#a32020;">Top 5 Temuan Audit</div>
          <table class="temuan-tbl"><thead><tr><th>Temuan</th><th style="text-align:right;width:50px;">Jumlah</th></tr></thead>
          <tbody>${top5.length ? top5.map((t) => `<tr><td>${esc(t)}</td><td style="text-align:right;font-weight:800;color:#a32020;">1</td></tr>`).join("") : `<tr><td colspan="2" style="color:#1a9e6e;">Tidak ada temuan.</td></tr>`}</tbody>
          </table>
        </div>
        <div class="area-list">
          <div class="area-list-title">Area Sesuai Standar</div>
          ${sempurna.length ? sempurna.map((c) => `<div class="area-item"><span class="dot">&#10003;</span>${esc(c.cat.label)}</div>`).join("") : `<div style="font-size:10px;color:#888;">Belum ada kategori yang sempurna.</div>`}
        </div>
      </div>

      <div class="box2-title" style="color:#2A1F52;margin-bottom:8px;">SOP Audit &mdash; Tier Compact</div>
      <table class="tier-tbl">
        <thead><tr><th>Tier</th><th style="text-align:center;">Bobot</th><th style="text-align:center;">Skor</th></tr></thead>
        <tbody>${tierRows.map((t) => `<tr><td>${t.label}</td><td style="text-align:center;">${t.bobot}</td><td style="text-align:center;color:${scoreColor(t.skor)}">${t.skor ?? "\u2014"}%</td></tr>`).join("")}</tbody>
      </table>

      <div class="box2" style="background:#fdfaf1;border:1px solid #eadfc4;">
        <div class="box2-title" style="color:#b8860b;">Kesimpulan Audit</div>
        <div style="font-size:10.5px;">${esc(kesimpulan)}</div>
      </div>

      <div class="footer2">
        <span>PT. KLA Teknologi Indonesia &bull; Confidential</span>
        <span>Executive Summary &bull; ${esc(branch.name)}</span>
      </div>
    </div>`;
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
      if (!rec || rec.data?.tidak_visit) return { branch: b, rec: null, tidakVisit: !!rec?.data?.tidak_visit };
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
        <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>Cetak hasil audit SOP jadi PDF, per cabang atau ringkasan semua cabang</div>
      </div>

      {error && <div style={{ margin: "14px 28px 0", background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}

      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
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

function normalizePhotosForPdf(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") return [{ url: raw, type: "image" }];
  return [];
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
      const media = normalizePhotosForPdf(rec.data?.photos?.[key]);
      const mediaHtml = media.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:4px;max-width:120px;">${media.map((m) =>
            m.type === "video"
              ? `<div style="width:38px;height:38px;border-radius:4px;border:1px solid #ddd;background:#f2f2f2;display:flex;align-items:center;justify-content:center;font-size:14px;color:#666;">&#9654;</div>`
              : `<img src="${esc(m.url)}" style="width:38px;height:38px;object-fit:cover;border-radius:4px;border:1px solid #ddd;" />`
          ).join("")}</div>`
        : "\u2014";
      return `<tr style="${isOk ? "" : "background:#fff7f7;"}">
        <td style="width:22px;text-align:center;font-weight:900;color:${isOk ? "#1a9e6e" : "#a32020"}">${isOk ? "&#10003;" : "&#10007;"}</td>
        <td style="${isOk ? "" : "color:#a32020;font-weight:700;"}">${esc(item)}</td>
        <td style="width:24%;font-size:9px;color:#7a5800;font-style:italic;">${note ? esc(note) : "\u2014"}</td>
        <td style="width:130px;text-align:center;vertical-align:middle;">${mediaHtml}</td>
      </tr>`;
    }).join("");
    return `<div class="cat-head" style="background:${c.color}"><span>${esc(c.label)}</span><span>${bd.score}/${bd.total} \u2014 ${pct}%</span></div>
      <table class="ptbl"><thead><tr><th style="width:22px;">Status</th><th>Checklist</th><th>Catatan</th><th>Foto/Video</th></tr></thead><tbody>${rows}</tbody></table>`;
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
