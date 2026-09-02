import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabaseClient";
import { sortBranches } from "../../lib/branchOrder";
import {
  CATS, TOTAL_ITEMS, TIER_WEIGHTS, TIER1_CATS, TIER3_CATS, ALERT_THRESHOLD, CONDITION_ITEMS,
  calcWeightedScore, calcWeightedFromRecord, scoreColor, periodFromDate, todayInputValue, periodeLabel,
  nowPeriode, addMonthsToPeriod,
} from "../../lib/sopConfig";
import { deleteMediaFromStorage, deleteMediaListFromStorage, compressImage } from "../AuditInventaris";

function emptyChecklist() {
  const state = {};
  CATS.forEach((c) => c.items.forEach((_, i) => { state[c.id + "_" + i] = true; }));
  return state;
}

// Data lama simpan foto sebagai string tunggal per key; sekarang array {url,type}.
function normalizePhotos(raw) {
  if (!raw) return {};
  const out = {};
  Object.keys(raw).forEach((key) => {
    const val = raw[key];
    if (Array.isArray(val)) out[key] = val;
    else if (typeof val === "string" && val) out[key] = [{ url: val, type: "image" }];
  });
  return out;
}

function shortDate(d) {
  if (!d) return "\u2014";
  return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

export default function SopAuditCabang({ profile }) {
  const canEdit = profile?.role === "auditor" || profile?.role === "super_admin";
  const [branches, setBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [latestByBranchPeriod, setLatestByBranchPeriod] = useState({}); // buat kartu ringkasan & pilih-cabang
  const [viewPeriod, setViewPeriod] = useState(nowPeriode());
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [entriesThisPeriod, setEntriesThisPeriod] = useState([]);
  const [selectedEntryId, setSelectedEntryId] = useState(null);
  const [checklist, setChecklist] = useState(emptyChecklist());
  const [tidakVisit, setTidakVisit] = useState(false);
  const [cabangBaru, setCabangBaru] = useState(false);
  const [storeManagerName, setStoreManagerName] = useState("");
  const [notes, setNotes] = useState({});
  const [photos, setPhotos] = useState({}); // { catId_idx: url }
  const [uploadingKey, setUploadingKey] = useState(null);
  const [openCats, setOpenCats] = useState({});
  const [auditDate, setAuditDate] = useState(todayInputValue());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [loadingRecord, setLoadingRecord] = useState(false);

  useEffect(() => { loadBranches(); }, []);

  async function loadBranches() {
    setLoadingBranches(true);
    const { data, error: err } = await supabase.from("branches").select("*").order("name");
    if (!err) setBranches(sortBranches(data || []));
    // Auditor biasa cuma boleh liat/pake audit yang dia submit sendiri — TAPI cuma berlaku
    // mulai Agustus 2026 ke depan. Data Jan-Jul 2026 tetep kebuka bareng buat semua auditor.
    const ISOLATION_START_PERIOD = "2026-08";
    let recQuery = supabase.from("audit_generic").select("*").eq("module", "sop");
    if (profile?.role === "auditor") {
      recQuery = recQuery.or(`period.lt.${ISOLATION_START_PERIOD},submitted_by.eq.${profile.id}`);
    }
    const { data: recs, error: recErr } = await recQuery;
    if (!recErr) {
      const sorted = [...(recs || [])].sort((a, b) => (b.data?.audit_date || "").localeCompare(a.data?.audit_date || ""));
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

  function applyEntryToForm(entry) {
    setChecklist({ ...emptyChecklist(), ...(entry.data?.checks || {}) });
    setNotes(entry.data?.notes || {});
    setPhotos(normalizePhotos(entry.data?.photos));
    setTidakVisit(!!entry.data?.tidak_visit);
    setCabangBaru(!!entry.data?.cabang_baru);
    setAuditDate(entry.data?.audit_date || todayInputValue());
    setStoreManagerName(entry.data?.store_manager_name || "");
    setSelectedEntryId(entry.id);
  }

  function startNewEntry(period) {
    setChecklist(emptyChecklist());
    setNotes({});
    setPhotos({});
    setTidakVisit(false);
    setCabangBaru(false);
    setAuditDate(period === nowPeriode() ? todayInputValue() : period + "-01");
    setStoreManagerName("");
    setSelectedEntryId(null);
    setSaved(false);
  }

  async function pickBranch(b) {
    setSelectedBranch(b);
    setSaved(false);
    setError(null);
    setLoadingRecord(true);
    const period = viewPeriod;
    const ISOLATION_START_PERIOD = "2026-08";
    let entryQuery = supabase
      .from("audit_generic")
      .select("*")
      .eq("module", "sop")
      .eq("branch_id", b.id)
      .eq("period", period);
    if (profile?.role === "auditor" && period >= ISOLATION_START_PERIOD) entryQuery = entryQuery.eq("submitted_by", profile.id);
    const { data, error: err } = await entryQuery;
    const entries = !err
      ? [...(data || [])].sort((a, b2) => (b2.data?.audit_date || "").localeCompare(a.data?.audit_date || ""))
      : [];
    if (err) setError("Gagal memuat riwayat: " + err.message);
    setEntriesThisPeriod(entries);
    if (entries.length) applyEntryToForm(entries[0]);
    else startNewEntry(period);
    setLoadingRecord(false);
  }

  function backToList() {
    setSelectedBranch(null);
    setEntriesThisPeriod([]);
    setSelectedEntryId(null);
    loadBranches();
  }

  function toggleItem(catId, idx) {
    if (!canEdit) return;
    const id = catId + "_" + idx;
    setChecklist((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      if (next[id]) setNotes((n) => ({ ...n, [id]: "" }));
      return next;
    });
    setSaved(false);
  }

  function checkAllInCategory(cat) {
    if (!canEdit) return;
    setChecklist((prev) => {
      const next = { ...prev };
      cat.items.forEach((_, i) => { next[cat.id + "_" + i] = true; });
      return next;
    });
    setNotes((prev) => {
      const next = { ...prev };
      cat.items.forEach((_, i) => { delete next[cat.id + "_" + i]; });
      return next;
    });
    setSaved(false);
  }

  function setNote(id, val) {
    setNotes((prev) => ({ ...prev, [id]: val }));
    setSaved(false);
  }

  async function uploadPhoto(key, fileList) {
    const files = Array.from(fileList || []);
    if (!files.length || !selectedBranch) return;
    setUploadingKey(key);
    setError(null);
    try {
      const uploaded = [];
      for (const file of files) {
        const isImage = file.type.startsWith("image/");
        const isVideo = file.type.startsWith("video/");
        if (!isImage && !isVideo) { setError("File harus berupa gambar atau video."); continue; }
        let uploadFile = file;
        let ext = file.name.split(".").pop() || (isVideo ? "mp4" : "jpg");
        if (isImage) {
          try {
            const compressed = await compressImage(file, 0.75);
            if (compressed.size < file.size) { uploadFile = compressed; ext = "jpg"; }
          } catch (err) {
            // Kompresi gagal — lanjut upload file asli aja.
          }
        }
        const maxSize = isVideo ? 30 * 1024 * 1024 : 5 * 1024 * 1024;
        if (uploadFile.size > maxSize) { setError(`Ukuran ${isVideo ? "video" : "foto"} maksimal ${isVideo ? "30MB" : "5MB"}.`); continue; }
        const path = `sop/${selectedBranch.id}/${viewPeriod}/${key}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
        const { error: upErr } = await supabase.storage.from("findings").upload(path, uploadFile, { upsert: true, contentType: isImage ? "image/jpeg" : file.type });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("findings").getPublicUrl(path);
        uploaded.push({ url: pub.publicUrl, type: isVideo ? "video" : "image" });
      }
      if (uploaded.length) {
        setPhotos((prev) => ({ ...prev, [key]: [...(prev[key] || []), ...uploaded] }));
        setSaved(false);
      }
    } catch (err) {
      setError("Gagal upload: " + err.message);
    } finally {
      setUploadingKey(null);
    }
  }

  function removePhoto(key, index) {
    setPhotos((prev) => {
      const list = [...(prev[key] || [])];
      const [removed] = list.splice(index, 1);
      deleteMediaFromStorage(removed?.url); // hapus filenya juga di Storage
      const next = { ...prev, [key]: list };
      if (!list.length) delete next[key];
      return next;
    });
    setSaved(false);
  }

  function catScore(catId) {
    const cat = CATS.find((c) => c.id === catId);
    return cat.items.filter((_, i) => checklist[catId + "_" + i]).length;
  }

  const totalDone = useMemo(() => CATS.reduce((s, c) => s + catScore(c.id), 0), [checklist]);
  const weightedPct = useMemo(() => calcWeightedScore(checklist), [checklist]);
  const period = periodFromDate(auditDate);

  async function deleteAudit() {
    if (!selectedEntryId) return;
    const entry = entriesThisPeriod.find((e) => e.id === selectedEntryId);
    const isOwner = profile?.role === "auditor" && entry?.submitted_by === profile?.id;
    if (profile?.role !== "super_admin" && !isOwner) return;
    if (!window.confirm(`Hapus audit SOP ${selectedBranch.name} tanggal ${shortDate(entry?.data?.audit_date)}? Aksi ini tidak bisa dibatalkan.`)) return;
    setSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase.from("audit_generic").delete().eq("id", selectedEntryId);
      if (err) throw err;
      // Semua foto/video bukti SOP yang nempel di audit ini ikut kehapus dari Storage juga.
      const allMedia = Object.values(photos).flat();
      deleteMediaListFromStorage(allMedia);
      const remaining = entriesThisPeriod.filter((e) => e.id !== selectedEntryId);
      setEntriesThisPeriod(remaining);
      if (remaining.length) applyEntryToForm(remaining[0]);
      else startNewEntry(viewPeriod);
      setSaved(false);
    } catch (err) {
      setError("Gagal menghapus: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveAudit() {
    if (!canEdit) { setError("Kamu tidak punya izin untuk menyimpan audit."); return; }
    if (!auditDate) { setError("Tanggal audit wajib diisi."); return; }
    setSaving(true);
    setError(null);
    try {
      const cats = {};
      CATS.forEach((c) => { cats[c.id] = { score: catScore(c.id), total: c.items.length }; });
      const cleanNotes = {};
      Object.keys(notes).forEach((k) => { if (notes[k] && notes[k].trim()) cleanNotes[k] = notes[k].trim(); });

      const user = (await supabase.auth.getUser()).data.user;
      const payload = {
        module: "sop",
        branch_id: selectedBranch.id,
        period,
        status: "submitted",
        submitted_by: user.id,
        data: tidakVisit
          ? { audit_date: auditDate, tidak_visit: true, cabang_baru: cabangBaru, auditor_name: profile?.full_name || null, store_manager_name: storeManagerName || null }
          : {
              audit_date: auditDate,
              tidak_visit: false,
              cabang_baru: cabangBaru,
              cats,
              checks: checklist,
              notes: cleanNotes,
              photos,
              done: totalDone,
              score: weightedPct,
              auditor_name: profile?.full_name || null,
              store_manager_name: storeManagerName || null,
            },
      };

      let row;
      if (selectedEntryId) {
        const res = await supabase.from("audit_generic").update(payload).eq("id", selectedEntryId).select().single();
        if (res.error) throw res.error;
        row = res.data;
      } else {
        const res = await supabase.from("audit_generic").insert(payload).select().single();
        if (res.error) throw res.error;
        row = res.data;
      }
      setSelectedEntryId(row.id);
      setEntriesThisPeriod((prev) => {
        const others = prev.filter((e) => e.id !== row.id);
        return [row, ...others].sort((a, b) => (b.data?.audit_date || "").localeCompare(a.data?.audit_date || ""));
      });
      setSaved(true);
    } catch (err) {
      setError("Gagal menyimpan: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Tampilan: pilih cabang ──
  if (!selectedBranch) {
    const rowsByBranch = {};
    Object.keys(latestByBranchPeriod).forEach((key) => {
      const [branchId, per] = key.split("|");
      if (per === viewPeriod) rowsByBranch[branchId] = latestByBranchPeriod[key].entry;
    });

    return (
      <div style={{ flex: 1 }}>
        <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Audit Cabang</div>
            <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>Pilih cabang untuk mulai atau lanjutkan checklist audit SOP</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 8, padding: "4px 6px" }}>
            <button className="btn-ghost" onClick={() => setViewPeriod(addMonthsToPeriod(viewPeriod, -1))} style={{ padding: "6px 10px" }}>{"<"}</button>
            <div className="mono" style={{ fontWeight: 600, minWidth: 130, textAlign: "center", fontSize: 13.5 }}>{periodeLabel(viewPeriod)}</div>
            <button className="btn-ghost" onClick={() => setViewPeriod(addMonthsToPeriod(viewPeriod, 1))} style={{ padding: "6px 10px" }}>{">"}</button>
          </div>
        </div>
        <div style={{ padding: 24 }}>
          {(() => {
            const prevPeriod = addMonthsToPeriod(viewPeriod, -1);
            const prevRowsByBranch = {};
            Object.keys(latestByBranchPeriod).forEach((key) => {
              const [branchId, per] = key.split("|");
              if (per === prevPeriod) prevRowsByBranch[branchId] = latestByBranchPeriod[key].entry;
            });

            const total = branches.length;
            const tidakVisitCount = branches.filter((b) => rowsByBranch[b.id]?.data?.tidak_visit).length;
            const curList = branches.map((b) => {
              const row = rowsByBranch[b.id];
              if (!row || row.data?.tidak_visit) return null;
              return { branch: b, row, score: calcWeightedFromRecord(row.data) };
            }).filter(Boolean);
            const prevList = branches.map((b) => {
              const row = prevRowsByBranch[b.id];
              if (!row || row.data?.tidak_visit) return null;
              return { branch: b, row, score: calcWeightedFromRecord(row.data) };
            }).filter(Boolean);

            const auditedCount = curList.length;
            const coverageTrend = total > 0 ? Math.round(((auditedCount - prevList.length) / total) * 100) : 0;
            const belumCount = total - auditedCount - tidakVisitCount;

            const avgScore = auditedCount ? Math.round(curList.reduce((s, x) => s + x.score, 0) / auditedCount) : null;
            const avgScorePrev = prevList.length ? Math.round(prevList.reduce((s, x) => s + x.score, 0) / prevList.length) : null;
            const avgTrend = avgScore !== null && avgScorePrev !== null ? avgScore - avgScorePrev : null;

            const alertCount = curList.filter((x) => x.score < ALERT_THRESHOLD).length;
            const alertCountPrev = prevList.filter((x) => x.score < ALERT_THRESHOLD).length;
            const alertTrend = alertCount - alertCountPrev;

            const sortedBest = [...curList].sort((a, b) => b.score - a.score).slice(0, 3);
            const sortedWorst = [...curList].sort((a, b) => a.score - b.score).slice(0, 3);

            const findingCount = {};
            curList.forEach((x) => {
              const checks = x.row.data?.checks || {};
              CATS.forEach((c) => {
                c.items.forEach((text, i) => {
                  const key = c.id + "_" + i;
                  if (!checks[key]) findingCount[text] = (findingCount[text] || 0) + 1;
                });
              });
            });
            const topFindings = Object.entries(findingCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([text, count]) => ({ text, count }));

            return (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14, marginBottom: 20 }}>
                  <KpiCard label="Cabang Diaudit" value={`${auditedCount} / ${total}`} trend={coverageTrend} trendGoodDirection="up" sub={periodeLabel(viewPeriod)} iconColor="#7c3aed" />
                  <KpiCard label="Belum Diaudit" value={belumCount} trend={-coverageTrend} trendGoodDirection="down" sub={tidakVisitCount > 0 ? `+${tidakVisitCount} tidak visit` : "perlu follow up"} iconColor="#b07212" />
                  <KpiCard label="Rata-rata SOP" value={avgScore !== null ? `${avgScore}%` : "\u2014"} trend={avgTrend} trendGoodDirection="up" sub="periode aktif" iconColor="#2563eb" />
                  <KpiCard label={`Di Bawah ${ALERT_THRESHOLD}%`} value={alertCount} trend={alertTrend} trendGoodDirection="down" sub={alertCount === 0 ? "aman" : "perlu perhatian"} iconColor="#a32020" flat={alertCount === 0} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 24 }}>
                  <ListPanel title="Top 3 Cabang Terbaik" sub={periodeLabel(viewPeriod)}>
                    {sortedBest.length === 0 ? <EmptyNote /> : sortedBest.map((x, i) => (
                      <RankRow key={x.branch.id} rank={i + 1} label={x.branch.name} value={`${x.score}%`} valueColor="#1a9e6e" />
                    ))}
                  </ListPanel>
                  <ListPanel title="Top 3 Cabang Terburuk" sub={periodeLabel(viewPeriod)}>
                    {sortedWorst.length === 0 ? <EmptyNote /> : sortedWorst.map((x, i) => (
                      <RankRow key={x.branch.id} rank={i + 1} label={x.branch.name} value={`${x.score}%`} valueColor={scoreColor(x.score)} />
                    ))}
                  </ListPanel>
                  <ListPanel title="Top 5 Temuan Terbanyak" sub="Normalisasi nama temuan">
                    {topFindings.length === 0 ? <EmptyNote text="Belum ada temuan periode ini." /> : topFindings.map((f, i) => (
                      <RankRow key={i} rank={i + 1} label={f.text} truncate value={`${f.count} Temuan`} valueColor="var(--danger-text)" />
                    ))}
                  </ListPanel>
                </div>
              </>
            );
          })()}
          {loadingBranches ? (
            <div style={{ color: "var(--text-secondary)" }}>Memuat cabang\u2026</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 12 }}>
              {branches.map((b) => {
                const row = rowsByBranch[b.id];
                const rowMeta = latestByBranchPeriod[`${b.id}|${viewPeriod}`];
                const isTidakVisit = row?.data?.tidak_visit;
                const score = row && !isTidakVisit ? calcWeightedFromRecord(row.data) : null;
                return (
                  <div
                    key={b.id}
                    onClick={() => pickBranch(b)}
                    style={{ position: "relative", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", cursor: "pointer", overflow: "hidden" }}
                  >
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: isTidakVisit ? "#888" : row ? scoreColor(score) : "linear-gradient(90deg, #7c3aed, #F4B740)" }} />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                      <div style={{ fontWeight: 600, fontSize: 14.5 }}>{b.name}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {row?.data?.cabang_baru && (
                          <span style={{ fontSize: 9.5, fontWeight: 700, color: "#F4B740", background: "#F4B74022", padding: "2px 7px", borderRadius: 20 }}>Cabang Baru</span>
                        )}
                        {rowMeta && rowMeta.count > 1 && (
                          <span style={{ fontSize: 9.5, fontWeight: 700, color: "#7c3aed", background: "#7c3aed18", padding: "2px 7px", borderRadius: 20 }}>{rowMeta.count} audit</span>
                        )}
                        {score !== null && score < ALERT_THRESHOLD && (
                          <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--danger-text)", background: "var(--danger-bg)", padding: "2px 7px", borderRadius: 20 }}>ALERT</span>
                        )}
                      </div>
                    </div>
                    {isTidakVisit ? (
                      <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, background: "#88888822", color: "#888", fontSize: 11, fontWeight: 600 }}>Tidak Visit</span>
                    ) : row ? (
                      <>
                        <div style={{ fontSize: 24, fontWeight: 800, color: scoreColor(score) }}>{score}%</div>
                        <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>Skor SOP &middot; {shortDate(row.data?.audit_date)}</div>
                      </>
                    ) : (
                      <div style={{ fontSize: 11.5, fontWeight: 400, color: "var(--text-faint)", marginTop: 4 }}>Belum ada audit &middot; Mulai &rarr;</div>
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

  // ── Tampilan: form checklist ──
  return (
    <div style={{ flex: 1 }}>
      <div style={{ background: "var(--surface)", padding: "16px 28px", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
          <div>
            <button className="btn-ghost" style={{ marginBottom: 8, fontSize: 12.5 }} onClick={backToList}>&larr; Pilih cabang lain</button>
            <div className="display" style={{ fontSize: 19, fontWeight: 600 }}>Audit &mdash; {selectedBranch.name}</div>
            <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
              Periode: {periodeLabel(period)}
              {selectedEntryId ? <span> &middot; mengedit audit tanggal {shortDate(auditDate)}</span> : <span> &middot; audit baru</span>}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div>
              <label style={{ display: "block", fontSize: 11, color: "var(--text-secondary)", marginBottom: 3 }}>Tanggal audit</label>
              <input className="input" type="date" value={auditDate} onChange={(e) => { setAuditDate(e.target.value); setSaved(false); }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, color: "var(--text-secondary)", marginBottom: 3 }}>Nama yang Mengetahui</label>
              <input className="input" placeholder="Misal: Store Manager" disabled={!canEdit} value={storeManagerName} onChange={(e) => { setStoreManagerName(e.target.value); setSaved(false); }} />
            </div>
            <button className="btn" disabled={saving || !canEdit} onClick={saveAudit} style={{ alignSelf: "flex-end" }} title={!canEdit ? "Kamu tidak punya izin mengedit" : undefined}>
              {saving ? "Menyimpan\u2026" : saved ? "\u2713 Tersimpan" : canEdit ? "Simpan Hasil Audit" : "Hanya Lihat"}
            </button>
            {(profile?.role === "super_admin" || (profile?.role === "auditor" && entriesThisPeriod.find((e) => e.id === selectedEntryId)?.submitted_by === profile?.id)) && selectedEntryId && (
              <button className="btn-ghost" disabled={saving} onClick={deleteAudit} style={{ alignSelf: "flex-end", color: "var(--danger-text)", borderColor: "var(--danger-border, rgba(239,68,68,0.35))" }}>
                Hapus Data
              </button>
            )}
          </div>
        </div>

        {entriesThisPeriod.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>
              Riwayat audit {periodeLabel(viewPeriod)} ({entriesThisPeriod.length})
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[...entriesThisPeriod].sort((a, b) => (a.data?.audit_date || "").localeCompare(b.data?.audit_date || "")).map((e, i) => {
                const isTV = e.data?.tidak_visit;
                const sc = !isTV ? calcWeightedFromRecord(e.data) : null;
                const active = e.id === selectedEntryId;
                return (
                  <div
                    key={e.id}
                    onClick={() => applyEntryToForm(e)}
                    style={{
                      cursor: "pointer", padding: "7px 12px", borderRadius: 10,
                      border: `1.5px solid ${active ? "#7c3aed" : "var(--border)"}`,
                      background: active ? "#7c3aed14" : "var(--surface)",
                      display: "flex", alignItems: "center", gap: 7,
                    }}
                  >
                    <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-faint)" }}>Audit {i + 1}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 600 }}>{shortDate(e.data?.audit_date)}</span>
                    {e.data?.cabang_baru && <span style={{ fontSize: 10, fontWeight: 700, color: "#F4B740" }}>⭐ Baru</span>}
                    {isTV ? (
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#888" }}>Tidak Visit</span>
                    ) : (
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: scoreColor(sc) }}>{sc}%</span>
                    )}
                  </div>
                );
              })}
              {canEdit && (
                <div
                  onClick={() => startNewEntry(viewPeriod)}
                  style={{
                    cursor: "pointer", padding: "7px 12px", borderRadius: 10,
                    border: `1.5px dashed ${!selectedEntryId ? "#7c3aed" : "var(--border)"}`,
                    color: "#7c3aed", background: !selectedEntryId ? "#7c3aed14" : "transparent",
                    display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700,
                  }}
                >
                  + Audit Baru
                </div>
              )}
            </div>
          </div>
        )}

        {/* Toggle Tidak Visit */}
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, cursor: canEdit ? "pointer" : "default", fontSize: 13, color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={tidakVisit} disabled={!canEdit} onChange={(e) => { setTidakVisit(e.target.checked); setSaved(false); }} />
          Cabang ini tidak dikunjungi bulan ini (Tidak Visit)
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, cursor: canEdit ? "pointer" : "default", fontSize: 13, color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={cabangBaru} disabled={!canEdit} onChange={(e) => { setCabangBaru(e.target.checked); setSaved(false); }} />
          Cabang Baru <span style={{ color: "var(--text-faint)" }}>(tetap dihitung normal, cuma ditandai di laporan)</span>
        </label>

        {/* Skor live */}
        {!tidakVisit && (
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: scoreColor(weightedPct) }}>{weightedPct}%</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 4 }}>{totalDone} dari {TOTAL_ITEMS} poin terpenuhi (skor tertimbang)</div>
              <div style={{ height: 6, background: "var(--bg-page)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${weightedPct}%`, background: scoreColor(weightedPct), transition: "width .2s" }} />
              </div>
            </div>
            {weightedPct < ALERT_THRESHOLD && (
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--danger-text)", background: "var(--danger-bg)", padding: "4px 10px", borderRadius: 20 }}>DI BAWAH TARGET</span>
            )}
          </div>
        )}
      </div>

      {error && <div style={{ margin: "14px 28px 0", background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}

      <div style={{ padding: 24 }}>
        {tidakVisit ? (
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 24, textAlign: "center", color: "var(--text-faint)" }}>
            Cabang ini ditandai <b>Tidak Visit</b> untuk periode {periodeLabel(period)}. Checklist disembunyikan. Uncheck kotak di atas kalau mau isi checklist.
          </div>
        ) : loadingRecord ? (
          <div style={{ color: "var(--text-secondary)" }}>Memuat data audit\u2026</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {CATS.map((c) => {
              const done = catScore(c.id);
              const isOpen = openCats[c.id] ?? false;
              const w = TIER_WEIGHTS[c.id];
              const tierTag = TIER3_CATS.includes(c.id) ? "T3" : TIER1_CATS.includes(c.id) ? "T1" : "T2";
              return (
                <div key={c.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
                  <div
                    onClick={() => setOpenCats((p) => ({ ...p, [c.id]: !isOpen }))}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 16px", cursor: "pointer" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: 9, height: 9, borderRadius: "50%", background: c.color, flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{c.label}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-faint)", border: "1px solid var(--border)", borderRadius: 5, padding: "1px 6px" }}>{tierTag} &middot; {Math.round(w * 100)}%</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: done === c.items.length ? "#1a9e6e" : "var(--text-secondary)" }}>{done}/{c.items.length}</span>
                      {canEdit && done < c.items.length && (
                        <button
                          onClick={(e) => { e.stopPropagation(); checkAllInCategory(c); }}
                          className="btn-ghost"
                          style={{ fontSize: 11, padding: "4px 10px", color: "#1a9e6e", borderColor: "rgba(26,158,110,0.4)" }}
                        >
                          &#10003; Centang Semua
                        </button>
                      )}
                      <span style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .15s", fontSize: 11, color: "var(--text-faint)" }}>&#9660;</span>
                    </div>
                  </div>

                  {isOpen && (
                    <div style={{ borderTop: "1px solid var(--border)" }}>
                      {c.items.map((txt, i) => {
                        const id = c.id + "_" + i;
                        const checked = !!checklist[id];
                        return (
                          <div key={id} style={{ padding: "10px 16px", borderBottom: i < c.items.length - 1 ? "1px solid var(--border)" : "none" }}>
                            <div onClick={() => toggleItem(c.id, i)} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: canEdit ? "pointer" : "default" }}>
                              <div style={{
                                width: 18, height: 18, borderRadius: 5, flexShrink: 0, marginTop: 1,
                                border: checked ? "none" : "1.5px solid var(--border)",
                                background: checked ? "#1a9e6e" : "transparent",
                                display: "flex", alignItems: "center", justifyContent: "center",
                              }}>
                                {checked && <span style={{ color: "#fff", fontSize: 12, lineHeight: 1 }}>&#10003;</span>}
                              </div>
                              <div style={{ fontSize: 13, color: checked ? "var(--text-faint)" : "var(--text-primary)", textDecoration: checked ? "line-through" : "none" }}>
                                {txt}
                                {CONDITION_ITEMS.has(id) && (
                                  <span style={{ marginLeft: 7, fontSize: 9.5, fontWeight: 700, color: "#d97706", background: "#d9770622", padding: "1.5px 7px", borderRadius: 20, whiteSpace: "nowrap" }}>
                                    &#128295; Kondisi Aset/Fasilitas
                                  </span>
                                )}
                              </div>
                            </div>
                            {!checked && (
                              <>
                                <textarea
                                  className="input"
                                  placeholder="Tulis keterangan kondisi yang tidak sesuai..."
                                  rows={2}
                                  value={notes[id] || ""}
                                  onChange={(e) => setNote(id, e.target.value)}
                                  disabled={!canEdit}
                                  style={{ marginTop: 8, marginLeft: 28, width: "calc(100% - 28px)", fontSize: 12.5, resize: "vertical" }}
                                />
                                <div style={{ marginTop: 8, marginLeft: 28, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                                  {(photos[id] || []).map((m, idx) => (
                                    <div key={idx} style={{ position: "relative", display: "inline-block" }}>
                                      {m.type === "video" ? (
                                        <video src={m.url} style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)" }} muted />
                                      ) : (
                                        <img src={m.url} alt="Bukti foto" style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)" }} />
                                      )}
                                      {m.type === "video" && (
                                        <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: "#fff", textShadow: "0 1px 4px rgba(0,0,0,0.6)", pointerEvents: "none" }}>&#9654;</span>
                                      )}
                                      {canEdit && (
                                        <span
                                          onClick={() => removePhoto(id, idx)}
                                          style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", background: "var(--danger-text)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, cursor: "pointer" }}
                                        >&times;</span>
                                      )}
                                    </div>
                                  ))}
                                  {canEdit && (
                                    <label
                                      tabIndex={0}
                                      onPaste={(e) => {
                                        const items = e.clipboardData?.items;
                                        if (!items) return;
                                        const files = [];
                                        for (const item of items) {
                                          if (item.kind === "file" && (item.type.startsWith("image/") || item.type.startsWith("video/"))) {
                                            const f = item.getAsFile();
                                            if (f) files.push(f);
                                          }
                                        }
                                        if (files.length) { e.preventDefault(); uploadPhoto(id, files); }
                                      }}
                                      title="Klik lalu Ctrl+V buat paste foto dari clipboard"
                                      style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, fontSize: 11.5, color: "var(--text-faint)", border: "1px dashed var(--border)", borderRadius: 8, padding: "8px 12px", cursor: "pointer", height: 90, boxSizing: "border-box" }}
                                    >
                                      {uploadingKey === id ? (
                                        "Mengunggah\u2026"
                                      ) : (
                                        <>
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
                                          {(photos[id] || []).length ? "Tambah lagi" : "Tambah foto/video"}
                                          <span style={{ fontSize: 9, opacity: 0.7 }}>atau Ctrl+V</span>
                                        </>
                                      )}
                                      <input type="file" accept="image/*,video/*" multiple style={{ display: "none" }} disabled={uploadingKey === id} onChange={(e) => { if (e.target.files?.length) uploadPhoto(id, e.target.files); e.target.value = ""; }} />
                                    </label>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
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

function KpiCard({ label, value, trend, trendGoodDirection, sub, iconColor, flat }) {
  const isGood = flat ? true : trendGoodDirection === "up" ? trend >= 0 : trend <= 0;
  const trendColor = flat ? "var(--text-faint)" : isGood ? "#1a9e6e" : "var(--danger-text)";
  const arrow = trend > 0 ? "\u25B2" : trend < 0 ? "\u25BC" : "\u2013";
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: iconColor }} />
      <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: "var(--text-primary)", marginBottom: 8 }}>{value}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {!flat && trend !== null && trend !== undefined && (
          <span style={{ fontSize: 10.5, fontWeight: 700, color: trendColor, background: `${trendColor}22`, padding: "2px 8px", borderRadius: 20 }}>
            {arrow} {Math.abs(trend)}%
          </span>
        )}
        {flat && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)", background: "var(--surface-alt)", padding: "2px 8px", borderRadius: 20 }}>&mdash;</span>}
        <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{sub}</span>
      </div>
    </div>
  );
}

function ListPanel({ title, sub, children }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20 }}>
      <div style={{ fontWeight: 700, fontSize: 14.5 }}>{title}</div>
      <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginBottom: 14 }}>{sub}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
    </div>
  );
}

function RankRow({ rank, label, value, valueColor, truncate }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--surface-alt)", color: "#7c3aed", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 700, flexShrink: 0 }}>{rank}</div>
      <div style={{ flex: 1, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: truncate ? "nowrap" : "normal" }} title={label}>{label}</div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: valueColor, flexShrink: 0 }}>{value}</div>
    </div>
  );
}

function EmptyNote({ text = "Belum ada data periode ini." }) {
  return <div style={{ fontSize: 12.5, color: "var(--text-faint)", padding: "8px 0" }}>{text}</div>;
}
