import { useState } from "react";
import { readNexaTable, makeNexaRows, warehouseMatchesBranch } from "../lib/nexaOpnameImport";
import StockNexaDetails from "./StockNexaDetails";

export function NexaOpnameImport({ branch, period, auditDate, existingRows, onImport }) {
  const [book, setBook] = useState(null), [sheet, setSheet] = useState("");
  const [context, setContext] = useState({ code: "", date: "", warehouse: "" });
  const [category, setCategory] = useState("1"), [preview, setPreview] = useState(null), [selected, setSelected] = useState([]);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const updateContext = (name, value) => { setContext((old) => ({ ...old, [name]: value })); setPreview(null); };
  async function openFile(file) {
    setError(""); setPreview(null); setBook(null); setNotice("");
    if (!file) return;
    setBusy(true);
    try {
      if (!/\.(xlsx|xls)$/i.test(file.name) || file.size > 8 * 1024 * 1024) throw new Error("Pilih Excel .xlsx/.xls maksimal 8 MB.");
      const XLSX = await import("xlsx");
      const data = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", data);
      const sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
      const workbook = XLSX.read(data, { type: "array", cellFormula: true });
      const tables = workbook.SheetNames.map((name) => {
        const s = workbook.Sheets[name];
        const range = XLSX.utils.decode_range(s["!ref"] || "A1");
        if (range.e.r >= 100000 || range.e.c >= 100) throw new Error("File terlalu besar: maksimal 100.000 baris dan 100 kolom per sheet.");
        const hasFormulas = Object.entries(s).some(([address, cell]) => !address.startsWith("!") && cell?.f);
        const rows = XLSX.utils.sheet_to_json(s, { header: 1, defval: null, raw: true });
        const codes = [...new Set(rows.flat().map((v) => String(v ?? "").trim()).filter((v) => /^SOH\/\d+\/\d{6}$/.test(v)))];
        return { name, rows, codes, hasFormulas };
      });
      if (!tables.length) throw new Error("Excel tidak memiliki sheet.");
      setBook({ fileName: file.name, fileSha256: sha256, tables }); setSheet(tables[0].name);
      const titleCode = tables[0].codes.length > 1 ? "" : tables[0].rows.flat().map(String).join(" ").match(/SOH\/\d+\/\d{6}/i)?.[0] || "";
      setContext({ code: titleCode.toUpperCase(), date: "", warehouse: "" });
    } catch (e) { setError(e.message || "Excel tidak dapat dibaca."); }
    finally { setBusy(false); }
  }
  function checkFile() {
    setError(""); setNotice("");
    try {
      const selectedSheet = book.tables.find((t) => t.name === sheet);
      if (selectedSheet.hasFormulas) throw new Error("Gunakan ekspor Nexa asli berisi nilai; sheet dengan rumus belum didukung.");
      const groups = readNexaTable(selectedSheet.rows, context);
      setPreview(groups);
      setSelected(groups.filter((g) => warehouseMatchesBranch(g.warehouse, branch.name) && g.date.slice(0, 7) === period && g.date <= auditDate).map((g) => g.code));
    } catch (e) { setPreview(null); setError(e.message); }
  }
  function applyImport() {
    setError("");
    try {
      const chosen = preview.filter((g) => selected.includes(g.code));
      if (!chosen.length) throw new Error("Pilih minimal satu nomor opname yang sesuai cabang dan tanggal BA.");
      const rows = makeNexaRows(chosen, { branch, period, auditDate, existingRows, ...book, importedAt: new Date().toISOString() });
      onImport(Number(category), rows);
      setPreview(null); setBook(null); setNotice(`${rows.length} opname ditambahkan ke pratinjau. Periksa rinciannya, lalu klik Simpan impor ke rekap.`);
    } catch (e) { setError(e.message); }
  }
  return <details className="stock-import-file" open>
    <summary style={{ cursor: "pointer", fontWeight: 700 }}>Impor Excel Stock Opname Nexa</summary>
    <p style={{ fontSize: 12, color: "var(--text-secondary)" }}>Di Nexa, buka hasil opname → tampilkan All → ekspor Excel rincian barang. Pilih file, periksa sumbernya, lalu tambahkan ke pratinjau rekap. Satu nomor opname menjadi satu baris pemeriksaan; seluruh barangnya tersimpan sebagai rincian sumber.</p>
    <label style={{ display: "block", fontSize: 12 }}>File Excel Nexa <input type="file" accept=".xlsx,.xls" disabled={busy} onChange={(e) => { openFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
    {busy && <p role="status">Membaca Excel…</p>}
    {book && <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
      <b>File sumber: {book.fileName}</b>
      <label>Sheet <select className="input" value={sheet} onChange={(e) => { setSheet(e.target.value); setContext({ code: "", date: "", warehouse: "" }); setPreview(null); }}>{book.tables.map((t) => <option key={t.name}>{t.name}</option>)}</select></label>
      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Jika metadata tidak tercantum dalam Excel detail, isi sesuai halaman sumber Nexa. Metadata yang tercantum di tabel Excel dipakai terlebih dahulu.</div>
      <label>Nomor opname Nexa {book.tables.find((t) => t.name === sheet).codes.length ? <select className="input" value={context.code} onChange={(e) => updateContext("code", e.target.value)}><option value="">Pilih nomor opname (semua hanya jika metadata lengkap)</option>{book.tables.find((t) => t.name === sheet).codes.map((c) => <option key={c}>{c}</option>)}</select> : <input className="input" placeholder="SOH/01191/202610" value={context.code} onChange={(e) => updateContext("code", e.target.value.toUpperCase())} />}</label>
      <label>Tanggal opname sumber <input className="input" type="date" value={context.date} onInput={(e) => updateContext("date", e.target.value)} onChange={(e) => updateContext("date", e.target.value)} /></label>
      <label>Gudang sumber <input className="input" placeholder="mis. Ruko SMG,Ruko SMG Display,Ruko SMG Service" value={context.warehouse} onChange={(e) => updateContext("warehouse", e.target.value)} /></label>
      <label>Masukkan ke <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}><option value="1">Kategori 1</option><option value="2">Kategori 2</option></select></label>
      <button type="button" className="btn-ghost" onClick={checkFile}>Periksa Excel</button>
    </div>}
    {preview && <div style={{ marginTop: 12 }}>
      <b>{preview.length} opname ditemukan</b>
      {preview.map((g) => {
        const eligible = warehouseMatchesBranch(g.warehouse, branch.name) && g.date.slice(0, 7) === period && g.date <= auditDate;
        return <label key={g.code} style={{ display: "block", marginTop: 10, fontSize: 12 }}>
          <input type="checkbox" checked={selected.includes(g.code)} disabled={!eligible} onChange={(e) => setSelected((old) => e.target.checked ? [...old, g.code] : old.filter((c) => c !== g.code))} /> {g.code} · {g.date} · {g.warehouse}<br />
          {g.items.length} barang · {g.items.filter((i) => i.difference !== 0).length} selisih {eligible ? "" : "— tidak sesuai cabang/periode/tanggal audit"}
        </label>;
      })}
      <div style={{ overflowX: "auto", margin: "12px 0", maxHeight: 260 }}><table className="nexa-import-table"><thead><tr>{["Opname", "Kode / Barang", "Sistem", "Fisik", "Selisih"].map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>
        {preview.filter((g) => selected.includes(g.code)).flatMap((g) => g.items.slice(0, 10).map((i) => <tr key={`${g.code}/${i.sku}`}><td>{g.code}</td><td>{i.sku}<br />{i.name}</td><td>{i.systemQty}</td><td>{i.countedQty}</td><td>{i.difference}</td></tr>))}
      </tbody></table></div>
      <p style={{ fontSize: 12 }}>Pratinjau menampilkan maksimal 10 barang per opname. Semua rincian opname terpilih akan disimpan. Selisih = fisik − sistem; nilai harga tidak diambil jika tidak ada pada sumber.</p>
      <button type="button" className="btn" disabled={!selected.length} onClick={applyImport}>Tambahkan {selected.length} opname ke pratinjau rekap</button>
    </div>}
    {error && <p role="alert" style={{ color: "var(--danger-text)" }}>{error}</p>}
    {notice && <p role="status" style={{ color: "#1a9e6e" }}>{notice}</p>}
  </details>;
}

export function NexaImportedRow({ row, canEdit, onRemove, onNote, removeLabel }) {
  const source = row.nexa;
  return <div className="stock-opname-card">
    <div className="stock-section-heading"><div><span className="stock-eyebrow">HASIL OPNAME</span><h3>{source.code}</h3><p>{source.date} · {source.warehouse} · {source.items.length} barang</p></div><span className={`stock-pill ${row.status === "Selisih" ? "is-bad" : "is-good"}`}>{row.status} (jumlah)</span></div>
    <StockNexaDetails items={source.items} compact />
    <label className="stock-audit-note">Catatan pemeriksaan / alasan tindak lanjut <textarea className="input" value={row.keterangan} disabled={!canEdit} onChange={(e) => onNote(e.target.value)} /></label>
    <details className="stock-source-meta"><summary>Sumber data: {source.fileName}</summary><p>SHA-256: {source.fileSha256}</p>{!!source.manualMetadata?.length && <p>Diisi saat impor: {source.manualMetadata.join(", ")}</p>}</details>
    {canEdit && <button type="button" className="btn-ghost" style={{ marginTop: 10 }} onClick={onRemove}>{removeLabel || `Hapus impor ${source.code} dari BA ini`}</button>}
  </div>;
}

