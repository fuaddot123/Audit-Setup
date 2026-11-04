import { useMemo, useState } from "react";
import { sourceItemValue, valuationLabels } from "../lib/persediaanValuation";

const qty = (v) => Number(v).toLocaleString("id-ID", { maximumFractionDigits: 4 });
const money = (v) => v == null ? "—" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 2 }).format(v);
export default function StockNexaDetails({ items, compact = false }) {
  const [search, setSearch] = useState(""), [filter, setFilter] = useState("all"), [page, setPage] = useState(0);
  const rows = useMemo(() => items.map((i) => ({ ...i, ...("signedValue" in i ? {} : sourceItemValue(i)) })).filter((i) => {
    const match = `${i.sku} ${i.name} ${i.branch || ""} ${i.code || ""}`.toLowerCase().includes(search.toLowerCase());
    return match && (filter === "all" || filter === "difference" && i.difference !== 0 || filter === "shortage" && i.difference < 0 || filter === "surplus" && i.difference > 0 || filter === "unpriced" && i.difference !== 0 && i.signedValue == null);
  }), [items, search, filter]);
  const pages = Math.max(1, Math.ceil(rows.length / 25)), currentPage = Math.min(page, pages - 1);
  return <div className="stock-details">
    <div className="stock-table-toolbar"><label className="stock-search"><span>Cari barang</span><input className="input" placeholder="Kode, nama barang, cabang, atau nomor opname" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} /></label>
      <label><span>Tampilkan</span><select className="input" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(0); }}><option value="all">Semua barang</option><option value="difference">Hanya selisih</option><option value="shortage">Stok kurang</option><option value="surplus">Stok lebih</option><option value="unpriced">Nilai belum tersedia</option></select></label></div>
    <div className="stock-table-scroll"><table className="stock-item-table"><thead><tr><th>Barang</th>{!compact && <th>Cabang / Opname</th>}<th>Stok admin</th><th>Stok fisik</th><th>Qty selisih</th><th>Harga / unit</th><th>Nilai selisih</th><th>Keterangan</th></tr></thead><tbody>
      {rows.slice(currentPage * 25, (currentPage + 1) * 25).map((i, n) => <tr key={`${i.auditId || ""}/${i.code || ""}/${i.sku}/${n}`}><td className="stock-product"><strong>{i.name}</strong><small>{i.sku}</small></td>
        {!compact && <td><b>{i.branch}</b><small>{i.code}<br />{i.date}</small></td>}
        <td className="stock-numeric">{qty(i.systemQty)}</td><td className="stock-numeric">{qty(i.countedQty)}</td><td className="stock-numeric"><span className={`stock-pill ${i.difference < 0 ? "is-bad" : i.difference > 0 ? "is-good" : ""}`}>{i.difference > 0 ? "+" : ""}{qty(i.difference)}</span></td>
        <td className="stock-numeric" title={i.valuation ? `${i.valuation.fileName}: ${i.valuation.reportAmount} / ${i.valuation.reportQty}` : ""}>{money(i.unitCost)}<small>{valuationLabels[i.status]}</small></td>
        <td className={`stock-numeric stock-amount ${i.signedValue < 0 ? "stock-negative" : i.signedValue > 0 ? "stock-positive" : ""}`}>{money(i.signedValue)}</td>
        <td className="stock-item-note">{i.note && i.note !== "-" ? i.note : "—"}{i.serial && <small>SN: {i.serial}</small>}{i.auditNote && <small>Catatan audit: {i.auditNote}</small>}</td>
      </tr>)}
      {!rows.length && <tr><td colSpan={compact ? 7 : 8} className="stock-empty">Tidak ada barang yang sesuai filter.</td></tr>}
    </tbody></table></div>
    <div className="stock-table-footer"><span>{rows.length.toLocaleString("id-ID")} barang · halaman {currentPage + 1} dari {pages}</span><div><button type="button" className="btn-ghost" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Sebelumnya</button><button type="button" className="btn-ghost" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Berikutnya</button></div></div>
  </div>;
}
