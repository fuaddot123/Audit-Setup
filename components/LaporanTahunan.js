import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { calcWeightedFromRecord, CATS as SOP_CATS, isLegacyChecklistRecord, listFailedItems } from "../lib/sopConfig";
import { kesehatanStatusInfo, serviceStatusInfo, laptopStatusInfo, calcServiceRatio } from "../lib/stokConfig";
import { sortBranches } from "../lib/branchOrder";
import BranchMultiSelect from "./BranchMultiSelect";

// ============================================================
// LAPORAN TAHUNAN — PPT gabungan semua modul, 1 tahun penuh, dengan perbandingan
// ke tahun sebelumnya (kalau datanya ada). Struktur & pola teknis (pptxgenjs dari
// CDN, warna, isolasi per-auditor) SAMA persis kayak LaporanBulanan.js, biar
// konsisten. Dibangun BERTAHAP — Tahap 1 ini: Cover + Ringkasan Eksekutif dulu.
// ============================================================

const PURPLE = "2A1F52";
const PURPLE_DARK = "2E1465";
const PURPLE_LIGHT = "5B2394";
const GOLD = "F4B740";
const WHITE = "FFFFFF";
const GREEN = "1a9e6e";
const AMBER = "b07212";
const RED = "a32020";

const ISOLATION_START_PERIOD = "2026-08";

