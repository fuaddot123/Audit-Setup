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

export const INVENTARIS_CATEGORIES = [
  "Jaringan Internet", "Peralatan Kasir", "Peralatan Teknisi", "Audio Visual",
  "Penerangan", "Listrik & Utilitas", "Peralatan Keamanan", "Furniture & Fixture",
  "Kendaraan & Mesin", "Peralatan Kebersihan",
];

function freshInventaris() {
  const obj = {};
  INVENTARIS_CATEGORIES.forEach((cat) => { obj[cat] = { status: "Berfungsi", keterangan: "", photos: [] }; });
  return obj;
}
function normalizeInventaris(raw) {
  const fresh = freshInventaris();
  if (!raw) return fresh;
  INVENTARIS_CATEGORIES.forEach((cat) => {
    if (raw[cat]) fresh[cat] = { status: raw[cat].status || "Berfungsi", keterangan: raw[cat].keterangan || "", photos: raw[cat].photos || [] };
  });
  return fresh;
}
export function countRusak(inventarisData) {
  if (!inventarisData) return 0;
  return INVENTARIS_CATEGORIES.filter((c) => inventarisData[c]?.status === "Rusak").length;
}

export default function AuditInventaris({ profile }) {
  const canEdit = profile?.role === "auditor" || profile?.role === "super_admin";

  const [branches, setBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [allRecords, setAllRecords] = useState([]);
  const [viewPeriod, setViewPeriod] = useState(nowPeriode());
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [existingRow, setExistingRow] = useState(null);

  const [tidakVisit, setTidakVisit] = useState(false);
  const [inventaris, setInventaris] = useState(freshInventaris());
  const [auditDate, setAuditDate] = useState("");

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
    const { data: recs, error: recErr } = await supabase.from("audit_generic").select("*").eq("module", "inventaris");
    if (!recErr) setAllRecords(recs || []);
    setLoadingBranches(false);
  }

  async function pickBranch(b) {
    setSelectedBranch(b);
    setSaved(false);
    setError(null);
    setLoadingRecord(true);
    const { data, error: err } = await supabase
      .from("audit_generic")
      .select("*")
      .eq("module", "inventaris")
      .eq("branch_id", b.id)
      .eq("period", viewPeriod)
      .maybeSingle();
    if (!err && data) {
      setExistingRow(data);
      setTidakVisit(!!data.data?.tidak_visit);
      setInventaris(normalizeInventaris(data.data?.categories));
      setAuditDate(data.data?.audit_date || "");
    } else {
      setExistingRow(null);
      setTidakVisit(false);
      setInventaris(freshInventaris());
      setAuditDate("");
    }
    setLoadingRecord(false);
  }

  function backToList() {
    setSelectedBranch(null);
    setExistingRow(null);
    loadBranches();
  }

  function updateInventaris(cat, field, val) {
    setInventaris((prev) => ({ ...prev, [cat]: { ...prev[cat], [field]: val } }));
    setSaved(false);
  }

  async function uploadMedia(cat, fileList) {
    const files = Array.from(fileList || []);
    if (!files.length || !selectedBranch) return;
    const key = `inv-${cat}`;
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
        const safeCat = cat.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
        const path = `inventaris/${selectedBranch.id}/${viewPeriod}/${safeCat}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
        const { error: upErr } = await supabase.storage.from("findings").upload(path, file, { upsert: true });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("findings").getPublicUrl(path);
        uploaded.push({ url: pub.publicUrl, type: isVideo ? "video" : "image" });
      }
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
  function removeMedia(cat, mediaIdx) {
    setInventaris((prev) => {
      const photos = [...(prev[cat].photos || [])];
      photos.splice(mediaIdx, 1);
      return { ...prev, [cat]: { ...prev[cat], photos } };
    });
    setSaved(false);
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function exportPDF() {
    if (!selectedBranch) return;
    const printDate = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
    const rusakCount = countRusak(inventaris);

    const rows = INVENTARIS_CATEGORIES.map((cat, i) => {
      const row = inventaris[cat] || { status: "Berfungsi", keterangan: "" };
      const isRusak = row.status === "Rusak";
      const media = (row.photos || []).map((m) => m.type === "video"
        ? `<div style="width:34px;height:34px;background:#f0edf7;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;color:#7c3aed;">&#9654;</div>`
        : `<img src="${esc(m.url)}" style="width:34px;height:34px;object-fit:cover;border-radius:5px;border:1px solid #ddd;" />`
      ).join(" ") || "\u2014";
      const pill = `<span style="display:inline-block;font-size:9px;font-weight:700;padding:2px 9px;border-radius:20px;background:${isRusak ? "#fdecea" : "#e7f7f0"};color:${isRusak ? "#a32020" : "#1a9e6e"};">${esc(row.status || "Berfungsi")}</span>`;
      return `<tr style="${isRusak ? "background:#fff8f7;" : ""}">
        <td style="text-align:center;color:#999;">${i + 1}</td>
        <td style="font-weight:600;">${esc(cat)}</td>
        <td style="text-align:center;">${pill}</td>
        <td style="font-size:9px;color:#555;">${esc(row.keterangan) || "\u2014"}</td>
        <td style="text-align:center;">${media}</td>
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Inventaris ${esc(selectedBranch.name)}</title>
    <style>
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      @page { size: A4; }
      body { font-family: Arial, Helvetica, sans-serif; color: #222; font-size: 11px; margin: 0; }
      body { width: 210mm; margin: 0 auto; }
      .hdr { display: flex; justify-content: space-between; align-items: center; background: linear-gradient(120deg,#2A1F52,#3d2a72); margin: 0 0 16px; padding: 16px 14mm; border-bottom: 4px solid #F4B740; }
      .hdr-left { display: flex; align-items: center; gap: 12px; }
      .hdr-badge { width: 36px; height: 36px; border-radius: 9px; background: #F4B740; color: #2A1F52; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 13px; flex-shrink: 0; }
      .hdr-title { color: #fff; font-weight: 800; font-size: 15px; }
      .hdr-sub { color: #cfc7e6; font-size: 8.5px; }
      .hdr-right { text-align: right; }
      .hdr-tag { color: #F4B740; font-size: 8px; font-weight: 800; letter-spacing: 0.06em; }
      .hdr-date { color: #cfc7e6; font-size: 8.5px; margin-top: 2px; }
      .content { padding: 0 14mm 14mm; }
      .info-row { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 14px; }
      .info-box { border: 1px solid #eadfc4; background: #fdfaf1; border-radius: 8px; padding: 8px 11px; }
      .info-box .l { font-size: 7px; font-weight: 800; color: #b8860b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px; }
      .info-box .v { font-size: 10.5px; font-weight: 700; color: #2A1F52; }
      .metric-row { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 14px; }
      .metric-card { border-radius: 10px; padding: 10px 12px; border-left: 4px solid; background: #fafafd; }
      .metric-card .l { font-size: 7px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #888; margin-bottom: 3px; }
      .metric-card .v { font-size: 18px; font-weight: 900; color: #2A1F52; }
      table.data { width: 100%; border-collapse: collapse; font-size: 10px; }
      table.data th { background: #f7f6fb; text-align: left; padding: 6px 8px; border-bottom: 2px solid #2A1F52; font-size: 9px; color: #2A1F52; text-transform: uppercase; letter-spacing: 0.03em; }
      table.data td { padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: middle; }
      .footer { display: flex; justify-content: space-between; margin-top: 20px; padding-top: 8px; border-top: 1px solid #eee; font-size: 8px; color: #999; }
    </style></head><body><div id="pdfZoom">
      <div class="hdr">
        <div class="hdr-left">
          <div class="hdr-badge">KLA</div>
          <div><div class="hdr-title">Laporan Inventaris</div><div class="hdr-sub">Divisi Audit &middot; KLA Computer</div></div>
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
        </div>
        <div class="metric-row">
          <div class="metric-card" style="border-color:#a32020;"><div class="l">Aset Rusak</div><div class="v">${rusakCount} / ${INVENTARIS_CATEGORIES.length}</div></div>
          <div class="metric-card" style="border-color:#7c3aed;"><div class="l">Auditor</div><div class="v" style="font-size:12px;">${esc(profile?.full_name || "\u2014")}</div></div>
        </div>
        <table class="data">
          <thead><tr><th style="width:26px;">No</th><th>Nama Aset</th><th style="width:90px;text-align:center;">Status</th><th>Keterangan</th><th style="width:90px;text-align:center;">Foto/Video</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="footer">
          <span>PT. KLA Teknologi Indonesia &bull; Confidential</span>
          <span>Inventaris &bull; ${esc(selectedBranch.name)} &bull; ${esc(periodeLabel(viewPeriod))}</span>
        </div>
      </div>
      </div>
      <script>
        window.onload = () => {
          const zoomEl = document.getElementById("pdfZoom");
          const targetHeight = 1123 - 38 * 2;
          const actualHeight = zoomEl.scrollHeight;
          if (actualHeight > targetHeight) {
            zoomEl.style.zoom = targetHeight / actualHeight;
          }
          setTimeout(() => window.print(), 350);
        };
      <\/script>
    </body></html>`;

    const win = window.open("", "_blank");
    if (!win) { setError("Popup diblokir browser. Izinkan popup untuk mencetak PDF."); return; }
    win.document.write(html);
    win.document.close();
  }

  async function saveRecord() {
    if (!canEdit) { setError("Kamu tidak punya izin untuk menyimpan."); return; }
    setSaving(true);
    setError(null);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      const payload = {
        module: "inventaris",
        branch_id: selectedBranch.id,
        period: viewPeriod,
        status: "submitted",
        submitted_by: user.id,
        data: tidakVisit
          ? { tidak_visit: true, auditor_name: profile?.full_name || null }
          : { tidak_visit: false, categories: inventaris, auditor_name: profile?.full_name || null },
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

  async function deleteRecord() {
    if (!existingRow || profile?.role !== "super_admin") return;
    if (!window.confirm(`Hapus data Inventaris ${selectedBranch.name} periode ${periodeLabel(viewPeriod)}? Aksi ini tidak bisa dibatalkan.`)) return;
    setSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase.from("audit_generic").delete().eq("id", existingRow.id);
      if (err) throw err;
      setExistingRow(null);
      setInventaris(freshInventaris());
      setTidakVisit(false);
      setSaved(false);
    } catch (err) {
      setError("Gagal menghapus: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Tampilan: pilih cabang ──
  if (!selectedBranch) {
    const rowsByBranch = {};
    allRecords.filter((r) => r.period === viewPeriod).forEach((r) => { rowsByBranch[r.branch_id] = r; });

    return (
      <div style={{ flex: 1 }}>
        <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Inventaris</div>
            <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>Cek kondisi aset non-jual per cabang, per bulan</div>
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
                const isTidakVisit = row?.data?.tidak_visit;
                const rusak = row && !isTidakVisit ? countRusak(row.data?.categories) : null;
                return (
                  <div key={b.id} onClick={() => pickBranch(b)} style={{ position: "relative", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", cursor: "pointer", overflow: "hidden" }}>
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: isTidakVisit ? "#888" : row ? (rusak > 0 ? "#a32020" : "#1a9e6e") : "linear-gradient(90deg, #7c3aed, #F4B740)" }} />
                    <div style={{ fontWeight: 600, fontSize: 14.5, marginBottom: row ? 8 : 4 }}>{b.name}</div>
                    {isTidakVisit ? (
                      <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, background: "#88888822", color: "#888", fontSize: 11, fontWeight: 600 }}>Tidak Visit</span>
                    ) : row ? (
                      <>
                        <div style={{ fontSize: 22, fontWeight: 800, color: rusak > 0 ? "#a32020" : "#1a9e6e" }}>{rusak} / {INVENTARIS_CATEGORIES.length}</div>
                        <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>Aset Rusak &middot; {periodeLabel(viewPeriod)}</div>
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

  // ── Tampilan: form ──
  const rusakCount = countRusak(inventaris);

  return (
    <div style={{ flex: 1 }}>
      <div style={{ background: "var(--surface)", padding: "16px 28px", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <button className="btn-ghost" style={{ marginBottom: 8, fontSize: 12.5 }} onClick={backToList}>&larr; Pilih cabang lain</button>
            <div className="display" style={{ fontSize: 19, fontWeight: 600 }}>Inventaris &mdash; {selectedBranch.name}</div>
            <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
              Periode: {periodeLabel(viewPeriod)} {existingRow && <span style={{ color: "var(--text-faint)" }}>&middot; sudah pernah diisi, kamu mengedit data yang ada</span>}
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
              <button className="btn-ghost" disabled={saving} onClick={deleteRecord} style={{ color: "var(--danger-text)" }}>Hapus Data</button>
            )}
          </div>
        </div>
      </div>

      {error && <div style={{ margin: "14px 28px 0", background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}

      <div style={{ padding: 24, maxWidth: 800 }}>
        {loadingRecord ? (
          <div style={{ color: "var(--text-secondary)" }}>Memuat data\u2026</div>
        ) : (
          <>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, cursor: canEdit ? "pointer" : "default", fontSize: 13, color: "var(--text-secondary)" }}>
              <input type="checkbox" checked={tidakVisit} disabled={!canEdit} onChange={(e) => { setTidakVisit(e.target.checked); setSaved(false); }} />
              Cabang ini tidak dikunjungi bulan ini (Tidak Visit)
            </label>

            {!tidakVisit && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: rusakCount > 0 ? "var(--danger-bg)" : "var(--success-bg)", border: `1px solid ${rusakCount > 0 ? "rgba(239,68,68,0.35)" : "rgba(26,158,110,0.35)"}`, borderRadius: 10, padding: "10px 16px", marginBottom: 16 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: rusakCount > 0 ? "var(--danger-text)" : "var(--success-text)" }}>
                    {rusakCount === 0 ? "Semua aset berfungsi normal" : `${rusakCount} kategori aset rusak`}
                  </span>
                  <span style={{ fontSize: 20, fontWeight: 800, color: rusakCount > 0 ? "var(--danger-text)" : "var(--success-text)" }}>{rusakCount}/{INVENTARIS_CATEGORIES.length}</span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {INVENTARIS_CATEGORIES.map((cat) => {
                    const row = inventaris[cat] || { status: "Berfungsi", keterangan: "", photos: [] };
                    const key = `inv-${cat}`;
                    const rusak = row.status === "Rusak";
                    return (
                      <div key={cat} style={{ background: "var(--surface)", border: "1px solid var(--border)", padding: 14, borderRadius: 10 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 130px 1.6fr", gap: 10, alignItems: "start", marginBottom: rusak ? 10 : 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 600, paddingTop: 8 }}>{cat}</div>
                          <select className="input" value={row.status} disabled={!canEdit} onChange={(e) => updateInventaris(cat, "status", e.target.value)} style={{ fontSize: 12.5 }}>
                            <option>Berfungsi</option>
                            <option>Rusak</option>
                          </select>
                          <input className="input" placeholder="Keterangan" value={row.keterangan} disabled={!canEdit} onChange={(e) => updateInventaris(cat, "keterangan", e.target.value)} style={{ fontSize: 12.5 }} />
                        </div>
                        {rusak && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                            {(row.photos || []).map((m, mi) => (
                              <div key={mi} style={{ position: "relative" }}>
                                {m.type === "video" ? (
                                  <video src={m.url} style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }} muted />
                                ) : (
                                  <img src={m.url} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }} />
                                )}
                                {canEdit && (
                                  <span onClick={() => removeMedia(cat, mi)} style={{ position: "absolute", top: -5, right: -5, width: 16, height: 16, borderRadius: "50%", background: "var(--danger-text)", color: "#fff", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>&times;</span>
                                )}
                              </div>
                            ))}
                            {canEdit && (
                              <label style={{ width: 64, height: 64, display: "flex", alignItems: "center", justifyContent: "center", border: "1px dashed var(--border)", borderRadius: 6, cursor: "pointer", fontSize: 9.5, color: "var(--text-faint)", textAlign: "center" }}>
                                {uploadingKey === key ? "..." : "+ Foto/Video"}
                                <input type="file" accept="image/*,video/*" multiple style={{ display: "none" }} disabled={uploadingKey === key} onChange={(e) => { if (e.target.files?.length) uploadMedia(cat, e.target.files); e.target.value = ""; }} />
                              </label>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
