import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import {
  INVENTARIS_CATEGORIES, freshInventaris, normalizeInventaris, countRusak,
  uploadInventarisMedia, InventarisChecklist,
} from "./AuditInventaris";

function nowPeriode() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
}
function periodeLabel(p) {
  if (!p) return "\u2014";
  const [y, m] = p.split("-");
  return new Date(+y, +m - 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
}
function addMonthsToPeriod(period, delta) {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function newStockRow() { return { nama: "", status: "Lengkap", keterangan: "" }; }

// Sama persis dengan pola threshold di components/sop/SopKepatuhan.js
function kategoriInfo(pct) {
  const v = pct * 100;
  if (v >= 90) return { lbl: "Sangat Baik", color: "#1a9e6e" };
  if (v >= 80) return { lbl: "Baik", color: "#2f9e46" };
  if (v >= 70) return { lbl: "Cukup", color: "#b07212" };
  return { lbl: "Perlu Perbaikan", color: "#a32020" };
}

export default function BeritaAcara({ profile }) {
  const canEdit = profile?.role === "auditor" || profile?.role === "super_admin";

  const [branches, setBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [allRecords, setAllRecords] = useState([]);
  const [viewPeriod, setViewPeriod] = useState(nowPeriode());
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [existingRow, setExistingRow] = useState(null);
  const [existingInventarisRow, setExistingInventarisRow] = useState(null);

  const [waktuAudit, setWaktuAudit] = useState("");
  const [kegiatan, setKegiatan] = useState("Audit Stock Opname, SOP, Inventaris, Kas Kecil, dan Report Penjualan");
  const [perlengkapan, setPerlengkapan] = useState("Laptop dan Scanner");
  const [stockKat1, setStockKat1] = useState([]);
  const [stockKat2, setStockKat2] = useState([]);
  const [inventaris, setInventaris] = useState(freshInventaris());
  const [storeManagerName, setStoreManagerName] = useState("");
  const [storeLeaderName, setStoreLeaderName] = useState("");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [uploadingKey, setUploadingKey] = useState(null);

  useEffect(() => { loadBranches(); }, []);

  async function loadBranches() {
    setLoadingBranches(true);
    const { data, error: err } = await supabase.from("branches").select("*").order("name");
    if (!err) setBranches(data || []);
    const { data: recs, error: recErr } = await supabase.from("berita_acara").select("*");
    if (!recErr) setAllRecords(recs || []);
    setLoadingBranches(false);
  }

  async function pickBranch(b) {
    setSelectedBranch(b);
    setSaved(false);
    setError(null);
    setLoadingRecord(true);
    const [beRes, invRes] = await Promise.all([
      supabase.from("berita_acara").select("*").eq("branch_id", b.id).eq("period", viewPeriod).maybeSingle(),
      supabase.from("audit_generic").select("*").eq("module", "inventaris").eq("branch_id", b.id).eq("period", viewPeriod).maybeSingle(),
    ]);
    if (!beRes.error && beRes.data) {
      setExistingRow(beRes.data);
      setWaktuAudit(beRes.data.waktu_audit || "");
      setKegiatan(beRes.data.kegiatan || "Audit Stock Opname, SOP, Inventaris, Kas Kecil, dan Report Penjualan");
      setPerlengkapan(beRes.data.perlengkapan || "Laptop dan Scanner");
      setStockKat1(Array.isArray(beRes.data.stock_opname_kat1) ? beRes.data.stock_opname_kat1 : []);
      setStockKat2(Array.isArray(beRes.data.stock_opname_kat2) ? beRes.data.stock_opname_kat2 : []);
      setStoreManagerName(beRes.data.store_manager_name || "");
      setStoreLeaderName(beRes.data.store_leader_name || "");
    } else {
      setExistingRow(null);
      setWaktuAudit("");
      setKegiatan("Audit Stock Opname, SOP, Inventaris, Kas Kecil, dan Report Penjualan");
      setPerlengkapan("Laptop dan Scanner");
      setStockKat1([]);
      setStockKat2([]);
      setStoreManagerName("");
      setStoreLeaderName("");
    }
    if (!invRes.error && invRes.data) {
      setExistingInventarisRow(invRes.data);
      setInventaris(normalizeInventaris(invRes.data.data?.categories));
    } else {
      setExistingInventarisRow(null);
      setInventaris(freshInventaris());
    }
    setLoadingRecord(false);
  }

  function backToList() {
    setSelectedBranch(null);
    setExistingRow(null);
    setExistingInventarisRow(null);
    loadBranches();
  }

  // ── Stock Opname (Kategori 1 & 2) row helpers ──
  function addRow(setter) { setter((prev) => [...prev, newStockRow()]); setSaved(false); }
  function updateRow(setter, i, field, val) {
    setter((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));
    setSaved(false);
  }
  function removeRow(setter, i) { setter((prev) => prev.filter((_, idx) => idx !== i)); setSaved(false); }

  // ── Inventaris helpers ──
  function updateInventaris(cat, field, val) {
    setInventaris((prev) => ({ ...prev, [cat]: { ...prev[cat], [field]: val } }));
    setSaved(false);
  }
  async function handleUploadInventarisMedia(cat, fileList) {
    if (!selectedBranch) return;
    const key = `inv-${cat}`;
    setUploadingKey(key);
    setError(null);
    try {
      const uploaded = await uploadInventarisMedia({ branchId: selectedBranch.id, period: viewPeriod, cat, fileList });
      if (uploaded.length) {
        setInventaris((prev) => ({ ...prev, [cat]: { ...prev[cat], photos: [...(prev[cat].photos || []), ...uploaded] } }));
        setSaved(false);
      }
    } catch (err) {
      setError("Gagal upload: " + err.message);
    } finally {
      setUploadingKey(null);
    }
  }
  function removeInventarisMedia(cat, mediaIdx) {
    setInventaris((prev) => {
      const photos = [...(prev[cat].photos || [])];
      photos.splice(mediaIdx, 1);
      return { ...prev, [cat]: { ...prev[cat], photos } };
    });
    setSaved(false);
  }

  async function saveRecord() {
    if (!canEdit) { setError("Kamu tidak punya izin untuk menyimpan."); return; }
    setSaving(true);
    setError(null);
    try {
      const user = (await supabase.auth.getUser()).data.user;

      const beritaPayload = {
        branch_id: selectedBranch.id,
        period: viewPeriod,
        waktu_audit: waktuAudit,
        kegiatan,
        perlengkapan,
        stock_opname_kat1: stockKat1,
        stock_opname_kat2: stockKat2,
        store_manager_name: storeManagerName,
        store_leader_name: storeLeaderName,
        submitted_by: user.id,
        updated_at: new Date().toISOString(),
      };
      const beRes = await supabase.from("berita_acara").upsert(beritaPayload, { onConflict: "branch_id,period" }).select().single();
      if (beRes.error) throw beRes.error;

      const invPayload = {
        module: "inventaris",
        branch_id: selectedBranch.id,
        period: viewPeriod,
        status: "submitted",
        submitted_by: user.id,
        data: { tidak_visit: false, categories: inventaris, auditor_name: profile?.full_name || null },
      };
      const invRes = await supabase.from("audit_generic").upsert(invPayload, { onConflict: "module,branch_id,period" }).select().single();
      if (invRes.error) throw invRes.error;

      setExistingRow(beRes.data);
      setExistingInventarisRow(invRes.data);
      setSaved(true);
    } catch (err) {
      setError("Gagal menyimpan: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecord() {
    if (!existingRow || profile?.role !== "super_admin") return;
    if (!window.confirm(`Hapus Berita Acara ${selectedBranch.name} periode ${periodeLabel(viewPeriod)}? Aksi ini tidak bisa dibatalkan.`)) return;
    setSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase.from("berita_acara").delete().eq("id", existingRow.id);
      if (err) throw err;
      if (existingInventarisRow) {
        await supabase.from("audit_generic").delete().eq("id", existingInventarisRow.id);
      }
      setExistingRow(null);
      setExistingInventarisRow(null);
      setStockKat1([]);
      setStockKat2([]);
      setInventaris(freshInventaris());
      setSaved(false);
    } catch (err) {
      setError("Gagal menghapus: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  function exportPDF() {
    if (!selectedBranch) return;
    const printDate = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

    function catPct(rows) {
      if (!rows.length) return null;
      const selisih = rows.filter((r) => r.status === "Selisih").length;
      return Math.round(((rows.length - selisih) / rows.length) * 100);
    }

    const stockSelisihCount = [...stockKat1, ...stockKat2].filter((r) => r.status === "Selisih").length;
    const stockTotalCount = stockKat1.length + stockKat2.length;
    const stockPct = stockTotalCount ? Math.round(((stockTotalCount - stockSelisihCount) / stockTotalCount) * 100) : 0;
    const stockInfo = kategoriInfo(stockPct / 100);
    const kat1Pct = catPct(stockKat1);
    const kat2Pct = catPct(stockKat2);
    const kat1Color = kat1Pct === null ? "#999" : kategoriInfo(kat1Pct / 100).color;
    const kat2Color = kat2Pct === null ? "#999" : kategoriInfo(kat2Pct / 100).color;

    const invRusakCount = countRusak(inventaris);
    const invTotalCount = INVENTARIS_CATEGORIES.length;
    const invPct = invTotalCount ? Math.round(((invTotalCount - invRusakCount) / invTotalCount) * 100) : 0;
    const invInfo = kategoriInfo(invPct / 100);
    const invTidakPct = 100 - invPct;

    function stockTable(title, rows) {
      const body = rows.map((r) => {
        const isBad = r.status === "Selisih";
        return `<tr>
          <td style="font-weight:600;">${esc(r.nama) || "\u2014"}</td>
          <td class="${isBad ? "status-bad" : "status-ok"}">${isBad ? "SELISIH" : "LENGKAP"}</td>
          <td>${esc(r.keterangan) || "-"}</td>
        </tr>`;
      }).join("") || `<tr><td colspan="3" style="text-align:center;color:#999;padding:10px;">Tidak ada baris diisi</td></tr>`;
      return `<tr class="kat-row"><td colspan="3">${esc(title)}</td></tr>${body}`;
    }

    const invRows = INVENTARIS_CATEGORIES.map((cat) => {
      const row = inventaris[cat] || { status: "Berfungsi", keterangan: "" };
      const isBad = row.status === "Rusak";
      return `<tr>
        <td style="font-weight:600;">${esc(cat)}</td>
        <td class="${isBad ? "status-bad" : "status-ok"}">${isBad ? "SELISIH" : "LENGKAP"}</td>
        <td>${esc(row.keterangan) || "-"}</td>
      </tr>`;
    }).join("");

    const ICON = {
      store: `<svg viewBox="0 0 24 24" fill="none" stroke="#2A1F52" stroke-width="2.4"><path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v10a1 1 0 001 1h14a1 1 0 001-1V9"/></svg>`,
      calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="#2A1F52" stroke-width="2.4"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>`,
      person: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>`,
      people: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/></svg>`,
      clipboard: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4"><rect x="6" y="4" width="12" height="17" rx="1.5"/><path d="M9 11h6M9 15h6"/></svg>`,
      laptop: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4"><rect x="4" y="4" width="16" height="11" rx="1.5"/><path d="M2 19h20"/></svg>`,
      box: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/></svg>`,
      checklist: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>`,
    };

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Berita Acara ${esc(selectedBranch.name)}</title>
    <style>
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      @page { size: A4; margin: 6mm; }
      body { font-family: Arial, Helvetica, sans-serif; color: #232323; font-size: 10.5px; margin: 0; }
      .page { border: 3px solid #2A1F52; border-radius: 10px; padding: 8mm 9mm; }

      .hdr { display: flex; justify-content: space-between; align-items: center; padding-bottom: 8px; border-bottom: 3px solid #2A1F52; margin-bottom: 9px; }
      .hdr-logo { display: flex; align-items: center; gap: 9px; }
      .hdr-logo-text .name { font-weight: 900; font-size: 13.5px; color: #2A1F52; letter-spacing: 0.01em; line-height: 1.1; }
      .hdr-logo-text .tag { font-size: 7px; color: #b8860b; font-weight: 700; letter-spacing: 0.03em; }
      .hdr-title { flex: 1; text-align: center; }
      .hdr-title h1 { font-family: 'Arial Black', Arial, sans-serif; font-weight: 900; font-size: 19px; color: #2A1F52; margin: 0; }
      .hdr-spacer { width: 100px; }

      .info-bar { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px; }
      .info-card { border: 1px solid #e4dff2; border-radius: 9px; padding: 7px 9px; display: flex; flex-direction: column; gap: 6px; justify-content: center; }
      .info-row { display: flex; gap: 6px; align-items: center; }
      .info-icon { width: 18px; height: 18px; border-radius: 5px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .info-icon svg { width: 10px; height: 10px; }
      .info-icon.gold { background: #F4B740; }
      .info-icon.purple { background: #2A1F52; }
      .info-txt .l { font-size: 6.4px; font-weight: 700; color: #999; text-transform: uppercase; letter-spacing: 0.03em; }
      .info-txt .v { font-size: 8.8px; font-weight: 700; color: #2A1F52; margin-top: 1px; }

      .sect-title { background: #2A1F52; color: #fff; font-weight: 800; font-size: 10px; padding: 6px 13px; border-radius: 7px; margin-bottom: 8px; letter-spacing: 0.03em; border-left: 4px solid #F4B740; }

      .summary-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 9px; }
      .summary-card { border: 1px solid #e4dff2; border-radius: 11px; padding: 9px; display: flex; align-items: center; gap: 9px; }
      .summary-card .icon-circle { width: 34px; height: 34px; border-radius: 50%; background: #2A1F52; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .summary-card .icon-circle svg { width: 16px; height: 16px; }
      .summary-card .mid { flex-shrink: 0; }
      .summary-card .t { font-size: 8px; font-weight: 800; color: #2A1F52; margin-bottom: 1px; }
      .summary-card .pct { font-size: 18px; font-weight: 900; line-height: 1.1; }
      .summary-card .badge { display: inline-block; font-size: 6.8px; font-weight: 800; padding: 2px 9px; border-radius: 20px; color: #fff; margin-top: 3px; }
      .legend { border-left: 1px solid #eee; padding-left: 9px; display: flex; flex-direction: column; gap: 3px; flex: 1; }
      .legend-row { display: flex; align-items: center; gap: 5px; font-size: 7.4px; }
      .legend-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
      .legend-label { color: #555; flex: 1; }
      .legend-val { font-weight: 800; color: #232323; }

      .tables-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 8px; }
      .table-block-hdr { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
      .table-block-hdr .lbl { font-weight: 800; font-size: 9.3px; color: #2A1F52; }
      .table-block-hdr .pill { font-size: 8px; font-weight: 800; padding: 2px 9px; border-radius: 20px; color: #fff; }
      table.data { width: 100%; border-collapse: collapse; font-size: 8px; border: 1px solid #e4dff2; }
      table.data th { background: #2A1F52; color: #fff; text-align: left; padding: 3.2px 6px; font-size: 7px; text-transform: uppercase; letter-spacing: 0.02em; }
      table.data td { padding: 2.4px 6px; border-bottom: 1px solid #efecf7; vertical-align: middle; }
      table.data tr.kat-row td { background: #ece8f7; color: #2A1F52; font-weight: 800; font-size: 7.4px; padding: 2.2px 6px; }
      .status-ok { color: #1a9e6e; font-weight: 800; }
      .status-bad { color: #c0392b; font-weight: 800; }

      .footer-row { display: grid; grid-template-columns: 1fr 1fr 1.5fr; gap: 10px; margin-top: 9px; page-break-inside: avoid; break-inside: avoid; }
      .sign-box { border: 1px solid #e4dff2; border-radius: 9px; padding: 7px; text-align: center; }
      .sign-badge { width: 20px; height: 20px; border-radius: 50%; background: #F4B740; display: flex; align-items: center; justify-content: center; margin: 0 auto 3px; }
      .sign-badge svg { width: 11px; height: 11px; }
      .sign-box .t { font-size: 8px; font-weight: 800; color: #2A1F52; letter-spacing: 0.05em; }
      .sign-box .role { font-size: 6.8px; color: #999; margin-bottom: 11px; }
      .sign-box .line { border-top: 1px solid #ccc; padding-top: 3px; margin-top: 3px; }
      .sign-box .name { font-weight: 700; font-size: 8.3px; }
      .catatan-box { border: 1px solid #e4dff2; border-radius: 9px; padding: 7px 10px; }
      .catatan-box .hd { display: flex; align-items: center; gap: 5px; margin-bottom: 3px; }
      .catatan-box .t { font-size: 8px; font-weight: 800; color: #2A1F52; }
      .catatan-box p { font-size: 7.3px; color: #555; line-height: 1.3; margin: 0 0 4px; }
      .catatan-box .tgl { font-size: 7.3px; color: #2A1F52; font-weight: 700; }

      .brand-footer { margin-top: 9px; background: #2A1F52; border-radius: 7px; padding: 7px 12px; display: flex; justify-content: space-between; align-items: center; }
      .brand-footer .left .name { color: #fff; font-weight: 800; font-size: 8.3px; }
      .brand-footer .left .tag { color: #cfc7e6; font-size: 6.6px; margin-top: 1px; }
      .brand-footer .right { display: flex; align-items: center; gap: 9px; }
      .brand-footer .right .item { display: flex; align-items: center; gap: 3px; color: #cfc7e6; font-size: 6.6px; }
      .brand-footer .right svg { width: 9px; height: 9px; }
    </style></head><body><div id="pdfZoom">
      <div class="page">

        <div class="hdr">
          <div class="hdr-logo">
            <svg width="28" height="28" viewBox="0 0 40 40"><polygon points="20,2 36,11 36,29 20,38 4,29 4,11" fill="#2A1F52"/><text x="20" y="26" text-anchor="middle" font-family="Arial" font-weight="900" font-size="16" fill="#F4B740">K</text></svg>
            <div class="hdr-logo-text"><div class="name">KLA COMPUTER</div><div class="tag">DIVISI AUDIT KLA COMPUTER</div></div>
          </div>
          <div class="hdr-title"><h1>BERITA ACARA AUDIT STORE</h1></div>
          <div class="hdr-spacer"></div>
        </div>

        <div class="info-bar">
          <div class="info-card">
            <div class="info-row"><span class="info-icon gold">${ICON.store}</span><div class="info-txt"><div class="l">Store / Cabang</div><div class="v">${esc(selectedBranch.name)}</div></div></div>
            <div class="info-row"><span class="info-icon gold">${ICON.calendar}</span><div class="info-txt"><div class="l">Tanggal Audit</div><div class="v">${esc(waktuAudit) || "\u2014"}</div></div></div>
          </div>
          <div class="info-card">
            <div class="info-row"><span class="info-icon purple">${ICON.person}</span><div class="info-txt"><div class="l">Auditor</div><div class="v">${esc(profile?.full_name || "\u2014")}</div></div></div>
            <div class="info-row"><span class="info-icon purple">${ICON.people}</span><div class="info-txt"><div class="l">Team Leader</div><div class="v">${esc(storeLeaderName) || "\u2014"}</div></div></div>
          </div>
          <div class="info-card" style="justify-content:center;">
            <div class="info-row"><span class="info-icon purple">${ICON.clipboard}</span><div class="info-txt"><div class="l">Ruang Lingkup</div><div class="v">${esc(kegiatan)}</div></div></div>
          </div>
          <div class="info-card" style="justify-content:center;">
            <div class="info-row"><span class="info-icon purple">${ICON.laptop}</span><div class="info-txt"><div class="l">Perlengkapan</div><div class="v">${esc(perlengkapan)}</div></div></div>
          </div>
        </div>

        <div class="sect-title">RINGKASAN HASIL AUDIT</div>
        <div class="summary-row">
          <div class="summary-card">
            <div class="icon-circle">${ICON.box}</div>
            <div class="mid">
              <div class="t">1. STOCK OPNAME</div>
              <div class="pct" style="color:${stockInfo.color};">${stockPct}%</div>
              <div class="badge" style="background:${stockInfo.color};">${stockInfo.lbl.toUpperCase()}</div>
            </div>
            <div class="legend">
              <div class="legend-row"><span class="legend-dot" style="background:${kat1Color};"></span><span class="legend-label">Kategori 1</span><span class="legend-val">${kat1Pct === null ? "-" : kat1Pct + "%"}</span></div>
              <div class="legend-row"><span class="legend-dot" style="background:${kat2Color};"></span><span class="legend-label">Kategori 2</span><span class="legend-val">${kat2Pct === null ? "-" : kat2Pct + "%"}</span></div>
            </div>
          </div>
          <div class="summary-card">
            <div class="icon-circle">${ICON.checklist}</div>
            <div class="mid">
              <div class="t">2. INVENTARIS</div>
              <div class="pct" style="color:${invInfo.color};">${invPct}%</div>
              <div class="badge" style="background:${invInfo.color};">${invInfo.lbl.toUpperCase()}</div>
            </div>
            <div class="legend">
              <div class="legend-row"><span class="legend-dot" style="background:#1a9e6e;"></span><span class="legend-label">Lengkap</span><span class="legend-val">${invPct}%</span></div>
              <div class="legend-row"><span class="legend-dot" style="background:#c0392b;"></span><span class="legend-label">Tidak Lengkap</span><span class="legend-val">${invTidakPct}%</span></div>
            </div>
          </div>
        </div>

        <div class="tables-row">
          <div>
            <div class="table-block-hdr"><span class="lbl">1. AUDIT STOCK OPNAME</span><span class="pill" style="background:${stockInfo.color};">${stockPct}%</span></div>
            <table class="data">
              <thead><tr><th>Kategori / Item</th><th>Kelengkapan</th><th>Keterangan</th></tr></thead>
              <tbody>
                ${stockTable("Kategori 1", stockKat1)}
                ${stockTable("Kategori 2", stockKat2)}
              </tbody>
            </table>
          </div>
          <div>
            <div class="table-block-hdr"><span class="lbl">2. AUDIT INVENTARIS</span><span class="pill" style="background:${invInfo.color};">${invPct}%</span></div>
            <table class="data">
              <thead><tr><th>Nama Inventaris</th><th>Keadaan</th><th>Keterangan</th></tr></thead>
              <tbody>${invRows}</tbody>
            </table>
          </div>
        </div>

        <div class="footer-row">
          <div class="sign-box">
            <div class="sign-badge">${ICON.checklist.replace(/#fff/g, "#2A1F52")}</div>
            <div class="t">MENGETAHUI</div>
            <div class="role">STORE MANAGER<br>${esc(selectedBranch.name.toUpperCase())}</div>
            <div class="line"><div class="name">${esc(storeManagerName || storeLeaderName || "\u2014")}</div></div>
          </div>
          <div class="sign-box">
            <div class="sign-badge">${ICON.person.replace(/#fff/g, "#2A1F52")}</div>
            <div class="t">PELAKSANA</div>
            <div class="role">STAFF AUDIT</div>
            <div class="line"><div class="name">${esc(profile?.full_name || "\u2014")}</div></div>
          </div>
          <div class="catatan-box">
            <div class="hd">${ICON.clipboard.replace(/#fff/g, "#2A1F52").replace('viewBox="0 0 24 24"', 'viewBox="0 0 24 24" width="13" height="13"')}<span class="t">CATATAN</span></div>
            <p>Berita acara ini dibuat berdasarkan hasil audit yang dilakukan pada ${esc(waktuAudit) || "periode terkait"} di Store ${esc(selectedBranch.name)}. Demikian berita acara ini dibuat dengan sebenar-benarnya untuk dipergunakan sebagaimana mestinya.</p>
            <div class="tgl">Tanggal: ${printDate}</div>
          </div>
        </div>

        <div class="brand-footer">
          <div class="left">
            <div class="name">KLA COMPUTER</div>
            <div class="tag">Solusi Lengkap Kebutuhan Digital Anda</div>
          </div>
          <div class="right">
            <span class="item">klacomputer.co.id</span>
            <span class="item">audit@klacomputer.id</span>
          </div>
        </div>

      </div>
      </div>
      <script>
        function fitToPage() {
          const zoomEl = document.getElementById("pdfZoom");
          const targetHeight = 1000; // ruang aman cetak A4, sengaja dikonservatifkan (antisipasi margin printer/browser)

          zoomEl.style.zoom = 1;
          const naturalHeight = zoomEl.scrollHeight;
          let zoom = targetHeight / naturalHeight;
          zoom = Math.min(zoom, 1.05);
          zoom = Math.max(zoom, 0.55); // batas bawah biar teks jangan sampai nggak kebaca
          zoomEl.style.zoom = zoom;

          // Cek ulang sekali lagi — kalau masih meleset dikit, koreksi lagi.
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
          if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(fitToPage);
          } else {
            fitToPage();
          }
        };
      <\/script>
    </body></html>`;

    const win = window.open("", "_blank");
    if (!win) { setError("Popup diblokir browser. Izinkan popup untuk mencetak PDF."); return; }
    win.document.write(html);
    win.document.close();
  }

  // ── Tampilan: pilih cabang ──
  if (!selectedBranch) {
    const rowsByBranch = {};
    allRecords.filter((r) => r.period === viewPeriod).forEach((r) => { rowsByBranch[r.branch_id] = r; });

    return (
      <div style={{ flex: 1 }}>
        <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Berita Acara</div>
            <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>Dokumen resmi audit store per cabang, per bulan &mdash; Stock Opname &amp; Inventaris</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 8, padding: "4px 6px" }}>
            <button className="btn-ghost" onClick={() => setViewPeriod(addMonthsToPeriod(viewPeriod, -1))} style={{ padding: "6px 10px" }}>{"<"}</button>
            <div className="mono" style={{ fontWeight: 600, minWidth: 130, textAlign: "center", fontSize: 13.5 }}>{periodeLabel(viewPeriod)}</div>
            <button className="btn-ghost" onClick={() => setViewPeriod(addMonthsToPeriod(viewPeriod, 1))} style={{ padding: "6px 10px" }}>{">"}</button>
          </div>
        </div>
        <div style={{ padding: 24 }}>
          {loadingBranches ? (
            <div style={{ color: "var(--text-secondary)" }}>Memuat cabang\u2026</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 12 }}>
              {branches.map((b) => {
                const row = rowsByBranch[b.id];
                const kat1 = row?.stock_opname_kat1 || [];
                const kat2 = row?.stock_opname_kat2 || [];
                const totalItem = kat1.length + kat2.length;
                const selisihCount = [...kat1, ...kat2].filter((r) => r.status === "Selisih").length;
                return (
                  <div key={b.id} onClick={() => pickBranch(b)} style={{ position: "relative", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", cursor: "pointer", overflow: "hidden" }}>
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: row ? (selisihCount > 0 ? "#a32020" : "#1a9e6e") : "linear-gradient(90deg, #7c3aed, #F4B740)" }} />
                    <div style={{ fontWeight: 600, fontSize: 14.5, marginBottom: row ? 8 : 4 }}>{b.name}</div>
                    {row ? (
                      <>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                          <span style={{ fontSize: 22, fontWeight: 800, color: selisihCount > 0 ? "#a32020" : "#1a9e6e" }}>{selisihCount}</span>
                          <span style={{ fontSize: 11, color: "var(--text-faint)" }}>selisih dari {totalItem} item</span>
                        </div>
                        <span style={{ display: "inline-block", marginTop: 6, padding: "2px 9px", borderRadius: 20, background: selisihCount > 0 ? "#a3202022" : "#1a9e6e22", color: selisihCount > 0 ? "#a32020" : "#1a9e6e", fontSize: 10.5, fontWeight: 600 }}>
                          {selisihCount > 0 ? "Ada temuan" : "Semua lengkap"}
                        </span>
                      </>
                    ) : (
                      <div style={{ fontSize: 11.5, fontWeight: 400, color: "var(--text-faint)" }}>Belum ada &middot; Mulai &rarr;</div>
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

  // ── Tampilan: form ──
  return (
    <div style={{ flex: 1 }}>
      <div style={{ background: "var(--surface)", padding: "16px 28px", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <button className="btn-ghost" style={{ marginBottom: 8, fontSize: 12.5 }} onClick={backToList}>&larr; Pilih cabang lain</button>
            <div className="display" style={{ fontSize: 19, fontWeight: 600 }}>Berita Acara &mdash; {selectedBranch.name}</div>
            <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
              Periode: {periodeLabel(viewPeriod)} {existingRow && <span style={{ color: "var(--text-faint)" }}>&middot; sudah pernah dibuat, kamu mengedit data yang ada</span>}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className="btn-ghost" onClick={exportPDF}>Cetak PDF</button>
            {canEdit && (
              <button className="btn" disabled={saving} onClick={saveRecord}>
                {saving ? "Menyimpan\u2026" : saved ? "\u2713 Tersimpan" : "Simpan"}
              </button>
            )}
            {profile?.role === "super_admin" && existingRow && (
              <button className="btn-ghost" disabled={saving} onClick={deleteRecord} style={{ color: "var(--danger-text)" }}>Hapus</button>
            )}
          </div>
        </div>
      </div>

      {error && <div style={{ margin: "14px 28px 0", background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}

      <div style={{ padding: 24, maxWidth: 900 }}>
        {loadingRecord ? (
          <div style={{ color: "var(--text-secondary)" }}>Memuat data\u2026</div>
        ) : (
          <>
            {/* Progress steps */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
              <StepPill icon="📋" label="Informasi" done />
              <StepLine />
              <StepPill icon="📦" label="Stock Opname" done={stockKat1.length + stockKat2.length > 0} />
              <StepLine />
              <StepPill icon="🗂️" label="Inventaris" done={countRusak(inventaris) >= 0 && Object.keys(inventaris).length > 0} />
              <StepLine />
              <StepPill icon="✍️" label="Tanda Tangan" done={!!storeManagerName} />
            </div>

            {/* Header info */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>📋 Informasi Audit</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 12 }}>
                <Field label="Waktu Audit">
                  <input className="input" placeholder="mis. 13 - 14 Juli 2026" value={waktuAudit} disabled={!canEdit} onChange={(e) => { setWaktuAudit(e.target.value); setSaved(false); }} />
                </Field>
                <Field label="Staff Audit">
                  <input className="input" value={profile?.full_name || ""} disabled />
                </Field>
                <Field label="Store Leader">
                  <input className="input" placeholder="Nama Store Leader" value={storeLeaderName} disabled={!canEdit} onChange={(e) => { setStoreLeaderName(e.target.value); setSaved(false); }} />
                </Field>
              </div>
              <Field label="Kegiatan">
                <textarea className="input" rows={2} value={kegiatan} disabled={!canEdit} onChange={(e) => { setKegiatan(e.target.value); setSaved(false); }} style={{ resize: "vertical" }} />
              </Field>
              <div style={{ marginTop: 12 }}>
                <Field label="Perlengkapan">
                  <input className="input" value={perlengkapan} disabled={!canEdit} onChange={(e) => { setPerlengkapan(e.target.value); setSaved(false); }} />
                </Field>
              </div>
            </div>

            {/* Ringkasan live — Stock Opname */}
            {(() => {
              const allRows = [...stockKat1, ...stockKat2];
              const selisihCount = allRows.filter((r) => r.status === "Selisih").length;
              return (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: selisihCount > 0 ? "var(--danger-bg)" : "var(--success-bg)", border: `1px solid ${selisihCount > 0 ? "rgba(239,68,68,0.35)" : "rgba(26,158,110,0.35)"}`, borderRadius: 10, padding: "10px 16px", marginBottom: 16 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: selisihCount > 0 ? "var(--danger-text)" : "var(--success-text)" }}>
                    {allRows.length} item dicek &middot; {selisihCount === 0 ? "semua lengkap" : `${selisihCount} selisih ditemukan`}
                  </span>
                  <span style={{ fontSize: 20, fontWeight: 800, color: selisihCount > 0 ? "var(--danger-text)" : "var(--success-text)" }}>{selisihCount}</span>
                </div>
              );
            })()}

            {/* Section: Stock Opname */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>📦 Audit Stock Opname</div>

              <StockSubSection title="Kategori 1" rows={stockKat1} canEdit={canEdit}
                onAdd={() => addRow(setStockKat1)}
                onUpdate={(i, f, v) => updateRow(setStockKat1, i, f, v)}
                onRemove={(i) => removeRow(setStockKat1, i)} />

              <div style={{ marginTop: 18 }}>
                <StockSubSection title="Kategori 2" rows={stockKat2} canEdit={canEdit}
                  onAdd={() => addRow(setStockKat2)}
                  onUpdate={(i, f, v) => updateRow(setStockKat2, i, f, v)}
                  onRemove={(i) => removeRow(setStockKat2, i)} />
              </div>
            </div>

            {/* Section: Inventaris */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>🗂️ Audit Inventaris</div>
              <InventarisChecklist
                inventaris={inventaris}
                canEdit={canEdit}
                uploadingKey={uploadingKey}
                onUpdate={updateInventaris}
                onUploadMedia={handleUploadInventarisMedia}
                onRemoveMedia={removeInventarisMedia}
              />
            </div>

            {/* Footer */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>✍️ Tanda Tangan</div>
              <div style={{ maxWidth: 320 }}>
                <Field label="Nama Store Manager">
                  <input className="input" placeholder="Nama lengkap" value={storeManagerName} disabled={!canEdit} onChange={(e) => { setStoreManagerName(e.target.value); setSaved(false); }} />
                </Field>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>Nama Staff Audit otomatis dari akun kamu ({profile?.full_name}).</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StockSubSection({ title, rows, canEdit, onAdd, onUpdate, onRemove }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>{title}</div>
        {canEdit && <button className="btn-ghost" onClick={onAdd} style={{ fontSize: 12 }}>+ Tambah Baris</button>}
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Belum ada baris.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((row, i) => {
            const isSelisih = row.status === "Selisih";
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1.8fr 120px 1.8fr auto", gap: 8, alignItems: "center", background: "var(--surface-alt)", padding: "10px 10px 10px 12px", borderRadius: 8, borderLeft: `3px solid ${isSelisih ? "#a32020" : "#1a9e6e55"}` }}>
                <input className="input" placeholder="Nama Barang/Brand" value={row.nama} disabled={!canEdit} onChange={(e) => onUpdate(i, "nama", e.target.value)} style={{ fontSize: 12.5 }} />
                <select className="input" value={row.status} disabled={!canEdit} onChange={(e) => onUpdate(i, "status", e.target.value)} style={{ fontSize: 12.5, fontWeight: isSelisih ? 700 : 400, color: isSelisih ? "var(--danger-text)" : undefined }}>
                  <option>Lengkap</option>
                  <option>Selisih</option>
                </select>
                <input className="input" placeholder="Keterangan" value={row.keterangan} disabled={!canEdit} onChange={(e) => onUpdate(i, "keterangan", e.target.value)} style={{ fontSize: 12.5 }} />
                {canEdit && <span onClick={() => onRemove(i)} style={{ cursor: "pointer", color: "var(--danger-text)", fontSize: 18, textAlign: "center" }}>&times;</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StepPill({ icon, label, done }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 20, background: done ? "#1a9e6e18" : "var(--surface-alt)", border: `1px solid ${done ? "rgba(26,158,110,0.4)" : "var(--border)"}` }}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: done ? "#1a9e6e" : "var(--text-secondary)" }}>{label}</span>
      {done && <span style={{ fontSize: 11, color: "#1a9e6e" }}>&#10003;</span>}
    </div>
  );
}

function StepLine() {
  return <div style={{ width: 20, height: 1, background: "var(--border)" }} />;
}

function Field({ label, children }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}
