import { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";
import { sortBranches } from "../lib/branchOrder";
import { CATS, calcWeightedFromRecord, periodeLabel, addMonthsToPeriod, nowPeriode } from "../lib/sopConfig";
import { calcKesehatanPct, formatKesehatanPct, calcServiceRatio, formatRatioPct, SERVICE_THRESHOLDS } from "../lib/stokConfig";

const ISOLATION_START_PERIOD = "2026-08";
const BOBOT = { sop: 0.3, kesehatan: 0.3, service: 0.2, keuangan: 0.2 };
const PURPLE = "#6b3fa0", GOLD = "#F4B740", GREEN = "#1a9e6e", RED = "#a32020", AMBER = "#b07212", BLUE = "#1558a0";

function gradeInfo(score) {
  if (score >= 90) return { grade: "A", color: GREEN };
  if (score >= 80) return { grade: "B", color: GOLD };
  if (score >= 70) return { grade: "C", color: AMBER };
  return { grade: "D", color: RED };
}
function riskInfo(score) {
  // Disamain persis sama batas Grade (90/70), biar nggak ada 1 grade yang kepotong jadi 2 Risk
  // Level beda (kayak kasus Grade C 70-79 dulu kebelah Medium/High di tengah).
  if (score >= 90) return { label: "Low", color: GREEN };
  if (score >= 70) return { label: "Medium", color: GOLD };
  return { label: "High", color: RED };
}

// Skor Audit Keuangan — dulu (SALAH) pakai formula "makin dikit kepake makin bagus", padahal
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

// Skor Service Ratio — dulu (SALAH) pakai `ratio*100` langsung, padahal ambang batasnya
// (SERVICE_THRESHOLDS) super kecil (0.22%/0.33%), bukan skala 0-100%. Angka ratio KECIL itu
// BAGUS (dikit yang perlu diservis), jadi dipetain dari tingkatan status asli, bukan dibalik
// jadi persentase buatan sendiri.
function serviceScoreOf(ratio) {
  if (ratio == null) return null;
  if (ratio <= SERVICE_THRESHOLDS.terkendali) return 100;
  if (ratio <= SERVICE_THRESHOLDS.monitoring) return 70;
  return 40;
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

  const isPersonalView = profile?.role === "auditor" && period >= ISOLATION_START_PERIOD;

  useEffect(() => { loadAll(); }, []);

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
    const svcScore = svcOk ? serviceScoreOf(svcRec.data?.ratio) : null;
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

    return { sopRec, sopScore, kesScore, svcScore, keuScore, keuOverLimit, total, hasAny: !!(sopOk || kesOk || svcOk || keuOk) };
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
  const avgTotal = avg(branchRows.map((r) => r.total).filter((v) => v != null));

  // Temuan: dihitung dari checklist SOP tiap cabang teraudit — item kritis (CRITICAL_ITEMS-level)
  // dianggap "Major", sisanya "Minor". Sederhana tapi konsisten sama data yang udah ada.
  const temuanBreakdown = useMemo(() => {
    let major = 0, minor = 0;
    const itemFail = {};
    branchRows.forEach((r) => {
      if (!r.sopRec || r.sopRec.data?.tidak_visit) return;
      const checks = r.sopRec.data?.checks || {};
      CATS.forEach((c) => c.items.forEach((text, i) => {
        const key = c.id + "_" + i;
        if (!checks[key]) {
          minor++;
          itemFail[key] = (itemFail[key] || 0) + 1;
        }
      }));
    });
    const top5 = Object.entries(itemFail).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([key, n]) => {
        const [catId, idx] = key.split("_");
        const cat = CATS.find((c) => c.id === catId);
        return { text: cat?.items?.[idx] || key, n };
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
    return serviceScoreOf(rec.data?.ratio);
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
            <ScoreCard icon="🔧" label="Service Ratio" value={avgSvc} target={95} trend={svcTrend.map((t) => t.value)} color={BLUE} />
            <ScoreCard icon="💰" label="Audit Keuangan" value={avgKeu} target={95} trend={keuTrend.map((t) => t.value)} color={GOLD} />
          </div>
          <GaugeCard score={avgTotal} />
        </div>

        {/* Run rate 6 bulan — semua modul */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 14 }}>Run Rate 6 Bulan Terakhir</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: PURPLE, marginBottom: 6 }}>% Kepatuhan SOP</div>
              <BarTrend data={sopTrend} target={90} color={PURPLE} />
            </div>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: GREEN, marginBottom: 6 }}>Kesehatan Stok</div>
              <BarTrend data={kesTrend} target={98} color={GREEN} />
            </div>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: BLUE, marginBottom: 6 }}>Service Ratio</div>
              <BarTrend data={svcTrend} target={95} color={BLUE} />
            </div>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "#b07212", marginBottom: 6 }}>Audit Keuangan</div>
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
          <div style={{ fontWeight: 700, fontSize: 13.5, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>Performa Audit per Cabang ({periodeLabel(period)})</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "var(--surface-alt)" }}>
                  {["No", "Cabang", "% SOP", "Kesehatan Stok", "Service Ratio", "Audit Keuangan", "Total Skor", "Grade", "Risk Level"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontWeight: 700, color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {branchRows.map((r, i) => {
                  const g = r.total != null ? gradeInfo(r.total) : null;
                  const rk = r.total != null ? riskInfo(r.total) : null;
                  return (
                    <tr key={r.branch.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 12px" }}>{i + 1}</td>
                      <td style={{ padding: "8px 12px", fontWeight: 600 }}>{r.branch.name}</td>
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
          Catatan: Total Skor dihitung berdasarkan bobot: SOP (30%), Kesehatan Stok (30%), Service Ratio (20%), Audit Keuangan (20%). Cabang tanpa data di salah satu modul dihitung dari sisa modul yang ada (bobot dinormalisasi). Skor Service Ratio &amp; Audit Keuangan dipetakan dari tingkatan status asli modulnya (Terkendali/Efisien/Monitoring/dst, bukan angka mentah) ke poin 100/90/70/65/40/35/25 — ini pemetaan asumsi, bukan definisi resmi dari modul aslinya.
          <br /><span style={{ color: GOLD, fontWeight: 800 }}>*</span> = saldo masuk melebihi limit kas bulan ini (nggak ngaruh ke skor, cuma penanda buat dicek).
        </div>
      </div>
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

function ScoreCard({ icon, label, value, target, trend, color }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: `${color}1c`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>{icon}</div>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase" }}>{label}</div>
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color }}>{value != null ? value.toFixed(1) + "%" : "\u2014"}</div>
      <div style={{ fontSize: 10.5, color: "var(--text-faint)" }}>Target &ge; {target}%</div>
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

function BarTrend({ data, target, color = PURPLE }) {
  const w = 480, h = 160, pad = 24;
  const barW = (w - pad * 2) / data.length * 0.6;
  const gap = (w - pad * 2) / data.length;
  const targetY = h - pad - (target / 100) * (h - pad * 2);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto" }}>
      <line x1={pad} y1={targetY} x2={w - pad} y2={targetY} stroke={GOLD} strokeWidth="1.5" strokeDasharray="4 3" />
      {data.map((d, i) => {
        if (d.value == null) return null;
        const barH = (d.value / 100) * (h - pad * 2);
        const x = pad + i * gap + (gap - barW) / 2;
        const y = h - pad - barH;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} rx="3" fill={color} />
            <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--text-primary)">{d.value.toFixed(0)}%</text>
            <text x={x + barW / 2} y={h - 6} textAnchor="middle" fontSize="9" fill="var(--text-faint)">{periodeLabel(d.period).split(" ")[0]}</text>
          </g>
        );
      })}
    </svg>
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
