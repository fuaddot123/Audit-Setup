import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";
import { useTheme } from "../lib/ThemeContext";

const MODULES = [
  { key: "keuangan", label: "Audit Keuangan", ready: true },
  { key: "timeline", label: "Timeline", ready: true },
  { key: "sop", label: "Audit SOP", ready: false },
  { key: "service", label: "Audit Service", ready: false },
  { key: "stok", label: "Audit Kesehatan Stok", ready: false },
  { key: "kpi", label: "KPI", ready: false },
];

export default function Sidebar({ active, onSelect, profile }) {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const roleLabel = { admin: "Admin", auditor: "Auditor", ceo: "CEO" }[profile?.role] || "\u2026";

  return (
    <div style={{ width: 240, flexShrink: 0, background: "var(--sidebar-bg)", minHeight: "100vh", padding: "22px 14px", display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 10px", marginBottom: 26 }}>
        <svg width="36" height="36" viewBox="0 0 64 64" style={{ flexShrink: 0 }}>
          <circle cx="32" cy="32" r="28.5" fill="#2A1F52" stroke="#F4B740" strokeWidth="5" />
          <path d="M27 18 L32 7 L37 18 Z" fill="#FFFFFF" />
          <rect x="26.5" y="18" width="11" height="24" rx="5.5" fill="#FFFFFF" />
          <path d="M26.5 36 L18 46 L26.5 43 Z" fill="#FFFFFF" />
          <path d="M37.5 36 L46 46 L37.5 43 Z" fill="#FFFFFF" />
          <circle cx="32" cy="25" r="3.2" fill="#2A1F52" />
          <path d="M28.5 41 L32 53 L35.5 41 Z" fill="#F4B740" />
        </svg>
        <div className="display" style={{ color: "var(--sidebar-text)", fontSize: 18, fontWeight: 600 }}>KLA Audit</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
        {MODULES.map((m) => {
          const isActive = active === m.key;
          return (
            <div
              key={m.key}
              onClick={() => onSelect(m.key)}
              style={{
                display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10,
                cursor: "pointer",
                background: isActive ? "var(--sidebar-active-bg)" : "transparent",
                borderLeft: isActive ? "3px solid #F4B740" : "3px solid transparent",
              }}
            >
              <span style={{ color: isActive ? "var(--sidebar-text)" : "var(--sidebar-text-muted)", fontSize: 14, fontWeight: 500, flex: 1 }}>{m.label}</span>
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
