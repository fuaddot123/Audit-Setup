import { useState, useEffect, cloneElement } from "react";
import { supabase } from "../../lib/supabaseClient";
import {
  calcServiceRatio, serviceStatusInfo, formatRatioPct,
  periodFromDate, todayInputValue, periodeLabel, SERVICE_THRESHOLDS,
  nowPeriode, addMonthsToPeriod,
} from "../../lib/stokConfig";

const EMPTY_FORM = { laptop: "", aksesoris: "", user: "", stok_service: "", total_unit_cabang: "" };

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function shortDate(d) {
  if (!d) return "\u2014";
  return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

const ICON = {
  laptop: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="11" rx="1.5" /><path d="M2 19h20" /></svg>,
  bag: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 8h12l1 12H5L6 8z" /><path d="M9 8V6a3 3 0 016 0v2" /></svg>,
  user: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" /></svg>,
  box: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /></svg>,
  building: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M9 8h1M14 8h1M9 12h1M14 12h1M9 16h1M14 16h1" /></svg>,
  info: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v5h1" /></svg>,
  eye: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>,
  calc: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M9 7h6M8 11h1M11.5 11h1M15 11h1M8 14h1M11.5 14h1M15 14h1M8 17h1M11.5 17h1M15 17h1" /></svg>,
  plus: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>,
};

function statusDesc(lbl) {
  if (lbl === "Terkendali") return "Rasio service dalam kondisi sehat dan terkendali.";
  if (lbl === "Monitoring") return "Rasio service berada dalam batas normal namun perlu dipantau secara berkala.";
  return "Rasio service melebihi batas wajar, perlu tindak lanjut segera.";
}

export default function StokServiceRatio({ profile }) {
  const canEdit = profile?.role === "auditor" || profile?.role === "super_admin";
  const [branches, setBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [latestByBranchPeriod, setLatestByBranchPeriod] = useState({}); // `${branchId}|${period}` -> { entry, count }
  const [viewPeriod, setViewPeriod] = useState(nowPeriode());
  const [selectedBranch, setSelectedBranch] = useState(null);

  const [entriesThisPeriod, setEntriesThisPeriod] = useState([]);
  const [selectedEntryId, setSelectedEntryId] = useState(null); // null = mode "audit baru"
  const [fullHistory, setFullHistory] = useState([]);

  const [form, setForm] = useState(EMPTY_FORM);
  const [catatan, setCatatan] = useState("");
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
    const { data: recs, error: recErr } = await supabase
      .from("audit_generic")
      .select("*")
      .eq("module", "stok_service");
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

  function applyEntryToForm(entry) {
    setForm({
      laptop: entry.data?.laptop ?? "",
      aksesoris: entry.data?.aksesoris ?? "",
      user: entry.data?.user ?? "",
      stok_service: entry.data?.stok_service ?? "",
      total_unit_cabang: entry.data?.total_unit_cabang ?? "",
    });
    setCatatan(entry.data?.catatan || "");
    setAuditDate(entry.data?.audit_date || todayInputValue());
    setSelectedEntryId(entry.id);
  }

  function startNewEntry(period) {
    setForm(EMPTY_FORM);
    setCatatan("");
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
    const [periodRes, histRes] = await Promise.all([
      supabase.from("audit_generic").select("*").eq("module", "stok_service").eq("branch_id", b.id).eq("period", period),
      supabase.from("audit_generic").select("*").eq("module", "stok_service").eq("branch_id", b.id),
    ]);
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

  function setField(key, val) {
    const digits = val.replace(/[^\d]/g, "");
    setForm((f) => ({ ...f, [key]: digits }));
    setSaved(false);
  }

  function resetForm() {
    startNewEntry(viewPeriod);
  }

  const ratio = calcServiceRatio(form.stok_service, form.total_unit_cabang);
  const status = serviceStatusInfo(ratio);
  const period = periodFromDate(auditDate);
  const selectedEntry = entriesThisPeriod.find((e) => e.id === selectedEntryId) || null;

  async function deleteRecord() {
    if (!selectedEntry || profile?.role !== "super_admin") return;
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
          catatan,
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

      // Refresh daftar audit bulan ini kalau masih di periode yang sama
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

  function exportPDF() {
    if (!selectedBranch) return;
    const printDate = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
    const historyRows = fullHistory.map((r) => `<tr>
        <td>${esc(shortDate(r.data?.audit_date))}</td>
        <td class="mono">${esc(formatRatioPct(r.data.ratio || 0))}</td>
        <td>${esc(serviceStatusInfo(r.data.ratio || 0).lbl)}</td>
      </tr>`).join("") || `<tr><td colspan="3" style="text-align:center;color:#999;padding:10px;">Belum ada riwayat</td></tr>`;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Service Ratio ${esc(selectedBranch.name)}</title>
    <style>
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      @page { size: A4; margin: 12mm; }
      body { font-family: Arial, Helvetica, sans-serif; color: #232323; font-size: 12px; margin: 0; }
      .hdr { display: flex; justify-content: space-between; align-items: center; background: linear-gradient(120deg,#2A1F52,#3d2a72); padding: 16px 18px; border-bottom: 4px solid #F4B740; border-radius: 8px 8px 0 0; }
      .hdr-badge { width: 36px; height: 36px; border-radius: 9px; background: #F4B740; color: #2A1F52; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 13px; }
      .hdr-title { color: #fff; font-weight: 800; font-size: 15px; }
      .hdr-sub { color: #cfc7e6; font-size: 8.5px; }
      .content { padding: 18px; border: 1px solid #eee; border-top: none; border-radius: 0 0 8px 8px; }
      .metric-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
      .metric-card { border-radius: 10px; padding: 12px; background: #fafafd; border: 1px solid #eee; }
      .metric-card .l { font-size: 8px; font-weight: 800; text-transform: uppercase; color: #888; margin-bottom: 4px; }
      .metric-card .v { font-size: 20px; font-weight: 900; color: #2A1F52; }
      table { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-bottom: 14px; }
      th { background: #f7f6fb; text-align: left; padding: 6px 9px; border-bottom: 2px solid #2A1F52; color: #2A1F52; }
      td { padding: 6px 9px; border-bottom: 1px solid #eee; }
      .note-box { background: #f5f3fa; border-radius: 8px; padding: 10px 12px; font-size: 10.5px; color: #444; }
    </style></head><body>
      <div class="hdr">
        <div style="display:flex;align-items:center;gap:12px;"><div class="hdr-badge">KLA</div><div><div class="hdr-title">Laporan Service Ratio</div><div class="hdr-sub">Divisi Audit &middot; KLA Teknologi Indonesia</div></div></div>
        <div style="text-align:right;color:#cfc7e6;font-size:8.5px;">Dicetak ${printDate}</div>
      </div>
      <div class="content">
        <p><b>Cabang:</b> ${esc(selectedBranch.name)} &nbsp;&middot;&nbsp; <b>Audit tanggal:</b> ${esc(shortDate(auditDate))}</p>
        <div class="metric-row">
          <div class="metric-card"><div class="l">Stok Service</div><div class="v">${form.stok_service || 0} unit</div></div>
          <div class="metric-card"><div class="l">% Ratio Service</div><div class="v" style="color:${status.color};">${formatRatioPct(ratio)}</div></div>
          <div class="metric-card"><div class="l">Status</div><div class="v" style="font-size:14px;color:${status.color};">${esc(status.lbl)}</div></div>
        </div>
        <table>
          <thead><tr><th>Tanggal Audit</th><th>% Ratio</th><th>Status</th></tr></thead>
          <tbody>${historyRows}</tbody>
        </table>
        ${catatan ? `<div class="note-box"><b>Catatan:</b> ${esc(catatan)}</div>` : ""}
      </div>
      <script>window.onload = () => setTimeout(() => window.print(), 300);<\/script>
    </body></html>`;

    const win = window.open("", "_blank");
    if (!win) { setError("Popup diblokir browser. Izinkan popup untuk mencetak PDF."); return; }
    win.document.write(html);
    win.document.close();
  }

  // ── Tampilan: pilih cabang ──
  if (!selectedBranch) {
    return (
      <div style={{ flex: 1 }}>
        <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Service Ratio</div>
            <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>Rasio unit service dibanding total unit per cabang, per bulan &mdash; bisa lebih dari 1 audit per bulan</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 8, padding: "4px 6px" }}>
            <button className="btn-ghost" onClick={() => setViewPeriod(addMonthsToPeriod(viewPeriod, -1))} style={{ padding: "6px 10px" }}>{"<"}</button>
            <div className="mono" style={{ fontWeight: 600, minWidth: 130, textAlign: "center", fontSize: 13.5 }}>{periodeLabel(viewPeriod)}</div>
            <button className="btn-ghost" onClick={() => setViewPeriod(addMonthsToPeriod(viewPeriod, 1))} style={{ padding: "6px 10px" }}>{">"}</button>
          </div>
        </div>
        <div style={{ padding: 24 }}>
          {(() => {
            const rows = branches.map((b) => latestByBranchPeriod[`${b.id}|${viewPeriod}`]).filter(Boolean);
            const auditedCount = rows.length;
            const avgRatio = auditedCount ? rows.reduce((s, r) => s + (r.entry.data.ratio || 0), 0) / auditedCount : null;
            const alertCount = rows.filter((r) => serviceStatusInfo(r.entry.data.ratio || 0).lbl === "Perlu Perhatian").length;
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
                const row = latestByBranchPeriod[`${b.id}|${viewPeriod}`];
                const rRatio = row ? row.entry.data.ratio || 0 : null;
                const rStatus = row ? serviceStatusInfo(rRatio) : null;
                return (
                  <div
                    key={b.id}
                    onClick={() => pickBranch(b)}
                    style={{ position: "relative", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", cursor: "pointer", overflow: "hidden" }}
                  >
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: row ? rStatus.color : "linear-gradient(90deg, #7c3aed, #F4B740)" }} />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: row ? 8 : 4 }}>
                      <div style={{ fontWeight: 600, fontSize: 14.5 }}>{b.name}</div>
                      {row && row.count > 1 && (
                        <span style={{ fontSize: 9.5, fontWeight: 700, color: "#7c3aed", background: "#7c3aed18", padding: "2px 7px", borderRadius: 20, flexShrink: 0 }}>{row.count} audit</span>
                      )}
                    </div>
                    {row ? (
                      <>
                        <div style={{ fontSize: 22, fontWeight: 800, color: rStatus.color }}>{formatRatioPct(rRatio)}</div>
                        <span style={{ display: "inline-block", marginTop: 6, padding: "3px 10px", borderRadius: 20, background: `${rStatus.color}22`, color: rStatus.color, fontSize: 11, fontWeight: 600 }}>{rStatus.lbl}</span>
                        <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 6 }}>Terakhir: {shortDate(row.entry.data?.audit_date)}</div>
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

  // ── Tampilan: form input (redesign + multi-audit) ──
  return (
    <div style={{ flex: 1 }}>
      <div style={{ background: "var(--surface)", padding: "16px 28px", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <button className="btn-ghost" style={{ marginBottom: 8, fontSize: 12.5 }} onClick={backToList}>&larr; Pilih cabang lain</button>
            <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Service Ratio &mdash; {selectedBranch.name}</div>
            <div style={{ color: "var(--text-secondary)", fontSize: 12.5, marginTop: 2 }}>
              Periode: <span style={{ color: "#7c3aed", fontWeight: 600 }}>{periodeLabel(viewPeriod)}</span>
              {selectedEntryId ? <span> &middot; mengedit audit tanggal {shortDate(selectedEntry?.data?.audit_date)}</span> : <span> &middot; audit baru</span>}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
            <div>
              <label style={{ display: "block", fontSize: 11, color: "var(--text-secondary)", marginBottom: 3 }}>Tanggal audit</label>
              <input className="input" type="date" value={auditDate} onChange={(e) => { setAuditDate(e.target.value); setSaved(false); }} />
            </div>
            <button className="btn" disabled={saving || !canEdit} onClick={saveRecord} title={!canEdit ? "Kamu tidak punya izin mengedit" : undefined}>
              {saving ? "Menyimpan\u2026" : saved ? "\u2713 Tersimpan" : canEdit ? "Simpan" : "Hanya Lihat"}
            </button>
            {profile?.role === "super_admin" && selectedEntryId && (
              <button className="btn-ghost" disabled={saving} onClick={deleteRecord} style={{ color: "var(--danger-text)", borderColor: "var(--danger-text)" }}>
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
            {/* Riwayat audit bulan ini — cuma muncul kalau ada 1+ entri */}
            {entriesThisPeriod.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
                  Riwayat audit {periodeLabel(viewPeriod)} ({entriesThisPeriod.length})
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {entriesThisPeriod.map((e, i) => {
                    const st = serviceStatusInfo(e.data.ratio || 0);
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
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)" }}>Audit {entriesThisPeriod.length - i}</span>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{shortDate(e.data?.audit_date)}</span>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: st.color }} />
                        <span style={{ fontSize: 12, fontWeight: 700, color: st.color }}>{formatRatioPct(e.data.ratio || 0)}</span>
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
                      <span style={{ width: 13, height: 13 }}>{ICON.plus}</span> Audit Baru
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Row 1: Input data + Hasil perhitungan */}
            <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 16, marginBottom: 16, alignItems: "start" }}>

              {/* Card 1: Input data */}
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5, color: "#7c3aed", marginBottom: 2 }}>1. INPUT DATA</div>
                <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 16 }}>{selectedEntryId ? "Kamu sedang mengedit salah satu audit bulan ini" : "Masukkan data audit baru"}</div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                  <IconField label="Unit Laptop diservice" icon={ICON.laptop} unit="unit">
                    <input className="input" type="text" inputMode="numeric" placeholder="0" value={form.laptop} onChange={(e) => setField("laptop", e.target.value)} disabled={!canEdit} />
                  </IconField>
                  <IconField label="Unit Aksesoris diservice" icon={ICON.bag} unit="unit">
                    <input className="input" type="text" inputMode="numeric" placeholder="0" value={form.aksesoris} onChange={(e) => setField("aksesoris", e.target.value)} disabled={!canEdit} />
                  </IconField>
                  <IconField label="User Service" icon={ICON.user} unit="unit">
                    <input className="input" type="text" inputMode="numeric" placeholder="0" value={form.user} onChange={(e) => setField("user", e.target.value)} disabled={!canEdit} />
                  </IconField>
                  <IconField label="Stok Service" icon={ICON.box} unit="unit">
                    <input className="input" type="text" inputMode="numeric" placeholder="0" value={form.stok_service} onChange={(e) => setField("stok_service", e.target.value)} disabled={!canEdit} />
                  </IconField>
                </div>
                <IconField label="Total Unit / Cabang" icon={ICON.building} unit="unit">
                  <input className="input" type="text" inputMode="numeric" placeholder="0" value={form.total_unit_cabang} onChange={(e) => setField("total_unit_cabang", e.target.value)} disabled={!canEdit} />
                </IconField>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 18, background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px" }}>
                  <div style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    <span style={{ color: "#7c3aed", flexShrink: 0, width: 15, height: 15 }}>{ICON.info}</span>
                    <span>Laptop, Aksesoris &amp; User Service dipakai buat pencatatan. Rasio = Stok Service &divide; Total Unit/Cabang &times; 100%.</span>
                  </div>
                  <button className="btn" style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }} onClick={() => setSaved(false)}>
                    <span style={{ width: 14, height: 14 }}>{ICON.calc}</span> Hitung Ratio
                  </button>
                </div>
              </div>

              {/* Card 2: Hasil perhitungan */}
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5, color: "#7c3aed", marginBottom: 2 }}>2. HASIL PERHITUNGAN</div>
                <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 16 }}>Hasil perhitungan otomatis berdasarkan data di samping</div>

                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>Stok Service</div>
                    <div style={{ fontSize: 26, fontWeight: 800 }}>{form.stok_service || 0} <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-faint)" }}>unit</span></div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>% Ratio Service</div>
                    <div style={{ fontSize: 26, fontWeight: 800, color: status.color }}>{formatRatioPct(ratio)}</div>
                  </div>
                </div>
                <div style={{ height: 6, background: "var(--border)", borderRadius: 4, overflow: "hidden", marginBottom: 16 }}>
                  <div style={{ height: "100%", width: `${Math.min((ratio / SERVICE_THRESHOLDS.monitoring) * 100, 100)}%`, background: status.color, transition: "width .2s" }} />
                </div>

                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 6 }}>Status</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: `${status.color}18`, border: `1px solid ${status.color}55`, borderRadius: 20, padding: "6px 14px", width: "fit-content", marginBottom: 8 }}>
                  <span style={{ width: 15, height: 15, color: status.color }}>{ICON.eye}</span>
                  <span style={{ fontWeight: 800, fontSize: 12.5, color: status.color, letterSpacing: "0.03em" }}>{status.lbl.toUpperCase()}</span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 16, lineHeight: 1.5 }}>{statusDesc(status.lbl)}</div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
                  <ThresholdLegend color="#1a9e6e" label="Terkendali" range="0 \u2013 0,22%" />
                  <ThresholdLegend color="#b07212" label="Monitoring" range="0,22 \u2013 0,33%" />
                  <ThresholdLegend color="#a32020" label="Perlu Perhatian" range="> 0,33%" />
                </div>
              </div>
            </div>

            {/* Row 2: History chart + Catatan */}
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, marginBottom: 16, alignItems: "start" }}>
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5, color: "#7c3aed", marginBottom: 14 }}>3. RIWAYAT RATIO SEMUA AUDIT</div>
                <RatioHistoryChart history={fullHistory} />
              </div>

              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, display: "flex", flexDirection: "column" }}>
                <div style={{ fontWeight: 700, fontSize: 14.5, color: "#7c3aed", marginBottom: 2 }}>4. CATATAN <span style={{ fontWeight: 400, color: "var(--text-faint)", fontSize: 12 }}>(Opsional)</span></div>
                <textarea
                  className="input"
                  placeholder="Tambahkan catatan jika diperlukan\u2026"
                  value={catatan}
                  disabled={!canEdit}
                  maxLength={300}
                  onChange={(e) => { setCatatan(e.target.value); setSaved(false); }}
                  style={{ flex: 1, minHeight: 160, resize: "vertical", marginTop: 12 }}
                />
                <div style={{ textAlign: "right", fontSize: 10.5, color: "var(--text-faint)", marginTop: 6 }}>{catatan.length} / 300</div>
              </div>
            </div>

            {/* Bottom action bar */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 16px" }}>
              <div style={{ display: "flex", gap: 8, fontSize: 12, color: "var(--text-secondary)" }}>
                <span style={{ color: "#7c3aed", width: 15, height: 15, flexShrink: 0 }}>{ICON.info}</span>
                Pastikan data yang diinput sudah benar sebelum disimpan. Data yang tersimpan akan digunakan pada laporan audit.
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button className="btn-ghost" onClick={resetForm} disabled={!canEdit}>Reset</button>
                <button className="btn" style={{ background: "#1a9e6e", borderColor: "#1a9e6e" }} onClick={exportPDF}>Export PDF</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function IconField({ label, icon, unit, children }) {
  const styledInput = cloneElement(children, {
    style: { ...(children.props.style || {}), paddingLeft: 36, paddingRight: unit ? 46 : undefined },
  });
  return (
    <div>
      <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 6 }}>{label}</label>
      <div style={{ position: "relative" }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: "#7c3aed", pointerEvents: "none" }}>{icon}</span>
        {styledInput}
        {unit && <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 11.5, color: "var(--text-faint)", pointerEvents: "none" }}>{unit}</span>}
      </div>
    </div>
  );
}

function ThresholdLegend({ color, label, range }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, marginBottom: 3 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700 }}>{label}</span>
      </div>
      <div style={{ fontSize: 10, color: "var(--text-faint)" }}>{range}</div>
    </div>
  );
}

// history: array of audit_generic rows (module=stok_service), tiap baris 1 titik (pakai audit_date, bukan cuma bulan)
function RatioHistoryChart({ history }) {
  const shown = history
    .filter((r) => r.data?.audit_date)
    .map((r) => ({ date: r.data.audit_date, ratio: r.data.ratio || 0 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (shown.length < 2) {
    return <div style={{ fontSize: 12.5, color: "var(--text-faint)", padding: "40px 0", textAlign: "center" }}>Belum cukup riwayat buat ditampilkan sebagai grafik.</div>;
  }

  const H = 220, padL = 46, padR = 16, padT = 20, padB = 30;
  const colWidth = 60;
  const W = Math.max(640, padL + padR + (shown.length - 1) * colWidth);
  const maxVal = Math.max(...shown.map((p) => p.ratio), SERVICE_THRESHOLDS.monitoring) * 1.15;
  const xStep = (W - padL - padR) / (shown.length - 1);
  const xAt = (i) => padL + i * xStep;
  const yAt = (v) => padT + (1 - v / maxVal) * (H - padT - padB);

  const linePoints = shown.map((p, i) => `${xAt(i)},${yAt(p.ratio)}`).join(" ");
  const areaPoints = `${padL},${yAt(0)} ${linePoints} ${xAt(shown.length - 1)},${yAt(0)}`;
  const yTicks = [0, maxVal * 0.25, maxVal * 0.5, maxVal * 0.75, maxVal];
  const labelEvery = Math.ceil(shown.length / 9);

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, height: "auto", minWidth: "100%" }}>
        <defs>
          <linearGradient id="ratioFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
          </linearGradient>
        </defs>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={yAt(t)} y2={yAt(t)} stroke="var(--border)" strokeWidth="1" />
            <text x={padL - 8} y={yAt(t) + 3} textAnchor="end" fontSize="9" fill="var(--text-faint)">{(t * 100).toFixed(2)}%</text>
          </g>
        ))}
        <polygon points={areaPoints} fill="url(#ratioFill)" />
        <polyline points={linePoints} fill="none" stroke="#7c3aed" strokeWidth="2" />
        {shown.map((p, i) => {
          const isLast = i === shown.length - 1;
          const showLabel = i % labelEvery === 0 || isLast;
          return (
            <g key={i}>
              <circle cx={xAt(i)} cy={yAt(p.ratio)} r={isLast ? 4 : 3} fill={isLast ? "#F4B740" : "#7c3aed"} />
              {showLabel && <text x={xAt(i)} y={yAt(p.ratio) - 10} textAnchor="middle" fontSize="10" fontWeight="700" fill={isLast ? "#F4B740" : "var(--text-secondary)"}>{(p.ratio * 100).toFixed(2)}%</text>}
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
