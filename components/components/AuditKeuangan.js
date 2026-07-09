import { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";

const INDO_MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
function monthLabel(period) {
  if (!period) return "–";
  const [y, m] = period.split("-");
  return INDO_MONTHS[parseInt(m, 10) - 1] + " " + y;
}
function todayMonth() { return new Date().toISOString().slice(0, 7); }
function rupiah(n) {
  n = parseFloat(n) || 0;
  return (n < 0 ? "-" : "") + "Rp " + Math.round(Math.abs(n)).toLocaleString("id-ID");
}
function pct(n) { return n == null || !isFinite(n) ? "–" : (n * 100).toFixed(1) + "%"; }

const TONE = {
  good: { dot: "#1F6F5C", bg: "#EAF4F1", text: "#1F6F5C" },
  warn: { dot: "#B8792A", bg: "#FBF1E4", text: "#8A5A1D" },
  bad: { dot: "#B5432E", bg: "#FBEBE7", text: "#9C3B29" },
  none: { dot: "#B8BCC4", bg: "#F1F2F4", text: "#6B7180" },
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
  if (lim > 0 && pk > lim && sisa >= 0) keterangan += " · saldo melebihi limit";
  return { sisa, terpakai, posisi, indikator, keterangan, tone };
}

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
      <div style="font-size:13px;color:#5B6270;margin-bottom:20px">Cabang: ${selectedBranch.name} &middot; Bulan: ${monthLabel(selectedPeriod)}</div>
      <table>${rowsHtml}</table>
      <div class="status">${c.indikator} &mdash; ${c.keterangan}</div>
      <script>window.onload=function(){setTimeout(function(){window.print();},400);}<\/script>
    </body></html>`;
    const w = window.open("", "_blank");
    if (!w) { alert("Popup diblokir. Izinkan popup lalu coba lagi."); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  const currentEntry = selectedBranch ? (entriesByBranch[selectedBranch.id] || {})[selectedPeriod] : null;
  const current = useMemo(() => computeStatus(selectedPeriod ? { ...(currentEntry || {}), ...form } : null, settings), [form, currentEntry, selectedPeriod, settings]);

  if (loading) return <div style={{ padding: 40, color: "#8B909C" }}>Memuat data…</div>;

  return (
    <div style={{ flex: 1 }}>
      <div style={{ background: "#fff", padding: "18px 28px", borderBottom: "1px solid #E4E5E9" }}>
        <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Audit Keuangan</div>
        <div style={{ color: "#8B909C", fontSize: 12.5 }}>Pemantauan penggunaan kas kecil per cabang, per bulan — tersambung Supabase</div>
      </div>
      {error && <div style={{ margin: "14px 28px 0", background: "#FBEBE7", border: "1px solid #F0C6BC", color: "#9C3B29", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}
      <div style={{ display: "flex", gap: 16, padding: "20px 28px", alignItems: "flex-start" }}>
        <div style={{ background: "#fff", border: "1px solid #E4E5E9", borderRadius: 12, width: 300, flexShrink: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #EDEEF1", fontSize: 12.5, fontWeight: 600, color: "#6B7180" }}>CABANG ({branches.length})</div>
          <div style={{ maxHeight: 520, overflowY: "auto" }}>
            {branches.map((b) => {
              const lp = latestPeriod(b.id);
              const e = lp ? entriesByBranch[b.id][lp] : null;
              const st = e ? computeStatus(e, settings) : null;
              const tone = st ? st.tone : "none";
              const active = selectedBranch?.id === b.id;
              return (
                <div key={b.id} onClick={() => openBranch(b)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderLeft: `4px solid ${TONE[tone].dot}`, cursor: "pointer", background: active ? "#EFF1F0" : "transparent", borderBottom: "1px solid #F1F2F4" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{b.name}</div>
                    <div style={{ fontSize: 11.5, color: TONE[tone].text }}>{e ? `${st.indikator} · ${monthLabel(lp)}` : "Belum diisi"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ flex: 1, background: "#fff", border: "1px solid #E4E5E9", borderRadius: 12, padding: 24, minHeight: 520 }}>
          {!selectedBranch ? (
            <div style={{ textAlign: "center", color: "#9AA0AC", paddingTop: 160 }}>Pilih cabang di sebelah kiri</div>
          ) : (
            <>
              <div className="display" style={{ fontSize: 22, fontWeight: 600, marginBottom: 14 }}>{selectedBranch.name}</div>

              <div style={{ marginBottom: 14, maxWidth: 220 }}>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "#5B6270", marginBottom: 5 }}>Bulan audit</label>
                <input type="month" className="input" value={selectedPeriod || ""} onChange={(e) => selectPeriod(selectedBranch.id, e.target.value)} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 }}>
                {[["saldo_sebelumnya", "Saldo bulan sebelumnya"], ["saldo_masuk", "Saldo masuk bulan berjalan"], ["limit_kas", "Limit kas kecil"], ["pengeluaran", "Pengeluaran kas kecil"]].map(([key, label]) => (
                  <div key={key}>
                    <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "#5B6270", marginBottom: 5 }}>{label}</label>
                    <input className="input" type="number" placeholder="0" disabled={!canEdit} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
                  </div>
                ))}
              </div>

              {canEdit && (
                <div style={{ display: "flex", gap: 10, marginBottom: 20, alignItems: "center" }}>
                  <button className="btn" disabled={saving} onClick={saveEntry}>{saving ? "Menyimpan…" : "Simpan"}</button>
                  {savedFlash && <span style={{ color: "#1F6F5C", fontSize: 13 }}>Tersimpan ✓</span>}
                </div>
              )}

              <div style={{ borderTop: "1px solid #EDEEF1", paddingTop: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "#6B7180" }}>DIHITUNG OTOMATIS</div>
                  <button className="btn-ghost" disabled={!currentEntry} onClick={exportReport}>Export PDF</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
                  <div style={{ background: "#F7F8FA", border: "1px solid #EDEEF1", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11.5, color: "#8B909C" }}>Sisa saldo</div>
                    <div className="mono" style={{ fontSize: 17, fontWeight: 600 }}>{rupiah(current?.sisa)}</div>
                  </div>
                  <div style={{ background: "#F7F8FA", border: "1px solid #EDEEF1", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11.5, color: "#8B909C" }}>% Terpakai</div>
                    <div className="mono" style={{ fontSize: 17, fontWeight: 600 }}>{pct(current?.terpakai)}</div>
                  </div>
                  <div style={{ background: "#F7F8FA", border: "1px solid #EDEEF1", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11.5, color: "#8B909C" }}>% Posisi kas</div>
                    <div className="mono" style={{ fontSize: 17, fontWeight: 600 }}>{pct(current?.posisi)}</div>
                  </div>
                </div>
                {current && (
                  <div style={{ background: TONE[current.tone].bg, borderRadius: 10, padding: "14px 16px" }}>
                    <div style={{ fontWeight: 600, color: TONE[current.tone].text }}>{current.indikator}</div>
                    <div style={{ fontSize: 13, color: "#5B6270" }}>{current.keterangan}</div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}