function loadPptxScript() {
  return new Promise((resolve, reject) => {
    if (window.PptxGenJS) return resolve();
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js";
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function periodsInYear(year) {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}

export default function LaporanTahunan({ profile }) {
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());
  const [selectedBranchIds, setSelectedBranchIds] = useState([]);

  useEffect(() => { loadBranches(); }, []);

  async function loadBranches() {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.from("branches").select("*").order("name");
      if (err) throw err;
      const sorted = sortBranches(data || []);
      setBranches(sorted);
      setSelectedBranchIds(sorted.map((b) => b.id));
    } catch (e) {
      setError("Gagal memuat data cabang: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  // Ambil SEMUA data 1 tahun, semua modul, sekaligus — dipanggil buat tahun yang
  // dipilih DAN tahun sebelumnya (buat perbandingan). Isolasi per-auditor: sama
  // pola kayak LaporanBulanan.js — auditor cuma liat gabungan periode sebelum
  // ISOLATION_START_PERIOD, + punya sendiri buat periode setelahnya.
  async function loadYearData(y) {
    const periods = periodsInYear(y);
    const branchIdSet = new Set(selectedBranchIds);
    const isolate = profile?.role === "auditor";
    const isoFilter = (q) => (isolate ? q.or(`period.lt.${ISOLATION_START_PERIOD},submitted_by.eq.${profile.id}`) : q);

    const [sopRes, kesRes, svcRes, keuRes, kpiRes, baRes] = await Promise.all([
      isoFilter(supabase.from("audit_generic").select("*").eq("module", "sop").gte("period", periods[0]).lte("period", periods[11])),
      isoFilter(supabase.from("audit_generic").select("*").eq("module", "stok_kesehatan").gte("period", periods[0]).lte("period", periods[11])),
      isoFilter(supabase.from("audit_generic").select("*").eq("module", "stok_service").gte("period", periods[0]).lte("period", periods[11])),
      isoFilter(supabase.from("audit_keuangan").select("*").gte("period", periods[0]).lte("period", periods[11])),
      isoFilter(supabase.from("audit_kpi").select("*").gte("period", periods[0]).lte("period", periods[11])),
      isoFilter(supabase.from("berita_acara").select("*").gte("period", periods[0]).lte("period", periods[11])),
    ]);
    [sopRes, kesRes, svcRes, keuRes, kpiRes, baRes].forEach((r) => { if (r.error) throw r.error; });

    const filterBranch = (rows) => (rows || []).filter((r) => branchIdSet.has(r.branch_id));
    return {
      year: y,
      periods,
      sop: filterBranch(sopRes.data),
      kes: filterBranch(kesRes.data),
      svc: filterBranch(svcRes.data),
      keu: filterBranch(keuRes.data),
      kpi: filterBranch(kpiRes.data),
      ba: filterBranch(baRes.data),
    };
  }

  function latestFor(records, branchId, period) {
    const matches = records.filter((r) => r.branch_id === branchId && r.period === period);
    if (!matches.length) return null;
    return [...matches].sort((a, b) => (b.data?.audit_date || b.audit_date || "").localeCompare(a.data?.audit_date || a.audit_date || ""))[0];
  }

  // Rata-rata SOP setahun (semua cabang, semua bulan yang ada datanya) — calcWeightedFromRecord
  // otomatis pilih rumus lama/baru sesuai format record, jadi Jan-Des kebaca konsisten.
  function avgSop(yearData) {
    const scores = [];
    yearData.periods.forEach((p) => {
      selectedBranchIds.forEach((bid) => {
        const rec = latestFor(yearData.sop, bid, p);
        if (!rec || rec.data?.tidak_visit || rec.data?.cabang_baru) return;
        scores.push(calcWeightedFromRecord(rec.data));
      });
    });
    return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  }

  function avgKesehatan(yearData) {
    const scores = [];
    yearData.periods.forEach((p) => {
      selectedBranchIds.forEach((bid) => {
        const rec = latestFor(yearData.kes, bid, p);
        if (!rec || rec.data?.tidak_visit || rec.data?.cabang_baru) return;
        if (rec.data?.kesehatan_pct != null) scores.push(rec.data.kesehatan_pct * 100);
      });
    });
    return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  }

  // Service Ratio: headline setahun pakai rata-rata BLENDED (Laptop+Aksesoris digabung
  // rata-rata skor tier, sama prinsip kayak Dashboard Audit) — angka 1 doang buat headline,
  // detail 2-kategori terpisah nanti di slide khusus Service Ratio (Tahap 2).
  function avgService(yearData) {
    const scores = [];
    yearData.periods.forEach((p) => {
      selectedBranchIds.forEach((bid) => {
        const rec = latestFor(yearData.svc, bid, p);
        if (!rec || rec.data?.tidak_visit || rec.data?.cabang_baru) return;
        const d = rec.data;
        if (d.ratio_laptop != null || d.ratio_aksesoris != null) {
          const parts = [];
          if (d.ratio_laptop != null) parts.push(laptopStatusInfo(d.ratio_laptop).lbl === "Terkendali" ? 100 : laptopStatusInfo(d.ratio_laptop).lbl === "Monitoring" ? 70 : 40);
          if (d.ratio_aksesoris != null) parts.push(serviceStatusInfo(d.ratio_aksesoris).lbl === "Terkendali" ? 100 : serviceStatusInfo(d.ratio_aksesoris).lbl === "Monitoring" ? 70 : 40);
          if (parts.length) scores.push(parts.reduce((a, b) => a + b, 0) / parts.length);
        } else if (d.ratio != null) {
          const info = serviceStatusInfo(d.ratio);
          scores.push(info.lbl === "Terkendali" ? 100 : info.lbl === "Monitoring" ? 70 : 40);
        }
      });
    });
    return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  }

  // Keuangan: rata-rata % Posisi Kas setahun (bukan total Rupiah — biar bisa dibandingin
  // apple-to-apple antar tahun meski jumlah cabang/anggaran beda).
  function avgKeuangan(yearData, settings) {
    const scores = [];
    let totalPengeluaran = 0;
    yearData.periods.forEach((p) => {
      selectedBranchIds.forEach((bid) => {
        const entries = yearData.keu.filter((e) => e.branch_id === bid && e.period === p);
        if (!entries.length) return;
        const e = [...entries].sort((a, b) => (b.audit_date || "").localeCompare(a.audit_date || ""))[0];
        if (e.tidak_visit) return;
        const sb = parseFloat(e.saldo_sebelumnya) || 0;
        const sm = parseFloat(e.saldo_masuk) || 0;
        const pk = parseFloat(e.pengeluaran) || 0;
        const total = sb + sm;
        if (total > 0) scores.push((pk / total) * 100);
        totalPengeluaran += pk;
      });
    });
    return { avgPosisi: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null, totalPengeluaran };
  }

  async function generatePPT() {
    setGenerating(true);
    setError(null);
    try {
      await loadPptxScript();
      const pptx = new window.PptxGenJS();
      pptx.layout = "LAYOUT_WIDE";

      const [curYear, prevYear] = await Promise.all([loadYearData(year), loadYearData(year - 1)]);
      const keuSettingsRes = await supabase.from("settings_keuangan").select("*").single();
      const keuSettings = keuSettingsRes.data || { terkendali: 70, efisien: 95, monitoring: 105 };

      const curSop = avgSop(curYear), prevSop = avgSop(prevYear);
      const curKes = avgKesehatan(curYear), prevKes = avgKesehatan(prevYear);
      const curSvc = avgService(curYear), prevSvc = avgService(prevYear);
      const curKeu = avgKeuangan(curYear, keuSettings), prevKeu = avgKeuangan(prevYear, keuSettings);

      const scopeBranches = branches.filter((b) => selectedBranchIds.includes(b.id));
      const isPersonalView = profile?.role === "auditor";

      function newSlide() {
        return pptx.addSlide();
      }
      // pptxgenjs nggak support gradient fill beneran buat shape — "gradient" disimulasiin
      // numpuk banyak kotak tipis warna beda-beda (pola SAMA persis kayak LaporanBulanan.js,
      // biar konsisten visualnya).
      function lerpColor(c1, c2, t) {
        const a = parseInt(c1, 16), b = parseInt(c2, 16);
        const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
        const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
        const r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
        return [r, g, bl].map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase();
      }
      function addGradientBackground(slide) {
        const steps = 40;
        for (let i = 0; i < steps; i++) {
          const t = i / (steps - 1);
          const c = lerpColor(PURPLE_DARK, PURPLE_LIGHT, t);
          slide.addShape(pptx.ShapeType.rect, { x: (13.33 / steps) * i, y: 0, w: 13.33 / steps + 0.02, h: 7.5, fill: { color: c } });
        }
      }
      function addGradientHeader(slide, h) {
        const steps = 40;
        for (let i = 0; i < steps; i++) {
          const t = i / (steps - 1);
          const c = lerpColor(PURPLE_DARK, PURPLE_LIGHT, t);
          slide.addShape(pptx.ShapeType.rect, { x: (13.33 / steps) * i, y: 0, w: 13.33 / steps + 0.02, h, fill: { color: c } });
        }
        slide.addShape(pptx.ShapeType.rect, { x: 0, y: h, w: 13.33, h: 0.04, fill: { color: GOLD } });
      }
      function addLogo(s, x, y) {
        s.addText("KLA", { x, y, w: 2.1, h: 0.4, align: "right", fontSize: 20, bold: true, color: GOLD, margin: 0 });
        s.addText("COMPUTER", { x, y: y + 0.37, w: 2.1, h: 0.25, align: "right", fontSize: 9, bold: true, color: WHITE, charSpacing: 1, margin: 0 });
      }
      // Kartu "delta" — angka tahun ini + panah naik/turun dibanding tahun lalu.
      function deltaArrow(cur, prev, lowerIsBetter) {
        if (cur == null || prev == null) return { arrow: "", color: "999999", text: "" };
        const diff = cur - prev;
        if (Math.abs(diff) < 0.5) return { arrow: "\u2192", color: "999999", text: "stabil" };
        const isUp = diff > 0;
        // Arah panah = arah angka beneran (jujur, jangan dibalik). Yang dibalik cuma WARNANYA
        // — buat metrik yang "makin kecil makin bagus" (misal % Posisi Kas), naik = merah.
        const isGood = lowerIsBetter ? !isUp : isUp;
        return {
          arrow: isUp ? "\u25b2" : "\u25bc",
          color: isGood ? GREEN : RED,
          text: `${isUp ? "+" : ""}${diff.toFixed(1)} poin vs ${year - 1}`,
        };
      }

      // ============================================================
      // SLIDE 1 — COVER (gaya minim, contek referensi user: background gelap solid,
      // judul bold rata kiri, garis bawah pendek, subjudul 2 baris) — warna KLA (ungu-emas)
      // ============================================================
      {
        const s = newSlide();
        s.background = { color: PURPLE_DARK };

        s.addText([
          { text: "Laporan Tahunan ", options: { color: GOLD, bold: true } },
          { text: String(year), options: { color: WHITE, bold: true } },
        ], { x: 0.9, y: 2.85, w: 11.5, h: 1.1, fontSize: 46, margin: 0 });

        s.addShape(pptx.ShapeType.rect, { x: 0.95, y: 3.95, w: 0.75, h: 0.03, fill: { color: GOLD } });

        const scopeLabel = scopeBranches.length === branches.length ? "Seluruh cabang" : `${scopeBranches.length} cabang terpilih`;
        s.addText(`${scopeLabel} \u2014 PT. KLA Teknologi Indonesia`, { x: 0.9, y: 4.25, w: 10, h: 0.35, fontSize: 15, color: "B8B0D8", margin: 0 });
        s.addText(
          isPersonalView ? `Hasil audit ${profile?.full_name || "auditor"}` : "Laporan Kinerja Audit Internal & Ringkasan Tahunan",
          { x: 0.9, y: 4.62, w: 10, h: 0.35, fontSize: 15, color: "B8B0D8", margin: 0 }
        );

        s.addText("KLA COMPUTER", { x: 0.9, y: 6.9, w: 5, h: 0.3, fontSize: 10, bold: true, color: "7A6FA0", charSpacing: 1, margin: 0 });
        s.addText(`Dicetak ${new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })}`, { x: 7.4, y: 6.9, w: 5, h: 0.3, fontSize: 10, color: "7A6FA0", align: "right", margin: 0 });
      }

      // ============================================================
      // SLIDE 2 — RINGKASAN EKSEKUTIF (kartu angka besar gaya referensi, background gelap solid)
      // ============================================================
      {
        const s = newSlide();
        s.background = { color: PURPLE_DARK };

        s.addText("Ringkasan Eksekutif", { x: 0.9, y: 0.55, w: 10, h: 0.55, fontSize: 30, bold: true, color: GOLD, margin: 0 });
        s.addText(`${year} dibanding ${year - 1}`, { x: 0.9, y: 1.12, w: 10, h: 0.35, fontSize: 14, color: "B8B0D8", margin: 0 });

        const cards = [
          { label: "SKOR SOP", cur: curSop, prev: prevSop, fmt: (v) => v.toFixed(1) + "%" },
          { label: "KESEHATAN STOK", cur: curKes, prev: prevKes, fmt: (v) => v.toFixed(1) + "%" },
          { label: "SERVICE RATIO (SKOR)", cur: curSvc, prev: prevSvc, fmt: (v) => v.toFixed(1) + "%" },
          { label: "% POSISI KAS", cur: curKeu.avgPosisi, prev: prevKeu.avgPosisi, fmt: (v) => v.toFixed(1) + "%", lowerIsBetter: true },
        ];

        const cardW = 2.85, gap = 0.25, startX = 0.9, cardY = 1.85, cardH = 3.2;
        cards.forEach((c, i) => {
          const x = startX + i * (cardW + gap);
          const d = deltaArrow(c.cur, c.prev, c.lowerIsBetter);
          s.addShape(pptx.ShapeType.roundRect, { x, y: cardY, w: cardW, h: cardH, rectRadius: 0.1, fill: { color: "3D2A72" }, line: { type: "none" } });
          s.addText(c.cur != null ? c.fmt(c.cur) : "\u2014", { x: x + 0.22, y: cardY + 0.55, w: cardW - 0.44, h: 1.0, fontSize: 38, bold: true, color: GOLD, margin: 0 });
          s.addText(c.label, { x: x + 0.22, y: cardY + 1.55, w: cardW - 0.44, h: 0.4, fontSize: 11.5, bold: true, color: WHITE, charSpacing: 0.5, margin: 0 });
          s.addShape(pptx.ShapeType.rect, { x: x + 0.22, y: cardY + 2.0, w: cardW - 0.44, h: 0.012, fill: { color: "6b5f96" } });
          if (c.prev != null && c.cur != null) {
            s.addText([
              { text: d.arrow + " ", options: { color: d.color, bold: true, fontSize: 12 } },
              { text: d.text, options: { color: "B8B0D8", fontSize: 9.5 } },
            ], { x: x + 0.22, y: cardY + 2.15, w: cardW - 0.44, h: 0.35, margin: 0 });
            s.addText(`${year - 1}: ${c.fmt(c.prev)}`, { x: x + 0.22, y: cardY + 2.5, w: cardW - 0.44, h: 0.3, fontSize: 10, color: "9188B0", margin: 0 });
          } else {
            s.addText(`Data ${year - 1} belum ada`, { x: x + 0.22, y: cardY + 2.15, w: cardW - 0.44, h: 0.5, fontSize: 10, italic: true, color: "9188B0", margin: 0 });
          }
        });

        s.addText(
          `Total Pengeluaran Kas Kecil ${year}: ${curKeu.totalPengeluaran ? "Rp" + Math.round(curKeu.totalPengeluaran).toLocaleString("id-ID") : "\u2014"}` +
          (prevKeu.totalPengeluaran ? `  \u2022  ${year - 1}: Rp${Math.round(prevKeu.totalPengeluaran).toLocaleString("id-ID")}` : ""),
          { x: 0.9, y: 5.35, w: 11.5, h: 0.35, fontSize: 12, color: "D8D0F0", margin: 0 }
        );
        s.addText(
          "Skor SOP & Kepatuhan dihitung otomatis dari checklist yang berlaku tiap bulan (format lama Jan\u2013Agu 2026, format baru mulai Sep 2026) \u2014 tetap sebanding karena keduanya menghasilkan skala 0\u2013100%.",
          { x: 0.9, y: 6.9, w: 11.5, h: 0.4, fontSize: 8.5, italic: true, color: "8A80AE", margin: 0 }
        );
      }

      // ============================================================
      // Helper: rata-rata per BULAN (array 12 angka, buat tren tahunan)
      // ============================================================
      function monthlyAvgSop(yearData) {
        return yearData.periods.map((p) => {
          const scores = [];
          selectedBranchIds.forEach((bid) => {
            const rec = latestFor(yearData.sop, bid, p);
            if (!rec || rec.data?.tidak_visit || rec.data?.cabang_baru) return;
            scores.push(calcWeightedFromRecord(rec.data));
          });
          return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
        });
      }
      function monthlyAvgKesehatan(yearData) {
        return yearData.periods.map((p) => {
          const scores = [];
          selectedBranchIds.forEach((bid) => {
            const rec = latestFor(yearData.kes, bid, p);
            if (!rec || rec.data?.tidak_visit || rec.data?.cabang_baru) return;
            if (rec.data?.kesehatan_pct != null) scores.push(rec.data.kesehatan_pct * 100);
          });
          return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
        });
      }
      function monthlyAvgKeuangan(yearData) {
        return yearData.periods.map((p) => {
          const scores = [];
          selectedBranchIds.forEach((bid) => {
            const entries = yearData.keu.filter((e) => e.branch_id === bid && e.period === p);
            if (!entries.length) return;
            const e = [...entries].sort((a, b) => (b.audit_date || "").localeCompare(a.audit_date || ""))[0];
            if (e.tidak_visit) return;
            const sb = parseFloat(e.saldo_sebelumnya) || 0, sm = parseFloat(e.saldo_masuk) || 0, pk = parseFloat(e.pengeluaran) || 0;
            const total = sb + sm;
            if (total > 0) scores.push((pk / total) * 100);
          });
          return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
        });
      }

      // Chart batang + garis target (bar per bulan, garis putus-putus buat ambang batas) —
      // pola yang udah disepakati di awal diskusi (mockup) buat metrik 1-angka-per-bulan.
      function addBarTargetChart(s, x, y, w, h, monthlyValues, target, colorAbove, colorBelow, aboveIsGood) {
        const monthLabels = periodsInYear(year).map((p) => shortMonthID(p));
        const vals = monthlyValues.map((v) => v == null ? null : Math.round(v * 10) / 10);
        const hasAny = vals.some((v) => v != null);
        if (!hasAny) {
          s.addText("Belum ada data bulan ini.", { x, y, w, h, align: "center", valign: "middle", fontSize: 11, color: "9188B0" });
          return;
        }
        const barColors = vals.map((v) => {
          if (v == null) return "3D2A72";
          const isGood = aboveIsGood ? v >= target : v <= target;
          return isGood ? colorAbove : colorBelow;
        });
        s.addChart([
          { type: pptx.ChartType.bar, data: [{ name: "Nilai", labels: monthLabels, values: vals.map((v) => v ?? 0) }], options: { chartColors: barColors, barGapWidthPct: 35 } },
          { type: pptx.ChartType.line, data: [{ name: "Target", labels: monthLabels, values: monthLabels.map(() => target) }], options: { chartColors: [GOLD], lineSize: 1.5, lineDataSymbol: "none", lineDashType: "dash" } },
        ], {
          x, y, w, h,
          showLegend: false, showTitle: false,
          catAxisLabelColor: "B8B0D8", catAxisLabelFontSize: 8, catAxisLineColor: "4A3D75",
          valAxisLabelColor: "B8B0D8", valAxisLabelFontSize: 8, valAxisLineColor: "4A3D75",
          valGridLine: { color: "4A3D75", style: "dash", size: 0.5 }, catGridLine: { style: "none" },
          dataLabelColor: "FFFFFF", dataLabelFontSize: 8, dataLabelPosition: "outEnd",
          chartArea: { fill: { color: PURPLE_DARK } }, plotArea: { fill: { color: PURPLE_DARK } },
        });
      }
      function shortMonthID(p) {
        const [y2, m] = p.split("-");
        return new Date(+y2, +m - 1).toLocaleDateString("id-ID", { month: "short" });
      }

      // ============================================================
      // SLIDE 3 — AUDIT SOP (tren 12 bulan)
      // ============================================================
      {
        const s = newSlide();
        s.background = { color: PURPLE_DARK };
        s.addText("Audit SOP", { x: 0.9, y: 0.5, w: 8, h: 0.5, fontSize: 26, bold: true, color: GOLD, margin: 0 });
        s.addText(`Tren skor kepatuhan checklist, ${year}`, { x: 0.9, y: 1.02, w: 8, h: 0.35, fontSize: 13, color: "B8B0D8", margin: 0 });

        const sopMonthly = monthlyAvgSop(curYear);
        s.addShape(pptx.ShapeType.roundRect, { x: 0.9, y: 1.55, w: 11.53, h: 4.6, rectRadius: 0.1, fill: { color: "3D2A72" }, line: { type: "none" } });
        addBarTargetChart(s, 1.2, 1.85, 10.93, 3.9, sopMonthly, 80, "3ddb9a", "ef6a6a", true);
        s.addText("Garis putus-putus emas = target 80% (ALERT_THRESHOLD) \u2014 bar hijau di atas target, merah di bawah.", { x: 1.2, y: 5.85, w: 10.93, h: 0.25, fontSize: 9, italic: true, color: "9188B0", margin: 0 });

        s.addText(curSop != null ? `Rata-rata ${year}: ${curSop.toFixed(1)}%` : "Rata-rata: \u2014", { x: 0.9, y: 6.35, w: 6, h: 0.35, fontSize: 12.5, bold: true, color: WHITE, margin: 0 });
      }

      // ============================================================
      // SLIDE 4 — KESEHATAN STOK (tren 12 bulan)
      // ============================================================
      {
        const s = newSlide();
        s.background = { color: PURPLE_DARK };
        s.addText("Kesehatan Stok", { x: 0.9, y: 0.5, w: 8, h: 0.5, fontSize: 26, bold: true, color: GOLD, margin: 0 });
        s.addText(`Tren kesehatan stok cabang, ${year}`, { x: 0.9, y: 1.02, w: 8, h: 0.35, fontSize: 13, color: "B8B0D8", margin: 0 });

        const kesMonthly = monthlyAvgKesehatan(curYear);
        s.addShape(pptx.ShapeType.roundRect, { x: 0.9, y: 1.55, w: 11.53, h: 4.6, rectRadius: 0.1, fill: { color: "3D2A72" }, line: { type: "none" } });
        addBarTargetChart(s, 1.2, 1.85, 10.93, 3.9, kesMonthly, 85, "3ddb9a", "ef6a6a", true);
        s.addText("Garis putus-putus emas = target 85% (\u201cTerkendali\u201d) \u2014 bar hijau di atas target, merah di bawah.", { x: 1.2, y: 5.85, w: 10.93, h: 0.25, fontSize: 9, italic: true, color: "9188B0", margin: 0 });

        s.addText(curKes != null ? `Rata-rata ${year}: ${curKes.toFixed(1)}%` : "Rata-rata: \u2014", { x: 0.9, y: 6.35, w: 6, h: 0.35, fontSize: 12.5, bold: true, color: WHITE, margin: 0 });
      }

      // ============================================================
      // SLIDE 5 — AUDIT KEUANGAN (tren % Posisi Kas 12 bulan)
      // ============================================================
      {
        const s = newSlide();
        s.background = { color: PURPLE_DARK };
        s.addText("Audit Keuangan", { x: 0.9, y: 0.5, w: 8, h: 0.5, fontSize: 26, bold: true, color: GOLD, margin: 0 });
        s.addText(`Tren % Posisi Kas Kecil, ${year} (makin kecil makin efisien)`, { x: 0.9, y: 1.02, w: 8, h: 0.35, fontSize: 13, color: "B8B0D8", margin: 0 });

        const keuMonthly = monthlyAvgKeuangan(curYear);
        s.addShape(pptx.ShapeType.roundRect, { x: 0.9, y: 1.55, w: 11.53, h: 4.6, rectRadius: 0.1, fill: { color: "3D2A72" }, line: { type: "none" } });
        addBarTargetChart(s, 1.2, 1.85, 10.93, 3.9, keuMonthly, 95, "3ddb9a", "ef6a6a", false);
        s.addText("Garis putus-putus emas = target 95% (batas \u201cEfisien\u201d) \u2014 bar hijau di bawah target (aman), merah di atas.", { x: 1.2, y: 5.85, w: 10.93, h: 0.25, fontSize: 9, italic: true, color: "9188B0", margin: 0 });

        s.addText(curKeu.avgPosisi != null ? `Rata-rata ${year}: ${curKeu.avgPosisi.toFixed(1)}%` : "Rata-rata: \u2014", { x: 0.9, y: 6.35, w: 6, h: 0.35, fontSize: 12.5, bold: true, color: WHITE, margin: 0 });
      }

      // ── Perhitungan yang dipakai lintas-slide (Ranking, Top Temuan, Berita Acara, Kesimpulan) ──
      const branchYearScores = scopeBranches.map((b) => {
        const scores = [];
        curYear.periods.forEach((p) => {
          const rec = latestFor(curYear.sop, b.id, p);
          if (!rec || rec.data?.tidak_visit || rec.data?.cabang_baru) return;
          scores.push(calcWeightedFromRecord(rec.data));
        });
        return { branch: b, avg: scores.length ? scores.reduce((a, c) => a + c, 0) / scores.length : null, months: scores.length };
      }).filter((r) => r.avg != null).sort((a, b) => b.avg - a.avg);

      const yearFindingCount = {};
      curYear.periods.forEach((p) => {
        selectedBranchIds.forEach((bid) => {
          const rec = latestFor(curYear.sop, bid, p);
          if (!rec || rec.data?.tidak_visit || rec.data?.cabang_baru) return;
          listFailedItems(rec.data).forEach(({ text }) => { yearFindingCount[text] = (yearFindingCount[text] || 0) + 1; });
        });
      });
      const top10Temuan = Object.entries(yearFindingCount).sort((a, b) => b[1] - a[1]).slice(0, 10);

      let totalRusak = 0;
      const rusakPerBulan = curYear.periods.map((p) => {
        let count = 0;
        selectedBranchIds.forEach((bid) => {
          const entries = curYear.ba.filter((e) => e.branch_id === bid && e.period === p);
          entries.forEach((e) => {
            const items = e.data?.inventaris_items || [];
            count += items.filter((it) => it.status === "Rusak").length;
          });
        });
        totalRusak += count;
        return count;
      });

      // ============================================================
      // SLIDE 6 — SERVICE RATIO (2 garis: Laptop vs Aksesoris, 12 bulan)
      // ============================================================
      {
        const s = newSlide();
        s.background = { color: PURPLE_DARK };
        s.addText("Service Ratio", { x: 0.9, y: 0.5, w: 8, h: 0.5, fontSize: 26, bold: true, color: GOLD, margin: 0 });
        s.addText(`Tren Laptop vs Aksesoris, ${year} (makin kecil makin bagus)`, { x: 0.9, y: 1.02, w: 9.5, h: 0.35, fontSize: 13, color: "B8B0D8", margin: 0 });

        const monthLabels = periodsInYear(year).map((p) => shortMonthID(p));
        const laptopMonthly = [], aksMonthly = [], blendedMonthly = [];
        curYear.periods.forEach((p) => {
          const laptopScores = [], aksScores = [], blendedScores = [];
          selectedBranchIds.forEach((bid) => {
            const rec = latestFor(curYear.svc, bid, p);
            if (!rec || rec.data?.tidak_visit || rec.data?.cabang_baru) return;
            const d = rec.data;
            if (d.ratio_laptop != null) laptopScores.push(d.ratio_laptop * 100);
            if (d.ratio_aksesoris != null) aksScores.push(d.ratio_aksesoris * 100);
            if (d.ratio != null && d.ratio_laptop == null) blendedScores.push(d.ratio * 100);
          });
          laptopMonthly.push(laptopScores.length ? laptopScores.reduce((a, b) => a + b, 0) / laptopScores.length : null);
          aksMonthly.push(aksScores.length ? aksScores.reduce((a, b) => a + b, 0) / aksScores.length : null);
          blendedMonthly.push(blendedScores.length ? blendedScores.reduce((a, b) => a + b, 0) / blendedScores.length : null);
        });

        s.addShape(pptx.ShapeType.roundRect, { x: 0.9, y: 1.55, w: 11.53, h: 4.6, rectRadius: 0.1, fill: { color: "3D2A72" }, line: { type: "none" } });
        const hasSplitData = laptopMonthly.some((v) => v != null);
        if (hasSplitData) {
          s.addChart(pptx.ChartType.line, [
            { name: "Laptop", labels: monthLabels, values: laptopMonthly.map((v) => v ?? 0) },
            { name: "Aksesoris", labels: monthLabels, values: aksMonthly.map((v) => v ?? 0) },
          ], {
            x: 1.2, y: 1.85, w: 10.93, h: 3.9, chartColors: ["F4B740", "3ddb9a"],
            lineSize: 2.5, lineDataSymbol: "circle", lineDataSymbolSize: 6,
            showLegend: true, legendPos: "b", legendColor: "D8D0F0", legendFontSize: 9,
            catAxisLabelColor: "B8B0D8", catAxisLabelFontSize: 8, catAxisLineColor: "4A3D75",
            valAxisLabelColor: "B8B0D8", valAxisLabelFontSize: 8, valAxisLineColor: "4A3D75",
            valGridLine: { color: "4A3D75", style: "dash", size: 0.5 }, catGridLine: { style: "none" },
            chartArea: { fill: { color: PURPLE_DARK } }, plotArea: { fill: { color: PURPLE_DARK } },
          });
        } else {
          s.addChart(pptx.ChartType.line, [{ name: "Gabungan (data lama)", labels: monthLabels, values: blendedMonthly.map((v) => v ?? 0) }], {
            x: 1.2, y: 1.85, w: 10.93, h: 3.9, chartColors: ["B8B0D8"],
            lineSize: 2.5, lineDataSymbol: "circle", lineDataSymbolSize: 6,
            showLegend: true, legendPos: "b", legendColor: "D8D0F0", legendFontSize: 9,
            catAxisLabelColor: "B8B0D8", catAxisLabelFontSize: 8, catAxisLineColor: "4A3D75",
            valAxisLabelColor: "B8B0D8", valAxisLabelFontSize: 8, valAxisLineColor: "4A3D75",
            valGridLine: { color: "4A3D75", style: "dash", size: 0.5 }, catGridLine: { style: "none" },
            chartArea: { fill: { color: PURPLE_DARK } }, plotArea: { fill: { color: PURPLE_DARK } },
          });
        }
        s.addText(
          hasSplitData
            ? "Emas = Laptop, Hijau = Aksesoris. Bulan sebelum split (checklist lama) dikecualikan dari 2 garis ini."
            : "Belum ada bulan dengan data format baru (split Laptop/Aksesoris) \u2014 garis ini masih gabungan (data lama).",
          { x: 1.2, y: 5.85, w: 10.93, h: 0.4, fontSize: 9, italic: true, color: "9188B0", margin: 0 }
        );
      }

      // ============================================================
      // SLIDE 7 — RANKING CABANG TAHUNAN
      // ============================================================
      {
        const s = newSlide();
        s.background = { color: PURPLE_DARK };
        s.addText("Ranking Cabang Tahunan", { x: 0.9, y: 0.4, w: 9, h: 0.5, fontSize: 24, bold: true, color: GOLD, margin: 0 });
        s.addText(`Rata-rata Skor SOP setahun penuh, ${year} \u2014 semua cabang`, { x: 0.9, y: 0.9, w: 9, h: 0.3, fontSize: 12, color: "B8B0D8", margin: 0 });

        const noDataBranches = scopeBranches.filter((b) => !branchYearScores.find((r) => r.branch.id === b.id));
        const allRanked = [...branchYearScores, ...noDataBranches.map((b) => ({ branch: b, avg: null, months: 0 }))];

        const rowH = 0.42, colGap = 0.35;
        const perCol = Math.ceil(allRanked.length / 2);
        const colW = (11.53 - colGap) / 2;
        allRanked.forEach((r, i) => {
          const col = i < perCol ? 0 : 1;
          const rowIdx = i < perCol ? i : i - perCol;
          const x0 = 0.9 + col * (colW + colGap);
          const y = 1.35 + rowIdx * rowH;
          const hasData = r.avg != null;
          const barColor = !hasData ? "6b5f96" : r.avg >= 90 ? "3ddb9a" : r.avg >= 80 ? "6fe08a" : r.avg >= 70 ? GOLD : "ef6a6a";
          s.addText(`${i + 1}`, { x: x0, y, w: 0.32, h: rowH - 0.03, fontSize: 10.5, bold: true, color: "9188B0", align: "center", valign: "middle", margin: 0 });
          s.addText(r.branch.name, { x: x0 + 0.36, y, w: colW * 0.42, h: rowH - 0.03, fontSize: 10, bold: true, color: WHITE, valign: "middle", margin: 0 });
          if (hasData) {
            s.addShape(pptx.ShapeType.roundRect, { x: x0 + colW * 0.46, y: y + 0.08, w: colW * 0.36, h: 0.2, rectRadius: 0.05, fill: { color: "1F1548" } });
            s.addShape(pptx.ShapeType.roundRect, { x: x0 + colW * 0.46, y: y + 0.08, w: colW * 0.36 * Math.min(1, r.avg / 100), h: 0.2, rectRadius: 0.05, fill: { color: barColor } });
            s.addText(`${r.avg.toFixed(1)}%`, { x: x0 + colW * 0.84, y, w: colW * 0.16, h: rowH - 0.03, fontSize: 10, bold: true, color: barColor, valign: "middle", margin: 0 });
          } else {
            s.addText("Belum ada data", { x: x0 + colW * 0.46, y, w: colW * 0.54, h: rowH - 0.03, fontSize: 9, italic: true, color: "6b5f96", valign: "middle", margin: 0 });
          }
        });
        if (!allRanked.length) s.addText("Belum ada cabang terpilih.", { x: 0.9, y: 2, w: 10, h: 0.5, fontSize: 13, color: "9188B0" });
      }

      // ============================================================
      // SLIDE 8 — TOP 10 TEMUAN SEPANJANG TAHUN
      // ============================================================
      {
        const s = newSlide();
        s.background = { color: PURPLE_DARK };
        s.addText("Top 10 Temuan Sepanjang Tahun", { x: 0.9, y: 0.5, w: 10, h: 0.5, fontSize: 26, bold: true, color: GOLD, margin: 0 });
        s.addText(`Item checklist SOP yang paling sering tidak terpenuhi, ${year}`, { x: 0.9, y: 1.02, w: 10, h: 0.35, fontSize: 13, color: "B8B0D8", margin: 0 });

        const maxCount = top10Temuan.length ? top10Temuan[0][1] : 1;
        top10Temuan.forEach(([text, count], i) => {
          const y = 1.6 + i * 0.48;
          s.addShape(pptx.ShapeType.roundRect, { x: 0.9, y, w: 0.4, h: 0.4, rectRadius: 0.08, fill: { color: GOLD } });
          s.addText(String(i + 1), { x: 0.9, y, w: 0.4, h: 0.4, fontSize: 12, bold: true, color: PURPLE_DARK, align: "center", valign: "middle", margin: 0 });
          s.addText(text, { x: 1.45, y, w: 6.8, h: 0.4, fontSize: 10.5, color: WHITE, valign: "middle", margin: 0 });
          s.addShape(pptx.ShapeType.roundRect, { x: 8.4, y: y + 0.06, w: 3.3, h: 0.28, rectRadius: 0.06, fill: { color: "1F1548" } });
          s.addShape(pptx.ShapeType.roundRect, { x: 8.4, y: y + 0.06, w: 3.3 * (count / maxCount), h: 0.28, rectRadius: 0.06, fill: { color: "ef6a6a" } });
          s.addText(`${count}x`, { x: 11.85, y, w: 0.55, h: 0.4, fontSize: 10.5, bold: true, color: WHITE, valign: "middle", margin: 0 });
        });
        if (!top10Temuan.length) s.addText("Belum ada temuan tercatat tahun ini.", { x: 0.9, y: 2, w: 10, h: 0.5, fontSize: 13, color: "9188B0" });
      }

      // ============================================================
      // SLIDE 9 — KPI AUDITOR (ringkasan tahunan)
      // ============================================================
      {
        const s = newSlide();
        s.background = { color: PURPLE_DARK };
        s.addText("KPI Auditor", { x: 0.9, y: 0.5, w: 8, h: 0.5, fontSize: 26, bold: true, color: GOLD, margin: 0 });
        s.addText(`Rata-rata pencapaian KPI setahun, ${year}`, { x: 0.9, y: 1.02, w: 8, h: 0.35, fontSize: 13, color: "B8B0D8", margin: 0 });

        const auditorIds = [...new Set(curYear.kpi.map((k) => k.auditor_id))];
        const kpiSummary = auditorIds.map((aid) => {
          const entries = curYear.kpi.filter((k) => k.auditor_id === aid);
          const covs = entries.map((e) => e.realisasi_coverage).filter((v) => v != null);
          return { id: aid, months: entries.length, avgCoverage: covs.length ? covs.reduce((a, b) => a + b, 0) / covs.length : null };
        });
        if (!kpiSummary.length) {
          s.addText("Belum ada data KPI tahun ini.", { x: 0.9, y: 2, w: 10, h: 0.5, fontSize: 13, color: "9188B0" });
        } else {
          kpiSummary.forEach((k, i) => {
            const y = 1.7 + i * 0.7;
            s.addShape(pptx.ShapeType.roundRect, { x: 0.9, y, w: 11.53, h: 0.58, rectRadius: 0.06, fill: { color: "3D2A72" } });
            s.addText(`Auditor ${i + 1}`, { x: 1.1, y, w: 3, h: 0.58, fontSize: 12, bold: true, color: WHITE, valign: "middle", margin: 0 });
            s.addText(`${k.months} bulan tercatat`, { x: 4.2, y, w: 3, h: 0.58, fontSize: 10.5, color: "B8B0D8", valign: "middle", margin: 0 });
            s.addText(k.avgCoverage != null ? `${Math.round(k.avgCoverage * 100)}% coverage rata-rata` : "\u2014", { x: 8, y, w: 4.2, h: 0.58, fontSize: 11, bold: true, color: GOLD, valign: "middle", margin: 0 });
          });
        }
        s.addText("Auditor ditampilkan anonim per-urutan \u2014 detail nama & 5 indikator lengkap ada di Laporan Bulanan tiap bulan.", { x: 0.9, y: 6.7, w: 11, h: 0.35, fontSize: 9, italic: true, color: "9188B0", margin: 0 });
      }

      // ============================================================
      // SLIDE 10 — BERITA ACARA / INVENTARIS (ringkasan tahunan)
      // ============================================================
      {
        const s = newSlide();
        s.background = { color: PURPLE_DARK };
        s.addText("Berita Acara & Inventaris", { x: 0.9, y: 0.5, w: 9, h: 0.5, fontSize: 26, bold: true, color: GOLD, margin: 0 });
        s.addText(`Ringkasan temuan barang rusak sepanjang tahun, ${year}`, { x: 0.9, y: 1.02, w: 9, h: 0.35, fontSize: 13, color: "B8B0D8", margin: 0 });

        const perBulan = rusakPerBulan;

        s.addText(`${totalRusak}`, { x: 0.9, y: 1.7, w: 3, h: 1.0, fontSize: 48, bold: true, color: GOLD, margin: 0 });
        s.addText("TOTAL ITEM RUSAK TERCATAT SETAHUN", { x: 0.9, y: 2.65, w: 4, h: 0.4, fontSize: 11, bold: true, color: WHITE, margin: 0 });

        const monthLabels2 = curYear.periods.map((p) => shortMonthID(p));
        s.addShape(pptx.ShapeType.roundRect, { x: 5.2, y: 1.55, w: 7.23, h: 4.0, rectRadius: 0.1, fill: { color: "3D2A72" }, line: { type: "none" } });
        if (perBulan.some((v) => v > 0)) {
          s.addChart(pptx.ChartType.bar, [{ name: "Barang Rusak", labels: monthLabels2, values: perBulan }], {
            x: 5.4, y: 1.75, w: 6.85, h: 3.6, chartColors: ["ef6a6a"],
            showLegend: false, catAxisLabelColor: "B8B0D8", catAxisLabelFontSize: 7.5, catAxisLineColor: "4A3D75",
            valAxisLabelColor: "B8B0D8", valAxisLabelFontSize: 8, valAxisLineColor: "4A3D75",
            valGridLine: { color: "4A3D75", style: "dash", size: 0.5 }, catGridLine: { style: "none" },
            chartArea: { fill: { color: PURPLE_DARK } }, plotArea: { fill: { color: PURPLE_DARK } },
          });
        } else {
          s.addText("Belum ada data Berita Acara tahun ini.", { x: 5.4, y: 3.3, w: 6.85, h: 0.6, fontSize: 12, color: "9188B0", align: "center" });
        }
      }

      // ============================================================
      // SLIDE 11 — KEPATUHAN SOP GABUNGAN (tren 12 bulan)
      // ============================================================
      {
        const s = newSlide();
        s.background = { color: PURPLE_DARK };
        s.addText("Kepatuhan SOP Gabungan", { x: 0.9, y: 0.5, w: 9, h: 0.5, fontSize: 26, bold: true, color: GOLD, margin: 0 });
        s.addText(`Skor gabungan SOP + Stok + Keuangan + Aset, ${year}`, { x: 0.9, y: 1.02, w: 9, h: 0.35, fontSize: 13, color: "B8B0D8", margin: 0 });

        // Pendekatan sederhana: rata-rata Skor SOP & Kesehatan Stok bulanan (proxy kepatuhan
        // gabungan, tanpa hitung ulang total temuan detail 4-sumber).
        const sopMonthlyRef = monthlyAvgSop(curYear);
        const kesMonthlyRef = monthlyAvgKesehatan(curYear);
        const kepMonthly = sopMonthlyRef.map((v, i) => {
          const k = kesMonthlyRef[i];
          if (v == null && k == null) return null;
          if (v == null) return k;
          if (k == null) return v;
          return (v + k) / 2;
        });
        s.addShape(pptx.ShapeType.roundRect, { x: 0.9, y: 1.55, w: 11.53, h: 4.6, rectRadius: 0.1, fill: { color: "3D2A72" }, line: { type: "none" } });
        addBarTargetChart(s, 1.2, 1.85, 10.93, 3.9, kepMonthly, 80, "3ddb9a", "ef6a6a", true);
        s.addText("Proxy dari rata-rata Skor SOP & Kesehatan Stok bulanan \u2014 detail 4-sumber lengkap ada di Kepatuhan SOP tiap bulan.", { x: 1.2, y: 5.85, w: 10.93, h: 0.3, fontSize: 9, italic: true, color: "9188B0", margin: 0 });
      }

      // ============================================================
      // SLIDE 12 — KESIMPULAN & REKOMENDASI
      // ============================================================
      {
        const s = newSlide();
        s.background = { color: PURPLE_DARK };
        s.addText("Kesimpulan & Rekomendasi", { x: 0.9, y: 0.5, w: 9, h: 0.5, fontSize: 26, bold: true, color: GOLD, margin: 0 });
        s.addText(`Ringkasan penutup Laporan Tahunan ${year}`, { x: 0.9, y: 1.02, w: 9, h: 0.35, fontSize: 13, color: "B8B0D8", margin: 0 });

        s.addShape(pptx.ShapeType.roundRect, { x: 0.9, y: 1.6, w: 11.53, h: 4.5, rectRadius: 0.1, fill: { color: "3D2A72" }, line: { type: "none" } });
        const kesimpulanLines = [
          `Rata-rata Skor SOP sepanjang ${year}: ${curSop != null ? curSop.toFixed(1) + "%" : "belum ada data"}.`,
          `Rata-rata Kesehatan Stok: ${curKes != null ? curKes.toFixed(1) + "%" : "belum ada data"}.`,
          `Total item Berita Acara berstatus "Rusak" tahun ini: ${totalRusak}.`,
          `Cabang dengan skor SOP tertinggi: ${branchYearScores[0]?.branch.name || "\u2014"} (${branchYearScores[0]?.avg.toFixed(1) || "\u2014"}%).`,
          top10Temuan.length ? `Temuan paling dominan: "${top10Temuan[0][0]}" (${top10Temuan[0][1]}x sepanjang tahun).` : "Belum ada temuan dominan tercatat.",
        ];
        s.addText(kesimpulanLines.map((t) => ({ text: t, options: { bullet: true, breakLine: true, paraSpaceAfter: 10 } })), { x: 1.2, y: 1.9, w: 11, h: 3.9, fontSize: 13, color: "D8D0F0", margin: 0 });

        s.addText(`Dicetak ${new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })} \u2014 KLA Radar, Divisi Audit Internal PT. KLA Teknologi Indonesia.`, { x: 0.9, y: 6.9, w: 11.5, h: 0.35, fontSize: 9, italic: true, color: "8A80AE", margin: 0 });
      }

      pptx.writeFile({ fileName: `Laporan-Tahunan-${year}${isPersonalView ? "-Personal" : ""}.pptx` });

    } catch (e) {
      setError("Gagal membuat laporan: " + e.message);
    } finally {
      setGenerating(false);
    }
  }

  if (loading) return <div style={{ padding: 40, color: "var(--text-secondary)" }}>Memuat\u2026</div>;

  return (
    <div style={{ flex: 1, padding: 28 }}>
      <div className="display" style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Laporan Tahunan</div>
      <div style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 20 }}>
        Generate PPT ringkasan setahun penuh, dibandingkan ke tahun sebelumnya. <b>Tahap 1 (uji coba): baru Cover + Ringkasan Eksekutif.</b>
      </div>

      {error && <div style={{ marginBottom: 16, background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}

      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, maxWidth: 480 }}>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 5 }}>Tahun</label>
          <select className="input" value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))}>
            {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 5 }}>Cabang</label>
          <BranchMultiSelect branches={branches} selectedIds={selectedBranchIds} onChange={setSelectedBranchIds} />
        </div>
        <button className="btn" disabled={generating || !selectedBranchIds.length} onClick={generatePPT}>
          {generating ? "Membuat PPT\u2026" : "Generate Laporan Tahunan (Tahap 1)"}
        </button>
      </div>
    </div>
  );
}
