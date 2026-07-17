import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabaseClient";
import {
  skorRugi, calcSkorTemuan, calcSkorTotal, calcKesehatanPct, kesehatanStatusInfo, formatKesehatanPct,
  periodFromDate, todayInputValue, periodeLabel, nowPeriode, addMonthsToPeriod,
} from "../../lib/stokConfig";

const EMPTY_FORM = { temuan_count: "", bonus_count: "", untung_rugi: "", tidak_visit: false };

export default function StokKesehatan({ profile }) {
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
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const isSuperAdmin = profile?.role === "super_admin";

  useEffect(() => { loadBranches(); }, []);

  async function loadBranches() {
    setLoadingBranches(true);
    const { data, error: err } = await supabase.from("branches").select("*").order("name");
    if (!err) setBranches(data || []);
    const { data: recs, error: recErr } = await supabase.from("audit_generic").select("*").eq("module", "stok_kesehatan");
    if (!recErr) setAllRecords(recs || []);
    setLoadingBranches(false);
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/sync-kesehatan-stok", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: viewPeriod, accessToken: session?.access_token, userId: profile?.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Sync gagal.");
      setSyncResult(json);
      await loadBranches();
    } catch (err) {
      setSyncResult({ error: err.message });
    } finally {
      setSyncing(false);
    }
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
      .eq("module", "stok_kesehatan")
      .eq("branch_id", b.id)
      .eq("period", period)
      .maybeSingle();
    if (!err && data) {
      setExistingRow(data);
      setForm({
        temuan_count: data.data?.temuan_count ?? "",
        bonus_count: data.data?.bonus_count ?? "",
        untung_rugi: data.data?.untung_rugi ?? "",
        tidak_visit: !!data.data?.tidak_visit,
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

  function setDigitField(key, val) {
    const digits = val.replace(/[^\d]/g, "");
    setForm((f) => ({ ...f, [key]: digits }));
    setSaved(false);
  }

  function setRugiField(val) {
    const cleaned = val.replace(/[^\d-]/g, "").replace(/(?!^)-/g, "");
    setForm((f) => ({ ...f, untung_rugi: cleaned }));
    setSaved(false);
  }

  const skorTemuan = calcSkorTemuan(form.temuan_count, form.bonus_count);
  const sRugi = skorRugi(form.untung_rugi);
  const skorTotal = calcSkorTotal(skorTemuan, sRugi);
  const kesehatanPct = calcKesehatanPct(skorTotal);
  const status = kesehatanStatusInfo(kesehatanPct);
  const period = periodFromDate(auditDate);

  async function saveRecord() {
    if (!auditDate) { setError("Tanggal audit wajib diisi."); return; }
    setSaving(true);
    setError(null);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      const payload = {
        module: "stok_kesehatan",
        branch_id: selectedBranch.id,
        period,
        status: "submitted",
        submitted_by: user.id,
        data: form.tidak_visit
          ? { audit_date: auditDate, tidak_visit: true, auditor_name: profile?.full_name || null }
          : {
              audit_date: auditDate,
              tidak_visit: false,
              temuan_count: parseInt(form.temuan_count, 10) || 0,
              bonus_count: parseInt(form.bonus_count, 10) || 0,
              untung_rugi: parseInt(form.untung_rugi, 10) || 0,
              skor_temuan: skorTemuan,
              skor_rugi: sRugi,
              skor_total: skorTotal,
              kesehatan_pct: kesehatanPct,
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
            <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Kesehatan Stok</div>
            <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>Skor temuan barang & kerugian per cabang, per bulan</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 8, padding: "4px 6px" }}>
              <button className="btn-ghost" onClick={() => setViewPeriod(addMonthsToPeriod(viewPeriod, -1))} style={{ padding: "6px 10px" }}>{"<"}</button>
              <div className="mono" style={{ fontWeight: 600, minWidth: 130, textAlign: "center", fontSize: 13.5 }}>{periodeLabel(viewPeriod)}</div>
              <button className="btn-ghost" onClick={() => setViewPeriod(addMonthsToPeriod(viewPeriod, 1))} style={{ padding: "6px 10px" }}>{">"}</button>
            </div>
            {isSuperAdmin && (
              <button className="btn" disabled={syncing} onClick={handleSync}>{syncing ? "Sync\u2026" : "Sync dari Google Sheet"}</button>
            )}
          </div>
        </div>
        {syncResult && (
          <div style={{ margin: "14px 28px 0", background: syncResult.error ? "var(--danger-bg)" : "var(--success-bg)", border: `1px solid ${syncResult.error ? "rgba(248,113,113,0.35)" : "rgba(26,158,110,0.35)"}`, color: syncResult.error ? "var(--danger-text)" : "var(--success-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>
            {syncResult.error ? `Gagal sync: ${syncResult.error}` : `Sync selesai: ${syncResult.totalSynced} data tersimpan, ${syncResult.totalSkipped} dilewati.`}
            {syncResult.logs?.length > 0 && (
              <details style={{ marginTop: 6 }}>
                <summary style={{ cursor: "pointer" }}>Lihat detail ({syncResult.logs.length})</summary>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{syncResult.logs.map((l, i) => <li key={i}>{l}</li>)}</ul>
              </details>
            )}
          </div>
        )}
        <div style={{ padding: 24 }}>
          {(() => {
            const rows = branches.map((b) => rowsByBranch[b.id]).filter((r) => r && !r.data.tidak_visit);
            const auditedCount = rows.length;
            const avgPct = auditedCount ? rows.reduce((s, r) => s + (r.data.kesehatan_pct || 0), 0) / auditedCount : null;
            const alertCount = rows.filter((r) => kesehatanStatusInfo(r.data.kesehatan_pct || 0).lbl === "Perlu Perhatian").length;
            return (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 20 }}>
                <SummaryCard label="Cabang sudah diaudit" value={`${auditedCount} / ${branches.length}`} />
                <SummaryCard label="Rata-rata Kesehatan" value={avgPct !== null ? formatKesehatanPct(avgPct) : "\u2014"} />
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
                const tidakVisit = row?.data?.tidak_visit;
                const pct = row && !tidakVisit ? row.data.kesehatan_pct || 0 : null;
                const rStatus = pct !== null ? kesehatanStatusInfo(pct) : null;
                return (
                  <div
                    key={b.id}
                    onClick={() => pickBranch(b)}
                    style={{ position: "relative", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", cursor: "pointer", overflow: "hidden" }}
                  >
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: row ? (tidakVisit ? "#888" : rStatus.color) : "linear-gradient(90deg, #7c3aed, #F4B740)" }} />
                    <div style={{ fontWeight: 600, fontSize: 14.5, marginBottom: row ? 8 : 4 }}>{b.name}</div>
                    {row ? (
                      tidakVisit ? (
                        <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, background: "#88888822", color: "#888", fontSize: 11, fontWeight: 600 }}>Tidak Visit</span>
                      ) : (
                        <>
                          <div style={{ fontSize: 22, fontWeight: 800, color: rStatus.color }}>{formatKesehatanPct(pct)}</div>
                          <span style={{ display: "inline-block", marginTop: 6, padding: "3px 10px", borderRadius: 20, background: `${rStatus.color}22`, color: rStatus.color, fontSize: 11, fontWeight: 600 }}>{rStatus.lbl}</span>
                        </>
                      )
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
            <div className="display" style={{ fontSize: 19, fontWeight: 600 }}>Kesehatan Stok &mdash; {selectedBranch.name}</div>
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
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, cursor: "pointer", fontSize: 13, color: "var(--text-secondary)" }}>
              <input type="checkbox" checked={form.tidak_visit} onChange={(e) => { setForm((f) => ({ ...f, tidak_visit: e.target.checked })); setSaved(false); }} />
              Cabang ini tidak dikunjungi bulan ini (Tidak Visit)
            </label>

            {!form.tidak_visit && (
              <>
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, marginBottom: 16 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 4 }}>
                    <Field label="Total Barang Plus Minus / Tertukar" hint="jumlah kejadian, bukan qty">
                      <input className="input" type="text" inputMode="numeric" placeholder="0" value={form.temuan_count} onChange={(e) => setDigitField("temuan_count", e.target.value)} />
                    </Field>
                    <Field label="Total Bonus Fisik Tidak Ada" hint="jumlah kejadian, bukan qty">
                      <input className="input" type="text" inputMode="numeric" placeholder="0" value={form.bonus_count} onChange={(e) => setDigitField("bonus_count", e.target.value)} />
                    </Field>
                  </div>
                  <Field label="Untung / Rugi (Rp)" hint="isi minus (-) kalau rugi, misal -150000">
                    <input className="input" type="text" inputMode="numeric" placeholder="0" value={form.untung_rugi} onChange={(e) => setRugiField(e.target.value)} />
                  </Field>
                  <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 10 }}>
                    Skor Temuan = jumlah 2 kejadian di atas. Skor Rugi 0&ndash;4 tergantung nominal kerugian. Skor Total = Skor Temuan + (Skor Rugi &times; 5).
                  </div>
                </div>

                <div style={{ background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12, fontSize: 11.5 }}>
                    <MiniStat label="Skor Temuan" value={skorTemuan} />
                    <MiniStat label="Skor Rugi" value={sRugi} />
                    <MiniStat label="Skor Total" value={skorTotal} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>% Kesehatan Barang</span>
                    <span style={{ fontSize: 24, fontWeight: 800, color: status.color }}>{formatKesehatanPct(kesehatanPct)}</span>
                  </div>
                  <div style={{ height: 6, background: "var(--border)", borderRadius: 4, overflow: "hidden", marginBottom: 12 }}>
                    <div style={{ height: "100%", width: `${kesehatanPct * 100}%`, background: status.color, transition: "width .2s" }} />
                  </div>
                  <div style={{ background: `${status.color}22`, borderRadius: 8, padding: "9px 12px" }}>
                    <div style={{ fontWeight: 700, color: status.color, marginBottom: 2 }}>{status.lbl}</div>
                    <div style={{ fontSize: 12, color: status.color }}>{status.desc}</div>
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 10 }}>
                    Ambang: \u226585% Terkendali &middot; 70&ndash;84% Waspada &middot; 50&ndash;69% Monitoring &middot; &lt;50% Perlu Perhatian
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 4 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
      <div style={{ color: "var(--text-faint)", marginBottom: 2 }}>{label}</div>
      <div className="mono" style={{ fontWeight: 700, fontSize: 14 }}>{value}</div>
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
