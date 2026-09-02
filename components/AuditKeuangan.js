import { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";
import { sortBranches } from "../lib/branchOrder";
import { buildSummaryReportHtml, openPrintWindow } from "../lib/pdfReportTemplate";
import BranchMultiSelect from "./BranchMultiSelect";

const INDO_MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
function monthLabel(period) {
  if (!period) return "\u2013";
  const [y, m] = period.split("-");
  return INDO_MONTHS[parseInt(m, 10) - 1] + " " + y;
}
function todayMonth() { return new Date().toISOString().slice(0, 7); }
function getPrevPeriod(period) {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function addMonthsToPeriod(period, delta) {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
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
  const hasManualSisa = entry.sisa_saldo !== undefined && entry.sisa_saldo !== null && entry.sisa_saldo !== "";
  const sisa = hasManualSisa ? (parseFloat(entry.sisa_saldo) || 0) : total - pk;
  const terpakai = sm > 0 ? pk / sm : 0;
  const posisi = total > 0 ? pk / total : 0;
  let indikator, keterangan, tone;
  if (sisa < 0) { indikator = "Pengecekan"; keterangan = "Kas kecil minus"; tone = "bad"; }
  else if (posisi * 100 <= settings.terkendali) { indikator = "Terkendali"; keterangan = "Saldo masih longgar dan aman"; tone = "good"; }
  else if (posisi * 100 <= settings.efisien) { indikator = "Efisien"; keterangan = "Penggunaan baik, saldo cadangan memadai"; tone = "good"; }
  else if (posisi * 100 <= settings.monitoring) { indikator = "Monitoring"; keterangan = "Perlu dipantau, posisi kas mendekati limit"; tone = "warn"; }
  else { indikator = "Tindak Lanjut"; keterangan = "Posisi kas melebihi ambang, perlu tindak lanjut"; tone = "bad"; }
  if (lim > 0 && sm > lim && sisa >= 0) keterangan += " \u00b7 saldo masuk melebihi limit";
  return { sisa, terpakai, posisi, indikator, keterangan, tone };
}

function formatThousands(v) {
  if (v === "" || v === null || v === undefined) return "";
  const str = String(v);
  const neg = str.trim().startsWith("-");
  const digits = str.replace(/[^\d]/g, "");
  if (!digits) return neg ? "-" : "";
  const formatted = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return neg ? "-" + formatted : formatted;
}
function parseThousands(v) {
  const str = String(v || "");
  const neg = str.trim().startsWith("-");
  const digits = str.replace(/[^\d]/g, "");
  return (neg ? "-" : "") + digits;
}
function shortDate(d) {
  if (!d) return "\u2014";
  return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}
// entries: array of audit_keuangan rows (bisa lebih dari 1 per bulan sekarang) — ambil yang audit_date-nya paling baru
function latestOf(entries) {
  if (!entries || !entries.length) return null;
  return [...entries].sort((a, b) => (b.audit_date || "").localeCompare(a.audit_date || ""))[0];
}

const ICON_PATHS = {
  wallet: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M17 12h2M3 10h18" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></>,
  arrowDown: <><path d="M12 5v13M6 13l6 5 6-5" /></>,
  arrowUp: <><path d="M12 19V6M6 11l6-5 6 5" /></>,
  fileDown: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M12 12v6M9.5 15.5L12 18l2.5-2.5" /></>,
  check: <><path d="M20 6L9 17l-5-5" /></>,
  alertCircle: <><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></>,
  alertTriangle: <><path d="M12 3l10 18H2L12 3z" /><path d="M12 9v5M12 17h.01" /></>,
};
function Icon({ name, size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      {ICON_PATHS[name]}
    </svg>
  );
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
  const [selectedEntryId, setSelectedEntryId] = useState(null);
  const [form, setForm] = useState({ saldo_sebelumnya: "", saldo_masuk: "", limit_kas: "", pengeluaran: "", sisa_saldo: "", cabang_baru: false, tidak_visit: false });
  const [editingLimit, setEditingLimit] = useState(false);
  const [limitDraft, setLimitDraft] = useState("");
  const [savingLimit, setSavingLimit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [filter, setFilter] = useState("all");
  const [viewPeriod, setViewPeriod] = useState(todayMonth());
  const [showExportAll, setShowExportAll] = useState(false);
  const [exportAllPeriod, setExportAllPeriod] = useState(null);
  const [exportBranchIds, setExportBranchIds] = useState([]);

  // Mode "lihat sebagai": seluruh isian dikunci. Pagar sungguhannya ada di
  // RLS — submitted_by wajib sama dengan pengguna yang benar-benar login.
  const canEdit = (profile.role === "auditor" || profile.role === "super_admin") && !profile?.liatSebagai;

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const { data: br, error: brErr } = await supabase.from("branches").select("*").order("name");
      if (brErr) throw brErr;
      setBranches(sortBranches(br || []));

      const { data: st } = await supabase.from("settings_keuangan").select("*").eq("id", 1).single();
      if (st) setSettings(st);

      // Auditor biasa cuma boleh liat/pake data audit yang dia submit sendiri — TAPI cuma
      // berlaku mulai Agustus 2026 ke depan. Data Jan-Jul 2026 (sebelum kebijakan ini) tetep
      // kebuka bareng buat semua auditor, nggak diisolasi retroaktif.
      const ISOLATION_START_PERIOD = "2026-08";
      let entriesQuery = supabase.from("audit_keuangan").select("*");
      if (profile?.role === "auditor") {
        entriesQuery = entriesQuery.or(`period.lt.${ISOLATION_START_PERIOD},submitted_by.eq.${profile.id}`);
      }
      const { data: entries, error: enErr } = await entriesQuery;
      if (enErr) throw enErr;
      const grouped = {};
      (entries || []).forEach((e) => {
        if (!grouped[e.branch_id]) grouped[e.branch_id] = {};
        if (!grouped[e.branch_id][e.period]) grouped[e.branch_id][e.period] = [];
        grouped[e.branch_id][e.period].push(e);
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
    setEditingLimit(false);
    selectPeriod(branch.id, viewPeriod);
  }

  function closeModal() {
    setSelectedBranch(null);
    setSelectedPeriod(null);
    setSelectedEntryId(null);
    setEditingLimit(false);
  }

  function applyEntryToFormK(e) {
    setForm({ saldo_sebelumnya: e.saldo_sebelumnya, saldo_masuk: e.saldo_masuk, limit_kas: e.limit_kas, pengeluaran: e.pengeluaran, sisa_saldo: e.sisa_saldo ?? "", cabang_baru: !!e.cabang_baru, tidak_visit: !!e.tidak_visit });
    setSelectedEntryId(e.id);
  }

  function selectPeriod(branchId, period) {
    setSelectedPeriod(period);
    const entriesHere = (entriesByBranch[branchId] || {})[period] || [];
    const branch = branches.find((b) => b.id === branchId);
    if (entriesHere.length) {
      applyEntryToFormK(latestOf(entriesHere));
      return;
    }
    const prevEntries = (entriesByBranch[branchId] || {})[getPrevPeriod(period)] || [];
    const prevEntry = latestOf(prevEntries);
    const carryForward = prevEntry
      ? (prevEntry.sisa_saldo !== undefined && prevEntry.sisa_saldo !== null
          ? parseFloat(prevEntry.sisa_saldo) || 0
          : (parseFloat(prevEntry.saldo_sebelumnya) || 0) + (parseFloat(prevEntry.saldo_masuk) || 0) - (parseFloat(prevEntry.pengeluaran) || 0))
      : "";
    setForm({ saldo_sebelumnya: carryForward, saldo_masuk: "", limit_kas: branch?.limit_kas || "", pengeluaran: "", sisa_saldo: "", cabang_baru: false, tidak_visit: false });
    setSelectedEntryId(null);
  }

  function startNewEntryK() {
    const prevEntries = (entriesByBranch[selectedBranch.id] || {})[getPrevPeriod(selectedPeriod)] || [];
    const prevEntry = latestOf(prevEntries);
    const carryForward = prevEntry
      ? (prevEntry.sisa_saldo !== undefined && prevEntry.sisa_saldo !== null
          ? parseFloat(prevEntry.sisa_saldo) || 0
          : (parseFloat(prevEntry.saldo_sebelumnya) || 0) + (parseFloat(prevEntry.saldo_masuk) || 0) - (parseFloat(prevEntry.pengeluaran) || 0))
      : "";
    setForm({ saldo_sebelumnya: carryForward, saldo_masuk: "", limit_kas: selectedBranch?.limit_kas || "", pengeluaran: "", sisa_saldo: "", cabang_baru: false, tidak_visit: false });
    setSelectedEntryId(null);
    setSavedFlash(false);
  }

  // true kalau ini audit pertama untuk cabang ini (belum ada histori sama sekali untuk narik saldo)
  const isFirstEverEntry = selectedBranch && selectedPeriod
    ? !((entriesByBranch[selectedBranch.id] || {})[selectedPeriod] || []).length && !((entriesByBranch[selectedBranch.id] || {})[getPrevPeriod(selectedPeriod)] || []).length
    : false;

  async function saveLimitOnly() {
    if (!selectedBranch) return;
    setSavingLimit(true);
    setError(null);
    try {
      const newLimit = parseFloat(limitDraft) || 0;
      const { error: err } = await supabase.from("branches").update({ limit_kas: newLimit }).eq("id", selectedBranch.id);
      if (err) throw err;
      setBranches((prev) => prev.map((b) => (b.id === selectedBranch.id ? { ...b, limit_kas: newLimit } : b)));
      setSelectedBranch((prev) => ({ ...prev, limit_kas: newLimit }));
      setForm((f) => ({ ...f, limit_kas: newLimit }));
      setEditingLimit(false);
    } catch (err) {
      setError("Gagal mengubah limit: " + err.message);
    } finally {
      setSavingLimit(false);
    }
  }

  async function deleteEntry() {
    const entriesHere = (entriesByBranch[selectedBranch.id] || {})[selectedPeriod] || [];
    const existing = entriesHere.find((e) => e.id === selectedEntryId) || latestOf(entriesHere);
    if (!existing) return;
    const isOwner = profile?.role === "auditor" && existing.submitted_by === profile?.id;
    if (profile?.role !== "super_admin" && !isOwner) return;
    if (!window.confirm(`Hapus audit ${selectedBranch.name} tanggal ${shortDate(existing.audit_date)}? Aksi ini tidak bisa dibatalkan.`)) return;
    setSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase.from("audit_keuangan").delete().eq("id", existing.id);
      if (err) throw err;
      const grouped = { ...entriesByBranch };
      const branchEntries = { ...(grouped[selectedBranch.id] || {}) };
      const remaining = (branchEntries[selectedPeriod] || []).filter((e) => e.id !== existing.id);
      if (remaining.length) branchEntries[selectedPeriod] = remaining;
      else delete branchEntries[selectedPeriod];
      grouped[selectedBranch.id] = branchEntries;
      setEntriesByBranch(grouped);
      if (remaining.length) applyEntryToFormK(latestOf(remaining));
      else startNewEntryK();
      setSavedFlash(false);
    } catch (err) {
      setError("Gagal menghapus: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveEntry() {
    if (!selectedBranch || !selectedPeriod) return;
    setSaving(true);
    setError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const payload = {
        branch_id: selectedBranch.id,
        period: selectedPeriod,
        audit_date: today,
        saldo_sebelumnya: parseFloat(form.saldo_sebelumnya) || 0,
        saldo_masuk: parseFloat(form.saldo_masuk) || 0,
        limit_kas: parseFloat(form.limit_kas) || 0,
        pengeluaran: parseFloat(form.pengeluaran) || 0,
        sisa_saldo: parseFloat(form.sisa_saldo) || 0,
        cabang_baru: form.cabang_baru,
        tidak_visit: form.tidak_visit,
        status: "draft",
        submitted_by: (await supabase.auth.getUser()).data.user.id,
      };
      let res;
      if (selectedEntryId) {
        const { audit_date, ...updatePayload } = payload; // jangan timpa tanggal audit asli pas cuma edit data
        res = await supabase.from("audit_keuangan").update(updatePayload).eq("id", selectedEntryId).select().single();
      } else {
        res = await supabase.from("audit_keuangan").insert(payload).select().single();
      }
      if (res.error) throw res.error;
      const grouped = { ...entriesByBranch };
      const branchEntries = { ...(grouped[selectedBranch.id] || {}) };
      const others = (branchEntries[selectedPeriod] || []).filter((e) => e.id !== res.data.id);
      branchEntries[selectedPeriod] = [...others, res.data];
      grouped[selectedBranch.id] = branchEntries;
      setEntriesByBranch(grouped);
      setSelectedEntryId(res.data.id);

      // Kalau cabang ini belum pernah punya limit kas tersimpan, kunci sekarang buat seterusnya
      if (!selectedBranch.limit_kas && payload.limit_kas > 0) {
        await supabase.from("branches").update({ limit_kas: payload.limit_kas }).eq("id", selectedBranch.id);
        setBranches((prev) => prev.map((b) => (b.id === selectedBranch.id ? { ...b, limit_kas: payload.limit_kas } : b)));
        setSelectedBranch((prev) => ({ ...prev, limit_kas: payload.limit_kas }));
      }

      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      setError("Gagal menyimpan: " + err.message + " (cek apakah RLS/role sudah benar)");
    } finally {
      setSaving(false);
    }
  }

  function exportReport() {
    const entriesHere = (entriesByBranch[selectedBranch.id] || {})[selectedPeriod] || [];
    const existing = latestOf(entriesHere);
    if (!existing) return;

    if (existing.tidak_visit) {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Laporan Audit</title><style>
        * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        body{font-family:Arial,Helvetica,sans-serif;color:#1A1D24;padding:60px;text-align:center;}
        .badge{display:inline-block;background:#88888822;color:#666;font-weight:800;font-size:16px;padding:10px 26px;border-radius:30px;margin-bottom:20px;}
      </style></head><body>
        <h1>Laporan Audit Kas Kecil</h1>
        <div class="badge">TIDAK VISIT</div>
        <div style="font-size:13px;color:#5B6270;">Cabang: ${esc(selectedBranch.name)} &middot; Bulan: ${esc(monthLabel(selectedPeriod))}</div>
        <p style="font-size:12.5px;color:#444;margin-top:20px;">Cabang ini tidak dikunjungi/tidak diaudit pada periode tersebut.</p>
        <script>window.onload=function(){setTimeout(function(){window.print();},350);}<\/script>
      </body></html>`;
      const w = window.open("", "_blank");
      if (!w) { alert("Popup diblokir. Izinkan popup lalu coba lagi."); return; }
      w.document.open(); w.document.write(html); w.document.close();
      return;
    }

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
    </style></head><body><div id="pdfZoom">
      <h1>Laporan Audit Kas Kecil</h1>
      <div style="font-size:13px;color:#5B6270;margin-bottom:20px">Cabang: ${esc(selectedBranch.name)} &middot; Bulan: ${esc(monthLabel(selectedPeriod))}</div>
      <table>${rowsHtml}</table>
      <div class="status">${esc(c.indikator)} &mdash; ${esc(c.keterangan)}</div>
      </div>
      <script>
        function fitToPage() {
          const zoomEl = document.getElementById("pdfZoom");
          const targetHeight = 1000;
          zoomEl.style.zoom = 1;
          const naturalHeight = zoomEl.scrollHeight;
          let zoom = targetHeight / naturalHeight;
          zoom = Math.min(zoom, 1.05);
          zoom = Math.max(zoom, 0.55);
          zoomEl.style.zoom = zoom;
          setTimeout(() => {
            const afterHeight = zoomEl.getBoundingClientRect().height;
            if (afterHeight > targetHeight + 4) {
              const corrected = Math.max((targetHeight / afterHeight) * zoom, 0.5);
              zoomEl.style.zoom = corrected;
            }
            setTimeout(() => window.print(), 250);
          }, 100);
        }
        window.onload = () => {
          const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
          fontsReady.then(fitToPage);
        };
      <\/script>
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
    const exportBranches = (exportBranchIds.length === 0 || exportBranchIds.length === branches.length)
      ? branches
      : branches.filter((b) => exportBranchIds.includes(b.id));

    const colorMap = { good: "#1a9e6e", warn: "#b07212", bad: "#a32020", none: "#888" };
    const BARU_COLOR = "#F4B740";
    const TV_COLOR = "#888";
    let totalSb = 0, totalSm = 0, totalLim = 0, totalPk = 0, totalSisa = 0, countFilled = 0, countBaru = 0, countTV = 0;
    const groupCount = { good: 0, warn: 0, bad: 0 };

    const tableRows = exportBranches.map((b, i) => {
      const e = latestOf((entriesByBranch[b.id] || {})[period]);
      if (!e) return { cells: [String(i + 1), b.name, null, null, null, null, null, null, null], badge: null };
      const isBaru = !!e.cabang_baru;
      const isTV = !!e.tidak_visit;
      if (isTV) {
        countTV++;
        countFilled++;
        return {
          cells: [String(i + 1), `${b.name} (TIDAK VISIT)`, "\u2014", "\u2014", "\u2014", "\u2014", "\u2014", "\u2014", "\u2014"],
          badge: { label: "TIDAK VISIT", color: TV_COLOR },
        };
      }
      const c = computeStatus(e, settings);
      totalSb += parseFloat(e.saldo_sebelumnya) || 0;
      totalSm += parseFloat(e.saldo_masuk) || 0;
      totalLim += parseFloat(e.limit_kas) || 0;
      totalPk += parseFloat(e.pengeluaran) || 0;
      totalSisa += c.sisa;
      countFilled++;
      if (isBaru) countBaru++;
      else groupCount[c.tone]++;
      return {
        cells: [
          String(i + 1), isBaru ? `\u2b50 ${b.name} (CABANG BARU)` : b.name,
          rupiah(e.saldo_sebelumnya), rupiah(e.saldo_masuk), rupiah(e.limit_kas), rupiah(e.pengeluaran), rupiah(c.sisa),
          pct(c.terpakai), pct(c.posisi),
        ],
        badge: isBaru ? { label: "CABANG BARU", color: BARU_COLOR } : { label: c.indikator, color: colorMap[c.tone] },
      };
    });

    const total = exportBranches.length;
    const scopeLabel = exportBranches.length === branches.length ? "SEMUA CABANG" : exportBranches.map((b) => b.name).join(", ").toUpperCase();
    const distDenom = countFilled;
    const donutSegments = [
      { label: "Terkendali / Efisien", count: groupCount.good, pct: distDenom ? Math.round((groupCount.good / distDenom) * 100) : 0, color: colorMap.good },
      { label: "Monitoring", count: groupCount.warn, pct: distDenom ? Math.round((groupCount.warn / distDenom) * 100) : 0, color: colorMap.warn },
      { label: "Pengecekan / Tindak Lanjut", count: groupCount.bad, pct: distDenom ? Math.round((groupCount.bad / distDenom) * 100) : 0, color: colorMap.bad },
      { label: "Cabang Baru", count: countBaru, pct: distDenom ? Math.round((countBaru / distDenom) * 100) : 0, color: BARU_COLOR },
    ].filter((s) => s.count > 0);

    const html = buildSummaryReportHtml({
      reportTitle: "LAPORAN AUDIT KAS KECIL",
      scopeLabel,
      periodLabel: monthLabel(period),
      printedAtLabel: new Date().toLocaleString("id-ID"),
      summaryCards: [
        { icon: "building", label: "TOTAL CABANG", value: String(total), sub: "Cabang", color: "#2A1F52" },
        { icon: "shieldCheck", label: "TERKENDALI / EFISIEN", value: String(groupCount.good), sub: `Cabang (${distDenom ? Math.round((groupCount.good / distDenom) * 100) : 0}%)`, color: colorMap.good },
        { icon: "alertCircle", label: "MONITORING", value: String(groupCount.warn), sub: `Cabang (${distDenom ? Math.round((groupCount.warn / distDenom) * 100) : 0}%)`, color: colorMap.warn },
        { icon: "alertTriangle", label: "PENGECEKAN / TINDAK LANJUT", value: String(groupCount.bad), sub: `Cabang (${distDenom ? Math.round((groupCount.bad / distDenom) * 100) : 0}%)`, color: colorMap.bad },
        ...(countBaru > 0 ? [{ icon: "building", label: "CABANG BARU", value: String(countBaru), sub: "Belum masuk itungan indikator", color: BARU_COLOR }] : []),
        ...(countTV > 0 ? [{ icon: "alertCircle", label: "TIDAK VISIT", value: String(countTV), sub: "Cabang", color: TV_COLOR }] : []),
      ],
      tableHeaders: ["No", "Cabang", "Saldo Sebelumnya", "Saldo Masuk", "Limit", "Pengeluaran", "Sisa Saldo", "% Terpakai", "% Posisi Kas", "Indikator"],
      tableRows,
      donutSegments,
      donutCenterLines: [String(total), "Cabang"],
      legendItems: [
        { icon: "shieldCheck", color: colorMap.good, title: "TERKENDALI / EFISIEN", desc: `Posisi kas \u2264 ${settings.efisien}%` },
        { icon: "alertCircle", color: colorMap.warn, title: "MONITORING", desc: `Posisi kas ${settings.efisien}% s.d. ${settings.monitoring}%` },
        { icon: "alertTriangle", color: colorMap.bad, title: "PENGECEKAN / TINDAK LANJUT", desc: `Posisi kas > ${settings.monitoring}% atau saldo minus` },
        ...(countBaru > 0 ? [{ icon: "building", color: BARU_COLOR, title: "CABANG BARU", desc: "Cabang baru dibuka, belum ikut dihitung ke indikator" }] : []),
      ],
      summaryList: [
        { icon: "arrowDown", label: "Total Saldo Sebelumnya", value: rupiah(totalSb) },
        { icon: "arrowDown", label: "Total Saldo Masuk", value: rupiah(totalSm) },
        { icon: "arrowUp", label: "Total Pengeluaran", value: rupiah(totalPk) },
        { icon: "wallet", label: "Total Sisa Saldo", value: rupiah(totalSisa), strong: true },
      ],
      notes: [
        `Laporan ini merupakan ringkasan hasil audit kas kecil untuk seluruh cabang pada bulan yang dipilih (${countFilled} dari ${total} cabang terisi).`,
        "Status indikator berdasarkan persentase posisi kas (pengeluaran dibanding total saldo tersedia) terhadap ambang batas yang ditetapkan.",
        `Harap lakukan tindak lanjut untuk cabang dengan indikator "Pengecekan" atau "Tindak Lanjut".`,
        ...(countBaru > 0 ? [`${countBaru} cabang ditandai "CABANG BARU" \u2014 datanya masih nol/minim karena baru dibuka, tidak ikut dihitung ke persentase distribusi indikator di atas.`] : []),
      ],
      pageLabel: "Halaman 1 dari 1",
    });

    const opened = openPrintWindow("Laporan Audit Kas Kecil", html);
    if (!opened) { alert("Popup diblokir. Izinkan popup lalu coba lagi."); return; }
    setShowExportAll(false);
  }

  const currentEntry = selectedBranch ? latestOf((entriesByBranch[selectedBranch.id] || {})[selectedPeriod]) : null;
  const current = computeStatus(selectedPeriod ? { ...(currentEntry || {}), ...form } : null, settings);
  const sisaHitung = (parseFloat(form.saldo_sebelumnya) || 0) + (parseFloat(form.saldo_masuk) || 0) - (parseFloat(form.pengeluaran) || 0);

  const visibleBranches = branches.filter((b) => {
    if (filter === "all") return true;
    const e = latestOf((entriesByBranch[b.id] || {})[viewPeriod]);
    const st = e && !e.tidak_visit ? computeStatus(e, settings) : null;
    const tone = st ? st.tone : "none";
    return tone === filter;
  });

  if (loading) return <div style={{ padding: 40, color: "var(--text-secondary)" }}>Memuat data\u2026</div>;

  // ── Tampilan: halaman penuh isi audit (bukan modal lagi) ──
  if (selectedBranch) {
    return (
      <div style={{ flex: 1 }}>
        <div style={{ background: "var(--surface)", padding: "16px 28px", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, zIndex: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div>
              <button className="btn-ghost" style={{ marginBottom: 8, fontSize: 12.5 }} onClick={closeModal}>&larr; Pilih cabang lain</button>
              <div className="display" style={{ fontSize: 19, fontWeight: 600 }}>Audit Keuangan &mdash; {selectedBranch.name}</div>
              <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                Bulan: {monthLabel(selectedPeriod)}
                {selectedEntryId ? <span> &middot; mengedit audit tanggal {shortDate(currentEntry?.audit_date)}</span> : <span> &middot; audit baru</span>}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div>
                <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-secondary)", marginBottom: 3 }}>
                  <Icon name="calendar" size={13} /> Bulan audit
                </label>
                <input type="month" className="input" value={selectedPeriod || ""} onChange={(e) => selectPeriod(selectedBranch.id, e.target.value)} />
              </div>
              {canEdit && (
                <button className="btn" disabled={saving} onClick={saveEntry} style={{ alignSelf: "flex-end" }}>
                  {saving ? "Menyimpan\u2026" : savedFlash ? "\u2713 Tersimpan" : "Simpan"}
                </button>
              )}
              {(profile?.role === "super_admin" || (profile?.role === "auditor" && ((entriesByBranch[selectedBranch?.id] || {})[selectedPeriod] || []).find((e) => e.id === selectedEntryId)?.submitted_by === profile?.id)) && selectedEntryId && (
                <button className="btn-ghost" disabled={saving} onClick={deleteEntry} style={{ alignSelf: "flex-end", color: "var(--danger-text)" }}>
                  Hapus Data
                </button>
              )}
              <button className="btn-ghost" disabled={!currentEntry} onClick={exportReport} title="Export PDF" style={{ alignSelf: "flex-end", display: "flex", alignItems: "center", gap: 6 }}>
                <Icon name="fileDown" size={15} />
              </button>
            </div>
          </div>
        </div>

        {error && <div style={{ margin: "14px 28px 0", background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}

        <div style={{ padding: 24 }}>
          {((entriesByBranch[selectedBranch.id] || {})[selectedPeriod] || []).length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
                Riwayat audit {monthLabel(selectedPeriod)} ({((entriesByBranch[selectedBranch.id] || {})[selectedPeriod] || []).length})
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[...((entriesByBranch[selectedBranch.id] || {})[selectedPeriod] || [])]
                  .sort((a, b) => (a.audit_date || "").localeCompare(b.audit_date || ""))
                  .map((e, i) => {
                    const isTV = e.tidak_visit;
                    const st = !isTV ? computeStatus(e, settings) : null;
                    const active = e.id === selectedEntryId;
                    return (
                      <div
                        key={e.id}
                        onClick={() => applyEntryToFormK(e)}
                        style={{
                          cursor: "pointer", padding: "8px 14px", borderRadius: 10,
                          border: `1.5px solid ${active ? "#7c3aed" : "var(--border)"}`,
                          background: active ? "#7c3aed14" : "var(--surface)",
                          display: "flex", alignItems: "center", gap: 8,
                        }}
                      >
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)" }}>Audit {i + 1}</span>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{shortDate(e.audit_date)}</span>
                        {e.cabang_baru && <span style={{ fontSize: 10, fontWeight: 700, color: "#F4B740" }}>⭐ Baru</span>}
                        {isTV ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#888" }}>Tidak Visit</span>
                        ) : (
                          <>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: TONE[st.tone].dot }} />
                            <span style={{ fontSize: 12, fontWeight: 700, color: TONE[st.tone].dot }}>{pct(st.posisi)}</span>
                          </>
                        )}
                      </div>
                    );
                  })}
                {canEdit && (
                  <div
                    onClick={startNewEntryK}
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

          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, cursor: canEdit ? "pointer" : "default", fontSize: 13, color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={form.tidak_visit} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, tidak_visit: e.target.checked }))} />
            Cabang ini tidak dikunjungi bulan ini (Tidak Visit)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, cursor: canEdit ? "pointer" : "default", fontSize: 13, color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={form.cabang_baru} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, cabang_baru: e.target.checked }))} />
            Cabang Baru <span style={{ color: "var(--text-faint)" }}>(tetap dihitung normal, cuma ditandai di laporan)</span>
          </label>

          {!form.tidak_visit && (
          <>
          <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 16, marginBottom: 16, alignItems: "start" }}>

            {/* Card 1: Input data */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5, color: "#7c3aed", marginBottom: 2 }}>1. INPUT DATA</div>
              <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 16 }}>Isi data kas kecil pada periode audit ini</div>

              {isFirstEverEntry ? (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 7 }}>
                    <Icon name="history" size={13} /> Saldo sebelumnya (audit pertama cabang ini)
                  </label>
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-faint)", fontSize: 14.5 }}>Rp</span>
                    <input className="input" type="text" inputMode="numeric" placeholder="0" disabled={!canEdit} value={formatThousands(form.saldo_sebelumnya)} onChange={(e) => setForm({ ...form, saldo_sebelumnya: parseThousands(e.target.value) })} style={{ paddingLeft: 36, padding: "14px 14px 14px 36px", fontSize: 15.5 }} />
                  </div>
                </div>
              ) : (
                <div style={{ background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11.5, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 5 }}>
                    <Icon name="history" size={13} /> Saldo sebelumnya <span style={{ color: "var(--text-faint)" }}>(otomatis)</span>
                  </span>
                  <span className="mono" style={{ fontSize: 13.5, fontWeight: 600 }}>{rupiah(form.saldo_sebelumnya)}</span>
                </div>
              )}

              {!selectedBranch.limit_kas && (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 7 }}>
                    <Icon name="wallet" size={13} /> Limit kas kecil cabang ini (baru, sekali diisi lalu terkunci)
                  </label>
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-faint)", fontSize: 14.5 }}>Rp</span>
                    <input className="input" type="text" inputMode="numeric" placeholder="0" disabled={!canEdit} value={formatThousands(form.limit_kas)} onChange={(e) => setForm({ ...form, limit_kas: parseThousands(e.target.value) })} style={{ paddingLeft: 36, padding: "14px 14px 14px 36px", fontSize: 15.5 }} />
                  </div>
                </div>
              )}

              {selectedBranch.limit_kas > 0 && profile?.role === "super_admin" && (
                editingLimit ? (
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 7 }}>
                      <Icon name="wallet" size={13} /> Ubah limit kas kecil <span style={{ color: "var(--text-faint)" }}>(khusus Super Admin)</span>
                    </label>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <div style={{ position: "relative", flex: 1 }}>
                        <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-faint)", fontSize: 14.5 }}>Rp</span>
                        <input className="input" type="text" inputMode="numeric" placeholder="0" value={formatThousands(limitDraft)} onChange={(e) => setLimitDraft(parseThousands(e.target.value))} style={{ paddingLeft: 36, padding: "14px 14px 14px 36px", fontSize: 15.5 }} autoFocus />
                      </div>
                      <button className="btn" disabled={savingLimit} onClick={saveLimitOnly}>{savingLimit ? "..." : "Simpan"}</button>
                      <button className="btn-ghost" onClick={() => setEditingLimit(false)}>Batal</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, fontSize: 11.5, color: "var(--text-faint)" }}>
                    <span>Limit kas kecil: <span className="mono" style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{rupiah(selectedBranch.limit_kas)}</span></span>
                    <span onClick={() => { setLimitDraft(String(selectedBranch.limit_kas)); setEditingLimit(true); }} style={{ cursor: "pointer", color: "#F4B740", textDecoration: "underline" }}>Ubah</span>
                  </div>
                )
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
                <div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 7 }}>
                    <Icon name="arrowDown" size={13} /> Saldo masuk
                  </label>
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-faint)", fontSize: 14.5 }}>Rp</span>
                    <input className="input" type="text" inputMode="numeric" placeholder="0" disabled={!canEdit} value={formatThousands(form.saldo_masuk)} onChange={(e) => setForm({ ...form, saldo_masuk: parseThousands(e.target.value) })} style={{ paddingLeft: 36, padding: "14px 14px 14px 36px", fontSize: 15.5 }} />
                  </div>
                </div>
                <div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 7 }}>
                    <Icon name="arrowUp" size={13} /> Pengeluaran
                  </label>
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-faint)", fontSize: 14.5 }}>Rp</span>
                    <input className="input" type="text" inputMode="numeric" placeholder="0" disabled={!canEdit} value={formatThousands(form.pengeluaran)} onChange={(e) => setForm({ ...form, pengeluaran: parseThousands(e.target.value) })} style={{ paddingLeft: 36, padding: "14px 14px 14px 36px", fontSize: 15.5 }} />
                  </div>
                </div>
              </div>

              <div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 7 }}>
                  <Icon name="wallet" size={13} /> Sisa saldo (hitung fisik uang kas)
                </label>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-faint)", fontSize: 14.5 }}>Rp</span>
                  <input className="input" type="text" inputMode="numeric" placeholder="0" disabled={!canEdit} value={formatThousands(form.sisa_saldo)} onChange={(e) => setForm({ ...form, sisa_saldo: parseThousands(e.target.value) })} style={{ paddingLeft: 36, padding: "14px 14px 14px 36px", fontSize: 15.5 }} />
                </div>
                {canEdit && (
                  <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 5 }}>
                    Hasil hitungan rumus: {rupiah(sisaHitung)}{" "}
                    <span onClick={() => setForm((f) => ({ ...f, sisa_saldo: String(Math.round(sisaHitung)) }))} style={{ cursor: "pointer", color: "#F4B740", textDecoration: "underline" }}>
                      pakai ini
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Card 2: Hasil perhitungan */}
            {current && (
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5, color: "#7c3aed", marginBottom: 2 }}>2. HASIL PERHITUNGAN</div>
                <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 16 }}>Dihitung otomatis dari data di samping</div>

                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>Sisa Saldo</div>
                    <div style={{ fontSize: 20, fontWeight: 800 }}>{rupiah(current.sisa)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>% Posisi Kas</div>
                    <div style={{ fontSize: 26, fontWeight: 800, color: TONE[current.tone].dot }}>{pct(current.posisi)}</div>
                  </div>
                </div>
                <div style={{ height: 6, background: "var(--border)", borderRadius: 4, overflow: "hidden", marginBottom: 16 }}>
                  <div style={{ height: "100%", width: `${Math.min(current.posisi * 100, 100)}%`, background: TONE[current.tone].dot, transition: "width .2s" }} />
                </div>

                <div style={{ background: TONE[current.tone].bg, borderRadius: 8, padding: "9px 12px", marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, color: TONE[current.tone].text, marginBottom: 2 }}>{current.indikator}</div>
                  <div style={{ fontSize: 12.5, color: TONE[current.tone].text }}>{current.keterangan}</div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
                  <ThresholdLegend color={TONE.good.dot} label="Terkendali" range={`0 \u2013 ${settings.terkendali}%`} />
                  <ThresholdLegend color={TONE.good.dot} label="Efisien" range={`${settings.terkendali} \u2013 ${settings.efisien}%`} />
                  <ThresholdLegend color={TONE.warn.dot} label="Monitoring" range={`${settings.efisien} \u2013 ${settings.monitoring}%`} />
                  <ThresholdLegend color={TONE.bad.dot} label="Tindak Lanjut" range={`> ${settings.monitoring}%`} />
                </div>
                <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 10 }}>Kas kecil minus otomatis jadi status "Pengecekan", terlepas dari ambang di atas.</div>
              </div>
            )}
          </div>

          {/* Card 3: Riwayat */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5, color: "#7c3aed", marginBottom: 14 }}>3. RIWAYAT POSISI KAS SEMUA BULAN</div>
            <KeuanganHistoryChart entriesByBranch={entriesByBranch} branchId={selectedBranch.id} settings={settings} />
          </div>
          </>
          )}

          {savedFlash && <div style={{ color: "var(--success-text)", fontSize: 13, marginTop: 10 }}>Tersimpan \u2713</div>}
        </div>
      </div>
    );
  }

  // ── Tampilan: daftar cabang ──
  return (
    <div style={{ flex: 1 }}>
      <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Audit Keuangan</div>
          <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>Pemantauan penggunaan kas kecil per cabang, per bulan</div>
        </div>
        <button className="btn" onClick={() => { setExportAllPeriod(allPeriods()[0] || null); setExportBranchIds(branches.map((b) => b.id)); setShowExportAll(true); }}>
          Export Semua Cabang (PDF)
        </button>
      </div>

      {error && <div style={{ margin: "14px 28px 0", background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}

      <div style={{ padding: "20px 28px" }}>
        {(() => {
          const stats = branches.map((b) => latestOf((entriesByBranch[b.id] || {})[viewPeriod])).map((e) => (e ? computeStatus(e, settings) : null));
          const audited = stats.filter(Boolean);
          const auditedCount = audited.length;
          const avgPosisi = auditedCount ? audited.reduce((s, c) => s + c.posisi, 0) / auditedCount : null;
          const alertCount = audited.filter((c) => c.tone === "bad").length;
          return (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 20 }}>
              <SummaryCard label="Cabang sudah diaudit" value={`${auditedCount} / ${branches.length}`} />
              <SummaryCard label="Rata-rata Posisi Kas" value={avgPosisi !== null ? pct(avgPosisi) : "\u2014"} />
              <SummaryCard label="Perlu Pengecekan (alert)" value={alertCount} color={alertCount > 0 ? "var(--danger-text)" : "#1a9e6e"} />
            </div>
          );
        })()}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.4 }}>
            Pilih cabang untuk audit ({visibleBranches.length})
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 8, padding: "4px 6px" }}>
              <button className="btn-ghost" onClick={() => setViewPeriod(addMonthsToPeriod(viewPeriod, -1))} style={{ padding: "6px 10px" }}>{"<"}</button>
              <div className="mono" style={{ fontWeight: 600, minWidth: 130, textAlign: "center", fontSize: 13.5 }}>{monthLabel(viewPeriod)}</div>
              <button className="btn-ghost" onClick={() => setViewPeriod(addMonthsToPeriod(viewPeriod, 1))} style={{ padding: "6px 10px" }}>{">"}</button>
            </div>
            <select className="input" style={{ width: 200 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
              {FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 14 }}>
          {visibleBranches.map((b) => {
            const entriesHere = (entriesByBranch[b.id] || {})[viewPeriod] || [];
            const e = latestOf(entriesHere);
            const isTV = e && e.tidak_visit;
            const st = e && !isTV ? computeStatus(e, settings) : null;
            const tone = isTV ? "none" : (st ? st.tone : "none");
            const toneIcon = tone === "good" ? "check" : tone === "warn" ? "alertCircle" : tone === "bad" ? "alertTriangle" : "wallet";
            return (
              <div
                key={b.id}
                onClick={() => openBranch(b)}
                style={{ position: "relative", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", cursor: "pointer", overflow: "hidden" }}
              >
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: isTV ? "#888" : (tone === "none" ? "linear-gradient(90deg, #7c3aed, #F4B740)" : TONE[tone].dot) }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div className="display" style={{ fontSize: 15.5, fontWeight: 600 }}>{b.name}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {e && e.cabang_baru && (
                      <span style={{ fontSize: 9.5, fontWeight: 700, color: "#F4B740", background: "#F4B74022", padding: "2px 7px", borderRadius: 20, flexShrink: 0 }}>Cabang Baru</span>
                    )}
                    {entriesHere.length > 1 && (
                      <span style={{ fontSize: 9.5, fontWeight: 700, color: "#7c3aed", background: "#7c3aed18", padding: "2px 7px", borderRadius: 20, flexShrink: 0 }}>{entriesHere.length} audit</span>
                    )}
                    {!isTV && (
                      <div style={{ width: 26, height: 26, borderRadius: 8, background: TONE[tone].bg, color: TONE[tone].dot, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Icon name={toneIcon} size={14} />
                      </div>
                    )}
                  </div>
                </div>
                {isTV ? (
                  <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, background: "#88888822", color: "#888", fontSize: 11.5, fontWeight: 600, marginBottom: 10 }}>Tidak Visit</span>
                ) : (
                  <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, background: TONE[tone].bg, color: TONE[tone].text, fontSize: 11.5, fontWeight: 600, marginBottom: 10 }}>
                    {st ? st.indikator : "Belum diisi"}
                  </span>
                )}
                <div style={{ height: 1, background: "var(--border)", margin: "10px 0" }} />
                <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                  {e ? (isTV ? `${shortDate(e.audit_date) !== "\u2014" ? shortDate(e.audit_date) : monthLabel(viewPeriod)}` : `Sisa ${rupiah(st.sisa)} \u00b7 ${shortDate(e.audit_date) !== "\u2014" ? shortDate(e.audit_date) : monthLabel(viewPeriod)}`) : "Belum ada audit pada periode ini"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showExportAll && (
        <div style={{ position: "fixed", inset: 0, background: "var(--overlay)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setShowExportAll(false)}>
          <div style={{ background: "var(--surface)", borderRadius: 14, padding: 24, width: 400, maxWidth: "92%" }} onClick={(e) => e.stopPropagation()}>
            <div className="display" style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Export laporan cabang</div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 5 }}>Bulan</label>
              {allPeriods().length ? (
                <select className="input" value={exportAllPeriod || ""} onChange={(e) => setExportAllPeriod(e.target.value)}>
                  {allPeriods().map((p) => <option key={p} value={p}>{monthLabel(p)}</option>)}
                </select>
              ) : (
                <div style={{ fontSize: 13, color: "var(--text-faint)" }}>Belum ada data tersimpan di cabang manapun.</div>
              )}
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 5 }}>Cabang</label>
              <BranchMultiSelect branches={branches} selectedIds={exportBranchIds} onChange={setExportBranchIds} />
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

function KeuanganHistoryChart({ entriesByBranch, branchId, settings }) {
  const byPeriod = entriesByBranch[branchId] || {};
  const shown = Object.keys(byPeriod)
    .sort()
    .map((period) => {
      const latest = latestOf(byPeriod[period]);
      return latest ? { period, posisi: computeStatus(latest, settings)?.posisi || 0 } : null;
    })
    .filter(Boolean);

  if (shown.length < 2) {
    return <div style={{ fontSize: 12.5, color: "var(--text-faint)", padding: "40px 0", textAlign: "center" }}>Belum cukup riwayat buat ditampilkan sebagai grafik.</div>;
  }

  const H = 220, padL = 46, padR = 16, padT = 20, padB = 30;
  const colWidth = 70;
  const W = Math.max(640, padL + padR + (shown.length - 1) * colWidth);
  const maxVal = Math.max(...shown.map((p) => p.posisi), settings.monitoring / 100) * 1.15;
  const xStep = (W - padL - padR) / (shown.length - 1);
  const xAt = (i) => padL + i * xStep;
  const yAt = (v) => padT + (1 - v / maxVal) * (H - padT - padB);

  const linePoints = shown.map((p, i) => `${xAt(i)},${yAt(p.posisi)}`).join(" ");
  const areaPoints = `${padL},${yAt(0)} ${linePoints} ${xAt(shown.length - 1)},${yAt(0)}`;
  const yTicks = [0, maxVal * 0.25, maxVal * 0.5, maxVal * 0.75, maxVal];
  const labelEvery = Math.ceil(shown.length / 9);

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, height: "auto", minWidth: "100%" }}>
        <defs>
          <linearGradient id="posisiFill" x1="0" y1="0" x2="0" y2="1">
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
        <polygon points={areaPoints} fill="url(#posisiFill)" />
        <polyline points={linePoints} fill="none" stroke="#7c3aed" strokeWidth="2" />
        {shown.map((p, i) => {
          const isLast = i === shown.length - 1;
          const showLabel = i % labelEvery === 0 || isLast;
          return (
            <g key={i}>
              <circle cx={xAt(i)} cy={yAt(p.posisi)} r={isLast ? 4 : 3} fill={isLast ? "#F4B740" : "#7c3aed"} />
              {showLabel && <text x={xAt(i)} y={yAt(p.posisi) - 10} textAnchor="middle" fontSize="10" fontWeight="700" fill={isLast ? "#F4B740" : "var(--text-secondary)"}>{(p.posisi * 100).toFixed(0)}%</text>}
              {showLabel && <text x={xAt(i)} y={H - 10} textAnchor="middle" fontSize="9.5" fill="var(--text-faint)">{monthLabel(p.period)}</text>}
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
