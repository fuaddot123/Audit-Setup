import { supabase } from "../lib/supabaseClient";

// ============================================================
// Modul Inventaris — sekarang digabung ke dalam Berita Acara
// (bukan halaman mandiri lagi). File ini menyisakan:
//   - Konstanta & helper murni (dipakai juga oleh SopKepatuhan.js
//     lewat `countRusak`, jangan diubah namanya)
//   - Fungsi upload media ke Supabase Storage
//   - Komponen tampilan checklist (dipakai di dalam BeritaAcara.js)
// Struktur data di database (audit_generic, module='inventaris')
// TIDAK berubah, supaya data lama & modul lain yang bergantung
// padanya (Kepatuhan SOP) tetap jalan seperti biasa.
// ============================================================

export const INVENTARIS_CATEGORIES = [
  "Jaringan Internet", "Peralatan Kasir", "Peralatan Teknisi", "Audio Visual",
  "Penerangan", "Listrik & Utilitas", "Peralatan Keamanan", "Furniture & Fixture",
  "Kendaraan & Mesin", "Peralatan Kebersihan",
];

export function freshInventaris() {
  const obj = {};
  INVENTARIS_CATEGORIES.forEach((cat) => { obj[cat] = { status: "Berfungsi", keterangan: "", photos: [] }; });
  return obj;
}

export function normalizeInventaris(raw) {
  const fresh = freshInventaris();
  if (!raw) return fresh;
  INVENTARIS_CATEGORIES.forEach((cat) => {
    if (raw[cat]) fresh[cat] = { status: raw[cat].status || "Berfungsi", keterangan: raw[cat].keterangan || "", photos: raw[cat].photos || [] };
  });
  return fresh;
}

// Dipakai juga oleh components/sop/SopKepatuhan.js — jangan ubah nama/signature.
export function countRusak(inventarisData) {
  if (!inventarisData) return 0;
  return INVENTARIS_CATEGORIES.filter((c) => inventarisData[c]?.status === "Rusak").length;
}

// Hapus 1 file media dari bucket Storage "findings" berdasarkan public URL-nya.
// Aman dipanggil walau url kosong/null, atau ternyata bukan file dari bucket findings
// (langsung di-skip diam-diam, nggak nge-throw).
export async function deleteMediaFromStorage(url) {
  if (!url) return;
  const marker = "/findings/";
  const idx = url.indexOf(marker);
  if (idx === -1) return;
  const path = decodeURIComponent(url.slice(idx + marker.length));
  const { error } = await supabase.storage.from("findings").remove([path]);
  if (error) console.warn("Gagal hapus file storage:", path, error.message);
}

// Hapus banyak file sekaligus — buat pas hapus 1 audit/record penuh yang punya
// banyak foto/video sekaligus (lebih efisien daripada looping deleteMediaFromStorage).
// Terima array berisi string url ATAU object {url,type}.
export async function deleteMediaListFromStorage(mediaList) {
  const marker = "/findings/";
  const paths = (mediaList || [])
    .map((m) => (typeof m === "string" ? m : m?.url))
    .filter(Boolean)
    .map((url) => {
      const idx = url.indexOf(marker);
      return idx === -1 ? null : decodeURIComponent(url.slice(idx + marker.length));
    })
    .filter(Boolean);
  if (!paths.length) return;
  const { error } = await supabase.storage.from("findings").remove(paths);
  if (error) console.warn("Gagal hapus file storage (batch):", error.message);
}

// Upload foto/video bukti kerusakan ke bucket Storage "findings".
// Dipanggil dari komponen pemanggil (BeritaAcara.js), yang menyimpan hasilnya ke state sendiri.
// Kompres foto: gambar ulang ke <canvas> di RESOLUSI ASLI (lebar/tinggi nggak diubah sama
// sekali), terus disimpan ulang sebagai JPEG kualitas 0.75 — ukuran file jauh lebih kecil,
// tapi dimensi/resolusi tetap persis kayak hasil kamera HP. Video nggak disentuh (biarin apa
// adanya, kompresi video butuh cara lain yang jauh lebih berat buat browser).
export function compressImage(file, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        if (blob) resolve(blob); else reject(new Error("Gagal kompres gambar"));
      }, "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Gagal baca gambar")); };
    img.src = url;
  });
}

