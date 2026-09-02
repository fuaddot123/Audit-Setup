import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";
import { sortBranches } from "../lib/branchOrder";
import {
  INVENTARIS_CATEGORIES, freshInventaris, normalizeInventaris, countRusak,
  uploadInventarisMedia, InventarisChecklist, deleteMediaFromStorage, deleteMediaListFromStorage,
  freshInventarisUntuk, normalizeInventarisUntuk, kunciTerpakai,
  itemBelumTersedia, skorInventaris,
} from "./AuditInventaris";
import { pakaiFormatBaru, namaPeriode, INVENTARIS_ITEMS, kunciItem } from "../lib/format-ba";
import { cetakBaruHtml } from "./BeritaAcaraCetakBaru";
import {
  DisplaySection, muatDisplay, simpanDisplay, periksaDisplay,
  barisDisplayBaru, uploadDisplayMedia,
} from "./DisplayMonitoring";

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
function shortDate(d) {
  if (!d) return "\u2014";
  return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}
function todayInputValue() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

// Sama persis dengan pola threshold di components/sop/SopKepatuhan.js
function kategoriInfo(pct) {
  const v = pct * 100;
  if (v >= 90) return { lbl: "Sangat Baik", color: "#1a9e6e" };
  if (v >= 80) return { lbl: "Baik", color: "#2f9e46" };
  if (v >= 70) return { lbl: "Cukup", color: "#b07212" };
  return { lbl: "Perlu Perbaikan", color: "#a32020" };
}

