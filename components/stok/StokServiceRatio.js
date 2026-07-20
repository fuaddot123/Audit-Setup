import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabaseClient";
import {
  calcServiceRatio, serviceStatusInfo, formatRatioPct,
  periodFromDate, todayInputValue, periodeLabel, SERVICE_THRESHOLDS,
  nowPeriode, addMonthsToPeriod,
} from "../../lib/stokConfig";

const EMPTY_FORM = { laptop: "", aksesoris: "", user: "", stok_service: "", total_unit_cabang: "" };

export default function StokServiceRatio({ profile }) {
  const canEdit = profile?.role === "auditor" || profile?.role === "super_admin";
  const [branches, setBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [allRecords, setAllRecords] = useState([]);
  const [viewPeriod, setViewPeriod] = useState(nowPeriode());
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [existingRow, setExistingRow] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
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
    const { data: recs, error: recErr } = await supabase.from("audit_generic").select("*").eq("module", "stok_service");
    if (!recErr) setAllRecords(recs || []);
    setLoadingBranches(false);
  }

  async function pickBranch(b) {
    setSelectedBranch(b);
    setSaved(false);
    setError(null);
    setLoadingRecord(true);
    const period = viewPeriod;
    const { data, error: err } = await supabase
      .from("audit_generic")
      .select("*")
      .eq("module", "stok_service")
      .eq("branch_id", b.id)
      .eq("period", period)
      .maybeSingle();
    if (!err && data) {
      setExistingRow(data);
      setForm({
        laptop: data.data?.laptop ?? "",
        aksesoris: data.data?.aksesoris ?? "",
        user: data.data?.user ?? "",
        stok_service: data.data?.stok_service ?? "",
        total_unit_cabang: data.data?.total_unit_cabang ?? "",
      });
      setAuditDate(data.data?.audit_date || (period === nowPeriode() ? todayInputValue() : period + "-01"));
    } else {
      setExistingRow(null);
      setForm(EMPTY_FORM);
      setAuditDate(period === nowPeriode() ? todayInputValue() : period + "-01");
    }
    setLoadingRecord(false);
  }

  function backToList() {
    setSelectedBranch(null);
    setExistingRow(null);
    loadBranches();
  }

  function setField(key, val) {
    const digits = val.replace(/[^\d]/g, "");
    setForm((f) => ({ ...f, [key]: digits }));
    setSaved(false);
  }

  const ratio = calcServiceRatio(form.stok_service, form.total_unit_cabang);
  const status = serviceStatusInfo(ratio);
  const period = periodFromDate(auditDate);

  async function deleteRecord() {
    if (!existingRow || profile?.role !== "super_admin") return;
    if (!window.confirm(`Hapus data Service Ratio ${selectedBranch.name} periode ${periodeLabel(period)}? Aksi ini tidak bisa dibatalkan.`)) return;
    setSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase.from("audit_generic").delete().eq("id", existingRow.id);
      if (err) throw err;
      setExistingRow(null);
      setForm(EMPTY_FORM);
      setSaved(false);
    } catch (err) {
      setError("Gagal menghapus: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveRecord() {
    if (!canEdit) { setError("Kamu tidak punya izin untuk menyimpan."); return; }
    if (!auditDate) { setError("Tanggal audit wajib diisi."); return; }
    setSaving(true);
    setError(null);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      const payload = {
        module: "stok_service",
        branch_id: selectedBranch.id,
        period,
        status: "submitted",
        submitted_by: user.id,
        data: {
          audit_date: auditDate,
          laptop: parseInt(form.laptop, 10) || 0,
          aksesoris: parseInt(form.aksesoris, 10) || 0,
          user: parseInt(form.user, 10) || 0,
          stok_service: parseInt(form.stok_service, 10) || 0,
          total_unit_cabang: parseInt(form.total_unit_cabang, 10) || 0,
          ratio,
          indikator: status.lbl,
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
    const rowsByBranch = {};
    allRecords.filter((r) => r.period === viewPeriod).forEach((r) => {
      if (!rowsByBranch[r.branch_id]) rowsByBranch[r.branch_id] = r;
    });

    return (
      <div style={{ flex: 1 }}>
        <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Service Ratio</div>
            <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>Rasio unit service dibanding total unit per cabang, per bulan</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 8, padding: "4px 6px" }}>
            <button className="btn-ghost" onClick={() => setViewPeriod(addMonthsToPeriod(viewPeriod, -1))} style={{ padding: "6px 10px" }}>{"<"}</button>
            <div className="mono" style={{ fontWeight: 600, minWidth: 130, textAlign: "center", fontSize: 13.5 }}>{periodeLabel(viewPeriod)}</div>
            <button className="btn-ghost" onClick={() => setViewPeriod(addMonthsToPeriod(viewPeriod, 1))} style={{ padding: "6px 10px" }}>{">"}</button>
          </div>
        </div>
        <div style={{ padding: 24 }}>
          {(() => {
            const rows = branches.map((b) => rowsByBranch[b.id]).filter(Boolean);
            const auditedCount = rows.length;
            const avgRatio = auditedCount ? rows.reduce((s, r) => s + (r.data.ratio || 0), 0) / auditedCount : null;
            const alertCount = rows.filter((r) => serviceStatusInfo(r.data.ratio || 0).lbl === "Perlu Perhatian").length;
            return (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 20 }}>
                <SummaryCard label="Cabang sudah diaudit" value={`${auditedCount} / ${branches.length}`} />
                <SummaryCard label="Rata-rata Ratio" value={avgRatio !== null ? formatRatioPct(avgRatio) : "\u2014"} />
                <SummaryCard label="Perlu Perhatian (alert)" value={alertCount} color={alertCount > 0 ? "var(--danger-text)" : "#1a9e6e"} />
              </div>
            );
          })()}
          {loadingBranches ? (
            <div style={{ color: "var(--text-secondary)" }}>Memuat cabang\u2026</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 12 }}>
              {branches.map((b) => {
                const row = rowsByBranch[b.id];
                const rRatio = row ? row.data.ratio || 0 : null;
                const rStatus = row ? serviceStatusInfo(rRatio) : null;
                return (
                  <div
                    key={b.id}
                    onClick={() => pickBranch(b)}
                    style={{ position: "relative", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", cursor: "pointer", overflow: "hidden" }}
                  >
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: row ? rStatus.color : "linear-gradient(90deg, #7c3aed, #F4B740)" }} />
                    <div style={{ fontWeight: 600, fontSize: 14.5, marginBottom: row ? 8 : 4 }}>{b.name}</div>
                    {row ? (
                      <>
                        <div style={{ fontSize: 22, fontWeight: 800, color: rStatus.color }}>{formatRatioPct(rRatio)}</div>
                        <span style={{ display: "inline-block", marginTop: 6, padding: "3px 10px", borderRadius: 20, background: `${rStatus.color}22`, color: rStatus.color, fontSize: 11, fontWeight: 600 }}>{rStatus.lbl}</span>
                      </>
                    ) : (
                      <div style={{ fontSize: 11.5, fontWeight: 400, color: "var(--text-faint)" }}>Belum ada audit &middot; Mulai &rarr;</div>
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

  // ── Tampilan: form input ──
  return (
    <div style={{ flex: 1 }}>
      <div style={{ background: "var(--surface)", padding: "16px 28px", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <button className="btn-ghost" style={{ marginBottom: 8, fontSize: 12.5 }} onClick={backToList}>&larr; Pilih cabang lain</button>
            <div className="display" style={{ fontSize: 19, fontWeight: 600 }}>Service Ratio &mdash; {selectedBranch.name}</div>
            <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
              Periode: {periodeLabel(period)} {existingRow && <span style={{ color: "var(--text-faint)" }}>&middot; sudah pernah diisi, kamu mengedit data yang ada</span>}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div>
              <label style={{ display: "block", fontSize: 11, color: "var(--text-secondary)", marginBottom: 3 }}>Tanggal audit</label>
              <input className="input" type="date" value={auditDate} onChange={(e) => { setAuditDate(e.target.value); setSaved(false); }} />
            </div>
            <button className="btn" disabled={saving || !canEdit} onClick={saveRecord} style={{ alignSelf: "flex-end" }} title={!canEdit ? "Kamu tidak punya izin mengedit" : undefined}>
              {saving ? "Menyimpan\u2026" : saved ? "\u2713 Tersimpan" : canEdit ? "Simpan" : "Hanya Lihat"}
            </button>
            {profile?.role === "super_admin" && existingRow && (
              <button className="btn-ghost" disabled={saving} onClick={deleteRecord} style={{ alignSelf: "flex-end", color: "var(--danger-text)" }}>
                Hapus Data
              </button>
            )}
          </div>
        </div>
      </div>

      {error && <div style={{ margin: "14px 28px 0", background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}

      <div style={{ padding: 24, maxWidth: 560 }}>
        {loadingRecord ? (
          <div style={{ color: "var(--text-secondary)" }}>Memuat data\u2026</div>
        ) : (
          <>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, marginBottom: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 4 }}>
                <Field label="Unit Laptop diservice">
                  <input className="input" type="text" inputMode="numeric" placeholder="0" value={form.laptop} onChange={(e) => setField("laptop", e.target.value)} disabled={!canEdit} />
                </Field>
                <Field label="Unit Aksesoris diservice">
                  <input className="input" type="text" inputMode="numeric" placeholder="0" value={form.aksesoris} onChange={(e) => setField("aksesoris", e.target.value)} disabled={!canEdit} />
                </Field>
                <Field label="User Service">
                  <input className="input" type="text" inputMode="numeric" placeholder="0" value={form.user} onChange={(e) => setField("user", e.target.value)} disabled={!canEdit} />
                </Field>
                <Field label="Stok Service">
                  <input className="input" type="text" inputMode="numeric" placeholder="0" value={form.stok_service} onChange={(e) => setField("stok_service", e.target.value)} disabled={!canEdit} />
                </Field>
                <Field label="Total Unit / Cabang">
                  <input className="input" type="text" inputMode="numeric" placeholder="0" value={form.total_unit_cabang} onChange={(e) => setField("total_unit_cabang", e.target.value)} disabled={!canEdit} />
                </Field>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 6 }}>
                Laptop, Aksesoris & User Service buat pencatatan/pemantauan. Yang dipakai buat % Ratio Service cuma <b>Stok Service &divide; Total Unit/Cabang</b>.
              </div>
            </div>

            <div style={{ background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>Stok Service</span>
                <span className="mono" style={{ fontSize: 15, fontWeight: 600 }}>{form.stok_service || 0}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>% Ratio Service</span>
                <span style={{ fontSize: 22, fontWeight: 800, color: status.color }}>{formatRatioPct(ratio)}</span>
              </div>
              <div style={{ height: 6, background: "var(--border)", borderRadius: 4, overflow: "hidden", marginBottom: 12 }}>
                <div style={{ height: "100%", width: `${Math.min((ratio / SERVICE_THRESHOLDS.monitoring) * 100, 100)}%`, background: status.color, transition: "width .2s" }} />
              </div>
              <div style={{ background: `${status.color}22`, borderRadius: 8, padding: "9px 12px" }}>
                <div style={{ fontWeight: 700, color: status.color }}>{status.lbl}</div>
              </div>
              <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 10 }}>
                Ambang: \u2264 0,22% Terkendali &middot; 0,22&ndash;0,33% Monitoring &middot; \u2265 0,33% Perlu Perhatian
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 6 }}>{label}</label>
      {children}
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
