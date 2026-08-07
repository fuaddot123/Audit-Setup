import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

const DAY_HEADERS = ["Senin", "Selasa", "Rabu", "Kamis", "Jum'at", "Sabtu", "Minggu"];
const PALETTE = ["#F4B740", "#EC4899", "#8B5CF6", "#22D3EE", "#34D399", "#F97316", "#60A5FA", "#F472B6", "#A3E635", "#FB7185"];
const MONTH_NAMES = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

function toDate(str) { const d = new Date(str + "T00:00:00"); return d; }
function fmtISO(d) {
  // JANGAN pakai toISOString() — itu convert ke UTC, dan Indonesia (WIB/WITA/WIT) di depan
  // UTC, jadi tanggalnya bisa mundur 1 hari (misal tanggal 17 lokal jadi "16" pas dicek ke
  // data hari libur). Ambil komponen tanggal LOKAL langsung, bukan lewat konversi UTC.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

function getMonthGrid(year, month) {
  const firstOfMonth = new Date(year, month, 1);
  const startIdx = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = addDays(firstOfMonth, -startIdx);
  const lastOfMonth = new Date(year, month + 1, 0);
  const endIdx = (lastOfMonth.getDay() + 6) % 7;
  const gridEnd = addDays(lastOfMonth, 6 - endIdx);
  const weeks = [];
  let cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    const week = [];
    for (let i = 0; i < 7; i++) { week.push(new Date(cursor)); cursor = addDays(cursor, 1); }
    weeks.push(week);
  }
  return weeks;
}

function eventsForWeek(week, events) {
  const weekStart = week[0], weekEnd = week[6];
  return events
    .filter((e) => e.start <= weekEnd && e.end >= weekStart)
    .map((e) => {
      const clipStart = e.start < weekStart ? weekStart : e.start;
      const clipEnd = e.end > weekEnd ? weekEnd : e.end;
      const startIdx = week.findIndex((d) => sameDay(d, clipStart));
      const endIdx = week.findIndex((d) => sameDay(d, clipEnd));
      return { ...e, startIdx, endIdx };
    });
}

function assignLanes(events) {
  const sorted = [...events].sort((a, b) => a.startIdx - b.startIdx);
  const laneEnds = [];
  sorted.forEach((e) => {
    let laneIdx = laneEnds.findIndex((endIdx) => endIdx < e.startIdx);
    if (laneIdx === -1) { laneEnds.push(e.endIdx); e.lane = laneEnds.length - 1; }
    else { laneEnds[laneIdx] = e.endIdx; e.lane = laneIdx; }
  });
  return { events: sorted, laneCount: laneEnds.length || 1 };
}

const EMPTY_FORM = { branch_id: "", start_date: "", end_date: "", notes: "" };
const ISOLATION_START_PERIOD = "2026-08-01"; // format tanggal (bukan "YYYY-MM"), sesuai kolom start_date