export default function BeritaAcara({ profile }) {
  // Mode "lihat sebagai": seluruh isian dikunci. Pagar sungguhannya ada di
  // RLS — submitted_by wajib sama dengan pengguna yang benar-benar login.
  const canEdit = (profile?.role === "auditor" || profile?.role === "super_admin") && !profile?.liatSebagai;
  // Isolasi per-auditor mulai Agustus 2026 ke depan (Jan-Jul 2026 tetep gabungan semua kayak biasa).
  const ISOLATION_START_PERIOD = "2026-08";

  const [branches, setBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [latestByBranchPeriod, setLatestByBranchPeriod] = useState({});
  const [viewPeriod, setViewPeriod] = useState(nowPeriode());
  const [selectedBranch, setSelectedBranch] = useState(null);

  const [entriesThisPeriod, setEntriesThisPeriod] = useState([]);
  const [selectedEntryId, setSelectedEntryId] = useState(null);
  const [selectedInventarisEntryId, setSelectedInventarisEntryId] = useState(null);

  const [auditDate, setAuditDate] = useState(todayInputValue());
  const [waktuAudit, setWaktuAudit] = useState("");
  const [kegiatan, setKegiatan] = useState("Audit Stock Opname, SOP, Inventaris, Kas Kecil, dan Report Penjualan");
  const [perlengkapan, setPerlengkapan] = useState("Laptop dan Scanner");
  const [stockKat1, setStockKat1] = useState([]);
  const [stockKat2, setStockKat2] = useState([]);
  const [inventaris, setInventaris] = useState(freshInventaris());
  const [storeManagerName, setStoreManagerName] = useState("");
  const [storeLeaderName, setStoreLeaderName] = useState("");
  const [tidakVisit, setTidakVisit] = useState(false);
  const [cabangBaru, setCabangBaru] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [uploadingKey, setUploadingKey] = useState(null);

  const [prevMonthData, setPrevMonthData] = useState(null); // { stockKat1, stockKat2, inventarisCategories, periodLabel } | null
  const [showCopyBanner, setShowCopyBanner] = useState(false);
  const [stockFilter, setStockFilter] = useState("all"); // "all" | "selisih"
  const [invFilter, setInvFilter] = useState("all"); // "all" | "rusak"

  // ── Monitoring Display ──
  // displayRows tidak diketik ulang tiap bulan: unit yang masih dipajang
  // datang sendiri dari tabel display_unit lewat view v_display_monitoring.
  const [displayRows, setDisplayRows] = useState([]);
  const [perlakuanOpsi, setPerlakuanOpsi] = useState([]);
  const [kondisiOpsi, setKondisiOpsi] = useState([]);
  const [displayUploadIdx, setDisplayUploadIdx] = useState(null);
  const [displayError, setDisplayError] = useState(null);

  useEffect(() => { loadBranches(); }, []);

  async function loadBranches() {
    setLoadingBranches(true);
    const { data, error: err } = await supabase.from("branches").select("*").order("name");
    if (!err) setBranches(sortBranches(data || []));
    let recQuery = supabase.from("berita_acara").select("*");
    if (profile?.role === "auditor") {
      recQuery = recQuery.or(`period.lt.${ISOLATION_START_PERIOD},submitted_by.eq.${profile.id}`);
    }
    const { data: recs, error: recErr } = await recQuery;
    if (!recErr) {
      const sorted = [...(recs || [])].sort((a, b) => (b.audit_date || "").localeCompare(a.audit_date || ""));
      const map = {};
      sorted.forEach((r) => {
        const key = `${r.branch_id}|${r.period}`;
        if (!map[key]) map[key] = { entry: r, count: 1 };
        else map[key].count += 1;
      });
      setLatestByBranchPeriod(map);
    } else {
      setError("Gagal memuat data: " + recErr.message);
    }
    setLoadingBranches(false);
  }

  function applyEntryToForm(entry, invEntry) {
    setWaktuAudit(entry.waktu_audit || "");
    setKegiatan(entry.kegiatan || "Audit Stock Opname, SOP, Inventaris, Kas Kecil, dan Report Penjualan");
    setPerlengkapan(entry.perlengkapan || "Laptop dan Scanner");
    setStockKat1(Array.isArray(entry.stock_opname_kat1) ? entry.stock_opname_kat1 : []);
    setStockKat2(Array.isArray(entry.stock_opname_kat2) ? entry.stock_opname_kat2 : []);
    setStoreManagerName(entry.store_manager_name || "");
    setStoreLeaderName(entry.store_leader_name || "");
    setTidakVisit(!!entry.tidak_visit);
    setCabangBaru(!!entry.cabang_baru);
    setAuditDate(entry.audit_date || todayInputValue());
    setSelectedEntryId(entry.id);
    // Bentuknya mengikuti periode ENTRI ITU. Audit Agustus yang dibuka hari
    // ini harus tetap terbaca 10 kategori, bukan dipaksa jadi 36 item.
    setInventaris(normalizeInventarisUntuk(invEntry?.data?.categories, entry.period || viewPeriod));
    setSelectedInventarisEntryId(invEntry?.id || null);
    setShowCopyBanner(false);
  }

  function startNewEntry(period) {
    setWaktuAudit("");
    setKegiatan("Audit Stock Opname, SOP, Inventaris, Kas Kecil, dan Report Penjualan");
    setPerlengkapan("Laptop dan Scanner");
    setStockKat1([]);
    setStockKat2([]);
    setInventaris(freshInventarisUntuk(period));
    setStoreManagerName("");
    setStoreLeaderName("");
    setTidakVisit(false);
    setCabangBaru(false);
    setAuditDate(period === nowPeriode() ? todayInputValue() : period + "-01");
    setSelectedEntryId(null);
    setSelectedInventarisEntryId(null);
    setSaved(false);
    setShowCopyBanner(!!prevMonthData);
  }

  async function pickBranch(b) {
    setSelectedBranch(b);
    setSaved(false);
    setError(null);
    setLoadingRecord(true);
    const period = viewPeriod;
    const prevPeriod = addMonthsToPeriod(period, -1);
    const isolate = profile?.role === "auditor";
    let beQuery = supabase.from("berita_acara").select("*").eq("branch_id", b.id).eq("period", period);
    if (isolate && period >= ISOLATION_START_PERIOD) beQuery = beQuery.eq("submitted_by", profile.id);
    let invQuery = supabase.from("audit_generic").select("*").eq("module", "inventaris").eq("branch_id", b.id).eq("period", period);
    if (isolate && period >= ISOLATION_START_PERIOD) invQuery = invQuery.eq("submitted_by", profile.id);
    let bePrevQuery = supabase.from("berita_acara").select("*").eq("branch_id", b.id).eq("period", prevPeriod);
    if (isolate && prevPeriod >= ISOLATION_START_PERIOD) bePrevQuery = bePrevQuery.eq("submitted_by", profile.id);
    let invPrevQuery = supabase.from("audit_generic").select("*").eq("module", "inventaris").eq("branch_id", b.id).eq("period", prevPeriod);
    if (isolate && prevPeriod >= ISOLATION_START_PERIOD) invPrevQuery = invPrevQuery.eq("submitted_by", profile.id);
    const [beRes, invRes, bePrevRes, invPrevRes] = await Promise.all([beQuery, invQuery, bePrevQuery, invPrevQuery]);

    // Data display dimuat terpisah dan galatnya SENGAJA tidak dilempar ke
    // atas: kalau schema-display.sql belum dijalankan, Berita Acara harus
    // tetap bisa dipakai. Pesannya ditampilkan di sectionnya sendiri,
    // bukan ditelan diam-diam.
    setDisplayError(null);
    try {
      const d = await muatDisplay({ branchId: b.id, period });
      setDisplayRows(d.rows);
      setPerlakuanOpsi(d.perlakuanOpsi);
      setKondisiOpsi(d.kondisiOpsi);
    } catch (errDisplay) {
      setDisplayRows([]); setPerlakuanOpsi([]); setKondisiOpsi([]);
      setDisplayError("Data display tidak bisa dimuat: " + errDisplay.message);
    }
    const entries = !beRes.error
      ? [...(beRes.data || [])].sort((a, b) => (b.audit_date || "").localeCompare(a.audit_date || ""))
      : [];
    const invEntries = !invRes.error ? (invRes.data || []) : [];
    setEntriesThisPeriod(entries);

    // Siapkan data bulan lalu (buat tombol "Salin dari bulan lalu"), pakai audit paling baru kalau ada beberapa.
    const bePrevEntries = !bePrevRes.error
      ? [...(bePrevRes.data || [])].sort((a, b2) => (b2.audit_date || "").localeCompare(a.audit_date || ""))
      : [];
    const invPrevEntries = !invPrevRes.error ? (invPrevRes.data || []) : [];
    if (bePrevEntries.length) {
      const prevLatest = bePrevEntries[0];
      const pairedInvPrev = invPrevEntries.find((iv) => iv.data?.audit_date === prevLatest.audit_date) || invPrevEntries[0] || null;
      setPrevMonthData({
        stockKat1: Array.isArray(prevLatest.stock_opname_kat1) ? prevLatest.stock_opname_kat1 : [],
        stockKat2: Array.isArray(prevLatest.stock_opname_kat2) ? prevLatest.stock_opname_kat2 : [],
        inventarisCategories: pairedInvPrev?.data?.categories || null,
        periodLabel: periodeLabel(prevPeriod),
        storeLeaderName: prevLatest.store_leader_name || "",
        storeManagerName: prevLatest.store_manager_name || "",
      });
    } else {
      setPrevMonthData(null);
    }

    if (entries.length) {
      const latest = entries[0];
      const pairedInv = invEntries.find((iv) => iv.data?.audit_date === latest.audit_date) || invEntries[0] || null;
      applyEntryToForm(latest, pairedInv);
      setShowCopyBanner(false);
    } else {
      startNewEntry(period);
      setShowCopyBanner(!!bePrevEntries.length);
    }
    setLoadingRecord(false);
  }

  function copyFromPrevMonth() {
    if (!prevMonthData) return;
    setStockKat1(prevMonthData.stockKat1.map((r) => ({ nama: r.nama, status: "Lengkap", keterangan: "" })));
    setStockKat2(prevMonthData.stockKat2.map((r) => ({ nama: r.nama, status: "Lengkap", keterangan: "" })));
    if (prevMonthData.storeLeaderName) setStoreLeaderName(prevMonthData.storeLeaderName);
    if (prevMonthData.storeManagerName) setStoreManagerName(prevMonthData.storeManagerName);
    if (prevMonthData.inventarisCategories) {
      // Bulan lalu bisa saja berbentuk lama sementara periode ini sudah baru
      // (persis yang terjadi Agustus -> September 2026). Yang dipakai adalah
      // bentuk PERIODE INI, isinya dikosongkan — auditor tinggal ubah yang beda.
      setInventaris(freshInventarisUntuk(period));
    }
    setShowCopyBanner(false);
    setSaved(false);
  }

  function backToList() {
    setSelectedBranch(null);
    setEntriesThisPeriod([]);
    setSelectedEntryId(null);
    setSelectedInventarisEntryId(null);
    loadBranches();
  }

  // ── Stock Opname (Kategori 1 & 2) row helpers ──
  function addRow(setter) { setter((prev) => [...prev, newStockRow()]); setSaved(false); }
  function updateRow(setter, i, field, val) {
    setter((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));
    setSaved(false);
  }
  function removeRow(setter, i) { setter((prev) => prev.filter((_, idx) => idx !== i)); setSaved(false); }

  // ── Inventaris helpers ──
  // Menandai SEMUA item sekaligus. Lewat satu setState, bukan 36 panggilan
  // updateInventaris berturut-turut — selain lebih ringan, ia juga menghindari
  // 36 gambar-ulang yang membuat layar tersendat di tablet.
  function setSemuaInventaris(status) {
    setInventaris((prev) => {
      const next = {};
      Object.keys(prev).forEach((k) => { next[k] = { ...prev[k], status, keterangan: "" }; });
      return next;
    });
    setSaved(false);
  }

  function updateInventaris(cat, field, val) {
    setInventaris((prev) => ({ ...prev, [cat]: { ...prev[cat], [field]: val } }));
    setSaved(false);
  }
  async function handleUploadInventarisMedia(cat, fileList) {
    if (!selectedBranch) return;
    const key = `inv-${cat}`;
    setUploadingKey(key);
    setError(null);
    try {
      const uploaded = await uploadInventarisMedia({ branchId: selectedBranch.id, period: viewPeriod, cat, fileList });
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
  function removeInventarisMedia(cat, mediaIdx) {
    setInventaris((prev) => {
      const photos = [...(prev[cat].photos || [])];
      const [removed] = photos.splice(mediaIdx, 1);
      deleteMediaFromStorage(removed?.url); // hapus filenya juga di Storage, nggak cuma dari state
      return { ...prev, [cat]: { ...prev[cat], photos } };
    });
    setSaved(false);
  }

  // ── Handler Monitoring Display ──

  function updateDisplay(i, field, value) {
    setDisplayRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
    setSaved(false);
  }

  function addDisplay() {
    setDisplayRows((prev) => [...prev, barisDisplayBaru()]);
    setSaved(false);
  }

  // Unit hasil impor Excel. KONDISI FISIK SENGAJA DIBIARKAN KOSONG — ia hasil
  // pemeriksaan di tempat, bukan isi berkas. Mengisinya otomatis berarti
  // Berita Acara memuat penilaian yang tidak pernah dilakukan siapa pun.
  function imporDisplay(barisBaru) {
    setDisplayRows((prev) => [
      ...prev,
      ...barisBaru.map((r) => ({
        ...barisDisplayBaru(),
        brand: r.brand,
        model: r.model,
        serial_number: r.serial_number || "",
        tanggal_pajang: r.tanggal_pajang,
        program_nama: r.program_nama || "",
        program_brand: !!r.program_nama,
      })),
    ]);
    setSaved(false);
  }

  function removeDisplay(i) {
    // Hanya baris baru yang boleh dibuang dari form. Unit yang sudah
    // tersimpan diturunkan lewat tombol "Turunkan" supaya riwayat dan
    // perlakuannya tetap tercatat, bukan dihapus begitu saja.
    setDisplayRows((prev) => (prev[i] && prev[i].baru ? prev.filter((_, idx) => idx !== i) : prev));
    setSaved(false);
  }

  async function handleUploadDisplayMedia(i, fileList) {
    if (!fileList || !fileList.length) return;
    setDisplayUploadIdx(i);
    setError(null);
    try {
      const uploaded = await uploadDisplayMedia({
        branchId: selectedBranch.id, period: viewPeriod, idx: i, fileList,
      });
      setDisplayRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, photos: [...r.photos, ...uploaded] } : r)));
      setSaved(false);
    } catch (err) {
      setError("Gagal unggah foto display: " + err.message);
    } finally {
      setDisplayUploadIdx(null);
    }
  }

  async function removeDisplayMedia(i, mediaIdx) {
    const media = displayRows[i] && displayRows[i].photos[mediaIdx];
    setDisplayRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, photos: r.photos.filter((_, mi) => mi !== mediaIdx) } : r)));
    setSaved(false);
    if (media && media.url) await deleteMediaFromStorage(media.url);
  }

  async function saveRecord() {
    if (!canEdit) { setError("Kamu tidak punya izin untuk menyimpan."); return; }
    if (!auditDate) { setError("Tanggal audit wajib diisi."); return; }
    setSaving(true);
    setError(null);
    try {
      const user = (await supabase.auth.getUser()).data.user;

      const beritaPayload = {
        branch_id: selectedBranch.id,
        period: viewPeriod,
        audit_date: auditDate,
        waktu_audit: waktuAudit,
        kegiatan,
        perlengkapan,
        stock_opname_kat1: stockKat1,
        stock_opname_kat2: stockKat2,
        store_manager_name: storeManagerName,
        store_leader_name: storeLeaderName,
        tidak_visit: tidakVisit,
        cabang_baru: cabangBaru,
        submitted_by: user.id,
        updated_at: new Date().toISOString(),
      };
      let beRow;
      if (selectedEntryId) {
        const res = await supabase.from("berita_acara").update(beritaPayload).eq("id", selectedEntryId).select().single();
        if (res.error) throw res.error;
        beRow = res.data;
      } else {
        const res = await supabase.from("berita_acara").insert(beritaPayload).select().single();
        if (res.error) throw res.error;
        beRow = res.data;
      }

      let invRow = null;
      if (!tidakVisit) {
        const invPayload = {
          module: "inventaris",
          branch_id: selectedBranch.id,
          period: viewPeriod,
          status: "submitted",
          submitted_by: user.id,
          data: { tidak_visit: false, categories: inventaris, auditor_name: profile?.full_name || null, audit_date: auditDate },
        };
        if (selectedInventarisEntryId) {
          const res = await supabase.from("audit_generic").update(invPayload).eq("id", selectedInventarisEntryId).select().single();
          if (res.error) throw res.error;
          invRow = res.data;
        } else {
          const res = await supabase.from("audit_generic").insert(invPayload).select().single();
          if (res.error) throw res.error;
          invRow = res.data;
        }
      }

      // Simpan data display sesudah berita acara tersimpan, supaya
      // tanggal audit yang dipakai sama persis.
      const galatDisplay = periksaDisplay(displayRows);
      if (galatDisplay.length) throw new Error(galatDisplay.join(" "));
      if (displayRows.length) {
        await simpanDisplay({
          rows: displayRows, branchId: selectedBranch.id, period: viewPeriod,
          auditDate, userId: user.id, kondisiOpsi, perlakuanOpsi,
        });
        // Dimuat ulang termasuk DAFTAR PILIHANNYA — istilah baru yang barusan
        // didaftarkan harus langsung muncul di dropdown, bukan menunggu
        // halaman dibuka lagi.
        const d = await muatDisplay({ branchId: selectedBranch.id, period: viewPeriod });
        setDisplayRows(d.rows);
        setPerlakuanOpsi(d.perlakuanOpsi);
        setKondisiOpsi(d.kondisiOpsi);
      }

      setSelectedEntryId(beRow.id);
      setSelectedInventarisEntryId(invRow ? invRow.id : null);
      setEntriesThisPeriod((prev) => {
        const others = prev.filter((e) => e.id !== beRow.id);
        return [beRow, ...others].sort((a, b) => (b.audit_date || "").localeCompare(a.audit_date || ""));
      });
      setSaved(true);
    } catch (err) {
      setError("Gagal menyimpan: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecord() {
    if (!selectedEntryId) return;
    const entry = entriesThisPeriod.find((e) => e.id === selectedEntryId);
    const isOwner = profile?.role === "auditor" && entry?.submitted_by === profile?.id;
    if (profile?.role !== "super_admin" && !isOwner) return;
    if (!window.confirm(`Hapus audit ${selectedBranch.name} tanggal ${shortDate(entry?.audit_date)}? Aksi ini tidak bisa dibatalkan.`)) return;
    setSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase.from("berita_acara").delete().eq("id", selectedEntryId);
      if (err) throw err;
      if (selectedInventarisEntryId) {
        await supabase.from("audit_generic").delete().eq("id", selectedInventarisEntryId);
      }
      // Kumpulin semua foto/video Inventaris di record ini (dari semua kategori), hapus dari Storage
      // juga — biar nggak nyisain file orphan pas audit-nya udah kehapus dari database.
      // kunciTerpakai() mengikuti BENTUK datanya (10 kategori atau 36 item).
      // Kalau tetap dipatok 10 kategori, foto milik data per item tidak ikut
      // terhapus dan tertinggal jadi berkas yatim di Storage — tanpa galat.
      const allMedia = kunciTerpakai(inventaris).flatMap((k) => inventaris[k]?.photos || []);
      deleteMediaListFromStorage(allMedia);
      const remaining = entriesThisPeriod.filter((e) => e.id !== selectedEntryId);
      setEntriesThisPeriod(remaining);
      if (remaining.length) {
        // Kalau masih ada sisa, buka yang paling baru — data Inventaris pasangannya nggak kita tau lagi
        // dari cache lokal, jadi mulai polos (auditor bisa isi ulang kalau perlu).
        applyEntryToForm(remaining[0], null);
      } else {
        startNewEntry(viewPeriod);
      }
      setSaved(false);
    } catch (err) {
      setError("Gagal menghapus: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function exportPDF() {
    if (!selectedBranch) return;
    const printDate = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

    if (tidakVisit) {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Berita Acara ${esc(selectedBranch.name)}</title>
      <style>
        * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        @page { size: A4; margin: 20mm; }
        body { font-family: Arial, Helvetica, sans-serif; color: #232323; margin: 0; }
        .page { border: 3px solid #2A1F52; border-radius: 10px; padding: 30mm 20mm; text-align: center; }
        h1 { color: #2A1F52; font-family: 'Arial Black', Arial, sans-serif; font-size: 22px; margin-bottom: 6px; }
        .sub { color: #6b5f96; font-size: 12px; font-weight: 700; margin-bottom: 30px; }
        .badge { display: inline-block; background: #88888822; color: #666; font-weight: 800; font-size: 16px; padding: 10px 26px; border-radius: 30px; margin-bottom: 20px; }
        p { font-size: 12.5px; color: #444; line-height: 1.6; }
      </style></head><body>
        <div class="page">
          <h1>BERITA ACARA AUDIT STORE</h1>
          <div class="sub">DIVISI AUDIT KLA COMPUTER</div>
          <div class="badge">TIDAK VISIT</div>
          <p><b>Cabang:</b> ${esc(selectedBranch.name)} &middot; <b>Periode:</b> ${esc(periodeLabel(viewPeriod))}</p>
          <p>Cabang ini tidak dikunjungi/tidak diaudit pada periode tersebut.</p>
          <p style="margin-top:30px;color:#999;">Dicetak ${printDate}</p>
        </div>
      </body></html>`;
      const win = window.open("", "_blank");
      if (!win) { setError("Popup diblokir browser. Izinkan popup untuk mencetak PDF."); return; }
      win.document.write(html);
      win.document.close();
      return;
    }

    function catPct(rows) {
      if (!rows.length) return null;
      const selisih = rows.filter((r) => r.status === "Selisih").length;
      return Math.round(((rows.length - selisih) / rows.length) * 100);
    }

    const stockSelisihCount = [...stockKat1, ...stockKat2].filter((r) => r.status === "Selisih").length;
    const stockTotalCount = stockKat1.length + stockKat2.length;
    const stockPct = stockTotalCount ? Math.round(((stockTotalCount - stockSelisihCount) / stockTotalCount) * 100) : 0;
    const stockInfo = kategoriInfo(stockPct / 100);
    const kat1Pct = catPct(stockKat1);
    const kat2Pct = catPct(stockKat2);
    const kat1Color = kat1Pct === null ? "#999" : kategoriInfo(kat1Pct / 100).color;
    const kat2Color = kat2Pct === null ? "#999" : kategoriInfo(kat2Pct / 100).color;

    const invRusakCount = countRusak(inventaris);
    const invTotalCount = INVENTARIS_CATEGORIES.length;
    const invPct = invTotalCount ? Math.round(((invTotalCount - invRusakCount) / invTotalCount) * 100) : 0;
    const invInfo = kategoriInfo(invPct / 100);
    const invTidakPct = 100 - invPct;

    function stockTable(title, rows) {
      const body = rows.map((r) => {
        const isBad = r.status === "Selisih";
        return `<tr>
          <td style="font-weight:600;">${esc(r.nama) || "\u2014"}</td>
          <td class="${isBad ? "status-bad" : "status-ok"}">${isBad ? "SELISIH" : "LENGKAP"}</td>
          <td>${esc(r.keterangan) || "-"}</td>
        </tr>`;
      }).join("") || `<tr><td colspan="3" style="text-align:center;color:#999;padding:10px;">Tidak ada baris diisi</td></tr>`;
      return `<tr class="kat-row"><td colspan="3">${esc(title)}</td></tr>${body}`;
    }

    const invRows = INVENTARIS_CATEGORIES.map((cat) => {
      const row = inventaris[cat] || { status: "Berfungsi", keterangan: "", photos: [] };
      const isBad = row.status === "Rusak";
      const photos = (row.photos || []).filter((p) => p.type !== "video"); // video nggak bisa dicetak, foto aja
      const photosHtml = photos.length
        ? `<div class="inv-photos">${photos.map((p) => `<img src="${esc(p.url)}" class="inv-thumb" />`).join("")}</div>`
        : "";
      return `<tr>
        <td style="font-weight:600;text-transform:uppercase;">${esc(cat)}</td>
        <td class="${isBad ? "status-bad" : "status-ok"}">${isBad ? "RUSAK" : "BERFUNGSI"}</td>
        <td>${esc(row.keterangan) || "-"}${photosHtml}</td>
      </tr>`;
    }).join("");

    // ── Data Monitoring Display untuk cetakan ──
    // Skor diambil dari view v_display_skor_periode, TIDAK dihitung ulang di
    // sini. Dua tempat yang menghitung hal yang sama adalah cara paling andal
    // untuk melahirkan dua angka yang berbeda.
    let skorD = null;
    try {
      const rSkor = await supabase.from("v_display_skor_periode").select("*")
        .eq("branch_id", selectedBranch.id).eq("period", viewPeriod).maybeSingle();
      skorD = rSkor.data || null;
    } catch (errSkor) {
      skorD = null; // tabel display belum ada — cetakan tetap jalan tanpa blok ini
    }

    // Umur dihitung terhadap TANGGAL AUDIT, bukan hari ini. Berita Acara
    // Agustus yang dicetak ulang bulan Desember harus memuat angka yang sama.
    function umurSaatAudit(tglPajang) {
      if (!tglPajang || !auditDate) return 0;
      const a = new Date(tglPajang + "T00:00:00");
      const b = new Date(auditDate + "T00:00:00");
      return Math.max(0, Math.round((b - a) / 86400000));
    }
    const labelKondisi = (kode) => (kondisiOpsi.find((k) => k.kode === kode) || {}).label || "\u2014";
    const labelPerlakuan = (kode) => (perlakuanOpsi.find((p) => p.kode === kode) || {}).label || "";

    const dUnit = displayRows || [];
    const dDipajang = dUnit.filter((r) => !r.turun);
    const dLewat = dDipajang.filter((r) => r.batas_hari != null && umurSaatAudit(r.tanggal_pajang) > r.batas_hari);
    const dBatas = dUnit.length && dUnit[0].batas_hari != null ? dUnit[0].batas_hari : 60;

    const displayInfo = skorD == null
      ? { color: "#999", lbl: "Belum dinilai" }
      : Number(skorD.skor_display) >= 90 ? { color: "#1a9e6e", lbl: "Terkendali" }
      : Number(skorD.skor_display) >= 75 ? { color: "#d98324", lbl: "Perhatian" }
      : { color: "#c0392b", lbl: "Tindak Lanjut" };

    const displayBarisHtml = dUnit.map((r) => {
      const umur = umurSaatAudit(r.tanggal_pajang);
      const batas = r.batas_hari;
      const lewat = batas != null && umur > batas && !r.turun;
      const ket = r.turun
        ? `${esc(labelPerlakuan(r.perlakuan_kode))}${r.harga_jual_display ? " \u2014 Rp " + Number(r.harga_jual_display).toLocaleString("id-ID") : ""}`
        : (r.program_brand ? "Program: " + esc(r.program_nama) : (esc(r.kondisi_catatan) || "-"));
      return `<tr${r.turun ? ' style="background:#faf9fc;color:#8a83a0;"' : ""}>
        <td style="font-weight:600;">${esc(r.brand)} ${esc(r.model)}</td>
        <td>${esc(r.serial_number) || "-"}</td>
        <td>${esc(r.tanggal_pajang) || "-"}</td>
        <td class="${lewat ? "status-bad" : "status-ok"}">${umur} hr${batas != null ? " / " + batas : ""}${lewat ? " \u00b7 lewat " + (umur - batas) : ""}</td>
        <td>${r.turun ? "\u2014" : esc(labelKondisi(r.kondisi_kode))}</td>
        <td>${ket || "-"}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="6" style="text-align:center;color:#999;padding:10px;">Belum ada unit display tercatat</td></tr>`;

    // Lampiran foto — semua foto ikut dicetak. Video dilewati: tidak bisa dicetak.
    const displayFotoHtml = dUnit.map((r) => {
      const fotos = (r.photos || []).filter((p) => p.type !== "video");
      if (!fotos.length) return "";
      return `<div class="foto-unit">
        <div class="foto-unit-judul">${esc(r.brand)} ${esc(r.model)}${r.serial_number ? " \u00b7 SN " + esc(r.serial_number) : ""}</div>
        <div class="foto-unit-grid">${fotos.map((p) => `<img src="${esc(p.url)}" class="foto-unit-img" />`).join("")}</div>
      </div>`;
    }).join("");

    const ICON = {
      store: `<svg viewBox="0 0 24 24" fill="none" stroke="#2A1F52" stroke-width="2.4"><path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v10a1 1 0 001 1h14a1 1 0 001-1V9"/></svg>`,
      calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="#2A1F52" stroke-width="2.4"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>`,
      person: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>`,
      people: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/></svg>`,
      clipboard: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4"><rect x="6" y="4" width="12" height="17" rx="1.5"/><path d="M9 11h6M9 15h6"/></svg>`,
      laptop: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4"><rect x="4" y="4" width="16" height="11" rx="1.5"/><path d="M2 19h20"/></svg>`,
      box: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/></svg>`,
      checklist: `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>`,
    };

    // ── Persimpangan format ──────────────────────────────────────────
    // Mulai periode September 2026 dokumennya MENGALIR tiga poin dengan
    // tanda tangan di halaman terakhir. Periode sebelumnya tetap memakai
    // template lama di bawah ini, tidak disentuh sama sekali.
    if (pakaiFormatBaru(viewPeriod)) {
      const barisStok = (judul, rows) => rows.map((r, i) => {
        const bad = r.status === "Selisih";
        return `<tr><td>${i === 0 ? `<b>${esc(judul.toUpperCase())}</b>` : ""}</td>`
          + `<td>${esc(r.nama).toUpperCase() || "\u2014"}</td>`
          + `<td class="${bad ? "k-bad" : "k-ok"}">${bad ? "SELISIH" : "LENGKAP"}</td>`
          + `<td>${esc(r.keterangan) || "-"}</td></tr>`;
      }).join("");
      const stokBarisHtml = (barisStok("Kategori 1", stockKat1) + barisStok("Kategori 2", stockKat2))
        || `<tr><td colspan="4" style="text-align:center;color:#999;padding:9px">Tidak ada baris diisi</td></tr>`;

      const htmlBaru = cetakBaruHtml({
        cabang: selectedBranch.name,
        periodeTeks: namaPeriode(viewPeriod),
        tanggalCetakTeks: printDate,
        waktuAudit,
        auditor: profile?.full_name || "",
        teamLeader: storeLeaderName,
        storeManager: storeManagerName,
        inventaris,
        stokBarisHtml,
        stokTotal: stockTotalCount,
        stokSelisih: stockSelisihCount,
        stokPct,
        kat1Pct,
        kat2Pct,
        displayBarisHtml,
        displayFotoHtml,
        displayDipajang: dDipajang.length,
        displayLewat: dLewat.length,
        displayBatas: dBatas,
        skorD,
        displayInfo,
      });
      const winBaru = window.open("", "_blank");
      if (!winBaru) { setError("Popup diblokir browser. Izinkan popup untuk mencetak PDF."); return; }
      winBaru.document.write(htmlBaru);
      winBaru.document.close();
      return;
    }

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Berita Acara ${esc(selectedBranch.name)}</title>
    <style>
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      @page { size: A4; margin: 4mm; }
      body { font-family: Arial, Helvetica, sans-serif; color: #232323; font-size: 10.5px; margin: 0; }
      .page { border: 3px solid #2A1F52; border-radius: 10px; padding: 8mm 9mm; }

      .hdr { display: flex; justify-content: space-between; align-items: center; padding-bottom: 8px; border-bottom: 3px solid #2A1F52; margin-bottom: 9px; }
      .hdr-logo { display: flex; align-items: center; gap: 9px; }
      .hdr-logo-text .name { font-weight: 900; font-size: 13.5px; color: #2A1F52; letter-spacing: 0.01em; line-height: 1.1; }
      .hdr-logo-text .tag { font-size: 7px; color: #b8860b; font-weight: 700; letter-spacing: 0.03em; }
      .hdr-title { flex: 1; text-align: center; }
      .hdr-title h1 { font-family: 'Arial Black', Arial, sans-serif; font-weight: 900; font-size: 19px; color: #2A1F52; margin: 0; }
      .hdr-spacer { width: 100px; }

      .info-bar { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px; }
      .info-card { border: 1px solid #e4dff2; border-radius: 9px; padding: 7px 9px; display: flex; flex-direction: column; gap: 6px; justify-content: center; }
      .info-row { display: flex; gap: 6px; align-items: center; }
      .info-icon { width: 18px; height: 18px; border-radius: 5px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .info-icon svg { width: 10px; height: 10px; }
      .info-icon.gold { background: #F4B740; }
      .info-icon.purple { background: #2A1F52; }
      .info-txt .l { font-size: 6.4px; font-weight: 700; color: #999; text-transform: uppercase; letter-spacing: 0.03em; }
      .info-txt .v { font-size: 8.8px; font-weight: 700; color: #2A1F52; margin-top: 1px; }

      .sect-title { background: #2A1F52; color: #fff; font-weight: 800; font-size: 10px; padding: 6px 13px; border-radius: 7px; margin-bottom: 8px; letter-spacing: 0.03em; border-left: 4px solid #F4B740; }

      .summary-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 9px; }
      .summary-card { border: 1px solid #e4dff2; border-radius: 11px; padding: 9px; display: flex; align-items: center; gap: 9px; }
      .summary-card .icon-circle { width: 34px; height: 34px; border-radius: 50%; background: #2A1F52; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
      .summary-card .icon-circle svg { width: 16px; height: 16px; }
      .summary-card .mid { flex-shrink: 0; }
      .summary-card .t { font-size: 8px; font-weight: 800; color: #2A1F52; margin-bottom: 1px; }
      .summary-card .pct { font-size: 18px; font-weight: 900; line-height: 1.1; }
      .summary-card .badge { display: inline-block; font-size: 6.8px; font-weight: 800; padding: 2px 9px; border-radius: 20px; color: #fff; margin-top: 3px; }
      .legend { border-left: 1px solid #eee; padding-left: 9px; display: flex; flex-direction: column; gap: 3px; flex: 1; }
      .legend-row { display: flex; align-items: center; gap: 5px; font-size: 7.4px; }
      .legend-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
      .legend-label { color: #555; flex: 1; }
      .legend-val { font-weight: 800; color: #232323; }

      .tables-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 8px; }
      .table-block-hdr { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
      .table-block-hdr .lbl { font-weight: 800; font-size: 9.3px; color: #2A1F52; }
      .table-block-hdr .pill { font-size: 8px; font-weight: 800; padding: 2px 9px; border-radius: 20px; color: #fff; }
      table.data { width: 100%; border-collapse: collapse; font-size: 8px; border: 1px solid #e4dff2; }
      table.data th { background: #2A1F52; color: #fff; text-align: left; padding: 3.2px 6px; font-size: 7px; text-transform: uppercase; letter-spacing: 0.02em; }
      table.data td { padding: 2.4px 6px; border-bottom: 1px solid #efecf7; vertical-align: middle; }
      .inv-photos { display: flex; gap: 3px; margin-top: 3px; flex-wrap: wrap; }
      .inv-thumb { width: 30px; height: 30px; object-fit: cover; border-radius: 3px; border: 1px solid #ddd; }
      table.data tr.kat-row td { background: #ece8f7; color: #2A1F52; font-weight: 800; font-size: 7.4px; padding: 2.2px 6px; }
      .status-ok { color: #1a9e6e; font-weight: 800; }
      .status-bad { color: #c0392b; font-weight: 800; }

      .footer-row { display: grid; grid-template-columns: 1fr 1fr 1.5fr; gap: 10px; margin-top: 9px; page-break-inside: avoid; break-inside: avoid; }
      .sign-box { border: 1px solid #e4dff2; border-radius: 9px; padding: 7px; text-align: center; display: flex; flex-direction: column; min-height: 78px; }
      .sign-box .t { font-size: 8px; font-weight: 800; color: #2A1F52; letter-spacing: 0.05em; }
      .sign-box .line { border-top: 1px solid #ccc; padding-top: 3px; margin-top: auto; }
      .sign-box .name { font-weight: 700; font-size: 8.3px; }
      .catatan-box { border: 1px solid #e4dff2; border-radius: 9px; padding: 7px 10px; }
      .catatan-box .hd { display: flex; align-items: center; gap: 5px; margin-bottom: 3px; }
      .catatan-box .t { font-size: 8px; font-weight: 800; color: #2A1F52; }
      .catatan-box p { font-size: 7.3px; color: #555; line-height: 1.3; margin: 0 0 4px; }
      .catatan-box .tgl { font-size: 7.3px; color: #2A1F52; font-weight: 700; }

      .brand-footer { margin-top: 6px; background: #2A1F52; border-radius: 7px; padding: 5px 10px; display: flex; justify-content: space-between; align-items: center; }
      .brand-footer .left .name { color: #fff; font-weight: 800; font-size: 8.3px; }
      .brand-footer .left .tag { color: #cfc7e6; font-size: 6.6px; margin-top: 1px; }
      .brand-footer .right { display: flex; align-items: center; gap: 9px; }
      .brand-footer .right .item { display: flex; align-items: center; gap: 3px; color: #cfc7e6; font-size: 6.6px; }
      .brand-footer .right svg { width: 9px; height: 9px; }

      /* ── Mode kompak: kepake kalau kontennya kepanjangan, biar tetep muat 1 halaman.
         SENGAJA cuma nyentuh padding/margin/gap/ukuran gambar — TIDAK PERNAH font-size,
         biar teks tetep gampang dibaca berapapun banyaknya data. Ke-4 level ini nempel
         bertahap (compact-1 dulu, lanjut compact-2 dst kalau masih kepanjangan). ── */
      #pdfZoom.compact-1 .page { padding: 6mm 7mm; }
      #pdfZoom.compact-1 .hdr { padding-bottom: 6px; margin-bottom: 7px; }
      #pdfZoom.compact-1 .info-bar { gap: 6px; margin-bottom: 7px; }
      #pdfZoom.compact-1 .info-card { padding: 5px 7px; gap: 4px; }
      #pdfZoom.compact-1 .sect-title { padding: 4px 11px; margin-bottom: 6px; }
      #pdfZoom.compact-1 .summary-row { gap: 7px; margin-bottom: 6px; }
      #pdfZoom.compact-1 .summary-card { padding: 6px; gap: 6px; }
      #pdfZoom.compact-1 .tables-row { gap: 7px; margin-bottom: 6px; }
      #pdfZoom.compact-1 table.data th { padding: 2.4px 5px; }
      #pdfZoom.compact-1 table.data td { padding: 1.6px 5px; }
      #pdfZoom.compact-1 table.data td, #pdfZoom.compact-1 table.data th { line-height: 1.15; }
      #pdfZoom.compact-1 .inv-thumb { width: 24px; height: 24px; }
      #pdfZoom.compact-1 .footer-row { gap: 7px; margin-top: 6px; }
      #pdfZoom.compact-1 .sign-box, #pdfZoom.compact-1 .catatan-box { padding: 5px 7px; }
      #pdfZoom.compact-1 .sign-box { min-height: 62px; }
      #pdfZoom.compact-1 .brand-footer { margin-top: 6px; padding: 5px 10px; }

      #pdfZoom.compact-2 .page { padding: 5mm 6mm; }
      #pdfZoom.compact-2 .hdr { padding-bottom: 5px; margin-bottom: 5px; }
      #pdfZoom.compact-2 .info-bar { gap: 5px; margin-bottom: 5px; }
      #pdfZoom.compact-2 .info-card { padding: 4px 6px; gap: 3px; }
      #pdfZoom.compact-2 .sect-title { padding: 3px 9px; margin-bottom: 5px; }
      #pdfZoom.compact-2 .summary-row { gap: 5px; margin-bottom: 5px; }
      #pdfZoom.compact-2 .summary-card { padding: 5px; gap: 5px; }
      #pdfZoom.compact-2 .tables-row { gap: 5px; margin-bottom: 5px; }
      #pdfZoom.compact-2 table.data th { padding: 2px 4px; }
      #pdfZoom.compact-2 table.data td { padding: 1.2px 4px; }
      #pdfZoom.compact-2 table.data td, #pdfZoom.compact-2 table.data th { line-height: 1.05; }
      #pdfZoom.compact-2 .inv-thumb { width: 20px; height: 20px; }
      #pdfZoom.compact-2 .footer-row { gap: 5px; margin-top: 5px; }
      #pdfZoom.compact-2 .sign-box, #pdfZoom.compact-2 .catatan-box { padding: 4px 6px; }
      #pdfZoom.compact-2 .sign-box { min-height: 50px; }
      #pdfZoom.compact-2 .brand-footer { margin-top: 5px; padding: 4px 8px; }

      #pdfZoom.compact-3 .info-row { gap: 4px; }
      #pdfZoom.compact-3 .legend { padding-left: 6px; }
      #pdfZoom.compact-3 .legend-row { gap: 3px; }
      #pdfZoom.compact-3 table.data th { padding: 1.6px 3px; }
      #pdfZoom.compact-3 table.data td { padding: 1px 3px; }
      #pdfZoom.compact-3 table.data td, #pdfZoom.compact-3 table.data th { line-height: 1; }
      #pdfZoom.compact-3 table.data tr.kat-row td { padding: 1.4px 3px; }
      #pdfZoom.compact-3 .inv-photos { gap: 2px; margin-top: 2px; }
      #pdfZoom.compact-3 .inv-thumb { width: 16px; height: 16px; }
      #pdfZoom.compact-3 .catatan-box p { margin: 0 0 2px; }
      #pdfZoom.compact-3 .sign-box { min-height: 40px; } /* batas minimal, tetep kepake buat ttd */

      #pdfZoom.compact-4 .page { padding: 3mm 4mm; }
      #pdfZoom.compact-4 table.data tr.kat-row td { padding: 0.8px 3px; }
      #pdfZoom.compact-4 table.data td, #pdfZoom.compact-4 table.data th { line-height: 0.95; padding-top: 0.6px; padding-bottom: 0.6px; }
      #pdfZoom.compact-4 .inv-thumb { width: 13px; height: 13px; }
      #pdfZoom.compact-4 .footer-row { gap: 4px; margin-top: 4px; }

      /* ── Pilihan TERAKHIR, cuma kepake kalau compact-1..4 masih belum cukup juga.
         Font tabel diturunin PELAN-PELAN (0.5px per level), bukan langsung jauh —
         biar masih kebaca, bukan dipaksa kekecilan sekali turun. ── */
      #pdfZoom.compact-5 table.data { font-size: 7.5px; }
      #pdfZoom.compact-5 table.data th { font-size: 6.5px; }
      #pdfZoom.compact-6 table.data { font-size: 7px; }
      #pdfZoom.compact-6 table.data th { font-size: 6px; }
      #pdfZoom.compact-7 table.data { font-size: 6.5px; }
      #pdfZoom.compact-7 table.data th { font-size: 5.5px; }
      /* ── Lampiran Monitoring Display (halaman terpisah) ── */
      .lampiran { page-break-before: always; border: 3px solid #2A1F52; border-radius: 10px; padding: 8mm 9mm; margin-top: 6mm; }
      .lampiran .lamp-hdr { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #F4B740; padding-bottom: 7px; margin-bottom: 10px; }
      .lampiran .lamp-judul { font-size: 13px; font-weight: 900; color: #2A1F52; letter-spacing: .02em; }
      .lampiran .lamp-sub { font-size: 8px; color: #8a83a0; }
      .lampiran table.data { width: 100%; }
      .foto-unit { margin-top: 10px; page-break-inside: avoid; }
      .foto-unit-judul { font-size: 8.5px; font-weight: 800; color: #2A1F52; margin-bottom: 4px; }
      .foto-unit-grid { display: flex; flex-wrap: wrap; gap: 5px; }
      .foto-unit-img { width: 92px; height: 92px; object-fit: cover; border-radius: 5px; border: 1px solid #e4dff2; }
    </style></head><body><div id="pdfZoom">
      <div class="page">

        <div class="hdr">
          <div class="hdr-logo">
            <svg width="28" height="28" viewBox="0 0 40 40"><polygon points="20,2 36,11 36,29 20,38 4,29 4,11" fill="#2A1F52"/><text x="20" y="26" text-anchor="middle" font-family="Arial" font-weight="900" font-size="16" fill="#F4B740">K</text></svg>
            <div class="hdr-logo-text"><div class="name">KLA COMPUTER</div><div class="tag">DIVISI AUDIT KLA COMPUTER</div></div>
          </div>
          <div class="hdr-title"><h1>BERITA ACARA AUDIT STORE</h1></div>
          <div class="hdr-spacer"></div>
        </div>

        <div class="info-bar">
          <div class="info-card">
            <div class="info-row"><span class="info-icon gold">${ICON.store}</span><div class="info-txt"><div class="l">Store / Cabang</div><div class="v">${esc(selectedBranch.name)}</div></div></div>
            <div class="info-row"><span class="info-icon gold">${ICON.calendar}</span><div class="info-txt"><div class="l">Tanggal Audit</div><div class="v">${esc(waktuAudit) || "\u2014"}</div></div></div>
          </div>
          <div class="info-card">
            <div class="info-row"><span class="info-icon purple">${ICON.person}</span><div class="info-txt"><div class="l">Auditor</div><div class="v">${esc(profile?.full_name || "\u2014")}</div></div></div>
            <div class="info-row"><span class="info-icon purple">${ICON.people}</span><div class="info-txt"><div class="l">Team Leader</div><div class="v">${esc(storeLeaderName) || "\u2014"}</div></div></div>
          </div>
          <div class="info-card" style="justify-content:center;">
            <div class="info-row"><span class="info-icon purple">${ICON.clipboard}</span><div class="info-txt"><div class="l">Ruang Lingkup</div><div class="v">${esc(kegiatan)}</div></div></div>
          </div>
          <div class="info-card" style="justify-content:center;">
            <div class="info-row"><span class="info-icon purple">${ICON.laptop}</span><div class="info-txt"><div class="l">Perlengkapan</div><div class="v">${esc(perlengkapan)}</div></div></div>
          </div>
        </div>

        <div class="sect-title">RINGKASAN HASIL AUDIT</div>
        <div class="summary-row">
          <div class="summary-card">
            <div class="icon-circle">${ICON.box}</div>
            <div class="mid">
              <div class="t">1. STOCK OPNAME</div>
              <div class="pct" style="color:${stockInfo.color};">${stockPct}%</div>
              <div class="badge" style="background:${stockInfo.color};">${stockInfo.lbl.toUpperCase()}</div>
            </div>
            <div class="legend">
              <div class="legend-row"><span class="legend-dot" style="background:${kat1Color};"></span><span class="legend-label">Kategori 1</span><span class="legend-val">${kat1Pct === null ? "-" : kat1Pct + "%"}</span></div>
              <div class="legend-row"><span class="legend-dot" style="background:${kat2Color};"></span><span class="legend-label">Kategori 2</span><span class="legend-val">${kat2Pct === null ? "-" : kat2Pct + "%"}</span></div>
            </div>
          </div>
          <div class="summary-card">
            <div class="icon-circle">${ICON.checklist}</div>
            <div class="mid">
              <div class="t">2. INVENTARIS</div>
              <div class="pct" style="color:${invInfo.color};">${invPct}%</div>
              <div class="badge" style="background:${invInfo.color};">${invInfo.lbl.toUpperCase()}</div>
            </div>
            <div class="legend">
              <div class="legend-row"><span class="legend-dot" style="background:#1a9e6e;"></span><span class="legend-label">Lengkap</span><span class="legend-val">${invPct}%</span></div>
              <div class="legend-row"><span class="legend-dot" style="background:#c0392b;"></span><span class="legend-label">Tidak Lengkap</span><span class="legend-val">${invTidakPct}%</span></div>
            </div>
          </div>
          ${skorD ? `
          <div class="summary-card" style="grid-column:1 / -1;">
            <div class="icon-circle">${ICON.laptop}</div>
            <div class="mid">
              <div class="t">3. MONITORING DISPLAY</div>
              <div class="pct" style="color:${displayInfo.color};">${skorD.skor_display}%</div>
              <div class="badge" style="background:${displayInfo.color};">${displayInfo.lbl.toUpperCase()}</div>
            </div>
            <div class="legend">
              <div class="legend-row"><span class="legend-dot" style="background:#2A1F52;"></span><span class="legend-label">Dalam batas umur</span><span class="legend-val">${skorD.unit_dalam_batas}/${skorD.unit_dinilai} unit &middot; ${skorD.skor_umur}%</span></div>
              <div class="legend-row"><span class="legend-dot" style="background:#7c3aed;"></span><span class="legend-label">Kondisi fisik</span><span class="legend-val">${skorD.skor_kondisi}%</span></div>
              <div class="legend-row"><span class="legend-dot" style="background:${dLewat.length ? "#c0392b" : "#1a9e6e"};"></span><span class="legend-label">Lewat batas</span><span class="legend-val">${dLewat.length} unit</span></div>
            </div>
          </div>` : ""}
        </div>

        <div class="tables-row">
          <div>
            <div class="table-block-hdr"><span class="lbl">1. AUDIT STOCK OPNAME</span><span class="pill" style="background:${stockInfo.color};">${stockPct}%</span></div>
            <table class="data">
              <thead><tr><th>Kategori / Item</th><th>Kelengkapan</th><th>Keterangan</th></tr></thead>
              <tbody>
                ${stockTable("Kategori 1", stockKat1)}
                ${stockTable("Kategori 2", stockKat2)}
              </tbody>
            </table>
          </div>
          <div>
            <div class="table-block-hdr"><span class="lbl">2. AUDIT INVENTARIS</span><span class="pill" style="background:${invInfo.color};">${invPct}%</span></div>
            <table class="data">
              <thead><tr><th>Nama Inventaris</th><th>Keadaan</th><th>Keterangan</th></tr></thead>
              <tbody>${invRows}</tbody>
            </table>
          </div>
        </div>

        <div class="footer-row">
          <div class="sign-box">
            <div class="t">MENGETAHUI</div>
            <div class="line"><div class="name">${esc(storeManagerName || storeLeaderName || "\u2014")}</div></div>
          </div>
          <div class="sign-box">
            <div class="t">PELAKSANA</div>
            <div class="line"><div class="name">${esc(profile?.full_name || "\u2014")}</div></div>
          </div>
          <div class="catatan-box">
            <div class="hd">${ICON.clipboard.replace(/#fff/g, "#2A1F52").replace('viewBox="0 0 24 24"', 'viewBox="0 0 24 24" width="13" height="13"')}<span class="t">CATATAN</span></div>
            <p>Berita acara ini dibuat berdasarkan hasil audit yang dilakukan pada ${esc(waktuAudit) || "periode terkait"} di Store ${esc(selectedBranch.name)}. Demikian berita acara ini dibuat dengan sebenar-benarnya untuk dipergunakan sebagaimana mestinya.</p>
            <div class="tgl">Tanggal: ${printDate}</div>
          </div>
        </div>

        <div class="brand-footer">
          <div class="left">
            <div class="name">KLA COMPUTER</div>
            <div class="tag">Solusi Lengkap Kebutuhan Digital Anda</div>
          </div>
          <div class="right">
            <span class="item">klacomputer.co.id</span>
            <span class="item">audit@klacomputer.id</span>
          </div>
        </div>

      </div>
      </div>
      ${skorD ? `
      <div class="lampiran">
        <div class="lamp-hdr">
          <div>
            <div class="lamp-judul">LAMPIRAN &mdash; MONITORING DISPLAY</div>
            <div class="lamp-sub">${esc(selectedBranch.name)} &middot; ${esc(periodeLabel(viewPeriod))} &middot; batas pajang ${dBatas} hari</div>
          </div>
          <div style="text-align:right;">
            <div class="lamp-judul" style="color:${displayInfo.color};">${skorD.skor_display}%</div>
            <div class="lamp-sub">${dDipajang.length} unit dipajang &middot; ${dLewat.length} lewat batas</div>
          </div>
        </div>
        <table class="data">
          <thead><tr>
            <th style="width:24%;">Brand / Model</th><th style="width:13%;">Serial</th>
            <th style="width:12%;">Mulai Pajang</th><th style="width:14%;">Umur saat audit</th>
            <th style="width:15%;">Kondisi</th><th>Program / Perlakuan</th>
          </tr></thead>
          <tbody>${displayBarisHtml}</tbody>
        </table>
        ${displayFotoHtml ? `<div style="margin-top:12px;"><div class="lamp-judul" style="font-size:10px;">FOTO KONDISI UNIT</div>${displayFotoHtml}</div>` : ""}
      </div>` : ""}
      <script>
        function fitToPage() {
          const zoomEl = document.getElementById("pdfZoom");
          // Lampiran Display SENGAJA ditaruh di luar #pdfZoom. Kalau di dalam,
          // pemampatan ini akan menyusutkan halaman 1 supaya muat berdua —
          // padahal halaman 1 harus tetap seperti sekarang.
          const targetHeight = 960; // ruang aman cetak A4 — diketatin dikit lagi (sempet ada kasus footer brand kepental sendirian ke halaman 2)
          // Bukan zoom lagi (itu ngecilin font juga) — nempelin class compact-1..4 bertahap,
          // yang cuma nyusutin padding/margin/gap/ukuran foto. Font-size nggak disentuh sama sekali.
          const steps = ["compact-1", "compact-2", "compact-3", "compact-4", "compact-5", "compact-6", "compact-7"];
          let i = 0;
          while (zoomEl.scrollHeight > targetHeight && i < steps.length) {
            zoomEl.classList.add(steps[i]);
            i++;
          }
          // Kalau abis compact-4 masih kepanjangan juga, biarin lanjut ke halaman 2 —
          // daripada maksa muat 1 halaman dengan cara ngecilin font.
          setTimeout(() => window.print(), 250);
        }
        function waitForImages() {
          const imgs = Array.from(document.querySelectorAll("img"));
          if (!imgs.length) return Promise.resolve();
          return Promise.all(imgs.map((img) => img.complete ? Promise.resolve() : new Promise((res) => {
            img.addEventListener("load", res);
            img.addEventListener("error", res); // foto gagal load tetap lanjut, jangan sampai macet
          })));
        }
        window.onload = () => {
          const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
          Promise.all([fontsReady, waitForImages()]).then(fitToPage);
        };
      <\/script>
    </body></html>`;

    const win = window.open("", "_blank");
    if (!win) { setError("Popup diblokir browser. Izinkan popup untuk mencetak PDF."); return; }
    win.document.write(html);
    win.document.close();
  }

  // ── Tampilan: pilih cabang ──
  if (!selectedBranch) {
    return (
      <div style={{ flex: 1 }}>
        <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Berita Acara</div>
            <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>Dokumen resmi audit store per cabang, per bulan &mdash; Stock Opname &amp; Inventaris</div>
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
                const row = latestByBranchPeriod[`${b.id}|${viewPeriod}`];
                const entry = row?.entry;
                const kat1 = entry?.stock_opname_kat1 || [];
                const kat2 = entry?.stock_opname_kat2 || [];
                const totalItem = kat1.length + kat2.length;
                const selisihCount = [...kat1, ...kat2].filter((r) => r.status === "Selisih").length;
                return (
                  <div key={b.id} onClick={() => pickBranch(b)} style={{ position: "relative", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", cursor: "pointer", overflow: "hidden" }}>
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: !entry ? "linear-gradient(90deg, #7c3aed, #F4B740)" : entry.tidak_visit ? "#888" : (selisihCount > 0 ? "#a32020" : "#1a9e6e") }} />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: entry ? 8 : 4 }}>
                      <div style={{ fontWeight: 600, fontSize: 14.5 }}>{b.name}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {entry?.cabang_baru && (
                          <span style={{ fontSize: 9.5, fontWeight: 700, color: "#F4B740", background: "#F4B74022", padding: "2px 7px", borderRadius: 20, flexShrink: 0 }}>Cabang Baru</span>
                        )}
                        {row && row.count > 1 && (
                          <span style={{ fontSize: 9.5, fontWeight: 700, color: "#7c3aed", background: "#7c3aed18", padding: "2px 7px", borderRadius: 20, flexShrink: 0 }}>{row.count} audit</span>
                        )}
                      </div>
                    </div>
                    {entry ? (
                      entry.tidak_visit ? (
                        <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, background: "#88888822", color: "#888", fontSize: 11, fontWeight: 600 }}>Tidak Visit</span>
                      ) : (
                        <>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                            <span style={{ fontSize: 22, fontWeight: 800, color: selisihCount > 0 ? "#a32020" : "#1a9e6e" }}>{selisihCount}</span>
                            <span style={{ fontSize: 11, color: "var(--text-faint)" }}>selisih dari {totalItem} item</span>
                          </div>
                          <span style={{ display: "inline-block", marginTop: 6, padding: "2px 9px", borderRadius: 20, background: selisihCount > 0 ? "#a3202022" : "#1a9e6e22", color: selisihCount > 0 ? "#a32020" : "#1a9e6e", fontSize: 10.5, fontWeight: 600 }}>
                            {selisihCount > 0 ? "Ada temuan" : "Semua lengkap"}
                          </span>
                          <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 6 }}>Terakhir: {shortDate(entry.audit_date)}</div>
                        </>
                      )
                    ) : (
                      <div style={{ fontSize: 11.5, fontWeight: 400, color: "var(--text-faint)" }}>Belum ada &middot; Mulai &rarr;</div>
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
  return (
    <div style={{ flex: 1 }}>
      <div style={{ background: "var(--surface)", padding: "16px 28px", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <button className="btn-ghost" style={{ marginBottom: 8, fontSize: 12.5 }} onClick={backToList}>&larr; Pilih cabang lain</button>
            <div className="display" style={{ fontSize: 19, fontWeight: 600 }}>Berita Acara &mdash; {selectedBranch.name}</div>
            <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
              Periode: {periodeLabel(viewPeriod)}
              {selectedEntryId ? <span> &middot; mengedit audit tanggal {shortDate(auditDate)}</span> : <span> &middot; audit baru</span>}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <div>
              <label style={{ display: "block", fontSize: 11, color: "var(--text-secondary)", marginBottom: 3 }}>Tanggal audit</label>
              <input className="input" type="date" value={auditDate} disabled={!canEdit} onChange={(e) => { setAuditDate(e.target.value); setSaved(false); }} />
            </div>
            <button className="btn-ghost" onClick={exportPDF}>Cetak PDF</button>
            {canEdit && (
              <button className="btn" disabled={saving} onClick={saveRecord}>
                {saving ? "Menyimpan\u2026" : saved ? "\u2713 Tersimpan" : "Simpan"}
              </button>
            )}
            {(profile?.role === "super_admin" || (profile?.role === "auditor" && entriesThisPeriod.find((e) => e.id === selectedEntryId)?.submitted_by === profile?.id)) && selectedEntryId && (
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
            {entriesThisPeriod.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
                  Riwayat audit {periodeLabel(viewPeriod)} ({entriesThisPeriod.length})
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {[...entriesThisPeriod].sort((a, b) => (a.audit_date || "").localeCompare(b.audit_date || "")).map((e, i) => {
                    const kat1 = e.stock_opname_kat1 || [];
                    const kat2 = e.stock_opname_kat2 || [];
                    const selisih = [...kat1, ...kat2].filter((r) => r.status === "Selisih").length;
                    const active = e.id === selectedEntryId;
                    return (
                      <div
                        key={e.id}
                        onClick={async () => {
                          let ivQuery = supabase.from("audit_generic").select("*").eq("module", "inventaris").eq("branch_id", selectedBranch.id).eq("period", viewPeriod);
                          if (profile?.role === "auditor" && viewPeriod >= ISOLATION_START_PERIOD) ivQuery = ivQuery.eq("submitted_by", profile.id);
                          const { data: iv } = await ivQuery;
                          const pairedInv = (iv || []).find((r) => r.data?.audit_date === e.audit_date) || null;
                          applyEntryToForm(e, pairedInv);
                        }}
                        style={{
                          cursor: "pointer", padding: "8px 14px", borderRadius: 10,
                          border: `1.5px solid ${active ? "#7c3aed" : "var(--border)"}`,
                          background: active ? "#7c3aed14" : "var(--surface)",
                          display: "flex", alignItems: "center", gap: 8,
                        }}
                      >
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)" }}>Audit {i + 1}</span>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{shortDate(e.audit_date)}</span>
                        {e.cabang_baru && <span style={{ fontSize: 10, fontWeight: 700, color: "#F4B740" }}>⭐ Baru</span>}
                        {e.tidak_visit ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#888" }}>Tidak Visit</span>
                        ) : (
                          <>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: selisih > 0 ? "#a32020" : "#1a9e6e" }} />
                            <span style={{ fontSize: 12, fontWeight: 700, color: selisih > 0 ? "#a32020" : "#1a9e6e" }}>{selisih} selisih</span>
                          </>
                        )}
                      </div>
                    );
                  })}
                  {canEdit && (
                    <div
                      onClick={() => startNewEntry(viewPeriod)}
                      style={{
                        cursor: "pointer", padding: "8px 14px", borderRadius: 10,
                        border: `1.5px dashed ${!selectedEntryId ? "#7c3aed" : "var(--border)"}`,
                        color: "#7c3aed", background: !selectedEntryId ? "#7c3aed14" : "transparent",
                        display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700,
                      }}
                    >
                      + Audit Baru
                    </div>
                  )}
                </div>
              </div>
            )}

            {showCopyBanner && prevMonthData && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, background: "#7c3aed14", border: "1px solid rgba(124,58,237,0.35)", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: "#7c3aed" }}>
                  <b>Salin struktur dari {prevMonthData.periodLabel}?</b>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                    {prevMonthData.stockKat1.length + prevMonthData.stockKat2.length} item Stock Opname akan disalin, semua status di-reset ke "Lengkap" & "Berfungsi" — tinggal ubah yang beda aja.
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button className="btn-ghost" onClick={() => setShowCopyBanner(false)}>Nggak usah</button>
                  <button className="btn" onClick={copyFromPrevMonth}>Ya, Salin</button>
                </div>
              </div>
            )}

            {/* Progress steps */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
              <StepPill icon="📋" label="Informasi" done />
              <StepLine />
              <StepPill icon="📦" label="Stock Opname" done={stockKat1.length + stockKat2.length > 0} />
              <StepLine />
              <StepPill icon="🗂️" label="Inventaris" done={countRusak(inventaris) >= 0 && Object.keys(inventaris).length > 0} />
              <StepLine />
              <StepPill icon="✍️" label="Tanda Tangan" done={!!storeManagerName} />
            </div>

            {/* Header info */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>📋 Informasi Audit</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 12 }}>
                <Field label="Waktu Audit">
                  <input className="input" placeholder="mis. 13 - 14 Juli 2026" value={waktuAudit} disabled={!canEdit} onChange={(e) => { setWaktuAudit(e.target.value); setSaved(false); }} />
                </Field>
                <Field label="Staff Audit">
                  <input className="input" value={profile?.full_name || ""} disabled />
                </Field>
                <Field label="Store Leader">
                  <input className="input" placeholder="Nama Store Leader" value={storeLeaderName} disabled={!canEdit} onChange={(e) => { setStoreLeaderName(e.target.value); setSaved(false); }} />
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

            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 16 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: canEdit ? "pointer" : "default", fontSize: 13, color: "var(--text-secondary)" }}>
                <input type="checkbox" checked={tidakVisit} disabled={!canEdit} onChange={(e) => { setTidakVisit(e.target.checked); setSaved(false); }} />
                Cabang ini tidak dikunjungi bulan ini (Tidak Visit)
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: canEdit ? "pointer" : "default", fontSize: 13, color: "var(--text-secondary)" }}>
                <input type="checkbox" checked={cabangBaru} disabled={!canEdit} onChange={(e) => { setCabangBaru(e.target.checked); setSaved(false); }} />
                Cabang Baru <span style={{ color: "var(--text-faint)" }}>(tetap dihitung normal, cuma ditandai di laporan)</span>
              </label>
            </div>

            {!tidakVisit && (
              <>
            {/* Ringkasan live — Stock Opname */}
            {(() => {
              const allRows = [...stockKat1, ...stockKat2];
              const selisihCount = allRows.filter((r) => r.status === "Selisih").length;
              return (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 16px", marginBottom: 16 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
                    {allRows.length} item dicek &middot; {selisihCount === 0 ? "semua lengkap" : `${selisihCount} selisih ditemukan`}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 20, fontWeight: 800, color: selisihCount > 0 ? "#a32020" : "#1a9e6e" }}>{selisihCount}</span>
                    {selisihCount > 0 && (
                      <div style={{ display: "flex", gap: 4, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 3 }}>
                        <button onClick={() => setStockFilter("all")} style={{ border: "none", background: stockFilter === "all" ? "#7c3aed" : "transparent", color: stockFilter === "all" ? "#fff" : "var(--text-secondary)", fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 6, cursor: "pointer" }}>Semua ({allRows.length})</button>
                        <button onClick={() => setStockFilter("selisih")} style={{ border: "none", background: stockFilter === "selisih" ? "#a32020" : "transparent", color: stockFilter === "selisih" ? "#fff" : "var(--text-secondary)", fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 6, cursor: "pointer" }}>Selisih ({selisihCount})</button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Section: Stock Opname */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>📦 Audit Stock Opname</div>

              <StockSubSection title="Kategori 1" rows={stockKat1} canEdit={canEdit} filter={stockFilter}
                onAdd={() => addRow(setStockKat1)}
                onUpdate={(i, f, v) => updateRow(setStockKat1, i, f, v)}
                onRemove={(i) => removeRow(setStockKat1, i)} />

              <div style={{ marginTop: 18 }}>
                <StockSubSection title="Kategori 2" rows={stockKat2} canEdit={canEdit} filter={stockFilter}
                  onAdd={() => addRow(setStockKat2)}
                  onUpdate={(i, f, v) => updateRow(setStockKat2, i, f, v)}
                  onRemove={(i) => removeRow(setStockKat2, i)} />
              </div>
            </div>

            {/* Section: Monitoring Display — hanya untuk periode >= September 2026.
                Ketetapan pemilik: format ini mulai berlaku periode itu. Untuk
                periode lama section-nya TIDAK dirender sama sekali, bukan
                sekadar dikunci — angka yang tidak berlaku tetapi terbaca di
                layar adalah cara paling halus melahirkan salah paham. */}
            {!pakaiFormatBaru(viewPeriod) ? (
              <div style={{ background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 15px", marginBottom: 16, fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                🔒 <b>Monitoring Display berlaku mulai {namaPeriode("2026-09")}.</b>{" "}
                Periode {namaPeriode(viewPeriod)} memakai format lama — Berita Acara yang
                sudah ditandatangani tidak berubah bentuk hanya karena aplikasinya diperbarui.
              </div>
            ) : displayError ? (
              <div style={{ background: "var(--danger-bg)", border: "1px solid rgba(239,68,68,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 10, fontSize: 12.5, marginBottom: 16 }}>
                {displayError}
              </div>
            ) : (
              <DisplaySection
                rows={displayRows}
                perlakuanOpsi={perlakuanOpsi}
                kondisiOpsi={kondisiOpsi}
                canEdit={canEdit}
                uploadingIdx={displayUploadIdx}
                onUpdate={updateDisplay}
                onAdd={addDisplay}
                onRemove={removeDisplay}
                onUploadFoto={handleUploadDisplayMedia}
                onHapusFoto={removeDisplayMedia}
                onImpor={imporDisplay}
                cabang={selectedBranch.name}
                tanggalAudit={auditDate}
              />
            )}

            {/* Section: Inventaris */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>🗂️ Audit Inventaris</div>
                {countRusak(inventaris) > 0 && (
                  <div style={{ display: "flex", gap: 4, background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 8, padding: 3 }}>
                    <button onClick={() => setInvFilter("all")} style={{ border: "none", background: invFilter === "all" ? "#7c3aed" : "transparent", color: invFilter === "all" ? "#fff" : "var(--text-secondary)", fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 6, cursor: "pointer" }}>Semua ({INVENTARIS_CATEGORIES.length})</button>
                    <button onClick={() => setInvFilter("rusak")} style={{ border: "none", background: invFilter === "rusak" ? "#a32020" : "transparent", color: invFilter === "rusak" ? "#fff" : "var(--text-secondary)", fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 6, cursor: "pointer" }}>Rusak ({countRusak(inventaris)})</button>
                  </div>
                )}
              </div>
              <InventarisChecklist
                period={viewPeriod}
                inventaris={inventaris}
                canEdit={canEdit}
                uploadingKey={uploadingKey}
                filter={invFilter}
                onUpdate={updateInventaris}
                onBulkStatus={setSemuaInventaris}
                onUploadMedia={handleUploadInventarisMedia}
                onRemoveMedia={removeInventarisMedia}
              />
            </div>
            </>
            )}

            {/* Footer */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>✍️ Tanda Tangan</div>
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

function StockSubSection({ title, rows, canEdit, onAdd, onUpdate, onRemove, filter }) {
  const indexed = rows.map((row, i) => ({ row, i }));
  const shown = filter === "selisih" ? indexed.filter(({ row }) => row.status === "Selisih") : indexed;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>{title}</div>
        {canEdit && <button className="btn-ghost" onClick={onAdd} style={{ fontSize: 12 }}>+ Tambah Baris</button>}
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Belum ada baris.</div>
      ) : shown.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Semua item di kategori ini "Lengkap" &mdash; nggak ada yang selisih.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {shown.map(({ row, i }) => {
            const isSelisih = row.status === "Selisih";
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1.6fr auto 1.8fr auto", gap: 8, alignItems: "center", background: "var(--surface-alt)", padding: "10px 10px 10px 12px", borderRadius: 8, borderLeft: `3px solid ${isSelisih ? "#a32020" : "#1a9e6e55"}` }}>
                <input className="input" placeholder="Nama Barang/Brand" value={row.nama} disabled={!canEdit} onChange={(e) => onUpdate(i, "nama", e.target.value)} style={{ fontSize: 12.5 }} />
                <StatusToggle
                  value={row.status}
                  onChange={(v) => onUpdate(i, "status", v)}
                  disabled={!canEdit}
                  okLabel="Lengkap"
                  badLabel="Selisih"
                />
                <input className="input" placeholder="Keterangan" value={row.keterangan} disabled={!canEdit} onChange={(e) => onUpdate(i, "keterangan", e.target.value)} style={{ fontSize: 12.5 }} />
                {canEdit && <span onClick={() => onRemove(i)} style={{ cursor: "pointer", color: "var(--danger-text)", fontSize: 18, textAlign: "center" }}>&times;</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Tombol besar tap-to-toggle, gantiin dropdown — lebih cepat dipakai, terutama di HP/tablet.
function StatusToggle({ value, onChange, disabled, okLabel, badLabel }) {
  const isBad = value === badLabel;
  const btnBase = { border: "none", cursor: disabled ? "default" : "pointer", fontSize: 11.5, fontWeight: 700, padding: "9px 12px", borderRadius: 7, whiteSpace: "nowrap", opacity: disabled ? 0.7 : 1 };
  return (
    <div style={{ display: "flex", gap: 4, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9, padding: 3 }}>
      <button type="button" disabled={disabled} onClick={() => onChange(okLabel)} style={{ ...btnBase, background: !isBad ? "#1a9e6e" : "transparent", color: !isBad ? "#fff" : "var(--text-faint)" }}>
        &#10003; {okLabel}
      </button>
      <button type="button" disabled={disabled} onClick={() => onChange(badLabel)} style={{ ...btnBase, background: isBad ? "#a32020" : "transparent", color: isBad ? "#fff" : "var(--text-faint)" }}>
        &#10005; {badLabel}
      </button>
    </div>
  );
}

function StepPill({ icon, label, done }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 20, background: done ? "#1a9e6e18" : "var(--surface-alt)", border: `1px solid ${done ? "rgba(26,158,110,0.4)" : "var(--border)"}` }}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: done ? "#1a9e6e" : "var(--text-secondary)" }}>{label}</span>
      {done && <span style={{ fontSize: 11, color: "#1a9e6e" }}>&#10003;</span>}
    </div>
  );
}

function StepLine() {
  return <div style={{ width: 20, height: 1, background: "var(--border)" }} />;
}

function Field({ label, children }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}
