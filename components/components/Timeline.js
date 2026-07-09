import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

const DAY_HEADERS = ["Senin", "Selasa", "Rabu", "Kamis", "Jum'at", "Sabtu", "Minggu"];
const MONTH_NAMES = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

function toDate(str) { const d = new Date(str + "T00:00:00"); return d; }
function fmtISO(d) { return d.toISOString().slice(0, 10); }
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

const EMPTY_FORM = { branch_id: "", auditor_name: "", start_date: "", end_date: "", notes: "" };

export default function Timeline() {
  const [current, setCurrent] = useState(() => { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() }; });
  const [branches, setBranches] = useState([]);
  const [rawEvents, setRawEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const { data: br, error: brErr } = await supabase.from("branches").select("*").order("name");
      if (brErr) throw brErr;
      setBranches(br || []);
      const { data: ev, error: evErr } = await supabase.from("audit_schedule").select("*").order("start_date");
      if (evErr) throw evErr;
      setRawEvents(ev || []);
    } catch (err) {
      setError("Gagal memuat data: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  function branchColor() {
    return "#EAF4F1";
  }

  const events = rawEvents.map((e) => ({
    id: e.id,
    branch_id: e.branch_id,
    label: (branches.find((b) => b.id === e.branch_id)?.name || "?") + (e.auditor_name ? " · " + e.auditor_name : ""),
    start: toDate(e.start_date),
    end: toDate(e.end_date),
    color: e.color || branchColor(e.branch_id),
    raw: e,
  }));

  const weeks = getMonthGrid(current.year, current.month);

  function openAdd(dateForNew) {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, start_date: dateForNew ? fmtISO(dateForNew) : "", end_date: dateForNew ? fmtISO(dateForNew) : "" });
    setShowModal(true);
  }

  function openEdit(rawEvent) {
    setEditingId(rawEvent.id);
    setForm({
      branch_id: rawEvent.branch_id,
      auditor_name: rawEvent.auditor_name || "",
      start_date: rawEvent.start_date,
      end_date: rawEvent.end_date,
      notes: rawEvent.notes || "",
    });
    setShowModal(true);
  }

  async function saveEvent() {
    if (!form.branch_id || !form.start_date || !form.end_date) {
      setError("Cabang, tanggal mulai, dan tanggal selesai wajib diisi.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      const payload = {
        branch_id: parseInt(form.branch_id, 10),
        auditor_name: form.auditor_name || null,
        start_date: form.start_date,
        end_date: form.end_date < form.start_date ? form.start_date : form.end_date,
        notes: form.notes || null,
        color: branchColor(parseInt(form.branch_id, 10)),
        created_by: user.id,
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
    if (!editingId) return;
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

  if (loading) return <div style={{ padding: 40, color: "#8B909C" }}>Memuat data…</div>;

  return (
    <div style={{ flex: 1 }}>
      <div style={{ background: "#fff", padding: "18px 28px", borderBottom: "1px solid #E4E5E9", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Timeline</div>
          <div style={{ color: "#8B909C", fontSize: 12.5 }}>Jadwal audit tiap cabang, satu tampilan buat seluruh tim</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="btn-ghost" onClick={() => changeMonth(-1)}>{"<"}</button>
          <div className="mono" style={{ fontWeight: 600, minWidth: 150, textAlign: "center" }}>{MONTH_NAMES[current.month]} {current.year}</div>
          <button className="btn-ghost" onClick={() => changeMonth(1)}>{">"}</button>
          <button className="btn" onClick={() => openAdd(null)}>+ Jadwal baru</button>
        </div>
      </div>

      {error && <div style={{ margin: "14px 28px 0", background: "#FBEBE7", border: "1px solid #F0C6BC", color: "#9C3B29", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}

      <div style={{ padding: 24 }}>
        <div style={{ background: "#fff", border: "1px solid #E4E5E9", borderRadius: 12, overflow: "hidden" }}>
          {/* header hari */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", borderBottom: "1px solid #E4E5E9" }}>
            {DAY_HEADERS.map((d, i) => (
              <div key={d} style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, color: i >= 5 ? "#C4432B" : "#1A1D24", borderRight: i < 6 ? "1px solid #EDEEF1" : "none" }}>{d}</div>
            ))}
          </div>

          {weeks.map((week, wi) => {
            const wEvents = eventsForWeek(week, events);
            const { events: laneEvents, laneCount } = assignLanes(wEvents);
            return (
              <div key={wi} style={{ borderBottom: wi < weeks.length - 1 ? "1px solid #E4E5E9" : "none" }}>
                {/* tanggal */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
                  {week.map((d, di) => {
                    const inMonth = d.getMonth() === current.month;
                    return (
                      <div
                        key={di}
                        onClick={() => openAdd(d)}
                        style={{ padding: "8px 10px 2px", fontSize: 12.5, color: inMonth ? (di >= 5 ? "#C4432B" : "#5B6270") : "#C7CAD1", borderRight: di < 6 ? "1px solid #F1F2F4" : "none", cursor: "pointer", fontStyle: inMonth ? "normal" : "italic" }}
                      >
                        {d.getDate()}
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
                        borderLeft: "3px solid #1F6F5C",
                        color: "#1A1D24",
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
        <div style={{ fontSize: 12, color: "#9AA0AC", marginTop: 10 }}>Klik tanggal kosong buat tambah jadwal baru, atau klik blok warna buat edit/hapus.</div>
      </div>

      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(20,22,28,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setShowModal(false)}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 24, width: 380, maxWidth: "90%" }} onClick={(e) => e.stopPropagation()}>
            <div className="display" style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>{editingId ? "Edit jadwal" : "Jadwal baru"}</div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "#5B6270", marginBottom: 5 }}>Cabang</label>
              <select className="input" value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
                <option value="">— pilih cabang —</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "#5B6270", marginBottom: 5 }}>Nama yang audit</label>
              <input className="input" placeholder="Misal: Budi" value={form.auditor_name} onChange={(e) => setForm({ ...form, auditor_name: e.target.value })} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "#5B6270", marginBottom: 5 }}>Mulai</label>
                <input className="input" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "#5B6270", marginBottom: 5 }}>Selesai</label>
                <input className="input" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
              </div>
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "#5B6270", marginBottom: 5 }}>Catatan (opsional)</label>
              <input className="input" placeholder="Misal: Report Monthly" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              {editingId ? (
                <button className="btn-ghost" disabled={saving} style={{ color: "#9C3B29", borderColor: "#F0C6BC" }} onClick={deleteEvent}>Hapus</button>
              ) : <span />}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-ghost" onClick={() => setShowModal(false)}>Batal</button>
                <button className="btn" disabled={saving} onClick={saveEvent}>{saving ? "Menyimpan…" : "Simpan"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}