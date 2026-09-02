// components/AkunSwitcher.js
// ============================================================
// Tombol pindah akun — muncul di sidebar hanya kalau pengguna memang punya
// akses ke data orang lain (diberikan Super Admin lewat Master Data).
//
// YANG PERLU DIINGAT SOAL TOMBOL INI:
//
// Ini "lihat sebagai", BUKAN "masuk sebagai". Saat akun lain dipilih,
// seluruh aplikasi jadi terkunci — tidak ada tombol simpan, tidak ada isian
// yang bisa diubah. Sengaja begitu: kalau Kristianto bisa mengisi atas nama
// Yuni, Berita Acara akan bertanda tangan "Yuni" padahal dikerjakan orang
// lain, dan aplikasi audit kehilangan justru barang yang dijualnya.
//
// Pagarnya tidak cuma di sini. RLS di database mensyaratkan
// submitted_by = auth.uid() untuk setiap penyimpanan, jadi walaupun tombol
// ini dibongkar dari peramban, tidak ada jalan menulis atas nama orang lain.
// ============================================================

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

export default function AkunSwitcher({ profileAsli, liatSebagai, onGanti }) {
  const [akun, setAkun] = useState([]);
  const [buka, setBuka] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("v_akun_bisa_dilihat").select("*");
      // Galat di sini tidak ditampilkan sebagai peringatan besar: kalau
      // schema-akses.sql belum dijalankan, tombolnya cukup tidak muncul.
      if (error) { setAkun([]); return; }
      setAkun(data || []);
    })();
  }, [profileAsli?.id]);

  // Cuma dirinya sendiri yang bisa dilihat -> tombol ini tidak ada gunanya.
  if (akun.length <= 1) return null;

  const sedang = liatSebagai || { id: profileAsli.id, full_name: profileAsli.full_name };
  const lain = liatSebagai != null;

  return (
    <div style={{ position: "relative", padding: "0 14px 12px" }}>
      <button
        type="button"
        onClick={() => setBuka((b) => !b)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 9, cursor: "pointer",
          background: lain ? "rgba(244,183,64,0.14)" : "var(--surface-alt)",
          border: `1px solid ${lain ? "rgba(244,183,64,0.55)" : "var(--border)"}`,
          borderRadius: 10, padding: "9px 11px", textAlign: "left",
        }}
      >
        <span style={{
          width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
          background: lain ? "#F4B740" : "#7c3aed", color: lain ? "#2A1F52" : "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 12, fontWeight: 800,
        }}>
          {(sedang.full_name || "?").trim().charAt(0).toUpperCase()}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 9.5, fontWeight: 800, letterSpacing: ".08em",
            textTransform: "uppercase", color: lain ? "#F4B740" : "var(--text-faint)" }}>
            {lain ? "Melihat sebagai" : "Akun saya"}
          </span>
          <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {sedang.full_name}
          </span>
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-faint)", flexShrink: 0,
            transform: buka ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {lain && (
        <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 6, lineHeight: 1.45 }}>
          Mode lihat saja — isian terkunci.
        </div>
      )}

      {buka && (
        <div style={{
          position: "absolute", left: 14, right: 14, bottom: "calc(100% - 6px)", zIndex: 30,
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
          boxShadow: "0 8px 26px rgba(0,0,0,.28)", overflow: "hidden",
        }}>
          {akun.map((a) => {
            const aktif = a.id === sedang.id;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => { onGanti(a.diri_sendiri ? null : a); setBuka(false); }}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                  background: aktif ? "var(--surface-alt)" : "transparent", border: "none",
                  padding: "9px 12px", textAlign: "left",
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                  background: aktif ? "#7c3aed" : "transparent" }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: aktif ? 700 : 500,
                    color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {a.full_name}
                  </span>
                  <span style={{ display: "block", fontSize: 10.5, color: "var(--text-faint)" }}>
                    {a.diri_sendiri ? "akun saya" : "lihat saja"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
