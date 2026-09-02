// components/MasterDisplay.js
// ============================================================
// MENU "MASTER DATA" — khusus Super Admin.
//
// Semua angka yang menentukan hasil hitungan modul display ada di sini:
// batas umur, bobot skor, skala kondisi beserta nilainya, dan daftar
// perlakuan. Tidak ada satu pun yang ditulis di dalam kode.
//
// DUA ATURAN YANG DIPEGANG LAYAR INI:
//
// 1. Perubahan hanya berlaku untuk audit BERIKUTNYA. Skor dan batas umur
//    dibekukan ke dalam baris audit saat disimpan (trigger di database),
//    jadi Berita Acara yang sudah tercetak tidak ikut berubah. Sebelum ada
//    pembekuan itu, menurunkan skor "Lecet ringan" mengubah Berita Acara
//    Agustus dari 81% jadi 78,8% — lembar yang sudah ditandatangani.
//
// 2. Istilah yang sudah dipakai tidak bisa dihapus, hanya dinonaktifkan.
//    Menghapusnya akan memutus rujukan baris-baris audit lama.
// ============================================================

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

export default function MasterDisplay({ profile }) {
  const [standar, setStandar] = useState(null);
  const [brand, setBrand] = useState([]);
  const [opsi, setOpsi] = useState([]);          // dari v_display_opsi_pakai
  const [akunSemua, setAkunSemua] = useState([]);
  const [akses, setAkses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);

  const bolehUbah = profile?.role === "super_admin" && !profile?.liatSebagai;

  useEffect(() => { muat(); }, []);

  async function muat() {
    setLoading(true); setError(null);
    try {
      const [st, br, op, ak, ac] = await Promise.all([
        supabase.from("display_standar").select("*").eq("id", 1).single(),
        supabase.from("display_standar_brand").select("*").order("brand"),
        supabase.from("v_display_opsi_pakai").select("*").order("urutan"),
        supabase.from("profiles").select("id,full_name,role").order("full_name"),
        supabase.from("akses_auditor").select("*"),
      ]);
      if (st.error) throw st.error;
      if (br.error) throw br.error;
      if (op.error) throw op.error;
      setStandar(st.data);
      setBrand(br.data || []);
      setOpsi(op.data || []);
      setAkunSemua(ak.data || []);
      setAkses(ac.data || []);
    } catch (err) {
      setError("Gagal memuat master data: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  function kabar(t) { setPesan(t); setTimeout(() => setPesan(null), 2600); }

  async function simpanStandar() {
    setError(null);
    const bu = parseInt(standar.bobot_umur, 10) || 0;
    const bk = parseInt(standar.bobot_kondisi, 10) || 0;
    const maks = parseInt(standar.maks_hari_pajang, 10) || 0;
    const per = parseInt(standar.peringatan_sebelum_hari, 10) || 0;
    // Diperiksa di sini supaya pesannya enak dibaca. Database tetap punya
    // constraint yang sama sebagai jaring terakhir.
    if (maks < 1) return setError("Batas maksimal pajang harus lebih dari 0 hari.");
    if (per < 0 || per > maks) return setError(`Peringatan H−${per} tidak masuk akal untuk batas ${maks} hari.`);
    if (bu + bk === 0) return setError("Bobot umur dan kondisi tidak boleh dua-duanya nol.");
    const { error: err } = await supabase.from("display_standar").update({
      maks_hari_pajang: maks, peringatan_sebelum_hari: per, bobot_umur: bu, bobot_kondisi: bk,
    }).eq("id", 1);
    if (err) return setError("Gagal menyimpan: " + err.message);
    kabar("Standar tersimpan — berlaku untuk audit berikutnya.");
    muat();
  }

  async function simpanOpsi(baris, patch) {
    setError(null);
    const tabel = baris.jenis === "kondisi" ? "display_kondisi_opsi" : "display_perlakuan";
    const { error: err } = await supabase.from(tabel).update(patch).eq("kode", baris.kode);
    if (err) return setError("Gagal menyimpan: " + err.message);
    kabar("Tersimpan.");
    muat();
  }

  async function hapusOpsi(baris) {
    if (baris.dipakai > 0) return; // tombolnya memang tidak ditampilkan
    if (!window.confirm(`Hapus "${baris.label}" dari daftar? Belum pernah dipakai, jadi aman.`)) return;
    const tabel = baris.jenis === "kondisi" ? "display_kondisi_opsi" : "display_perlakuan";
    const { error: err } = await supabase.from(tabel).delete().eq("kode", baris.kode);
    if (err) return setError("Gagal menghapus: " + err.message);
    kabar("Dihapus.");
    muat();
  }

  async function ubahAkses(pemilikId, aktif) {
    setError(null);
    const ada = akses.find((a) => a.pemilik_id === pemilikId && a.penerima_id === penerima);
    const res = ada
      ? await supabase.from("akses_auditor").update({ aktif }).eq("pemilik_id", pemilikId).eq("penerima_id", penerima)
      : await supabase.from("akses_auditor").insert({
          pemilik_id: pemilikId, penerima_id: penerima, aktif,
          catatan: "Diberikan dari Master Data", diberikan_oleh: profile.id,
        });
    if (res.error) return setError("Gagal mengubah akses: " + res.error.message);
    kabar(aktif ? "Akses diberikan." : "Akses dicabut.");
    muat();
  }

  const [penerima, setPenerima] = useState("");

  if (loading) return <Bungkus><div style={{ color: "var(--text-faint)" }}>Memuat…</div></Bungkus>;

  if (!bolehUbah) {
    return (
      <Bungkus>
        <div style={{ background: "var(--danger-bg)", border: "1px solid rgba(239,68,68,0.35)", color: "var(--danger-text)", padding: "14px 18px", borderRadius: 12, fontSize: 13.5 }}>
          {profile?.liatSebagai
            ? "Master Data tidak bisa diubah saat sedang melihat akun orang lain. Kembalikan ke akun sendiri dulu."
            : "Menu ini khusus Super Admin."}
        </div>
      </Bungkus>
    );
  }

  const kondisi = opsi.filter((o) => o.jenis === "kondisi");
  const perlakuan = opsi.filter((o) => o.jenis === "perlakuan");
  const kandidat = akunSemua.filter((a) => a.id !== penerima);

  return (
    <Bungkus>
      <div style={{ marginBottom: 18 }}>
        <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>Master Data Display</div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 3 }}>
          Semua angka dan istilah yang dipakai modul Monitoring Display.
        </div>
      </div>

      {error && <Kotak nada="bahaya">{error}</Kotak>}
      {pesan && <Kotak nada="baik">{pesan}</Kotak>}

      <Kotak nada="ingat">
        <b>Perubahan di layar ini hanya berlaku untuk audit berikutnya.</b> Berita Acara yang
        sudah tersimpan tidak ikut berubah — skor dan batas umurnya dibekukan pada saat audit.
      </Kotak>

      {/* ── Standar umum ── */}
      <Seksi judul="⚙️ Standar Umum" aksi={<button className="btn" onClick={simpanStandar} style={{ fontSize: 12.5 }}>Simpan</button>}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 18 }}>
          <Kolom label="Batas maksimal pajang"
            ket="Lewat dari ini, unit ditandai merah dan dihitung di luar batas.">
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <input className="input" type="text" inputMode="numeric" value={standar.maks_hari_pajang}
                onChange={(e) => setStandar({ ...standar, maks_hari_pajang: e.target.value.replace(/[^\d]/g, "") })}
                style={{ width: 78, textAlign: "center", fontWeight: 700 }} />
              <span style={{ fontSize: 12.5, color: "var(--text-faint)" }}>hari</span>
            </div>
          </Kolom>

          <Kolom label="Mulai diingatkan"
            ket="Dihitung mundur dari batas, bukan angka mati — jadi ikut menyesuaikan untuk brand yang batasnya beda.">
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ fontSize: 12.5, color: "var(--text-faint)" }}>H−</span>
              <input className="input" type="text" inputMode="numeric" value={standar.peringatan_sebelum_hari}
                onChange={(e) => setStandar({ ...standar, peringatan_sebelum_hari: e.target.value.replace(/[^\d]/g, "") })}
                style={{ width: 68, textAlign: "center", fontWeight: 700 }} />
              <span style={{ fontSize: 12.5, color: "var(--text-faint)" }}>dari batas</span>
            </div>
          </Kolom>

          <Kolom label="Bobot skor display"
            ket={`Skor = (persen unit dalam batas × ${(standar.bobot_umur / 100).toFixed(2)}) + (rata-rata kondisi × ${(standar.bobot_kondisi / 100).toFixed(2)}).`}>
            <BobotBar standar={standar} onChange={setStandar} />
          </Kolom>
        </div>
      </Seksi>

      {/* ── Batas per brand ── */}
      <Seksi judul="🏷️ Batas Khusus per Brand"
        aksi={<TambahBrand onSelesai={muat} onGagal={setError} />}>
        {brand.length === 0 ? (
          <Hampa>Belum ada. Semua brand mengikuti standar umum {standar.maks_hari_pajang} hari.</Hampa>
        ) : (
          <Tabel kepala={["Brand", "Batas", "Catatan", ""]} rata={["", "ka", "", "ka"]}>
            {brand.map((b) => (
              <tr key={b.brand}>
                <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{b.brand}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{b.maks_hari_pajang} hari</td>
                <td style={{ color: "var(--text-faint)", fontSize: 12 }}>{b.catatan || "—"}</td>
                <td style={{ textAlign: "right" }}>
                  <Mini nada="bahaya" onClick={async () => {
                    if (!window.confirm(`Hapus batas khusus ${b.brand}? Brand ini akan ikut standar umum lagi.`)) return;
                    const { error: e } = await supabase.from("display_standar_brand").delete().eq("brand", b.brand);
                    if (e) setError(e.message); else { kabar("Dihapus."); muat(); }
                  }}>Hapus</Mini>
                </td>
              </tr>
            ))}
          </Tabel>
        )}
      </Seksi>

      {/* ── Skala kondisi ── */}
      <Seksi judul="🩺 Skala Kondisi Fisik">
        <Tabel kepala={["Istilah", "Nilai", "Urutan", "Dipakai", "Asal", ""]} rata={["", "ka", "ka", "ka", "", "ka"]}>
          {kondisi.map((o) => <BarisOpsi key={o.kode} o={o} adaSkor onSimpan={simpanOpsi} onHapus={hapusOpsi} />)}
        </Tabel>
        <Catatan>
          Kolom <b>Dipakai</b> yang menentukan boleh-tidaknya sebuah istilah dihapus. Yang sudah
          menempel di baris audit hanya bisa <b>dinonaktifkan</b> — hilang dari dropdown, riwayat tetap utuh.
        </Catatan>
      </Seksi>

      {/* ── Perlakuan ── */}
      <Seksi judul="📤 Perlakuan Pasca Display">
        <Tabel kepala={["Istilah", "Urutan", "Dipakai", "Asal", ""]} rata={["", "ka", "ka", "", "ka"]}>
          {perlakuan.map((o) => <BarisOpsi key={o.kode} o={o} onSimpan={simpanOpsi} onHapus={hapusOpsi} />)}
        </Tabel>
      </Seksi>

      {/* ── Akses antar auditor ── */}
      <Seksi judul="🔑 Akses Antar Auditor">
        <Catatan>
          Akses yang diberikan di sini hanya <b>hak baca</b>. Penerima bisa melihat data
          pemiliknya lewat tombol pindah akun, tapi tidak bisa mengisi, mengubah, atau menghapus —
          apa pun yang disimpan tetap tercatat atas namanya sendiri.
        </Catatan>
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0" }}>
          <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>Atur akses untuk</span>
          <select className="input" value={penerima} onChange={(e) => setPenerima(e.target.value)} style={{ fontSize: 12.5, maxWidth: 260 }}>
            <option value="">— pilih orangnya —</option>
            {akunSemua.map((a) => <option key={a.id} value={a.id}>{a.full_name} ({a.role})</option>)}
          </select>
        </div>
        {!penerima ? (
          <Hampa>Pilih satu orang untuk melihat dan mengatur data siapa saja yang boleh dia buka.</Hampa>
        ) : (
          <Tabel kepala={["Boleh membuka data milik", "Peran", "Status", ""]} rata={["", "", "", "ka"]}>
            {kandidat.map((a) => {
              const row = akses.find((x) => x.pemilik_id === a.id && x.penerima_id === penerima);
              const aktif = !!(row && row.aktif);
              return (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{a.full_name}</td>
                  <td style={{ color: "var(--text-faint)", fontSize: 12 }}>{a.role}</td>
                  <td>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 20,
                      background: aktif ? "#1a9e6e22" : "var(--surface-alt)", color: aktif ? "#1a9e6e" : "var(--text-faint)" }}>
                      {aktif ? "Diizinkan" : "Tidak"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <Mini nada={aktif ? "bahaya" : "utama"} onClick={() => ubahAkses(a.id, !aktif)}>
                      {aktif ? "Cabut" : "Beri akses"}
                    </Mini>
                  </td>
                </tr>
              );
            })}
          </Tabel>
        )}
      </Seksi>
    </Bungkus>
  );
}

