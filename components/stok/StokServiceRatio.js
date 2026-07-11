import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabaseClient";
import {
  calcServiceRatio, serviceStatusInfo, formatRatioPct,
  periodFromDate, todayInputValue, periodeLabel, SERVICE_THRESHOLDS,
} from "../../lib/stokConfig";

const EMPTY_FORM = { laptop: "", aksesoris: "", user: "", stok_service: "", total_unit_cabang: "" };

export default function StokServiceRatio({ profile }) {
  const [branches, setBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(true);
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
      if (data.data?.audit_date) setAuditDate(data.data.audit_date);
    } else {
      setExistingRow(null);
      setForm(EMPTY_FORM);
    }
    setLoadingRecord(false);
  }

  function backToList() {
    setSelectedBranch(null);
    setExistingRow(null);
  }

  function setField(key, val) {
    const digits = val.replace(/[^\d]/g, "");
    setForm((f) => ({ ...f, [key]: digits }));
    setSaved(false);
  }

  const ratio = calcServiceRatio(form.stok_service, form.total_unit_cabang);
  const status = serviceStatusInfo(ratio);
  const period = periodFromDate(auditDate);

  async function saveRecord() {
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
    return (
      <div style={{ flex: 1 }}>
        <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)" }}>
          <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Service Ratio</div>
          <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>Rasio unit service dibanding total unit per cabang, per bulan</div>
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
            <button className="btn" disabled={saving} onClick={saveRecord} style={{ alignSelf: "flex-end" }}>
              {saving ? "Menyimpan\u2026" : saved ? "\u2713 Tersimpan" : "Simpan"}
            </button>
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
                  <input className="input" type="text" inputMode="numeric" placeholder="0" value={form.laptop} onChange={(e) => setField("laptop", e.target.value)} />
                </Field>
                <Field label="Unit Aksesoris diservice">
                  <input className="input" type="text" inputMode="numeric" placeholder="0" value={form.aksesoris} onChange={(e) => setField("aksesoris", e.target.value)} />
                </Field>
                <Field label="User Service">
                  <input className="input" type="text" inputMode="numeric" placeholder="0" value={form.user} onChange={(e) => setField("user", e.target.value)} />
                </Field>
                <Field label="Stok Service">
                  <input className="input" type="text" inputMode="numeric" placeholder="0" value={form.stok_service} onChange={(e) => setField("stok_service", e.target.value)} />
                </Field>
                <Field label="Total Unit / Cabang">
                  <input className="input" type="text" inputMode="numeric" placeholder="0" value={form.total_unit_cabang} onChange={(e) => setField("total_unit_cabang", e.target.value)} />
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
