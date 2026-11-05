import { useState } from "react";

// A normal text-input fallback for environments whose browser file chooser
// cannot access local files. Decode the original bytes; callers still parse
// the Excel file and compute its hash through their existing validation path.
export default function ExcelSourcePicker({ label, name, onFile, disabled }) {
  const [copy, setCopy] = useState(""), [error, setError] = useState("");
  async function loadCopy() {
    setError("");
    try {
      if (copy.length > 12 * 1024 * 1024) throw new Error("Salinan sumber terlalu besar.");
      const data = JSON.parse(copy);
      if (typeof data.fileName !== "string" || !/\.(xlsx|xls)$/i.test(data.fileName) || typeof data.base64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(data.base64)) throw new Error("Salinan file Excel tidak valid.");
      const binary = atob(data.base64);
      if (!binary.length || binary.length > 8 * 1024 * 1024) throw new Error("Gunakan Excel maksimal 8 MB.");
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      await onFile(new File([bytes], data.fileName, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      setCopy("");
    } catch (e) { setError(e.message || "Salinan file tidak dapat dibaca."); }
  }
  return <div>
    <label className="stock-upload-button">{label}<input disabled={disabled} type="file" accept=".xlsx,.xls" onChange={(e) => { setError(""); onFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
    <details style={{ marginTop: 10, fontSize: 12 }}><summary>Alternatif pemilih file — {name}</summary>
      <p>Jika unggah browser bermasalah, tempel salinan sumber Excel di sini. File asli tetap diperiksa sebelum dipakai.</p>
      <textarea className="input" aria-label={`Salinan Excel ${name}`} disabled={disabled} value={copy} onChange={(e) => setCopy(e.target.value)} rows={3} style={{ width: "100%", resize: "vertical" }} />
      <button type="button" className="btn-ghost" disabled={disabled || !copy.trim()} onClick={loadCopy}>Gunakan salinan {name}</button>
      {error && <p role="alert" className="stock-error">{error}</p>}
    </details>
  </div>;
}