// ── Potongan tampilan ──────────────────────────────────────────────────

function Bungkus({ children }) {
  return <div style={{ flex: 1, padding: "24px 28px", maxWidth: 1100 }}>{children}</div>;
}

function Kotak({ nada, children }) {
  const gaya = {
    bahaya: { bg: "var(--danger-bg)", br: "rgba(239,68,68,0.35)", fg: "var(--danger-text)" },
    baik: { bg: "rgba(26,158,110,0.12)", br: "rgba(26,158,110,0.35)", fg: "#1a9e6e" },
    ingat: { bg: "rgba(244,183,64,0.12)", br: "rgba(244,183,64,0.45)", fg: "var(--text-secondary)" },
  }[nada];
  return (
    <div style={{ background: gaya.bg, border: `1px solid ${gaya.br}`, color: gaya.fg,
      padding: "11px 15px", borderRadius: 10, fontSize: 13, marginBottom: 14, lineHeight: 1.55 }}>
      {children}
    </div>
  );
}

function Seksi({ judul, aksi, children }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{judul}</div>
        {aksi}
      </div>
      {children}
    </div>
  );
}

function Kolom({ label, ket, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)" }}>{label}</div>
      {children}
      <div style={{ fontSize: 11, color: "var(--text-faint)", lineHeight: 1.5 }}>{ket}</div>
    </div>
  );
}