export default function Timeline({ profile, onSelect }) {
  const [current, setCurrent] = useState(() => { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() }; });
  const [branches, setBranches] = useState([]);
  const [auditors, setAuditors] = useState([]);
  const [rawEvents, setRawEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [viewingRaw, setViewingRaw] = useState(null); // event yang lagi dibuka via mode LIAT-DOANG (super_admin, atau bukan milik sendiri)
  const [form, setForm] = useState(EMPTY_FORM);
  const [statusNoteDraft, setStatusNoteDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [holidays, setHolidays] = useState({}); // { "2026-08-17": "Hari Kemerdekaan Republik Indonesia", ... }

  // Auditor bikin jadwalnya sendiri-sendiri; super_admin cuma mantau (read-only, liat semua).
  const canManage = profile?.role === "auditor";
  const isolate = profile?.role === "auditor";

  useEffect(() => { loadAll(); }, []);
  useEffect(() => { loadHolidays(current.year); }, [current.year]);

  async function loadHolidays(year) {
    try {
      // Lewat API route sendiri (/api/hari-libur), bukan langsung ke domain luar — biar nggak
      // kena blokir CORS dari browser (server-ke-server aman, browser-ke-domain-luar kena block).
      const res = await fetch(`/api/hari-libur?year=${year}`);
      const json = await res.json();
      const map = {};
      (json.data || []).forEach((h) => { map[h.date] = h.description; });
      setHolidays((prev) => ({ ...prev, ...map }));
    } catch (err) {
      // Kalau API-nya lagi down, kalender tetap jalan normal — cuma tanpa tanda tanggal merah otomatis.
      console.error("Gagal memuat data hari libur:", err);
    }
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const { data: br, error: brErr } = await supabase.from("branches").select("*").order("name");
      if (brErr) throw brErr;
      setBranches(br || []);
      const { data: prof, error: profErr } = await supabase.from("profiles").select("id, full_name");
      if (profErr) throw profErr;
      setAuditors(prof || []);
      // Isolasi per-auditor mulai Agustus 2026 ke depan (Jan-Jul 2026 tetep gabungan semua kayak biasa).
      let evQuery = supabase.from("audit_schedule").select("*").order("start_date");
      if (isolate) evQuery = evQuery.or(`start_date.lt.${ISOLATION_START_PERIOD},auditor_id.eq.${profile.id}`);
      const { data: ev, error: evErr } = await evQuery;
      if (evErr) throw evErr;
      setRawEvents(ev || []);
    } catch (err) {
      setError("Gagal memuat data: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  function branchColor(branchId) {
    const idx = branches.findIndex((b) => b.id === branchId);
    return PALETTE[(idx >= 0 ? idx : 0) % PALETTE.length];
  }

  const STATUS_INFO = {
    "Sudah Visit": { icon: "\u2705", color: "#1a9e6e" },
    "Ada Kendala": { icon: "\u26A0\uFE0F", color: "#a32020" },
  };

  const events = rawEvents.map((e) => {
    const auditorName = auditors.find((a) => a.id === e.auditor_id)?.full_name || e.auditor_name || "\u2014";
    const statusIcon = STATUS_INFO[e.status]?.icon || "";
    return {
      id: e.id,
      branch_id: e.branch_id,
      label: `${statusIcon ? statusIcon + " " : ""}${(branches.find((b) => b.id === e.branch_id)?.name || "?")} \u00b7 ${auditorName}`,
      start: toDate(e.start_date),
      end: toDate(e.end_date),
      color: e.color || branchColor(e.branch_id),
      raw: e,
    };
  });

  const weeks = getMonthGrid(current.year, current.month);

  function openAdd(dateForNew) {
    if (!canManage) return;
    setEditingId(null);
    setForm({ ...EMPTY_FORM, start_date: dateForNew ? fmtISO(dateForNew) : "", end_date: dateForNew ? fmtISO(dateForNew) : "" });
    setShowModal(true);
  }

  function openEdit(rawEvent) {
    const isOwner = canManage && rawEvent.auditor_id === profile?.id;
    if (!isOwner) {
      // Super admin (atau lihat jadwal auditor lain, kalaupun ke-load) — mode liat doang.
      setViewingRaw(rawEvent);
      return;
    }
    setEditingId(rawEvent.id);
    setStatusNoteDraft(rawEvent.status_note || "");
    setForm({
      branch_id: rawEvent.branch_id,
      start_date: rawEvent.start_date,
      end_date: rawEvent.end_date,
      notes: rawEvent.notes || "",
    });
    setShowModal(true);
  }

  async function setEventStatus(status, note) {
    if (!editingId) return;
    setSaving(true);
    setError(null);
    try {
      const payload = { status, status_note: status === "Ada Kendala" ? (note || null) : null };
      const res = await supabase.from("audit_schedule").update(payload).eq("id", editingId).select().single();
      if (res.error) throw res.error;
      setRawEvents((prev) => prev.map((e) => (e.id === editingId ? res.data : e)));
      setShowModal(false);
    } catch (err) {
      setError("Gagal update status: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  function goToBeritaAcara() {
    setShowModal(false);
    if (onSelect) onSelect("berita_acara", null);
  }

  async function saveEvent() {
    if (!canManage) return;
    if (!form.branch_id || !form.start_date || !form.end_date) {
      setError("Cabang, tanggal mulai, dan tanggal selesai wajib diisi.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        branch_id: parseInt(form.branch_id, 10),
        auditor_id: profile.id,
        start_date: form.start_date,
        end_date: form.end_date < form.start_date ? form.start_date : form.end_date,
        notes: form.notes || null,
        color: branchColor(parseInt(form.branch_id, 10)),
        created_by: profile.id,
        ...(editingId ? {} : { status: "Terjadwal" }),
      };
      let res;
      if (editingId) {
        res = await supabase.from("audit_schedule").update(payload).eq("id", editingId).select().single();
      } else {
        res = await supabase.from("audit_schedule").insert(payload).select().single();
      }
      if (res.error) throw res.error;
      setRawEvents((prev) => {
        if (editingId) return prev.map((e) => (e.id === editingId ? res.data : e));
        return [...prev, res.data];
      });
      setShowModal(false);
    } catch (err) {
      setError("Gagal menyimpan jadwal: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteEvent() {
    if (!editingId || !canManage) return;
    setSaving(true);
    try {
      const { error: delErr } = await supabase.from("audit_schedule").delete().eq("id", editingId);
      if (delErr) throw delErr;
      setRawEvents((prev) => prev.filter((e) => e.id !== editingId));
      setShowModal(false);
    } catch (err) {
      setError("Gagal menghapus: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  function changeMonth(delta) {
    let { year, month } = current;
    month += delta;
    if (month < 0) { month = 11; year -= 1; }
    if (month > 11) { month = 0; year += 1; }
    setCurrent({ year, month });
  }

  if (loading) return <div style={{ padding: 40, color: "var(--text-secondary)" }}>Memuat data…</div>;

  return (
    <div style={{ flex: 1 }}>
      <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Timeline</div>
          <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>{canManage ? "Jadwal kunjungan audit kamu sendiri" : "Pantau jadwal kunjungan semua auditor (lihat saja)"}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="btn-ghost" onClick={() => changeMonth(-1)}>{"<"}</button>
          <div className="mono" style={{ fontWeight: 600, minWidth: 150, textAlign: "center" }}>{MONTH_NAMES[current.month]} {current.year}</div>
          <button className="btn-ghost" onClick={() => changeMonth(1)}>{">"}</button>
          {canManage && <button className="btn" onClick={() => openAdd(null)}>+ Jadwal baru</button>}
        </div>
      </div>

      {error && <div style={{ margin: "14px 28px 0", background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}

      <div style={{ padding: 24 }}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          {/* header hari */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", borderBottom: "1px solid var(--border)" }}>
            {DAY_HEADERS.map((d, i) => (
              <div key={d} style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, color: i >= 5 ? "var(--danger-text)" : "var(--text-primary)", borderRight: i < 6 ? "1px solid var(--border)" : "none" }}>{d}</div>
            ))}
          </div>

          {weeks.map((week, wi) => {
            const wEvents = eventsForWeek(week, events);
            const { events: laneEvents, laneCount } = assignLanes(wEvents);
            return (
              <div key={wi} style={{ borderBottom: wi < weeks.length - 1 ? "1px solid var(--border)" : "none" }}>
                {/* tanggal */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
                  {week.map((d, di) => {
                    const inMonth = d.getMonth() === current.month;
                    const iso = fmtISO(d);
                    const holidayName = holidays[iso];
                    const isRed = di >= 5 || !!holidayName;
                    return (
                      <div
                        key={di}
                        onClick={() => openAdd(d)}
                        title={holidayName || ""}
                        style={{ padding: "8px 10px 2px", fontSize: 12.5, color: inMonth ? (isRed ? "var(--danger-text)" : "var(--text-secondary)") : "var(--text-faint)", borderRight: di < 6 ? "1px solid var(--border)" : "none", cursor: "pointer", fontStyle: inMonth ? "normal" : "italic", display: "flex", alignItems: "center", gap: 5 }}
                      >
                        {d.getDate()}
                        {inMonth && holidayName && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--danger-text)", flexShrink: 0 }} />}
                      </div>
                    );
                  })}
                </div>
                {/* bar jadwal, per lane */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gridAutoRows: "26px", gap: "3px 0", padding: "2px 0 8px" }}>
                  {laneEvents.map((e) => (
                    <div
                      key={e.id}
                      onClick={() => openEdit(e.raw)}
                      title={e.label}
                      style={{
                        gridColumn: `${e.startIdx + 1} / ${e.endIdx + 2}`,
                        gridRow: e.lane + 1,
                        background: e.color,
                        borderLeft: "3px solid rgba(0,0,0,0.25)",
                        color: "#1A1024",
                        margin: "0 2px",
                        borderRadius: 4,
                        padding: "3px 8px",
                        fontSize: 12,
                        fontWeight: 600,
                        display: "flex",
                        alignItems: "center",
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                        cursor: "pointer",
                      }}
                    >
                      {e.label}
                    </div>
                  ))}
                  {laneEvents.length === 0 && <div style={{ gridColumn: "1 / 8", height: 6 }} />}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 10 }}>Klik tanggal kosong buat tambah jadwal baru, atau klik blok warna buat edit/hapus.</div>

        {(() => {
          const monthHolidays = Object.entries(holidays)
            .filter(([date]) => { const d = toDate(date); return d.getFullYear() === current.year && d.getMonth() === current.month; })
            .sort(([a], [b]) => a.localeCompare(b));
          return (
            <div style={{ marginTop: 16, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: monthHolidays.length ? 10 : 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--danger-text)" }} />
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Hari Libur Nasional {MONTH_NAMES[current.month]} {current.year}</div>
                <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-faint)" }}>{monthHolidays.length} tanggal merah</span>
              </div>
              {monthHolidays.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {monthHolidays.map(([date, desc]) => (
                    <div key={date} style={{ display: "flex", gap: 10, fontSize: 12.5 }}>
                      <div className="mono" style={{ color: "var(--danger-text)", fontWeight: 600, minWidth: 90 }}>{toDate(date).toLocaleDateString("id-ID", { weekday: "short", day: "2-digit", month: "short" })}</div>
                      <div style={{ color: "var(--text-secondary)" }}>{desc}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12.5, color: "var(--text-faint)" }}>Tidak ada hari libur nasional bulan ini.</div>
              )}
            </div>
          );
        })()}
      </div>

      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "var(--overlay)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setShowModal(false)}>
          <div style={{ background: "var(--surface)", borderRadius: 14, padding: 24, width: 380, maxWidth: "90%" }} onClick={(e) => e.stopPropagation()}>
            <div className="display" style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>{editingId ? "Edit jadwal" : "Jadwal baru"}</div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 5 }}>Cabang</label>
              <select className="input" value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
                <option value="">— pilih cabang —</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 5 }}>Mulai</label>
                <input className="input" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 5 }}>Selesai</label>
                <input className="input" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
              </div>
            </div>

            <div style={{ marginBottom: editingId ? 12 : 18 }}>
              <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 5 }}>Catatan (opsional)</label>
              <input className="input" placeholder="Misal: Report Monthly" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>

            {editingId && (
              <div style={{ marginBottom: 18, padding: 12, background: "var(--surface-alt)", borderRadius: 10, border: "1px solid var(--border)" }}>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 8 }}>Setelah kunjungan</label>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <button className="btn-ghost" disabled={saving} style={{ flex: 1, color: "#1a9e6e", borderColor: "#1a9e6e55" }} onClick={() => setEventStatus("Sudah Visit", null)}>✅ Sudah Visit</button>
                  <button className="btn-ghost" disabled={saving} style={{ flex: 1, color: "var(--danger-text)", borderColor: "var(--danger-border)" }} onClick={() => setEventStatus("Ada Kendala", statusNoteDraft)}>⚠️ Ada Kendala</button>
                </div>
                <input className="input" placeholder="Keterangan kendala (kalau ada)" value={statusNoteDraft} onChange={(e) => setStatusNoteDraft(e.target.value)} style={{ marginBottom: 8 }} />
                <button className="btn" style={{ width: "100%" }} onClick={goToBeritaAcara}>Isi Berita Acara →</button>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              {editingId ? (
                <button className="btn-ghost" disabled={saving} style={{ color: "var(--danger-text)", borderColor: "var(--danger-border)" }} onClick={deleteEvent}>Hapus</button>
              ) : <span />}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-ghost" onClick={() => setShowModal(false)}>Batal</button>
                <button className="btn" disabled={saving} onClick={saveEvent}>{saving ? "Menyimpan…" : "Simpan"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {viewingRaw && (
        <div style={{ position: "fixed", inset: 0, background: "var(--overlay)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setViewingRaw(null)}>
          <div style={{ background: "var(--surface)", borderRadius: 14, padding: 24, width: 380, maxWidth: "90%" }} onClick={(e) => e.stopPropagation()}>
            <div className="display" style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{branches.find((b) => b.id === viewingRaw.branch_id)?.name || "?"}</div>
            <div style={{ fontSize: 12.5, color: "var(--text-faint)", marginBottom: 16 }}>Jadwal kunjungan (lihat saja)</div>
            <ViewRow label="Auditor" value={auditors.find((a) => a.id === viewingRaw.auditor_id)?.full_name || "\u2014"} />
            <ViewRow label="Tanggal" value={`${viewingRaw.start_date} s/d ${viewingRaw.end_date}`} />
            <ViewRow label="Status" value={viewingRaw.status || "Terjadwal"} valueColor={STATUS_INFO[viewingRaw.status]?.color} />
            {viewingRaw.status === "Ada Kendala" && viewingRaw.status_note && <ViewRow label="Keterangan Kendala" value={viewingRaw.status_note} />}
            {viewingRaw.notes && <ViewRow label="Catatan" value={viewingRaw.notes} />}
            <button className="btn-ghost" style={{ width: "100%", marginTop: 8 }} onClick={() => setViewingRaw(null)}>Tutup</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ViewRow({ label, value, valueColor }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: valueColor || "var(--text-primary)" }}>{value}</div>
    </div>
  );
}
