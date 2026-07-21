import { useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";
import { useTheme } from "../lib/ThemeContext";
import RadarLogo from "./RadarLogo";

const MODULES = [
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
  { key: "inventaris", label: "Inventaris", ready: true },
  {
    key: "pengajuan", label: "Form Pengajuan", ready: false, subs: [
      { key: "adjust", label: "Barang Adjust" },
      { key: "inventaris", label: "Barang Inventaris" },
      { key: "hadiah", label: "Barang Hadiah Undian" },
    ],
  },
  { key: "kpi", label: "KPI", ready: true },
  { key: "laporan_bulanan", label: "Laporan Bulanan", ready: false },
  { key: "laporan_tahunan", label: "Laporan Tahunan", ready: false },
  { key: "timeline", label: "Timeline", ready: true },
];

function ChevronIcon({ open }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s", flexShrink: 0 }}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export default function Sidebar({ active, activeSub, onSelect, profile }) {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const [expanded, setExpanded] = useState({ [active]: true });

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  function clickModule(m) {
    if (m.subs) {
      const willOpen = !expanded[m.key];
      setExpanded((p) => ({ ...p, [m.key]: willOpen }));
      if (active !== m.key) onSelect(m.key, m.subs[0].key);
    } else {
      onSelect(m.key, null);
    }
  }

  function clickSub(m, s) {
    setExpanded((p) => ({ ...p, [m.key]: true }));
    onSelect(m.key, s.key);
  }

  const roleLabel = { super_admin: "Super Admin", auditor: "Auditor", ceo: "CEO", viewer: "Viewer" }[profile?.role] || "\u2026";

  return (
    <div style={{ width: 240, flexShrink: 0, background: "var(--sidebar-bg)", height: "100vh", position: "sticky", top: 0, alignSelf: "flex-start", padding: "22px 14px", display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)", overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 10px 18px", marginBottom: 12, borderBottom: "1px solid var(--sidebar-border)" }}>
        <RadarLogo size={36} />
        <div className="display" style={{ color: "var(--sidebar-text)", fontSize: 18, fontWeight: 600 }}>KLA Radar</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, overflowY: "auto" }}>
        {MODULES.map((m) => {
          const isActive = active === m.key;
          const isOpen = !!expanded[m.key];
          return (
            <div key={m.key}>
              <div
                onClick={() => clickModule(m)}
                onMouseEnter={(e) => { if (!(isActive && !m.subs)) e.currentTarget.style.background = "var(--sidebar-hover-bg, rgba(255,255,255,0.04))"; }}
                onMouseLeave={(e) => { if (!(isActive && !m.subs)) e.currentTarget.style.background = "transparent"; }}
                style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 12,
                  cursor: "pointer", transition: "background .12s",
                  background: isActive && !m.subs ? "linear-gradient(90deg, rgba(244,183,64,0.14), rgba(244,183,64,0.02))" : "transparent",
                  boxShadow: isActive && !m.subs ? "inset 3px 0 0 0 #F4B740" : "inset 3px 0 0 0 transparent",
                }}
              >
                <span style={{ color: isActive ? "var(--sidebar-text)" : "var(--sidebar-text-muted)", fontSize: 14, fontWeight: 500, flex: 1 }}>{m.label}</span>
                {m.subs && <ChevronIcon open={isOpen} />}
              </div>

              {m.subs && isOpen && (
                <div style={{ display: "flex", flexDirection: "column", gap: 2, margin: "2px 0 4px", paddingLeft: 14 }}>
                  {m.subs.map((s) => {
                    const subActive = isActive && activeSub === s.key;
                    return (
                      <div
                        key={s.key}
                        onClick={() => clickSub(m, s)}
                        style={{
                          display: "flex", alignItems: "center", padding: "9px 14px", borderRadius: 10,
                          cursor: "pointer",
                          background: subActive ? "linear-gradient(90deg, rgba(244,183,64,0.14), rgba(244,183,64,0.02))" : "transparent",
                          boxShadow: subActive ? "inset 3px 0 0 0 #F4B740" : "inset 3px 0 0 0 transparent",
                        }}
                      >
                        <span style={{ color: subActive ? "var(--sidebar-text)" : "var(--sidebar-text-muted)", fontSize: 13, fontWeight: subActive ? 600 : 400 }}>{s.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ borderTop: "1px solid var(--sidebar-border)", paddingTop: 14, marginTop: 14 }}>
        <div style={{ color: "var(--sidebar-text)", fontSize: 13, fontWeight: 500 }}>{profile?.full_name || "\u2026"}</div>
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
