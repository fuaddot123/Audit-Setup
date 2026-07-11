import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabaseClient";
import { serviceStatusInfo, formatRatioPct, nowPeriode, periodeLabel } from "../../lib/stokConfig";

export default function StokDashboard() {
  const [branches, setBranches] = useState([]);
  const [records, setRecords] = useState([]);
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
        .eq("module", "stok_service")
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

  const rowsByBranch = useMemo(() => {
    const map = {};
    records.filter((r) => r.period === period).forEach((r) => {
      if (!map[r.branch_id]) map[r.branch_id] = r;
    });
    return map;
  }, [records, period]);

  const branchStats = branches.map((b) => {
    const row = rowsByBranch[b.id];
    const data = row?.data || null;
    const ratio = data ? data.ratio : null;
    const status = ratio !== null ? serviceStatusInfo(ratio) : null;
    return { branch: b, row, ratio, status };
  });

  const auditedCount = branchStats.filter((s) => s.row).length;
  const perluPerhatianCount = branchStats.filter((s) => s.status?.lbl === "Perlu Perhatian").length;

  if (loading) return <div style={{ padding: 40, color: "var(--text-secondary)" }}>Memuat\u2026</div>;

  return (
    <div style={{ flex: 1 }}>
      <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Dashboard Audit Stok</div>
          <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>Ringkasan Service Ratio tiap cabang</div>
        </div>
        <select className="input" style={{ width: 200 }} value={period} onChange={(e) => setPeriod(e.target.value)}>
          {periodOptions.map((p) => <option key={p} value={p}>{periodeLabel(p)}</option>)}
        </select>
      </div>

      {error && <div style={{ margin: "14px 28px 0", background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}

      <div style={{ padding: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 22 }}>
          <SummaryCard label="Cabang sudah diaudit" value={`${auditedCount} / ${branches.length}`} />
          <SummaryCard label="Perlu Perhatian" value={perluPerhatianCount} color={perluPerhatianCount > 0 ? "#a32020" : "#1a9e6e"} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
          {branchStats.map(({ branch, row, ratio, status }) => (
            <div key={branch.id} style={{ position: "relative", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 16, overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: row ? status.color : "linear-gradient(90deg, #7c3aed, #F4B740)" }} />
              <div style={{ fontWeight: 600, fontSize: 14.5, marginBottom: 8 }}>{branch.name}</div>
              {row ? (
                <>
                  <div style={{ fontSize: 24, fontWeight: 800, color: status.color }}>{formatRatioPct(ratio)}</div>
                  <span style={{ display: "inline-block", marginTop: 6, padding: "3px 10px", borderRadius: 20, background: `${status.color}22`, color: status.color, fontSize: 11, fontWeight: 600 }}>{status.lbl}</span>
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
