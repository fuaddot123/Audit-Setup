import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabaseClient";
import { sortBranches } from "../../lib/branchOrder";
import {
  skorRugi, calcSkorTemuan, calcSkorTotal, calcKesehatanPct, kesehatanStatusInfo, formatKesehatanPct,
  periodFromDate, todayInputValue, periodeLabel, nowPeriode, addMonthsToPeriod,
} from "../../lib/stokConfig";

const EMPTY_FORM = { temuan_count: "", bonus_count: "", untung_rugi: "", tidak_visit: false, cabang_baru: false };

function shortDate(d) {
  if (!d) return "\u2014";
  return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

export default function StokKesehatan({ profile }) {
  const [branches, setBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [latestByBranchPeriod, setLatestByBranchPeriod] = useState({});
  const [viewPeriod, setViewPeriod] = useState(nowPeriode());
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [entriesThisPeriod, setEntriesThisPeriod] = useState([]);
  const [selectedEntryId, setSelectedEntryId] = useState(null);
  const [fullHistory, setFullHistory] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [auditDate, setAuditDate] = useState(todayInputValue());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const isSuperAdmin = profile?.role === "super_admin";
  // Pengecualian khusus: akun Fuad (fuadmulya123@gmail.com) tetep boleh pake tombol Sync
  // walau rolenya "auditor" biasa, soalnya sheet yang lagi dipake sekarang emang punya dia.
  // Auditor lain (Yuni, dst) tetep nggak boleh, cuma lewat super_admin.
  const FUAD_USER_ID = "61f8e921-ac98-4d74-8dbd-de2d69cff096";
  const canSync = isSuperAdmin || profile?.id === FUAD_USER_ID;
  // Mode "lihat sebagai": seluruh isian dikunci. Pagar sungguhannya ada di
  // RLS — submitted_by wajib sama dengan pengguna yang benar-benar login.
  const canEdit = (profile?.role === "auditor" || profile?.role === "super_admin") && !profile?.liatSebagai;
  // Isolasi per-auditor mulai Agustus 2026 ke depan (Jan-Jul 2026 tetep gabungan semua kayak biasa).
  const ISOLATION_START_PERIOD = "2026-08";

  useEffect(() => { loadBranches(); }, []);

  async function loadBranches() {
    setLoadingBranches(true);
    const { data, error: err } = await supabase.from("branches").select("*").order("name");
    if (!err) setBranches(sortBranches(data || []));
    let recQuery = supabase.from("audit_generic").select("*").eq("module", "stok_kesehatan");
    if (profile?.role === "auditor") {
      recQuery = recQuery.or(`period.lt.${ISOLATION_START_PERIOD},submitted_by.eq.${profile.id}`);
    }
    const { data: recs, error: recErr } = await recQuery;
    if (!recErr) {
      const sorted = [...(recs || [])].sort((a, b) => (b.data?.audit_date || "").localeCompare(a.data?.audit_date || ""));
      const map = {};
      sorted.forEach((r) => {
        const key = `${r.branch_id}|${r.period}`;
        if (!map[key]) map[key] = { entry: r, count: 1 };
        else map[key].count += 1;
      });
      setLatestByBranchPeriod(map);
    } else {
      setError("Gagal memuat data: " + recErr.message);
    }
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

  function applyEntryToForm(entry) {
    setForm({
      temuan_count: entry.data?.temuan_count ?? "",
      bonus_count: entry.data?.bonus_count ?? "",
      untung_rugi: entry.data?.untung_rugi ?? "",
      tidak_visit: !!entry.data?.tidak_visit,
      cabang_baru: !!entry.data?.cabang_baru,
    });
    setAuditDate(entry.data?.audit_date || todayInputValue());
    setSelectedEntryId(entry.id);
  }

  function startNewEntry(period) {
    setForm(EMPTY_FORM);
    setAuditDate(period === nowPeriode() ? todayInputValue() : period + "-01");
    setSelectedEntryId(null);
    setSaved(false);
  }

  async function pickBranch(b) {
    setSelectedBranch(b);
    setSaved(false);
    setError(null);
    setLoadingRecord(true);
    const period = viewPeriod;
    let periodQuery = supabase.from("audit_generic").select("*").eq("module", "stok_kesehatan").eq("branch_id", b.id).eq("period", period);
    if (profile?.role === "auditor" && period >= ISOLATION_START_PERIOD) periodQuery = periodQuery.eq("submitted_by", profile.id);
    let histQuery = supabase.from("audit_generic").select("*").eq("module", "stok_kesehatan").eq("branch_id", b.id);
    if (profile?.role === "auditor") histQuery = histQuery.or(`period.lt.${ISOLATION_START_PERIOD},submitted_by.eq.${profile.id}`);
    const [periodRes, histRes] = await Promise.all([periodQuery, histQuery]);
    if (periodRes.error) setError("Gagal memuat riwayat bulan ini: " + periodRes.error.message);
    if (histRes.error) setError((prev) => prev || "Gagal memuat riwayat: " + histRes.error.message);
    const entries = !periodRes.error
      ? [...(periodRes.data || [])].sort((a, b) => (b.data?.audit_date || "").localeCompare(a.data?.audit_date || ""))
      : [];
    setEntriesThisPeriod(entries);
    if (entries.length) applyEntryToForm(entries[0]);
    else startNewEntry(period);
    const hist = !histRes.error
      ? [...(histRes.data || [])].sort((a, b) => (a.data?.audit_date || "").localeCompare(b.data?.audit_date || ""))
      : [];
    setFullHistory(hist);
    setLoadingRecord(false);
  }

  function backToList() {
    setSelectedBranch(null);
    setEntriesThisPeriod([]);
    setSelectedEntryId(null);
    setFullHistory([]);
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
  const selectedEntry = entriesThisPeriod.find((e) => e.id === selectedEntryId) || null;

  async function deleteRecord() {
    if (!selectedEntry) return;
    const isOwner = profile?.role === "auditor" && selectedEntry.submitted_by === profile?.id;
    if (profile?.role !== "super_admin" && !isOwner) return;
    if (!window.confirm(`Hapus audit ${selectedBranch.name} tanggal ${shortDate(selectedEntry.data?.audit_date)}? Aksi ini tidak bisa dibatalkan.`)) return;
    setSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase.from("audit_generic").delete().eq("id", selectedEntry.id);
      if (err) throw err;
      const remaining = entriesThisPeriod.filter((e) => e.id !== selectedEntry.id);
      setEntriesThisPeriod(remaining);
      setFullHistory((prev) => prev.filter((e) => e.id !== selectedEntry.id));
      if (remaining.length) applyEntryToForm(remaining[0]);
      else startNewEntry(viewPeriod);
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
        module: "stok_kesehatan",
        branch_id: selectedBranch.id,
        period,
        status: "submitted",
        submitted_by: user.id,
        data: form.tidak_visit
          ? { audit_date: auditDate, tidak_visit: true, cabang_baru: form.cabang_baru, auditor_name: profile?.full_name || null }
          : {
              audit_date: auditDate,
              tidak_visit: false,
              cabang_baru: form.cabang_baru,
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
      let saved_;
      if (selectedEntryId) {
        const res = await supabase.from("audit_generic").update(payload).eq("id", selectedEntryId).select().single();
        if (res.error) throw res.error;
        saved_ = res.data;
      } else {
        const res = await supabase.from("audit_generic").insert(payload).select().single();
        if (res.error) throw res.error;
        saved_ = res.data;
      }
      setSelectedEntryId(saved_.id);
      setSaved(true);
      if (period === viewPeriod) {
        setEntriesThisPeriod((prev) => {
          const others = prev.filter((e) => e.id !== saved_.id);
          return [saved_, ...others].sort((a, b) => (b.data?.audit_date || "").localeCompare(a.data?.audit_date || ""));
        });
      }
      setFullHistory((prev) => {
        const others = prev.filter((e) => e.id !== saved_.id);
        return [...others, saved_].sort((a, b) => (a.data?.audit_date || "").localeCompare(b.data?.audit_date || ""));
      });
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
            {canSync && (
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
            const rows = branches.map((b) => latestByBranchPeriod[`${b.id}|${viewPeriod}`]).filter((r) => r && !r.entry.data.tidak_visit);
            const auditedCount = rows.length;
            const avgPct = auditedCount ? rows.reduce((s, r) => s + (r.entry.data.kesehatan_pct || 0), 0) / auditedCount : null;
            const alertCount = rows.filter((r) => kesehatanStatusInfo(r.entry.data.kesehatan_pct || 0).lbl === "Perlu Perhatian").length;
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
                const row = latestByBranchPeriod[`${b.id}|${viewPeriod}`];
                const tidakVisit = row?.entry.data?.tidak_visit;
                const cabangBaru = row?.entry.data?.cabang_baru;
                const pct = row && !tidakVisit ? row.entry.data.kesehatan_pct || 0 : null;
                const rStatus = pct !== null ? kesehatanStatusInfo(pct) : null;
                return (
                  <div
                    key={b.id}
                    onClick={() => pickBranch(b)}
                    style={{ position: "relative", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", cursor: "pointer", overflow: "hidden" }}
                  >
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: row ? (tidakVisit ? "#888" : rStatus.color) : "linear-gradient(90deg, #7c3aed, #F4B740)" }} />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: row ? 8 : 4 }}>
                      <div style={{ fontWeight: 600, fontSize: 14.5 }}>{b.name}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {cabangBaru && (
                          <span style={{ fontSize: 9.5, fontWeight: 700, color: "#F4B740", background: "#F4B74022", padding: "2px 7px", borderRadius: 20, flexShrink: 0 }}>Cabang Baru</span>
                        )}
                        {row && row.count > 1 && (
                          <span style={{ fontSize: 9.5, fontWeight: 700, color: "#7c3aed", background: "#7c3aed18", padding: "2px 7px", borderRadius: 20, flexShrink: 0 }}>{row.count} audit</span>
                        )}
                      </div>
                    </div>
                    {row ? (
                      tidakVisit ? (
                        <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, background: "#88888822", color: "#888", fontSize: 11, fontWeight: 600 }}>Tidak Visit</span>
                      ) : (
                        <>
                          <div style={{ fontSize: 22, fontWeight: 800, color: rStatus.color }}>{formatKesehatanPct(pct)}</div>
                          <span style={{ display: "inline-block", marginTop: 6, padding: "3px 10px", borderRadius: 20, background: `${rStatus.color}22`, color: rStatus.color, fontSize: 11, fontWeight: 600 }}>{rStatus.lbl}</span>
                          <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 6 }}>Terakhir: {shortDate(row.entry.data?.audit_date)}</div>
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
              Periode: {periodeLabel(viewPeriod)}
              {selectedEntryId ? <span> &middot; mengedit audit tanggal {shortDate(selectedEntry?.data?.audit_date)}</span> : <span> &middot; audit baru</span>}
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
            {(profile?.role === "super_admin" || (profile?.role === "auditor" && selectedEntry?.submitted_by === profile?.id)) && selectedEntryId && (
              <button className="btn-ghost" disabled={saving} onClick={deleteRecord} style={{ alignSelf: "flex-end", color: "var(--danger-text)" }}>
                Hapus Data
              </button>
            )}
          </div>
        </div>
      </div>

      {error && <div style={{ margin: "14px 28px 0", background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}

      <div style={{ padding: 24 }}>
        {loadingRecord ? (
          <div style={{ color: "var(--text-secondary)" }}>Memuat data\u2026</div>
        ) : (
          <>
            {entriesThisPeriod.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
                  Riwayat audit {periodeLabel(viewPeriod)} ({entriesThisPeriod.length})
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {[...entriesThisPeriod].sort((a, b) => (a.data?.audit_date || "").localeCompare(b.data?.audit_date || "")).map((e, i) => {
                    const tidakVisit = e.data?.tidak_visit;
                    const st = tidakVisit ? null : kesehatanStatusInfo(e.data.kesehatan_pct || 0);
                    const active = e.id === selectedEntryId;
                    return (
                      <div
                        key={e.id}
                        onClick={() => applyEntryToForm(e)}
                        style={{
                          cursor: "pointer", padding: "8px 14px", borderRadius: 10,
                          border: `1.5px solid ${active ? "#7c3aed" : "var(--border)"}`,
                          background: active ? "#7c3aed14" : "var(--surface)",
                          display: "flex", alignItems: "center", gap: 8,
                        }}
                      >
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)" }}>Audit {i + 1}</span>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{shortDate(e.data?.audit_date)}</span>
                        {e.data?.cabang_baru && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#F4B740" }}>⭐ Baru</span>
                        )}
                        {tidakVisit ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#888" }}>Tidak Visit</span>
                        ) : (
                          <>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: st.color }} />
                            <span style={{ fontSize: 12, fontWeight: 700, color: st.color }}>{formatKesehatanPct(e.data.kesehatan_pct || 0)}</span>
                          </>
                        )}
                      </div>
                    );
                  })}
                  {canEdit && (
                    <div
                      onClick={() => startNewEntry(viewPeriod)}
                      style={{
                        cursor: "pointer", padding: "8px 14px", borderRadius: 10,
                        border: `1.5px dashed ${!selectedEntryId ? "#7c3aed" : "var(--border)"}`,
                        color: "#7c3aed", background: !selectedEntryId ? "#7c3aed14" : "transparent",
                        display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700,
                      }}
                    >
                      + Audit Baru
                    </div>
                  )}
                </div>
              </div>
            )}

            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, cursor: "pointer", fontSize: 13, color: "var(--text-secondary)" }}>
              <input type="checkbox" checked={form.tidak_visit} onChange={(e) => { setForm((f) => ({ ...f, tidak_visit: e.target.checked })); setSaved(false); }} disabled={!canEdit} />
              Cabang ini tidak dikunjungi bulan ini (Tidak Visit)
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, cursor: "pointer", fontSize: 13, color: "var(--text-secondary)" }}>
              <input type="checkbox" checked={form.cabang_baru} onChange={(e) => { setForm((f) => ({ ...f, cabang_baru: e.target.checked })); setSaved(false); }} disabled={!canEdit} />
              Cabang Baru <span style={{ color: "var(--text-faint)" }}>(tetap dihitung normal, cuma ditandai di laporan)</span>
            </label>

            {!form.tidak_visit && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 16, marginBottom: 16, alignItems: "start" }}>

                  {/* Card 1: Input data */}
                  <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20 }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5, color: "#7c3aed", marginBottom: 2 }}>1. INPUT DATA</div>
                    <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 16 }}>Masukkan data temuan &amp; kerugian pada periode audit ini</div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 4 }}>
                      <Field label="Total Barang Plus Minus / Tertukar" hint="jumlah kejadian, bukan qty">
                        <input className="input" type="text" inputMode="numeric" placeholder="0" value={form.temuan_count} onChange={(e) => setDigitField("temuan_count", e.target.value)} disabled={!canEdit} />
                      </Field>
                      <Field label="Total Bonus Fisik Tidak Ada" hint="jumlah kejadian, bukan qty">
                        <input className="input" type="text" inputMode="numeric" placeholder="0" value={form.bonus_count} onChange={(e) => setDigitField("bonus_count", e.target.value)} disabled={!canEdit} />
                      </Field>
                    </div>
                    <Field label="Untung / Rugi (Rp)" hint="isi minus (-) kalau rugi, misal -150000">
                      <input className="input" type="text" inputMode="numeric" placeholder="0" value={form.untung_rugi} onChange={(e) => setRugiField(e.target.value)} disabled={!canEdit} />
                    </Field>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 16 }}>
                      <MiniStat label="Skor Temuan" value={skorTemuan} />
                      <MiniStat label="Skor Rugi" value={sRugi} />
                      <MiniStat label="Skor Total" value={skorTotal} />
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 10 }}>
                      Skor Temuan = jumlah 2 kejadian di atas. Skor Rugi 0&ndash;4 tergantung nominal kerugian. Skor Total = Skor Temuan + (Skor Rugi &times; 5).
                    </div>
                  </div>

                  {/* Card 2: Hasil perhitungan */}
                  <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20 }}>
                    <div style={{ fontWeight: 700, fontSize: 14.5, color: "#7c3aed", marginBottom: 2 }}>2. HASIL PERHITUNGAN</div>
                    <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 16 }}>Dihitung otomatis dari data di samping</div>

                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>% Kesehatan Barang</div>
                      <div style={{ fontSize: 30, fontWeight: 900, color: status.color }}>{formatKesehatanPct(kesehatanPct)}</div>
                    </div>
                    <div style={{ height: 6, background: "var(--border)", borderRadius: 4, overflow: "hidden", marginBottom: 16 }}>
                      <div style={{ height: "100%", width: `${kesehatanPct * 100}%`, background: status.color, transition: "width .2s" }} />
                    </div>

                    <div style={{ background: `${status.color}18`, border: `1px solid ${status.color}55`, borderRadius: 8, padding: "9px 12px", marginBottom: 16 }}>
                      <div style={{ fontWeight: 700, color: status.color, marginBottom: 2 }}>{status.lbl}</div>
                      <div style={{ fontSize: 12, color: status.color }}>{status.desc}</div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
                      <ThresholdLegend color="#1a9e6e" label="Terkendali" range="\u226585%" />
                      <ThresholdLegend color="#2f9e9e" label="Waspada" range="70\u201384%" />
                      <ThresholdLegend color="#b07212" label="Monitoring" range="50\u201369%" />
                      <ThresholdLegend color="#a32020" label="Perlu Perhatian" range="<50%" />
                    </div>
                  </div>
                </div>

                {/* Card 3: Riwayat */}
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5, color: "#7c3aed", marginBottom: 14 }}>3. RIWAYAT KESEHATAN STOK SEMUA AUDIT</div>
                  <KesehatanHistoryChart history={fullHistory} />
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

