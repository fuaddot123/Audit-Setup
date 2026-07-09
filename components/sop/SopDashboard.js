import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabaseClient";
import {
  CATS, ALERT_THRESHOLD, calcWeightedFromRecord, calcTierScores,
  scoreColor, nowPeriode, periodeLabel,
} from "../../lib/sopConfig";

export default function SopDashboard() {
  const [branches, setBranches] = useState([]);
  const [records, setRecords] = useState([]); // semua baris audit_generic module='sop'
  const [period, setPeriod] = useState(nowPeriode());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const { data: br, error: brErr } = await supabase.from("branches").select("*").order("name");
      if (brErr) throw brErr;
      setBranches(br || []);

      const { data: rec, error: recErr } = await supabase
        .from("audit_generic")
        .select("*")
        .eq("module", "sop")
        .order("updated_at", { ascending: false });
      if (recErr) throw recErr;
      setRecords(rec || []);
    } catch (err) {
      setError("Gagal memuat data: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  const periodOptions = useMemo(() => {
    const set = new Set([nowPeriode(), period]);
    records.forEach((r) => set.add(r.period));
    return [...set].filter(Boolean).sort().reverse();
  }, [records, period]);

  // Baris terbaru per cabang untuk periode aktif
  const rowsByBranch = useMemo(() => {
    const map = {};
    records.filter((r) => r.period === period).forEach((r) => {
      if (!map[r.branch_id]) map[r.branch_id] = r; // sudah urut terbaru dulu (updated_at desc)
    });
    return map;
  }, [records, period]);

  const branchStats = branches.map((b) => {
    const row = rowsByBranch[b.id];
    const data = row?.data || null;
    const score = data ? calcWeightedFromRecord(data) : null;
    const tiers = data ? calcTierScores(data) : null;
    return { branch: b, row, score, tiers };
  });

  const auditedCount = branchStats.filter((s) => s.row).length;
  const avgScore = auditedCount > 0
    ? Math.round(branchStats.filter((s) => s.score !== null).reduce((sum, s) => sum + s.score, 0) / auditedCount)
    : null;
  const alertCount = branchStats.filter((s) => s.score !== null && s.score < ALERT_THRESHOLD).length;

  if (loading) return <div style={{ padding: 40, color: "var(--text-secondary)" }}>Memuat\u2026</div>;

  return (
    <div style={{ flex: 1 }}>
      <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Dashboard Audit SOP</div>
          <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>Ringkasan skor checklist SOP tiap cabang, {CATS.length} kategori &middot; {CATS.reduce((s, c) => s + c.items.length, 0)} item</div>
        </div>
        <select className="input" style={{ width: 200 }} value={period} onChange={(e) => setPeriod(e.target.value)}>
          {periodOptions.map((p) => <option key={p} value={p}>{periodeLabel(p)}</option>)}
        </select>
      </div>

      {error && <div style={{ margin: "14px 28px 0", background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}

      <div style={{ padding: 24 }}>
        {/* Kartu ringkasan */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 22 }}>
          <SummaryCard label="Cabang sudah diaudit" value={`${auditedCount} / ${branches.length}`} />
          <SummaryCard label="Rata-rata skor" value={avgScore !== null ? `${avgScore}%` : "\u2014"} color={avgScore !== null ? scoreColor(avgScore) : undefined} />
          <SummaryCard label={`Di bawah ${ALERT_THRESHOLD}% (alert)`} value={alertCount} color={alertCount > 0 ? "var(--danger-text)" : "#1a9e6e"} />
        </div>

        {/* Grid kartu per cabang */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 14 }}>
          {branchStats.map(({ branch, row, score, tiers }) => (
            <div key={branch.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div style={{ fontWeight: 600, fontSize: 14.5 }}>{branch.name}</div>
                {score !== null && score < ALERT_THRESHOLD && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: "var(--danger-text)", background: "var(--danger-bg)", padding: "2px 7px", borderRadius: 20 }}>ALERT</span>
                )}
              </div>

              {row ? (
                <>
                  <div style={{ fontSize: 30, fontWeight: 800, color: scoreColor(score), lineHeight: 1 }}>{score}%</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 4, marginBottom: 10 }}>
                    Status: {statusLabel(row.status)} &middot; {row.data?.audit_date ? formatDate(row.data.audit_date) : ""}
                  </div>
                  {tiers && (
                    <div style={{ display: "flex", gap: 8, fontSize: 11 }}>
                      <TierPill label="Tier 1" value={tiers.tier1} />
                      <TierPill label="Tier 2" value={tiers.tier2} />
                      <TierPill label="Tier 3" value={tiers.tier3} />
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 12.5, color: "var(--text-faint)", padding: "8px 0" }}>Belum ada audit periode ini</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px" }}>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: color || "var(--text-primary)" }}>{value}</div>
    </div>
  );
}

function TierPill({ label, value }) {
  return (
    <div style={{ background: "var(--bg-page)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 7px", color: value !== null ? scoreColor(value) : "var(--text-faint)", fontWeight: 600 }}>
      {label}: {value !== null && value !== undefined ? `${value}%` : "\u2014"}
    </div>
  );
}

function statusLabel(status) {
  return { draft: "Draft", submitted: "Menunggu approval", approved: "Disetujui", rejected: "Ditolak" }[status] || status;
}

function formatDate(v) {
  if (!v) return "\u2014";
  return new Date(v + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}
