import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabaseClient";
import {
  skorRugi, calcSkorTemuan, calcSkorTotal, calcKesehatanPct, kesehatanStatusInfo, formatKesehatanPct,
  periodFromDate, todayInputValue, periodeLabel,
} from "../../lib/stokConfig";

const EMPTY_FORM = { temuan_count: "", bonus_count: "", untung_rugi: "", tidak_visit: false };

export default function StokKesehatan({ profile }) {
  const [branches, setBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [existingRow, setExistingRow] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [auditDate, setAuditDate] = useState(todayInputValue());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [loadingRecord, setLoadingRecord] = useState(false);

  useEffect(() => { loadBranches(); }, []);

  async function loadBranches() {
    setLoadingBranches(true);
    const { data, error: err } = await supabase.from("branches").select("*").order("name");
    if (!err) setBranches(data || []);
    setLoadingBranches(false);
  }

  async function pickBranch(b) {
    setSelectedBranch(b);
    setSaved(false);
    setError(null);
    setLoadingRecord(true);
    const period = periodFromDate(auditDate);
    const { data, error: err } = await supabase
      .from("audit_generic")
      .select("*")
      .eq("module", "stok_kesehatan")
      .eq("branch_id", b.id)
      .eq("period", period)
      .maybeSingle();
    if (!err && data) {
      setExistingRow(data);
      setForm({
        temuan_count: data.data?.temuan_count ?? "",
        bonus_count: data.data?.bonus_count ?? "",
        untung_rugi: data.data?.untung_rugi ?? "",
        tidak_visit: !!data.data?.tidak_visit,
      });
      if (data.data?.audit_date) setAuditDate(data.data.audit_date);
    } else {
      setExistingRow(null);
      setForm(EMPTY_FORM);
    }
    setLoadingRecord(false);
  }

  function backToList() {
    setSelectedBranch(null);
    setExistingRow(null);
  }

  function setDigitField(key, val) {
    const digits = val.replace(/[^\d]/g, "");
    setForm((f) => ({ ...f, [key]: digits }));
    setSaved(false);
  }

  function setRugiField(val) {
    // izinkan minus di depan buat rugi
    const cleaned = val.replace(/[^\d-]/g, "").replace(/(?!^)-/g, "");
    setForm((f) => ({ ...f, untung_rugi: cleaned }));
    setSaved(false);
  }

  const skorTemuan = calcSkorTemuan(form.temuan_count, form.bonus_count);
  const sRugi = skorRugi(form.untung_rugi);
  const skorTotal = calcSkorTotal(skorTemuan, sRugi);
  const kesehatanPct = calcKesehatanPct(skorTotal);
  const status = kesehatanStatusInfo(kesehatanPct);
  const period = periodFromDate(auditDate);

  async function saveRecord() {
    if (!auditDate) { setError("Tanggal audit wajib diisi."); return; }
    setSaving(true);
    setError(null);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      const payload = {
        module: "stok_kesehatan",
        branch_id: selectedBranch.id,
        period,
        status: "submitted",
        submitted_by: user.id,
        data: form.tidak_visit
          ? { audit_date: auditDate, tidak_visit: true, auditor_name: profile?.full_name || null }
          : {
              audit_date: auditDate,
              tidak_visit: false,
              temuan_count: parseInt(form.temuan_count, 10) || 0,
              bonus_count: parseInt(form.bonus_count, 10) || 0,
              untung_rugi: parseInt(form.untung_rugi, 10) || 0,
              skor_temuan: skorTemuan,
              skor_rugi: sRugi,
              skor_total: skorTotal,
              kesehatan_pct: kesehatanPct,
              indikator: status.lbl,
              auditor_name: profile?.full_name || null,
            },
      };
      const { data, error: err } = await supabase
        .from("audit_generic")
        .upsert(payload, { onConflict: "module,branch_id,period" })
        .select()
        .single();
      if (err) throw err;
      setExistingRow(data);
      setSaved(true);
    } catch (err) {
      setError("Gagal menyimpan: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Tampilan: pilih cabang ──
  if (!selectedBranch) {
    return (
      <div style={{ flex: 1 }}>
        <div style={{ background: "var(--surface)", padding: "18px 28px", borderBottom: "1px solid var(--border)" }}>
          <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Kesehatan Stok</div>
          <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>Skor temuan barang & kerugian per cabang, per bulan</div>
        </div>
        <div style={{ padding: 24 }}>
          {loadingBranches ? (
            <div style={{ color: "var(--text-secondary)" }}>Memuat cabang\u2026</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
              {branches.map((b) => (
                <div
                  key={b.id}
                  onClick={() => pickBranch(b)}
                  style={{ position: "relative", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px", cursor: "pointer", fontWeight: 600, fontSize: 14.5, overflow: "hidden" }}
                >
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, #7c3aed, #F4B740)" }} />
                  {b.name}
                  <div style={{ fontSize: 11.5, fontWeight: 400, color: "var(--text-faint)", marginTop: 4 }}>Mulai audit &rarr;</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Tampilan: form input ──
  return (
    <div style={{ flex: 1 }}>
      <div style={{ background: "var(--surface)", padding: "16px 28px", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <button className="btn-ghost" style={{ marginBottom: 8, fontSize: 12.5 }} onClick={backToList}>&larr; Pilih cabang lain</button>
            <div className="display" style={{ fontSize: 19, fontWeight: 600 }}>Kesehatan Stok &mdash; {selectedBranch.name}</div>
            <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
              Periode: {periodeLabel(period)} {existingRow && <span style={{ color: "var(--text-faint)" }}>&middot; sudah pernah diisi, kamu mengedit data yang ada</span>}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div>
              <label style={{ display: "block", fontSize: 11, color: "var(--text-secondary)", marginBottom: 3 }}>Tanggal audit</label>
              <input className="input" type="date" value={auditDate} onChange={(e) => { setAuditDate(e.target.value); setSaved(false); }} />
            </div>
            <button className="btn" disabled={saving} onClick={saveRecord} style={{ alignSelf: "flex-end" }}>
              {saving ? "Menyimpan\u2026" : saved ? "\u2713 Tersimpan" : "Simpan"}
            </button>
          </div>
        </div>
      </div>

      {error && <div style={{ margin: "14px 28px 0", background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger-text)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}

      <div style={{ padding: 24, maxWidth: 560 }}>
        {loadingRecord ? (
          <div style={{ color: "var(--text-secondary)" }}>Memuat data\u2026</div>
        ) : (
          <>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, cursor: "pointer", fontSize: 13, color: "var(--text-secondary)" }}>
              <input type="checkbox" checked={form.tidak_visit} onChange={(e) => { setForm((f) => ({ ...f, tidak_visit: e.target.checked })); setSaved(false); }} />
              Cabang ini tidak dikunjungi bulan ini (Tidak Visit)
            </label>

            {!form.tidak_visit && (
              <>
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, marginBottom: 16 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 4 }}>
                    <Field label="Total Barang Plus Minus / Tertukar" hint="jumlah kejadian, bukan qty">
                      <input className="input" type="text" inputMode="numeric" placeholder="0" value={form.temuan_count} onChange={(e) => setDigitField("temuan_count", e.target.value)} />
                    </Field>
                    <Field label="Total Bonus Fisik Tidak Ada" hint="jumlah kejadian, bukan qty">
                      <input className="input" type="text" inputMode="numeric" placeholder="0" value={form.bonus_count} onChange={(e) => setDigitField("bonus_count", e.target.value)} />
                    </Field>
                  </div>
                  <Field label="Untung / Rugi (Rp)" hint="isi minus (-) kalau rugi, misal -150000">
                    <input className="input" type="text" inputMode="numeric" placeholder="0" value={form.untung_rugi} onChange={(e) => setRugiField(e.target.value)} />
                  </Field>
                  <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 10 }}>
                    Skor Temuan = jumlah 2 kejadian di atas. Skor Rugi 0&ndash;4 tergantung nominal kerugian. Skor Total = Skor Temuan + (Skor Rugi &times; 5).
                  </div>
                </div>

                <div style={{ background: "var(--surface-alt)", border: "1px solid var(--border)", borderRadius: 14, padding: "16px 18px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12, fontSize: 11.5 }}>
                    <MiniStat label="Skor Temuan" value={skorTemuan} />
                    <MiniStat label="Skor Rugi" value={sRugi} />
                    <MiniStat label="Skor Total" value={skorTotal} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>% Kesehatan Barang</span>
                    <span style={{ fontSize: 24, fontWeight: 800, color: status.color }}>{formatKesehatanPct(kesehatanPct)}</span>
                  </div>
                  <div style={{ height: 6, background: "var(--border)", borderRadius: 4, overflow: "hidden", marginBottom: 12 }}>
                    <div style={{ height: "100%", width: `${kesehatanPct * 100}%`, background: status.color, transition: "width .2s" }} />
                  </div>
                  <div style={{ background: `${status.color}22`, borderRadius: 8, padding: "9px 12px" }}>
                    <div style={{ fontWeight: 700, color: status.color, marginBottom: 2 }}>{status.lbl}</div>
                    <div style={{ fontSize: 12, color: status.color }}>{status.desc}</div>
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 10 }}>
                    Ambang: \u226585% Terkendali &middot; 70&ndash;84% Waspada &middot; 50&ndash;69% Monitoring &middot; &lt;50% Perlu Perhatian
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 4 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
      <div style={{ color: "var(--text-faint)", marginBottom: 2 }}>{label}</div>
      <div className="mono" style={{ fontWeight: 700, fontSize: 14 }}>{value}</div>
    </div>
  );
}
