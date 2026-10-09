import { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";
import { sortBranches } from "../lib/branchOrder";
import { CATS, calcWeightedFromRecord, periodeLabel, addMonthsToPeriod, nowPeriode, isCriticalItem, temuanText, listFailedItems, isLegacyChecklistRecord } from "../lib/sopConfig";
import { calcKesehatanPct, formatKesehatanPct, calcServiceRatio, formatRatioPct, SERVICE_THRESHOLDS, LAPTOP_THRESHOLDS, laptopStatusInfo, serviceStatusInfo } from "../lib/stokConfig";

const ISOLATION_START_PERIOD = "2026-08";
const BOBOT = { sop: 0.3, kesehatan: 0.3, service: 0.2, keuangan: 0.2 };
// Target per modul — SAMA dengan angka "Target" di kartu skor (ScoreCard) dan garis target grafik.
const TARGETS = { sop: 90, kesehatan: 98, service: 95, keuangan: 95 };
const TONE = { good: "#1a9e6e", bad: "#a32020", warn: "#b07212", neutral: "#6b3fa0" };
const PURPLE = "#6b3fa0", GOLD = "#F4B740", GREEN = "#1a9e6e", RED = "#a32020", AMBER = "#b07212", BLUE = "#1558a0";

function gradeInfo(score) {
  if (score >= 90) return { grade: "A", color: GREEN };
  if (score >= 80) return { grade: "B", color: GOLD };
  if (score >= 70) return { grade: "C", color: AMBER };
  return { grade: "D", color: RED };
}
function riskInfo(score) {
  // 90/75 (bukan 90/70) — dihitung ulang dari data cabang asli: 90/75 kasih sebaran Risk Level
  // yang lebih rata (Low/Medium/High kebagi wajar), 90/70 bikin "High" nyaris kosong (kurang
  // berguna). Konsekuensinya: Grade C (70-79) bisa kepotong jadi 2 Risk Level beda di tengah
  // rentangnya — itu diterima, Grade & Risk Level emang beda tujuan (Grade=nilai detail per
  // cabang, Risk Level=prioritas tindak lanjut), wajar nggak align 100%.
  if (score >= 90) return { label: "Low", color: GREEN };
  if (score >= 75) return { label: "Medium", color: GOLD };
  return { label: "High", color: RED };
}

// Skor Audit Kas Kecil — dulu (SALAH) pakai formula "makin dikit kepake makin bagus", padahal
// kas kecil emang wajar banyak kepake buat operasional. Sekarang ngikutin tingkatan status ASLI
// dari `computeStatus()` di AuditKeuangan.js (dibanding ke ambang batas dinamis dari
// `settings_keuangan`, bukan bikin formula sendiri): Terkendali/Efisien = bagus, Monitoring =
// perlu dipantau, Tindak Lanjut/saldo minus = butuh perhatian.
function keuanganScoreOf(entry, settings) {
  if (!entry) return null;
  const sb = parseFloat(entry.saldo_sebelumnya) || 0;
  const sm = parseFloat(entry.saldo_masuk) || 0;
  const pk = parseFloat(entry.pengeluaran) || 0;
  const total = sb + sm;
  const hasManualSisa = entry.sisa_saldo !== undefined && entry.sisa_saldo !== null && entry.sisa_saldo !== "";
  const sisa = hasManualSisa ? (parseFloat(entry.sisa_saldo) || 0) : total - pk;
  if (sisa < 0) {
    // Minus proporsional sama gede-nya defisit dibanding total kas yang harusnya ada — minus
    // dikit ~25%, minus parah turun ke 0. Bukan angka flat lagi kayak sebelumnya.
    const defisitRatio = total > 0 ? Math.min(1, Math.abs(sisa) / total) : 1;
    return Math.max(0, 25 - defisitRatio * 25);
  }
  const posisi = total > 0 ? pk / total : 0;
  if (posisi * 100 <= settings.terkendali) return 100;
  if (posisi * 100 <= settings.efisien) return 90;
  if (posisi * 100 <= settings.monitoring) return 65;
  return 35;
}

// "Saldo masuk melebihi limit" — SENGAJA nggak ngaruh ke skor (bisa aja bukan salah cabangnya,
// misal HO kirim lebih buat kebutuhan mendadak). Cuma penanda visual di tabel.
function keuanganOverLimit(entry) {
  if (!entry) return false;
  const sm = parseFloat(entry.saldo_masuk) || 0;
  const lim = parseFloat(entry.limit_kas) || 0;
  return lim > 0 && sm > lim;
}

// Skor Service Ratio — BERJENJANG (bukan lagi 3 tier 100/70/40 yang bikin hampir semua cabang
// "Terkendali" nempel di 100). Ratio KECIL itu BAGUS (dikit yang perlu diservis), jadi skor turun
// mulus mengikuti ratio, memakai batas dari stokConfig (bukan angka yang ditulis ulang di sini):
//   0 .. batas Terkendali          : 100 -> 90
//   batas Terkendali .. Monitoring : 90  -> 70
//   di atas batas Monitoring       : 70  -> 40 (turun habis di 2x batas Monitoring, lantai 40)
// Skala 100/90/70/40 ini ASUMSI (bukan definisi resmi modul) — perlu disetujui pimpinan.
// Laptop & Aksesoris punya batas BEDA (Laptop barang lebih kompleks), jadi dihitung sendiri-sendiri.
function skorBerjenjang(ratio, terkendali, monitoring) {
  const r = Number(ratio);
  if (!Number.isFinite(r) || r < 0) return null;
  if (r <= terkendali) return terkendali > 0 ? 100 - 10 * (r / terkendali) : 100;
  if (r <= monitoring) return 90 - 20 * ((r - terkendali) / (monitoring - terkendali));
  return Math.max(40, 70 - 30 * ((r - monitoring) / monitoring));
}
function tierScoreOfAksesoris(ratio) {
  return skorBerjenjang(ratio, SERVICE_THRESHOLDS.terkendali, SERVICE_THRESHOLDS.monitoring);
}
function tierScoreOfLaptop(ratio) {
  return skorBerjenjang(ratio, LAPTOP_THRESHOLDS.terkendali, LAPTOP_THRESHOLDS.monitoring);
}
// Data BARU (udah dipisah Laptop/Aksesoris): klasifikasi skor MASING-MASING dulu (Laptop &
// Aksesoris kena tier sendiri-sendiri, threshold beda), BARU dirata-ratain skornya — bukan
// rata-ratain ratio mentahnya dulu baru diklasifikasi 1x (itu bisa nutupin kalau salah satu
// kategori jelek tapi yang lain bagus, mirip kasus "rata-rata nutupin masalah" yang udah dibahas).
// Data LAMA (pre-split, cuma punya `ratio` gabungan): fallback ke threshold Aksesoris (yang
// lama emang dikalibrasi buat ratio gabungan itu).
function serviceScoreOf(rec) {
  const d = rec?.data;
  if (!d) return null;
  if (d.ratio_laptop != null || d.ratio_aksesoris != null) {
    const scores = [];
    const sl = d.ratio_laptop != null ? tierScoreOfLaptop(d.ratio_laptop) : null;
    const sa = d.ratio_aksesoris != null ? tierScoreOfAksesoris(d.ratio_aksesoris) : null;
    if (sl != null) scores.push(sl);
    if (sa != null) scores.push(sa);
    return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  }
  if (d.ratio != null) return tierScoreOfAksesoris(d.ratio);
  return null;
}

// Rincian angka kas kecil 1 entri — dipakai panel rincian cabang. Rumus sisa SAMA dengan
// keuanganScoreOf() di atas (sisa manual kalau diisi, kalau nggak saldo masuk+sebelumnya−pengeluaran).
function keuanganInfoOf(entry) {
  if (!entry) return null;
  const sb = parseFloat(entry.saldo_sebelumnya) || 0;
  const sm = parseFloat(entry.saldo_masuk) || 0;
  const pk = parseFloat(entry.pengeluaran) || 0;
  const lim = parseFloat(entry.limit_kas) || 0;
  const total = sb + sm;
  const hasManualSisa = entry.sisa_saldo !== undefined && entry.sisa_saldo !== null && entry.sisa_saldo !== "";
  const sisa = hasManualSisa ? (parseFloat(entry.sisa_saldo) || 0) : total - pk;
  const posisi = total > 0 ? (pk / total) * 100 : 0;
  return { sb, sm, pk, lim, total, sisa, posisi, bawaanMinus: sb < 0 ? sb : 0, overLimit: lim > 0 && sm > lim };
}
const rp = (n) => (n < 0 ? "-" : "") + "Rp " + Math.abs(Math.round(n)).toLocaleString("id-ID");

// Teks "Ringkasan Periode" — dibuat OTOMATIS dari angka dashboard yang sama (bukan angka baru),
// jadi nggak mungkin beda sama kartu/tabel di bawahnya. Tiap baris = 1 kalimat siap diucapkan.
// SENGAJA cuma meringkas hasil audit bulan itu (skor, cabang, modul, temuan) — info lain
// (cabang belum diaudit, progres jadwal, catatan personal) tidak dimasukkan.
function buildRingkasan({ period, prevPeriod, branches, branchRows, avgTotal, prevAvgTotal, avgs, temuan, progres, isPersonalView }) {
  const lines = [];
  const n = branchRows.length;
  if (n === 0) return lines;
  const withTotal = branchRows.filter((r) => r.total != null);

  if (avgTotal != null) {
    const sel = prevAvgTotal != null ? avgTotal - prevAvgTotal : null;
    lines.push({
      icon: "📊", tone: sel == null ? "neutral" : sel >= 0 ? "good" : "bad",
      text: `${n} dari ${branches.length} cabang teraudit. Skor audit keseluruhan ${avgTotal.toFixed(1)}/100` +
        (sel == null ? ", belum ada pembanding bulan lalu." : `, ${sel >= 0 ? "naik" : "turun"} ${Math.abs(sel).toFixed(1)} poin dibanding ${periodeLabel(prevPeriod)}.`),
    });
  }

  if (withTotal.length) {
    const sehat = withTotal.filter((r) => r.total >= 80).length;
    const tidakSehat = withTotal.length - sehat;
    const high = withTotal.filter((r) => riskInfo(r.total).label === "High").map((r) => r.branch.name);
    lines.push({
      icon: "🏢", tone: high.length ? "bad" : "good",
      text: `${sehat} cabang sehat (skor \u2265 80)` + (tidakSehat ? `, ${tidakSehat} perlu perhatian` : "") + ". " +
        (high.length ? `High Risk: ${high.join(", ")}.` : "Tidak ada cabang High Risk."),
    });
  }

  if (withTotal.length >= 2) {
    const sorted = [...withTotal].sort((a, b) => b.total - a.total);
    const best = sorted[0], worst = sorted[sorted.length - 1];
    lines.push({ icon: "🏆", tone: "neutral", text: `Tertinggi: ${best.branch.name} (${best.total.toFixed(0)}%). Terendah: ${worst.branch.name} (${worst.total.toFixed(0)}%).` });
  }

  const mods = [
    { k: "% Kepatuhan SOP", v: avgs.sop, t: TARGETS.sop },
    { k: "Kesehatan Stok", v: avgs.kes, t: TARGETS.kesehatan },
    { k: "Service Ratio", v: avgs.svc, t: TARGETS.service },
    { k: "Audit Kas Kecil", v: avgs.keu, t: TARGETS.keuangan },
  ].filter((m) => m.v != null);
  if (mods.length) {
    const below = mods.filter((m) => m.v < m.t).sort((a, b) => (b.t - b.v) - (a.t - a.v));
    lines.push(below.length
      ? { icon: "🎯", tone: "warn", text: `${below.length} dari ${mods.length} modul di bawah target. Paling jauh: ${below[0].k} ${below[0].v.toFixed(1)}% (target ${below[0].t}%).` }
      : { icon: "🎯", tone: "good", text: `Semua ${mods.length} modul mencapai target.` });
  }

  const sopCount = branchRows.filter((r) => r.sopScore != null).length;
  if (sopCount > 0) {
    if (temuan.total > 0) {
      const top = temuan.top5[0];
      lines.push({
        icon: "📋", tone: "warn",
        text: `${temuan.total} temuan SOP (${temuan.major} major, ${temuan.minor} minor).` + (top ? ` Paling sering: "${top.text}" (${top.n} cabang).` : ""),
      });
    } else {
      lines.push({ icon: "📋", tone: "good", text: "Tidak ada temuan SOP tercatat." });
    }
  }

  return lines;
}

function latestFor(records, branchId, period) {
  const matches = records.filter((r) => r.branch_id === branchId && r.period === period);
  if (!matches.length) return null;
  return [...matches].sort((a, b) => (b.data?.audit_date || b.audit_date || "").localeCompare(a.data?.audit_date || a.audit_date || ""))[0];
}

export default function DashboardAudit({ profile }) {
  const [branches, setBranches] = useState([]);
  const [sopRecords, setSopRecords] = useState([]);
  const [kesRecords, setKesRecords] = useState([]);
  const [svcRecords, setSvcRecords] = useState([]);
  const [keuEntries, setKeuEntries] = useState([]);
  const [keuSettings, setKeuSettings] = useState({ terkendali: 40, efisien: 70, monitoring: 90 });
  const [schedule, setSchedule] = useState([]);
  const [period, setPeriod] = useState(nowPeriode());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null); // cabang yang rinciannya sedang dibuka

  const isPersonalView = profile?.role === "auditor" && period >= ISOLATION_START_PERIOD;

  useEffect(() => { loadAll(); }, []);
  useEffect(() => { setSelectedId(null); }, [period]);
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e) => { if (e.key === "Escape") setSelectedId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const isolate = profile?.role === "auditor";
      const orFilter = `period.lt.${ISOLATION_START_PERIOD},submitted_by.eq.${profile?.id}`;
      const [brRes, sopRes, kesRes, svcRes, keuRes, schRes, keuSetRes] = await Promise.all([
        supabase.from("branches").select("*").order("name"),
        (() => { let q = supabase.from("audit_generic").select("*").eq("module", "sop"); if (isolate) q = q.or(orFilter); return q; })(),
        (() => { let q = supabase.from("audit_generic").select("*").eq("module", "stok_kesehatan"); if (isolate) q = q.or(orFilter); return q; })(),
        (() => { let q = supabase.from("audit_generic").select("*").eq("module", "stok_service"); if (isolate) q = q.or(orFilter); return q; })(),
        (() => { let q = supabase.from("audit_keuangan").select("*"); if (isolate) q = q.or(orFilter); return q; })(),
        (() => { let q = supabase.from("audit_schedule").select("*"); if (isolate) q = q.or(`start_date.lt.2026-08-01,auditor_id.eq.${profile?.id}`); return q; })(),
        supabase.from("settings_keuangan").select("*").eq("id", 1).single(),
      ]);
      if (brRes.error) throw brRes.error;
      setBranches(sortBranches(brRes.data || []));
      setSopRecords(sopRes.data || []);
      setKesRecords(kesRes.data || []);
      setSvcRecords(svcRes.data || []);
      setKeuEntries(keuRes.data || []);
      setSchedule(schRes.data || []);
      if (keuSetRes.data) setKeuSettings(keuSetRes.data);
    } catch (err) {
      setError("Gagal memuat data: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  // Skor 1 cabang di 1 periode, gabungan 4 sumber sesuai bobot KPI.
  function branchScoresAt(branchId, p) {
    const sopRec = latestFor(sopRecords, branchId, p);
    const kesRec = latestFor(kesRecords, branchId, p);
    const svcRec = latestFor(svcRecords, branchId, p);
    const keuRec = keuEntries.filter((e) => e.branch_id === branchId && e.period === p).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0];

    const sopOk = sopRec && !sopRec.data?.tidak_visit;
    const kesOk = kesRec && !kesRec.data?.tidak_visit;
    const svcOk = svcRec && !svcRec.data?.tidak_visit;
    const keuOk = keuRec && !keuRec.tidak_visit;

    const sopScore = sopOk ? calcWeightedFromRecord(sopRec.data) : null;
    const kesScore = kesOk ? (kesRec.data?.kesehatan_pct != null ? kesRec.data.kesehatan_pct * 100 : null) : null;
    const svcScore = svcOk ? serviceScoreOf(svcRec) : null;
    const keuScore = keuOk ? keuanganScoreOf(keuRec, keuSettings) : null;
    const keuOverLimit = keuOk ? keuanganOverLimit(keuRec) : false;

    const parts = [
      sopScore != null ? { v: sopScore, w: BOBOT.sop } : null,
      kesScore != null ? { v: kesScore, w: BOBOT.kesehatan } : null,
      svcScore != null ? { v: svcScore, w: BOBOT.service } : null,
      keuScore != null ? { v: keuScore, w: BOBOT.keuangan } : null,
    ].filter(Boolean);
    const wSum = parts.reduce((s, x) => s + x.w, 0);
    const total = wSum > 0 ? parts.reduce((s, x) => s + x.v * x.w, 0) / wSum : null;

    return { sopRec, kesRec: kesOk ? kesRec : null, svcRec: svcOk ? svcRec : null, keuRec: keuOk ? keuRec : null, sopScore, kesScore, svcScore, keuScore, keuOverLimit, total, hasAny: !!(sopOk || kesOk || svcOk || keuOk) };
  }

  const trendPeriods = useMemo(() => { const arr = []; for (let i = 5; i >= 0; i--) arr.push(addMonthsToPeriod(period, -i)); return arr; }, [period]);

  const branchRows = useMemo(() => {
    return branches.map((b) => {
      const s = branchScoresAt(b.id, period);
      return { branch: b, ...s };
    }).filter((r) => r.hasAny);
  }, [branches, sopRecords, kesRecords, svcRecords, keuEntries, keuSettings, period]);

  const avg = (arr) => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null;
  const avgSop = avg(branchRows.map((r) => r.sopScore).filter((v) => v != null));
  const avgKes = avg(branchRows.map((r) => r.kesScore).filter((v) => v != null));
  const avgSvc = avg(branchRows.map((r) => r.svcScore).filter((v) => v != null));
  const avgKeu = avg(branchRows.map((r) => r.keuScore).filter((v) => v != null));
  // Cakupan data Service Ratio: berapa cabang yang benar-benar punya skor bulan ini
  // (cabang "Tidak Visit" / tanpa data tidak ikut rata-rata, jadi harus kelihatan di kartu).
  const svcDinilai = branchRows.filter((r) => r.svcScore != null).length;
  const avgTotal = avg(branchRows.map((r) => r.total).filter((v) => v != null));

  // Temuan: dihitung dari checklist SOP tiap cabang teraudit — item kritis (CRITICAL_ITEMS,
  // lihat isCriticalItem() di sopConfig.js) dianggap "Major", sisanya "Minor".
  const temuanBreakdown = useMemo(() => {
    let major = 0, minor = 0;
    const itemFail = {};
    branchRows.forEach((r) => {
      if (!r.sopRec || r.sopRec.data?.tidak_visit) return;
      const checks = r.sopRec.data?.checks || {};
      CATS.forEach((c) => c.items.forEach((text, i) => {
        const key = c.id + "_" + i;
        if (!checks[key]) {
          if (isCriticalItem(c.id, i)) major++; else minor++;
          itemFail[key] = (itemFail[key] || 0) + 1;
        }
      }));
    });
    // catId bisa punya underscore sendiri ("display_laptop", "non_operasional"),
    // jadi index-nya HARUS dipisah dari underscore TERAKHIR, bukan split("_")[0]
    // — itu yang bikin beberapa item di Top 5 muncul mentah ("display_laptop_4")
    // sebelumnya: catId ke-potong salah jadi "display" doang, nggak ketemu di CATS.
    const top5 = Object.entries(itemFail).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([key, n]) => {
        const us = key.lastIndexOf("_");
        const catId = key.slice(0, us);
        const idx = Number(key.slice(us + 1));
        const cat = CATS.find((c) => c.id === catId);
        const rawText = cat?.items?.[idx];
        return { text: rawText ? temuanText(catId, idx, rawText) : key, n };
      });
    return { major, minor, total: major + minor, top5 };
  }, [branchRows]);

  // Trend 6 bulan buat SEMUA modul (bukan cuma SOP) — masing-masing exclude Tidak Visit/Cabang Baru.
  function moduleTrend(scorerFn) {
    return trendPeriods.map((p) => {
      const scores = branches.map((b) => scorerFn(b.id, p)).filter((v) => v != null);
      return { period: p, value: avg(scores) };
    });
  }
  const sopTrend = useMemo(() => moduleTrend((bid, p) => {
    const rec = latestFor(sopRecords, bid, p);
    if (!rec || rec.data?.tidak_visit || rec.data?.cabang_baru) return null;
    return calcWeightedFromRecord(rec.data);
  }), [trendPeriods, branches, sopRecords]);
  const kesTrend = useMemo(() => moduleTrend((bid, p) => {
    const rec = latestFor(kesRecords, bid, p);
    if (!rec || rec.data?.tidak_visit || rec.data?.cabang_baru) return null;
    return rec.data?.kesehatan_pct != null ? rec.data.kesehatan_pct * 100 : null;
  }), [trendPeriods, branches, kesRecords]);
  const svcTrend = useMemo(() => moduleTrend((bid, p) => {
    const rec = latestFor(svcRecords, bid, p);
    if (!rec || rec.data?.tidak_visit || rec.data?.cabang_baru) return null;
    return serviceScoreOf(rec);
  }), [trendPeriods, branches, svcRecords]);
  const keuTrend = useMemo(() => moduleTrend((bid, p) => {
    const entry = keuEntries.filter((e) => e.branch_id === bid && e.period === p).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0];
    if (!entry || entry.tidak_visit || entry.cabang_baru) return null;
    return keuanganScoreOf(entry, keuSettings);
  }), [trendPeriods, branches, keuEntries, keuSettings]);

  const scheduleThisMonth = useMemo(() => schedule.filter((s) => (s.start_date || "").slice(0, 7) === period), [schedule, period]);
  const progres = {
    total: scheduleThisMonth.length,
    selesai: scheduleThisMonth.filter((s) => s.status === "Sudah Visit").length,
    kendala: scheduleThisMonth.filter((s) => s.status === "Ada Kendala").length,
    terjadwal: scheduleThisMonth.filter((s) => !s.status || s.status === "Terjadwal").length,
  };

  const cabangSehat = branchRows.filter((r) => r.total != null && r.total >= 80).length;
  const cabangTidakSehat = branchRows.filter((r) => r.total != null && r.total < 80).length;

  // Pembanding bulan lalu (buat kalimat "naik/turun X poin" di Ringkasan)
  const prevPeriod = addMonthsToPeriod(period, -1);
  const prevAvgTotal = useMemo(() => {
    const totals = branches.map((b) => branchScoresAt(b.id, prevPeriod).total).filter((v) => v != null);
    return totals.length ? totals.reduce((s, x) => s + x, 0) / totals.length : null;
  }, [branches, sopRecords, kesRecords, svcRecords, keuEntries, keuSettings, prevPeriod]);

  const ringkasan = buildRingkasan({
    period, prevPeriod, branches, branchRows, avgTotal, prevAvgTotal,
    avgs: { sop: avgSop, kes: avgKes, svc: avgSvc, keu: avgKeu },
    temuan: temuanBreakdown, progres, isPersonalView,
  });

  // Rincian 1 cabang (panel samping saat baris tabel diklik)
  const selectedRow = selectedId != null ? branchRows.find((r) => r.branch.id === selectedId) || null : null;
  const selectedTrend = useMemo(() => {
    if (selectedId == null) return [];
    return trendPeriods.map((p) => ({ period: p, total: branchScoresAt(selectedId, p).total }));
  }, [selectedId, trendPeriods, sopRecords, kesRecords, svcRecords, keuEntries, keuSettings]);

  if (loading) return <div style={{ padding: 40, color: "var(--text-secondary)" }}>Memuat\u2026</div>;

  return (
    <div style={{ flex: 1 }}>
      <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Dashboard Audit</div>
            {isPersonalView && <span style={{ fontSize: 10.5, fontWeight: 700, color: GOLD, background: `${GOLD}22`, padding: "2px 8px", borderRadius: 20 }}>PERSONAL</span>}
          </div>
          <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>{isPersonalView ? "Ringkasan performa cabang yang kamu audit sendiri" : "Ringkasan performa audit gabungan semua cabang"}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 8, padding: "4px 6px" }}>
          <button className="btn-ghost" onClick={() => setPeriod(addMonthsToPeriod(period, -1))} style={{ padding: "6px 10px" }}>{"<"}</button>
          <div className="mono" style={{ fontWeight: 600, minWidth: 130, textAlign: "center", fontSize: 13.5 }}>{periodeLabel(period)}</div>
          <button className="btn-ghost" onClick={() => setPeriod(addMonthsToPeriod(period, 1))} style={{ padding: "6px 10px" }}>{">"}</button>
        </div>
      </div>

      {error && <div style={{ margin: "14px 28px 0", background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}

      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Ringkasan periode — teks otomatis, siap dibacakan saat presentasi */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderLeft: `4px solid ${PURPLE}`, borderRadius: 14, padding: "16px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Ringkasan {periodeLabel(period)}</div>
            <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>Dibuat otomatis dari data audit di bawah</div>
          </div>
          {ringkasan.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-faint)" }}>Belum ada cabang teraudit periode ini.</div>
          ) : ringkasan.map((l, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "5px 0" }}>
              <div style={{ width: 22, height: 22, borderRadius: 6, background: `${TONE[l.tone]}1c`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0 }}>{l.icon}</div>
              <div style={{ fontSize: 13, lineHeight: 1.55 }}>{l.text}</div>
            </div>
          ))}
        </div>

        {/* Top KPI row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
          <KpiCard icon="🏢" label="Total Cabang" value={branches.length} color={PURPLE} />
          <KpiCard icon="📋" label="Total Temuan" value={temuanBreakdown.total} color={PURPLE} />
          <KpiCard icon="✅" label="Cabang Sehat" value={cabangSehat} sub={`dari ${branchRows.length} teraudit`} color={GREEN} />
          <KpiCard icon="❌" label="Cabang Tidak Sehat" value={cabangTidakSehat} sub={`dari ${branchRows.length} teraudit`} color={RED} />
        </div>

        {/* Score cards + gauge */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
            <ScoreCard icon="📋" label="% Kepatuhan SOP" value={avgSop} target={90} trend={sopTrend.map((t) => t.value)} color={PURPLE} />
            <ScoreCard icon="📦" label="Kesehatan Stok" value={avgKes} target={98} trend={kesTrend.map((t) => t.value)} color={GREEN} />
            <ScoreCard icon="🔧" label="Service Ratio" value={avgSvc} target={95} sub={`${svcDinilai} dari ${branches.length} cabang dinilai`} trend={svcTrend.map((t) => t.value)} color={BLUE} />
            <ScoreCard icon="💰" label="Audit Kas Kecil" value={avgKeu} target={95} trend={keuTrend.map((t) => t.value)} color={GOLD} />
          </div>
          <GaugeCard score={avgTotal} />
        </div>

        {/* Run rate 6 bulan — semua modul */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 14 }}>Run Rate 6 Bulan Terakhir</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 22 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: PURPLE, marginBottom: 6 }}>% Kepatuhan SOP</div>
              <BarTrend data={sopTrend} target={90} color={PURPLE} />
            </div>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: GREEN, marginBottom: 6 }}>Kesehatan Stok</div>
              <BarTrend data={kesTrend} target={98} color={GREEN} />
            </div>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: BLUE, marginBottom: 6 }}>Service Ratio</div>
              <BarTrend data={svcTrend} target={95} color={BLUE} />
            </div>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "#b07212", marginBottom: 6 }}>Audit Kas Kecil</div>
              <BarTrend data={keuTrend} target={95} color={GOLD} />
            </div>
          </div>
        </div>

        {/* Distribusi temuan + risk level + top 5 + progres */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14 }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 12 }}>Distribusi Temuan ({periodeLabel(period)})</div>
            <DonutRow total={temuanBreakdown.total} segments={[
              { label: "Major", value: temuanBreakdown.major, color: RED },
              { label: "Minor", value: temuanBreakdown.minor, color: GOLD },
            ]} />
          </div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 12 }}>Risk Level</div>
            <DonutRow total={branchRows.length} segments={[
              { label: "Low Risk", value: branchRows.filter((r) => r.total != null && riskInfo(r.total).label === "Low").length, color: GREEN },
              { label: "Medium Risk", value: branchRows.filter((r) => r.total != null && riskInfo(r.total).label === "Medium").length, color: GOLD },
              { label: "High Risk", value: branchRows.filter((r) => r.total != null && riskInfo(r.total).label === "High").length, color: RED },
            ]} />
          </div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 3 }}>Top 5 Temuan</div>
            <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginBottom: 12 }}>Item checklist yang paling sering TIDAK terpenuhi</div>
            {temuanBreakdown.top5.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Belum ada temuan.</div>
            ) : temuanBreakdown.top5.map((t, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: i < 4 ? "1px solid var(--border)" : "none" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: PURPLE, color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
                <div style={{ fontSize: 12, flex: 1, lineHeight: 1.45 }}>{t.text}</div>
                <div style={{ fontSize: 12, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{t.n}</div>
              </div>
            ))}
          </div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 12 }}>Progres Jadwal Kunjungan ({periodeLabel(period)})</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <ProgresBox label="Terjadwal" value={progres.terjadwal} color={PURPLE} />
              <ProgresBox label="Sudah Visit" value={progres.selesai} color={GREEN} />
              <ProgresBox label="Ada Kendala" value={progres.kendala} color={RED} />
              <ProgresBox label="Total Jadwal" value={progres.total} color={GOLD} />
            </div>
          </div>
        </div>

        {/* Tabel performa per cabang */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>Performa Audit per Cabang ({periodeLabel(period)}) <span style={{ fontWeight: 400, fontSize: 11, color: "var(--text-faint)", marginLeft: 8 }}>Klik cabang untuk melihat rincian</span></div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "var(--surface-alt)" }}>
                  {["No", "Cabang", "% SOP", "Kesehatan Stok", "Service Ratio", "Audit Kas Kecil", "Total Skor", "Grade", "Risk Level"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontWeight: 700, color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {branchRows.map((r, i) => {
                  const g = r.total != null ? gradeInfo(r.total) : null;
                  const rk = r.total != null ? riskInfo(r.total) : null;
                  return (
                    <tr key={r.branch.id} onClick={() => setSelectedId(r.branch.id)} title="Klik untuk melihat rincian" style={{ borderBottom: "1px solid var(--border)", cursor: "pointer", background: selectedId === r.branch.id ? "var(--surface-alt)" : "transparent" }}>
                      <td style={{ padding: "8px 12px" }}>{i + 1}</td>
                      <td style={{ padding: "8px 12px", fontWeight: 600 }}>{r.branch.name} <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>{"\u203a"}</span></td>
                      <td style={{ padding: "8px 12px" }}>{r.sopScore != null ? r.sopScore.toFixed(0) + "%" : "\u2014"}</td>
                      <td style={{ padding: "8px 12px" }}>{r.kesScore != null ? r.kesScore.toFixed(0) + "%" : "\u2014"}</td>
                      <td style={{ padding: "8px 12px" }}>{r.svcScore != null ? r.svcScore.toFixed(0) + "%" : "\u2014"}</td>
                      <td style={{ padding: "8px 12px" }} title={r.keuOverLimit ? "Saldo masuk melebihi limit kas bulan ini" : ""}>{r.keuScore != null ? r.keuScore.toFixed(0) + "%" : "\u2014"}{r.keuOverLimit && <sup style={{ color: GOLD, fontWeight: 800, marginLeft: 2 }}>*</sup>}</td>
                      <td style={{ padding: "8px 12px", fontWeight: 700 }}>{r.total != null ? r.total.toFixed(0) + "%" : "\u2014"}</td>
                      <td style={{ padding: "8px 12px" }}>{g && <span style={{ fontWeight: 800, color: g.color }}>{g.grade}</span>}</td>
                      <td style={{ padding: "8px 12px" }}>{rk && <span style={{ fontWeight: 700, color: rk.color }}>{rk.label}</span>}</td>
                    </tr>
                  );
                })}
                {branchRows.length === 0 && (
                  <tr><td colSpan={9} style={{ padding: 24, textAlign: "center", color: "var(--text-faint)" }}>Belum ada cabang teraudit periode ini.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>
          Catatan: Total Skor dihitung berdasarkan bobot: SOP (30%), Kesehatan Stok (30%), Service Ratio (20%), Audit Kas Kecil (20%). Cabang tanpa data di salah satu modul dihitung dari sisa modul yang ada (bobot dinormalisasi). Skor Service Ratio dihitung berjenjang dari ratio asli (Laptop &amp; Aksesoris dinilai sendiri-sendiri lalu dirata-rata): 100 turun ke 90 di batas Terkendali, ke 70 di batas Monitoring, dan ke 40 di 2x batas Monitoring. Skor Audit Kas Kecil dipetakan dari tingkatan status modulnya (Terkendali/Efisien/Monitoring/dst) ke poin 100/90/70/65/40/35/25. Skala poin ini pemetaan asumsi, bukan definisi resmi dari modul aslinya.
          <br /><span style={{ color: GOLD, fontWeight: 800 }}>*</span> = saldo masuk melebihi limit kas bulan ini (nggak ngaruh ke skor, cuma penanda buat dicek).
        </div>
      </div>
      {selectedRow && (
        <BranchDetailDrawer row={selectedRow} period={period} trend={selectedTrend} keuSettings={keuSettings} isPersonalView={isPersonalView} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}

function KpiCard({ icon, label, value, sub, color }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}1c`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{icon}</div>
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase" }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>{value}</div>
        {sub && <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{sub}</div>}
      </div>
    </div>
  );
}

function ScoreCard({ icon, label, value, target, trend, color, sub }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: `${color}1c`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>{icon}</div>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase" }}>{label}</div>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color }}>{value != null ? value.toFixed(1) + "%" : "\u2014"}</div>
      <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>Target &ge; {target}%</div>
      {sub && <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{sub}</div>}
      {trend && trend.some((v) => v != null) && <Sparkline data={trend} color={color} />}
    </div>
  );
}

function Sparkline({ data, color }) {
  const w = 200, h = 26;
  const vals = data.filter((v) => v != null);
  if (vals.length < 2) return null;
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => v == null ? null : `${i * step},${h - ((v - min) / range) * h}`).filter(Boolean).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: h }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GaugeCard({ score }) {
  const pct = score != null ? Math.max(0, Math.min(100, score)) : 0;
  const angle = (pct / 100) * 180;
  const r = 70, cx = 90, cy = 90;
  const rad = (deg) => (deg * Math.PI) / 180;
  const x = cx - r * Math.cos(rad(angle));
  const y = cy - r * Math.sin(rad(angle));
  const label = score == null ? "\u2014" : score >= 90 ? "EXCELLENT" : score >= 80 ? "VERY GOOD" : score >= 70 ? "GOOD" : "NEEDS ATTENTION";
  const color = score == null ? "#999" : score >= 90 ? "#1a9e6e" : score >= 80 ? "#7c5fc9" : score >= 70 ? "#b07212" : "#a32020";
  return (
    <div style={{ background: "linear-gradient(160deg,#2A1F52,#1a1330)", borderRadius: 14, padding: 18, color: "#fff", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.05em", opacity: 0.7, alignSelf: "flex-start" }}>OVERALL AUDIT SCORE</div>
      <svg width={180} height={100} viewBox="0 0 180 100" style={{ marginTop: 6 }}>
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="10" strokeLinecap="round" />
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${x} ${y}`} fill="none" stroke={GOLD} strokeWidth="10" strokeLinecap="round" />
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="26" fontWeight="800" fill="#fff">{score != null ? score.toFixed(1) : "\u2014"}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.6)">/100</text>
      </svg>
      <div style={{ fontSize: 12, fontWeight: 800, color, marginTop: 4 }}>{label}</div>
    </div>
  );
}

// Grafik tren bulanan. Dulu berupa bar yang selalu mulai dari 0% — padahal skornya hampir selalu
// 80-100%, jadi semua bar kelihatan sama tinggi dan tulisannya mengecil karena SVG diskalakan.
// Sekarang garis + titik dengan skala dipersempit ke rentang data (tertulis di keterangan di bawah),
// angka & nama bulan lebih besar, dan garis target diberi label.
function BarTrend({ data, target, color = PURPLE }) {
  const w = 480, h = 210, padL = 40, padR = 22, padT = 30, padB = 34;
  const vals = data.map((d) => d.value).filter((v) => v != null);
  const hi = 100;
  let lo = Math.floor((Math.min(...(vals.length ? vals : [target]), target) - 8) / 5) * 5;
  lo = Math.max(0, Math.min(lo, hi - 20));
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const inset = 22; // jarak titik dari tepi, supaya angka tidak menabrak label sumbu Y
  const xAt = (i) => padL + inset + (data.length === 1 ? (innerW - inset * 2) / 2 : (i * (innerW - inset * 2)) / (data.length - 1));
  const yAt = (v) => padT + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * innerH;
  const pts = data.map((d, i) => (d.value == null ? null : { x: xAt(i), y: yAt(d.value), v: d.value, i }));
  const ada = pts.filter(Boolean);
  const ticks = [lo, Math.round((lo + hi) / 2 / 5) * 5, hi].filter((t, i, arr) => arr.indexOf(t) === i);
  const short = (p) => periodeLabel(p).split(" ")[0].slice(0, 3);
  const targetY = yAt(target);
  const last = ada[ada.length - 1];
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto", display: "block" }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} y1={yAt(t)} x2={w - padR} y2={yAt(t)} stroke="var(--border)" strokeWidth="1" />
            <text x={padL - 8} y={yAt(t) + 4} textAnchor="end" fontSize="12" fill="var(--text-faint)">{t}%</text>
          </g>
        ))}
        <line x1={padL} y1={targetY} x2={w - padR} y2={targetY} stroke={GOLD} strokeWidth="1.5" strokeDasharray="5 4" />
        {ada.length > 1 && <polyline points={ada.map((q) => `${q.x},${q.y}`).join(" ")} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
        {pts.map((q, i) => {
          if (!q) return null;
          const isLast = q === last;
          const bawah = q.y < padT + 14; // titik terlalu atas: taruh angka di bawah titik
          return (
            <g key={i}>
              <circle cx={q.x} cy={q.y} r={isLast ? 6.5 : 4.5} fill={color} stroke="var(--surface)" strokeWidth="2" />
              <text x={q.x} y={bawah ? q.y + 20 : q.y - 11} textAnchor="middle" fontSize={isLast ? 14 : 12.5} fontWeight="800" fill="var(--text-primary)">{q.v.toFixed(isLast ? 1 : 0)}%</text>
            </g>
          );
        })}
        {data.map((d, i) => (
          <text key={i} x={xAt(i)} y={h - 10} textAnchor="middle" fontSize="12.5" fill={i === data.length - 1 ? "var(--text-primary)" : "var(--text-faint)"} fontWeight={i === data.length - 1 ? 700 : 400}>{short(d.period)}</text>
        ))}
      </svg>
      <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 2 }}>Skala grafik {lo}&ndash;{hi}% &middot; garis kuning putus-putus = target {target}%</div>
    </div>
  );
}