function BobotBar({ standar, onChange }) {
  const bu = parseInt(standar.bobot_umur, 10) || 0;
  const bk = parseInt(standar.bobot_kondisi, 10) || 0;
  const total = bu + bk || 1;
  return (
    <div>
      <div style={{ display: "flex", height: 34, borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
        <div style={{ flex: bu, background: "#2A1F52", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 700 }}>
          Umur {Math.round((bu / total) * 100)}%
        </div>
        <div style={{ flex: bk, background: "#7c3aed", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 700 }}>
          Kondisi {Math.round((bk / total) * 100)}%
        </div>
      </div>
      <input type="range" min="0" max="100" step="5" value={bu}
        onChange={(e) => onChange({ ...standar, bobot_umur: +e.target.value, bobot_kondisi: 100 - +e.target.value })}
        style={{ width: "100%", marginTop: 8 }} />
    </div>
  );
}

function Tabel({ kepala, rata, children }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 560 }}>
        <thead>
          <tr>
            {kepala.map((h, i) => (
              <th key={i} style={{ textAlign: rata[i] === "ka" ? "right" : "left", fontSize: 10.5, fontWeight: 700,
                letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-faint)",
                padding: "7px 10px", borderBottom: "1px solid var(--border)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Hampa({ children }) {
  return <div style={{ fontSize: 12.5, color: "var(--text-faint)", fontStyle: "italic" }}>{children}</div>;
}

function Catatan({ children }) {
  return <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 10, lineHeight: 1.55 }}>{children}</div>;
}

function Mini({ nada, onClick, children }) {
  const gaya = nada === "utama"
    ? { background: "#7c3aed", borderColor: "#7c3aed", color: "#fff" }
    : nada === "bahaya"
    ? { background: "transparent", borderColor: "rgba(163,32,32,0.4)", color: "var(--danger-text)" }
    : { background: "transparent", borderColor: "var(--border)", color: "var(--text-secondary)" };
  return (
    <button type="button" onClick={onClick}
      style={{ ...gaya, borderWidth: 1, borderStyle: "solid", fontSize: 11, fontWeight: 600,
        padding: "4px 10px", borderRadius: 6, cursor: "pointer", marginLeft: 5, whiteSpace: "nowrap" }}>
      {children}
    </button>
  );
}

function BarisOpsi({ o, adaSkor, onSimpan, onHapus }) {
  const [ubah, setUbah] = useState(false);
  const [draf, setDraf] = useState({ label: o.label, skor: o.skor, urutan: o.urutan });

  const selTengah = { padding: "9px 10px", borderBottom: "1px solid var(--border)", textAlign: "right", fontVariantNumeric: "tabular-nums" };
  const selKiri = { padding: "9px 10px", borderBottom: "1px solid var(--border)" };

  if (ubah) {
    return (
      <tr style={{ background: "var(--surface-alt)" }}>
        <td style={selKiri}>
          <input className="input" value={draf.label} onChange={(e) => setDraf({ ...draf, label: e.target.value })} style={{ fontSize: 12.5, width: "100%" }} />
        </td>
        {adaSkor && (
          <td style={selTengah}>
            <input className="input" value={draf.skor} onChange={(e) => setDraf({ ...draf, skor: e.target.value.replace(/[^\d]/g, "") })}
              style={{ fontSize: 12.5, width: 62, textAlign: "center" }} />
          </td>
        )}
        <td style={selTengah}>
          <input className="input" value={draf.urutan} onChange={(e) => setDraf({ ...draf, urutan: e.target.value.replace(/[^\d]/g, "") })}
            style={{ fontSize: 12.5, width: 56, textAlign: "center" }} />
        </td>
        <td style={selTengah} />
        <td style={selKiri} />
        <td style={{ ...selTengah }}>
          <Mini nada="utama" onClick={() => {
            const patch = { label: draf.label.trim(), urutan: parseInt(draf.urutan, 10) || 0 };
            if (adaSkor) patch.skor = Math.min(100, Math.max(0, parseInt(draf.skor, 10) || 0));
            onSimpan(o, patch); setUbah(false);
          }}>Simpan</Mini>
          <Mini onClick={() => { setDraf({ label: o.label, skor: o.skor, urutan: o.urutan }); setUbah(false); }}>Batal</Mini>
        </td>
      </tr>
    );
  }

  return (
    <tr style={o.usulan ? { background: "rgba(124,58,237,0.08)" } : undefined}>
      <td style={{ ...selKiri, fontWeight: 600, color: o.aktif ? "var(--text-primary)" : "var(--text-faint)" }}>
        {o.label}
        {o.usulan && (
          <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase",
            padding: "2px 7px", borderRadius: 20, marginLeft: 7, background: "rgba(124,58,237,0.18)", color: "#7c3aed" }}>usulan</span>
        )}
        {!o.aktif && <span style={{ fontSize: 11, color: "var(--text-faint)", marginLeft: 7 }}>(nonaktif)</span>}
      </td>
      {adaSkor && <td style={selTengah}>{o.skor}</td>}
      <td style={selTengah}>{o.urutan}</td>
      <td style={{ ...selTengah, color: o.dipakai ? "var(--text-secondary)" : "var(--text-faint)" }}>{o.dipakai}×</td>
      <td style={{ ...selKiri, color: "var(--text-faint)", fontSize: 11.5 }}>
        {o.usulan ? `${o.diusulkan_oleh || "—"}` : "Bawaan"}
      </td>
      <td style={selTengah}>
        {o.usulan && <Mini nada="utama" onClick={() => onSimpan(o, { usulan: false })}>Jadikan resmi</Mini>}
        <Mini onClick={() => setUbah(true)}>Ubah</Mini>
        {/* Dipakai > 0 -> tidak ada tombol Hapus sama sekali. Menghapusnya
            akan memutus rujukan baris audit lama. */}
        {o.dipakai > 0
          ? <Mini nada="bahaya" onClick={() => onSimpan(o, { aktif: !o.aktif })}>{o.aktif ? "Nonaktifkan" : "Aktifkan"}</Mini>
          : <Mini nada="bahaya" onClick={() => onHapus(o)}>Hapus</Mini>}
      </td>
    </tr>
  );
}

