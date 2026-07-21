import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabaseClient";
import { calcWeightedFromRecord, scoreColor, nowPeriode, periodeLabel, addMonthsToPeriod } from "../../lib/sopConfig";

export default function SopRanking() {
  const [branches, setBranches] = useState([]);
  const [records, setRecords] = useState([]);
  const [period, setPeriod] = useState(nowPeriode());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [brRes, recRes] = await Promise.all([
        supabase.from("branches").select("*").order("name"),
        supabase.from("audit_generic").select("*").eq("module", "sop"),
      ]);
      if (brRes.error) throw brRes.error;
      setBranches(brRes.data || []);
      setRecords(recRes.data || []);
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

  const rows = useMemo(() => {
    const list = branches.map((b) => {
      const rec = records.find((r) => r.branch_id === b.id && r.period === period);
      if (!rec || rec.data?.tidak_visit) return null;
      const score = calcWeightedFromRecord(rec.data);
      return { branch: b, rec, score };
    }).filter(Boolean);
    return list.sort((a, b) => b.score - a.score);
  }, [branches, records, period]);

  if (loading) return <div style={{ padding: 40, color: "var(--text-secondary)" }}>Memuat\u2026</div>;

  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3);
  const notAudited = branches.length - rows.length;

  return (
    <div style={{ flex: 1 }}>
      <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Ranking Cabang</div>
          <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>Diurutkan dari skor Audit SOP tertinggi</div>
        </div>
        <select className="input" style={{ width: 180 }} value={period} onChange={(e) => setPeriod(e.target.value)}>
          {periodOptions.map((p) => <option key={p} value={p}>{periodeLabel(p)}</option>)}
        </select>
      </div>

      {error && <div style={{ margin: "14px 28px 0", background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}

      <div style={{ padding: 24 }}>
        {rows.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--text-faint)", padding: 60 }}>
            Belum ada cabang yang diaudit periode ini.
          </div>
        ) : (
          <>
            {/* ── Podium top 3 ── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 28, alignItems: "end" }}>
              {top3[1] && <PodiumCard row={top3[1]} rank={2} />}
              {top3[0] && <PodiumCard row={top3[0]} rank={1} big />}
              {top3[2] && <PodiumCard row={top3[2]} rank={3} />}
            </div>

            {/* ── List rank 4+ ── */}
            {rest.length > 0 && (
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
                {rest.map((r, i) => (
                  <ListRow key={r.branch.id} row={r} rank={i + 4} expanded={expandedId === r.branch.id} onToggle={() => setExpandedId(expandedId === r.branch.id ? null : r.branch.id)} last={i === rest.length - 1} />
                ))}
              </div>
            )}

            {notAudited > 0 && (
              <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 14 }}>
                {notAudited} cabang belum diaudit / Tidak Visit periode ini, tidak masuk ranking.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PodiumCard({ row, rank, big }) {
  const crown = rank === 1 ? "\u{1F451}" : rank === 2 ? "\u{1F948}" : "\u{1F949}";
  const medalColor = rank === 1 ? "#F4B740" : rank === 2 ? "#B8C0CC" : "#C0813E";
  return (
    <div style={{
      position: "relative", background: "var(--surface)", border: `1.5px solid ${medalColor}`, borderRadius: 16,
      padding: big ? "26px 18px 20px" : "20px 16px 16px", textAlign: "center", overflow: "hidden",
      boxShadow: big ? `0 6px 24px ${medalColor}33` : "none", order: rank === 1 ? 2 : rank === 2 ? 1 : 3,
    }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 4, background: medalColor }} />
      <div style={{ fontSize: big ? 40 : 30, marginBottom: 6 }}>{crown}</div>
      <div style={{ fontWeight: 700, fontSize: big ? 17 : 14.5, marginBottom: 4 }}>{row.branch.name}</div>
      <div style={{ fontSize: big ? 34 : 24, fontWeight: 800, color: scoreColor(row.score) }}>{row.score}%</div>
      <div style={{ fontSize: 10.5, color: "var(--text-faint)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>Skor SOP</div>
    </div>
  );
}

function ListRow({ row, rank, expanded, onToggle, last }) {
  return (
    <div style={{ borderBottom: last ? "none" : "1px solid var(--border)" }}>
      <div onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 18px", cursor: "pointer" }}>
        <div style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--surface-alt)", color: "var(--text-secondary)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>{rank}</div>
        <div style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{row.branch.name}</div>
        <div style={{ fontWeight: 800, fontSize: 16, color: scoreColor(row.score) }}>{row.score}%</div>
        <span style={{ fontSize: 11, color: "var(--text-faint)", transform: expanded ? "rotate(180deg)" : "none", transition: "transform .15s" }}>&#9660;</span>
      </div>
      {expanded && (
        <div style={{ padding: "0 18px 16px 58px", fontSize: 12, color: "var(--text-faint)" }}>
          Auditor: {row.rec.data?.auditor_name || "\u2014"} &middot; Tanggal: {row.rec.data?.audit_date || "\u2014"}
        </div>
      )}
    </div>
  );
}
