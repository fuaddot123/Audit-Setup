import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

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

export default function BeritaAcara({ profile }) {
  const canEdit = profile?.role === "auditor" || profile?.role === "super_admin";

  const [branches, setBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [allRecords, setAllRecords] = useState([]);
  const [viewPeriod, setViewPeriod] = useState(nowPeriode());
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [existingRow, setExistingRow] = useState(null);

  const [waktuAudit, setWaktuAudit] = useState("");
  const [kegiatan, setKegiatan] = useState("Audit Stock Opname, SOP, Inventaris, Kas Kecil, dan Report Penjualan");
  const [perlengkapan, setPerlengkapan] = useState("Laptop dan Scanner");
  const [stockKat1, setStockKat1] = useState([]);
  const [stockKat2, setStockKat2] = useState([]);
  const [storeManagerName, setStoreManagerName] = useState("");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [loadingRecord, setLoadingRecord] = useState(false);

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
    const { data, error: err } = await supabase
      .from("berita_acara")
      .select("*")
      .eq("branch_id", b.id)
      .eq("period", viewPeriod)
      .maybeSingle();
    if (!err && data) {
      setExistingRow(data);
      setWaktuAudit(data.waktu_audit || "");
      setKegiatan(data.kegiatan || "Audit Stock Opname, SOP, Inventaris, Kas Kecil, dan Report Penjualan");
      setPerlengkapan(data.perlengkapan || "Laptop dan Scanner");
      setStockKat1(Array.isArray(data.stock_opname_kat1) ? data.stock_opname_kat1 : []);
      setStockKat2(Array.isArray(data.stock_opname_kat2) ? data.stock_opname_kat2 : []);
      setStoreManagerName(data.store_manager_name || "");
    } else {
      setExistingRow(null);
      setWaktuAudit("");
      setKegiatan("Audit Stock Opname, SOP, Inventaris, Kas Kecil, dan Report Penjualan");
      setPerlengkapan("Laptop dan Scanner");
      setStockKat1([]);
      setStockKat2([]);
      setStoreManagerName("");
    }
    setLoadingRecord(false);
  }

  function backToList() {
    setSelectedBranch(null);
    setExistingRow(null);
    loadBranches();
  }

  // ── Stock Opname (Kategori 1 & 2) row helpers ──
  function addRow(setter) { setter((prev) => [...prev, newStockRow()]); setSaved(false); }
  function updateRow(setter, i, field, val) {
    setter((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));
    setSaved(false);
  }
  function removeRow(setter, i) { setter((prev) => prev.filter((_, idx) => idx !== i)); setSaved(false); }

  async function saveRecord() {
    if (!canEdit) { setError("Kamu tidak punya izin untuk menyimpan."); return; }
    setSaving(true);
    setError(null);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      const payload = {
        branch_id: selectedBranch.id,
        period: viewPeriod,
        waktu_audit: waktuAudit,
        kegiatan,
        perlengkapan,
        stock_opname_kat1: stockKat1,
        stock_opname_kat2: stockKat2,
        store_manager_name: storeManagerName,
        submitted_by: user.id,
        updated_at: new Date().toISOString(),
      };
      const { data, error: err } = await supabase
        .from("berita_acara")
        .upsert(payload, { onConflict: "branch_id,period" })
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

  async function deleteRecord() {
    if (!existingRow || profile?.role !== "super_admin") return;
    if (!window.confirm(`Hapus Berita Acara ${selectedBranch.name} periode ${periodeLabel(viewPeriod)}? Aksi ini tidak bisa dibatalkan.`)) return;
    setSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase.from("berita_acara").delete().eq("id", existingRow.id);
      if (err) throw err;
      setExistingRow(null);
      setStockKat1([]);
      setStockKat2([]);
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

    function pill(text, bad) {
      return `<span style="display:inline-block;font-size:9px;font-weight:700;padding:2px 9px;border-radius:20px;background:${bad ? "#f7c1c1" : "#c0dd97"};color:${bad ? "#501313" : "#173404"};">${esc(text)}</span>`;
    }

    function stockTable(title, rows) {
      const body = rows.map((r, i) => {
        const isBad = r.status === "Selisih";
        return `<tr style="background:${isBad ? "#fcebeb" : "#fff"};border-left:3px solid ${isBad ? "#e24b4a" : "#97c459"};">
        <td style="text-align:center;color:#999;">${i + 1}</td>
        <td style="font-weight:600;">${isBad ? "&#10007; " : "&#10003; "}${esc(r.nama) || "\u2014"}</td>
        <td style="text-align:center;">${pill(r.status, isBad)}</td>
        <td style="font-size:9px;color:#555;">${esc(r.keterangan) || "\u2014"}</td>
      </tr>`;
      }).join("") || `<tr><td colspan="4" style="text-align:center;color:#999;padding:14px;">Tidak ada baris diisi</td></tr>`;
      return `<table class="data"><thead>
        <tr><th colspan="4" class="subsect-th"><span>${esc(title)}</span><span class="subsect-brand">KLA Computer &middot; Berita Acara &middot; ${esc(selectedBranch.name)}</span></th></tr>
        <tr><th style="width:26px;">No</th><th>Nama Barang / Brand</th><th style="width:90px;text-align:center;">Status</th><th>Keterangan</th></tr>
      </thead><tbody>${body}</tbody></table>`;
    }

    const stockSelisihCount = [...stockKat1, ...stockKat2].filter((r) => r.status === "Selisih").length;
    const stockTotalCount = stockKat1.length + stockKat2.length;
    const problemItems = [...stockKat1, ...stockKat2].filter((r) => r.status === "Selisih");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Berita Acara ${esc(selectedBranch.name)}</title>
    <style>
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      @page { size: A4; }
      body { font-family: Arial, Helvetica, sans-serif; color: #222; font-size: 11px; margin: 0; }
      html, body { height: 100%; }
      body { width: 210mm; margin: 0 auto; }
      .hdr { display: flex; justify-content: space-between; align-items: center; background: linear-gradient(120deg,#2A1F52,#3d2a72); margin: 0 0 16px; padding: 16px 14mm; border-bottom: 4px solid #F4B740; }
      .hdr-left { display: flex; align-items: center; gap: 12px; }
      .hdr-badge { width: 36px; height: 36px; border-radius: 9px; background: #F4B740; color: #2A1F52; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 13px; flex-shrink: 0; }
      .hdr-title { color: #fff; font-weight: 800; font-size: 15px; }
      .hdr-sub { color: #cfc7e6; font-size: 8.5px; }
      .hdr-right { text-align: right; }
      .hdr-tag { color: #F4B740; font-size: 8px; font-weight: 800; letter-spacing: 0.06em; }
      .hdr-date { color: #cfc7e6; font-size: 8.5px; margin-top: 2px; }
      .content { padding: 16px 14mm 14mm; flex: 1; display: flex; flex-direction: column; }
      h1 { font-size: 16px; color: #2A1F52; margin: 0 0 2px; }
      .sub { font-size: 10px; color: #888; margin-bottom: 14px; }
      .info-row { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 8px; }
      .info-box { border: 1px solid #eadfc4; background: #fdfaf1; border-radius: 8px; padding: 8px 11px; }
      .info-box .l { font-size: 7px; font-weight: 800; color: #b8860b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px; }
      .info-box .v { font-size: 10.5px; font-weight: 700; color: #2A1F52; }
      .info-wide { border: 1px solid #e0d8f0; background: #f5f3fa; border-radius: 8px; padding: 8px 11px; margin-bottom: 14px; font-size: 10px; color: #2A1F52; }
      .info-wide b { color: #3c3489; }
      .metric-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 14px 0; }
      .metric-card { border-radius: 10px; padding: 10px 12px; background: #fafafd; }
      .metric-card .l { font-size: 6.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #888; margin-bottom: 3px; }
      .metric-card .v { font-size: 17px; font-weight: 900; color: #2A1F52; }
      .problem-box { background: #faece7; border-radius: 8px; padding: 10px 13px; margin-bottom: 14px; }
      .problem-box .t { font-size: 10px; font-weight: 800; color: #712b13; margin-bottom: 6px; }
      .problem-box ul { margin: 0; padding-left: 16px; font-size: 9.5px; color: #4a1b0c; }
      .problem-box li { margin-bottom: 2px; }
      .sect { background: #2A1F52; color: #fff; font-weight: 700; padding: 7px 11px; font-size: 11px; margin-top: 16px; border-radius: 6px 6px 0 0; display: flex; align-items: center; gap: 6px; }
      .sect .dot { width: 6px; height: 6px; border-radius: 50%; background: #F4B740; }
      table.data th.subsect-th { background: #f0edf7; color: #3c3489; font-weight: 700; padding: 8px 11px; font-size: 9.5px; letter-spacing: 0.02em; text-align: left; text-transform: none; border-bottom: none; }
      .subsect-brand { float: right; color: #8b7fb0; font-weight: 500; font-size: 8px; }
      table.data { width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 4px; }
      table.data th { background: #f7f6fb; text-align: left; padding: 6px 8px; border-bottom: 2px solid #2A1F52; font-size: 9px; color: #2A1F52; text-transform: uppercase; letter-spacing: 0.03em; }
      table.data td { padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: middle; }
      .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; text-align: center; page-break-inside: avoid; break-inside: avoid; margin-top: 24px; }
      .sign > div { border: 1px solid #ddd; border-radius: 8px; padding: 10px; font-size: 9.5px; font-weight: 800; color: #2A1F52; letter-spacing: 0.05em; }
      .sign .line { margin-top: 30px; border-top: 1.5px solid #2A1F52; padding-top: 5px; font-weight: 700; font-size: 11px; color: #222; }
      .footer { display: flex; justify-content: space-between; margin-top: 24px; padding-top: 8px; border-top: 1px solid #eee; font-size: 8px; color: #999; page-break-inside: avoid; break-inside: avoid; }
    </style></head><body><div id="pdfZoom">
      <div class="hdr">
        <div class="hdr-left">
          <div class="hdr-badge">KLA</div>
          <div><div class="hdr-title">Berita Acara Audit Store</div><div class="hdr-sub">Divisi Audit &middot; KLA Computer</div></div>
        </div>
        <div class="hdr-right">
          <div class="hdr-tag">DOKUMEN RESMI</div>
          <div class="hdr-date">Dicetak ${printDate}</div>
        </div>
      </div>

      <div class="content">
        <div class="info-row">
          <div class="info-box"><div class="l">Store Cabang</div><div class="v">${esc(selectedBranch.name)}</div></div>
          <div class="info-box"><div class="l">Waktu Audit</div><div class="v" style="font-size:9.5px;">${esc(waktuAudit) || "\u2014"}</div></div>
        </div>
        <div class="info-wide">
          <b>Staff Audit:</b> ${esc(profile?.full_name || "\u2014")} &nbsp;&middot;&nbsp;
          <b>Kegiatan:</b> ${esc(kegiatan)} &nbsp;&middot;&nbsp;
          <b>Perlengkapan:</b> ${esc(perlengkapan)}
        </div>

        <div class="metric-row">
          <div class="metric-card"><div class="l">Item Dicek</div><div class="v">${stockTotalCount}</div></div>
          <div class="metric-card" style="background:#fcebeb;"><div class="l" style="color:#a32020;">Selisih</div><div class="v" style="color:#a32020;">${stockSelisihCount}</div></div>
          <div class="metric-card" style="background:#eaf3de;"><div class="l" style="color:#27500a;">% Lengkap</div><div class="v" style="color:#27500a;">${stockTotalCount ? Math.round(((stockTotalCount - stockSelisihCount) / stockTotalCount) * 100) : 0}%</div></div>
          <div class="metric-card"><div class="l">Auditor</div><div class="v" style="font-size:12px;">${esc(profile?.full_name || "\u2014")}</div></div>
        </div>

        ${problemItems.length ? `<div class="problem-box">
          <div class="t">&#9888; ITEM BERMASALAH &mdash; PERLU TINDAK LANJUT</div>
          <ul>${problemItems.map((p) => `<li>${esc(p.nama) || "(tanpa nama)"} ${p.keterangan ? "&mdash; " + esc(p.keterangan) : ""}</li>`).join("")}</ul>
        </div>` : ""}

        <div class="sect"><span class="dot"></span>AUDIT STOCK OPNAME</div>
        ${stockTable("Kategori 1", stockKat1)}
        <div style="height:14px;"></div>
        ${stockTable("Kategori 2", stockKat2)}

        <div class="sign">
          <div>MENGETAHUI<div class="line">${esc(storeManagerName || "\u2014")}<br><span style="font-weight:400;font-size:9px;color:#888;">Store Manager ${esc(selectedBranch.name)}</span></div></div>
          <div>PELAKSANA<div class="line">${esc(profile?.full_name || "\u2014")}<br><span style="font-weight:400;font-size:9px;color:#888;">Staff Audit</span></div></div>
        </div>

        <div class="footer">
          <span>PT. KLA Teknologi Indonesia &bull; Confidential</span>
          <span>Berita Acara &bull; ${esc(selectedBranch.name)} &bull; ${esc(periodeLabel(viewPeriod))}</span>
        </div>
      </div>
      </div>
      <script>
        window.onload = () => {
          const zoomEl = document.getElementById("pdfZoom");
          // A4 = ~1123px @96dpi. Margin "Default" Chrome \u2248 10mm (~38px) atas+bawah.
          const targetHeight = (1123 - 38 * 2) * 0.96; // 4% buffer aman biar nggak numpuk ke halaman 2
          const actualHeight = zoomEl.scrollHeight;
          let zoom = targetHeight / actualHeight;
          zoom = Math.min(zoom, 1.6);
          zoomEl.style.zoom = zoom;
          setTimeout(() => window.print(), 350);
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
            <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>Dokumen resmi audit store per cabang, per bulan</div>
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
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 20 }}>
              <StepPill icon="📋" label="Informasi" done />
              <StepLine />
              <StepPill icon="📦" label="Stock Opname" done={stockKat1.length + stockKat2.length > 0} />
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

            {/* Ringkasan live */}
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

            <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 16 }}>
              Cek kondisi aset (Jaringan Internet, Peralatan Kasir, dst) sekarang ada di modul terpisah: <b>Inventaris</b>.
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
