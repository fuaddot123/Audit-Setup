import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

const INDO_MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
function monthLabel(period) {
  if (!period) return "\u2013";
  const [y, m] = period.split("-");
  return INDO_MONTHS[parseInt(m, 10) - 1] + " " + y;
}
function todayMonth() { return new Date().toISOString().slice(0, 7); }
function rupiah(n) {
  n = parseFloat(n) || 0;
  return (n < 0 ? "-" : "") + "Rp " + Math.round(Math.abs(n)).toLocaleString("id-ID");
}
function pct(n) { return n == null || !isFinite(n) ? "\u2013" : (n * 100).toFixed(1) + "%"; }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

const TONE = {
  good: { dot: "var(--success-dot)", bg: "var(--success-bg)", text: "var(--success-text)" },
  warn: { dot: "var(--warning-dot)", bg: "var(--warning-bg)", text: "var(--warning-text)" },
  bad: { dot: "var(--danger-text)", bg: "var(--danger-bg)", text: "var(--danger-text)" },
  none: { dot: "var(--neutral-dot)", bg: "var(--neutral-bg)", text: "var(--neutral-text)" },
};

function computeStatus(entry, settings) {
  if (!entry) return null;
  const sb = parseFloat(entry.saldo_sebelumnya) || 0;
  const sm = parseFloat(entry.saldo_masuk) || 0;
  const lim = parseFloat(entry.limit_kas) || 0;
  const pk = parseFloat(entry.pengeluaran) || 0;
  const total = sb + sm;
  const sisa = total - pk;
  const terpakai = sm > 0 ? pk / sm : 0;
  const posisi = total > 0 ? pk / total : 0;
  let indikator, keterangan, tone;
  if (sisa < 0) { indikator = "Pengecekan"; keterangan = "Kas kecil minus"; tone = "bad"; }
  else if (posisi * 100 <= settings.terkendali) { indikator = "Terkendali"; keterangan = "Saldo masih longgar dan aman"; tone = "good"; }
  else if (posisi * 100 <= settings.efisien) { indikator = "Efisien"; keterangan = "Penggunaan baik, saldo cadangan memadai"; tone = "good"; }
  else if (posisi * 100 <= settings.monitoring) { indikator = "Monitoring"; keterangan = "Perlu dipantau, posisi kas mendekati limit"; tone = "warn"; }
  else { indikator = "Tindak Lanjut"; keterangan = "Posisi kas melebihi ambang, perlu tindak lanjut"; tone = "bad"; }
  if (lim > 0 && pk > lim && sisa >= 0) keterangan += " \u00b7 saldo melebihi limit";
  return { sisa, terpakai, posisi, indikator, keterangan, tone };
}

const FILTERS = [
  { key: "all", label: "Semua cabang" },
  { key: "none", label: "Belum diisi" },
  { key: "good", label: "Efisien / Terkendali" },
  { key: "warn", label: "Monitoring" },
  { key: "bad", label: "Pengecekan / Tindak Lanjut" },
];

