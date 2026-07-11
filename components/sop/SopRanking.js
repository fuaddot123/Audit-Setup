import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabaseClient";
import {
  RANKING_BOBOT, calcWeightedFromRecord, calcRank, formatRupiah,
  nowPeriode, periodeLabel,
} from "../../lib/sopConfig";

export default function SopRanking({ profile }) {
  const [branches, setBranches] = useState([]);
  const [sopRecords, setSopRecords] = useState([]); // audit_generic module='sop'
  const [rankingRows, setRankingRows] = useState([]); // ranking_scores
  const [targetRows, setTargetRows] = useState([]); // sales_targets
  const [period, setPeriod] = useState(nowPeriode());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [showScoreModal, setShowScoreModal] = useState(false);
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [scoreForm, setScoreForm] = useState({ branch_id: "", sales_actual: "", cx_score: "", hi_score: "" });
  const [targetForm, setTargetForm] = useState({}); // { branch_id: value }
  const [saving, setSaving] = useState(false);

  const canEdit = profile?.role === "super_admin" || profile?.role === "ceo";

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
      if (rankRes.error) throw rankRes.error;
      if (tgtRes.error) throw tgtRes.error;
      setBranches(brRes.data || []);
      setSopRecords(sopRes.data || []);
      setRankingRows(rankRes.data || []);
      setTargetRows(tgtRes.data || []);
    } catch (err) {
      setError("Gagal memuat data: " + err.message + (err.message?.includes("does not exist") ? " \u2014 tabel ranking_scores/sales_targets belum dibuat, jalankan schema_ranking_addon.sql di Supabase dulu." : ""));
    } finally {
      setLoading(false);
    }
  }

  const periodOptions = useMemo(() => {
    const set = new Set([nowPeriode(), period]);
    sopRecords.forEach((r) => set.add(r.period));
    rankingRows.forEach((r) => set.add(r.periode));
    return [...set].filter(Boolean).sort().reverse();
  }, [sopRecords, rankingRows, period]);

  const rows = useMemo(() => {
    const list = branches.map((b) => {
      const latestSop = sopRecords.find((r) => r.branch_id === b.id && r.period === period);
      const sop = latestSop ? calcWeightedFromRecord(latestSop.data) : 0;
      const rk = rankingRows.find((r) => r.branch_id === b.id && r.periode === period) || {};
      const tg = targetRows.find((r) => r.branch_id === b.id && r.periode === period);
      const target = tg?.target_amount || 0;
      const sales = rk.sales_actual || 0;
      const ach = sales && target ? Math.min(Math.round((sales / target) * 100), 150) : 0;
      const cx = rk.cx_score || 0;
      const hi = rk.hi_score || 0;
      const total = calcRank(sop, ach, cx, hi);
      const hasData = !!(latestSop || sales);
      return { branch: b, sop, ach, sales, target, cx, hi, total, hasData };
    });
    return list.sort((a, b) => b.total - a.total);
  }, [branches, sopRecords, rankingRows, targetRows, period]);

  function openScoreModal() {
    setScoreForm({ branch_id: branches[0]?.id || "", sales_actual: "", cx_score: "", hi_score: "" });
    setShowScoreModal(true);
  }

  function branchIdChange(id) {
    const rk = rankingRows.find((r) => r.branch_id === +id && r.periode === period);
    setScoreForm({
      branch_id: id,
      sales_actual: rk?.sales_actual || "",
      cx_score: rk?.cx_score || "",
      hi_score: rk?.hi_score || "",
    });
  }

  async function saveScore() {
    if (!scoreForm.branch_id) return;
    setSaving(true);
    setError(null);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      const payload = {
        periode: period,
        branch_id: +scoreForm.branch_id,
        sales_actual: parseFloat(scoreForm.sales_actual) || 0,
        cx_score: parseFloat(scoreForm.cx_score) || 0,
        hi_score: parseFloat(scoreForm.hi_score) || 0,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      };
      const { error: err } = await supabase.from("ranking_scores").upsert(payload, { onConflict: "periode,branch_id" });
      if (err) throw err;
      await loadAll();
      setShowScoreModal(false);
    } catch (err) {
      setError("Gagal menyimpan skor: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  function openTargetModal() {
    const init = {};
    branches.forEach((b) => {
      const tg = targetRows.find((r) => r.branch_id === b.id && r.periode === period);
      init[b.id] = tg?.target_amount || "";
    });
    setTargetForm(init);
    setShowTargetModal(true);
  }

  async function saveTargets() {
    setSaving(true);
    setError(null);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      const payload = branches
        .map((b) => ({
          periode: period,
          branch_id: b.id,
          target_amount: parseFloat(targetForm[b.id]) || 0,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        }))
        .filter((r) => r.target_amount > 0);
      if (payload.length) {
        const { error: err } = await supabase.from("sales_targets").upsert(payload, { onConflict: "periode,branch_id" });
        if (err) throw err;
      }
      await loadAll();
      setShowTargetModal(false);
    } catch (err) {
      setError("Gagal menyimpan target: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div style={{ padding: 40, color: "var(--text-secondary)" }}>Memuat\u2026</div>;

  return (
    <div style={{ flex: 1 }}>
      <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Ranking Cabang</div>
          <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>
            Sales {RANKING_BOBOT.sales}% &middot; SOP {RANKING_BOBOT.sop}% &middot; Customer Experience {RANKING_BOBOT.cx}% &middot; Happiness Index {RANKING_BOBOT.hi}%
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <select className="input" style={{ width: 180 }} value={period} onChange={(e) => setPeriod(e.target.value)}>
            {periodOptions.map((p) => <option key={p} value={p}>{periodeLabel(p)}</option>)}
          </select>
          {canEdit && (
            <>
              <button className="btn-ghost" onClick={openTargetModal}>Set Target</button>
              <button className="btn" onClick={openScoreModal}>Input Skor</button>
            </>
          )}
        </div>
      </div>

      {error && <div style={{ margin: "14px 28px 0", background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}

      <div style={{ padding: 24 }}>
        {!rows.some((r) => r.hasData) ? (
          <div style={{ textAlign: "center", color: "var(--text-faint)", padding: 60 }}>
            Belum ada data periode ini.<br />Lakukan audit SOP dan input skor Sales/CX/HI via tombol di atas.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {rows.map((r, i) => (
              <RankCard key={r.branch.id} row={r} rank={i + 1} />
            ))}
          </div>
        )}
      </div>

      {showScoreModal && (
        <Modal onClose={() => setShowScoreModal(false)} title="Input Skor Cabang">
          <Field label="Cabang">
            <select className="input" value={scoreForm.branch_id} onChange={(e) => branchIdChange(e.target.value)}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Penjualan aktual (Rp)">
            <input className="input" type="number" value={scoreForm.sales_actual} onChange={(e) => setScoreForm({ ...scoreForm, sales_actual: e.target.value })} />
          </Field>
          <Field label="Skor Customer Experience (0-100)">
            <input className="input" type="number" min="0" max="100" value={scoreForm.cx_score} onChange={(e) => setScoreForm({ ...scoreForm, cx_score: e.target.value })} />
          </Field>
          <Field label="Skor Happiness Index (0-100)">
            <input className="input" type="number" min="0" max="100" value={scoreForm.hi_score} onChange={(e) => setScoreForm({ ...scoreForm, hi_score: e.target.value })} />
          </Field>
          <ModalActions onCancel={() => setShowScoreModal(false)} onSave={saveScore} saving={saving} />
        </Modal>
      )}

      {showTargetModal && (
        <Modal onClose={() => setShowTargetModal(false)} title={`Target Penjualan \u2014 ${periodeLabel(period)}`}>
          <div style={{ maxHeight: 320, overflowY: "auto", marginBottom: 14 }}>
            {branches.map((b) => (
              <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ width: 130, fontSize: 12.5, fontWeight: 600 }}>{b.name}</div>
                <input
                  className="input"
                  type="number"
                  placeholder="Rp target"
                  value={targetForm[b.id] || ""}
                  onChange={(e) => setTargetForm({ ...targetForm, [b.id]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <ModalActions onCancel={() => setShowTargetModal(false)} onSave={saveTargets} saving={saving} />
        </Modal>
      )}
    </div>
  );
}

function RankCard({ row, rank }) {
  const medalColor = rank === 1 ? "#F4B740" : rank === 2 ? "#B8C0CC" : rank === 3 ? "#C0813E" : "var(--text-faint)";
  const achColor = row.ach >= 100 ? "#1a9e6e" : row.ach >= 80 ? "#b07212" : "#a32020";
  return (
    <div style={{ position: "relative", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18, overflow: "hidden" }}>
      {rank <= 3 ? (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${medalColor}, transparent)` }} />
      ) : !row.hasData ? (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, #7c3aed, #F4B740)" }} />
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
        <div style={{ width: 34, height: 34, borderRadius: "50%", background: medalColor, color: "#1A1024", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, flexShrink: 0 }}>
          #{rank}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{row.branch.name}</div>
          <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{row.hasData ? "Data tersedia" : "Belum ada data"}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: rank === 1 ? "#b07212" : "var(--text-primary)" }}>{row.total.toFixed(1)}</div>
          <div style={{ fontSize: 9.5, color: "var(--text-faint)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Total Score</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <BarRow label={`Sales Ach. (${RANKING_BOBOT.sales}%)`} value={row.ach} display={row.ach ? row.ach + "%" : "\u2014"} color={achColor} />
        <BarRow label={`SOP Audit (${RANKING_BOBOT.sop}%)`} value={row.sop} display={row.sop || "\u2014"} color="#7c3aed" />
        <BarRow label={`Cust. Exp. (${RANKING_BOBOT.cx}%)`} value={row.cx} display={row.cx || "\u2014"} color="#9e1d5e" />
        <BarRow label={`Happiness (${RANKING_BOBOT.hi}%)`} value={row.hi} display={row.hi || "\u2014"} color="#1a9e6e" />
        {(row.target > 0 || row.sales > 0) && (
          <div style={{ display: "flex", gap: 14, marginTop: 4, paddingTop: 8, borderTop: "1px solid var(--border)", fontSize: 11.5, color: "var(--text-faint)" }}>
            {row.target > 0 && <div>Target: <span style={{ color: "var(--text-secondary)" }}>{formatRupiah(row.target)}</span></div>}
            {row.sales > 0 && <div>Aktual: <span style={{ color: "var(--text-secondary)" }}>{formatRupiah(row.sales)}</span></div>}
          </div>
        )}
      </div>
    </div>
  );
}

function BarRow({ label, value, display, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11.5 }}>
      <div style={{ width: 110, color: "var(--text-secondary)" }}>{label}</div>
      <div style={{ flex: 1, height: 6, background: "var(--bg-page)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min(value, 100)}%`, background: color }} />
      </div>
      <div style={{ width: 40, textAlign: "right", fontWeight: 700, color }}>{display}</div>
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--overlay)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={onClose}>
      <div style={{ background: "var(--surface)", borderRadius: 14, padding: 24, width: 380, maxWidth: "90%" }} onClick={(e) => e.stopPropagation()}>
        <div className="display" style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}

function ModalActions({ onCancel, onSave, saving }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
      <button className="btn-ghost" onClick={onCancel}>Batal</button>
      <button className="btn" disabled={saving} onClick={onSave}>{saving ? "Menyimpan\u2026" : "Simpan"}</button>
    </div>
  );
}
