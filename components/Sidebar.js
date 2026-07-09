import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";

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

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const roleLabel = { admin: "Admin", auditor: "Auditor", ceo: "CEO" }[profile?.role] || "…";

  return (
    <div style={{ width: 240, flexShrink: 0, background: "#3D1A63", minHeight: "100vh", padding: "22px 14px", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 10px", marginBottom: 26 }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: "rgba(255,255,255,0.15)" }} />
        <div className="display" style={{ color: "#fff", fontSize: 18, fontWeight: 600 }}>KLA Audit</div>
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
                cursor: "pointer", background: isActive ? "rgba(255,255,255,0.16)" : "transparent",
              }}
            >
              <span style={{ color: "#fff", fontSize: 14, fontWeight: 500, flex: 1 }}>{m.label}</span>
            </div>
          );
        })}
      </div>
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.15)", paddingTop: 14, marginTop: 14 }}>
        <div style={{ color: "#fff", fontSize: 13, fontWeight: 500 }}>{profile?.full_name || "…"}</div>
        <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 11.5, marginBottom: 10 }}>Peran: {roleLabel}</div>
        <button className="btn-ghost" onClick={handleLogout} style={{ width: "100%", background: "rgba(255,255,255,0.08)", color: "#fff", borderColor: "rgba(255,255,255,0.2)" }}>
          Keluar
        </button>
      </div>
    </div>
  );
}

export { MODULES };