function DonutRow({ total, segments }) {
  const size = 140, r = 55, cx = 70, cy = 70, sw = 20;
  let cum = 0;
  const circumference = 2 * Math.PI * r;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={sw} />
        {segments.map((s, i) => {
          const frac = total > 0 ? s.value / total : 0;
          const len = frac * circumference;
          const dashoffset = -cum * circumference;
          cum += frac;
          if (frac === 0) return null;
          return <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={sw} strokeDasharray={`${len} ${circumference - len}`} strokeDashoffset={dashoffset} transform={`rotate(-90 ${cx} ${cy})`} />;
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="22" fontWeight="800" fill="var(--text-primary)">{total}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="9" fill="var(--text-faint)">Total</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {segments.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color }} />
            <span style={{ color: "var(--text-secondary)" }}>{s.label}</span>
            <span style={{ fontWeight: 700, marginLeft: "auto" }}>{s.value} ({total > 0 ? Math.round((s.value / total) * 100) : 0}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProgresBox({ label, value, color }) {
  return (
    <div style={{ background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontSize: 20, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{label}</div>
    </div>
  );
}

// Panel rincian 1 cabang: "kenapa skornya segini" — skor per modul, modul yang paling menarik
// skor turun, temuan SOP, service ratio, kas kecil, tren 6 bulan, dan hal yang perlu ditindaklanjuti.
function BranchDetailDrawer({ row, period, trend, keuSettings, isPersonalView, onClose }) {
  const g = row.total != null ? gradeInfo(row.total) : null;
  const rk = row.total != null ? riskInfo(row.total) : null;

  const mods = [
    { key: "sop", label: "% Kepatuhan SOP", v: row.sopScore, w: BOBOT.sop, t: TARGETS.sop, color: PURPLE },
    { key: "kes", label: "Kesehatan Stok", v: row.kesScore, w: BOBOT.kesehatan, t: TARGETS.kesehatan, color: GREEN },
    { key: "svc", label: "Service Ratio", v: row.svcScore, w: BOBOT.service, t: TARGETS.service, color: BLUE },
    { key: "keu", label: "Audit Kas Kecil", v: row.keuScore, w: BOBOT.keuangan, t: TARGETS.keuangan, color: GOLD },
  ];
  const aktif = mods.filter((m) => m.v != null);
  const wSum = aktif.reduce((s, m) => s + m.w, 0);
  const withLoss = mods.map((m) => ({ ...m, loss: m.v != null && wSum > 0 ? (Math.max(0, m.t - m.v) * m.w) / wSum : 0 }));
  const maxLoss = Math.max(0, ...withLoss.map((m) => m.loss));

  // Temuan SOP — pakai listFailedItems() biar checklist lama & baru sama-sama kebaca benar
  const sopData = row.sopRec && !row.sopRec.data?.tidak_visit ? row.sopRec.data : null;
  const legacy = sopData ? isLegacyChecklistRecord(sopData) : false;
  const failed = sopData
    ? listFailedItems(sopData)
        .map((f) => ({ ...f, kritis: !legacy && isCriticalItem(f.catId, Number(f.key.slice(f.key.lastIndexOf("_") + 1))) }))
        .sort((a, b) => Number(b.kritis) - Number(a.kritis))
    : [];
  const jumlahKritis = failed.filter((f) => f.kritis).length;
  const SHOW = 10;

  // Service ratio (Laptop & Aksesoris dinilai sendiri-sendiri, threshold beda)
  const d = row.svcRec?.data;
  const svcItems = [];
  if (d) {
    if (d.ratio_laptop != null || d.ratio_aksesoris != null) {
      if (d.ratio_laptop != null) svcItems.push({ label: "Laptop", ratio: d.ratio_laptop, st: laptopStatusInfo(d.ratio_laptop) });
      if (d.ratio_aksesoris != null) svcItems.push({ label: "Aksesoris", ratio: d.ratio_aksesoris, st: serviceStatusInfo(d.ratio_aksesoris) });
    } else if (d.ratio != null) {
      svcItems.push({ label: "Gabungan (data lama)", ratio: d.ratio, st: serviceStatusInfo(d.ratio) });
    }
  }

  const keu = keuanganInfoOf(row.keuRec);

  // Hal yang perlu ditindaklanjuti — murni dari data (bukan saran karangan)
  const todo = [];
  if (sopData && failed.length) todo.push(`${failed.length} item SOP belum terpenuhi` + (jumlahKritis ? ` (${jumlahKritis} item kritis)` : "") + ".");
  if (row.kesScore != null && row.kesScore < TARGETS.kesehatan) todo.push(`Kesehatan stok ${row.kesScore.toFixed(1)}% masih di bawah target ${TARGETS.kesehatan}%.`);
  svcItems.forEach((s) => { if (s.st.lbl !== "Terkendali") todo.push(`Service ratio ${s.label} ${formatRatioPct(s.ratio)} berstatus ${s.st.lbl}.`); });
  if (keu) {
    if (keu.sisa < 0) todo.push(`Sisa saldo kas kecil minus ${rp(keu.sisa)}.`);
    if (keu.bawaanMinus < 0) todo.push(`Ada bawaan minus dari bulan lalu ${rp(keu.bawaanMinus)}, ikut mengurangi kas tersedia bulan ini.`);
    if (keu.sisa >= 0 && keu.posisi > keuSettings.monitoring) todo.push(`Pemakaian kas ${keu.posisi.toFixed(0)}% melewati batas Monitoring (${keuSettings.monitoring}%).`);
    if (keu.overLimit) todo.push(`Saldo masuk ${rp(keu.sm)} melebihi limit kas ${rp(keu.lim)}.`);
  }

  const secTitle = { fontWeight: 700, fontSize: 13, margin: "22px 0 8px" };
  const modInfo = (m) =>
    `Target ${m.t}% \u00b7 Bobot ${Math.round(m.w * 100)}% \u00b7 Kontribusi ${((m.v * m.w) / wSum).toFixed(1)} poin` +
    (m.loss > 0 ? ` \u00b7 kurang ${m.loss.toFixed(1)} poin dari target` : " \u00b7 target tercapai");

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.35)", zIndex: 90 }} />
      <div role="dialog" aria-label={`Rincian ${row.branch.name}`} style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(480px, 100vw)", background: "var(--surface)", borderLeft: "1px solid var(--border)", boxShadow: "-8px 0 30px rgba(0,0,0,0.25)", zIndex: 91, overflowY: "auto", padding: 22 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>{row.branch.name}</div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Rincian skor {periodeLabel(period)}</div>
          </div>
          <button className="btn-ghost" onClick={onClose} aria-label="Tutup" style={{ padding: "6px 10px" }}>{"\u2715"}</button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14, background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 16px" }}>
          <div style={{ fontSize: 30, fontWeight: 800, color: g ? g.color : "var(--text-faint)" }}>{row.total != null ? row.total.toFixed(1) + "%" : "\u2014"}</div>
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
            {g && <div>Grade <b style={{ color: g.color }}>{g.grade}</b> {"\u00b7"} Risk <b style={{ color: rk.color }}>{rk.label}</b></div>}
            <div style={{ color: "var(--text-faint)" }}>Dihitung dari {aktif.length} modul yang ada datanya</div>
          </div>
        </div>

        <div style={secTitle}>Skor per modul</div>
        {withLoss.map((m) => (
          <div key={m.key} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 700, fontSize: 12.5, color: m.color }}>{m.label}</div>
              {m.v != null && m.loss > 0 && m.loss === maxLoss && maxLoss >= 0.05 && (
                <span style={{ fontSize: 9.5, fontWeight: 800, color: RED, background: `${RED}18`, padding: "1px 7px", borderRadius: 20 }}>PALING MENARIK SKOR TURUN</span>
              )}
              <div style={{ marginLeft: "auto", fontWeight: 800, fontSize: 15 }}>{m.v != null ? m.v.toFixed(1) + "%" : "\u2014"}</div>
            </div>
            {m.v != null ? (
              <>
                <div style={{ position: "relative", height: 8, borderRadius: 6, background: "var(--border)", marginTop: 7 }}>
                  <div style={{ width: `${Math.max(0, Math.min(100, m.v))}%`, height: "100%", borderRadius: 6, background: m.color }} />
                  <div style={{ position: "absolute", left: `${m.t}%`, top: -3, bottom: -3, width: 2, background: GOLD }} />
                </div>
                <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 6 }}>{modInfo(m)}</div>
              </>
            ) : (
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>Belum ada data periode ini (tidak dihitung).</div>
            )}
          </div>
        ))}

        <div style={secTitle}>Temuan SOP</div>
        {!sopData ? (
          <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Belum ada audit SOP yang valid di periode ini.</div>
        ) : failed.length === 0 ? (
          <div style={{ fontSize: 12, color: GREEN, fontWeight: 600 }}>Semua item SOP terpenuhi.</div>
        ) : (
          <>
            <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 6 }}>{failed.length} item belum terpenuhi{jumlahKritis ? `, ${jumlahKritis} di antaranya kritis` : ""}.</div>
            {failed.slice(0, SHOW).map((f) => (
              <div key={f.key} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontSize: 9.5, fontWeight: 800, color: f.kritis ? RED : AMBER, background: f.kritis ? `${RED}18` : `${AMBER}18`, padding: "2px 7px", borderRadius: 20, flexShrink: 0, marginTop: 1 }}>{f.kritis ? "MAJOR" : "MINOR"}</span>
                <div style={{ fontSize: 12, lineHeight: 1.45 }}>{f.text}<div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{f.catLabel}</div></div>
              </div>
            ))}
            {failed.length > SHOW && <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>+{failed.length - SHOW} temuan lainnya (lihat modul Audit SOP).</div>}
          </>
        )}

        {svcItems.length > 0 && (
          <>
            <div style={secTitle}>Service Ratio</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {svcItems.map((s) => (
                <div key={s.label} style={{ background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px" }}>
                  <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{s.label}</div>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{formatRatioPct(s.ratio)}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: s.st.color }}>{s.st.lbl}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {keu && (
          <>
            <div style={secTitle}>Kas Kecil</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[
                ["Saldo sebelumnya", rp(keu.sb), keu.sb < 0],
                ["Saldo masuk", rp(keu.sm), false],
                ["Pengeluaran", rp(keu.pk), false],
                ["Sisa saldo", rp(keu.sisa), keu.sisa < 0],
              ].map(([lbl, val, bad]) => (
                <div key={lbl} style={{ background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px" }}>
                  <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{lbl}</div>
                  <div style={{ fontWeight: 800, fontSize: 13.5, color: bad ? RED : "var(--text-primary)" }}>{val}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 6 }}>Pemakaian kas {keu.posisi.toFixed(0)}% dari kas tersedia{keu.lim > 0 ? ` \u00b7 limit ${rp(keu.lim)}` : ""}.</div>
          </>
        )}

        <div style={secTitle}>Tren skor 6 bulan</div>
        <BarTrend data={trend.map((t) => ({ period: t.period, value: t.total }))} target={80} color={PURPLE} />
        <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>Garis emas = batas sehat 80.</div>

        <div style={secTitle}>Perlu ditindaklanjuti</div>
        {todo.length === 0 ? (
          <div style={{ fontSize: 12, color: GREEN, fontWeight: 600 }}>Tidak ada hal yang perlu ditindaklanjuti dari data periode ini.</div>
        ) : todo.map((t, i) => (
          <div key={i} style={{ display: "flex", gap: 8, padding: "5px 0", fontSize: 12.5, lineHeight: 1.5 }}>
            <span style={{ color: AMBER, fontWeight: 800 }}>{"\u2022"}</span>
            <span>{t}</span>
          </div>
        ))}

        {isPersonalView && (
          <div style={{ marginTop: 22, fontSize: 10.5, color: "var(--text-faint)" }}>Tampilan personal: hanya audit yang kamu isi sendiri yang ikut terhitung.</div>
        )}
      </div>
    </>
  );
}
