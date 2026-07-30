import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { calcWeightedFromRecord, CATS, nowPeriode, periodeLabel, addMonthsToPeriod } from "../lib/sopConfig";
import { kesehatanStatusInfo } from "../lib/stokConfig";
import { countRusak } from "./AuditInventaris";
import BranchMultiSelect from "./BranchMultiSelect";

// ── Warna & style ──
const PURPLE = "2A1F52";
const GOLD = "F4B740";
const GREEN = "1A9E6E";
const AMBER = "B07212";
const RED = "A32020";
const GREY = "888888";
const WHITE = "FFFFFF";

function kondisiSOP(score) {
  if (score >= 85) return { lbl: "Baik", color: GREEN };
  if (score >= 70) return { lbl: "Perlu Perhatian", color: AMBER };
  return { lbl: "Berisiko Tinggi", color: RED };
}

// Definisi modul yang bisa multi-audit per bulan — dipakai buat deteksi & resolusi "audit mana yang dipakai"
const MODULE_DEFS = [
  { key: "sop", label: "SOP" },
  { key: "svc", label: "Service Ratio" },
  { key: "kes", label: "Kesehatan Stok" },
  { key: "keu", label: "Audit Keuangan" },
  { key: "inv", label: "Inventaris" },
];
function dateOfEntry(moduleKey, entry) {
  if (!entry) return null;
  return moduleKey === "keu" ? entry.audit_date : entry.data?.audit_date;
}
function groupByBranch(arr) {
  const map = {};
  (arr || []).forEach((r) => {
    if (!map[r.branch_id]) map[r.branch_id] = [];
    map[r.branch_id].push(r);
  });
  return map;
}
// Pilih entri yang dipakai buat 1 cabang+modul: pakai pilihan manual user kalau ada (multiAuditChoices),
// kalau nggak ada pilihan (atau cuma 1 entri), otomatis pakai yang audit_date-nya paling baru.
function resolveEntry(moduleKey, branchId, grouped, choices) {
  const entries = grouped[branchId];
  if (!entries || !entries.length) return null;
  if (entries.length === 1) return entries[0];
  const chosenDate = choices[`${branchId}|${moduleKey}`];
  if (chosenDate) {
    const match = entries.find((e) => dateOfEntry(moduleKey, e) === chosenDate);
    if (match) return match;
  }
  return [...entries].sort((a, b) => (dateOfEntry(moduleKey, b) || "").localeCompare(dateOfEntry(moduleKey, a) || ""))[0];
}

// ── Kalkulasi Kepatuhan SOP gabungan (4 sumber) — sama persis formula di SopKepatuhan.js ──
const BASELINE = 150;
function countSopTemuan(sopRecord) {
  if (!sopRecord) return 0;
  const checks = sopRecord.data?.checks || {};
  let count = 0;
  CATS.forEach((c) => c.items.forEach((_, i) => { if (!checks[c.id + "_" + i]) count++; }));
  return count;
}
function countStokTemuan(stokRecord) {
  if (!stokRecord || stokRecord.data?.tidak_visit) return 0;
  return Number(stokRecord.data?.temuan_count) || 0;
}
function keuanganSisa(entry) {
  if (!entry) return null;
  if (entry.sisa_saldo !== null && entry.sisa_saldo !== undefined && entry.sisa_saldo !== "") {
    return parseFloat(entry.sisa_saldo) || 0;
  }
  return (parseFloat(entry.saldo_sebelumnya) || 0) + (parseFloat(entry.saldo_masuk) || 0) - (parseFloat(entry.pengeluaran) || 0);
}

