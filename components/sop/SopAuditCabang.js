import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabaseClient";
import {
  CATS, TOTAL_ITEMS, TIER_WEIGHTS, TIER1_CATS, TIER3_CATS, ALERT_THRESHOLD,
  calcWeightedScore, scoreColor, periodFromDate, todayInputValue, periodeLabel,
} from "../../lib/sopConfig";

function emptyChecklist() {
  const state = {};
  CATS.forEach((c) => c.items.forEach((_, i) => { state[c.id + "_" + i] = false; }));
  return state;
}

export default function SopAuditCabang({ profile }) {
  const [branches, setBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [selectedBranch, setSelectedBranch] = useState(null); // objek branch
  const [existingRow, setExistingRow] = useState(null); // record audit_generic kalau sudah ada utk periode ini
  const [checklist, setChecklist] = useState(emptyChecklist());
  const [notes, setNotes] = useState({});
  const [openCats, setOpenCats] = useState({});
  const [auditDate, setAuditDate] = useState(todayInputValue());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [loadingRecord, setLoadingRecord] = useState(false);

  useEffect(() => { loadBranches(); }, []);

  async function loadBranches() {
    setLoadingBranches(true);
    const { data, error: err } = await supabase.from("branches").select("*").order("name");
    if (!err) setBranches(data || []);
    setLoadingBranches(false);
  }

  async function pickBranch(b) {
    setSelectedBranch(b);
    setSaved(false);
    setError(null);
    setLoadingRecord(true);
    const period = periodFromDate(auditDate);
    const { data, error: err } = await supabase
      .from("audit_generic")
      .select("*")
      .eq("module", "sop")
      .eq("branch_id", b.id)
      .eq("period", period)
      .maybeSingle();
    if (!err && data) {
      setExistingRow(data);
      setChecklist({ ...emptyChecklist(), ...(data.data?.checks || {}) });
      setNotes(data.data?.notes || {});
      if (data.data?.audit_date) setAuditDate(data.data.audit_date);
    } else {
      setExistingRow(null);
      setChecklist(emptyChecklist());
      setNotes({});
    }
    setLoadingRecord(false);
  }

  function backToList() {
    setSelectedBranch(null);
    setExistingRow(null);
  }

  function toggleItem(catId, idx) {
    const id = catId + "_" + idx;
    setChecklist((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      if (next[id]) setNotes((n) => ({ ...n, [id]: "" }));
      return next;
    });
    setSaved(false);
  }

  function setNote(id, val) {
    setNotes((prev) => ({ ...prev, [id]: val }));
    setSaved(false);
  }

  function catScore(catId) {
    const cat = CATS.find((c) => c.id === catId);
    return cat.items.filter((_, i) => checklist[catId + "_" + i]).length;
  }

  const totalDone = useMemo(() => CATS.reduce((s, c) => s + catScore(c.id), 0), [checklist]);
  const weightedPct = useMemo(() => calcWeightedScore(checklist), [checklist]);
  const period = periodFromDate(auditDate);

  async function saveAudit() {
    if (!auditDate) { setError("Tanggal audit wajib diisi."); return; }
    setSaving(true);
    setError(null);
    try {
      const cats = {};
      CATS.forEach((c) => { cats[c.id] = { score: catScore(c.id), total: c.items.length }; });
      const cleanNotes = {};
      Object.keys(notes).forEach((k) => { if (notes[k] && notes[k].trim()) cleanNotes[k] = notes[k].trim(); });

      const user = (await supabase.auth.getUser()).data.user;
      const payload = {
        module: "sop",
        branch_id: selectedBranch.id,
        period,
        status: "submitted",
        submitted_by: user.id,
        data: {
          audit_date: auditDate,
          cats,
          checks: checklist,
          notes: cleanNotes,
          done: totalDone,
          score: weightedPct,
          auditor_name: profile?.full_name || null,
        },
      };

      const { data, error: err } = await supabase
        .from("audit_generic")
        .upsert(payload, { onConflict: "module,branch_id,period" })
        .select()
        .single();
      if (err) throw err;
      setExistingRow(data);
      setSaved(true);
    } catch (err) {
      setError("Gagal menyimpan: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Tampilan: pilih cabang ──
  if (!selectedBranch) {
    return (
      <div style={{ flex: 1 }}>
        <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)" }}>
          <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Audit Cabang</div>
          <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>Pilih cabang untuk mulai atau lanjutkan checklist audit SOP</div>
        </div>
        <div style={{ padding: 24 }}>
          {loadingBranches ? (
            <div style={{ color: "var(--text-secondary)" }}>Memuat cabang\u2026</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
              {branches.map((b) => (
                <div
                  key={b.id}
                  onClick={() => pickBranch(b)}
                  style={{ position: "relative", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", cursor: "pointer", fontWeight: 600, fontSize: 14.5, overflow: "hidden" }}
                >
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, #7c3aed, #F4B740)" }} />
                  {b.name}
                  <div style={{ fontSize: 11.5, fontWeight: 400, color: "var(--text-faint)", marginTop: 4 }}>Mulai audit &rarr;</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Tampilan: form checklist ──
  return (
    <div style={{ flex: 1 }}>
      <div style={{ background: "var(--surface)", padding: "16px 28px", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
          <div>
            <button className="btn-ghost" style={{ marginBottom: 8, fontSize: 12.5 }} onClick={backToList}>&larr; Pilih cabang lain</button>
            <div className="display" style={{ fontSize: 19, fontWeight: 600 }}>Audit &mdash; {selectedBranch.name}</div>
            <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
              Periode: {periodeLabel(period)} {existingRow && <span style={{ color: "var(--text-faint)" }}>&middot; audit sudah pernah diisi, kamu mengedit data yang ada</span>}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div>
              <label style={{ display: "block", fontSize: 11, color: "var(--text-secondary)", marginBottom: 3 }}>Tanggal audit</label>
              <input className="input" type="date" value={auditDate} onChange={(e) => { setAuditDate(e.target.value); setSaved(false); }} />
            </div>
            <button className="btn" disabled={saving} onClick={saveAudit} style={{ alignSelf: "flex-end" }}>
              {saving ? "Menyimpan\u2026" : saved ? "\u2713 Tersimpan" : "Simpan Hasil Audit"}
            </button>
          </div>
        </div>

        {/* Skor live */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: scoreColor(weightedPct) }}>{weightedPct}%</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 4 }}>{totalDone} dari {TOTAL_ITEMS} poin terpenuhi (skor tertimbang)</div>
            <div style={{ height: 6, background: "var(--bg-page)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${weightedPct}%`, background: scoreColor(weightedPct), transition: "width .2s" }} />
            </div>
          </div>
          {weightedPct < ALERT_THRESHOLD && (
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--danger-text)", background: "var(--danger-bg)", padding: "4px 10px", borderRadius: 20 }}>DI BAWAH TARGET</span>
          )}
        </div>
      </div>

      {error && <div style={{ margin: "14px 28px 0", background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}

      <div style={{ padding: 24 }}>
        {loadingRecord ? (
          <div style={{ color: "var(--text-secondary)" }}>Memuat data audit\u2026</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {CATS.map((c) => {
              const done = catScore(c.id);
              const isOpen = openCats[c.id] ?? true;
              const w = TIER_WEIGHTS[c.id];
              const tierTag = TIER3_CATS.includes(c.id) ? "T3" : TIER1_CATS.includes(c.id) ? "T1" : "T2";
              return (
                <div key={c.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
                  <div
                    onClick={() => setOpenCats((p) => ({ ...p, [c.id]: !isOpen }))}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 16px", cursor: "pointer" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: 9, height: 9, borderRadius: "50%", background: c.color, flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{c.label}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-faint)", border: "1px solid var(--border)", borderRadius: 5, padding: "1px 6px" }}>{tierTag} &middot; {Math.round(w * 100)}%</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: done === c.items.length ? "#1a9e6e" : "var(--text-secondary)" }}>{done}/{c.items.length}</span>
                      <span style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .15s", fontSize: 11, color: "var(--text-faint)" }}>&#9660;</span>
                    </div>
                  </div>

                  {isOpen && (
                    <div style={{ borderTop: "1px solid var(--border)" }}>
                      {c.items.map((txt, i) => {
                        const id = c.id + "_" + i;
                        const checked = !!checklist[id];
                        return (
                          <div key={id} style={{ padding: "10px 16px", borderBottom: i < c.items.length - 1 ? "1px solid var(--border)" : "none" }}>
                            <div onClick={() => toggleItem(c.id, i)} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                              <div style={{
                                width: 18, height: 18, borderRadius: 5, flexShrink: 0, marginTop: 1,
                                border: checked ? "none" : "1.5px solid var(--border)",
                                background: checked ? "#1a9e6e" : "transparent",
                                display: "flex", alignItems: "center", justifyContent: "center",
                              }}>
                                {checked && <span style={{ color: "#fff", fontSize: 12, lineHeight: 1 }}>&#10003;</span>}
                              </div>
                              <div style={{ fontSize: 13, color: checked ? "var(--text-faint)" : "var(--text-primary)", textDecoration: checked ? "line-through" : "none" }}>{txt}</div>
                            </div>
                            {!checked && (
                              <textarea
                                className="input"
                                placeholder="Tulis keterangan kondisi yang tidak sesuai..."
                                rows={2}
                                value={notes[id] || ""}
                                onChange={(e) => setNote(id, e.target.value)}
                                style={{ marginTop: 8, marginLeft: 28, width: "calc(100% - 28px)", fontSize: 12.5, resize: "vertical" }}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
