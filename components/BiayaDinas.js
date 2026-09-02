import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { nowPeriode, periodeLabel, addMonthsToPeriod, periodFromDate, todayInputValue } from "../lib/sopConfig";

// "Yang Menugaskan" FIX sesuai dokumen kertas asli — nggak berubah-ubah per pengajuan.
const YANG_MENUGASKAN = { nama: "Nicholas Ferdinand", jabatan: "CEO" };
const ROMAN_MONTH = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
// No dok otomatis dari doc_seq (nomor urut database, di-set sekali pas record dibuat) +
// tanggal record dibuat (bukan tanggal_mulai perjalanan) — format: 001/SPDLK/VIII/2026
function noDokOf(row) {
  if (!row?.doc_seq || !row?.created_at) return null;
  const d = new Date(row.created_at);
  return `${String(row.doc_seq).padStart(3, "0")}/SPDLK/${ROMAN_MONTH[d.getMonth()]}/${d.getFullYear()}`;
}
function tglDokOf(row) {
  if (!row?.created_at) return null;
  return new Date(row.created_at).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}
const ISOLATION_START_PERIOD = "2026-08";

function emptyItem() {
  return { id: Date.now() + Math.random().toString(36).slice(2), jenis: "", detail: "", nilai: 0, jumlah: 1, ada_nota: true };
}
function itemTotal(it) { return (Number(it.nilai) || 0) * (Number(it.jumlah) || 0); }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function fmtRupiah(n) { return "Rp " + (Number(n) || 0).toLocaleString("id-ID"); }
function fmtDate(d) { if (!d) return "\u2014"; return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }); }

