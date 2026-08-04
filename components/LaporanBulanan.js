import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { calcWeightedFromRecord, CATS, CONDITION_ITEMS, nowPeriode, periodeLabel, addMonthsToPeriod } from "../lib/sopConfig";
import { kesehatanStatusInfo, serviceStatusInfo } from "../lib/stokConfig";
import { INVENTARIS_CATEGORIES } from "./AuditInventaris";
import BranchMultiSelect from "./BranchMultiSelect";
import { sortBranches } from "../lib/branchOrder";
import { KPI_ITEMS, calcKPI, totalKpiInfo } from "../lib/kpiConfig";

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
// Sama persis dengan pola threshold di components/sop/SopKepatuhan.js
function kategoriInfo(pct) {
  const v = pct * 100;
  if (v >= 90) return { lbl: "Sangat Baik", color: "1a9e6e" };
  if (v >= 80) return { lbl: "Baik", color: "2f9e46" };
  if (v >= 70) return { lbl: "Cukup", color: "b07212" };
  return { lbl: "Perlu Perbaikan", color: "a32020" };
}
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
// Kategori Inventaris yang konsepnya tumpang tindih sama item 🔧 "Kondisi Aset/Fasilitas"
// di checklist SOP — dikecualikan di sini biar nggak ke-hitung dobel sama kondisiTemuan.
// Modul Inventaris aslinya TIDAK berubah.
const OVERLAP_INVENTARIS_CATS = ["Penerangan", "Furniture & Fixture", "Listrik & Utilitas"];
function countRusakNonOverlap(inventarisData) {
  if (!inventarisData) return 0;
  return INVENTARIS_CATEGORIES.filter((c) => !OVERLAP_INVENTARIS_CATS.includes(c) && inventarisData[c]?.status === "Rusak").length;
}

function keuanganSisa(entry) {
  if (!entry || entry.tidak_visit) return null;
  if (entry.sisa_saldo !== null && entry.sisa_saldo !== undefined && entry.sisa_saldo !== "") {
    return parseFloat(entry.sisa_saldo) || 0;
  }
  return (parseFloat(entry.saldo_sebelumnya) || 0) + (parseFloat(entry.saldo_masuk) || 0) - (parseFloat(entry.pengeluaran) || 0);
}

