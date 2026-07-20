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
function newStockRow() { return { kategori: "", nama: "", status: "Lengkap", temuan: "", keterangan: "" }; }
function newInventarisRow() { return { nama: "", status: "Sesuai", keterangan: "", photos: [] }; }

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
  const [stockOpname, setStockOpname] = useState([]);
  const [inventaris, setInventaris] = useState([]);
  const [storeManagerName, setStoreManagerName] = useState("");

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
      setStockOpname(Array.isArray(data.stock_opname) ? data.stock_opname : []);
      setInventaris(Array.isArray(data.inventaris) ? data.inventaris : []);
      setStoreManagerName(data.store_manager_name || "");
    } else {
      setExistingRow(null);
      setWaktuAudit("");
      setKegiatan("Audit Stock Opname, SOP, Inventaris, Kas Kecil, dan Report Penjualan");
      setPerlengkapan("Laptop dan Scanner");
      setStockOpname([]);
      setInventaris([]);
      setStoreManagerName("");
    }
    setLoadingRecord(false);
  }

  function backToList() {
    setSelectedBranch(null);
    setExistingRow(null);
    loadBranches();
  }

  // ── Stock Opname row helpers ──
  function addStockRow() { setStockOpname((prev) => [...prev, newStockRow()]); setSaved(false); }
  function updateStockRow(i, field, val) {
    setStockOpname((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));
    setSaved(false);
  }
  function removeStockRow(i) { setStockOpname((prev) => prev.filter((_, idx) => idx !== i)); setSaved(false); }

  // ── Inventaris row helpers ──
  function addInventarisRow() { setInventaris((prev) => [...prev, newInventarisRow()]); setSaved(false); }
  function updateInventarisRow(i, field, val) {
    setInventaris((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));
    setSaved(false);
  }
  function removeInventarisRow(i) { setInventaris((prev) => prev.filter((_, idx) => idx !== i)); setSaved(false); }

  async function uploadInventarisMedia(rowIndex, fileList) {
    const files = Array.from(fileList || []);
    if (!files.length || !selectedBranch) return;
    const key = `inv-${rowIndex}`;
    setUploadingKey(key);
    setError(null);
    try {
      const uploaded = [];
      for (const file of files) {
        const isImage = file.type.startsWith("image/");
        const isVideo = file.type.startsWith("video/");
        if (!isImage && !isVideo) continue;
        const maxSize = isVideo ? 30 * 1024 * 1024 : 5 * 1024 * 1024;
        if (file.size > maxSize) { setError(`Ukuran ${isVideo ? "video" : "foto"} maksimal ${isVideo ? "30MB" : "5MB"}.`); continue; }
        const ext = file.name.split(".").pop() || (isVideo ? "mp4" : "jpg");
        const path = `berita-acara/${selectedBranch.id}/${viewPeriod}/inv${rowIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
        const { error: upErr } = await supabase.storage.from("findings").upload(path, file, { upsert: true });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("findings").getPublicUrl(path);
        uploaded.push({ url: pub.publicUrl, type: isVideo ? "video" : "image" });
      }
      if (uploaded.length) {
        setInventaris((prev) => prev.map((r, idx) => (idx === rowIndex ? { ...r, photos: [...(r.photos || []), ...uploaded] } : r)));
        setSaved(false);
      }
    } catch (err) {
      setError("Gagal upload: " + err.message);
    } finally {
      setUploadingKey(null);
    }
  }
  function removeInventarisMedia(rowIndex, mediaIdx) {
    setInventaris((prev) => prev.map((r, idx) => {
      if (idx !== rowIndex) return r;
      const photos = [...(r.photos || [])];
      photos.splice(mediaIdx, 1);
      return { ...r, photos };
    }));
    setSaved(false);
  }

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
        stock_opname: stockOpname,
        inventaris,
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
      setStockOpname([]);
      setInventaris([]);
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

    const stockRows = stockOpname.map((r, i) => `<tr>
      <td style="text-align:center;">${i + 1}</td>
      <td>${esc(r.kategori)}</td>
      <td>${esc(r.nama)}</td>
      <td style="text-align:center;font-weight:700;color:${r.status === "Selisih" ? "#a32020" : "#1a9e6e"}">${esc(r.status)}</td>
      <td style="text-align:center;">${esc(r.temuan)}</td>
      <td style="font-size:9px;">${esc(r.keterangan)}</td>
    </tr>`).join("") || `<tr><td colspan="6" style="text-align:center;color:#999;">Tidak ada baris</td></tr>`;

    const invRows = inventaris.map((r, i) => {
      const media = (r.photos || []).map((m) => m.type === "video"
        ? `<div style="width:32px;height:32px;background:#eee;border-radius:3px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;">&#9654;</div>`
        : `<img src="${esc(m.url)}" style="width:32px;height:32px;object-fit:cover;border-radius:3px;border:1px solid #ddd;" />`
      ).join(" ") || "\u2014";
      return `<tr>
        <td style="text-align:center;">${i + 1}</td>
        <td>${esc(r.nama)}</td>
        <td style="text-align:center;font-weight:700;color:${r.status === "Tidak Sesuai" ? "#a32020" : "#1a9e6e"}">${esc(r.status)}</td>
        <td style="font-size:9px;">${esc(r.keterangan)}</td>
        <td style="text-align:center;">${media}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="5" style="text-align:center;color:#999;">Tidak ada baris</td></tr>`;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Berita Acara ${esc(selectedBranch.name)}</title>
    <style>
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      @page { size: A4; margin: 12mm; }
      body { font-family: Arial, Helvetica, sans-serif; color: #222; font-size: 11px; }
      h1 { font-size: 15px; color: #2A1F52; margin: 0 0 2px; }
      .sub { font-size: 10px; color: #666; margin-bottom: 14px; }
      table.meta { width: 100%; margin-bottom: 14px; font-size: 11px; }
      table.meta td { padding: 2px 6px; vertical-align: top; }
      table.meta td.label { width: 130px; color: #555; }
      .sect { background: #2A1F52; color: #fff; font-weight: 700; padding: 6px 10px; font-size: 11px; margin-top: 14px; border-radius: 4px 4px 0 0; }
      table.data { width: 100%; border-collapse: collapse; font-size: 10px; }
      table.data th { background: #f0edf7; text-align: left; padding: 5px 7px; border-bottom: 2px solid #2A1F52; }
      table.data td { padding: 5px 7px; border-bottom: 1px solid #eee; }
      .sign { display: flex; justify-content: space-between; margin-top: 40px; text-align: center; }
      .sign div { width: 45%; }
      .sign .line { margin-top: 50px; border-top: 1px solid #333; padding-top: 4px; font-weight: 700; }
    </style></head><body>
      <h1>BERITA ACARA AUDIT STORE</h1>
      <div class="sub">Divisi Audit KLA Computer &middot; Dicetak ${printDate}</div>
      <table class="meta">
        <tr><td class="label">Store Cabang</td><td>: ${esc(selectedBranch.name)}</td></tr>
        <tr><td class="label">Periode</td><td>: ${esc(periodeLabel(viewPeriod))}</td></tr>
        <tr><td class="label">Waktu</td><td>: ${esc(waktuAudit)}</td></tr>
        <tr><td class="label">Staff Audit</td><td>: ${esc(profile?.full_name || "\u2014")}</td></tr>
        <tr><td class="label">Kegiatan</td><td>: ${esc(kegiatan)}</td></tr>
        <tr><td class="label">Perlengkapan</td><td>: ${esc(perlengkapan)}</td></tr>
      </table>

      <div class="sect">1. AUDIT STOCK OPNAME</div>
      <table class="data">
        <thead><tr><th style="width:26px;">No</th><th>Kategori</th><th>Nama Barang/Brand</th><th style="width:70px;">Status</th><th style="width:50px;">Temuan</th><th>Keterangan</th></tr></thead>
        <tbody>${stockRows}</tbody>
      </table>

      <div class="sect">2. AUDIT INVENTARIS</div>
      <table class="data">
        <thead><tr><th style="width:26px;">No</th><th>Nama Aset</th><th style="width:80px;">Status</th><th>Keterangan</th><th style="width:90px;">Foto/Video</th></tr></thead>
        <tbody>${invRows}</tbody>
      </table>

      <div class="sign">
        <div>MENGETAHUI<div class="line">${esc(storeManagerName || "\u2014")}<br><span style="font-weight:400;font-size:9px;">Store Manager ${esc(selectedBranch.name)}</span></div></div>
        <div>PELAKSANA<div class="line">${esc(profile?.full_name || "\u2014")}<br><span style="font-weight:400;font-size:9px;">Staff Audit</span></div></div>
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
                      {row ? `Sudah dibuat \u00b7 ${(row.stock_opname || []).length + (row.inventaris || []).length} baris` : "Belum ada \u00b7 Mulai \u2192"}
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

            {/* Section 1: Stock Opname */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>1. Audit Stock Opname</div>
                {canEdit && <button className="btn-ghost" onClick={addStockRow} style={{ fontSize: 12 }}>+ Tambah Baris</button>}
              </div>
              {stockOpname.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>Belum ada baris. {canEdit && 'Klik "+ Tambah Baris" buat mulai.'}</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {stockOpname.map((row, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr 110px 80px 1.5fr auto", gap: 8, alignItems: "start", background: "var(--surface-alt)", padding: 10, borderRadius: 8 }}>
                      <input className="input" placeholder="Kategori" value={row.kategori} disabled={!canEdit} onChange={(e) => updateStockRow(i, "kategori", e.target.value)} style={{ fontSize: 12.5 }} />
                      <input className="input" placeholder="Nama Barang/Brand" value={row.nama} disabled={!canEdit} onChange={(e) => updateStockRow(i, "nama", e.target.value)} style={{ fontSize: 12.5 }} />
                      <select className="input" value={row.status} disabled={!canEdit} onChange={(e) => updateStockRow(i, "status", e.target.value)} style={{ fontSize: 12.5 }}>
                        <option>Lengkap</option>
                        <option>Selisih</option>
                      </select>
                      <input className="input" placeholder="Qty" type="number" value={row.temuan} disabled={!canEdit} onChange={(e) => updateStockRow(i, "temuan", e.target.value)} style={{ fontSize: 12.5 }} />
                      <input className="input" placeholder="Keterangan" value={row.keterangan} disabled={!canEdit} onChange={(e) => updateStockRow(i, "keterangan", e.target.value)} style={{ fontSize: 12.5 }} />
                      {canEdit && <span onClick={() => removeStockRow(i)} style={{ cursor: "pointer", color: "var(--danger-text)", fontSize: 18, lineHeight: "38px" }}>&times;</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Section 2: Inventaris */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>2. Audit Inventaris</div>
                {canEdit && <button className="btn-ghost" onClick={addInventarisRow} style={{ fontSize: 12 }}>+ Tambah Baris</button>}
              </div>
              {inventaris.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>Belum ada baris. {canEdit && 'Klik "+ Tambah Baris" buat mulai.'}</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {inventaris.map((row, i) => {
                    const key = `inv-${i}`;
                    return (
                      <div key={i} style={{ background: "var(--surface-alt)", padding: 12, borderRadius: 8 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 130px 1.5fr auto", gap: 8, alignItems: "start", marginBottom: 8 }}>
                          <input className="input" placeholder="Nama Aset" value={row.nama} disabled={!canEdit} onChange={(e) => updateInventarisRow(i, "nama", e.target.value)} style={{ fontSize: 12.5 }} />
                          <select className="input" value={row.status} disabled={!canEdit} onChange={(e) => updateInventarisRow(i, "status", e.target.value)} style={{ fontSize: 12.5 }}>
                            <option>Sesuai</option>
                            <option>Tidak Sesuai</option>
                          </select>
                          <input className="input" placeholder="Keterangan" value={row.keterangan} disabled={!canEdit} onChange={(e) => updateInventarisRow(i, "keterangan", e.target.value)} style={{ fontSize: 12.5 }} />
                          {canEdit && <span onClick={() => removeInventarisRow(i)} style={{ cursor: "pointer", color: "var(--danger-text)", fontSize: 18, lineHeight: "38px" }}>&times;</span>}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                          {(row.photos || []).map((m, mi) => (
                            <div key={mi} style={{ position: "relative" }}>
                              {m.type === "video" ? (
                                <video src={m.url} style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }} muted />
                              ) : (
                                <img src={m.url} alt="" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }} />
                              )}
                              {canEdit && (
                                <span onClick={() => removeInventarisMedia(i, mi)} style={{ position: "absolute", top: -5, right: -5, width: 16, height: 16, borderRadius: "50%", background: "var(--danger-text)", color: "#fff", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>&times;</span>
                              )}
                            </div>
                          ))}
                          {canEdit && (
                            <label style={{ width: 60, height: 60, display: "flex", alignItems: "center", justifyContent: "center", border: "1px dashed var(--border)", borderRadius: 6, cursor: "pointer", fontSize: 9.5, color: "var(--text-faint)", textAlign: "center" }}>
                              {uploadingKey === key ? "..." : "+ Foto/Video"}
                              <input type="file" accept="image/*,video/*" multiple style={{ display: "none" }} disabled={uploadingKey === key} onChange={(e) => { if (e.target.files?.length) uploadInventarisMedia(i, e.target.files); e.target.value = ""; }} />
                            </label>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
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

function Field({ label, children }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}