export default function BiayaDinas({ profile }) {
  // Auditor bikin pengajuannya sendiri; super_admin bisa liat semua (oversight) & edit siapa aja.
  const canManage = profile?.role === "auditor" || profile?.role === "super_admin";
  const isolate = profile?.role === "auditor";

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null); // null = list view, "new" = form baru, id = edit
  const [saving, setSaving] = useState(false);

  const [maksud, setMaksud] = useState("Audit Bulanan");
  const [tujuanKota, setTujuanKota] = useState("");
  const [tglMulai, setTglMulai] = useState(todayInputValue());
  const [tglSelesai, setTglSelesai] = useState(todayInputValue());
  const [items, setItems] = useState([emptyItem()]);
  const [catatan, setCatatan] = useState("");
  const [jenisPerjalanan, setJenisPerjalanan] = useState("Sementara");
  const [savedRow, setSavedRow] = useState(null); // record tersimpan penuh (buat No dok/Tgl dok)
  const [nikDraft, setNikDraft] = useState("");
  const [editingNik, setEditingNik] = useState(false);
  const [savingNik, setSavingNik] = useState(false);
  const [showRealisasi, setShowRealisasi] = useState(false);
  const [realisasiItems, setRealisasiItems] = useState([]);

  useEffect(() => { loadList(); }, []);

  async function loadList() {
    setLoading(true);
    setError(null);
    let q = supabase.from("dinas_luar_kota").select("*").order("tanggal_mulai", { ascending: false });
    // Isolasi per-auditor mulai Agustus 2026 ke depan — sama pola kayak modul lain.
    if (isolate) q = q.or(`period.lt.${ISOLATION_START_PERIOD},submitted_by.eq.${profile.id}`);
    const { data, error: err } = await q;
    if (err) setError("Gagal memuat data: " + err.message);
    else setList(data || []);
    setLoading(false);
  }

  function openNew() {
    setSelected("new");
    setMaksud("Audit Bulanan");
    setTujuanKota("");
    setTglMulai(todayInputValue());
    setTglSelesai(todayInputValue());
    setItems([emptyItem()]);
    setCatatan("");
    setJenisPerjalanan("Sementara");
    setSavedRow(null);
    setRealisasiItems([]);
    setShowRealisasi(false);
    setError(null);
  }

  function openEntry(row) {
    setSelected(row.id);
    setMaksud(row.maksud || "");
    setTujuanKota(row.tujuan_kota || "");
    setTglMulai(row.tanggal_mulai || todayInputValue());
    setTglSelesai(row.tanggal_selesai || todayInputValue());
    setItems(row.items?.length ? row.items : [emptyItem()]);
    setCatatan(row.catatan_khusus || "");
    setJenisPerjalanan(row.jenis_perjalanan || "Sementara");
    setSavedRow(row);
    setRealisasiItems(row.realisasi_items || []);
    setShowRealisasi(!!row.realisasi_items?.length);
    setError(null);
  }

  function updateItem(idx, patch) { setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it))); }
  function addItemRow() { setItems((prev) => [...prev, emptyItem()]); }
  function removeItemRow(idx) { setItems((prev) => prev.filter((_, i) => i !== idx)); }

  function updateRItem(idx, patch) { setRealisasiItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it))); }
  function addRItemRow() { setRealisasiItems((prev) => [...prev, emptyItem()]); }
  function removeRItemRow(idx) { setRealisasiItems((prev) => prev.filter((_, i) => i !== idx)); }

  const totalAnggaran = items.reduce((s, it) => s + itemTotal(it), 0);
  const totalRealisasi = realisasiItems.reduce((s, it) => s + itemTotal(it), 0);

  async function saveRecord() {
    if (!canManage) return;
    if (!tujuanKota.trim() || !tglMulai) { setError("Tujuan kota dan tanggal mulai wajib diisi."); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        auditor_id: profile.id,
        period: periodFromDate(tglMulai),
        maksud: maksud || null,
        tujuan_kota: tujuanKota,
        tanggal_mulai: tglMulai,
        tanggal_selesai: tglSelesai,
        items,
        total_anggaran: totalAnggaran,
        realisasi_items: showRealisasi && realisasiItems.length ? realisasiItems : null,
        total_realisasi: showRealisasi && realisasiItems.length ? totalRealisasi : null,
        catatan_khusus: catatan || null,
        jenis_perjalanan: jenisPerjalanan,
        submitted_by: profile.id,
        updated_at: new Date().toISOString(),
      };
      let res;
      if (selected && selected !== "new") {
        res = await supabase.from("dinas_luar_kota").update(payload).eq("id", selected).select().single();
      } else {
        res = await supabase.from("dinas_luar_kota").insert(payload).select().single();
      }
      if (res.error) throw res.error;
      setSelected(res.data.id);
      setSavedRow(res.data);
      await loadList();
    } catch (err) {
      setError("Gagal menyimpan: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecord() {
    if (!selected || selected === "new") return;
    const isOwner = profile?.role === "auditor" && savedRow?.submitted_by === profile?.id;
    if (profile?.role !== "super_admin" && !isOwner) return;
    if (!window.confirm("Yakin hapus pengajuan ini? Aksi ini tidak bisa dibatalkan.")) return;
    setSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase.from("dinas_luar_kota").delete().eq("id", selected);
      if (err) throw err;
      setSelected(null);
      await loadList();
    } catch (err) {
      setError("Gagal menghapus: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  function printPDF() {
    const win = window.open("", "_blank");
    if (!win) { setError("Popup diblokir browser. Izinkan popup untuk mencetak PDF."); return; }
    const now = new Date();
    const printDateShort = now.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" });
    const printDateTime = now.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" }) + ", " + now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

    const rowsHtml = (arr) => arr.map((it) => `
      <tr>
        <td>${esc(it.jenis)}</td>
        <td>${esc(it.detail)}</td>
        <td class="num">${fmtRupiah(it.nilai)}</td>
        <td class="num">${it.jumlah}</td>
        <td class="ctr">${it.ada_nota ? "Ada" : "Tidak"}</td>
        <td class="num">${fmtRupiah(itemTotal(it))}</td>
      </tr>`).join("");

    // Kolom TTD sengaja dibiarin KOSONG (nggak diisi scribble tanda tangan palsu) — buat
    // ditandatangan basah beneran di kertas, sesuai keputusan awal fitur ini.
    function signGrid(roles, filledMap) {
      return `<div class="diketahui">Disetujui dan disetujui oleh:</div><div class="sign-grid">${roles.map((r) => `
          <div class="sign-box">
            <div class="t">${r}</div>
            <div class="space"></div>
            <div class="line">${esc(filledMap?.[r] || "")}&nbsp;</div>
          </div>`).join("")}</div>`;
    }

    const sisaKurang = totalAnggaran - totalRealisasi;
    const realisasiSection = showRealisasi && realisasiItems.length ? `
      <div class="bagian-ribbon realisasi"><span>BAGIAN 2 &middot; PELAPORAN (REALISASI SESUDAH KUNJUNGAN)</span></div>
      <div class="bagian2-box">
        <table class="tbl">
          <thead><tr><th>Jenis Fasilitas</th><th>Detail</th><th>Nilai (Rp)</th><th>Jumlah</th><th>Nota</th><th>Total</th></tr></thead>
          <tbody>
            ${rowsHtml(realisasiItems)}
            <tr class="total-row"><td colspan="5">TOTAL BIAYA</td><td class="num">${fmtRupiah(totalRealisasi)}</td></tr>
            <tr class="total-row"><td colspan="5">${sisaKurang >= 0 ? "SISA" : "KURANG"} (Anggaran &minus; Realisasi)</td><td class="num" style="color:${sisaKurang >= 0 ? "#1a9e6e" : "#a32020"};">${fmtRupiah(Math.abs(sisaKurang))}</td></tr>
          </tbody>
        </table>
        ${signGrid(["Pemberi Tugas", "Pelaksana Tugas", "Finance", "Fin & Acc Manager", "HC Manager", "CEO"], { CEO: YANG_MENUGASKAN.nama })}
      </div>` : "";

    win.document.write(`<!DOCTYPE html><html><head><title>SPDLK - ${esc(tujuanKota)}</title><meta charset="utf-8">
    <style>
      @page { size: A4; margin: 10mm; }
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; color: #1a1024; font-size: 10.5px; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { border: 2px solid #F4B740; border-radius: 14px; padding: 20px 26px 16px; position: relative; overflow: hidden; }
      .corner-tl { position: absolute; top: -2px; left: -2px; width: 130px; height: 130px; background: #2A1F52; clip-path: polygon(0 0, 100% 0, 0 100%); border-radius: 14px 0 0 0; }
      .corner-br { position: absolute; bottom: -2px; right: -2px; width: 90px; height: 90px; background: linear-gradient(135deg, #F4B740, #2A1F52); clip-path: polygon(100% 100%, 100% 0, 0 100%); }
      .topbar { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; position: relative; z-index: 2; }
      .brand { display: flex; align-items: center; gap: 8px; }
      .brand-logo { width: 40px; height: 40px; border-radius: 9px; background: #2A1F52; color: #F4B740; font-weight: 900; font-size: 13px; display: flex; align-items: center; justify-content: center; letter-spacing: 0.02em; }
      .brand-text { font-size: 8px; color: #999; line-height: 1.3; }
      .doc-title { text-align: center; font-weight: 800; font-size: 12px; color: #2A1F52; }
      .doc-title span { color: #7c5fc9; }
      .doc-meta-tbl { font-size: 8.5px; border-collapse: collapse; }
      .doc-meta-tbl td { border: 1px solid #e4dff2; padding: 3px 8px; }
      .doc-meta-tbl td:first-child { color: #888; background: #F7F6FB; }
      .doc-meta-tbl td:last-child { color: #1a1330; font-weight: 700; }
      .main-title { text-align: center; font-size: 21px; font-weight: 900; color: #1a1330; margin: 10px 0 2px; }
      .main-title span { color: #6b3fa0; }
      .title-underline { width: 90px; height: 3px; background: #F4B740; border-radius: 2px; margin: 0 auto 14px; }
      .grid3 { display: grid; grid-template-columns: 1fr 1fr 0.7fr; gap: 12px; margin-bottom: 12px; }
      .box { border: 1px solid #e4dff2; border-radius: 10px; padding: 10px 14px; background: #FBFAFE; }
      .box h3 { font-size: 10px; text-transform: uppercase; color: #2A1F52; margin: 0 0 8px; letter-spacing: 0.04em; display: flex; align-items: center; gap: 6px; }
      .box h3 .ic { width: 18px; height: 18px; border-radius: 50%; background: #2A1F52; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; }
      .row { display: flex; justify-content: space-between; font-size: 10px; padding: 3px 0; border-bottom: 1px dotted #e4dff2; }
      .row span:first-child { color: #888; }
      .row span:last-child { font-weight: 700; color: #1a1330; }
      .jenis-opt { display: flex; align-items: center; gap: 6px; font-size: 10px; padding: 3px 0; }
      .jenis-opt .chk { width: 12px; height: 12px; border: 1.5px solid #2A1F52; border-radius: 3px; flex-shrink: 0; }
      .jenis-opt.on .chk { background: #2A1F52; }
      .jenis-opt.on span { font-weight: 700; color: #1a1330; }
      .detail-row { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
      .detail-row .ic { width: 20px; height: 20px; border-radius: 50%; background: #F4B74022; color: #b07212; display: flex; align-items: center; justify-content: center; font-size: 10px; flex-shrink: 0; }
      .detail-row b { display: block; color: #2A1F52; font-size: 9px; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 1px; }
      .bagian-ribbon { position: relative; background: #2A1F52; color: #fff; font-size: 10px; font-weight: 800; letter-spacing: 0.04em; padding: 7px 20px 7px 14px; margin: 16px 0 10px; clip-path: polygon(0 0, 100% 0, 96% 100%, 0% 100%); }
      .bagian-ribbon.realisasi { background: #F4B740; color: #2A1F52; }
      .bagian2-box { border: 1.5px dashed #F4B740; border-radius: 10px; padding: 12px 14px 6px; background: #FFFBF0; }
      .bagian2-box table.tbl th { background: #FBEFCF; }
      table.tbl { width: 100%; border-collapse: collapse; font-size: 9.5px; }
      table.tbl th { background: #2A1F52; color: #fff; text-align: left; padding: 6px 8px; }
      table.tbl td { padding: 5px 8px; border-bottom: 1px solid #eee; }
      table.tbl td.num { text-align: right; }
      table.tbl td.ctr { text-align: center; }
      .total-row td { font-weight: 800; background: #F7F6FB; }
      .sign-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; margin-top: 16px; page-break-inside: avoid; }
      .sign-box { text-align: center; }
      .sign-box .t { font-size: 7.3px; font-weight: 700; color: #2A1F52; text-transform: uppercase; }
      .sign-box .space { height: 32px; }
      .sign-box .line { border-top: 1px solid #999; padding-top: 2px; font-size: 8px; font-weight: 700; }
      .diketahui { font-size: 9px; font-weight: 700; color: #2A1F52; margin-top: 6px; }
      .info-note { display: flex; align-items: center; gap: 8px; background: #F7F6FB; border: 1px solid #e4dff2; border-radius: 8px; padding: 8px 12px; margin-top: 14px; font-size: 8.5px; color: #666; }
      .info-note .ic { width: 16px; height: 16px; border-radius: 50%; background: #6b3fa0; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 9px; flex-shrink: 0; }
      .catatan { font-size: 10px; margin-top: 10px; }
      .bottom-footer { margin-top: 16px; padding-top: 10px; border-top: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
      .bottom-footer .l { display: flex; align-items: center; gap: 8px; }
      .bottom-footer .mini-logo { width: 22px; height: 22px; border-radius: 6px; background: #2A1F52; color: #F4B740; font-weight: 900; font-size: 8px; display: flex; align-items: center; justify-content: center; }
      .bottom-footer .l span { font-size: 8px; color: #999; }
      .bottom-footer .r { font-size: 8.5px; color: #555; text-align: right; }
      .page-badge { position: absolute; bottom: 8px; right: 12px; background: #2A1F52; color: #fff; font-size: 8px; font-weight: 700; padding: 3px 10px; border-radius: 20px; }

      /* ── Mode kompak fit-1-halaman: sama pola kayak Berita Acara — compact-1..4 cuma
         nyusutin padding/margin/gap (font-size nggak disentuh), compact-5..7 PILIHAN
         TERAKHIR turunin font tabel pelan-pelan kalau 1-4 masih belum cukup. ── */
      #pdfZoom.compact-1 { padding: 16px 20px 12px; }
      #pdfZoom.compact-1 .box { padding: 7px 10px; }
      #pdfZoom.compact-1 .grid3 { gap: 8px; margin-bottom: 8px; }
      #pdfZoom.compact-1 .detail-row { margin-bottom: 5px; }
      #pdfZoom.compact-1 .main-title { margin: 6px 0 2px; font-size: 18px; }
      #pdfZoom.compact-1 table.tbl td { padding: 3px 6px; }
      #pdfZoom.compact-1 .sign-grid { margin-top: 10px; }
      #pdfZoom.compact-1 .sign-box .space { height: 22px; }
      #pdfZoom.compact-1 .bagian-ribbon { margin: 10px 0 6px; }
      #pdfZoom.compact-1 .bagian2-box { padding: 8px 10px 4px; }

      #pdfZoom.compact-2 { padding: 12px 16px 10px; }
      #pdfZoom.compact-2 .box { padding: 5px 8px; }
      #pdfZoom.compact-2 .row { padding: 1px 0; }
      #pdfZoom.compact-2 .detail-row { margin-bottom: 3px; }
      #pdfZoom.compact-2 table.tbl td, #pdfZoom.compact-2 table.tbl th { padding: 2px 5px; }
      #pdfZoom.compact-2 .sign-box .space { height: 14px; }
      #pdfZoom.compact-2 .info-note { padding: 5px 10px; margin-top: 8px; }
      #pdfZoom.compact-2 .bottom-footer { margin-top: 8px; padding-top: 6px; }

      #pdfZoom.compact-3 .main-title { font-size: 15px; margin: 4px 0 1px; }
      #pdfZoom.compact-3 .title-underline { margin: 0 auto 8px; }
      #pdfZoom.compact-3 .box h3 { margin-bottom: 4px; }
      #pdfZoom.compact-3 .grid3 { gap: 6px; }

      #pdfZoom.compact-4 .sign-box .space { height: 8px; } /* batas minimal, tetep kepake buat ttd */
      #pdfZoom.compact-4 table.tbl td { padding: 1.5px 4px; }

      #pdfZoom.compact-5 table.tbl { font-size: 8.5px; }
      #pdfZoom.compact-6 table.tbl { font-size: 7.5px; }
      #pdfZoom.compact-7 table.tbl { font-size: 6.5px; }
    </style></head><body>
      <div class="page" id="pdfZoom">
        <div class="corner-tl"></div>
        <div class="corner-br"></div>

        <div class="topbar">
          <div class="brand">
            <div class="brand-logo">KLA</div>
            <div class="brand-text">PT. KLA<br>TEKNOLOGI INDONESIA</div>
          </div>
          <div class="doc-title">SPDLK - <span>${esc(tujuanKota.toUpperCase())}</span></div>
          <table class="doc-meta-tbl">
            <tr><td>No dok.</td><td>${savedRow ? esc(noDokOf(savedRow)) : "\u2014"}</td></tr>
            <tr><td>Tgl dok</td><td>${savedRow ? esc(tglDokOf(savedRow)) : "\u2014"}</td></tr>
            <tr><td>Revisi</td><td>&nbsp;</td></tr>
          </table>
        </div>

        <div class="main-title">SURAT PERINTAH <span>DINAS LUAR KOTA</span></div>
        <div class="title-underline"></div>

        <div class="grid3">
          <div class="box">
            <h3><span class="ic">&#128100;</span> Yang Menugaskan</h3>
            <div class="row"><span>Nama Pejabat</span><span>${esc(YANG_MENUGASKAN.nama)}</span></div>
            <div class="row"><span>Jabatan</span><span>${esc(YANG_MENUGASKAN.jabatan)}</span></div>
            <div class="row"><span>NIK</span><span>&nbsp;</span></div>
          </div>
          <div class="box">
            <h3><span class="ic">&#128100;</span> Yang Ditugaskan</h3>
            <div class="row"><span>Nama Pejabat</span><span>${esc(profile?.full_name || "\u2014")}</span></div>
            <div class="row"><span>Jabatan Pelaksana</span><span>Staff</span></div>
            <div class="row"><span>NIK</span><span>${esc(profile?.nik || "\u2014")}</span></div>
            <div class="row"><span>Department</span><span>Audit</span></div>
          </div>
          <div class="box">
            <h3>Jenis Perjalanan</h3>
            ${["Sementara", "Mandah"].map((opt) => `<div class="jenis-opt ${jenisPerjalanan === opt ? "on" : ""}"><span class="chk"></span><span>${opt}</span></div>`).join("")}
          </div>
        </div>

        <div class="detail-row"><span class="ic">&#127919;</span><div><b>Maksud Perjalanan Dinas</b>${esc(maksud) || "\u2014"}</div></div>
        <div class="detail-row"><span class="ic">&#128205;</span><div><b>Tujuan Perjalanan Dinas (Kota)</b>${esc(tujuanKota) || "\u2014"}</div></div>
        <div class="detail-row"><span class="ic">&#128197;</span><div><b>Waktu Perjalanan Dinas</b>${fmtDate(tglMulai)} s/d ${fmtDate(tglSelesai)}</div></div>

        <div class="bagian-ribbon"><span>BAGIAN 1 &middot; PENGAJUAN (SEBELUM KEBERANGKATAN)</span></div>
        <table class="tbl">
          <thead><tr><th>Jenis Fasilitas</th><th>Detail</th><th>Nilai (Rp)</th><th>Jumlah</th><th>Nota</th><th>Total</th></tr></thead>
          <tbody>
            ${rowsHtml(items)}
            <tr class="total-row"><td colspan="5">TOTAL ANGGARAN</td><td class="num">${fmtRupiah(totalAnggaran)}</td></tr>
          </tbody>
        </table>

        ${catatan ? `<div class="catatan"><b>Catatan Khusus:</b> ${esc(catatan)}</div>` : ""}

        ${signGrid(["Pemberi Tugas", "Penerima Tugas", "Finance", "Fin & Acc Manager", "HC Manager", "CEO"], { CEO: YANG_MENUGASKAN.nama })}

        ${realisasiSection}

        <div class="info-note"><span class="ic">i</span><span>Dibuat rangkap 3 (tiga) untuk Pelaksana, Finance &amp; Acc Dept, dan HR Dept.</span></div>

        <div class="bottom-footer">
          <div class="l"><div class="mini-logo">KLA</div><span>PT. KLA Teknologi Indonesia &bull; Confidential</span></div>
          <div class="r">${esc(tujuanKota)} &bull; ${fmtDate(tglMulai)}</div>
        </div>
        <div class="page-badge">1/1</div>
      </div>
    <script>
      window.onload = () => {
        const zoomEl = document.getElementById("pdfZoom");
        const targetHeight = 1000; // ruang aman cetak A4
        const steps = ["compact-1", "compact-2", "compact-3", "compact-4", "compact-5", "compact-6", "compact-7"];
        let i = 0;
        while (zoomEl.scrollHeight > targetHeight && i < steps.length) {
          zoomEl.classList.add(steps[i]);
          i++;
        }
        setTimeout(() => window.print(), 200);
      };
    <\/script>
    </body></html>`);
    win.document.close();
  }

  if (loading) return <div style={{ padding: 40, color: "var(--text-secondary)" }}>Memuat\u2026</div>;

  // ── LIST VIEW ──
  if (!selected) {
    return (
      <div style={{ flex: 1 }}>
        <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Biaya Dinas</div>
            <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>{isolate ? "Pengajuan Surat Perintah Dinas Luar Kota (SPDLK) kamu sendiri" : "Pengajuan Surat Perintah Dinas Luar Kota (SPDLK) semua auditor"}</div>
          </div>
          {canManage && <button className="btn" onClick={openNew}>+ Pengajuan Baru</button>}
        </div>

        {error && <div style={{ margin: "14px 28px 0", background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}

        <div style={{ padding: 24 }}>
          {list.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--text-faint)", padding: 60 }}>Belum ada pengajuan dinas.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 720 }}>
              {list.map((row) => (
                <div key={row.id} onClick={() => openEntry(row)} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 18px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14.5 }}>{row.tujuan_kota || "\u2014"}</div>
                    <div style={{ fontSize: 12, color: "var(--text-faint)" }}>{fmtDate(row.tanggal_mulai)} s/d {fmtDate(row.tanggal_selesai)} &middot; {row.maksud}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{fmtRupiah(row.total_anggaran)}</div>
                    <div style={{ fontSize: 11, color: row.total_realisasi != null ? "#1a9e6e" : "var(--text-faint)" }}>{row.total_realisasi != null ? "Realisasi terisi" : "Belum ada realisasi"}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── FORM VIEW ──
  return (
    <div style={{ flex: 1 }}>
      <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <button className="btn-ghost" onClick={() => setSelected(null)} style={{ marginBottom: 8 }}>&larr; Daftar pengajuan</button>
          <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>{selected === "new" ? "Pengajuan Dinas Baru" : "Edit Pengajuan Dinas"}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {selected !== "new" && <button className="btn-ghost" onClick={printPDF}>Cetak PDF</button>}
          {selected !== "new" && (profile?.role === "super_admin" || (profile?.role === "auditor" && savedRow?.submitted_by === profile?.id)) && (
            <button className="btn-ghost" disabled={saving} style={{ color: "var(--danger-text)", borderColor: "var(--danger-border)" }} onClick={deleteRecord}>Hapus</button>
          )}
          <button className="btn" disabled={saving || !canManage} onClick={saveRecord}>{saving ? "Menyimpan\u2026" : "Simpan"}</button>
        </div>
      </div>

      {error && <div style={{ margin: "14px 28px 0", background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}

      <div style={{ padding: 24, maxWidth: 820, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 4 }}>Maksud Perjalanan Dinas</label>
              <input className="input" disabled={!canManage} value={maksud} onChange={(e) => setMaksud(e.target.value)} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 4 }}>Tujuan Kota</label>
              <input className="input" placeholder="Misal: Tegal & Slawi" disabled={!canManage} value={tujuanKota} onChange={(e) => setTujuanKota(e.target.value)} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 4 }}>Tanggal Mulai</label>
              <input className="input" type="date" disabled={!canManage} value={tglMulai} onChange={(e) => setTglMulai(e.target.value)} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 4 }}>Tanggal Selesai</label>
              <input className="input" type="date" disabled={!canManage} value={tglSelesai} onChange={(e) => setTglSelesai(e.target.value)} />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={{ display: "block", fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 4 }}>Jenis Perjalanan Dinas</label>
            <div style={{ display: "flex", gap: 14 }}>
              {["Sementara", "Mandah"].map((opt) => (
                <label key={opt} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: canManage ? "pointer" : "default" }}>
                  <input type="radio" name="jenisPerjalanan" disabled={!canManage} checked={jenisPerjalanan === opt} onChange={() => setJenisPerjalanan(opt)} />
                  {opt}
                </label>
              ))}
            </div>
          </div>
        </div>

        {profile?.nik && !editingNik ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: "var(--text-secondary)" }}>
            <span>NIK: <b style={{ color: "var(--text-primary)" }}>{profile.nik}</b></span>
            <button className="btn-ghost" style={{ padding: "3px 10px", fontSize: 11.5 }} onClick={() => { setNikDraft(profile.nik); setEditingNik(true); }}>Ubah NIK</button>
          </div>
        ) : (
          <div style={{ background: profile?.nik ? "var(--surface)" : "var(--danger-bg)", border: profile?.nik ? "1px solid var(--border)" : "1px solid rgba(248,113,113,0.35)", borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 12.5, marginBottom: 8 }}>{profile?.nik ? "Ubah NIK kamu:" : "NIK kamu belum diisi — perlu buat dokumen SPDLK. Isi sekali aja, otomatis kepake terus."}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input" placeholder="NIK" value={nikDraft} onChange={(e) => setNikDraft(e.target.value)} style={{ maxWidth: 220 }} />
              <button className="btn" disabled={savingNik || !nikDraft.trim()} onClick={async () => {
                setSavingNik(true);
                const { error: err } = await supabase.from("profiles").update({ nik: nikDraft.trim() }).eq("id", profile.id);
                if (err) setError("Gagal simpan NIK: " + err.message);
                else { profile.nik = nikDraft.trim(); setEditingNik(false); } // biar langsung kepake tanpa reload
                setSavingNik(false);
              }}>{savingNik ? "Menyimpan\u2026" : "Simpan NIK"}</button>
              {profile?.nik && <button className="btn-ghost" onClick={() => setEditingNik(false)}>Batal</button>}
            </div>
          </div>
        )}

        <ItemsEditor title="Fasilitas & Biaya (Anggaran)" items={items} canManage={canManage} onUpdate={updateItem} onAdd={addItemRow} onRemove={removeItemRow} total={totalAnggaran} />

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
          <label style={{ display: "block", fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 4 }}>Catatan Khusus (opsional)</label>
          <textarea className="input" rows={2} disabled={!canManage} value={catatan} onChange={(e) => setCatatan(e.target.value)} />
        </div>

        {selected !== "new" && (
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>Pelaporan Biaya (Realisasi)</div>
              {canManage && (
                <button className="btn-ghost" onClick={() => {
                  setShowRealisasi((v) => !v);
                  if (!showRealisasi && !realisasiItems.length) {
                    // Isi awal langsung dari anggaran (bukan baris kosong) — biar tinggal koreksi
                    // nilainya, nggak perlu ngetik ulang Jenis Fasilitas/Detail dari nol.
                    setRealisasiItems(items.map((it) => ({ ...it, id: Date.now() + Math.random().toString(36).slice(2) })));
                  }
                }}>
                  {showRealisasi ? "Sembunyikan" : "Isi Realisasi"}
                </button>
              )}
            </div>
            {showRealisasi && (
              <div style={{ marginTop: 12 }}>
                {canManage && (
                  <button className="btn-ghost" style={{ marginBottom: 10, fontSize: 12 }} onClick={() => setRealisasiItems(items.map((it) => ({ ...it, id: Date.now() + Math.random().toString(36).slice(2) })))}>
                    &#8635; Copy dari Anggaran
                  </button>
                )}
                <ItemsEditor title={null} items={realisasiItems} canManage={canManage} onUpdate={updateRItem} onAdd={addRItemRow} onRemove={removeRItemRow} total={totalRealisasi} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ItemsEditor({ title, items, canManage, onUpdate, onAdd, onRemove, total }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
      {title && <div style={{ fontWeight: 700, fontSize: 14.5, marginBottom: 10 }}>{title}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1.6fr 1fr 0.7fr 0.9fr 1fr auto", gap: 6, fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", padding: "0 4px" }}>
          <div>Jenis Fasilitas</div><div>Detail</div><div>Nilai (Rp)</div><div>Jumlah</div><div>Ada Nota</div><div>Total</div><div></div>
        </div>
        {items.map((it, i) => (
          <div key={it.id || i} style={{ display: "grid", gridTemplateColumns: "1.3fr 1.6fr 1fr 0.7fr 0.9fr 1fr auto", gap: 6, alignItems: "center" }}>
            <input className="input" placeholder="Transportasi" disabled={!canManage} value={it.jenis} onChange={(e) => onUpdate(i, { jenis: e.target.value })} style={{ fontSize: 12.5 }} />
            <input className="input" placeholder="Kereta" disabled={!canManage} value={it.detail} onChange={(e) => onUpdate(i, { detail: e.target.value })} style={{ fontSize: 12.5 }} />
            <input className="input" type="number" disabled={!canManage} value={it.nilai} onChange={(e) => onUpdate(i, { nilai: e.target.value })} style={{ fontSize: 12.5 }} />
            <input className="input" type="number" disabled={!canManage} value={it.jumlah} onChange={(e) => onUpdate(i, { jumlah: e.target.value })} style={{ fontSize: 12.5 }} />
            <select className="input" disabled={!canManage} value={it.ada_nota ? "ada" : "tidak"} onChange={(e) => onUpdate(i, { ada_nota: e.target.value === "ada" })} style={{ fontSize: 12.5 }}>
              <option value="ada">Ada</option>
              <option value="tidak">Tidak</option>
            </select>
            <div style={{ fontSize: 12.5, fontWeight: 600, textAlign: "right", paddingRight: 6 }}>{fmtRupiah(itemTotal(it))}</div>
            {canManage && (
              <span onClick={() => onRemove(i)} style={{ cursor: "pointer", color: "var(--danger-text)", fontSize: 16, textAlign: "center" }}>&times;</span>
            )}
          </div>
        ))}
      </div>
      {canManage && <button className="btn-ghost" onClick={onAdd} style={{ marginTop: 10 }}>+ Tambah Baris</button>}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 14 }}>
        <span>Total</span><span>{fmtRupiah(total)}</span>
      </div>
    </div>
  );
}