// Sama persis dengan computeStatus di components/AuditKeuangan.js
function computeKeuStatus(entry, settings) {
  if (!entry) return null;
  const sb = parseFloat(entry.saldo_sebelumnya) || 0;
  const sm = parseFloat(entry.saldo_masuk) || 0;
  const pk = parseFloat(entry.pengeluaran) || 0;
  const total = sb + sm;
  const hasManualSisa = entry.sisa_saldo !== undefined && entry.sisa_saldo !== null && entry.sisa_saldo !== "";
  const sisa = hasManualSisa ? (parseFloat(entry.sisa_saldo) || 0) : total - pk;
  const posisi = total > 0 ? pk / total : 0;
  let indikator, tone;
  if (sisa < 0) { indikator = "Pengecekan"; tone = "bad"; }
  else if (posisi * 100 <= settings.terkendali) { indikator = "Terkendali"; tone = "good"; }
  else if (posisi * 100 <= settings.efisien) { indikator = "Efisien"; tone = "good"; }
  else if (posisi * 100 <= settings.monitoring) { indikator = "Monitoring"; tone = "warn"; }
  else { indikator = "Tindak Lanjut"; tone = "bad"; }
  return { sisa, posisi, indikator, tone };
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
    supabase.from("branches").select("*").order("name").then(({ data }) => setAllBranches(sortBranches(data || [])));
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

      // 6 bulan terakhir (termasuk bulan yang lagi di-generate) — buat chart tren
      const trendPeriods = [];
      for (let i = 5; i >= 0; i--) trendPeriods.push(addMonths(period, -i));

      const [
        brRes, sopCurRes, sopPrevRes, svcCurRes, svcPrevRes,
        kesCurRes, kesPrevRes, keuCurRes, keuPrevRes, invCurRes, invPrevRes, kpiRes, profRes, keuSettingsRes,
        kesTrendRes, svcTrendRes, keuTrendRes, sopTrendRes, invTrendRes,
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
        supabase.from("audit_generic").select("*").eq("module", "inventaris").eq("period", prevPeriod),
        supabase.from("audit_kpi").select("*").eq("period", period),
        supabase.from("profiles").select("*"),
        supabase.from("settings_keuangan").select("*").eq("id", 1).maybeSingle(),
        supabase.from("audit_generic").select("*").eq("module", "stok_kesehatan").in("period", trendPeriods),
        supabase.from("audit_generic").select("*").eq("module", "stok_service").in("period", trendPeriods),
        supabase.from("audit_keuangan").select("*").in("period", trendPeriods),
        supabase.from("audit_generic").select("*").eq("module", "sop").in("period", trendPeriods),
        supabase.from("audit_generic").select("*").eq("module", "inventaris").in("period", trendPeriods),
      ]);
      const keuSettings = keuSettingsRes.data || { terkendali: 70, efisien: 95, monitoring: 105 };

      const allBr = sortBranches(brRes.data || []);
      if (!allBr.length) throw new Error("Belum ada data cabang.");
      const branches = (!selectedBranchIds || selectedBranchIds.length === 0 || selectedBranchIds.length === allBr.length)
        ? allBr
        : allBr.filter((b) => selectedBranchIds.includes(b.id));
      if (!branches.length) throw new Error("Pilih minimal 1 cabang dulu.");
      const selectedBranchIdSet = new Set(branches.map((b) => b.id));

      // ── Rata-rata company-wide per bulan (6 bulan terakhir) — buat chart tren ──
      // Cabang Baru & Tidak Visit dikecualikan dari rata-rata, konsisten sama aturan di tempat lain.
      // Cuma cabang yang lolos filter BranchMultiSelect yang ikut dihitung, biar konsisten sama tabel & kartu ringkasan.
      function monthlyAvg(records, valueKey, isJsonb) {
        return trendPeriods.map((p) => {
          const inMonth = records.filter((r) => r.period === p && selectedBranchIdSet.has(r.branch_id));
          // Resolve ke audit paling baru per cabang dulu (bisa ada >1 audit per cabang per bulan),
          // baru dirata-ratain — sebelumnya semua audit ke-hitung, bikin beda tipis sama kartu ringkasan.
          const byBranch = {};
          inMonth.forEach((r) => {
            const key = r.branch_id;
            const dateOf = (rec) => (isJsonb ? rec.data?.audit_date : rec.audit_date) || "";
            if (!byBranch[key] || dateOf(r) > dateOf(byBranch[key])) byBranch[key] = r;
          });
          const valid = Object.values(byBranch).filter((r) => {
            const d = isJsonb ? r.data : r;
            return d && !d.tidak_visit && !d.cabang_baru;
          });
          if (!valid.length) return null;
          const sum = valid.reduce((s, r) => s + (Number((isJsonb ? r.data : r)[valueKey]) || 0), 0);
          return sum / valid.length;
        });
      }
      const kesTrend = monthlyAvg(kesTrendRes.data || [], "kesehatan_pct", true);
      const svcTrend = monthlyAvg(svcTrendRes.data || [], "ratio", true);
      const keuTrend = (() => {
        // Audit Keuangan nggak nyimpen "posisi" langsung, jadi dihitung dari field mentah dulu per baris.
        return trendPeriods.map((p) => {
          const inMonth = (keuTrendRes.data || []).filter((r) => r.period === p && selectedBranchIdSet.has(r.branch_id));
          const byBranch = {};
          inMonth.forEach((r) => {
            if (!byBranch[r.branch_id] || (r.audit_date || "") > (byBranch[r.branch_id].audit_date || "")) byBranch[r.branch_id] = r;
          });
          const valid = Object.values(byBranch).filter((r) => !r.tidak_visit && !r.cabang_baru);
          if (!valid.length) return null;
          const vals = valid.map((r) => computeKeuStatus(r, keuSettings)?.posisi || 0);
          return vals.reduce((s, v) => s + v, 0) / vals.length;
        });
      })();

      // Kepatuhan SOP gabungan — 4 sumber sekaligus, per bulan
      const kepatuhanTrend = (() => {
        // Semua sumber di-resolve ke audit paling baru per cabang+bulan dulu (bisa ada >1 audit),
        // baru digabung — sebelumnya numpuk semua audit, bikin beda tipis sama kartu ringkasan.
        function latestByBranchPeriodKey(records, dateOf) {
          const map = {};
          records.filter((r) => selectedBranchIdSet.has(r.branch_id)).forEach((r) => {
            const key = `${r.branch_id}|${r.period}`;
            if (!map[key] || dateOf(r) > dateOf(map[key])) map[key] = r;
          });
          return map;
        }
        const sopByKey = latestByBranchPeriodKey(sopTrendRes.data || [], (r) => r.data?.audit_date || "");
        const kesByKey = latestByBranchPeriodKey(kesTrendRes.data || [], (r) => r.data?.audit_date || "");
        const keuByKey = latestByBranchPeriodKey(keuTrendRes.data || [], (r) => r.audit_date || "");
        const invByKey = latestByBranchPeriodKey(invTrendRes.data || [], (r) => r.data?.audit_date || "");

        return trendPeriods.map((p) => {
          const sopThisMonth = Object.entries(sopByKey).filter(([key]) => key.endsWith(`|${p}`)).map(([, r]) => r);
          const pctList = [];
          sopThisMonth.forEach((sopRec) => {
            if (sopRec.data?.tidak_visit || sopRec.data?.cabang_baru) return;
            const key = `${sopRec.branch_id}|${p}`;
            const stokRec = kesByKey[key];
            const keuRec = keuByKey[key];
            const invRec = invByKey[key];
            const keuSisa = keuRec ? keuanganSisa(keuRec) : null;
            const sopTemuan = countSopTemuan(sopRec);
            const stokTemuan = countStokTemuan(stokRec);
            const keuanganTemuan = keuSisa !== null && keuSisa < 0 ? 1 : 0;
            const invTemuan = invRec && !invRec.data?.tidak_visit ? countRusakNonOverlap(invRec.data?.categories) : 0;
            const kondisiTemuan = [...CONDITION_ITEMS].filter((key2) => !sopRec.data?.checks?.[key2]).length;
            const asetTemuan = invTemuan + kondisiTemuan;
            const total = sopTemuan + stokTemuan + keuanganTemuan + asetTemuan;
            pctList.push(Math.max(0, 1 - total / BASELINE));
          });
          if (!pctList.length) return null;
          return pctList.reduce((s, v) => s + v, 0) / pctList.length;
        });
      })();

      // Kelompokkan per cabang (sekarang bisa lebih dari 1 audit per cabang per bulan)
      const groupedCur = {
        sop: groupByBranch(sopCurRes.data), svc: groupByBranch(svcCurRes.data), kes: groupByBranch(kesCurRes.data),
        keu: groupByBranch(keuCurRes.data), inv: groupByBranch(invCurRes.data),
      };
      const groupedPrev = {
        sop: groupByBranch(sopPrevRes.data), svc: groupByBranch(svcPrevRes.data), kes: groupByBranch(kesPrevRes.data),
        keu: groupByBranch(keuPrevRes.data), inv: groupByBranch(invPrevRes.data),
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
        const invPrev = resolveEntry("inv", b.id, groupedPrev.inv, {});

        const tidakVisitSOP = sopCur?.data?.tidak_visit;
        const sopScore = sopCur && !tidakVisitSOP ? calcWeightedFromRecord(sopCur.data) : null;
        const sopScorePrev = sopPrev && !sopPrev.data?.tidak_visit ? calcWeightedFromRecord(sopPrev.data) : null;

        const svcRatio = svcCur && !svcCur.data?.tidak_visit ? Number(svcCur.data?.ratio) || 0 : null;
        const svcRatioPrev = svcPrev && !svcPrev.data?.tidak_visit ? Number(svcPrev.data?.ratio) || 0 : null;
        // Detail lengkap Service Ratio (buat tabel per-cabang di slide) — bulan ini & bulan lalu
        const svcDetail = (rec) => {
          if (!rec) return { hasData: false, tidakVisit: false };
          if (rec.data?.tidak_visit) return { hasData: true, tidakVisit: true };
          return {
            hasData: true, tidakVisit: false, cabangBaru: !!rec.data?.cabang_baru,
            laptop: Number(rec.data?.laptop) || 0,
            aksesoris: Number(rec.data?.aksesoris) || 0,
            user: Number(rec.data?.user) || 0,
            stokService: Number(rec.data?.stok_service) || 0,
            totalUnit: Number(rec.data?.total_unit_cabang) || 0,
            ratio: Number(rec.data?.ratio) || 0,
          };
        };
        const svcCurDetail = svcDetail(svcCur);
        const svcPrevDetail = svcDetail(svcPrev);

        const kesPct = kesCur && !kesCur.data?.tidak_visit ? Number(kesCur.data?.kesehatan_pct) || 0 : null;
        const kesPctPrev = kesPrev && !kesPrev.data?.tidak_visit ? Number(kesPrev.data?.kesehatan_pct) || 0 : null;
        // Detail lengkap Kesehatan Stok (buat tabel per-cabang di slide) — bulan ini & bulan lalu
        const kesDetail = (rec) => {
          if (!rec) return { hasData: false, tidakVisit: false };
          if (rec.data?.tidak_visit) return { hasData: true, tidakVisit: true };
          return {
            hasData: true, tidakVisit: false, cabangBaru: !!rec.data?.cabang_baru,
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
        // Detail lengkap Audit Keuangan (buat tabel per-cabang di slide) — bulan ini & bulan lalu
        const keuDetail = (rec) => {
          if (!rec) return { hasData: false, tidakVisit: false };
          if (rec.tidak_visit) return { hasData: true, tidakVisit: true };
          const st = computeKeuStatus(rec, keuSettings);
          return {
            hasData: true, tidakVisit: false, cabangBaru: !!rec.cabang_baru,
            saldoSebelumnya: parseFloat(rec.saldo_sebelumnya) || 0,
            saldoMasuk: parseFloat(rec.saldo_masuk) || 0,
            limitKas: parseFloat(rec.limit_kas) || 0,
            pengeluaran: parseFloat(rec.pengeluaran) || 0,
            sisa: st.sisa, posisi: st.posisi, indikator: st.indikator, tone: st.tone,
          };
        };
        const keuCurDetail = keuDetail(keuCur);
        const keuPrevDetail = keuDetail(keuPrev);

        // Kepatuhan gabungan — sekarang dan bulan lalu
        function kepDetail(sopRec, stokRec, keuSisa, invRec) {
          if (!sopRec) return { hasData: false, tidakVisit: false };
          if (sopRec.data?.tidak_visit) return { hasData: true, tidakVisit: true };
          const sopTemuan = countSopTemuan(sopRec);
          const stokTemuan = countStokTemuan(stokRec);
          const keuanganTemuan = keuSisa !== null && keuSisa < 0 ? 1 : 0;
          const invTemuan = invRec && !invRec.data?.tidak_visit ? countRusakNonOverlap(invRec.data?.categories) : 0;
          const kondisiTemuan = [...CONDITION_ITEMS].filter((key) => !sopRec.data?.checks?.[key]).length;
          const asetTemuan = invTemuan + kondisiTemuan;
          const totalTemuan = sopTemuan + stokTemuan + keuanganTemuan + asetTemuan;
          const pct = Math.max(0, 1 - totalTemuan / BASELINE);
          return { hasData: true, tidakVisit: false, cabangBaru: !!sopRec.data?.cabang_baru, sopTemuan, stokTemuan, keuanganTemuan, asetTemuan, totalTemuan, pct };
        }
        const kepCurDetail = kepDetail(sopCur, kesCur, sisa, invCur);
        const kepPrevDetail = kepDetail(sopPrev, kesPrev, sisaPrev, invPrev);
        const kepatuhan = kepCurDetail.hasData && !kepCurDetail.tidakVisit ? kepCurDetail.pct : null;
        const totalTemuanBranch = kepCurDetail.hasData && !kepCurDetail.tidakVisit ? kepCurDetail.totalTemuan : null;

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
          svcRatio, svcRatioPrev, svcCurDetail, svcPrevDetail, kesPct, kesPctPrev, kesCurDetail, kesPrevDetail, sisa, sisaPrev, keuCurDetail, keuPrevDetail,
          totalTemuanBranch,
          pengeluaran: keuCur ? parseFloat(keuCur.pengeluaran) || 0 : 0,
          kepatuhan, kepCurDetail, kepPrevDetail, findings,
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
      const top5Domain = Object.entries(catFailCount).sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([id]) => catLabelMap[id] || id);

      // Temuan terbanyak: item checklist SPESIFIK (bukan kategori) yang paling sering gagal,
      // dihitung dari cabang-cabang yang lolos filter (`auditedRows`, sudah sesuai pilihan auditor).
      // Cabang Baru dikecualikan dari ranking ini (datanya tetap ada, cuma nggak ikut nyumbang ke Temuan Terbanyak).
      const itemFailCount = {};
      auditedRows.filter((r) => !r.sopCur?.data?.cabang_baru).forEach((r) => {
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
      const svcNow = avgSvc(rows.filter((r) => !r.svcCurDetail?.cabangBaru).map((r) => r.svcRatio));
      const svcPrevAvg = avgSvc(rows.filter((r) => !r.svcPrevDetail?.cabangBaru).map((r) => r.svcRatioPrev));
      const kesNow = avgSvc(rows.filter((r) => !r.kesCurDetail?.cabangBaru).map((r) => r.kesPct));
      const kesPrevAvg = avgSvc(rows.filter((r) => !r.kesPrevDetail?.cabangBaru).map((r) => r.kesPctPrev));

      const negBalanceNow = rows.filter((r) => r.sisa !== null && r.sisa < 0).length;
      const negBalancePrev = rows.filter((r) => r.sisaPrev !== null && r.sisaPrev < 0).length;
      const totalKasKeluar = rows.reduce((s, r) => s + r.pengeluaran, 0);
      const keuNowAvg = avgSvc(rows.filter((r) => !r.keuCurDetail?.cabangBaru).map((r) => r.keuCurDetail?.hasData && !r.keuCurDetail?.tidakVisit ? r.keuCurDetail.posisi : null));
      const keuPrevAvg = avgSvc(rows.filter((r) => !r.keuPrevDetail?.cabangBaru).map((r) => r.keuPrevDetail?.hasData && !r.keuPrevDetail?.tidakVisit ? r.keuPrevDetail.posisi : null));

      const kepatuhanRows = rows.filter((r) => r.kepatuhan !== null && !r.kepCurDetail?.cabangBaru);
      const kepatuhanAvg = kepatuhanRows.length ? kepatuhanRows.reduce((s, r) => s + r.kepatuhan, 0) / kepatuhanRows.length : null;
      const totalTemuanKepatuhan = rows.filter((r) => r.kepatuhan !== null).reduce((s, r) => s + Math.round((1 - r.kepatuhan) * BASELINE), 0);

      const rankedSOP = [...auditedRows].filter((r) => !r.sopCur?.data?.cabang_baru).sort((a, b) => b.sopScore - a.sopScore);

      setProgress("Menyusun slide\u2026");

      // ══════════════ BUILD PPTX ══════════════
      const PptxGenJS = await loadPptxGenJS();
      const pptx = new PptxGenJS();
      pptx.layout = "LAYOUT_WIDE";
      pptx.author = "KLA Radar";
      pptx.title = `Laporan Audit Internal ${periodeLabel(period)}`;

      const allSlideRefs = [];
      function newSlide() {
        const s = pptx.addSlide();
        allSlideRefs.push(s);
        return s;
      }

      // pptxgenjs nggak support gradient fill beneran buat shape — jadi "gradient" header
      // di-simulasiin pakai beberapa kotak solid warna beda-beda yang numpuk halus.
      const PURPLE_DARK = "2E1465";
      const PURPLE_LIGHT = "5B2394";
      function addGradientHeader(slide, h) {
        const steps = 40;
        for (let i = 0; i < steps; i++) {
          const t = i / (steps - 1);
          const c = lerpColor(PURPLE_DARK, PURPLE_LIGHT, t);
          slide.addShape(pptx.ShapeType.rect, { x: (13.33 / steps) * i, y: 0, w: 13.33 / steps + 0.02, h, fill: { color: c } });
        }
        slide.addShape(pptx.ShapeType.rect, { x: 0, y: h, w: 13.33, h: 0.04, fill: { color: GOLD } });
      }
      function lerpColor(c1, c2, t) {
        const a = parseInt(c1, 16), b = parseInt(c2, 16);
        const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
        const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
        const r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
        return [r, g, bl].map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase();
      }

      function textBar(pct) {
        const clamped = Math.max(0, Math.min(1, pct));
        const filled = Math.round(clamped * 5);
        return "\u25B0".repeat(filled) + "\u25B1".repeat(5 - filled);
      }

      function addLogo(slide, x, y) {
        slide.addText("KLA", { x, y, w: 1.9, h: 0.36, align: "right", fontSize: 19, bold: true, color: GOLD, margin: 0 });
        slide.addText("COMPUTER", { x, y: y + 0.33, w: 1.9, h: 0.22, align: "right", fontSize: 9, bold: true, color: WHITE, charSpacing: 1, margin: 0 });
      }

      function addHeader(slide, tag) {
        const steps = 40;
        for (let i = 0; i < steps; i++) {
          const t = i / (steps - 1);
          const c = lerpColor(PURPLE_DARK, PURPLE_LIGHT, t);
          slide.addShape(pptx.ShapeType.rect, { x: (13.33 / steps) * i, y: 0, w: 13.33 / steps + 0.02, h: 0.55, fill: { color: c } });
        }
        slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.55, w: 13.33, h: 0.04, fill: { color: GOLD } });
        slide.addText(tag, { x: 0.4, y: 0, w: 7, h: 0.55, fontSize: 13, bold: true, color: WHITE, valign: "middle", margin: 0 });
        slide.addText(periodeLabel(period), { x: 7.5, y: 0, w: 3.0, h: 0.55, fontSize: 11, color: GOLD, align: "right", valign: "middle", margin: 0 });
        slide.addShape(pptx.ShapeType.rect, { x: 10.65, y: 0.13, w: 0.014, h: 0.3, fill: { color: "6b5f96" } });
        addLogo(slide, 10.9, 0.1);
      }

      function shortMonth(p) {
        const [y, m] = p.split("-");
        const names = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Ags", "Sep", "Okt", "Nov", "Des"];
        return names[parseInt(m, 10) - 1] + " " + y.slice(2);
      }

      function shortDate2(dateStr) {
        if (!dateStr) return "\u2014";
        const d = new Date(dateStr + "T00:00:00");
        if (isNaN(d.getTime())) return "\u2014";
        return d.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
      }

      // Chart tren garis 6 bulan terakhir — dipakai bareng di slide Kesehatan Stok, Service Ratio, Audit Keuangan.
      // trendArr: array 6 nilai (fraksi 0-1) sejajar sama trendPeriods, null kalau bulan itu nggak ada data.
      function addTrendChart(s, x, y, w, h, trendArr, decimals) {
        const points = trendPeriods.map((p, i) => ({ label: shortMonth(p), value: trendArr[i] })).filter((pt) => pt.value !== null);
        if (points.length < 2) {
          s.addText("Data histori belum cukup buat nampilin tren.", { x, y, w, h, fontSize: 9, color: "999999", align: "center", valign: "middle" });
          return;
        }
        const vals = points.map((pt) => Number((pt.value * 100).toFixed(decimals)));
        const vMin = Math.min(...vals), vMax = Math.max(...vals);
        const pad = Math.max((vMax - vMin) * 0.25, decimals > 0 ? 0.5 : 3);
        s.addChart(pptx.ChartType.line, [{
          name: "Rata-rata",
          labels: points.map((pt) => pt.label),
          values: vals,
        }], {
          x, y, w, h,
          chartColors: [PURPLE],
          lineSize: 2.5,
          lineDataSymbol: "circle",
          lineDataSymbolSize: 7,
          lineDataSymbolLineColor: PURPLE,
          lineDataSymbolLineSize: 1.5,
          showLegend: false,
          showTitle: false,
          showValue: true,
          dataLabelPosition: "t",
          dataLabelColor: PURPLE,
          dataLabelFontFace: "Arial",
          dataLabelFontSize: 10,
          dataLabelFontBold: true,
          dataLabelFormatCode: decimals > 0 ? "0." + "0".repeat(decimals) : "0",
          catAxisLabelFontSize: 9,
          catAxisLabelColor: "666666",
          valAxisHidden: false,
          valAxisLabelFontSize: 8,
          valAxisLabelColor: "999999",
          valAxisMinVal: Math.max(0, Math.floor(vMin - pad)),
          valAxisMaxVal: Math.ceil(vMax + pad),
          valGridLine: { color: "EEEEEE", style: "solid", size: 0.75 },
          catGridLine: { style: "none" },
        });
      }

      function addGradientBackground(slide) {
        const steps = 40;
        for (let i = 0; i < steps; i++) {
          const t = i / (steps - 1);
          const c = lerpColor(PURPLE_DARK, PURPLE_LIGHT, t);
          slide.addShape(pptx.ShapeType.rect, { x: (13.33 / steps) * i, y: 0, w: 13.33 / steps + 0.02, h: 7.5, fill: { color: c } });
        }
      }

      // ── 1. Cover ──
      {
        const s = newSlide();
        addGradientBackground(s);

        // Logo pojok kanan atas
        s.addText("KLA", { x: 10.9, y: 0.35, w: 2.1, h: 0.4, align: "right", fontSize: 20, bold: true, color: GOLD, margin: 0 });
        s.addText("COMPUTER", { x: 10.9, y: 0.72, w: 2.1, h: 0.25, align: "right", fontSize: 9, bold: true, color: WHITE, charSpacing: 1, margin: 0 });

        s.addText("K L A   C O M P U T E R", { x: 0, y: 2.15, w: 13.33, h: 0.4, align: "center", fontSize: 15, color: GOLD, bold: true, charSpacing: 3, margin: 0 });
        s.addText("REPORT MONTHLY", { x: 0, y: 2.55, w: 13.33, h: 0.9, align: "center", fontSize: 44, color: WHITE, bold: true, margin: 0 });

        s.addShape(pptx.ShapeType.rect, { x: 1, y: 3.62, w: 11.33, h: 0.022, fill: { color: GOLD } });
        s.addShape(pptx.ShapeType.triangle, { x: 6.43, y: 3.6, w: 0.24, h: 0.13, fill: { color: PURPLE }, line: { color: GOLD, width: 1.25 }, rotate: 180 });

        s.addText([
          { text: "\u{1F4C5}  ", options: { fontSize: 16, color: GOLD } },
          { text: periodeLabel(period), options: { fontSize: 18, color: WHITE, bold: true } },
        ], { x: 0, y: 3.85, w: 13.33, h: 0.45, align: "center", margin: 0 });

        s.addShape(pptx.ShapeType.rect, { x: 5.9, y: 4.42, w: 0.6, h: 0.014, fill: { color: "6b5f96" } });
        s.addShape(pptx.ShapeType.ellipse, { x: 6.62, y: 4.395, w: 0.09, h: 0.09, fill: { color: GOLD } });
        s.addShape(pptx.ShapeType.rect, { x: 6.83, y: 4.42, w: 0.6, h: 0.014, fill: { color: "6b5f96" } });

        s.addText("Divisi Audit Internal \u2014 PT. KLA Teknologi Indonesia", { x: 0, y: 4.6, w: 13.33, h: 0.4, align: "center", fontSize: 13, color: "CFC7E6", margin: 0 });

        // Nilai perusahaan
        const values = [
          { icon: "\u{1F6E1}\u{FE0F}", label: "INTEGRITAS" },
          { icon: "\u{1F50D}", label: "PROFESIONAL" },
          { icon: "\u{1F4C8}", label: "AKUNTABEL" },
          { icon: "\u{1F465}", label: "KOLABORATIF" },
        ];
        const vw = 2.3, vStartX = (13.33 - vw * values.length) / 2, vY = 5.55;
        values.forEach((v, i) => {
          const vx = vStartX + i * vw;
          s.addText(v.icon, { x: vx, y: vY, w: vw, h: 0.45, align: "center", fontSize: 22, margin: 0 });
          s.addText(v.label, { x: vx, y: vY + 0.5, w: vw, h: 0.3, align: "center", fontSize: 10.5, bold: true, color: "CFC7E6", charSpacing: 1, margin: 0 });
          if (i > 0) s.addShape(pptx.ShapeType.rect, { x: vx, y: vY + 0.05, w: 0.012, h: 0.65, fill: { color: "6b5f96" } });
        });
      }

      // ── 2. Tujuan & Ruang Lingkup ──
      {
        const s = newSlide();
        addGradientHeader(s, 1.15);
        s.addText("TUJUAN DAN RUANG LINGKUP", { x: 0.4, y: 0.15, w: 8, h: 0.45, fontSize: 22, bold: true, color: WHITE, margin: 0 });
        s.addText("AUDIT INTERNAL", { x: 0.4, y: 0.6, w: 6, h: 0.32, fontSize: 13, bold: true, color: GOLD, margin: 0 });
        s.addShape(pptx.ShapeType.roundRect, { x: 7.3, y: 0.38, w: 2.55, h: 0.42, rectRadius: 0.21, fill: { color: "3D2A72" }, line: { color: GOLD, width: 1 } });
        s.addText(`\u{1F4C5}  Periode Audit: ${periodeLabel(period)}`, { x: 7.3, y: 0.38, w: 2.55, h: 0.42, fontSize: 10.5, bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });
        addLogo(s, 11.3, 0.32);

        function scopeColumn(x, w, icon, title, items) {
          // Ribbon judul dengan ikon lingkaran nempel di kiri
          s.addShape(pptx.ShapeType.roundRect, { x: x + 0.42, y: 1.42, w: w - 0.42, h: 0.5, rectRadius: 0.08, fill: { color: PURPLE } });
          s.addShape(pptx.ShapeType.ellipse, { x, y: 1.3, w: 0.72, h: 0.72, fill: { color: WHITE }, line: { color: PURPLE, width: 1.75 } });
          s.addText(icon, { x, y: 1.3, w: 0.72, h: 0.72, fontSize: 22, align: "center", valign: "middle", margin: 0 });
          s.addText(title, { x: x + 0.85, y: 1.42, w: w - 0.95, h: 0.5, fontSize: 13.5, bold: true, color: WHITE, valign: "middle", margin: 0 });

          // Card putih berisi list item
          const cardTop = 2.05;
          const itemH = 0.72;
          const cardH = items.length * itemH + 0.3;
          s.addShape(pptx.ShapeType.roundRect, { x, y: cardTop, w, h: cardH, rectRadius: 0.1, fill: { color: "FBFAFF" }, line: { color: "EDE9F7", width: 1 } });
          items.forEach((it, i) => {
            const yy = cardTop + 0.15 + i * itemH;
            s.addShape(pptx.ShapeType.roundRect, { x: x + 0.18, y: yy + 0.06, w: 0.55, h: 0.55, rectRadius: 0.09, fill: { color: "EDE9FB" } });
            s.addText(it.icon, { x: x + 0.18, y: yy + 0.06, w: 0.55, h: 0.55, fontSize: 17, align: "center", valign: "middle", margin: 0 });
            s.addShape(pptx.ShapeType.rect, { x: x + 0.86, y: yy + 0.08, w: 0.022, h: 0.5, fill: { color: GOLD } });
            s.addText(it.text, { x: x + 1.0, y: yy, w: w - 1.15, h: itemH - 0.06, fontSize: 12, color: "222222", valign: "middle", margin: 0 });
          });
        }

        scopeColumn(0.4, 5.9, "\u{1F3AF}", "TUJUAN AUDIT", [
          { icon: "\u{1F4E6}", text: "Menilai pengelolaan stok barang di seluruh cabang" },
          { icon: "\u{1F6E1}\u{FE0F}", text: "Menilai kesehatan stok dan potensi risiko selisih" },
          { icon: "\u{1F4CB}", text: "Memastikan aset & inventaris tercatat dan terjaga" },
          { icon: "\u{1F4DD}", text: "Menilai kepatuhan SOP Operasional" },
          { icon: "\u{1F45B}", text: "Menilai pengelolaan keuangan & kas kecil" },
          { icon: "\u{1F50D}", text: "Mengidentifikasi temuan & area perbaikan cabang" },
        ]);

        scopeColumn(6.9, 6.0, "\u{1F4CB}", "RUANG LINGKUP AUDIT", [
          { icon: "\u{1F5A5}\u{FE0F}", text: "Audit Stock Opname & Display" },
          { icon: "\u{1F4CB}", text: "Audit Inventaris" },
          { icon: "\u{1F4B5}", text: "Audit Kas Kecil" },
          { icon: "\u2705", text: "Audit Kepatuhan SOP" },
          { icon: "\u{1F3E2}", text: `Audit pada ${branches.length} Cabang` },
        ]);
      }

      // ── 3. Ringkasan Hasil Audit ──
      {
        const s = newSlide();
        addGradientHeader(s, 1.15);
        s.addText("RINGKASAN HASIL AUDIT", { x: 0.4, y: 0.15, w: 9, h: 0.5, fontSize: 24, bold: true, color: WHITE, margin: 0 });
        s.addText([
          { text: `\u{1F4C5} Periode Audit: ${periodeLabel(period)}`, options: { fontSize: 12, color: "E4DCFF", bold: true } },
          { text: "     |     ", options: { fontSize: 12, color: "8A7BC2" } },
          { text: `\u{1F3EA} Total Cabang di Audit: ${branches.length} Cabang`, options: { fontSize: 12, color: "E4DCFF", bold: true } },
        ], { x: 0.4, y: 0.72, w: 9, h: 0.35, margin: 0 });
        addLogo(s, 11.3, 0.32);

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

      // ── 4. Kesehatan Stok (dipecah jadi 3 slide: tabel Bulan Lalu, tabel Bulan Ini, kartu Ringkasan) ──
      {
        const kesRowsPrevAll = branches.map((b) => rows.find((r) => r.branch.id === b.id)).filter(Boolean);

        const kesTh = [
          { text: "No", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
          { text: "Cabang", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11 } },
          { text: "Sk. Temuan", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
          { text: "Sk. Rugi", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
          { text: "Sk. Total", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
          { text: "Indikator", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
          { text: "% Sehat", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
        ];
        function kesTableRows(detailKey) {
          const body = kesRowsPrevAll.map((r, i) => {
            const d = r[detailKey];
            if (!d || !d.hasData || d.tidakVisit) {
              return [
                { text: String(i + 1), options: { fontSize: 10.5, align: "center" } },
                { text: r.branch.name, options: { fontSize: 10.5, bold: true } },
                { text: "TIDAK VISIT", options: { colspan: 5, fontSize: 10.5, bold: true, align: "center", fill: { color: "DDE6F7" }, color: PURPLE } },
              ];
            }
            const info = kesehatanStatusInfo(d.pct);
            return [
              { text: String(i + 1), options: { fontSize: 10, align: "center", bold: true, fill: { color: PURPLE }, color: WHITE } },
              { text: r.branch.name, options: { fontSize: 10.5, bold: true } },
              { text: String(d.skorTemuan), options: { fontSize: 10.5, align: "center" } },
              { text: String(d.skorRugi), options: { fontSize: 10.5, align: "center" } },
              { text: String(d.skorTotal), options: { fontSize: 10.5, align: "center", bold: true } },
              { text: info.lbl, options: { fontSize: 10, align: "center", bold: true, color: WHITE, fill: { color: info.color.replace("#", "") } } },
              { text: `${textBar(d.pct)}  ${Math.round(d.pct * 100)}%`, options: { fontSize: 9, align: "center", bold: true, color: d.pct < 0.5 ? RED : "1a9e6e" } },
            ];
          });
          const validPct = kesRowsPrevAll.map((r) => r[detailKey]).filter((d) => d && d.hasData && !d.tidakVisit).map((d) => d.pct);
          const avgPct = validPct.length ? validPct.reduce((s, v) => s + v, 0) / validPct.length : 0;
          const totalSkor = kesRowsPrevAll.map((r) => r[detailKey]).filter((d) => d && d.hasData && !d.tidakVisit).reduce((s, d) => s + d.skorTotal, 0);
          body.push([
            { text: "TOTAL / RATA-RATA", options: { colspan: 4, fontSize: 10.5, bold: true, fill: { color: PURPLE }, color: WHITE } },
            { text: String(totalSkor), options: { fontSize: 10.5, bold: true, align: "center", fill: { color: PURPLE }, color: WHITE } },
            { text: "", options: { fill: { color: PURPLE } } },
            { text: `${Math.round(avgPct * 100)}%`, options: { fontSize: 10.5, bold: true, align: "center", fill: { color: PURPLE }, color: WHITE } },
          ]);
          return body;
        }

        function kesTableSlide(labelBulan, periodLbl, detailKey) {
          const s = newSlide();
          addGradientHeader(s, 0.85);
          s.addText("KESEHATAN STOK CABANG", { x: 0.35, y: 0.08, w: 8.5, h: 0.42, fontSize: 20, bold: true, color: WHITE, margin: 0 });
          s.addText(`${labelBulan} \u2014 ${periodLbl}`, { x: 0.35, y: 0.5, w: 8.5, h: 0.3, fontSize: 13, bold: true, color: GOLD, margin: 0 });
          addLogo(s, 11.3, 0.18);
          s.addTable([kesTh].concat(kesTableRows(detailKey)), { x: 0.35, y: 1.15, w: 12.6, colW: [0.6, 3.2, 1.7, 1.4, 1.5, 2.1, 2.1], border: { type: "solid", color: "E5E5E5", pt: 0.5 }, autoPage: false, margin: [2, 4, 2, 4] });
        }
        kesTableSlide("BULAN LALU", periodeLabel(prevPeriod), "kesPrevDetail");
        kesTableSlide("BULAN INI", periodeLabel(period), "kesCurDetail");

        // ── Slide kartu ringkasan ──
        const s = newSlide();
        addGradientHeader(s, 0.85);
        s.addText("KESEHATAN STOK CABANG \u2014 RINGKASAN", { x: 0.35, y: 0.08, w: 9, h: 0.42, fontSize: 20, bold: true, color: WHITE, margin: 0 });
        s.addText(`${periodeLabel(prevPeriod)} & ${periodeLabel(period)}`, { x: 0.35, y: 0.48, w: 9, h: 0.32, fontSize: 12, color: "E4DCFF", margin: 0 });
        addLogo(s, 11.3, 0.18);

        const cardX = 0.7, cardW = 5.7, cardX2 = 6.9, cardW2 = 5.7;
        s.addShape(pptx.ShapeType.roundRect, { x: cardX, y: 1.15, w: 2.75, h: 1.4, rectRadius: 0.08, fill: { color: "EEEAFB" }, line: { color: "E4DFF2", width: 0.75 } });
        s.addText(`RATA-RATA\n${periodeLabel(prevPeriod).toUpperCase()}`, { x: cardX + 0.2, y: 1.24, w: 1.9, h: 0.5, fontSize: 9.5, bold: true, color: "8a80a8", margin: 0 });
        s.addShape(pptx.ShapeType.ellipse, { x: cardX + 2.15, y: 1.24, w: 0.42, h: 0.42, fill: { color: "FFFFFF" } });
        s.addText("\u{1F4C8}", { x: cardX + 2.15, y: 1.24, w: 0.42, h: 0.42, fontSize: 15, align: "center", valign: "middle", margin: 0 });
        s.addText(kesPrevAvg !== null ? `${Math.round(kesPrevAvg * 100)}%` : "\u2014", { x: cardX + 0.2, y: 1.62, w: 2.35, h: 0.55, fontSize: 30, bold: true, color: PURPLE, margin: 0 });
        s.addShape(pptx.ShapeType.roundRect, { x: cardX + 0.2, y: 2.28, w: 2.35, h: 0.08, rectRadius: 0.04, fill: { color: "DCD5F0" } });
        s.addShape(pptx.ShapeType.roundRect, { x: cardX + 0.2, y: 2.28, w: 2.35 * Math.min(1, (kesPrevAvg || 0)), h: 0.08, rectRadius: 0.04, fill: { color: PURPLE } });

        s.addShape(pptx.ShapeType.roundRect, { x: cardX + 2.95, y: 1.15, w: 2.75, h: 1.4, rectRadius: 0.08, fill: { color: "FDF3E6" }, line: { color: "F5E4C8", width: 0.75 } });
        s.addText(`RATA-RATA\n${periodeLabel(period).toUpperCase()}`, { x: cardX + 3.15, y: 1.24, w: 1.9, h: 0.5, fontSize: 9.5, bold: true, color: "b0966a", margin: 0 });
        s.addShape(pptx.ShapeType.ellipse, { x: cardX + 5.1, y: 1.24, w: 0.42, h: 0.42, fill: { color: "FFFFFF" } });
        s.addText("\u{1F4C8}", { x: cardX + 5.1, y: 1.24, w: 0.42, h: 0.42, fontSize: 15, align: "center", valign: "middle", margin: 0 });
        s.addText(kesNow !== null ? `${Math.round(kesNow * 100)}%` : "\u2014", { x: cardX + 3.15, y: 1.62, w: 2.35, h: 0.55, fontSize: 30, bold: true, color: PURPLE, margin: 0 });
        s.addShape(pptx.ShapeType.roundRect, { x: cardX + 3.15, y: 2.28, w: 2.35, h: 0.08, rectRadius: 0.04, fill: { color: "F0DFC0" } });
        s.addShape(pptx.ShapeType.roundRect, { x: cardX + 3.15, y: 2.28, w: 2.35 * Math.min(1, (kesNow || 0)), h: 0.08, rectRadius: 0.04, fill: { color: "b0966a" } });

        const trendUp = kesPrevAvg !== null && kesNow !== null && kesNow >= kesPrevAvg;
        s.addShape(pptx.ShapeType.roundRect, { x: cardX, y: 2.7, w: cardW, h: 2.1, rectRadius: 0.08, fill: { color: "F7F6FB" }, line: { color: "E4DFF2", width: 0.75 } });
        s.addText("TREN 6 BULAN TERAKHIR", { x: cardX + 0.2, y: 2.82, w: 3.2, h: 0.3, fontSize: 11.5, bold: true, color: PURPLE, margin: 0 });
        if (kesPrevAvg !== null && kesNow !== null) {
          s.addText(`${trendUp ? "\u25B2" : "\u25BC"} ${Math.abs(Math.round((kesNow - kesPrevAvg) * 100))} poin`, { x: cardX + 3.3, y: 2.78, w: 2.2, h: 0.32, fontSize: 12.5, bold: true, color: trendUp ? GREEN : RED, align: "right", margin: 0 });
        }
        addTrendChart(s, cardX + 0.1, 3.2, cardW - 0.2, 1.5, kesTrend, 0);

        s.addShape(pptx.ShapeType.roundRect, { x: cardX, y: 5.0, w: cardW, h: 2.15, rectRadius: 0.08, fill: { color: "F7F6FB" }, line: { color: "E4DFF2", width: 0.75 } });
        s.addText("RINGKASAN", { x: cardX + 0.2, y: 5.13, w: 4, h: 0.32, fontSize: 13, bold: true, color: PURPLE, margin: 0 });
        const kesBermasalahBranches = rows.filter((r) => r.kesPct !== null && r.kesPct < 0.7).map((r) => r.branch.name);
        const ringkasanLines = [
          kesPrevAvg !== null && kesNow !== null
            ? `Rata-rata kesehatan stok cabang ${trendUp ? "membaik" : "menurun"} dari ${Math.round(kesPrevAvg * 100)}% menjadi ${Math.round(kesNow * 100)}%.`
            : "Data pembanding bulan lalu belum lengkap.",
          kesBermasalahBranches.length
            ? `Perlu monitoring & tindak lanjut pada cabang: ${kesBermasalahBranches.join(", ")}.`
            : "Semua cabang berada di atas ambang aman bulan ini.",
        ];
        s.addText(ringkasanLines.map((t) => ({ text: t, options: { bullet: { code: "2022" }, breakLine: true, paraSpaceAfter: 8 } })), { x: cardX + 0.2, y: 5.5, w: 2.9, h: 1.55, fontSize: 10.5, color: "444444", valign: "top", margin: 0 });

        const kesValid = kesTrend.map((v, i) => ({ v, p: trendPeriods[i] })).filter((o) => o.v !== null);
        if (kesValid.length) {
          const peakO = kesValid.reduce((a, b) => (b.v > a.v ? b : a));
          const lowO = kesValid.reduce((a, b) => (b.v < a.v ? b : a));
          const delta = Math.round((kesValid[kesValid.length - 1].v - kesValid[0].v) * 100);
          const stats = [
            { icon: "\u{1F538}", c: GREEN, l: "PUNCAK", val: `${Math.round(peakO.v * 100)}%`, sub: shortMonth(peakO.p) },
            { icon: "\u{1F53B}", c: RED, l: "TERENDAH", val: `${Math.round(lowO.v * 100)}%`, sub: shortMonth(lowO.p) },
            { icon: "\u{1F4C8}", c: PURPLE, l: "PERUBAHAN", val: `${delta >= 0 ? "+" : ""}${delta}`, sub: "poin, 6 bulan" },
          ];
          const colStep = 0.88;
          stats.forEach((st, i) => {
            const sx = cardX + 3.05 + i * colStep;
            s.addShape(pptx.ShapeType.ellipse, { x: sx, y: 5.42, w: 0.38, h: 0.38, fill: { color: "FBFAFF" }, line: { color: st.c, width: 1.25 } });
            s.addText(st.icon, { x: sx, y: 5.42, w: 0.38, h: 0.38, fontSize: 11, align: "center", valign: "middle", margin: 0 });
            s.addText(st.l, { x: sx - 0.1, y: 5.84, w: colStep, h: 0.2, fontSize: 6.5, bold: true, color: st.c, margin: 0 });
            s.addText(st.val, { x: sx - 0.1, y: 6.02, w: colStep, h: 0.4, fontSize: 14, bold: true, color: PURPLE, margin: 0 });
            s.addText(st.sub, { x: sx - 0.1, y: 6.44, w: colStep, h: 0.22, fontSize: 6.5, color: "999999", margin: 0 });
          });
        }

        s.addShape(pptx.ShapeType.roundRect, { x: cardX2, y: 1.15, w: cardW2, h: 6.0, rectRadius: 0.08, fill: { color: "F7F6FB" }, line: { color: "E4DFF2", width: 0.75 } });
        s.addText("KETERANGAN INDIKATOR", { x: cardX2 + 0.2, y: 1.3, w: 5, h: 0.3, fontSize: 13, bold: true, color: PURPLE, margin: 0 });
        const legendItems = [
          { c: GREEN, icon: "\u{1F6E1}\u{FE0F}", l: "Terkendali", r: "\u226585%", d: "Kondisi sangat baik" },
          { c: "2f9e9e", icon: "\u{1F514}", l: "Waspada", r: "70-84%", d: "Temuan ringan, masih toleran" },
          { c: AMBER, icon: "\u{1F50D}", l: "Monitoring", r: "50-69%", d: "Perlu tindakan korektif" },
          { c: RED, icon: "\u26A0\uFE0F", l: "Perlu Perhatian", r: "<50%", d: "Risiko tinggi, tindak lanjut" },
        ];
        legendItems.forEach((it, i) => {
          const yy = 1.85 + i * 1.15;
          s.addShape(pptx.ShapeType.ellipse, { x: cardX2 + 0.25, y: yy, w: 0.6, h: 0.6, fill: { color: it.c } });
          s.addText(it.icon, { x: cardX2 + 0.25, y: yy, w: 0.6, h: 0.6, fontSize: 20, align: "center", valign: "middle", margin: 0 });
          s.addText(it.l, { x: cardX2 + 1.05, y: yy - 0.02, w: 2.3, h: 0.32, fontSize: 13, bold: true, color: "222222", margin: 0 });
          s.addText(it.r, { x: cardX2 + 1.05, y: yy + 0.3, w: 1.4, h: 0.3, fontSize: 11.5, color: "666666", margin: 0 });
          s.addText(it.d, { x: cardX2 + 1.05, y: yy + 0.6, w: 4.3, h: 0.3, fontSize: 10, color: "777777", margin: 0 });
          if (i < legendItems.length - 1) s.addShape(pptx.ShapeType.rect, { x: cardX2 + 0.25, y: yy + 0.92, w: cardW2 - 0.5, h: 0.012, fill: { color: "EEEAF5" } });
        });
      }

      // ── 5. Service Ratio (dipecah jadi 3 slide) ──
      {
        const svcRowsAll = branches.map((b) => rows.find((r) => r.branch.id === b.id)).filter(Boolean);

        const svcTh = [
          { text: "No", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
          { text: "Cabang", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11 } },
          { text: "Laptop", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
          { text: "Stok Service", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
          { text: "Total Unit/Cabang", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
          { text: "Indikator", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
          { text: "% Ratio", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
        ];
        function svcTableRows(detailKey) {
          const body = svcRowsAll.map((r, i) => {
            const d = r[detailKey];
            if (!d || !d.hasData || d.tidakVisit) {
              return [
                { text: String(i + 1), options: { fontSize: 10.5, align: "center" } },
                { text: r.branch.name, options: { fontSize: 10.5, bold: true } },
                { text: "TIDAK VISIT", options: { colspan: 5, fontSize: 10.5, bold: true, align: "center", fill: { color: "DDE6F7" }, color: PURPLE } },
              ];
            }
            const info = serviceStatusInfo(d.ratio);
            // Makin kecil ratio makin bagus, jadi bar-nya dibalik: penuh kalau ratio-nya rendah.
            const barFilled = info.lbl === "Terkendali" ? 1 : info.lbl === "Monitoring" ? 0.6 : 0.2;
            return [
              { text: String(i + 1), options: { fontSize: 10, align: "center", bold: true, fill: { color: PURPLE }, color: WHITE } },
              { text: r.branch.name, options: { fontSize: 10.5, bold: true } },
              { text: String(d.laptop), options: { fontSize: 10.5, align: "center" } },
              { text: String(d.stokService), options: { fontSize: 10.5, align: "center" } },
              { text: String(d.totalUnit), options: { fontSize: 10.5, align: "center", bold: true } },
              { text: info.lbl, options: { fontSize: 10, align: "center", bold: true, color: WHITE, fill: { color: info.color.replace("#", "") } } },
              { text: `${textBar(barFilled)}  ${(d.ratio * 100).toFixed(2)}%`, options: { fontSize: 9, align: "center", bold: true, color: d.ratio >= 0.0033 ? RED : "1a9e6e" } },
            ];
          });
          const valid = svcRowsAll.map((r) => r[detailKey]).filter((d) => d && d.hasData && !d.tidakVisit);
          const avgRatio = valid.length ? valid.reduce((s2, d) => s2 + d.ratio, 0) / valid.length : 0;
          const totalStok = valid.reduce((s2, d) => s2 + d.stokService, 0);
          body.push([
            { text: "TOTAL / RATA-RATA", options: { colspan: 3, fontSize: 10.5, bold: true, fill: { color: PURPLE }, color: WHITE } },
            { text: String(totalStok), options: { fontSize: 10.5, bold: true, align: "center", fill: { color: PURPLE }, color: WHITE } },
            { text: "", options: { fill: { color: PURPLE } } },
            { text: "", options: { fill: { color: PURPLE } } },
            { text: `${(avgRatio * 100).toFixed(2)}%`, options: { fontSize: 10.5, bold: true, align: "center", fill: { color: PURPLE }, color: WHITE } },
          ]);
          return body;
        }

        function svcTableSlide(labelBulan, periodLbl, detailKey) {
          const s = newSlide();
          addGradientHeader(s, 0.85);
          s.addText("SERVICE RATIO CABANG", { x: 0.35, y: 0.08, w: 8.5, h: 0.42, fontSize: 20, bold: true, color: WHITE, margin: 0 });
          s.addText(`${labelBulan} \u2014 ${periodLbl}`, { x: 0.35, y: 0.5, w: 8.5, h: 0.3, fontSize: 13, bold: true, color: GOLD, margin: 0 });
          addLogo(s, 11.3, 0.18);
          s.addTable([svcTh].concat(svcTableRows(detailKey)), { x: 0.35, y: 1.15, w: 12.6, colW: [0.6, 3.2, 1.7, 1.9, 2.0, 1.7, 1.5], border: { type: "solid", color: "E5E5E5", pt: 0.5 }, autoPage: false, margin: [2, 4, 2, 4] });
        }
        svcTableSlide("BULAN LALU", periodeLabel(prevPeriod), "svcPrevDetail");
        svcTableSlide("BULAN INI", periodeLabel(period), "svcCurDetail");

        // ── Slide kartu ringkasan ──
        const s = newSlide();
        addGradientHeader(s, 0.85);
        s.addText("SERVICE RATIO CABANG \u2014 RINGKASAN", { x: 0.35, y: 0.08, w: 9, h: 0.42, fontSize: 20, bold: true, color: WHITE, margin: 0 });
        s.addText(`${periodeLabel(prevPeriod)} & ${periodeLabel(period)}`, { x: 0.35, y: 0.48, w: 9, h: 0.32, fontSize: 12, color: "E4DCFF", margin: 0 });
        addLogo(s, 11.3, 0.18);

        const cardX = 0.7, cardW = 5.7, cardX2 = 6.9, cardW2 = 5.7;
        s.addShape(pptx.ShapeType.roundRect, { x: cardX, y: 1.15, w: 2.75, h: 1.4, rectRadius: 0.08, fill: { color: "EEEAFB" }, line: { color: "E4DFF2", width: 0.75 } });
        s.addText(`RATA-RATA\n${periodeLabel(prevPeriod).toUpperCase()}`, { x: cardX + 0.2, y: 1.24, w: 1.9, h: 0.5, fontSize: 9.5, bold: true, color: "8a80a8", margin: 0 });
        s.addShape(pptx.ShapeType.ellipse, { x: cardX + 2.15, y: 1.24, w: 0.42, h: 0.42, fill: { color: "FFFFFF" } });
        s.addText("\u{1F4C9}", { x: cardX + 2.15, y: 1.24, w: 0.42, h: 0.42, fontSize: 15, align: "center", valign: "middle", margin: 0 });
        s.addText(svcPrevAvg !== null ? `${(svcPrevAvg * 100).toFixed(2)}%` : "\u2014", { x: cardX + 0.2, y: 1.62, w: 2.35, h: 0.55, fontSize: 26, bold: true, color: PURPLE, margin: 0 });
        s.addShape(pptx.ShapeType.roundRect, { x: cardX + 0.2, y: 2.28, w: 2.35, h: 0.08, rectRadius: 0.04, fill: { color: "DCD5F0" } });
        s.addShape(pptx.ShapeType.roundRect, { x: cardX + 0.2, y: 2.28, w: 2.35 * Math.min(1, (svcPrevAvg || 0) / 0.005), h: 0.08, rectRadius: 0.04, fill: { color: PURPLE } });

        s.addShape(pptx.ShapeType.roundRect, { x: cardX + 2.95, y: 1.15, w: 2.75, h: 1.4, rectRadius: 0.08, fill: { color: "FDF3E6" }, line: { color: "F5E4C8", width: 0.75 } });
        s.addText(`RATA-RATA\n${periodeLabel(period).toUpperCase()}`, { x: cardX + 3.15, y: 1.24, w: 1.9, h: 0.5, fontSize: 9.5, bold: true, color: "b0966a", margin: 0 });
        s.addShape(pptx.ShapeType.ellipse, { x: cardX + 5.1, y: 1.24, w: 0.42, h: 0.42, fill: { color: "FFFFFF" } });
        s.addText("\u{1F4C9}", { x: cardX + 5.1, y: 1.24, w: 0.42, h: 0.42, fontSize: 15, align: "center", valign: "middle", margin: 0 });
        s.addText(svcNow !== null ? `${(svcNow * 100).toFixed(2)}%` : "\u2014", { x: cardX + 3.15, y: 1.62, w: 2.35, h: 0.55, fontSize: 26, bold: true, color: PURPLE, margin: 0 });
        s.addShape(pptx.ShapeType.roundRect, { x: cardX + 3.15, y: 2.28, w: 2.35, h: 0.08, rectRadius: 0.04, fill: { color: "F0DFC0" } });
        s.addShape(pptx.ShapeType.roundRect, { x: cardX + 3.15, y: 2.28, w: 2.35 * Math.min(1, (svcNow || 0) / 0.005), h: 0.08, rectRadius: 0.04, fill: { color: "b0966a" } });

        // Buat Service Ratio, makin KECIL makin bagus — kebalik dari Kesehatan Stok.
        const svcTrendGood = svcPrevAvg !== null && svcNow !== null && svcNow <= svcPrevAvg;
        s.addShape(pptx.ShapeType.roundRect, { x: cardX, y: 2.7, w: cardW, h: 2.1, rectRadius: 0.08, fill: { color: "F7F6FB" }, line: { color: "E4DFF2", width: 0.75 } });
        s.addText("TREN 6 BULAN TERAKHIR", { x: cardX + 0.2, y: 2.82, w: 3.2, h: 0.3, fontSize: 11.5, bold: true, color: PURPLE, margin: 0 });
        if (svcPrevAvg !== null && svcNow !== null) {
          s.addText(`${svcTrendGood ? "\u25BC" : "\u25B2"} ${Math.abs((svcNow - svcPrevAvg) * 100).toFixed(2)}%`, { x: cardX + 3.3, y: 2.78, w: 2.2, h: 0.32, fontSize: 12.5, bold: true, color: svcTrendGood ? GREEN : RED, align: "right", margin: 0 });
        }
        addTrendChart(s, cardX + 0.1, 3.2, cardW - 0.2, 1.5, svcTrend, 2);

        s.addShape(pptx.ShapeType.roundRect, { x: cardX, y: 5.0, w: cardW, h: 2.15, rectRadius: 0.08, fill: { color: "F7F6FB" }, line: { color: "E4DFF2", width: 0.75 } });
        s.addText("RINGKASAN", { x: cardX + 0.2, y: 5.13, w: 4, h: 0.32, fontSize: 13, bold: true, color: PURPLE, margin: 0 });
        const svcBermasalahBranches = rows.filter((r) => r.svcRatio !== null && r.svcRatio >= 0.0033).map((r) => r.branch.name);
        const svcRingkasanLines = [
          svcPrevAvg !== null && svcNow !== null
            ? `Rata-rata Service Ratio ${svcTrendGood ? "membaik" : "meningkat"} dari ${(svcPrevAvg * 100).toFixed(2)}% menjadi ${(svcNow * 100).toFixed(2)}%.`
            : "Data pembanding bulan lalu belum lengkap.",
          svcBermasalahBranches.length
            ? `Perlu monitoring & tindak lanjut pada cabang: ${svcBermasalahBranches.join(", ")}.`
            : "Semua cabang berada di atas ambang aman bulan ini.",
        ];
        s.addText(svcRingkasanLines.map((t) => ({ text: t, options: { bullet: { code: "2022" }, breakLine: true, paraSpaceAfter: 8 } })), { x: cardX + 0.2, y: 5.5, w: 2.9, h: 1.55, fontSize: 10.5, color: "444444", valign: "top", margin: 0 });

        const svcValid = svcTrend.map((v, i) => ({ v, p: trendPeriods[i] })).filter((o) => o.v !== null);
        if (svcValid.length) {
          const lowO = svcValid.reduce((a, b) => (b.v < a.v ? b : a)); // makin kecil makin bagus
          const highO = svcValid.reduce((a, b) => (b.v > a.v ? b : a));
          const delta = ((svcValid[svcValid.length - 1].v - svcValid[0].v) * 100);
          const stats = [
            { icon: "\u{1F538}", c: GREEN, l: "TERBAIK", val: `${(lowO.v * 100).toFixed(2)}%`, sub: shortMonth(lowO.p) },
            { icon: "\u{1F53B}", c: RED, l: "TERBURUK", val: `${(highO.v * 100).toFixed(2)}%`, sub: shortMonth(highO.p) },
            { icon: "\u{1F4C8}", c: PURPLE, l: "PERUBAHAN", val: `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`, sub: "poin, 6 bulan" },
          ];
          const colStep = 0.88;
          stats.forEach((st, i) => {
            const sx = cardX + 3.05 + i * colStep;
            s.addShape(pptx.ShapeType.ellipse, { x: sx, y: 5.42, w: 0.38, h: 0.38, fill: { color: "FBFAFF" }, line: { color: st.c, width: 1.25 } });
            s.addText(st.icon, { x: sx, y: 5.42, w: 0.38, h: 0.38, fontSize: 11, align: "center", valign: "middle", margin: 0 });
            s.addText(st.l, { x: sx - 0.1, y: 5.84, w: colStep, h: 0.2, fontSize: 6.5, bold: true, color: st.c, margin: 0 });
            s.addText(st.val, { x: sx - 0.1, y: 6.02, w: colStep, h: 0.4, fontSize: 13, bold: true, color: PURPLE, margin: 0 });
            s.addText(st.sub, { x: sx - 0.1, y: 6.44, w: colStep, h: 0.22, fontSize: 6.5, color: "999999", margin: 0 });
          });
        }

        s.addShape(pptx.ShapeType.roundRect, { x: cardX2, y: 1.15, w: cardW2, h: 6.0, rectRadius: 0.08, fill: { color: "F7F6FB" }, line: { color: "E4DFF2", width: 0.75 } });
        s.addText("KETERANGAN INDIKATOR", { x: cardX2 + 0.2, y: 1.3, w: 5, h: 0.3, fontSize: 13, bold: true, color: PURPLE, margin: 0 });
        const svcLegendItems = [
          { c: GREEN, icon: "\u{1F6E1}\u{FE0F}", l: "Terkendali", r: "\u22640,22%", d: "Rasio service sehat" },
          { c: AMBER, icon: "\u{1F50D}", l: "Monitoring", r: "0,22-0,33%", d: "Perlu dipantau berkala" },
          { c: RED, icon: "\u26A0\uFE0F", l: "Perlu Perhatian", r: "\u22650,33%", d: "Perlu tindak lanjut" },
        ];
        svcLegendItems.forEach((it, i) => {
          const yy = 1.85 + i * 1.15;
          s.addShape(pptx.ShapeType.ellipse, { x: cardX2 + 0.25, y: yy, w: 0.6, h: 0.6, fill: { color: it.c } });
          s.addText(it.icon, { x: cardX2 + 0.25, y: yy, w: 0.6, h: 0.6, fontSize: 20, align: "center", valign: "middle", margin: 0 });
          s.addText(it.l, { x: cardX2 + 1.05, y: yy - 0.02, w: 2.3, h: 0.32, fontSize: 13, bold: true, color: "222222", margin: 0 });
          s.addText(it.r, { x: cardX2 + 1.05, y: yy + 0.3, w: 1.4, h: 0.3, fontSize: 11.5, color: "666666", margin: 0 });
          s.addText(it.d, { x: cardX2 + 1.05, y: yy + 0.6, w: 4.3, h: 0.3, fontSize: 10, color: "777777", margin: 0 });
          if (i < svcLegendItems.length - 1) s.addShape(pptx.ShapeType.rect, { x: cardX2 + 0.25, y: yy + 0.92, w: cardW2 - 0.5, h: 0.012, fill: { color: "EEEAF5" } });
        });
      }

      // ── 6. Audit Keuangan (dipecah jadi 3 slide) ──
      {
        const keuColorMap = { good: "#1a9e6e", warn: "#b07212", bad: "#a32020" };
        const keuRowsAll = branches.map((b) => rows.find((r) => r.branch.id === b.id)).filter(Boolean);

        const keuTh = [
          { text: "No", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
          { text: "Cabang", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11 } },
          { text: "Saldo Masuk", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
          { text: "Pengeluaran", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
          { text: "Sisa Saldo", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
          { text: "Indikator", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
          { text: "% Posisi", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
        ];
        function keuTableRows(detailKey) {
          const body = keuRowsAll.map((r, i) => {
            const d = r[detailKey];
            if (!d || !d.hasData || d.tidakVisit) {
              return [
                { text: String(i + 1), options: { fontSize: 10.5, align: "center" } },
                { text: r.branch.name, options: { fontSize: 10.5, bold: true } },
                { text: "TIDAK VISIT", options: { colspan: 5, fontSize: 10.5, bold: true, align: "center", fill: { color: "DDE6F7" }, color: PURPLE } },
              ];
            }
            const isBaru = d.cabangBaru;
            const barFilled = d.tone === "good" ? 1 : d.tone === "warn" ? 0.6 : 0.2;
            return [
              { text: String(i + 1), options: { fontSize: 10, align: "center", bold: true, fill: { color: PURPLE }, color: WHITE } },
              { text: isBaru ? `\u2b50 ${r.branch.name}` : r.branch.name, options: { fontSize: 10.3, bold: true } },
              { text: `Rp${d.saldoMasuk.toLocaleString("id-ID")}`, options: { fontSize: 10.2, align: "center" } },
              { text: `Rp${d.pengeluaran.toLocaleString("id-ID")}`, options: { fontSize: 10.2, align: "center" } },
              { text: `Rp${d.sisa.toLocaleString("id-ID")}`, options: { fontSize: 10.2, align: "center", color: d.sisa < 0 ? RED : "333333" } },
              isBaru
                ? { text: "CABANG BARU", options: { fontSize: 9, align: "center", bold: true, color: WHITE, fill: { color: "F4B740" } } }
                : { text: d.indikator, options: { fontSize: 9.5, align: "center", bold: true, color: WHITE, fill: { color: keuColorMap[d.tone].replace("#", "") } } },
              { text: `${textBar(barFilled)}  ${(d.posisi * 100).toFixed(1)}%`, options: { fontSize: 9, align: "center", bold: true, color: d.tone === "bad" ? RED : "1a9e6e" } },
            ];
          });
          const valid = keuRowsAll.map((r) => r[detailKey]).filter((d) => d && d.hasData && !d.tidakVisit);
          const avgPosisi = valid.length ? valid.reduce((s2, d) => s2 + d.posisi, 0) / valid.length : 0;
          const totalPengeluaran = valid.reduce((s2, d) => s2 + d.pengeluaran, 0);
          body.push([
            { text: "TOTAL / RATA-RATA", options: { colspan: 3, fontSize: 10.5, bold: true, fill: { color: PURPLE }, color: WHITE } },
            { text: `Rp${totalPengeluaran.toLocaleString("id-ID")}`, options: { fontSize: 10.2, bold: true, align: "center", fill: { color: PURPLE }, color: WHITE } },
            { text: "", options: { fill: { color: PURPLE } } },
            { text: "", options: { fill: { color: PURPLE } } },
            { text: `${(avgPosisi * 100).toFixed(1)}%`, options: { fontSize: 10.5, bold: true, align: "center", fill: { color: PURPLE }, color: WHITE } },
          ]);
          return body;
        }

        function keuTableSlide(labelBulan, periodLbl, detailKey) {
          const s = newSlide();
          addGradientHeader(s, 0.85);
          s.addText("AUDIT KEUANGAN CABANG", { x: 0.35, y: 0.08, w: 8.5, h: 0.42, fontSize: 20, bold: true, color: WHITE, margin: 0 });
          s.addText(`${labelBulan} \u2014 ${periodLbl}`, { x: 0.35, y: 0.5, w: 8.5, h: 0.3, fontSize: 13, bold: true, color: GOLD, margin: 0 });
          addLogo(s, 11.3, 0.18);
          s.addTable([keuTh].concat(keuTableRows(detailKey)), { x: 0.35, y: 1.15, w: 12.6, colW: [0.55, 2.7, 2.15, 2.15, 2.15, 1.5, 1.4], border: { type: "solid", color: "E5E5E5", pt: 0.5 }, autoPage: false, margin: [2, 4, 2, 4] });
        }
        keuTableSlide("BULAN LALU", periodeLabel(prevPeriod), "keuPrevDetail");
        keuTableSlide("BULAN INI", periodeLabel(period), "keuCurDetail");

        // ── Slide kartu ringkasan ──
        const s = newSlide();
        addGradientHeader(s, 0.85);
        s.addText("AUDIT KEUANGAN CABANG \u2014 RINGKASAN", { x: 0.35, y: 0.08, w: 9, h: 0.42, fontSize: 20, bold: true, color: WHITE, margin: 0 });
        s.addText(`${periodeLabel(prevPeriod)} & ${periodeLabel(period)}`, { x: 0.35, y: 0.48, w: 9, h: 0.32, fontSize: 12, color: "E4DCFF", margin: 0 });
        addLogo(s, 11.3, 0.18);

        const cardX = 0.7, cardW = 5.7, cardX2 = 6.9, cardW2 = 5.7;
        s.addShape(pptx.ShapeType.roundRect, { x: cardX, y: 1.15, w: 2.75, h: 1.4, rectRadius: 0.08, fill: { color: "EEEAFB" }, line: { color: "E4DFF2", width: 0.75 } });
        s.addText(`RATA-RATA\n${periodeLabel(prevPeriod).toUpperCase()}`, { x: cardX + 0.2, y: 1.24, w: 1.9, h: 0.5, fontSize: 9.5, bold: true, color: "8a80a8", margin: 0 });
        s.addShape(pptx.ShapeType.ellipse, { x: cardX + 2.15, y: 1.24, w: 0.42, h: 0.42, fill: { color: "FFFFFF" } });
        s.addText("\u{1F4B0}", { x: cardX + 2.15, y: 1.24, w: 0.42, h: 0.42, fontSize: 15, align: "center", valign: "middle", margin: 0 });
        s.addText(keuPrevAvg !== null ? `${Math.round(keuPrevAvg * 100)}%` : "\u2014", { x: cardX + 0.2, y: 1.62, w: 2.35, h: 0.55, fontSize: 30, bold: true, color: PURPLE, margin: 0 });
        s.addShape(pptx.ShapeType.roundRect, { x: cardX + 0.2, y: 2.28, w: 2.35, h: 0.08, rectRadius: 0.04, fill: { color: "DCD5F0" } });
        s.addShape(pptx.ShapeType.roundRect, { x: cardX + 0.2, y: 2.28, w: 2.35 * Math.min(1, (keuPrevAvg || 0)), h: 0.08, rectRadius: 0.04, fill: { color: PURPLE } });

        s.addShape(pptx.ShapeType.roundRect, { x: cardX + 2.95, y: 1.15, w: 2.75, h: 1.4, rectRadius: 0.08, fill: { color: "FDF3E6" }, line: { color: "F5E4C8", width: 0.75 } });
        s.addText(`RATA-RATA\n${periodeLabel(period).toUpperCase()}`, { x: cardX + 3.15, y: 1.24, w: 1.9, h: 0.5, fontSize: 9.5, bold: true, color: "b0966a", margin: 0 });
        s.addShape(pptx.ShapeType.ellipse, { x: cardX + 5.1, y: 1.24, w: 0.42, h: 0.42, fill: { color: "FFFFFF" } });
        s.addText("\u{1F4B0}", { x: cardX + 5.1, y: 1.24, w: 0.42, h: 0.42, fontSize: 15, align: "center", valign: "middle", margin: 0 });
        s.addText(keuNowAvg !== null ? `${Math.round(keuNowAvg * 100)}%` : "\u2014", { x: cardX + 3.15, y: 1.62, w: 2.35, h: 0.55, fontSize: 30, bold: true, color: PURPLE, margin: 0 });
        s.addShape(pptx.ShapeType.roundRect, { x: cardX + 3.15, y: 2.28, w: 2.35, h: 0.08, rectRadius: 0.04, fill: { color: "F0DFC0" } });
        s.addShape(pptx.ShapeType.roundRect, { x: cardX + 3.15, y: 2.28, w: 2.35 * Math.min(1, (keuNowAvg || 0)), h: 0.08, rectRadius: 0.04, fill: { color: "b0966a" } });

        s.addShape(pptx.ShapeType.roundRect, { x: cardX, y: 2.7, w: cardW, h: 2.1, rectRadius: 0.08, fill: { color: "F7F6FB" }, line: { color: "E4DFF2", width: 0.75 } });
        s.addText("TREN POSISI KAS 6 BULAN", { x: cardX + 0.2, y: 2.82, w: 3.2, h: 0.3, fontSize: 11.5, bold: true, color: PURPLE, margin: 0 });
        s.addText(`${negBalanceNow} cabang minus`, { x: cardX + 3.3, y: 2.78, w: 2.2, h: 0.32, fontSize: 12.5, bold: true, color: negBalanceNow > 0 ? RED : GREEN, align: "right", margin: 0 });
        addTrendChart(s, cardX + 0.1, 3.2, cardW - 0.2, 1.5, keuTrend, 0);

        s.addShape(pptx.ShapeType.roundRect, { x: cardX, y: 5.0, w: cardW, h: 2.15, rectRadius: 0.08, fill: { color: "F7F6FB" }, line: { color: "E4DFF2", width: 0.75 } });
        s.addText("RINGKASAN", { x: cardX + 0.2, y: 5.13, w: 4, h: 0.32, fontSize: 13, bold: true, color: PURPLE, margin: 0 });
        const keuNegRows = rows.filter((r) => r.sisa !== null && r.sisa < 0).map((r) => r.branch.name);
        const keuRingkasanLines = [
          `Total pengeluaran kas kecil seluruh cabang bulan ini: Rp${totalKasKeluar.toLocaleString("id-ID")}.`,
          keuNegRows.length
            ? `Cabang saldo minus: ${keuNegRows.join(", ")}.`
            : "Tidak ada cabang dengan saldo minus bulan ini.",
        ];
        s.addText(keuRingkasanLines.map((t) => ({ text: t, options: { bullet: { code: "2022" }, breakLine: true, paraSpaceAfter: 8 } })), { x: cardX + 0.2, y: 5.5, w: 2.9, h: 1.55, fontSize: 10.5, color: "444444", valign: "top", margin: 0 });

        const keuValid = keuTrend.map((v, i) => ({ v, p: trendPeriods[i] })).filter((o) => o.v !== null);
        if (keuValid.length) {
          const lowO = keuValid.reduce((a, b) => (b.v < a.v ? b : a)); // makin kecil makin bagus
          const highO = keuValid.reduce((a, b) => (b.v > a.v ? b : a));
          const delta = Math.round((keuValid[keuValid.length - 1].v - keuValid[0].v) * 100);
          const stats = [
            { icon: "\u{1F538}", c: GREEN, l: "TERBAIK", val: `${Math.round(lowO.v * 100)}%`, sub: shortMonth(lowO.p) },
            { icon: "\u{1F53B}", c: RED, l: "TERBURUK", val: `${Math.round(highO.v * 100)}%`, sub: shortMonth(highO.p) },
            { icon: "\u{1F4C8}", c: PURPLE, l: "PERUBAHAN", val: `${delta >= 0 ? "+" : ""}${delta}`, sub: "poin, 6 bulan" },
          ];
          const colStep = 0.88;
          stats.forEach((st, i) => {
            const sx = cardX + 3.05 + i * colStep;
            s.addShape(pptx.ShapeType.ellipse, { x: sx, y: 5.42, w: 0.38, h: 0.38, fill: { color: "FBFAFF" }, line: { color: st.c, width: 1.25 } });
            s.addText(st.icon, { x: sx, y: 5.42, w: 0.38, h: 0.38, fontSize: 11, align: "center", valign: "middle", margin: 0 });
            s.addText(st.l, { x: sx - 0.1, y: 5.84, w: colStep, h: 0.2, fontSize: 6.5, bold: true, color: st.c, margin: 0 });
            s.addText(st.val, { x: sx - 0.1, y: 6.02, w: colStep, h: 0.4, fontSize: 14, bold: true, color: PURPLE, margin: 0 });
            s.addText(st.sub, { x: sx - 0.1, y: 6.44, w: colStep, h: 0.22, fontSize: 6.5, color: "999999", margin: 0 });
          });
        }

        s.addShape(pptx.ShapeType.roundRect, { x: cardX2, y: 1.15, w: cardW2, h: 6.0, rectRadius: 0.08, fill: { color: "F7F6FB" }, line: { color: "E4DFF2", width: 0.75 } });
        s.addText("KETERANGAN INDIKATOR", { x: cardX2 + 0.2, y: 1.3, w: 5, h: 0.3, fontSize: 13, bold: true, color: PURPLE, margin: 0 });
        const keuLegendItems = [
          { c: GREEN, icon: "\u{1F6E1}\u{FE0F}", l: "Terkendali / Efisien", r: `\u2264${keuSettings.efisien}%`, d: "Posisi kas aman" },
          { c: AMBER, icon: "\u{1F50D}", l: "Monitoring", r: `${keuSettings.efisien}-${keuSettings.monitoring}%`, d: "Perlu dipantau" },
          { c: RED, icon: "\u26A0\uFE0F", l: "Tindak Lanjut / Pengecekan", r: `>${keuSettings.monitoring}%`, d: "Perlu tindak lanjut" },
        ];
        keuLegendItems.forEach((it, i) => {
          const yy = 1.85 + i * 1.15;
          s.addShape(pptx.ShapeType.ellipse, { x: cardX2 + 0.25, y: yy, w: 0.6, h: 0.6, fill: { color: it.c } });
          s.addText(it.icon, { x: cardX2 + 0.25, y: yy, w: 0.6, h: 0.6, fontSize: 20, align: "center", valign: "middle", margin: 0 });
          s.addText(it.l, { x: cardX2 + 1.05, y: yy - 0.02, w: 3.6, h: 0.32, fontSize: 12.5, bold: true, color: "222222", margin: 0 });
          s.addText(it.r, { x: cardX2 + 1.05, y: yy + 0.3, w: 1.8, h: 0.3, fontSize: 11.5, color: "666666", margin: 0 });
          s.addText(it.d, { x: cardX2 + 1.05, y: yy + 0.6, w: 4.3, h: 0.3, fontSize: 10, color: "777777", margin: 0 });
          if (i < keuLegendItems.length - 1) s.addShape(pptx.ShapeType.rect, { x: cardX2 + 0.25, y: yy + 0.92, w: cardW2 - 0.5, h: 0.012, fill: { color: "EEEAF5" } });
        });
      }

      // ── 7. Kepatuhan SOP (dipecah jadi 3 slide) ──
      {
        const kepRowsAll = branches.map((b) => rows.find((r) => r.branch.id === b.id)).filter(Boolean);

        const kepTh = [
          { text: "No", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
          { text: "Cabang", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11 } },
          { text: "SOP", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
          { text: "Stok", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
          { text: "Keu.", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
          { text: "Aset", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
          { text: "Total", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
          { text: "% Skor", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
        ];
        function kepTableRows(detailKey) {
          const body = kepRowsAll.map((r, i) => {
            const d = r[detailKey];
            if (!d || !d.hasData || d.tidakVisit) {
              return [
                { text: String(i + 1), options: { fontSize: 10.5, align: "center" } },
                { text: r.branch.name, options: { fontSize: 10.5, bold: true } },
                { text: "TIDAK VISIT", options: { colspan: 6, fontSize: 10.5, bold: true, align: "center", fill: { color: "DDE6F7" }, color: PURPLE } },
              ];
            }
            const isBaru = d.cabangBaru;
            const info = kategoriInfo(d.pct);
            return [
              { text: String(i + 1), options: { fontSize: 10, align: "center", bold: true, fill: { color: PURPLE }, color: WHITE } },
              { text: isBaru ? `\u2b50 ${r.branch.name}` : r.branch.name, options: { fontSize: 10.3, bold: true } },
              { text: String(d.sopTemuan), options: { fontSize: 10.5, align: "center" } },
              { text: String(d.stokTemuan), options: { fontSize: 10.5, align: "center" } },
              { text: String(d.keuanganTemuan), options: { fontSize: 10.5, align: "center" } },
              { text: String(d.asetTemuan), options: { fontSize: 10.5, align: "center" } },
              { text: String(d.totalTemuan), options: { fontSize: 10.5, align: "center", bold: true } },
              isBaru
                ? { text: "BARU", options: { fontSize: 9, align: "center", bold: true, color: WHITE, fill: { color: "F4B740" } } }
                : { text: `${textBar(d.pct)} ${Math.round(d.pct * 100)}%`, options: { fontSize: 8.5, align: "center", bold: true, color: WHITE, fill: { color: info.color } } },
            ];
          });
          const valid = kepRowsAll.map((r) => r[detailKey]).filter((d) => d && d.hasData && !d.tidakVisit && !d.cabangBaru);
          const avgPct = valid.length ? valid.reduce((s2, d) => s2 + d.pct, 0) / valid.length : 0;
          const totalTemuanAll = kepRowsAll.map((r) => r[detailKey]).filter((d) => d && d.hasData && !d.tidakVisit).reduce((s2, d) => s2 + d.totalTemuan, 0);
          body.push([
            { text: "TOTAL / RATA-RATA", options: { colspan: 6, fontSize: 10.5, bold: true, fill: { color: PURPLE }, color: WHITE } },
            { text: String(totalTemuanAll), options: { fontSize: 10.5, bold: true, align: "center", fill: { color: PURPLE }, color: WHITE } },
            { text: `${Math.round(avgPct * 100)}%`, options: { fontSize: 10.5, bold: true, align: "center", fill: { color: PURPLE }, color: WHITE } },
          ]);
          return body;
        }

        function kepTableSlide(labelBulan, periodLbl, detailKey) {
          const s = newSlide();
          addGradientHeader(s, 0.85);
          s.addText("KEPATUHAN SOP CABANG", { x: 0.35, y: 0.08, w: 8.5, h: 0.42, fontSize: 20, bold: true, color: WHITE, margin: 0 });
          s.addText(`${labelBulan} \u2014 ${periodLbl}`, { x: 0.35, y: 0.5, w: 8.5, h: 0.3, fontSize: 13, bold: true, color: GOLD, margin: 0 });
          addLogo(s, 11.3, 0.18);
          s.addTable([kepTh].concat(kepTableRows(detailKey)), { x: 0.35, y: 1.15, w: 12.6, colW: [0.55, 3.4, 1.35, 1.35, 1.35, 1.2, 1.35, 2.05], border: { type: "solid", color: "E5E5E5", pt: 0.5 }, autoPage: false, margin: [2, 4, 2, 4] });
        }
        kepTableSlide("BULAN LALU", periodeLabel(prevPeriod), "kepPrevDetail");
        kepTableSlide("BULAN INI", periodeLabel(period), "kepCurDetail");

        // ── Slide kartu ringkasan ──
        const s = newSlide();
        addGradientHeader(s, 0.85);
        s.addText("KEPATUHAN SOP CABANG \u2014 RINGKASAN", { x: 0.35, y: 0.08, w: 9, h: 0.42, fontSize: 20, bold: true, color: WHITE, margin: 0 });
        s.addText(`${periodeLabel(prevPeriod)} & ${periodeLabel(period)}`, { x: 0.35, y: 0.48, w: 9, h: 0.32, fontSize: 12, color: "E4DCFF", margin: 0 });
        addLogo(s, 11.3, 0.18);

        const cardX = 0.7, cardW = 5.7, cardX2 = 6.9, cardW2 = 5.7;
        s.addShape(pptx.ShapeType.roundRect, { x: cardX, y: 1.15, w: cardW, h: 1.4, rectRadius: 0.08, fill: { color: "EEEAFB" }, line: { color: "E4DFF2", width: 0.75 } });
        s.addText("SKOR KEPATUHAN BULAN INI", { x: cardX + 0.2, y: 1.28, w: 4, h: 0.32, fontSize: 11, bold: true, color: "8a80a8", margin: 0 });
        s.addText(kepatuhanAvg !== null ? `${Math.round(kepatuhanAvg * 100)}%` : "\u2014", { x: cardX + 0.2, y: 1.6, w: 3, h: 0.85, fontSize: 36, bold: true, color: PURPLE, margin: 0 });
        s.addShape(pptx.ShapeType.ellipse, { x: cardX + 4.6, y: 1.32, w: 0.55, h: 0.55, fill: { color: "FFFFFF" } });
        s.addText("\u{1F4CB}", { x: cardX + 4.6, y: 1.32, w: 0.55, h: 0.55, fontSize: 20, align: "center", valign: "middle", margin: 0 });
        s.addText(`${totalTemuanKepatuhan} Temuan`, { x: cardX + 3.3, y: 1.95, w: 1.85, h: 0.35, fontSize: 11.5, bold: true, color: RED, align: "right", margin: 0 });
        s.addShape(pptx.ShapeType.roundRect, { x: cardX + 0.2, y: 2.35, w: 5.3, h: 0.08, rectRadius: 0.04, fill: { color: "DCD5F0" } });
        s.addShape(pptx.ShapeType.roundRect, { x: cardX + 0.2, y: 2.35, w: 5.3 * Math.min(1, (kepatuhanAvg || 0)), h: 0.08, rectRadius: 0.04, fill: { color: PURPLE } });

        const kepTrendUp = kepatuhanTrend[4] !== null && kepatuhanTrend[5] !== null && kepatuhanTrend[5] >= kepatuhanTrend[4];
        s.addShape(pptx.ShapeType.roundRect, { x: cardX, y: 2.7, w: cardW, h: 2.1, rectRadius: 0.08, fill: { color: "F7F6FB" }, line: { color: "E4DFF2", width: 0.75 } });
        s.addText("TREN 6 BULAN TERAKHIR", { x: cardX + 0.2, y: 2.82, w: 3.2, h: 0.3, fontSize: 11.5, bold: true, color: PURPLE, margin: 0 });
        if (kepatuhanTrend[4] !== null && kepatuhanTrend[5] !== null) {
          s.addText(`${kepTrendUp ? "\u25B2" : "\u25BC"} ${Math.abs(Math.round((kepatuhanTrend[5] - kepatuhanTrend[4]) * 100))} poin`, { x: cardX + 3.3, y: 2.78, w: 2.2, h: 0.32, fontSize: 12.5, bold: true, color: kepTrendUp ? GREEN : RED, align: "right", margin: 0 });
        }
        addTrendChart(s, cardX + 0.1, 3.2, cardW - 0.2, 1.5, kepatuhanTrend, 0);

        s.addShape(pptx.ShapeType.roundRect, { x: cardX, y: 5.0, w: cardW, h: 2.15, rectRadius: 0.08, fill: { color: "F7F6FB" }, line: { color: "E4DFF2", width: 0.75 } });
        s.addText("RINGKASAN", { x: cardX + 0.2, y: 5.13, w: 4, h: 0.32, fontSize: 13, bold: true, color: PURPLE, margin: 0 });
        const kepBermasalahBranches = rows.filter((r) => r.kepatuhan !== null && r.kepatuhan < 0.7).map((r) => r.branch.name);
        const kepRingkasanLines = [
          `Skor Kepatuhan SOP gabungan company-wide: ${kepatuhanAvg !== null ? Math.round(kepatuhanAvg * 100) + "%" : "belum ada data"}, total ${totalTemuanKepatuhan} temuan.`,
          kepBermasalahBranches.length
            ? `Perlu tindak lanjut pada cabang: ${kepBermasalahBranches.join(", ")}.`
            : "Semua cabang berada di atas ambang aman bulan ini.",
        ];
        s.addText(kepRingkasanLines.map((t) => ({ text: t, options: { bullet: { code: "2022" }, breakLine: true, paraSpaceAfter: 8 } })), { x: cardX + 0.2, y: 5.5, w: 2.9, h: 1.55, fontSize: 10.5, color: "444444", valign: "top", margin: 0 });

        const kepValid = kepatuhanTrend.map((v, i) => ({ v, p: trendPeriods[i] })).filter((o) => o.v !== null);
        if (kepValid.length) {
          const peakO = kepValid.reduce((a, b) => (b.v > a.v ? b : a));
          const lowO = kepValid.reduce((a, b) => (b.v < a.v ? b : a));
          const delta = Math.round((kepValid[kepValid.length - 1].v - kepValid[0].v) * 100);
          const stats = [
            { icon: "\u{1F538}", c: GREEN, l: "PUNCAK", val: `${Math.round(peakO.v * 100)}%`, sub: shortMonth(peakO.p) },
            { icon: "\u{1F53B}", c: RED, l: "TERENDAH", val: `${Math.round(lowO.v * 100)}%`, sub: shortMonth(lowO.p) },
            { icon: "\u{1F4C8}", c: PURPLE, l: "PERUBAHAN", val: `${delta >= 0 ? "+" : ""}${delta}`, sub: "poin, 6 bulan" },
          ];
          const colStep = 0.88;
          stats.forEach((st, i) => {
            const sx = cardX + 3.05 + i * colStep;
            s.addShape(pptx.ShapeType.ellipse, { x: sx, y: 5.42, w: 0.38, h: 0.38, fill: { color: "FBFAFF" }, line: { color: st.c, width: 1.25 } });
            s.addText(st.icon, { x: sx, y: 5.42, w: 0.38, h: 0.38, fontSize: 11, align: "center", valign: "middle", margin: 0 });
            s.addText(st.l, { x: sx - 0.1, y: 5.84, w: colStep, h: 0.2, fontSize: 6.5, bold: true, color: st.c, margin: 0 });
            s.addText(st.val, { x: sx - 0.1, y: 6.02, w: colStep, h: 0.4, fontSize: 14, bold: true, color: PURPLE, margin: 0 });
            s.addText(st.sub, { x: sx - 0.1, y: 6.44, w: colStep, h: 0.22, fontSize: 6.5, color: "999999", margin: 0 });
          });
        }

        s.addShape(pptx.ShapeType.roundRect, { x: cardX2, y: 1.15, w: cardW2, h: 6.0, rectRadius: 0.08, fill: { color: "F7F6FB" }, line: { color: "E4DFF2", width: 0.75 } });
        s.addText("KETERANGAN INDIKATOR", { x: cardX2 + 0.2, y: 1.3, w: 5, h: 0.3, fontSize: 13, bold: true, color: PURPLE, margin: 0 });
        const kepLegendItems = [
          { c: "1a9e6e", icon: "\u{1F31F}", l: "Sangat Baik", r: "\u226590%", d: "Kepatuhan sangat baik" },
          { c: "2f9e46", icon: "\u2705", l: "Baik", r: "80-89%", d: "Kepatuhan baik" },
          { c: "b07212", icon: "\u{1F50D}", l: "Cukup", r: "70-79%", d: "Perlu ditingkatkan" },
          { c: "a32020", icon: "\u26A0\uFE0F", l: "Perlu Perbaikan", r: "<70%", d: "Risiko tinggi" },
        ];
        kepLegendItems.forEach((it, i) => {
          const yy = 1.85 + i * 1.15;
          s.addShape(pptx.ShapeType.ellipse, { x: cardX2 + 0.25, y: yy, w: 0.6, h: 0.6, fill: { color: it.c } });
          s.addText(it.icon, { x: cardX2 + 0.25, y: yy, w: 0.6, h: 0.6, fontSize: 20, align: "center", valign: "middle", margin: 0 });
          s.addText(it.l, { x: cardX2 + 1.05, y: yy - 0.02, w: 2.3, h: 0.32, fontSize: 13, bold: true, color: "222222", margin: 0 });
          s.addText(it.r, { x: cardX2 + 1.05, y: yy + 0.3, w: 1.4, h: 0.3, fontSize: 11.5, color: "666666", margin: 0 });
          s.addText(it.d, { x: cardX2 + 1.05, y: yy + 0.6, w: 4.3, h: 0.3, fontSize: 10, color: "777777", margin: 0 });
          if (i < kepLegendItems.length - 1) s.addShape(pptx.ShapeType.rect, { x: cardX2 + 0.25, y: yy + 0.92, w: cardW2 - 0.5, h: 0.012, fill: { color: "EEEAF5" } });
        });
      }

      // ── 8..N. Temuan per cabang (cuma yang ada temuan) ──
      const branchesWithFindings = rows.filter((r) => r.findings.length > 0);
      branchesWithFindings.forEach((r) => {
        const findingsAll = r.findings;
        const chunks = [];
        for (let i = 0; i < findingsAll.length; i += 3) chunks.push(findingsAll.slice(i, i + 3));
        if (!chunks.length) chunks.push([]);

        chunks.forEach((chunk, pageIdx) => {
          const s = newSlide();
          addGradientHeader(s, 1.15);
          s.addText(`${r.branch.name.toUpperCase()} \u2014 TEMUAN AUDIT`, { x: 0.4, y: 0.15, w: 8.5, h: 0.45, fontSize: 20, bold: true, color: WHITE, margin: 0 });
          s.addText([
            { text: `\u{1F4C5}  Audit Date: ${shortDate2(r.sopCur?.data?.audit_date)}`, options: { fontSize: 11.5, color: "E4DCFF", bold: true } },
            { text: "     |     ", options: { fontSize: 11.5, color: "8A7BC2" } },
            { text: `\u{1F4CD}  Lokasi: Toko ${r.branch.name}`, options: { fontSize: 11.5, color: "E4DCFF", bold: true } },
          ], { x: 0.4, y: 0.72, w: 8.5, h: 0.35, margin: 0 });
          s.addText(periodeLabel(period), { x: 8.6, y: 0.3, w: 2.35, h: 0.4, fontSize: 13, color: GOLD, align: "right", margin: 0 });
          s.addShape(pptx.ShapeType.rect, { x: 11.05, y: 0.28, w: 0.014, h: 0.44, fill: { color: "6b5f96" } });
          addLogo(s, 11.3, 0.18);

          if (chunk.length === 0) {
            s.addText("Tidak ada temuan pada periode ini.", { x: 0.5, y: 2.5, w: 12.3, h: 0.6, fontSize: 14, color: GREY, align: "center" });
          } else {
            const gap = 0.3;
            // Lebar kartu tetap kayak tata letak 3 kolom, biar 1-2 foto nggak dipaksa melebar jadi landscape.
            const colW = (12.33 - gap * 2) / 3;
            const rowW = chunk.length * colW + (chunk.length - 1) * gap;
            const rowStartX = 0.5 + (12.33 - rowW) / 2;
            chunk.forEach((f, ci) => {
              const x = rowStartX + ci * (colW + gap);
              const cardTop = 1.35;

              // Nomor urut + judul temuan
              s.addShape(pptx.ShapeType.roundRect, { x, y: cardTop, w: 0.46, h: 0.46, rectRadius: 0.08, fill: { color: PURPLE } });
              s.addText(String(pageIdx * 3 + ci + 1).padStart(2, "0"), { x, y: cardTop, w: 0.46, h: 0.46, fontSize: 14, bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });
              s.addText(f.text.toUpperCase(), { x: x + 0.58, y: cardTop, w: colW - 0.58, h: 0.55, fontSize: 11.5, bold: true, color: PURPLE, valign: "middle", margin: 0 });

              // Foto / video — pakai "contain" biar rasio aslinya kejaga, nggak gepeng/kepotong
              const media = f.media && f.media[0];
              const hasMedia = !!media;
              const mediaY = cardTop + 0.62;
              const mediaH = hasMedia ? 2.85 : 0.55;
              if (hasMedia) {
                s.addShape(pptx.ShapeType.rect, { x, y: mediaY, w: colW, h: mediaH, fill: { color: "F5F3FA" }, line: { color: "E5E0F0", width: 1 } });
                if (media.type === "video") {
                  s.addText("\u25B6 Video", { x, y: mediaY, w: colW, h: mediaH, align: "center", valign: "middle", fontSize: 14, color: PURPLE });
                } else {
                  try { s.addImage({ path: media.url, x, y: mediaY, w: colW, h: mediaH, sizing: { type: "contain", w: colW, h: mediaH } }); } catch (e) { /* skip broken image */ }
                }
              } else {
                // Nggak ada foto — nggak usah kasih kotak kosong gede yang buang tempat,
                // cukup 1 baris kecil, sisanya dialihin ke Deskripsi biar lebih kebaca.
                s.addText([
                  { text: "\u{1F4F7}  ", options: { fontSize: 11 } },
                  { text: "Tidak ada dokumentasi foto", options: { fontSize: 10, italic: true, color: "999999" } },
                ], { x, y: mediaY, w: colW, h: mediaH, valign: "middle", margin: 0 });
                s.addShape(pptx.ShapeType.rect, { x, y: mediaY + mediaH, w: colW, h: 0.014, fill: { color: "E5E0F0" } });
              }

              // Deskripsi (catatan auditor buat temuan ini) — dapet lebih banyak ruang kalau nggak ada foto.
              const descY = mediaY + mediaH + 0.12;
              const descH = hasMedia ? 0.7 : 2.6;
              s.addText("\u{1F4CB}  Deskripsi", { x, y: descY, w: colW, h: 0.28, fontSize: hasMedia ? 10.5 : 12, bold: true, color: PURPLE, margin: 0 });
              s.addText(f.note || "Tidak ada catatan tambahan dari auditor.", { x, y: descY + 0.3, w: colW, h: descH, fontSize: hasMedia ? 10 : 13, color: "444444", valign: "top", margin: 0 });
            });
          }
          if (chunks.length > 1) s.addText(`Halaman ${pageIdx + 1} / ${chunks.length}`, { x: 9.3, y: 7.05, w: 3.3, h: 0.3, fontSize: 8, color: GREY, align: "right", margin: 0 });
        });
      });

      // ── Ranking Kepatuhan SOP ──
      {
        const s = newSlide();
        addGradientHeader(s, 1.15);
        s.addShape(pptx.ShapeType.ellipse, { x: 0.35, y: 0.2, w: 0.75, h: 0.75, fill: { color: "FFFFFF" }, line: { color: GOLD, width: 2 } });
        s.addText("\u{1F4CB}", { x: 0.35, y: 0.2, w: 0.75, h: 0.75, fontSize: 24, align: "center", valign: "middle", margin: 0 });
        s.addText([
          { text: "RANKING KEPATUHAN ", options: { color: WHITE, bold: true } },
          { text: "SOP", options: { color: GOLD, bold: true } },
        ], { x: 1.3, y: 0.18, w: 8, h: 0.5, fontSize: 24, margin: 0 });
        s.addText(`Periode: ${periodeLabel(period)}`, { x: 1.3, y: 0.65, w: 6, h: 0.35, fontSize: 13, color: "E4DCFF", margin: 0 });
        addLogo(s, 11.3, 0.32);

        function rankingStatusInfo(score) {
          if (score >= 90) return { lbl: "Sangat Baik", color: GREEN, bg: "E3F6EC", icon: "\u2713" };
          if (score >= 70) return { lbl: "Baik", color: "b07212", bg: "FDF3E0", icon: "\u25D1" };
          return { lbl: "Perlu Perbaikan", color: RED, bg: "FBE4E4", icon: "\u2717" };
        }
        const medals = ["\uD83D\uDC51", "\uD83E\uDD48", "\uD83E\uDD49", "\uD83C\uDFC5", "\uD83C\uDFC5"];
        const tabColors = ["F4B400", "C9CDD6", "CC9966", "E4DCFF", "E4DCFF"];
        const top5 = rankedSOP.slice(0, 5);

        top5.forEach((r, i) => {
          const y = 1.4 + i * 1.0;
          const info = rankingStatusInfo(r.sopScore);
          s.addShape(pptx.ShapeType.roundRect, { x: 0.5, y, w: 12.33, h: 0.85, fill: { color: i === 0 ? "FFFBF0" : "FBFAFD" }, line: { color: i === 0 ? GOLD : "EDEAF5", width: 1 }, rectRadius: 0.06 });
          s.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: y + 0.04, w: 0.14, h: 0.77, rectRadius: 0.04, fill: { color: tabColors[i] || "E4DCFF" } });
          s.addShape(pptx.ShapeType.roundRect, { x: 0.62, y: y + 0.1, w: 0.65, h: 0.65, rectRadius: 0.08, fill: { color: tabColors[i] || "E4DCFF" } });
          s.addText(String(i + 1), { x: 0.62, y: y + 0.1, w: 0.65, h: 0.65, fontSize: 20, bold: true, color: i <= 2 ? "FFFFFF" : PURPLE, align: "center", valign: "middle", margin: 0 });
          s.addText(medals[i] || "\u2B50", { x: 1.4, y: y + 0.1, w: 0.6, h: 0.65, fontSize: 24, align: "center", valign: "middle", margin: 0 });
          s.addText(r.branch.name, { x: 2.1, y: y + 0.1, w: 4.3, h: 0.65, fontSize: 15, bold: true, color: PURPLE, valign: "middle", margin: 0 });
          // Progress bar
          const barX = 6.5, barW = 3.4, barY = y + 0.42;
          s.addShape(pptx.ShapeType.roundRect, { x: barX, y: barY, w: barW, h: 0.1, rectRadius: 0.05, fill: { color: "E5E1EF" } });
          s.addShape(pptx.ShapeType.roundRect, { x: barX, y: barY, w: barW * Math.min(1, r.sopScore / 100), h: 0.1, rectRadius: 0.05, fill: { color: PURPLE } });
          s.addText(`${r.sopScore}%`, { x: 10.05, y: y + 0.1, w: 1.0, h: 0.65, fontSize: 19, bold: true, color: GREEN, align: "right", valign: "middle", margin: 0 });
          s.addShape(pptx.ShapeType.roundRect, { x: 11.2, y: y + 0.22, w: 1.5, h: 0.42, rectRadius: 0.21, fill: { color: info.bg } });
          s.addText(`${info.icon} ${info.lbl}`, { x: 11.2, y: y + 0.22, w: 1.5, h: 0.42, fontSize: 9.5, bold: true, color: info.color, align: "center", valign: "middle", margin: 0 });
        });
        if (!top5.length) s.addText("Belum ada cabang yang diaudit periode ini.", { x: 0.6, y: 1.7, w: 12, h: 0.6, fontSize: 14, color: GREY });

        // ── Bar bawah ──
        const barBotY = 6.55;
        s.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: barBotY, w: 12.33, h: 0.72, rectRadius: 0.08, fill: { color: PURPLE_DARK } });
        s.addText("\u{1F4C8}", { x: 0.7, y: barBotY, w: 0.5, h: 0.72, fontSize: 18, align: "center", valign: "middle", margin: 0 });
        s.addText([
          { text: "Kepatuhan SOP adalah kunci operasional yang unggul. ", options: { color: WHITE } },
          { text: "Terus pertahankan dan tingkatkan!", options: { color: GOLD, bold: true } },
        ], { x: 1.3, y: barBotY, w: 4.6, h: 0.72, fontSize: 10.5, valign: "middle", margin: 0 });
        s.addShape(pptx.ShapeType.rect, { x: 6.05, y: barBotY + 0.12, w: 0.014, h: 0.48, fill: { color: "6b5f96" } });
        s.addText("KETERANGAN INDIKATOR", { x: 6.25, y: barBotY + 0.06, w: 3, h: 0.25, fontSize: 8.5, bold: true, color: "CFC7E6", margin: 0 });
        const legendKeys = [
          { icon: "\u2713", c: GREEN, l: "\u226590%", d: "Sangat Baik" },
          { icon: "\u25D1", c: GOLD, l: "70-89%", d: "Baik" },
          { icon: "\u2717", c: "e05555", l: "<70%", d: "Perlu Perbaikan" },
        ];
        legendKeys.forEach((it, i) => {
          const lx = 6.25 + i * 2.05;
          s.addShape(pptx.ShapeType.ellipse, { x: lx, y: barBotY + 0.35, w: 0.24, h: 0.24, fill: { color: it.c } });
          s.addText(it.icon, { x: lx, y: barBotY + 0.35, w: 0.24, h: 0.24, fontSize: 8, align: "center", valign: "middle", color: WHITE, margin: 0 });
          s.addText(`${it.l}  ${it.d}`, { x: lx + 0.3, y: barBotY + 0.34, w: 1.8, h: 0.28, fontSize: 9, bold: true, color: WHITE, valign: "middle", margin: 0 });
        });
      }

      // ── KPI Audit Internal (1 slide per auditor, pakai rumus resmi kpiConfig.js) ──
      {
        const kpiData = (kpiRes.data || []).map((k) => {
          const prof = (profRes.data || []).find((p) => p.id === k.auditor_id);
          return { name: prof?.full_name || "\u2014", ...k };
        });

        const kpiIcons = { coverage: "\u{1F3E2}", kepatuhan_sop: "\u{1F4CB}", temuan_berulang: "\u{1F50D}", temuan_audit: "\u{1F4C4}", ketepatan_laporan: "\u{1F550}" };

        function kpiSlideFor(auditorName, realisasiMap) {
          const { results, total } = calcKPI(realisasiMap);
          const totalInfo = totalKpiInfo(total);

          const s = newSlide();
          addGradientHeader(s, 1.15);
          s.addShape(pptx.ShapeType.rect, { x: 0.4, y: 0.35, w: 0.05, h: 0.5, fill: { color: GOLD } });
          s.addText([
            { text: "KPI ", options: { color: GOLD, bold: true } },
            { text: "AUDIT INTERNAL", options: { color: WHITE, bold: true } },
          ], { x: 0.6, y: 0.15, w: 8.5, h: 0.5, fontSize: 26, margin: 0 });
          s.addText(`Auditor: ${auditorName} \u2014 ${periodeLabel(period)}`, { x: 0.6, y: 0.68, w: 8.5, h: 0.3, fontSize: 12.5, color: "E4DCFF", margin: 0 });
          addLogo(s, 11.3, 0.18);

          s.addShape(pptx.ShapeType.roundRect, { x: 0.5, y: 1.4, w: 12.33, h: 0.5, rectRadius: 0.06, fill: { color: "6b3fa0" } });
          s.addText("KPI AUDIT INTERNAL", { x: 0.5, y: 1.4, w: 12.33, h: 0.5, fontSize: 14, bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });

          const th = [
            { text: "No", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
            { text: "KPI", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11 } },
            { text: "Bobot", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
            { text: "Target", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
            { text: "Realisasi", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
            { text: "Presentase Realisasi", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
            { text: "Hasil", options: { fill: { color: PURPLE }, color: WHITE, bold: true, fontSize: 11, align: "center" } },
          ];
          const fmtTarget = (item) => item.targetIsPercent ? `${Math.round(item.target * 100)}%` : String(item.target);
          // "crossref" (Temuan Berulang) target-nya persen, tapi realisasinya angka mentah (jumlah kejadian) — bukan fraksi.
          const fmtReal = (item, real) => (item.targetIsPercent && item.type !== "crossref") ? `${Math.round(real * 100)}%` : String(real);
          const body = KPI_ITEMS.map((item, i) => {
            const r = results[item.key];
            const pctColor = r.pctReal >= 0.9 ? GREEN : r.pctReal >= 0.5 ? AMBER : RED;
            return [
              { text: String(i + 1), options: { fontSize: 11, align: "center", bold: true, fill: { color: PURPLE }, color: WHITE } },
              { text: `${kpiIcons[item.key] || ""}  ${item.label}`, options: { fontSize: 11 } },
              { text: `${Math.round(item.bobot * 100)}%`, options: { fontSize: 11, align: "center", bold: true, color: PURPLE } },
              { text: fmtTarget(item), options: { fontSize: 11, align: "center" } },
              { text: fmtReal(item, r.real), options: { fontSize: 11, align: "center" } },
              { text: `${textBar(r.pctReal)}  ${Math.round(r.pctReal * 100)}%`, options: { fontSize: 10, align: "center", bold: true, color: pctColor } },
              { text: `${Math.round(r.hasil * 100)}%`, options: { fontSize: 11, align: "center", bold: true, fill: { color: pctColor === GREEN ? "E3F6EC" : pctColor === AMBER ? "FDF0DC" : "FBE4E4" }, color: pctColor } },
            ];
          });
          body.push([
            { text: "TOTAL KPI", options: { colspan: 5, fontSize: 13, bold: true, fill: { color: PURPLE }, color: WHITE, align: "center" } },
            { text: "", options: { fill: { color: PURPLE } } },
            { text: `${Math.round(total * 100)}%`, options: { fontSize: 15, bold: true, align: "center", fill: { color: GOLD }, color: PURPLE } },
          ]);
          s.addTable([th].concat(body), { x: 0.5, y: 1.95, w: 12.33, colW: [0.7, 4.8, 1.2, 1.3, 1.4, 1.9, 1.03], border: { type: "solid", color: "E5E5E5", pt: 0.5 }, autoPage: false, margin: [4, 5, 4, 5] });

          s.addShape(pptx.ShapeType.ellipse, { x: 0.5, y: 6.55, w: 0.22, h: 0.22, fill: { color: totalInfo.color } });
          s.addText(`Status KPI: ${totalInfo.lbl}`, { x: 0.82, y: 6.5, w: 6, h: 0.32, fontSize: 12.5, bold: true, color: totalInfo.color, valign: "middle", margin: 0 });
        }

        if (!kpiData.length) {
          const s = newSlide();
          addGradientHeader(s, 1.15);
          s.addText([{ text: "KPI ", options: { color: GOLD, bold: true } }, { text: "AUDIT INTERNAL", options: { color: WHITE, bold: true } }], { x: 0.6, y: 0.3, w: 8.5, h: 0.5, fontSize: 26, margin: 0 });
          addLogo(s, 11.3, 0.18);
          s.addText("Belum ada data KPI periode ini.", { x: 0.6, y: 2, w: 12, h: 0.5, fontSize: 14, color: GREY });
        } else {
          kpiData.forEach((k) => {
            kpiSlideFor(k.name, {
              coverage: k.realisasi_coverage,
              kepatuhan_sop: k.realisasi_kepatuhan_sop,
              temuan_berulang: k.realisasi_temuan_berulang,
              temuan_audit: k.realisasi_temuan_audit,
              ketepatan_laporan: k.realisasi_ketepatan_laporan,
            });
          });
        }
      }

      // ── Kesimpulan & Rekomendasi Audit (digabung jadi 1 slide) ──
      {
        const s = newSlide();
        addGradientHeader(s, 1.15);
        s.addText("KESIMPULAN & REKOMENDASI AUDIT", { x: 0.4, y: 0.15, w: 9, h: 0.5, fontSize: 22, bold: true, color: WHITE, margin: 0 });
        s.addText([
          { text: `\u{1F4C5}  Periode Audit: ${periodeLabel(period)}`, options: { fontSize: 12, color: "E4DCFF", bold: true } },
          { text: "     |     ", options: { fontSize: 12, color: "8A7BC2" } },
          { text: `\u{1F3EA}  Total Cabang Diaudit: ${branches.length} Cabang`, options: { fontSize: 12, color: "E4DCFF", bold: true } },
        ], { x: 0.4, y: 0.72, w: 9, h: 0.35, margin: 0 });
        addLogo(s, 11.3, 0.32);

        function ribbon(x, w, icon, title) {
          s.addShape(pptx.ShapeType.roundRect, { x: x + 0.42, y: 1.32, w: w - 0.42, h: 0.44, rectRadius: 0.07, fill: { color: PURPLE } });
          s.addShape(pptx.ShapeType.ellipse, { x, y: 1.21, w: 0.64, h: 0.64, fill: { color: WHITE }, line: { color: PURPLE, width: 1.5 } });
          s.addText(icon, { x, y: 1.21, w: 0.64, h: 0.64, fontSize: 19, align: "center", valign: "middle", margin: 0 });
          s.addText(title, { x: x + 0.76, y: 1.32, w: w - 0.85, h: 0.44, fontSize: 12.5, bold: true, color: WHITE, valign: "middle", margin: 0 });
        }

        // ── Kiri: Kesimpulan Audit ──
        const lx = 0.3, lw = 6.25;
        ribbon(lx, lw, "\u{1F4CB}", "KESIMPULAN AUDIT");
        s.addShape(pptx.ShapeType.roundRect, { x: lx, y: 1.95, w: lw, h: 4.85, rectRadius: 0.08, fill: { color: "FBFAFF" }, line: { color: "EDE9F7", width: 1 } });

        s.addText("KONDISI UMUM", { x: lx + 0.2, y: 2.08, w: lw - 0.4, h: 0.25, fontSize: 10, bold: true, color: PURPLE, margin: 0 });
        const kondisiUmum = [
          `Audit telah dilaksanakan pada ${branches.length} cabang sesuai ruang lingkup audit.`,
          `${kondisiBaik} dari ${auditedRows.length} cabang menunjukkan pengelolaan stok & inventaris yang cukup baik.`,
          `Tingkat kepatuhan SOP operasional tercatat ${kepatuhanAvg !== null ? Math.round(kepatuhanAvg * 100) + "%" : "belum lengkap datanya"}.`,
        ];
        kondisiUmum.forEach((t, i) => {
          const yy = 2.36 + i * 0.42;
          s.addText("\u2713", { x: lx + 0.2, y: yy, w: 0.25, h: 0.36, fontSize: 10, bold: true, color: PURPLE, margin: 0 });
          s.addText(t, { x: lx + 0.48, y: yy - 0.03, w: lw - 0.7, h: 0.42, fontSize: 9.8, color: "333333", valign: "top", margin: 0 });
        });

        s.addText("HASIL AUDIT", { x: lx + 0.2, y: 3.72, w: lw - 0.4, h: 0.25, fontSize: 10, bold: true, color: PURPLE, margin: 0 });
        const hasilAudit = [
          { c: PURPLE, n: branches.length, l: "Cabang Diaudit" },
          { c: GREEN, n: kondisiBaik, l: "Cabang Kondisi Baik" },
          { c: AMBER, n: kondisiPerhatian, l: "Cabang Perlu Perhatian" },
          { c: RED, n: kondisiBerisiko, l: "Cabang Risiko Tinggi" },
        ];
        hasilAudit.forEach((h, i) => {
          const yy = 3.98 + i * 0.34;
          s.addShape(pptx.ShapeType.roundRect, { x: lx + 0.2, y: yy, w: 0.28, h: 0.28, rectRadius: 0.06, fill: { color: h.c } });
          s.addText(String(h.n), { x: lx + 0.2, y: yy, w: 0.28, h: 0.28, fontSize: 9.5, bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });
          s.addText(h.l, { x: lx + 0.58, y: yy + 0.02, w: 2.6, h: 0.26, fontSize: 9, bold: true, color: "333333", valign: "middle", margin: 0 });
        });

        s.addText("TEMUAN DOMINAN", { x: lx + 0.2, y: 5.42, w: lw - 0.4, h: 0.25, fontSize: 10, bold: true, color: PURPLE, margin: 0 });
        const dominanW = (lw - 0.4) / 5;
        (top5Domain.length ? top5Domain : ["Tidak ada temuan signifikan"]).slice(0, 5).forEach((label, i) => {
          const xx = lx + 0.2 + i * dominanW;
          s.addShape(pptx.ShapeType.ellipse, { x: xx + dominanW / 2 - 0.28, y: 5.72, w: 0.56, h: 0.56, fill: { color: PURPLE } });
          s.addText("\u26A0\uFE0F", { x: xx + dominanW / 2 - 0.28, y: 5.72, w: 0.56, h: 0.56, fontSize: 16, align: "center", valign: "middle", margin: 0 });
          s.addText(label, { x: xx + 0.03, y: 6.32, w: dominanW - 0.06, h: 0.42, fontSize: 8.3, bold: true, color: "333333", align: "center", margin: 0 });
        });

        // ── Kanan: Rekomendasi ──
        const rx = 6.78, rw = 6.0;
        ribbon(rx, rw, "\u{1F3AF}", "REKOMENDASI");
        s.addShape(pptx.ShapeType.roundRect, { x: rx, y: 1.95, w: rw, h: 4.85, rectRadius: 0.08, fill: { color: "FBFAFF" }, line: { color: "EDE9F7", width: 1 } });

        const stokBermasalah = rows.filter((r) => r.kesPct !== null && r.kesPct < 0.7).map((r) => r.branch.name);
        const keuBermasalah = rows.filter((r) => r.sisa !== null && r.sisa < 0).map((r) => r.branch.name);

        const rekBlocks = [
          {
            bg: "E9F7EF", c: GREEN, icon: "\u{1F4C5}", t: "JANGKA PENDEK (0-30 HARI)",
            items: [
              stokBermasalah.length ? `Menyelesaikan selisih stok di cabang: ${stokBermasalah.slice(0, 3).join(", ")}${stokBermasalah.length > 3 ? ", dst." : "."}` : "Menyelesaikan seluruh selisih stok yang tercatat.",
              keuBermasalah.length ? `Menindaklanjuti saldo kas kecil minus di cabang: ${keuBermasalah.slice(0, 3).join(", ")}${keuBermasalah.length > 3 ? ", dst." : "."}` : "Memastikan seluruh saldo kas kecil dalam kondisi aman.",
              "Melakukan penataan ulang area display & pricetag yang belum lengkap.",
            ],
          },
          {
            bg: "FDF3E0", c: AMBER, icon: "\u{1F5D3}\uFE0F", t: "JANGKA MENENGAH (1-3 BULAN)",
            items: [
              kondisiBerisiko > 0 ? `Monitoring intensif pada ${kondisiBerisiko} cabang berisiko tinggi.` : "Menjaga konsistensi cabang yang sudah berada dalam kondisi baik.",
              "Melakukan stock opname berkala di seluruh cabang.",
              top5Domain.length ? `Melaksanakan refresh SOP untuk kategori "${top5Domain[0]}" ke seluruh tim toko.` : "Melaksanakan refresh SOP ke seluruh tim toko.",
            ],
          },
          {
            bg: "EEEAFB", c: PURPLE, icon: "\u{1F4C8}", t: "JANGKA PANJANG",
            items: [
              "Digitalisasi monitoring audit di seluruh cabang.",
              "Membangun dashboard kesehatan stok company-wide.",
              "Evaluasi KPI Store Leader berdasarkan hasil audit bulanan.",
              "Monitoring temuan berulang (repeat finding) tiap bulan.",
            ],
          },
        ];
        let ry = 2.1;
        rekBlocks.forEach((b) => {
          const bh = 0.42 + b.items.length * 0.36;
          s.addShape(pptx.ShapeType.roundRect, { x: rx + 0.15, y: ry, w: rw - 0.3, h: bh, rectRadius: 0.06, fill: { color: b.bg } });
          s.addShape(pptx.ShapeType.roundRect, { x: rx + 0.15, y: ry, w: 0.05, h: bh, fill: { color: b.c } });
          s.addText(`${b.icon}  ${b.t}`, { x: rx + 0.35, y: ry + 0.08, w: rw - 0.6, h: 0.28, fontSize: 10, bold: true, color: b.c, margin: 0 });
          s.addText(b.items.map((t) => ({ text: t, options: { bullet: true, breakLine: true, paraSpaceAfter: 3 } })), { x: rx + 0.4, y: ry + 0.38, w: rw - 0.65, h: b.items.length * 0.36, fontSize: 9, color: "333333", margin: 0 });
          ry += bh + 0.13;
        });

        // ── Ringkasan Eksekutif (bar bawah) ──
        s.addShape(pptx.ShapeType.rect, { x: 0, y: 7.0, w: 12.6, h: 0.5, fill: { color: PURPLE } });
        s.addText("\u{1F4A1} RINGKASAN EKSEKUTIF:", { x: 0.3, y: 7.0, w: 2.3, h: 0.5, fontSize: 9.5, bold: true, color: GOLD, valign: "middle", margin: 0 });
        const kesInfo = kesNow !== null ? kesehatanStatusInfo(kesNow) : null;
        const kepInfo = kepatuhanAvg !== null ? kategoriInfo(kepatuhanAvg) : null;
        const eksekutif = [
          kesInfo ? `Kesehatan Stok: ${kesInfo.lbl} (${Math.round(kesNow * 100)}%)` : "Kesehatan Stok: belum ada data",
          kepInfo ? `Kepatuhan SOP: ${kepInfo.lbl} (${Math.round(kepatuhanAvg * 100)}%)` : "Kepatuhan SOP: belum ada data",
          `Risiko Cabang: ${kondisiBerisiko > 0 ? kondisiBerisiko + " cabang perlu perhatian" : "Aman"}`,
          `Tindak Lanjut: ${totalTemuanKepatuhan > 0 ? totalTemuanKepatuhan + " temuan perlu dituntaskan" : "Tidak ada temuan terbuka"}`,
        ].join("    \u2022    ");
        s.addText(eksekutif, { x: 2.7, y: 7.0, w: 9.6, h: 0.5, fontSize: 8.7, color: "E4DCFF", valign: "middle", margin: 0 });
      }

      // ── Terima kasih ──
      {
        const s = newSlide();
        addGradientBackground(s);
        addLogo(s, 11.3, 0.3);
        s.addShape(pptx.ShapeType.rect, { x: 11.05, y: 0.32, w: 0.014, h: 0.5, fill: { color: "8a7bc2" } });

        // Dekorasi titik-titik — pojok yang beneran kosong (kiri atas, kanan bawah), jauh dari teks manapun
        for (let i = 0; i < 4; i++) {
          for (let j = 0; j < 3; j++) {
            s.addShape(pptx.ShapeType.ellipse, { x: 0.3 + i * 0.16, y: 0.3 + j * 0.16, w: 0.04, h: 0.04, fill: { color: "FFFFFF" }, line: { type: "none" } });
          }
        }
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            s.addShape(pptx.ShapeType.ellipse, { x: 12.4 + i * 0.16, y: 4.7 + j * 0.16, w: 0.04, h: 0.04, fill: { color: "FFFFFF" }, line: { type: "none" } });
          }
        }

        // Badge ikon lingkaran tengah
        s.addShape(pptx.ShapeType.ellipse, { x: 6.07, y: 0.65, w: 1.2, h: 1.2, fill: { color: "1f1147" }, line: { color: GOLD, width: 2.5 } });
        s.addText("\u{1F4CB}", { x: 6.07, y: 0.65, w: 1.2, h: 1.2, fontSize: 40, align: "center", valign: "middle", margin: 0 });

        s.addText("TERIMA KASIH", { x: 0, y: 2.15, w: 13.33, h: 1.0, align: "center", fontSize: 52, color: WHITE, bold: true, margin: 0 });

        s.addShape(pptx.ShapeType.rect, { x: 1.2, y: 3.35, w: 4.5, h: 0.018, fill: { color: GOLD } });
        s.addShape(pptx.ShapeType.triangle, { x: 6.43, y: 3.32, w: 0.24, h: 0.14, fill: { color: PURPLE_LIGHT }, line: { color: GOLD, width: 1.25 }, rotate: 180 });
        s.addShape(pptx.ShapeType.rect, { x: 7.63, y: 3.35, w: 4.5, h: 0.018, fill: { color: GOLD } });

        s.addText([
          { text: "Divisi ", options: { color: WHITE } },
          { text: "Audit Internal", options: { color: GOLD, bold: true } },
          { text: " \u2014 PT. KLA Teknologi Indonesia", options: { color: WHITE } },
        ], { x: 0, y: 3.6, w: 13.33, h: 0.4, align: "center", fontSize: 15, margin: 0 });

        // Bar nilai perusahaan bawah
        const values = [
          { icon: "\u{1F3AF}", label: "INTEGRITAS", desc: "Menjaga kejujuran dan\nobjektivitas dalam setiap audit" },
          { icon: "\u{1F6E1}\u{FE0F}", label: "PROFESIONALISME", desc: "Bekerja cermat, independen,\ndan sesuai standar terbaik" },
          { icon: "\u{1F4C8}", label: "PERBAIKAN BERKELANJUTAN", desc: "Terus memberikan nilai tambah\nuntuk kemajuan perusahaan" },
        ];
        const vw = 13.33 / 3;
        values.forEach((v, i) => {
          const vx = i * vw;
          s.addShape(pptx.ShapeType.ellipse, { x: vx + 0.55, y: 5.55, w: 0.75, h: 0.75, fill: { color: "1f1147" }, line: { color: GOLD, width: 2 } });
          s.addText(v.icon, { x: vx + 0.55, y: 5.55, w: 0.75, h: 0.75, fontSize: 24, align: "center", valign: "middle", margin: 0 });
          s.addText(v.label, { x: vx + 1.45, y: 5.6, w: vw - 1.6, h: 0.3, fontSize: 12, bold: true, color: GOLD, margin: 0 });
          s.addText(v.desc, { x: vx + 1.45, y: 5.92, w: vw - 1.6, h: 0.6, fontSize: 10.5, color: "D8D2EC", margin: 0 });
          if (i < 2) s.addShape(pptx.ShapeType.rect, { x: vx + vw - 0.15, y: 5.6, w: 0.012, h: 1.1, fill: { color: "6b5f96" } });
        });
      }

      // Nomor halaman — ditambahin paling akhir buat semua slide, biar selalu di atas elemen lain.
      allSlideRefs.forEach((s, i) => {
        s.addShape(pptx.ShapeType.ellipse, { x: 12.78, y: 6.95, w: 0.4, h: 0.4, fill: { color: PURPLE }, line: { color: GOLD, width: 1.25 } });
        s.addText(String(i + 1), { x: 12.78, y: 6.95, w: 0.4, h: 0.4, fontSize: 12.5, bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });
      });

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