export async function uploadInventarisMedia({ branchId, period, cat, fileList }) {
  const files = Array.from(fileList || []);
  const uploaded = [];
  for (const file of files) {
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) continue;
    let uploadFile = file;
    let ext = file.name.split(".").pop() || (isVideo ? "mp4" : "jpg");
    if (isImage) {
      try {
        const compressed = await compressImage(file, 0.75);
        // Pakai hasil kompresi cuma kalau beneran lebih kecil (foto yang udah kecil/simpel
        // kadang malah nggak nyusut, atau dikit doang — nggak masalah, tetep pakai aslinya).
        if (compressed.size < file.size) { uploadFile = compressed; ext = "jpg"; }
      } catch (err) {
        // Kompresi gagal (jarang) — lanjut upload file asli aja, jangan sampai gagal total.
      }
    }
    const maxSize = isVideo ? 30 * 1024 * 1024 : 5 * 1024 * 1024;
    if (uploadFile.size > maxSize) throw new Error(`Ukuran ${isVideo ? "video" : "foto"} maksimal ${isVideo ? "30MB" : "5MB"}.`);
    const safeCat = cat.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const path = `inventaris/${branchId}/${period}/${safeCat}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const { error: upErr } = await supabase.storage.from("findings").upload(path, uploadFile, { upsert: true, contentType: isImage ? "image/jpeg" : file.type });
    if (upErr) throw upErr;
    const { data: pub } = supabase.storage.from("findings").getPublicUrl(path);
    uploaded.push({ url: pub.publicUrl, type: isVideo ? "video" : "image" });
  }
  return uploaded;
}

// Tombol besar tap-to-toggle, gantiin dropdown — lebih cepat dipakai, terutama di HP/tablet.
function StatusToggle({ value, onChange, disabled, okLabel, badLabel }) {
  const isBad = value === badLabel;
  const btnBase = { border: "none", cursor: disabled ? "default" : "pointer", fontSize: 11.5, fontWeight: 700, padding: "9px 12px", borderRadius: 7, whiteSpace: "nowrap", opacity: disabled ? 0.7 : 1 };
  return (
    <div style={{ display: "flex", gap: 4, background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 9, padding: 3 }}>
      <button type="button" disabled={disabled} onClick={() => onChange(okLabel)} style={{ ...btnBase, background: !isBad ? "#1a9e6e" : "transparent", color: !isBad ? "#fff" : "var(--text-faint)" }}>
        &#10003; {okLabel}
      </button>
      <button type="button" disabled={disabled} onClick={() => onChange(badLabel)} style={{ ...btnBase, background: isBad ? "#a32020" : "transparent", color: isBad ? "#fff" : "var(--text-faint)" }}>
        &#10005; {badLabel}
      </button>
    </div>
  );
}

// Bagian checklist Inventaris — dirender sebagai section di dalam form Berita Acara.
// Ambil file gambar/video dari clipboard (Ctrl+V), biar nggak perlu save-as ke folder dulu
// baru upload — copy dari mana aja (galeri, browser, screenshot), klik kotaknya, paste.
function extractPastedFiles(e) {
  const items = e.clipboardData?.items;
  if (!items) return [];
  const files = [];
  for (const item of items) {
    if (item.kind === "file" && (item.type.startsWith("image/") || item.type.startsWith("video/"))) {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }
  return files;
}

export function InventarisChecklist({ inventaris, canEdit, uploadingKey, onUpdate, onUploadMedia, onRemoveMedia, filter }) {
  const rusakCount = countRusak(inventaris);
  const cats = filter === "rusak" ? INVENTARIS_CATEGORIES.filter((cat) => inventaris[cat]?.status === "Rusak") : INVENTARIS_CATEGORIES;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 16px", marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
          {rusakCount === 0 ? "Semua aset berfungsi normal" : `${rusakCount} kategori aset rusak`}
        </span>
        <span style={{ fontSize: 20, fontWeight: 800, color: rusakCount > 0 ? "#a32020" : "#1a9e6e" }}>{rusakCount}/{INVENTARIS_CATEGORIES.length}</span>
      </div>

      {cats.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Nggak ada aset yang rusak.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {cats.map((cat) => {
            const row = inventaris[cat] || { status: "Berfungsi", keterangan: "", photos: [] };
            const key = `inv-${cat}`;
            const rusak = row.status === "Rusak";
            return (
              <div key={cat} style={{ background: "var(--surface)", border: "1px solid var(--border)", padding: 14, borderRadius: 10, borderLeft: `3px solid ${rusak ? "#a32020" : "#1a9e6e55"}` }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.4fr auto 1.6fr", gap: 10, alignItems: "start", marginBottom: rusak ? 10 : 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, paddingTop: 8, textTransform: "uppercase" }}>{cat}</div>
                  <StatusToggle value={row.status} onChange={(v) => onUpdate(cat, "status", v)} disabled={!canEdit} okLabel="Berfungsi" badLabel="Rusak" />
                  <input className="input" placeholder="Keterangan" value={row.keterangan} disabled={!canEdit} onChange={(e) => onUpdate(cat, "keterangan", e.target.value)} style={{ fontSize: 12.5 }} />
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
                          <span onClick={() => onRemoveMedia(cat, mi)} style={{ position: "absolute", top: -5, right: -5, width: 16, height: 16, borderRadius: "50%", background: "var(--danger-text)", color: "#fff", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>&times;</span>
                        )}
                      </div>
                    ))}
                    {canEdit && (
                      <label
                        tabIndex={0}
                        onPaste={(e) => { const files = extractPastedFiles(e); if (files.length) { e.preventDefault(); onUploadMedia(cat, files); } }}
                        style={{ width: 64, height: 64, display: "flex", alignItems: "center", justifyContent: "center", border: "1px dashed var(--border)", borderRadius: 6, cursor: "pointer", fontSize: 9, color: "var(--text-faint)", textAlign: "center", lineHeight: 1.3 }}
                        title="Klik lalu Ctrl+V buat paste foto dari clipboard"
                      >
                        {uploadingKey === key ? "..." : (<>+ Foto/Video<br /><span style={{ fontSize: 8, opacity: 0.7 }}>atau Ctrl+V</span></>)}
                        <input type="file" accept="image/*,video/*" multiple style={{ display: "none" }} disabled={uploadingKey === key} onChange={(e) => { if (e.target.files?.length) onUploadMedia(cat, e.target.files); e.target.value = ""; }} />
                    </label>
                  )}
                </div>
              )}
            </div>
          );
        })}
        </div>
      )}
    </div>
  );
}