// Load pptxgenjs langsung dari CDN (bukan lewat npm/webpack) — biar nggak
// kesandung masalah bundling "node:fs" yang sering muncul di Next.js.
function loadPptxGenJS() {
  return new Promise((resolve, reject) => {
    if (window.PptxGenJS) { resolve(window.PptxGenJS); return; }
    const existing = document.querySelector('script[data-lib="pptxgenjs"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.PptxGenJS));
      existing.addEventListener("error", () => reject(new Error("Gagal memuat pustaka pptxgenjs dari CDN.")));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.bundle.js";
    script.async = true;
    script.dataset.lib = "pptxgenjs";
    script.onload = () => {
      if (window.PptxGenJS) resolve(window.PptxGenJS);
      else reject(new Error("pptxgenjs dimuat tapi tidak ditemukan di window."));
    };
    script.onerror = () => reject(new Error("Gagal memuat pustaka pptxgenjs dari CDN. Cek koneksi internet."));
    document.head.appendChild(script);
  });
}

export default function LaporanBulanan({ profile }) {
  const [period, setPeriod] = useState(nowPeriode());
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [pendingMultiAudit, setPendingMultiAudit] = useState([]); // [{branchId,branchName,moduleKey,moduleLabel,options:[{date,label}]}]
  const [multiAuditChoices, setMultiAuditChoices] = useState({}); // `${branchId}|${moduleKey}` -> audit_date terpilih
  const [showPicker, setShowPicker] = useState(false);
  const [allBranches, setAllBranches] = useState([]);
  const [selectedBranchIds, setSelectedBranchIds] = useState(null); // null = semua cabang

  useEffect(() => {
    supabase.from("branches").select("*").order("name").then(({ data }) => setAllBranches(data || []));
  }, []);

  function addMonths(p, d) { return addMonthsToPeriod(p, d); }

  function changePeriod(delta) {
    setPeriod((p) => addMonths(p, delta));
    setShowPicker(false);
    setPendingMultiAudit([]);
    setMultiAuditChoices({});
    setDone(false);
    setError(null);
  }

  async function generate(choicesOverride) {
    const choices = choicesOverride || multiAuditChoices;
    setGenerating(true);
    setDone(false);
    setError(null);
    try {
      const prevPeriod = addMonths(period, -1);
      setProgress("Mengambil data\u2026");

      const [
        brRes, sopCurRes, sopPrevRes, svcCurRes, svcPrevRes,
        kesCurRes, kesPrevRes, keuCurRes, keuPrevRes, invCurRes, kpiRes, profRes,
      ] = await Promise.all([
        supabase.from("branches").select("*").order("name"),
        supabase.from("audit_generic").select("*").eq("module", "sop").eq("period", period),
        supabase.from("audit_generic").select("*").eq("module", "sop").eq("period", prevPeriod),
        supabase.from("audit_generic").select("*").eq("module", "stok_service").eq("period", period),
        supabase.from("audit_generic").select("*").eq("module", "stok_service").eq("period", prevPeriod),
        supabase.from("audit_generic").select("*").eq("module", "stok_kesehatan").eq("period", period),
        supabase.from("audit_generic").select("*").eq("module", "stok_kesehatan").eq("period", prevPeriod),
        supabase.from("audit_keuangan").select("*").eq("period", period),
        supabase.from("audit_keuangan").select("*").eq("period", prevPeriod),
        supabase.from("audit_generic").select("*").eq("module", "inventaris").eq("period", period),
        supabase.from("audit_kpi").select("*").eq("period", period),
        supabase.from("profiles").select("*"),
      ]);

      const allBr = brRes.data || [];
      if (!allBr.length) throw new Error("Belum ada data cabang.");
      const branches = (!selectedBranchIds || selectedBranchIds.length === 0 || selectedBranchIds.length === allBr.length)
        ? allBr
        : allBr.filter((b) => selectedBranchIds.includes(b.id));
      if (!branches.length) throw new Error("Pilih minimal 1 cabang dulu.");

      // Kelompokkan per cabang (sekarang bisa lebih dari 1 audit per cabang per bulan)
      const groupedCur = {
        sop: groupByBranch(sopCurRes.data), svc: groupByBranch(svcCurRes.data), kes: groupByBranch(kesCurRes.data),
        keu: groupByBranch(keuCurRes.data), inv: groupByBranch(invCurRes.data),
      };
      const groupedPrev = {
        sop: groupByBranch(sopPrevRes.data), svc: groupByBranch(svcPrevRes.data), kes: groupByBranch(kesPrevRes.data),
        keu: groupByBranch(keuPrevRes.data),
      };

      // ── Deteksi cabang yang punya lebih dari 1 audit bulan ini di modul manapun ──
      // Kalau ada yang belum dipastikan pilihannya, tampilkan panel pilihan dulu, jangan lanjut generate.
      const needsChoice = [];
      MODULE_DEFS.forEach((m) => {
        const grouped = groupedCur[m.key];
        Object.keys(grouped).forEach((branchId) => {
          const entries = grouped[branchId];
          if (entries.length <= 1) return;
          const key = `${branchId}|${m.key}`;
          if (choices[key]) return; // sudah dipilih user
          const branch = branches.find((b) => String(b.id) === String(branchId));
          needsChoice.push({
            branchId, branchName: branch?.name || branchId, moduleKey: m.key, moduleLabel: m.label,
            options: [...entries]
              .sort((a, b) => (dateOfEntry(m.key, b) || "").localeCompare(dateOfEntry(m.key, a) || ""))
              .map((e, i, arr) => ({ date: dateOfEntry(m.key, e), label: `Audit ${arr.length - i} (${dateOfEntry(m.key, e) || "?"})` })),
          });
        });
      });

      if (needsChoice.length) {
        setPendingMultiAudit(needsChoice);
        setShowPicker(true);
        setGenerating(false);
        setProgress("");
        return;
      }
      setShowPicker(false);

      const find = (grouped, moduleKey, bid) => resolveEntry(moduleKey, bid, grouped, choices);

      // ── Hitung per cabang ──
      const rows = branches.map((b) => {
        const sopCur = find(groupedCur.sop, "sop", b.id);
        const sopPrev = resolveEntry("sop", b.id, groupedPrev.sop, {});
        const svcCur = find(groupedCur.svc, "svc", b.id);
        const svcPrev = resolveEntry("svc", b.id, groupedPrev.svc, {});
        const kesCur = find(groupedCur.kes, "kes", b.id);
        const kesPrev = resolveEntry("kes", b.id, groupedPrev.kes, {});
        const keuCur = find(groupedCur.keu, "keu", b.id);
        const keuPrev = resolveEntry("keu", b.id, groupedPrev.keu, {});
        const invCur = find(groupedCur.inv, "inv", b.id);

        const tidakVisitSOP = sopCur?.data?.tidak_visit;
        const sopScore = sopCur && !tidakVisitSOP ? calcWeightedFromRecord(sopCur.data) : null;
        const sopScorePrev = sopPrev && !sopPrev.data?.tidak_visit ? calcWeightedFromRecord(sopPrev.data) : null;

        const svcRatio = svcCur ? Number(svcCur.data?.ratio) || 0 : null;
        const svcRatioPrev = svcPrev ? Number(svcPrev.data?.ratio) || 0 : null;

        const kesPct = kesCur && !kesCur.data?.tidak_visit ? Number(kesCur.data?.kesehatan_pct) || 0 : null;
        const kesPctPrev = kesPrev && !kesPrev.data?.tidak_visit ? Number(kesPrev.data?.kesehatan_pct) || 0 : null;
        // Detail lengkap Kesehatan Stok (buat tabel per-cabang di slide) — bulan ini & bulan lalu
        const kesDetail = (rec) => {
          if (!rec) return { hasData: false, tidakVisit: false };
          if (rec.data?.tidak_visit) return { hasData: true, tidakVisit: true };
          return {
            hasData: true, tidakVisit: false,
            temuanCount: Number(rec.data?.temuan_count) || 0,
            bonusCount: Number(rec.data?.bonus_count) || 0,
            untungRugi: Number(rec.data?.untung_rugi) || 0,
            skorTemuan: Number(rec.data?.skor_temuan) || 0,
            skorRugi: Number(rec.data?.skor_rugi) || 0,
            skorTotal: Number(rec.data?.skor_total) || 0,
            pct: Number(rec.data?.kesehatan_pct) || 0,
          };
        };
        const kesCurDetail = kesDetail(kesCur);
        const kesPrevDetail = kesDetail(kesPrev);

        const sisa = keuanganSisa(keuCur);
        const sisaPrev = keuanganSisa(keuPrev);

        // Kepatuhan gabungan
        let kepatuhan = null;
        let totalTemuanBranch = null;
        if (sopCur && !tidakVisitSOP) {
          const sopTemuan = countSopTemuan(sopCur);
          const stokTemuan = countStokTemuan(kesCur);
          const keuanganTemuan = sisa !== null && sisa < 0 ? 1 : 0;
          const asetTemuan = invCur && !invCur.data?.tidak_visit ? countRusak(invCur.data?.categories) : 0;
          totalTemuanBranch = sopTemuan + stokTemuan + keuanganTemuan + asetTemuan;
          kepatuhan = Math.max(0, 1 - totalTemuanBranch / BASELINE);
        }

        // Temuan (foto+catatan) buat slide per-cabang
        const findings = [];
        if (sopCur && !tidakVisitSOP) {
          const checks = sopCur.data?.checks || {};
          const notes = sopCur.data?.notes || {};
          const photos = sopCur.data?.photos || {};
          CATS.forEach((c) => c.items.forEach((text, i) => {
            const key = c.id + "_" + i;
            if (!checks[key]) {
              findings.push({ text, note: notes[key] || "", media: photos[key] || [], cat: c.label });
            }
          }));
        }

        return {
          branch: b, sopCur, sopScore, sopScorePrev, tidakVisitSOP,
          svcRatio, svcRatioPrev, kesPct, kesPctPrev, kesCurDetail, kesPrevDetail, sisa, sisaPrev,
          totalTemuanBranch,
          pengeluaran: keuCur ? parseFloat(keuCur.pengeluaran) || 0 : 0,
          kepatuhan, findings,
        };
      });

      // ── Ringkasan company-wide ──
      const auditedRows = rows.filter((r) => r.sopScore !== null);
      const kondisiBaik = auditedRows.filter((r) => kondisiSOP(r.sopScore).lbl === "Baik").length;
      const kondisiPerhatian = auditedRows.filter((r) => kondisiSOP(r.sopScore).lbl === "Perlu Perhatian").length;
      const kondisiBerisiko = auditedRows.filter((r) => kondisiSOP(r.sopScore).lbl === "Berisiko Tinggi").length;

      // Temuan domain: kategori dengan gagal terbanyak company-wide (dipakai di slide rekomendasi)
      const catFailCount = {};
      auditedRows.forEach((r) => {
        const cats = r.sopCur?.data?.cats || {};
        Object.keys(cats).forEach((catId) => {
          const bd = cats[catId];
          const fail = (bd.total || 0) - (bd.score || 0);
          catFailCount[catId] = (catFailCount[catId] || 0) + fail;
        });
      });
      const catLabelMap = {};
      CATS.forEach((c) => { catLabelMap[c.id] = c.label; });
      const topDomain = Object.entries(catFailCount).sort((a, b) => b[1] - a[1]).slice(0, 2)
        .map(([id, n]) => `${catLabelMap[id] || id} (${n} temuan)`);

      // Temuan terbanyak: item checklist SPESIFIK (bukan kategori) yang paling sering gagal,
      // dihitung dari cabang-cabang yang lolos filter (`auditedRows`, sudah sesuai pilihan auditor).
      const itemFailCount = {};
      auditedRows.forEach((r) => {
        const checks = r.sopCur?.data?.checks || {};
        CATS.forEach((c) => c.items.forEach((text, i) => {
          const key = c.id + "_" + i;
          if (!checks[key]) itemFailCount[key] = (itemFailCount[key] || 0) + 1;
        }));
      });
      const itemTextMap = {};
      CATS.forEach((c) => c.items.forEach((text, i) => { itemTextMap[c.id + "_" + i] = text; }));
      const top5Temuan = Object.entries(itemFailCount).sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([key, n]) => ({ text: itemTextMap[key] || key, count: n }));

      const avgSvc = (list) => { const v = list.filter((x) => x !== null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
      const svcNow = avgSvc(rows.map((r) => r.svcRatio));
      const svcPrevAvg = avgSvc(rows.map((r) => r.svcRatioPrev));
      const kesNow = avgSvc(rows.map((r) => r.kesPct));
      const kesPrevAvg = avgSvc(rows.map((r) => r.kesPctPrev));

      const negBalanceNow = rows.filter((r) => r.sisa !== null && r.sisa < 0).length;
      const negBalancePrev = rows.filter((r) => r.sisaPrev !== null && r.sisaPrev < 0).length;
      const totalKasKeluar = rows.reduce((s, r) => s + r.pengeluaran, 0);

      const kepatuhanRows = rows.filter((r) => r.kepatuhan !== null);
      const kepatuhanAvg = kepatuhanRows.length ? kepatuhanRows.reduce((s, r) => s + r.kepatuhan, 0) / kepatuhanRows.length : null;
      const totalTemuanKepatuhan = kepatuhanRows.reduce((s, r) => s + Math.round((1 - r.kepatuhan) * BASELINE), 0);

      const rankedSOP = [...auditedRows].sort((a, b) => b.sopScore - a.sopScore);

      setProgress("Menyusun slide\u2026");

      // ══════════════ BUILD PPTX ══════════════
      const PptxGenJS = await loadPptxGenJS();
      const pptx = new PptxGenJS();
      pptx.layout = "LAYOUT_WIDE";
      pptx.author = "KLA Radar";
      pptx.title = `Laporan Audit Internal ${periodeLabel(period)}`;

      function addHeader(slide, tag) {
        slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.55, fill: { color: PURPLE } });
        slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.55, w: 13.33, h: 0.04, fill: { color: GOLD } });
        slide.addText(tag, { x: 0.4, y: 0, w: 8, h: 0.55, fontSize: 13, bold: true, color: WHITE, valign: "middle", margin: 0 });
        slide.addText(periodeLabel(period), { x: 9.5, y: 0, w: 3.4, h: 0.55, fontSize: 11, color: GOLD, align: "right", valign: "middle", margin: 0 });
      }

      // ── 1. Cover ──
      {
        const s = pptx.addSlide();
        s.background = { color: PURPLE };
        s.addShape(pptx.ShapeType.rect, { x: 0, y: 3.5, w: 13.33, h: 0.06, fill: { color: GOLD } });
        s.addText("KLA COMPUTER", { x: 0, y: 2.0, w: 13.33, h: 0.6, align: "center", fontSize: 20, color: GOLD, bold: true, charSpacing: 4, margin: 0 });
        s.addText("REPORT MONTHLY", { x: 0, y: 2.6, w: 13.33, h: 0.9, align: "center", fontSize: 40, color: WHITE, bold: true, margin: 0 });
        s.addText(periodeLabel(period), { x: 0, y: 3.75, w: 13.33, h: 0.6, align: "center", fontSize: 22, color: "CFC7E6", margin: 0 });
        s.addText("Divisi Audit Internal \u2014 PT. KLA Teknologi Indonesia", { x: 0, y: 5.0, w: 13.33, h: 0.4, align: "center", fontSize: 12, color: "8b7fb0", margin: 0 });
      }

      // ── 2. Tujuan & Ruang Lingkup ──
      {
        const s = pptx.addSlide();
        addHeader(s, "Tujuan dan Ruang Lingkup");
        s.addText("Tujuan", { x: 0.6, y: 0.9, w: 5.8, h: 0.4, fontSize: 16, bold: true, color: PURPLE, margin: 0 });
        const tujuan = [
          "Menilai pengelolaan stok barang di seluruh cabang",
          "Menilai Kesehatan Stok dan potensi risiko selisih",
          "Memastikan aset & Inventaris tercatat dan terjaga",
          "Menilai kepatuhan SOP Operasional",
          "Menilai pengelolaan keuangan & kas kecil",
          "Mengidentifikasi temuan & area perbaikan cabang",
        ];
        s.addText(tujuan.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < tujuan.length - 1, paraSpaceAfter: 8 } })), { x: 0.6, y: 1.35, w: 5.8, h: 3.5, fontSize: 13, color: "333333" });

        s.addText("Ruang Lingkup", { x: 6.9, y: 0.9, w: 5.8, h: 0.4, fontSize: 16, bold: true, color: PURPLE, margin: 0 });
        const ruang = [
          "Audit stok barang & display",
          "Audit Inventaris",
          "Audit kas kecil",
          "Audit kepatuhan SOP",
          `Audit dilakukan pada ${branches.length} Cabang`,
        ];
        s.addText(ruang.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < ruang.length - 1, paraSpaceAfter: 8 } })), { x: 6.9, y: 1.35, w: 5.8, h: 3.5, fontSize: 13, color: "333333" });
      }

      // ── 3. Ringkasan Hasil Audit ──
      {
        const s = pptx.addSlide();
        s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 1.15, fill: { color: PURPLE } });
        s.addShape(pptx.ShapeType.rect, { x: 0, y: 1.15, w: 13.33, h: 0.04, fill: { color: GOLD } });
        s.addText("RINGKASAN HASIL AUDIT", { x: 0.4, y: 0.15, w: 9, h: 0.5, fontSize: 24, bold: true, color: WHITE, margin: 0 });
        s.addText([
          { text: `\u{1F4C5} Periode Audit: ${periodeLabel(period)}`, options: { fontSize: 12, color: "E4DCFF", bold: true } },
          { text: "     |     ", options: { fontSize: 12, color: "8A7BC2" } },
          { text: `\u{1F3EA} Total Cabang di Audit: ${branches.length} Cabang`, options: { fontSize: 12, color: "E4DCFF", bold: true } },
        ], { x: 0.4, y: 0.72, w: 9, h: 0.35, margin: 0 });
        s.addShape(pptx.ShapeType.roundRect, { x: 11.55, y: 0.28, w: 1.55, h: 0.6, rectRadius: 0.06, fill: { color: "1A1240" } });
        s.addText("KLA", { x: 11.55, y: 0.3, w: 1.55, h: 0.3, fontSize: 14, bold: true, color: GOLD, align: "center", margin: 0 });
        s.addText("COMPUTER", { x: 11.55, y: 0.58, w: 1.55, h: 0.22, fontSize: 6.5, bold: true, color: WHITE, align: "center", margin: 0 });

        // ── Kiri: Summary Audit ──
        s.addShape(pptx.ShapeType.ellipse, { x: 0.4, y: 1.45, w: 0.55, h: 0.55, fill: { color: PURPLE } });
        s.addText("\u{1F4CB}", { x: 0.4, y: 1.45, w: 0.55, h: 0.55, fontSize: 16, align: "center", valign: "middle", margin: 0 });
        s.addText("SUMMARY AUDIT", { x: 1.05, y: 1.5, w: 4.5, h: 0.45, fontSize: 16, bold: true, color: PURPLE, margin: 0 });
        s.addShape(pptx.ShapeType.line, { x: 1.05, y: 1.98, w: 1.6, h: 0, line: { color: PURPLE, width: 1.5 } });

        const summaryCards = [
          { icon: "\u{1F3E0}", label: "Total Cabang di Audit", value: `${auditedRows.length} Cabang`, bg: "EDE9FB", fg: PURPLE },
          { icon: "\u{1F44D}", label: "Cabang Kondisi Baik", value: `${kondisiBaik} Cabang`, bg: "E3F6EC", fg: GREEN },
          { icon: "\u26A0", label: "Cabang Perlu Perhatian", value: `${kondisiPerhatian} Cabang`, bg: "FDF0DC", fg: AMBER },
          { icon: "\u26D4", label: "Cabang Berisiko Tinggi", value: `${kondisiBerisiko} Cabang`, bg: "FBE4E4", fg: RED },
        ];
        summaryCards.forEach((c, i) => {
          const yy = 2.25 + i * 1.15;
          s.addShape(pptx.ShapeType.roundRect, { x: 0.4, y: yy, w: 5.4, h: 0.98, rectRadius: 0.08, fill: { color: "FBFAFF" }, line: { color: "E9E4F5", width: 1 } });
          s.addShape(pptx.ShapeType.rect, { x: 0.4, y: yy, w: 0.06, h: 0.98, fill: { color: c.fg } });
          s.addShape(pptx.ShapeType.roundRect, { x: 0.65, y: yy + 0.19, w: 0.6, h: 0.6, rectRadius: 0.1, fill: { color: c.bg } });
          s.addText(c.icon, { x: 0.65, y: yy + 0.19, w: 0.6, h: 0.6, fontSize: 18, align: "center", valign: "middle", margin: 0 });
          s.addText(c.label, { x: 1.5, y: yy + 0.14, w: 4.1, h: 0.32, fontSize: 11.5, color: "444444", margin: 0 });
          s.addText(c.value, { x: 1.5, y: yy + 0.44, w: 4.1, h: 0.45, fontSize: 19, bold: true, color: c.fg, margin: 0 });
        });

        // ── Kanan: Temuan Terbanyak ──
        s.addShape(pptx.ShapeType.ellipse, { x: 6.9, y: 1.45, w: 0.55, h: 0.55, fill: { color: PURPLE } });
        s.addText("\u2757", { x: 6.9, y: 1.45, w: 0.55, h: 0.55, fontSize: 16, align: "center", valign: "middle", margin: 0, color: WHITE });
        s.addText("TEMUAN TERBANYAK", { x: 7.55, y: 1.5, w: 5.3, h: 0.45, fontSize: 16, bold: true, color: PURPLE, margin: 0 });
        s.addShape(pptx.ShapeType.line, { x: 7.55, y: 1.98, w: 1.6, h: 0, line: { color: PURPLE, width: 1.5 } });

        if (top5Temuan.length) {
          top5Temuan.forEach((item, i) => {
            const yy = 2.3 + i * 0.98;
            s.addShape(pptx.ShapeType.roundRect, { x: 6.9, y: yy, w: 0.48, h: 0.48, rectRadius: 0.1, fill: { color: PURPLE } });
            s.addText(String(i + 1), { x: 6.9, y: yy, w: 0.48, h: 0.48, fontSize: 16, bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });
            s.addText(item.text, { x: 7.58, y: yy - 0.03, w: 5.25, h: 0.6, fontSize: 12.5, bold: true, color: "222222", valign: "middle", margin: 0 });
            if (i < top5Temuan.length - 1) {
              s.addShape(pptx.ShapeType.line, { x: 6.9, y: yy + 0.72, w: 5.8, h: 0, line: { color: "DDDDDD", width: 0.75, dashType: "dash" } });
            }
          });
        } else {
          s.addText("Tidak ada temuan signifikan bulan ini.", { x: 6.9, y: 2.3, w: 5.8, h: 0.6, fontSize: 12, color: "666666" });
        }
      }

      // ── 4. Kesehatan Stok ──
      {
        const s = pptx.addSlide();
        s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.85, fill: { color: PURPLE } });
        s.addShape(pptx.ShapeType.rect, { x: 0, y: 0.85, w: 13.33, h: 0.04, fill: { color: GOLD } });
        s.addText("KESEHATAN STOK CABANG", { x: 0.35, y: 0.08, w: 9, h: 0.42, fontSize: 20, bold: true, color: WHITE, margin: 0 });
        s.addText(`${periodeLabel(prevPeriod)} & ${periodeLabel(period)}`, { x: 0.35, y: 0.48, w: 9, h: 0.32, fontSize: 12, color: "E4DCFF", margin: 0 });
        s.addText("KLA COMPUTER", { x: 9.8, y: 0.25, w: 3.2, h: 0.4, fontSize: 15, bold: true, color: GOLD, align: "right", margin: 0 });

        const kesRowsPrevAll = branches.map((b) => rows.find((r) => r.branch.id === b.id)).filter(Boolean);
        const kesRowsNowAll = kesRowsPrevAll;

        const kesTh = [
          { text: "No", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 7, align: "center" } },
          { text: "Cabang", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 7 } },
          { text: "Sk. Temuan", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 7, align: "center" } },
          { text: "Sk. Rugi", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 7, align: "center" } },
          { text: "Sk. Total", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 7, align: "center" } },
          { text: "Indikator", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 7, align: "center" } },
          { text: "% Sehat", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 7, align: "center" } },
        ];
        function kesTableRows(detailKey) {
          const body = kesRowsPrevAll.map((r, i) => {
            const d = r[detailKey];
            if (!d || !d.hasData || d.tidakVisit) {
              return [
                { text: String(i + 1), options: { fontSize: 6.8, align: "center" } },
                { text: r.branch.name, options: { fontSize: 6.8, bold: true } },
                { text: "TIDAK VISIT", options: { colspan: 5, fontSize: 6.8, bold: true, align: "center", fill: { color: "DDE6F7" }, color: PURPLE } },
              ];
            }
            const info = kesehatanStatusInfo(d.pct);
            return [
              { text: String(i + 1), options: { fontSize: 6.8, align: "center" } },
              { text: r.branch.name, options: { fontSize: 6.8, bold: true } },
              { text: String(d.skorTemuan), options: { fontSize: 6.8, align: "center" } },
              { text: String(d.skorRugi), options: { fontSize: 6.8, align: "center" } },
              { text: String(d.skorTotal), options: { fontSize: 6.8, align: "center", bold: true } },
              { text: info.lbl, options: { fontSize: 6.3, align: "center", bold: true, color: WHITE, fill: { color: info.color.replace("#", "") } } },
              { text: `${Math.round(d.pct * 100)}%`, options: { fontSize: 7, align: "center", bold: true, color: d.pct < 0.5 ? RED : "333333" } },
            ];
          });
          const validPct = kesRowsPrevAll.map((r) => r[detailKey]).filter((d) => d && d.hasData && !d.tidakVisit).map((d) => d.pct);
          const avgPct = validPct.length ? validPct.reduce((s, v) => s + v, 0) / validPct.length : 0;
          const totalSkor = kesRowsPrevAll.map((r) => r[detailKey]).filter((d) => d && d.hasData && !d.tidakVisit).reduce((s, d) => s + d.skorTotal, 0);
          body.push([
            { text: "TOTAL / RATA-RATA", options: { colspan: 4, fontSize: 7, bold: true, fill: { color: PURPLE }, color: WHITE } },
            { text: String(totalSkor), options: { fontSize: 7, bold: true, align: "center", fill: { color: PURPLE }, color: WHITE } },
            { text: "", options: { fill: { color: PURPLE } } },
            { text: `${Math.round(avgPct * 100)}%`, options: { fontSize: 7, bold: true, align: "center", fill: { color: PURPLE }, color: WHITE } },
          ]);
          return body;
        }

        s.addText(`BULAN LALU \u2014 ${periodeLabel(prevPeriod)}`, { x: 0.3, y: 0.98, w: 8.2, h: 0.25, fontSize: 11, bold: true, color: PURPLE, margin: 0 });
        s.addTable([kesTh].concat(kesTableRows("kesPrevDetail")), { x: 0.3, y: 1.25, w: 8.2, colW: [0.4, 2.1, 1.1, 0.9, 1.0, 1.4, 1.3], border: { type: "solid", color: "E5E5E5", pt: 0.5 }, autoPage: false });

        s.addText(`BULAN INI \u2014 ${periodeLabel(period)}`, { x: 0.3, y: 4.05, w: 8.2, h: 0.25, fontSize: 11, bold: true, color: PURPLE, margin: 0 });
        s.addTable([kesTh].concat(kesTableRows("kesCurDetail")), { x: 0.3, y: 4.32, w: 8.2, colW: [0.4, 2.1, 1.1, 0.9, 1.0, 1.4, 1.3], border: { type: "solid", color: "E5E5E5", pt: 0.5 }, autoPage: false });

        // ── Kartu kanan ──
        const cardX = 8.85, cardW = 4.15;
        s.addShape(pptx.ShapeType.roundRect, { x: cardX, y: 0.98, w: 1.98, h: 1.15, rectRadius: 0.06, fill: { color: "F7F6FB" }, line: { color: "E4DFF2", width: 0.75 } });
        s.addText(`RATA-RATA\n${periodeLabel(prevPeriod).toUpperCase()}`, { x: cardX + 0.1, y: 1.03, w: 1.78, h: 0.4, fontSize: 7.5, bold: true, color: GREY, align: "center", margin: 0 });
        s.addText(kesPrevAvg !== null ? `${Math.round(kesPrevAvg * 100)}%` : "\u2014", { x: cardX + 0.1, y: 1.4, w: 1.78, h: 0.6, fontSize: 26, bold: true, color: PURPLE, align: "center", margin: 0 });

        s.addShape(pptx.ShapeType.roundRect, { x: cardX + 2.15, y: 0.98, w: 2.0, h: 1.15, rectRadius: 0.06, fill: { color: "F7F6FB" }, line: { color: "E4DFF2", width: 0.75 } });
        s.addText(`RATA-RATA\n${periodeLabel(period).toUpperCase()}`, { x: cardX + 2.25, y: 1.03, w: 1.8, h: 0.4, fontSize: 7.5, bold: true, color: GREY, align: "center", margin: 0 });
        s.addText(kesNow !== null ? `${Math.round(kesNow * 100)}%` : "\u2014", { x: cardX + 2.25, y: 1.4, w: 1.8, h: 0.6, fontSize: 26, bold: true, color: PURPLE, align: "center", margin: 0 });

        const trendUp = kesPrevAvg !== null && kesNow !== null && kesNow >= kesPrevAvg;
        s.addShape(pptx.ShapeType.roundRect, { x: cardX, y: 2.25, w: cardW, h: 0.95, rectRadius: 0.06, fill: { color: "F7F6FB" }, line: { color: "E4DFF2", width: 0.75 } });
        s.addText("PERBANDINGAN", { x: cardX + 0.15, y: 2.32, w: 2.6, h: 0.25, fontSize: 7.5, bold: true, color: GREY, margin: 0 });
        s.addText(trendUp ? "MEMBAIK" : "MENURUN", { x: cardX + 0.15, y: 2.55, w: 2.6, h: 0.35, fontSize: 15, bold: true, color: trendUp ? GREEN : RED, margin: 0 });
        s.addText(kesPrevAvg !== null && kesNow !== null ? `${Math.round(kesPrevAvg * 100)}% \u2192 ${Math.round(kesNow * 100)}%` : "\u2014", { x: cardX + 0.15, y: 2.9, w: 2.6, h: 0.25, fontSize: 9, color: "555555", margin: 0 });
        if (kesPrevAvg !== null && kesNow !== null) {
          s.addText(`${trendUp ? "\u25B2" : "\u25BC"} ${Math.abs(Math.round((kesNow - kesPrevAvg) * 100))} poin`, { x: cardX + 2.75, y: 2.5, w: 1.3, h: 0.5, fontSize: 17, bold: true, color: trendUp ? GREEN : RED, align: "right", margin: 0 });
        }

        s.addShape(pptx.ShapeType.roundRect, { x: cardX, y: 3.35, w: cardW, h: 1.85, rectRadius: 0.06, fill: { color: "F7F6FB" }, line: { color: "E4DFF2", width: 0.75 } });
        s.addText("RINGKASAN", { x: cardX + 0.15, y: 3.42, w: 3.8, h: 0.3, fontSize: 11, bold: true, color: PURPLE, margin: 0 });
        const kesBermasalahBranches = rows.filter((r) => r.kesPct !== null && r.kesPct < 0.7).map((r) => r.branch.name);
        const ringkasanLines = [
          kesPrevAvg !== null && kesNow !== null
            ? `Rata-rata kesehatan stok cabang ${trendUp ? "membaik" : "menurun"} dari ${Math.round(kesPrevAvg * 100)}% menjadi ${Math.round(kesNow * 100)}%.`
            : "Data pembanding bulan lalu belum lengkap.",
          kesBermasalahBranches.length
            ? `Perlu monitoring & tindak lanjut pada cabang: ${kesBermasalahBranches.join(", ")}.`
            : "Semua cabang berada di atas ambang aman bulan ini.",
        ];
        s.addText(ringkasanLines.map((t) => ({ text: t, options: { bullet: { code: "2022" }, breakLine: true, paraSpaceAfter: 6 } })), { x: cardX + 0.15, y: 3.75, w: 3.85, h: 1.4, fontSize: 10.5, color: "444444", valign: "top", margin: 0 });

        s.addShape(pptx.ShapeType.roundRect, { x: cardX, y: 5.35, w: cardW, h: 1.95, rectRadius: 0.06, fill: { color: "F7F6FB" }, line: { color: "E4DFF2", width: 0.75 } });
        s.addText("KETERANGAN INDIKATOR", { x: cardX + 0.15, y: 5.42, w: 3.8, h: 0.25, fontSize: 9.5, bold: true, color: PURPLE, margin: 0 });
        const legendItems = [
          { c: GREEN, l: "Terkendali", r: "\u226585%", d: "Kondisi sangat baik" },
          { c: "2f9e9e", l: "Waspada", r: "70-84%", d: "Temuan ringan, masih toleran" },
          { c: AMBER, l: "Monitoring", r: "50-69%", d: "Perlu tindakan korektif" },
          { c: RED, l: "Perlu Perhatian", r: "<50%", d: "Risiko tinggi, tindak lanjut" },
        ];
        legendItems.forEach((it, i) => {
          const yy = 5.72 + i * 0.36;
          s.addShape(pptx.ShapeType.ellipse, { x: cardX + 0.18, y: yy + 0.04, w: 0.11, h: 0.11, fill: { color: it.c } });
          s.addText(it.l, { x: cardX + 0.4, y: yy, w: 1.15, h: 0.3, fontSize: 8.5, bold: true, color: "222222", margin: 0 });
          s.addText(it.r, { x: cardX + 1.55, y: yy, w: 0.75, h: 0.3, fontSize: 8, color: "666666", margin: 0 });
          s.addText(it.d, { x: cardX + 2.3, y: yy, w: 1.7, h: 0.3, fontSize: 7.5, color: "777777", margin: 0 });
        });
      }

      // ── 5. Service Ratio ──
      {
        const s = pptx.addSlide();
        addHeader(s, "Service Ratio Cabang");
        const trendGood = svcPrevAvg !== null && svcNow !== null && svcNow <= svcPrevAvg;
        s.addText(`${svcNow !== null ? (svcNow * 100).toFixed(2) : "\u2014"}%`, { x: 0.6, y: 1.1, w: 4, h: 1.3, fontSize: 60, bold: true, color: PURPLE, margin: 0 });
        s.addText("Rata-rata Service Ratio bulan ini", { x: 0.6, y: 2.3, w: 4, h: 0.4, fontSize: 12, color: GREY, margin: 0 });
        s.addText(svcPrevAvg !== null ? `${trendGood ? "\u25BC (membaik)" : "\u25B2 (naik)"} dari ${(svcPrevAvg * 100).toFixed(2)}% bulan lalu` : "Belum ada data bulan lalu", { x: 0.6, y: 2.75, w: 4, h: 0.4, fontSize: 12, bold: true, color: trendGood ? GREEN : RED, margin: 0 });

        const svcRows = rows.filter((r) => r.svcRatio !== null).sort((a, b) => b.svcRatio - a.svcRatio).slice(0, 8);
        s.addTable(
          [[{ text: "Cabang", options: { bold: true, fill: { color: PURPLE }, color: WHITE, fontSize: 11 } }, { text: "Ratio", options: { bold: true, fill: { color: PURPLE }, color: WHITE, fontSize: 11, align: "center" } }]]
            .concat(svcRows.map((r) => ([{ text: r.branch.name, options: { fontSize: 11 } }, { text: `${(r.svcRatio * 100).toFixed(2)}%`, options: { fontSize: 11, align: "center", bold: true, color: r.svcRatio >= 0.0033 ? RED : "333333" } }]))),
          { x: 5.4, y: 1.1, w: 7.3, colW: [4.5, 2.8], border: { type: "solid", color: "E5E5E5", pt: 0.5 }, autoPage: false }
        );
      }

      // ── 6. Penggunaan Kas Kecil ──
      {
        const s = pptx.addSlide();
        addHeader(s, "Penggunaan Kas Kecil");
        s.addText(`Rp${totalKasKeluar.toLocaleString("id-ID")}`, { x: 0.6, y: 1.1, w: 6, h: 1, fontSize: 36, bold: true, color: PURPLE, margin: 0 });
        s.addText("Total pengeluaran kas kecil seluruh cabang bulan ini", { x: 0.6, y: 2.0, w: 6, h: 0.4, fontSize: 12, color: GREY, margin: 0 });

        s.addText(`${negBalanceNow}`, { x: 0.6, y: 2.7, w: 2, h: 1, fontSize: 40, bold: true, color: negBalanceNow > 0 ? RED : GREEN, margin: 0 });
        s.addText("Cabang saldo minus", { x: 0.6, y: 3.6, w: 3, h: 0.4, fontSize: 11, color: GREY, margin: 0 });
        s.addText(negBalancePrev !== null ? `Bulan lalu: ${negBalancePrev} cabang` : "", { x: 0.6, y: 3.95, w: 3, h: 0.4, fontSize: 10, color: GREY, margin: 0 });

        const negRows = rows.filter((r) => r.sisa !== null && r.sisa < 0);
        if (negRows.length) {
          s.addText("Cabang saldo minus bulan ini:", { x: 5.4, y: 1.1, w: 7.3, h: 0.35, fontSize: 13, bold: true, color: RED, margin: 0 });
          s.addText(negRows.map((r, i) => ({ text: `${r.branch.name} (Rp${r.sisa.toLocaleString("id-ID")})`, options: { bullet: true, breakLine: i < negRows.length - 1, paraSpaceAfter: 6 } })), { x: 5.4, y: 1.55, w: 7.3, h: 3, fontSize: 12, color: "333333" });
        } else {
          s.addText("Tidak ada cabang dengan saldo minus bulan ini.", { x: 5.4, y: 1.1, w: 7.3, h: 0.6, fontSize: 13, color: GREEN, bold: true, margin: 0 });
        }
      }

      // ── 7. Kepatuhan SOP (gabungan) ──
      {
        const s = pptx.addSlide();
        addHeader(s, "Kepatuhan SOP");
        s.addText(kepatuhanAvg !== null ? `${Math.round(kepatuhanAvg * 100)}%` : "\u2014", { x: 0.6, y: 1.1, w: 4, h: 1.3, fontSize: 60, bold: true, color: PURPLE, margin: 0 });
        s.addText("% Skor Kepatuhan (gabungan Operasional, Stok, Keuangan, Aset)", { x: 0.6, y: 2.35, w: 4.3, h: 0.6, fontSize: 11, color: GREY, margin: 0 });
        s.addText(`${totalTemuanKepatuhan}`, { x: 0.6, y: 3.1, w: 2, h: 0.8, fontSize: 30, bold: true, color: RED, margin: 0 });
        s.addText("Total temuan bulan ini", { x: 0.6, y: 3.75, w: 3, h: 0.4, fontSize: 11, color: GREY, margin: 0 });

        const kepRows = [...kepatuhanRows].sort((a, b) => a.kepatuhan - b.kepatuhan).slice(0, 8);
        s.addTable(
          [[{ text: "Cabang", options: { bold: true, fill: { color: PURPLE }, color: WHITE, fontSize: 11 } }, { text: "% Skor", options: { bold: true, fill: { color: PURPLE }, color: WHITE, fontSize: 11, align: "center" } }]]
            .concat(kepRows.map((r) => ([{ text: r.branch.name, options: { fontSize: 11 } }, { text: `${Math.round(r.kepatuhan * 100)}%`, options: { fontSize: 11, align: "center", bold: true, color: r.kepatuhan * 100 < 70 ? RED : "333333" } }]))),
          { x: 5.4, y: 1.1, w: 7.3, colW: [4.5, 2.8], border: { type: "solid", color: "E5E5E5", pt: 0.5 }, autoPage: false }
        );
      }

      // ── 8..N. Temuan per cabang (cuma yang ada temuan) ──
      const branchesWithFindings = rows.filter((r) => r.findings.length > 0);
      branchesWithFindings.forEach((r) => {
        const withMedia = r.findings.filter((f) => f.media && f.media.length);
        const chunks = [];
        if (withMedia.length === 0) {
          chunks.push([]);
        } else {
          for (let i = 0; i < withMedia.length; i += 3) chunks.push(withMedia.slice(i, i + 3));
        }
        chunks.forEach((chunk, pageIdx) => {
          const s = pptx.addSlide();
          addHeader(s, `${r.branch.name.toUpperCase()} \u2014 Temuan`);
          if (chunk.length === 0) {
            const textList = r.findings.slice(0, 10).map((f) => f.note ? `${f.text}: ${f.note}` : f.text);
            s.addText(textList.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < textList.length - 1, paraSpaceAfter: 8 } })), { x: 0.6, y: 1.0, w: 12, h: 4, fontSize: 13, color: "333333" });
          } else {
            const colW = 12 / chunk.length;
            chunk.forEach((f, ci) => {
              const x = 0.6 + ci * colW;
              const media = f.media[0];
              if (media.type === "video") {
                s.addShape(pptx.ShapeType.rect, { x: x + 0.15, y: 1.0, w: colW - 0.3, h: 3, fill: { color: "F0EDF7" } });
                s.addText("\u25B6 Video", { x: x + 0.15, y: 2.3, w: colW - 0.3, h: 0.4, align: "center", fontSize: 14, color: PURPLE });
              } else {
                try { s.addImage({ path: media.url, x: x + 0.15, y: 1.0, w: colW - 0.3, h: 3, sizing: { type: "cover", w: colW - 0.3, h: 3 } }); } catch (e) { /* skip broken image */ }
              }
              s.addText(f.text, { x: x + 0.15, y: 4.1, w: colW - 0.3, h: 0.4, fontSize: 10.5, bold: true, color: PURPLE, margin: 0 });
              if (f.note) s.addText(f.note, { x: x + 0.15, y: 4.5, w: colW - 0.3, h: 0.7, fontSize: 9.5, color: "555555", margin: 0 });
            });
          }
          if (chunks.length > 1) s.addText(`Halaman ${pageIdx + 1} / ${chunks.length}`, { x: 11.5, y: 6.9, w: 1.5, h: 0.3, fontSize: 8, color: GREY, align: "right", margin: 0 });
        });
      });

      // ── Ranking Cabang SOP ──
      {
        const s = pptx.addSlide();
        addHeader(s, "Ranking Cabang SOP");
        const top5 = rankedSOP.slice(0, 5);
        const medals = ["\uD83D\uDC51", "\uD83E\uDD48", "\uD83E\uDD49", "\uD83C\uDFC5", "\uD83C\uDFC5"];
        top5.forEach((r, i) => {
          const y = 1.0 + i * 1.05;
          s.addShape(pptx.ShapeType.roundRect, { x: 0.6, y, w: 12.1, h: 0.9, fill: { color: i === 0 ? "FBF3E0" : "FAFAFD" }, line: { color: i === 0 ? GOLD : "E5E5E5", width: 1 }, rectRadius: 0.08 });
          s.addText(medals[i] || "", { x: 0.8, y, w: 0.7, h: 0.9, fontSize: 26, valign: "middle", align: "center", margin: 0 });
          s.addText(r.branch.name, { x: 1.6, y, w: 8, h: 0.9, fontSize: 16, bold: true, color: PURPLE, valign: "middle", margin: 0 });
          s.addText(`${r.sopScore}%`, { x: 10.5, y, w: 2, h: 0.9, fontSize: 22, bold: true, color: kondisiSOP(r.sopScore).color, valign: "middle", align: "right", margin: 0 });
        });
        if (!top5.length) s.addText("Belum ada cabang yang diaudit periode ini.", { x: 0.6, y: 1.5, w: 12, h: 0.6, fontSize: 14, color: GREY });
      }

      // ── KPI Audit Internal ──
      {
        const s = pptx.addSlide();
        addHeader(s, "KPI Audit Internal");
        const kpiData = (kpiRes.data || []).map((k) => {
          const prof = (profRes.data || []).find((p) => p.id === k.auditor_id);
          return { name: prof?.full_name || "\u2014", ...k };
        });
        const kpiRows = [[
          { text: "Auditor", options: { bold: true, fill: { color: PURPLE }, color: WHITE, fontSize: 11 } },
          { text: "Coverage", options: { bold: true, fill: { color: PURPLE }, color: WHITE, fontSize: 11, align: "center" } },
          { text: "Kepatuhan SOP", options: { bold: true, fill: { color: PURPLE }, color: WHITE, fontSize: 11, align: "center" } },
          { text: "Temuan Berulang", options: { bold: true, fill: { color: PURPLE }, color: WHITE, fontSize: 11, align: "center" } },
          { text: "Jml Temuan", options: { bold: true, fill: { color: PURPLE }, color: WHITE, fontSize: 11, align: "center" } },
          { text: "Ketepatan Laporan", options: { bold: true, fill: { color: PURPLE }, color: WHITE, fontSize: 11, align: "center" } },
        ]].concat(
          kpiData.length ? kpiData.map((k) => ([
            { text: k.name, options: { fontSize: 11 } },
            { text: String(k.realisasi_coverage ?? "\u2014"), options: { fontSize: 11, align: "center" } },
            { text: k.realisasi_kepatuhan_sop != null ? `${Math.round(k.realisasi_kepatuhan_sop * 100)}%` : "\u2014", options: { fontSize: 11, align: "center" } },
            { text: String(k.realisasi_temuan_berulang ?? "\u2014"), options: { fontSize: 11, align: "center" } },
            { text: String(k.realisasi_temuan_audit ?? "\u2014"), options: { fontSize: 11, align: "center" } },
            { text: String(k.realisasi_ketepatan_laporan ?? "\u2014"), options: { fontSize: 11, align: "center" } },
          ])) : [[{ text: "Belum ada data KPI periode ini.", options: { colspan: 6, fontSize: 12, color: GREY, align: "center" } }]]
        );
        s.addTable(kpiRows, { x: 0.6, y: 1.1, w: 12.1, border: { type: "solid", color: "E5E5E5", pt: 0.5 }, autoPage: false });
      }

      // ── Kesimpulan ──
      {
        const s = pptx.addSlide();
        addHeader(s, "Kesimpulan");
        const poin = [];
        poin.push(`Secara umum, ${kondisiBaik} dari ${auditedRows.length} cabang berada dalam kondisi Baik pada periode ${periodeLabel(period)}.`);
        if (kesPrevAvg !== null && kesNow !== null) poin.push(`Kesehatan Stok ${kesNow >= kesPrevAvg ? "membaik" : "menurun"} dari ${Math.round(kesPrevAvg * 100)}% menjadi ${Math.round(kesNow * 100)}%.`);
        if (svcPrevAvg !== null && svcNow !== null) poin.push(`Service Ratio ${svcNow <= svcPrevAvg ? "membaik" : "meningkat"} dari ${(svcPrevAvg * 100).toFixed(2)}% menjadi ${(svcNow * 100).toFixed(2)}%.`);
        poin.push(`Kepatuhan SOP gabungan tercatat ${kepatuhanAvg !== null ? Math.round(kepatuhanAvg * 100) + "%" : "belum ada data"} dengan total ${totalTemuanKepatuhan} temuan.`);
        if (kondisiBerisiko > 0) poin.push(`Terdapat ${kondisiBerisiko} cabang berisiko tinggi yang memerlukan tindak lanjut segera.`);
        s.addText(poin.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < poin.length - 1, paraSpaceAfter: 12 } })), { x: 0.6, y: 1.1, w: 12.1, h: 4.5, fontSize: 14, color: "333333" });
      }

      // ── Rekomendasi ──
      {
        const s = pptx.addSlide();
        addHeader(s, "Rekomendasi");
        const stokBermasalah = rows.filter((r) => r.kesPct !== null && r.kesPct < 0.7).map((r) => r.branch.name);
        const keuBermasalah = rows.filter((r) => r.sisa !== null && r.sisa < 0).map((r) => r.branch.name);
        const svcBermasalah = rows.filter((r) => r.svcRatio !== null && r.svcRatio >= 0.0033).map((r) => r.branch.name);
        const best = rankedSOP[0];
        const worst = rankedSOP[rankedSOP.length - 1];

        const blocks = [
          { t: "1. Penguatan Pengendalian Stok", d: stokBermasalah.length ? `Cabang ${stokBermasalah.join(", ")} menunjukkan skor Kesehatan Stok di bawah ambang batas \u2014 perlu stock opname & review mendesak.` : "Semua cabang berada di atas ambang Kesehatan Stok yang aman." },
          { t: "2. Peningkatan Kepatuhan SOP", d: topDomain.length ? `Kategori ${topDomain[0]} menjadi temuan terbanyak bulan ini \u2014 perlu briefing & refresh SOP terkait.` : "Tidak ada kategori temuan yang menonjol bulan ini." },
          { t: "3. Perbaikan Pengelolaan Kas Kecil", d: keuBermasalah.length ? `Cabang ${keuBermasalah.join(", ")} mencatat saldo kas kecil minus \u2014 perlu review pengeluaran.` : "Tidak ada cabang dengan saldo kas kecil minus bulan ini." },
          { t: "4. Peningkatan Kualitas Operasional", d: svcBermasalah.length ? `Service Ratio cabang ${svcBermasalah.join(", ")} berada di kategori Perlu Perhatian \u2014 perlu analisis akar penyebab.` : "Service Ratio seluruh cabang dalam kategori terkendali." },
          { t: "5. Reward & Corrective Action", d: best && worst ? `Apresiasi untuk cabang ${best.branch.name} (skor SOP ${best.sopScore}%). Perhatian khusus untuk cabang ${worst.branch.name} (skor SOP ${worst.sopScore}%).` : "Belum cukup data untuk penilaian reward/corrective action." },
        ];
        blocks.forEach((b, i) => {
          const y = 0.9 + i * 0.85;
          s.addText(b.t, { x: 0.6, y, w: 12.1, h: 0.32, fontSize: 13, bold: true, color: PURPLE, margin: 0 });
          s.addText(b.d, { x: 0.6, y: y + 0.32, w: 12.1, h: 0.5, fontSize: 11, color: "444444", margin: 0 });
        });
      }

      // ── Terima kasih ──
      {
        const s = pptx.addSlide();
        s.background = { color: PURPLE };
        s.addShape(pptx.ShapeType.rect, { x: 0, y: 3.5, w: 13.33, h: 0.06, fill: { color: GOLD } });
        s.addText("TERIMA KASIH", { x: 0, y: 3.0, w: 13.33, h: 0.8, align: "center", fontSize: 34, color: WHITE, bold: true, margin: 0 });
        s.addText("Divisi Audit Internal \u2014 PT. KLA Teknologi Indonesia", { x: 0, y: 3.8, w: 13.33, h: 0.4, align: "center", fontSize: 12, color: "8b7fb0", margin: 0 });
      }

      setProgress("Menyimpan file\u2026");
      await pptx.writeFile({ fileName: `Laporan_Audit_${periodeLabel(period).replace(/\s+/g, "_")}.pptx` });
      setDone(true);
    } catch (err) {
      setError("Gagal membuat laporan: " + err.message);
    } finally {
      setGenerating(false);
      setProgress("");
    }
  }

  return (
    <div style={{ flex: 1 }}>
      <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)" }}>
        <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Laporan Bulanan</div>
        <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>Generate presentasi PPT gabungan semua modul, otomatis dari data audit</div>
      </div>

      <div style={{ padding: 24, maxWidth: 560 }}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 24 }}>
          <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 6 }}>Periode Laporan</label>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 8, padding: "4px 6px", width: "fit-content", marginBottom: 20 }}>
            <button className="btn-ghost" onClick={() => changePeriod(-1)} style={{ padding: "6px 10px" }}>{"<"}</button>
            <div className="mono" style={{ fontWeight: 600, minWidth: 150, textAlign: "center", fontSize: 14 }}>{periodeLabel(period)}</div>
            <button className="btn-ghost" onClick={() => changePeriod(1)} style={{ padding: "6px 10px" }}>{">"}</button>
          </div>

          <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 6 }}>Cabang</label>
          <div style={{ marginBottom: 20 }}>
            <BranchMultiSelect
              branches={allBranches}
              selectedIds={selectedBranchIds}
              onChange={(ids) => {
                setSelectedBranchIds(ids);
                setShowPicker(false);
                setPendingMultiAudit([]);
                setMultiAuditChoices({});
                setDone(false);
              }}
            />
          </div>

          {error && <div style={{ background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 16 }}>{error}</div>}
          {done && !generating && <div style={{ background: "var(--success-bg)", border: "1px solid rgba(26,158,110,0.35)", color: "var(--success-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 16 }}>\u2713 Laporan berhasil dibuat & didownload.</div>}

          {showPicker ? (
            <div>
              <div style={{ background: "var(--warning-bg, #fdf6e3)", border: "1px solid rgba(176,114,18,0.35)", color: "var(--warning-text, #b07212)", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 14 }}>
                {pendingMultiAudit.length} cabang punya lebih dari 1 audit bulan ini di beberapa modul. Pilih audit mana yang mau dipakai buat laporan ini sebelum lanjut.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                {pendingMultiAudit.map((p) => {
                  const key = `${p.branchId}|${p.moduleKey}`;
                  return (
                    <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px" }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{p.branchName}</div>
                        <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{p.moduleLabel}</div>
                      </div>
                      <select
                        className="input"
                        style={{ width: 220 }}
                        value={multiAuditChoices[key] || p.options[0]?.date || ""}
                        onChange={(e) => setMultiAuditChoices((prev) => ({ ...prev, [key]: e.target.value }))}
                      >
                        {p.options.map((o) => <option key={o.date} value={o.date}>{o.label}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-ghost" onClick={() => { setShowPicker(false); setPendingMultiAudit([]); }}>Batal</button>
                <button
                  className="btn"
                  style={{ flex: 1 }}
                  onClick={() => {
                    // Default-in pilihan yang belum disentuh user ke opsi pertama (audit paling baru)
                    const filled = { ...multiAuditChoices };
                    pendingMultiAudit.forEach((p) => {
                      const key = `${p.branchId}|${p.moduleKey}`;
                      if (!filled[key]) filled[key] = p.options[0]?.date;
                    });
                    setMultiAuditChoices(filled);
                    generate(filled);
                  }}
                >
                  Lanjutkan Export
                </button>
              </div>
            </div>
          ) : (
            <>
              <button className="btn" disabled={generating} onClick={() => generate()} style={{ width: "100%" }}>
                {generating ? (progress || "Memproses\u2026") : "Generate Laporan PPT"}
              </button>
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 10 }}>
                Proses ini bisa makan waktu beberapa detik sampai 1-2 menit tergantung jumlah cabang & foto temuan. Jangan tutup halaman selagi proses berjalan. Kalau ada cabang dengan lebih dari 1 audit bulan ini, kamu akan diminta memilih dulu sebelum laporan dibuat.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
