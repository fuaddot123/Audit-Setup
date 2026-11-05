import { useState } from "react";
import { readPersediaanTable } from "../lib/persediaanValuation";
import ExcelSourcePicker from "./ExcelSourcePicker";

export default function PersediaanReportInput({ period, report, onReport, disabled, saveCount, onSave, saving, reference = false }) {
  const [file, setFile] = useState(null), [sheet, setSheet] = useState("");
  const [sourcePeriod, setSourcePeriod] = useState(""), [error, setError] = useState(""), [reading, setReading] = useState(false);
  const [allowReferenceCosts, setAllowReferenceCosts] = useState(false);
  async function readFile(f) {
    if (!f) return;
    setError(""); setReading(true); setFile(null);
    try {
      if (!/\.(xlsx|xls)$/i.test(f.name) || f.size > 8 * 1024 * 1024) throw new Error("Pilih Excel Report Persediaan maksimal 8 MB.");
      const X = await import("xlsx"), buffer = await f.arrayBuffer();
      const hash = await crypto.subtle.digest("SHA-256", buffer);
      const fileSha256 = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
      const book = X.read(buffer, { type: "array", cellFormula: true });
      const tables = book.SheetNames.map((name) => {
        const s = book.Sheets[name], range = X.utils.decode_range(s["!ref"] || "A1");
        if (range.e.r >= 100000 || range.e.c >= 100) throw new Error("Sheet report terlalu besar.");
        return { name, hasFormulas: Object.entries(s).some(([a, c]) => !a.startsWith("!") && c?.f), rows: X.utils.sheet_to_json(s, { header: 1, raw: true, defval: null }) };
      });
      if (!tables.length) throw new Error("Report tidak memiliki sheet.");
      setFile({ fileName: f.name, fileSha256, tables }); setSheet(tables[0].name); setSourcePeriod("");
    } catch (e) { setError(e.message); }
    finally { setReading(false); }
  }
  function apply() {
    setError("");
    try {
      if (reference ? !sourcePeriod || sourcePeriod >= period : sourcePeriod !== period) throw new Error(reference ? "Periode acuan harus sebelum bulan rekap." : "Periode report harus sama dengan periode rekap.");
      const table = file.tables.find((s) => s.name === sheet);
      if (table.hasFormulas) throw new Error("Gunakan ekspor Nexa asli berisi nilai, bukan sheet dengan rumus.");
      const parsed = readPersediaanTable(table.rows, { period: sourcePeriod, fileName: file.fileName, fileSha256: file.fileSha256, allowReferenceCosts });
      onReport(parsed); setFile(null);
    } catch (e) { setError(e.message); }
  }
  return <section className="stock-card stock-price-source">
    <div className="stock-section-heading"><div><span className="stock-eyebrow">{reference ? "ACUAN HARGA HISTORIS" : "SUMBER NILAI OTOMATIS"}</span><h2>{reference ? "Report Persediaan sebelumnya" : "Report Persediaan"}</h2><p>{reference ? "Dipakai untuk kode yang tidak punya harga pada bulan rekap. Periode dan dasar harga acuan dicantumkan pada setiap barang." : "Harga satuan = nominal persediaan ÷ qty persediaan. Nilai selisih = harga satuan × (stok fisik − stok admin)."}</p></div><span className={`stock-pill ${report ? "is-good" : ""}`}>{report ? `${report.priced.toLocaleString("id-ID")} kode bernilai` : "Belum dimuat"}</span></div>
    {report && <div className="stock-source-info"><strong>{report.fileName}</strong><span>Periode {report.period} · {report.count.toLocaleString("id-ID")} kode barang · pencocokan berdasarkan kode barang</span></div>}
    <fieldset disabled={disabled || reading} className="stock-fieldset">
      <div className="stock-inline-controls"><ExcelSourcePicker name={reference ? "acuan persediaan" : "persediaan"} label={reading ? "Membaca report…" : reference ? "Muat Excel acuan persediaan" : report ? "Ganti Excel persediaan" : "Muat Excel persediaan"} disabled={disabled || reading} onFile={readFile} />
        {report && onSave && <button type="button" className="btn-ghost" disabled={!saveCount || saving} onClick={onSave}>{saving ? "Menyimpan nilai…" : `Simpan nilai ke ${saveCount} BA`}</button>}
      </div>
      {file && <div className="stock-report-setup"><div><b>{file.fileName}</b><p>Isi bulan report sesuai filter di Nexa. Tanggal pada nama file adalah tanggal ekspor.</p></div><label>Sheet<select className="input" value={sheet} onChange={(e) => setSheet(e.target.value)}>{file.tables.map((s) => <option key={s.name}>{s.name}</option>)}</select></label><label>{reference ? "Periode report acuan" : "Periode report"}<input className="input" type="month" value={sourcePeriod} onInput={(e) => setSourcePeriod(e.currentTarget.value)} onChange={(e) => setSourcePeriod(e.target.value)} /></label>{!reference && <label><input type="checkbox" checked={allowReferenceCosts} onChange={(e) => setAllowReferenceCosts(e.target.checked)} /> Gunakan harga acuan jika qty saldo akhir nol atau kode tidak ditemukan</label>}<button type="button" className="btn" disabled={!sourcePeriod} onClick={apply}>{reference ? "Gunakan report acuan" : "Gunakan report & hitung nilai"}</button></div>}
    </fieldset>
    {report && <p className="stock-help">{reference ? "Harga historis diberi label acuan, dengan sumber bulan aslinya." : <>Nilai pada tampilan dan ekspor mengikuti report ini. {report.allowReferenceCosts && "Acuan saldo awal dipakai saat saldo akhir qty nol; report bulan sebelumnya dapat ditambahkan di bawah. Harga buku Rp0 tidak ditimpa. "}Tombol Simpan nilai memperbarui BA yang ditampilkan; hasil impor baru menyimpan nilai saat Simpan impor.</>}</p>}
    {error && <p role="alert" className="stock-error">{error}</p>}
  </section>;
}