export default function AuditKeuangan({ profile }) {
  const [branches, setBranches] = useState([]);
  const [settings, setSettings] = useState({ terkendali: 70, efisien: 95, monitoring: 105 });
  const [entriesByBranch, setEntriesByBranch] = useState({});
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [selectedPeriod, setSelectedPeriod] = useState(null);
  const [form, setForm] = useState({ saldo_sebelumnya: "", saldo_masuk: "", limit_kas: "", pengeluaran: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [filter, setFilter] = useState("all");
  const [showExportAll, setShowExportAll] = useState(false);
  const [exportAllPeriod, setExportAllPeriod] = useState(null);

  const canEdit = profile.role === "auditor" || profile.role === "admin";

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const { data: br, error: brErr } = await supabase.from("branches").select("*").order("name");
      if (brErr) throw brErr;
      setBranches(br || []);

      const { data: st } = await supabase.from("settings_keuangan").select("*").eq("id", 1).single();
      if (st) setSettings(st);

      const { data: entries, error: enErr } = await supabase.from("audit_keuangan").select("*");
      if (enErr) throw enErr;
      const grouped = {};
      (entries || []).forEach((e) => {
        if (!grouped[e.branch_id]) grouped[e.branch_id] = {};
        grouped[e.branch_id][e.period] = e;
      });
      setEntriesByBranch(grouped);
    } catch (err) {
      setError("Gagal memuat data: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  function latestPeriod(branchId) {
    const periods = Object.keys(entriesByBranch[branchId] || {}).sort().reverse();
    return periods[0] || null;
  }

  function openBranch(branch) {
    setSelectedBranch(branch);
    const p = latestPeriod(branch.id) || todayMonth();
    selectPeriod(branch.id, p);
  }

  function closeModal() {
    setSelectedBranch(null);
    setSelectedPeriod(null);
  }

  function selectPeriod(branchId, period) {
    setSelectedPeriod(period);
    const e = (entriesByBranch[branchId] || {})[period];
    setForm(e
      ? { saldo_sebelumnya: e.saldo_sebelumnya, saldo_masuk: e.saldo_masuk, limit_kas: e.limit_kas, pengeluaran: e.pengeluaran }
      : { saldo_sebelumnya: "", saldo_masuk: "", limit_kas: "", pengeluaran: "" });
  }

  async function saveEntry() {
    if (!selectedBranch || !selectedPeriod) return;
    setSaving(true);
    setError(null);
    try {
      const existing = (entriesByBranch[selectedBranch.id] || {})[selectedPeriod];
      const payload = {
        branch_id: selectedBranch.id,
        period: selectedPeriod,
        saldo_sebelumnya: parseFloat(form.saldo_sebelumnya) || 0,
        saldo_masuk: parseFloat(form.saldo_masuk) || 0,
        limit_kas: parseFloat(form.limit_kas) || 0,
        pengeluaran: parseFloat(form.pengeluaran) || 0,
        status: "draft",
        submitted_by: (await supabase.auth.getUser()).data.user.id,
      };
      let res;
      if (existing) {
        res = await supabase.from("audit_keuangan").update(payload).eq("id", existing.id).select().single();
      } else {
        res = await supabase.from("audit_keuangan").insert(payload).select().single();
      }
      if (res.error) throw res.error;
      const grouped = { ...entriesByBranch };
      grouped[selectedBranch.id] = { ...(grouped[selectedBranch.id] || {}), [selectedPeriod]: res.data };
      setEntriesByBranch(grouped);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      setError("Gagal menyimpan: " + err.message + " (cek apakah RLS/role sudah benar)");
    } finally {
      setSaving(false);
    }
  }

  function exportReport() {
    const existing = (entriesByBranch[selectedBranch.id] || {})[selectedPeriod];
    if (!existing) return;
    const c = computeStatus(existing, settings);
    const rows = [
      ["Saldo bulan sebelumnya", rupiah(existing.saldo_sebelumnya)],
      ["Saldo masuk bulan berjalan", rupiah(existing.saldo_masuk)],
      ["Limit kas kecil", rupiah(existing.limit_kas)],
      ["Pengeluaran kas kecil", rupiah(existing.pengeluaran)],
      ["Sisa saldo kas kecil", rupiah(c.sisa)],
      ["% Terpakai", pct(c.terpakai)],
      ["% Posisi kas", pct(c.posisi)],
    ];
    const rowsHtml = rows.map(([k, v]) => `<tr><td style="padding:9px 4px;color:#5B6270;border-bottom:1px solid #E4E5E9">${k}</td><td style="padding:9px 4px;font-weight:600;text-align:right;border-bottom:1px solid #E4E5E9">${v}</td></tr>`).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Laporan Audit</title><style>
      body{font-family:Arial,Helvetica,sans-serif;color:#1A1D24;padding:40px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
      table{width:100%;border-collapse:collapse;font-size:13.5px;margin-bottom:20px;}
      .status{background:${TONE[c.tone].dot}1A;border:1px solid ${TONE[c.tone].dot};border-radius:10px;padding:14px 16px;color:${TONE[c.tone].dot};font-weight:600;}
    </style></head><body>
      <h1>Laporan Audit Kas Kecil</h1>
      <div style="font-size:13px;color:#5B6270;margin-bottom:20px">Cabang: ${esc(selectedBranch.name)} &middot; Bulan: ${esc(monthLabel(selectedPeriod))}</div>
      <table>${rowsHtml}</table>
      <div class="status">${esc(c.indikator)} &mdash; ${esc(c.keterangan)}</div>
      <script>window.onload=function(){setTimeout(function(){window.print();},400);}<\/script>
    </body></html>`;
    const w = window.open("", "_blank");
    if (!w) { alert("Popup diblokir. Izinkan popup lalu coba lagi."); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  function allPeriods() {
    const set = new Set();
    Object.values(entriesByBranch).forEach((byPeriod) => Object.keys(byPeriod).forEach((p) => set.add(p)));
    return Array.from(set).sort().reverse();
  }

  function exportAllReport() {
    const period = exportAllPeriod;
    if (!period) { alert("Pilih bulan dulu."); return; }
    let totalSb = 0, totalSm = 0, totalLim = 0, totalPk = 0, totalSisa = 0, countFilled = 0;
    const rows = branches.map((b, i) => {
      const e = (entriesByBranch[b.id] || {})[period];
      if (!e) {
        return `<tr><td style="padding:7px 6px;border-bottom:1px solid #E4E5E9">${i + 1}</td><td style="padding:7px 6px;border-bottom:1px solid #E4E5E9">${esc(b.name)}</td><td colspan="7" style="padding:7px 6px;border-bottom:1px solid #E4E5E9;color:#9AA0AC;font-style:italic">Belum diisi</td></tr>`;
      }
      const c = computeStatus(e, settings);
      totalSb += parseFloat(e.saldo_sebelumnya) || 0;
      totalSm += parseFloat(e.saldo_masuk) || 0;
      totalLim += parseFloat(e.limit_kas) || 0;
      totalPk += parseFloat(e.pengeluaran) || 0;
      totalSisa += c.sisa;
      countFilled++;
      const badgeColor = TONE[c.tone].dot;
      return `<tr>
        <td style="padding:7px 6px;border-bottom:1px solid #E4E5E9">${i + 1}</td>
        <td style="padding:7px 6px;border-bottom:1px solid #E4E5E9;font-weight:600">${esc(b.name)}</td>
        <td style="padding:7px 6px;border-bottom:1px solid #E4E5E9;text-align:right">${rupiah(e.saldo_sebelumnya)}</td>
        <td style="padding:7px 6px;border-bottom:1px solid #E4E5E9;text-align:right">${rupiah(e.saldo_masuk)}</td>
        <td style="padding:7px 6px;border-bottom:1px solid #E4E5E9;text-align:right">${rupiah(e.limit_kas)}</td>
        <td style="padding:7px 6px;border-bottom:1px solid #E4E5E9;text-align:right">${rupiah(e.pengeluaran)}</td>
        <td style="padding:7px 6px;border-bottom:1px solid #E4E5E9;text-align:right">${rupiah(c.sisa)}</td>
        <td style="padding:7px 6px;border-bottom:1px solid #E4E5E9;text-align:right">${pct(c.terpakai)}</td>
        <td style="padding:7px 6px;border-bottom:1px solid #E4E5E9;text-align:right">${pct(c.posisi)}</td>
        <td style="padding:7px 6px;border-bottom:1px solid #E4E5E9"><span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${badgeColor}1A;color:${badgeColor};font-weight:600;font-size:11px">${esc(c.indikator)}</span></td>
      </tr>`;
    }).join("");

    const legend = `
      <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:11px;color:#5B6270;margin-top:14px">
        <div><b>Efisien/Terkendali:</b> \u2264 ${settings.efisien}% posisi kas</div>
        <div><b>Monitoring:</b> ${settings.efisien}\u2013${settings.monitoring}%</div>
        <div><b>Pengecekan/Tindak Lanjut:</b> &gt; ${settings.monitoring}% atau saldo minus</div>
      </div>`;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Laporan Audit Kas Kecil - Semua Cabang</title><style>
      body{font-family:Arial,Helvetica,sans-serif;color:#1A1D24;padding:30px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
      h1{font-size:19px;margin:0 0 3px;}
      table{width:100%;border-collapse:collapse;font-size:11.5px;margin-top:16px;}
      th{text-align:left;padding:7px 6px;border-bottom:2px solid #1A1D24;font-size:10.5px;text-transform:uppercase;color:#5B6270;}
      tfoot td{font-weight:700;border-top:2px solid #1A1D24;padding:8px 6px;}
    </style></head><body>
      <h1>Laporan Audit Kas Kecil \u2014 Semua Cabang</h1>
      <div style="font-size:12.5px;color:#5B6270">Bulan: ${esc(monthLabel(period))} &middot; Dicetak ${esc(new Date().toLocaleString("id-ID"))}</div>
      <table>
        <thead><tr>
          <th>No</th><th>Cabang</th><th style="text-align:right">Saldo Sebelumnya</th><th style="text-align:right">Saldo Masuk</th>
          <th style="text-align:right">Limit</th><th style="text-align:right">Pengeluaran</th><th style="text-align:right">Sisa Saldo</th>
          <th style="text-align:right">% Terpakai</th><th style="text-align:right">% Posisi Kas</th><th>Indikator</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td colspan="2">Total (${countFilled} cabang terisi)</td>
          <td style="text-align:right">${rupiah(totalSb)}</td>
          <td style="text-align:right">${rupiah(totalSm)}</td>
          <td style="text-align:right">${rupiah(totalLim)}</td>
          <td style="text-align:right">${rupiah(totalPk)}</td>
          <td style="text-align:right">${rupiah(totalSisa)}</td>
          <td colspan="3"></td>
        </tr></tfoot>
      </table>
      ${legend}
      <script>window.onload=function(){setTimeout(function(){window.print();},400);}<\/script>
    </body></html>`;
    const w = window.open("", "_blank");
    if (!w) { alert("Popup diblokir. Izinkan popup lalu coba lagi."); return; }
    w.document.open(); w.document.write(html); w.document.close();
    setShowExportAll(false);
  }

  const currentEntry = selectedBranch ? (entriesByBranch[selectedBranch.id] || {})[selectedPeriod] : null;
  const current = computeStatus(selectedPeriod ? { ...(currentEntry || {}), ...form } : null, settings);

  const visibleBranches = branches.filter((b) => {
    if (filter === "all") return true;
    const lp = latestPeriod(b.id);
    const st = lp ? computeStatus(entriesByBranch[b.id][lp], settings) : null;
    const tone = st ? st.tone : "none";
    return tone === filter;
  });

  if (loading) return <div style={{ padding: 40, color: "var(--text-secondary)" }}>Memuat data\u2026</div>;

  return (
    <div style={{ flex: 1 }}>
      <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Audit Keuangan</div>
          <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>Pemantauan penggunaan kas kecil per cabang, per bulan</div>
        </div>
        <button className="btn" onClick={() => { setExportAllPeriod(allPeriods()[0] || null); setShowExportAll(true); }}>
          Export Semua Cabang (PDF)
        </button>
      </div>

      {error && <div style={{ margin: "14px 28px 0", background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}

      <div style={{ padding: "20px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.4 }}>
            Pilih cabang untuk audit ({visibleBranches.length})
          </div>
          <select className="input" style={{ width: 220 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
            {FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 14 }}>
          {visibleBranches.map((b) => {
            const lp = latestPeriod(b.id);
            const e = lp ? entriesByBranch[b.id][lp] : null;
            const st = e ? computeStatus(e, settings) : null;
            const tone = st ? st.tone : "none";
            return (
              <div
                key={b.id}
                onClick={() => openBranch(b)}
                style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px", cursor: "pointer", borderTop: `3px solid ${TONE[tone].dot}` }}
              >
                <div className="display" style={{ fontSize: 15.5, fontWeight: 600, marginBottom: 8 }}>{b.name}</div>
                <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, background: TONE[tone].bg, color: TONE[tone].text, fontSize: 11.5, fontWeight: 600, marginBottom: 10 }}>
                  {st ? st.indikator : "Belum diisi"}
                </span>
                <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                  {e ? `Sisa ${rupiah(st.sisa)} \u00b7 ${monthLabel(lp)}` : "Belum ada audit pada periode ini"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selectedBranch && (
        <div style={{ position: "fixed", inset: 0, background: "var(--overlay)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={closeModal}>
          <div style={{ background: "var(--surface)", borderRadius: 14, padding: 24, width: 440, maxWidth: "92%", maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>{selectedBranch.name}</div>
              <span onClick={closeModal} style={{ cursor: "pointer", color: "var(--text-faint)", fontSize: 20, lineHeight: 1 }}>&times;</span>
            </div>

            <div style={{ marginBottom: 14, maxWidth: 220 }}>
              <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 5 }}>Bulan audit</label>
              <input type="month" className="input" value={selectedPeriod || ""} onChange={(e) => selectPeriod(selectedBranch.id, e.target.value)} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 }}>
              {[["saldo_sebelumnya", "Saldo bulan sebelumnya"], ["saldo_masuk", "Saldo masuk bulan berjalan"], ["limit_kas", "Limit kas kecil"], ["pengeluaran", "Pengeluaran kas kecil"]].map(([key, label]) => (
                <div key={key}>
                  <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 5 }}>{label}</label>
                  <input className="input" type="number" placeholder="0" disabled={!canEdit} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
                </div>
              ))}
            </div>

            {canEdit && (
              <div style={{ display: "flex", gap: 10, marginBottom: 20, alignItems: "center" }}>
                <button className="btn" disabled={saving} onClick={saveEntry}>{saving ? "Menyimpan\u2026" : "Simpan"}</button>
                {savedFlash && <span style={{ color: "var(--success-text)", fontSize: 13 }}>Tersimpan \u2713</span>}
              </div>
            )}

            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-secondary)" }}>DIHITUNG OTOMATIS</div>
                <button className="btn-ghost" disabled={!currentEntry} onClick={exportReport}>Export PDF</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 16 }}>
                <div style={{ background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>Sisa saldo</div>
                  <div className="mono" style={{ fontSize: 15, fontWeight: 600 }}>{rupiah(current?.sisa)}</div>
                </div>
                <div style={{ background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>% Terpakai</div>
                  <div className="mono" style={{ fontSize: 15, fontWeight: 600 }}>{pct(current?.terpakai)}</div>
                </div>
                <div style={{ background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>% Posisi kas</div>
                  <div className="mono" style={{ fontSize: 15, fontWeight: 600 }}>{pct(current?.posisi)}</div>
                </div>
              </div>
              {current && (
                <div style={{ background: TONE[current.tone].bg, borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ fontWeight: 600, color: TONE[current.tone].text }}>{current.indikator}</div>
                  <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{current.keterangan}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showExportAll && (
        <div style={{ position: "fixed", inset: 0, background: "var(--overlay)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setShowExportAll(false)}>
          <div style={{ background: "var(--surface)", borderRadius: 14, padding: 24, width: 360, maxWidth: "90%" }} onClick={(e) => e.stopPropagation()}>
            <div className="display" style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Export laporan semua cabang</div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 5 }}>Bulan</label>
              {allPeriods().length ? (
                <select className="input" value={exportAllPeriod || ""} onChange={(e) => setExportAllPeriod(e.target.value)}>
                  {allPeriods().map((p) => <option key={p} value={p}>{monthLabel(p)}</option>)}
                </select>
              ) : (
                <div style={{ fontSize: 13, color: "var(--text-faint)" }}>Belum ada data tersimpan di cabang manapun.</div>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn-ghost" onClick={() => setShowExportAll(false)}>Batal</button>
              <button className="btn" disabled={!exportAllPeriod} onClick={exportAllReport}>Export PDF</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
