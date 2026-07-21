import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabaseClient";
import { CATS, nowPeriode, periodeLabel, addMonthsToPeriod } from "../../lib/sopConfig";
import { countRusak } from "../AuditInventaris";

const BASELINE = 150; // baseline temuan per cabang, sesuai formula yang disepakati

function kategoriInfo(pct) {
  const v = pct * 100;
  if (v >= 90) return { lbl: "Sangat Baik", color: "#1a9e6e" };
  if (v >= 80) return { lbl: "Baik", color: "#2f9e46" };
  if (v >= 70) return { lbl: "Cukup", color: "#b07212" };
  return { lbl: "Perlu Perbaikan", color: "#a32020" };
}

function countSopTemuan(sopRecord) {
  if (!sopRecord) return 0;
  const checks = sopRecord.data?.checks || {};
  let count = 0;
  CATS.forEach((c) => c.items.forEach((_, i) => { if (!checks[c.id + "_" + i]) count++; }));
  return count;
}

function countStokTemuan(stokRecord) {
  // Cuma "Total Barang Plus Minus/Tertukar" yang masuk Persediaan Stok.
  // "Total Bonus Fisik Tidak Ada" (bonus_count) TIDAK dipakai di sini sama
  // sekali -- SOP Aset nanti dihitung terpisah dari Modul Inventaris
  // (belum dibangun), bukan dari field ini.
  if (!stokRecord || stokRecord.data?.tidak_visit) return 0;
  const d = stokRecord.data || {};
  return Number(d.temuan_count) || 0;
}

function keuanganSisa(entry) {
  if (!entry) return null;
  if (entry.sisa_saldo !== null && entry.sisa_saldo !== undefined && entry.sisa_saldo !== "") {
    return parseFloat(entry.sisa_saldo) || 0;
  }
  return (parseFloat(entry.saldo_sebelumnya) || 0) + (parseFloat(entry.saldo_masuk) || 0) - (parseFloat(entry.pengeluaran) || 0);
}

