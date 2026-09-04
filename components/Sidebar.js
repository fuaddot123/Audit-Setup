import { useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { supabase } from "../lib/supabaseClient";
import { useTheme } from "../lib/ThemeContext";
import RadarLogo from "./RadarLogo";
import AkunSwitcher from "./AkunSwitcher";

const MODULES = [
  { key: "dashboard_audit", label: "Dashboard Audit", ready: true },
  { key: "keuangan", label: "Audit Keuangan", ready: true },
  {
    key: "sop", label: "Audit SOP", ready: true, subs: [
      { key: "cabang", label: "Audit Cabang" },
      { key: "ranking", label: "Ranking Cabang" },
      { key: "kepatuhan", label: "Kepatuhan SOP" },
      { key: "laporan", label: "Laporan Audit" },
    ],
  },
  {
    key: "stok", label: "Audit Stok", ready: true, subs: [
      { key: "service", label: "Service Ratio" },
      { key: "kesehatan", label: "Kesehatan Stok" },
      { key: "laporan", label: "Laporan Audit Stok" },
    ],
  },
  { key: "berita_acara", label: "Berita Acara", ready: true },
  { key: "kpi", label: "KPI", ready: true },
  { key: "biaya_dinas", label: "Biaya Dinas", ready: true },
  { key: "laporan_bulanan", label: "Laporan Bulanan", ready: true },
  { key: "laporan_tahunan", label: "Laporan Tahunan", ready: true },
  { key: "timeline", label: "Timeline", ready: true },
  // Hanya muncul untuk Super Admin — lihat penyaringan di bawah.
  { key: "master", label: "Master Data", ready: true, hanyaSuperAdmin: true },
];

function ChevronIcon({ open }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s", flexShrink: 0 }}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

// Tiap menu/submenu sekarang punya alamat URL beneran (bukan cuma state React) — biar
// klik-kanan "Open link in new tab" / "Copy link address" jalan normal kayak link web pada
// umumnya, dan refresh halaman tetap di menu yang lagi dibuka.
function hrefFor(m) {
  return m.subs ? `/dashboard?m=${m.key}&sub=${m.subs[0].key}` : `/dashboard?m=${m.key}`;
}
function hrefForSub(m, s) {
  return `/dashboard?m=${m.key}&sub=${s.key}`;
}

export default function Sidebar({ active, activeSub, onSelect, profile, profileAsli, liatSebagai, onGantiAkun }) {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const [expanded, setExpanded] = useState({ [active]: true });

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  function clickModule(m) {
    // Cuma dipanggil buat modul yang punya submenu (Link-nya di-preventDefault) — toggle
    // buka/tutup daftar submenu; kalau modulnya belum aktif, sekalian arahin ke sub pertama.
    const willOpen = !expanded[m.key];
    setExpanded((p) => ({ ...p, [m.key]: willOpen }));
    if (active !== m.key) onSelect(m.key, m.subs[0].key);
  }

  const roleLabel = { super_admin: "Super Admin", auditor: "Auditor", ceo: "CEO", viewer: "Viewer" }[(profileAsli || profile)?.role] || "\u2026";

  return (
    <div style={{ width: 240, flexShrink: 0, background: "var(--sidebar-bg)", height: "100vh", position: "sticky", top: 0, alignSelf: "flex-start", padding: "22px 14px", display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)", overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 10px 18px", marginBottom: 12, borderBottom: "1px solid var(--sidebar-border)" }}>
        <RadarLogo size={36} />
        <div className="display" style={{ color: "var(--sidebar-text)", fontSize: 18, fontWeight: 600 }}>KLA Radar</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, overflowY: "auto" }}>
        {MODULES.filter((m) => !m.hanyaSuperAdmin || profileAsli?.role === "super_admin").map((m) => {
          const isActive = active === m.key;
          const isOpen = !!expanded[m.key];
          return (
            <div key={m.key}>
              <Link
                href={hrefFor(m)}
                onClick={(e) => {
                  // Modul yang punya submenu: klik cuma buka/tutup daftar submenu-nya doang
                  // (kalau udah aktif) — bukan pindah halaman tiap kali diklik ulang.
                  if (m.subs) {
                    e.preventDefault();
                    clickModule(m);
                  }
                }}
                onMouseEnter={(e) => { if (!(isActive && !m.subs)) e.currentTarget.style.background = "var(--sidebar-hover-bg, rgba(255,255,255,0.04))"; }}
                onMouseLeave={(e) => { if (!(isActive && !m.subs)) e.currentTarget.style.background = "transparent"; }}
                style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 12,
                  cursor: "pointer", transition: "background .12s", textDecoration: "none",
                  background: isActive && !m.subs ? "linear-gradient(90deg, rgba(244,183,64,0.14), rgba(244,183,64,0.02))" : "transparent",
                  boxShadow: isActive && !m.subs ? "inset 3px 0 0 0 #F4B740" : "inset 3px 0 0 0 transparent",
                }}
              >
                <span style={{ color: isActive ? "var(--sidebar-text)" : "var(--sidebar-text-muted)", fontSize: 14, fontWeight: 500, flex: 1 }}>{m.label}</span>
                {m.subs && <ChevronIcon open={isOpen} />}
              </Link>

              {m.subs && isOpen && (
                <div style={{ display: "flex", flexDirection: "column", gap: 2, margin: "2px 0 4px", paddingLeft: 14 }}>
                  {m.subs.map((s) => {
                    const subActive = isActive && activeSub === s.key;
                    return (
                      <Link
                        key={s.key}
                        href={hrefForSub(m, s)}
                        onClick={() => setExpanded((p) => ({ ...p, [m.key]: true }))}
                        style={{
                          display: "flex", alignItems: "center", padding: "9px 14px", borderRadius: 10,
                          cursor: "pointer", textDecoration: "none",
                          background: subActive ? "linear-gradient(90deg, rgba(244,183,64,0.14), rgba(244,183,64,0.02))" : "transparent",
                          boxShadow: subActive ? "inset 3px 0 0 0 #F4B740" : "inset 3px 0 0 0 transparent",
                        }}
                      >
                        <span style={{ color: subActive ? "var(--sidebar-text)" : "var(--sidebar-text-muted)", fontSize: 13, fontWeight: subActive ? 600 : 400 }}>{s.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <AkunSwitcher profileAsli={profileAsli || profile} liatSebagai={liatSebagai} onGanti={onGantiAkun} />
      <div style={{ borderTop: "1px solid var(--sidebar-border)", paddingTop: 14, marginTop: 14 }}>
        <div style={{ color: "var(--sidebar-text)", fontSize: 13, fontWeight: 500 }}>{(profileAsli || profile)?.full_name || "\u2026"}</div>
        <div style={{ color: "var(--sidebar-text-muted)", fontSize: 11.5, marginBottom: 10 }}>Peran: {roleLabel}</div>
        <button className="btn-ghost" onClick={toggleTheme} style={{ width: "100%", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--sidebar-text-muted)", borderColor: "var(--sidebar-border)" }}>
          {theme === "dark" ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
              Mode Terang
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
              Mode Gelap
            </>
          )}
        </button>
        <button className="btn-ghost" onClick={handleLogout} style={{ width: "100%", color: "var(--sidebar-text-muted)", borderColor: "var(--sidebar-border)" }}>
          Keluar
        </button>
      </div>
    </div>
  );
}

export { MODULES };
