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
      return `<span style="display:inline-block;font-size:9px;font-weight:700;padding:2px 9px;border-radius:20px;background:${bad ? "#fdecea" : "#e7f7f0"};color:${bad ? "#a32020" : "#1a9e6e"};">${esc(text)}</span>`;
    }

    function stockTable(rows) {
      const body = rows.map((r, i) => `<tr style="${r.status === "Selisih" ? "background:#fff8f7;" : ""}">
        <td style="text-align:center;color:#999;">${i + 1}</td>
        <td style="font-weight:600;">${esc(r.nama) || "\u2014"}</td>
        <td style="text-align:center;">${pill(r.status, r.status === "Selisih")}</td>
        <td style="font-size:9px;color:#555;">${esc(r.keterangan) || "\u2014"}</td>
      </tr>`).join("") || `<tr><td colspan="4" style="text-align:center;color:#999;padding:14px;">Tidak ada baris diisi</td></tr>`;
      return `<table class="data"><thead><tr><th style="width:26px;">No</th><th>Nama Barang / Brand</th><th style="width:90px;text-align:center;">Status</th><th>Keterangan</th></tr></thead><tbody>${body}</tbody></table>`;
    }

    const stockSelisihCount = [...stockKat1, ...stockKat2].filter((r) => r.status === "Selisih").length;
    const stockTotalCount = stockKat1.length + stockKat2.length;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Berita Acara ${esc(selectedBranch.name)}</title>
    <style>
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      @page { size: A4; margin: 0; }
      body { font-family: Arial, Helvetica, sans-serif; color: #222; font-size: 11px; margin: 0; }
      html, body { height: 100%; }
      body { width: 210mm; margin: 0 auto; min-height: 297mm; display: flex; flex-direction: column; }
      .hdr { display: flex; justify-content: space-between; align-items: center; background: linear-gradient(120deg,#2A1F52,#3d2a72); margin: 0 0 16px; padding: 16px 14mm; border-bottom: 4px solid #F4B740; }
      .hdr-left { display: flex; align-items: center; gap: 12px; }
      .hdr-badge { width: 36px; height: 36px; border-radius: 9px; background: #F4B740; color: #2A1F52; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 13px; flex-shrink: 0; }
      .hdr-title { color: #fff; font-weight: 800; font-size: 15px; }
      .hdr-sub { color: #cfc7e6; font-size: 8.5px; }
      .hdr-right { text-align: right; }
      .hdr-tag { color: #F4B740; font-size: 8px; font-weight: 800; letter-spacing: 0.06em; }
      .hdr-date { color: #cfc7e6; font-size: 8.5px; margin-top: 2px; }
      .content { padding: 0 14mm 14mm; flex: 1; display: flex; flex-direction: column; }
      h1 { font-size: 16px; color: #2A1F52; margin: 0 0 2px; }
      .sub { font-size: 10px; color: #888; margin-bottom: 14px; }
      .info-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 8px; }
      .info-box { border: 1px solid #eadfc4; background: #fdfaf1; border-radius: 8px; padding: 8px 11px; }
      .info-box .l { font-size: 7px; font-weight: 800; color: #b8860b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px; }
      .info-box .v { font-size: 10.5px; font-weight: 700; color: #2A1F52; }
      .info-wide { border: 1px solid #e0d8f0; background: #f5f3fa; border-radius: 8px; padding: 8px 11px; margin-bottom: 14px; font-size: 10px; color: #2A1F52; }
      .info-wide b { color: #3c3489; }
      .metric-row { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin: 14px 0; }
      .metric-card { border-radius: 10px; padding: 10px 12px; border-left: 4px solid; background: #fafafd; }
      .metric-card .l { font-size: 7px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #888; margin-bottom: 3px; }
      .metric-card .v { font-size: 18px; font-weight: 900; color: #2A1F52; }
      .sect { background: #2A1F52; color: #fff; font-weight: 700; padding: 7px 11px; font-size: 11px; margin-top: 16px; border-radius: 6px 6px 0 0; display: flex; align-items: center; gap: 6px; }
      .sect .dot { width: 6px; height: 6px; border-radius: 50%; background: #F4B740; }
      .subsect { background: #f0edf7; color: #3c3489; font-weight: 700; padding: 5px 11px; font-size: 9.5px; letter-spacing: 0.02em; }
      table.data { width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 4px; }
      table.data th { background: #f7f6fb; text-align: left; padding: 6px 8px; border-bottom: 2px solid #2A1F52; font-size: 9px; color: #2A1F52; text-transform: uppercase; letter-spacing: 0.03em; }
      table.data td { padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: middle; }
      .sign { display: flex; justify-content: space-between; text-align: center; page-break-inside: avoid; break-inside: avoid; margin-top: auto; padding-top: 40px; }
      .sign > div { width: 45%; font-size: 9.5px; font-weight: 800; color: #2A1F52; letter-spacing: 0.05em; }
      .sign .line { margin-top: 54px; border-top: 1.5px solid #2A1F52; padding-top: 5px; font-weight: 700; font-size: 11px; color: #222; }
      .footer { display: flex; justify-content: space-between; margin-top: 24px; padding-top: 8px; border-top: 1px solid #eee; font-size: 8px; color: #999; page-break-inside: avoid; break-inside: avoid; }
    </style></head><body>
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
          <div class="info-box"><div class="l">Periode</div><div class="v">${esc(periodeLabel(viewPeriod))}</div></div>
          <div class="info-box"><div class="l">Waktu Audit</div><div class="v" style="font-size:9.5px;">${esc(waktuAudit) || "\u2014"}</div></div>
        </div>
        <div class="info-wide">
          <b>Staff Audit:</b> ${esc(profile?.full_name || "\u2014")} &nbsp;&middot;&nbsp;
          <b>Kegiatan:</b> ${esc(kegiatan)} &nbsp;&middot;&nbsp;
          <b>Perlengkapan:</b> ${esc(perlengkapan)}
        </div>

        <div class="metric-row">
          <div class="metric-card" style="border-color:#7c3aed;"><div class="l">Item Dicek (Stock Opname)</div><div class="v">${stockTotalCount}</div></div>
          <div class="metric-card" style="border-color:#a32020;"><div class="l">Selisih Ditemukan</div><div class="v">${stockSelisihCount}</div></div>
        </div>

        <div class="sect"><span class="dot"></span>AUDIT STOCK OPNAME</div>
        <div class="subsect">Kategori 1</div>
        ${stockTable(stockKat1)}
        <div class="subsect">Kategori 2</div>
        ${stockTable(stockKat2)}

        <div class="sign">
          <div>MENGETAHUI<div class="line">${esc(storeManagerName || "\u2014")}<br><span style="font-weight:400;font-size:9px;color:#888;">Store Manager ${esc(selectedBranch.name)}</span></div></div>
          <div>PELAKSANA<div class="line">${esc(profile?.full_name || "\u2014")}<br><span style="font-weight:400;font-size:9px;color:#888;">Staff Audit</span></div></div>
        </div>

        <div class="footer">
          <span>PT. KLA Teknologi Indonesia &bull; Confidential</span>
          <span>Berita Acara &bull; ${esc(selectedBranch.name)} &bull; ${esc(periodeLabel(viewPeriod))}</span>
        </div>
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
                return (
                  <div key={b.id} onClick={() => pickBranch(b)} style={{ position: "relative", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", cursor: "pointer", overflow: "hidden" }}>
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: row ? "#1a9e6e" : "linear-gradient(90deg, #7c3aed, #F4B740)" }} />
                    <div style={{ fontWeight: 600, fontSize: 14.5 }}>{b.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 4 }}>
                      {row ? "Sudah dibuat \u00b7 Lihat/Edit \u2192" : "Belum ada \u00b7 Mulai \u2192"}
                    </div>
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
            {/* Header info */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Informasi Audit</div>
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

            {/* Section: Stock Opname */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Audit Stock Opname</div>

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
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Tanda Tangan</div>
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
          {rows.map((row, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1.8fr 120px 1.8fr auto", gap: 8, alignItems: "center", background: "var(--surface-alt)", padding: 10, borderRadius: 8 }}>
              <input className="input" placeholder="Nama Barang/Brand" value={row.nama} disabled={!canEdit} onChange={(e) => onUpdate(i, "nama", e.target.value)} style={{ fontSize: 12.5 }} />
              <select className="input" value={row.status} disabled={!canEdit} onChange={(e) => onUpdate(i, "status", e.target.value)} style={{ fontSize: 12.5 }}>
                <option>Lengkap</option>
                <option>Selisih</option>
              </select>
              <input className="input" placeholder="Keterangan" value={row.keterangan} disabled={!canEdit} onChange={(e) => onUpdate(i, "keterangan", e.target.value)} style={{ fontSize: 12.5 }} />
              {canEdit && <span onClick={() => onRemove(i)} style={{ cursor: "pointer", color: "var(--danger-text)", fontSize: 18, textAlign: "center" }}>&times;</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}