export default function SopKepatuhan() {
  const [branches, setBranches] = useState([]);
  const [sopRecords, setSopRecords] = useState([]);
  const [stokRecords, setStokRecords] = useState([]);
  const [keuanganEntries, setKeuanganEntries] = useState([]);
  const [inventarisRecords, setInventarisRecords] = useState([]);
  const [period, setPeriod] = useState(nowPeriode());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [brRes, sopRes, stokRes, keuRes, invRes] = await Promise.all([
        supabase.from("branches").select("*").order("name"),
        supabase.from("audit_generic").select("*").eq("module", "sop"),
        supabase.from("audit_generic").select("*").eq("module", "stok_kesehatan"),
        supabase.from("audit_keuangan").select("*"),
        supabase.from("audit_generic").select("*").eq("module", "inventaris"),
      ]);
      if (brRes.error) throw brRes.error;
      setBranches(brRes.data || []);
      setSopRecords(sopRes.data || []);
      setStokRecords(stokRes.data || []);
      setKeuanganEntries(keuRes.data || []);
      setInventarisRecords(invRes.data || []);
    } catch (err) {
      setError("Gagal memuat data: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  const periodOptions = useMemo(() => {
    const set = new Set([nowPeriode(), period]);
    sopRecords.forEach((r) => set.add(r.period));
    stokRecords.forEach((r) => set.add(r.period));
    keuanganEntries.forEach((r) => set.add(r.period));
    return [...set].filter(Boolean).sort().reverse();
  }, [sopRecords, stokRecords, keuanganEntries, period]);

  function computeForPeriod(p) {
    const rows = branches.map((b) => {
      const sopRec = sopRecords.find((r) => r.branch_id === b.id && r.period === p) || null;
      const stokRec = stokRecords.find((r) => r.branch_id === b.id && r.period === p) || null;
      const keuEntry = keuanganEntries.find((r) => r.branch_id === b.id && r.period === p) || null;
      const invRec = inventarisRecords.find((r) => r.branch_id === b.id && r.period === p) || null;

      if (!sopRec) return { branch: b, status: "belum" };
      if (sopRec.data?.tidak_visit) return { branch: b, status: "tidak_visit" };

      const sopTemuan = countSopTemuan(sopRec);
      const stokTemuan = countStokTemuan(stokRec);
      const sisa = keuanganSisa(keuEntry);
      const keuanganTemuan = sisa !== null && sisa < 0 ? 1 : 0;
      const asetTemuan = invRec && !invRec.data?.tidak_visit ? countRusak(invRec.data?.categories) : 0;

      const totalTemuan = sopTemuan + stokTemuan + keuanganTemuan + asetTemuan;
      const pct = Math.max(0, 1 - totalTemuan / BASELINE);

      return { branch: b, status: "audited", sopTemuan, stokTemuan, keuanganTemuan, asetTemuan, totalTemuan, pct };
    });

    const visitedRows = rows.filter((r) => r.status === "audited");
    const tidakVisitRows = rows.filter((r) => r.status === "tidak_visit");
    const belumRows = rows.filter((r) => r.status === "belum");
    const avgPct = visitedRows.length ? visitedRows.reduce((s, r) => s + r.pct, 0) / visitedRows.length : null;

    return { rows, visitedRows, tidakVisitRows, belumRows, avgPct };
  }

  const current = useMemo(() => computeForPeriod(period), [branches, sopRecords, stokRecords, keuanganEntries, inventarisRecords, period]);
  const prevPeriod = addMonthsToPeriod(period, -1);
  const prev = useMemo(() => computeForPeriod(prevPeriod), [branches, sopRecords, stokRecords, keuanganEntries, inventarisRecords, prevPeriod]);

  const totalTemuanNow = current.visitedRows.reduce((s, r) => s + r.totalTemuan, 0);
  const totalTemuanPrev = prev.visitedRows.reduce((s, r) => s + r.totalTemuan, 0);

  if (loading) return <div style={{ padding: 40, color: "var(--text-secondary)" }}>Memuat\u2026</div>;

  const companyInfo = current.avgPct !== null ? kategoriInfo(current.avgPct) : null;

  return (
    <div style={{ flex: 1 }}>
      <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Skor Kepatuhan SOP</div>
          <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>Gabungan: SOP Operasional + Persediaan Stok + Keuangan + Aset</div>
        </div>
        <select className="input" style={{ width: 180 }} value={period} onChange={(e) => setPeriod(e.target.value)}>
          {periodOptions.map((p) => <option key={p} value={p}>{periodeLabel(p)}</option>)}
        </select>
      </div>

      {error && <div style={{ margin: "14px 28px 0", background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}

      <div style={{ padding: 24 }}>
        {/* Ringkasan company-wide */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14, marginBottom: 22 }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: companyInfo?.color || "#888" }} />
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 8 }}>% Skor Kepatuhan (Company-wide)</div>
            <div style={{ fontSize: 30, fontWeight: 800, color: companyInfo?.color || "var(--text-primary)" }}>{current.avgPct !== null ? `${Math.round(current.avgPct * 100)}%` : "\u2014"}</div>
            <div style={{ fontSize: 12, color: companyInfo?.color, fontWeight: 600, marginTop: 4 }}>{companyInfo?.lbl || "Belum ada data"}</div>
          </div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 8 }}>Total Temuan</div>
            <div style={{ fontSize: 30, fontWeight: 800 }}>{totalTemuanNow}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 4 }}>Bulan lalu: {totalTemuanPrev}</div>
          </div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 8 }}>Cabang Diaudit</div>
            <div style={{ fontSize: 30, fontWeight: 800 }}>{current.visitedRows.length} / {branches.length}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 4 }}>Tidak Visit: {current.tidakVisitRows.length} &middot; Belum Diaudit: {current.belumRows.length}</div>
          </div>
        </div>

        {/* Tabel per cabang */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--surface-alt)" }}>
                <th style={th}>Cabang</th>
                <th style={{ ...th, textAlign: "center" }}>SOP Operasional</th>
                <th style={{ ...th, textAlign: "center" }}>Persediaan Stok</th>
                <th style={{ ...th, textAlign: "center" }}>Keuangan</th>
                <th style={{ ...th, textAlign: "center" }}>Aset</th>
                <th style={{ ...th, textAlign: "center" }}>Total Temuan</th>
                <th style={{ ...th, textAlign: "center" }}>% Skor</th>
                <th style={{ ...th, textAlign: "center" }}>Kategori</th>
              </tr>
            </thead>
            <tbody>
              {current.rows.map((r) => {
                const info = r.status === "audited" ? kategoriInfo(r.pct) : null;
                return (
                  <tr key={r.branch.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={td}><b>{r.branch.name}</b></td>
                    {r.status === "audited" ? (
                      <>
                        <td style={{ ...td, textAlign: "center" }} className="mono">{r.sopTemuan}</td>
                        <td style={{ ...td, textAlign: "center" }} className="mono">{r.stokTemuan}</td>
                        <td style={{ ...td, textAlign: "center" }} className="mono">{r.keuanganTemuan}</td>
                        <td style={{ ...td, textAlign: "center" }} className="mono">{r.asetTemuan}</td>
                        <td style={{ ...td, textAlign: "center", fontWeight: 700 }} className="mono">{r.totalTemuan}</td>
                        <td style={{ ...td, textAlign: "center", fontWeight: 800, color: info.color }} className="mono">{Math.round(r.pct * 100)}%</td>
                        <td style={{ ...td, textAlign: "center" }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: info.color, background: `${info.color}22`, padding: "3px 10px", borderRadius: 20 }}>{info.lbl}</span>
                        </td>
                      </>
                    ) : (
                      <td colSpan={7} style={{ ...td, textAlign: "center", color: "var(--text-faint)" }}>
                        {r.status === "tidak_visit" ? "Tidak Visit" : "Belum Diaudit"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 12 }}>
          Formula: % Skor = 1 &minus; (Total Temuan &divide; {BASELINE}). Kategori: &ge;90% Sangat Baik &middot; 80-89% Baik &middot; 70-79% Cukup &middot; &lt;70% Perlu Perbaikan.
          Cabang tanpa data Audit SOP bulan ini dianggap Tidak Visit dan dikecualikan dari rata-rata.
        </div>
      </div>
    </div>
  );
}

const th = { textAlign: "left", padding: "10px 14px", fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.3 };
const td = { padding: "10px 14px" };
