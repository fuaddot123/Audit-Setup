import { useState } from "react";
import SopDashboard from "./sop/SopDashboard";
import SopAuditCabang from "./sop/SopAuditCabang";
import SopRanking from "./sop/SopRanking";
import SopLaporan from "./sop/SopLaporan";

const SUB_MENU = [
  { key: "dashboard", label: "Dashboard Audit", icon: "grid" },
  { key: "cabang", label: "Audit Cabang", icon: "check" },
  { key: "ranking", label: "Ranking Cabang", icon: "trophy" },
  { key: "laporan", label: "Laporan Audit", icon: "doc" },
];

function SubIcon({ name }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };
  if (name === "grid") return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>;
  if (name === "check") return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M8 12l3 3 5-6" /></svg>;
  if (name === "trophy") return <svg {...common}><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z" /><path d="M7 5H4a3 3 0 0 0 3 5M17 5h3a3 3 0 0 1-3 5" /></svg>;
  if (name === "doc") return <svg {...common}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>;
  return null;
}

export default function AuditSOP({ profile }) {
  const [sub, setSub] = useState("dashboard");

  return (
    <div style={{ display: "flex", flex: 1, minHeight: "100vh" }}>
      {/* Sub-sidebar OPERASIONAL, mengikuti referensi desain */}
      <div style={{ width: 208, flexShrink: 0, background: "var(--sidebar-bg)", borderRight: "1px solid var(--sidebar-border)", padding: "20px 12px" }}>
        <div style={{ color: "var(--sidebar-text-muted)", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", padding: "0 10px", marginBottom: 10 }}>
          OPERASIONAL
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {SUB_MENU.map((m) => {
            const isActive = sub === m.key;
            return (
              <div
                key={m.key}
                onClick={() => setSub(m.key)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", borderRadius: 10,
                  cursor: "pointer",
                  background: isActive ? "var(--sidebar-active-bg)" : "transparent",
                  color: isActive ? "var(--sidebar-text)" : "var(--sidebar-text-muted)",
                  fontSize: 13.5, fontWeight: isActive ? 600 : 500,
                }}
              >
                <SubIcon name={m.icon} />
                {m.label}
              </div>
            );
          })}
        </div>
      </div>

      {/* Konten sub-halaman */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {sub === "dashboard" && <SopDashboard profile={profile} />}
        {sub === "cabang" && <SopAuditCabang profile={profile} />}
        {sub === "ranking" && <SopRanking profile={profile} />}
        {sub === "laporan" && <SopLaporan profile={profile} />}
      </div>
    </div>
  );
}

function PlaceholderPage({ title, desc }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-faint)", flexDirection: "column", minHeight: "100vh", padding: 24 }}>
      <div className="display" style={{ fontSize: 19, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13.5, maxWidth: 340, textAlign: "center" }}>{desc}</div>
    </div>
  );
}