function TambahBrand({ onSelesai, onGagal }) {
  const [buka, setBuka] = useState(false);
  const [f, setF] = useState({ brand: "", maks: "", catatan: "" });
  if (!buka) return <button className="btn-ghost" onClick={() => setBuka(true)} style={{ fontSize: 12 }}>+ Tambah Brand</button>;
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input className="input" placeholder="Brand" value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} style={{ fontSize: 12.5, width: 120 }} />
      <input className="input" placeholder="Hari" value={f.maks} onChange={(e) => setF({ ...f, maks: e.target.value.replace(/[^\d]/g, "") })} style={{ fontSize: 12.5, width: 66, textAlign: "center" }} />
      <input className="input" placeholder="Catatan" value={f.catatan} onChange={(e) => setF({ ...f, catatan: e.target.value })} style={{ fontSize: 12.5, width: 180 }} />
      <Mini nada="utama" onClick={async () => {
        if (!f.brand.trim() || !f.maks) return onGagal("Brand dan batas hari wajib diisi.");
        const { error } = await supabase.from("display_standar_brand").insert({
          brand: f.brand.trim(), maks_hari_pajang: parseInt(f.maks, 10), catatan: f.catatan.trim() || null,
        });
        if (error) return onGagal("Gagal menambah: " + error.message);
        setF({ brand: "", maks: "", catatan: "" }); setBuka(false); onSelesai();
      }}>Tambah</Mini>
      <Mini onClick={() => setBuka(false)}>Batal</Mini>
    </div>
  );
}