function ThresholdLegend({ color, label, range }) {
  return (
    <div style={{ textAlign: "center", background: "var(--surface-alt)", borderRadius: 8, padding: "8px 6px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginBottom: 3 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700 }}>{label}</span>
      </div>
      <div style={{ fontSize: 10, color: "var(--text-faint)" }}>{range}</div>
    </div>
  );
}

function KesehatanHistoryChart({ history }) {
  const shown = history
    .filter((r) => r.data?.audit_date && !r.data?.tidak_visit)
    .map((r) => ({ date: r.data.audit_date, pct: r.data.kesehatan_pct || 0 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (shown.length < 2) {
    return <div style={{ fontSize: 12.5, color: "var(--text-faint)", padding: "40px 0", textAlign: "center" }}>Belum cukup riwayat buat ditampilkan sebagai grafik.</div>;
  }

  const H = 220, padL = 46, padR = 16, padT = 20, padB = 30;
  const colWidth = 60;
  const W = Math.max(640, padL + padR + (shown.length - 1) * colWidth);
  const maxVal = 1;
  const xStep = (W - padL - padR) / (shown.length - 1);
  const xAt = (i) => padL + i * xStep;
  const yAt = (v) => padT + (1 - v / maxVal) * (H - padT - padB);

  const linePoints = shown.map((p, i) => `${xAt(i)},${yAt(p.pct)}`).join(" ");
  const areaPoints = `${padL},${yAt(0)} ${linePoints} ${xAt(shown.length - 1)},${yAt(0)}`;
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const labelEvery = Math.ceil(shown.length / 9);

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, height: "auto", minWidth: "100%" }}>
        <defs>
          <linearGradient id="kesehatanFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
          </linearGradient>
        </defs>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={yAt(t)} y2={yAt(t)} stroke="var(--border)" strokeWidth="1" />
            <text x={padL - 8} y={yAt(t) + 3} textAnchor="end" fontSize="9" fill="var(--text-faint)">{(t * 100).toFixed(0)}%</text>
          </g>
        ))}
        <polygon points={areaPoints} fill="url(#kesehatanFill)" />
        <polyline points={linePoints} fill="none" stroke="#7c3aed" strokeWidth="2" />
        {shown.map((p, i) => {
          const isLast = i === shown.length - 1;
          const showLabel = i % labelEvery === 0 || isLast;
          return (
            <g key={i}>
              <circle cx={xAt(i)} cy={yAt(p.pct)} r={isLast ? 4 : 3} fill={isLast ? "#F4B740" : "#7c3aed"} />
              {showLabel && <text x={xAt(i)} y={yAt(p.pct) - 10} textAnchor="middle" fontSize="10" fontWeight="700" fill={isLast ? "#F4B740" : "var(--text-secondary)"}>{(p.pct * 100).toFixed(0)}%</text>}
              {showLabel && <text x={xAt(i)} y={H - 10} textAnchor="middle" fontSize="9.5" fill="var(--text-faint)">{shortDate(p.date)}</text>}
            </g>
          );
        })}
      </svg>
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
