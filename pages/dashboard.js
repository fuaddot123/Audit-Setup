import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";
import Sidebar from "../components/Sidebar";
import AuditKeuangan from "../components/AuditKeuangan";
import Timeline from "../components/Timeline";
import AuditSOP from "../components/AuditSOP";

export default function Dashboard() {
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [active, setActive] = useState("keuangan");
  const [activeSub, setActiveSub] = useState(null);
  const [loading, setLoading] = useState(true);

  function handleSelect(moduleKey, subKey) {
    setActive(moduleKey);
    setActiveSub(subKey || null);
  }

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      const { data: prof, error } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
      if (error) { console.error(error); }
      setProfile(prof || { id: session.user.id, full_name: session.user.email, role: "auditor" });
      setLoading(false);
    })();
  }, [router]);

  if (loading || !profile) {
    return <div style={{ minHeight: "100vh", background: "var(--bg-page)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}>Memuat\u2026</div>;
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar active={active} activeSub={activeSub} onSelect={handleSelect} profile={profile} />
      {active === "keuangan" ? (
        <AuditKeuangan profile={profile} />
      ) : active === "timeline" ? (
        <Timeline />
      ) : active === "sop" ? (
        <AuditSOP profile={profile} sub={activeSub || "dashboard"} />
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-faint)", flexDirection: "column" }}>
          <div className="display" style={{ fontSize: 19, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>Modul ini belum dibuat</div>
          <div style={{ fontSize: 13.5, maxWidth: 320, textAlign: "center" }}>Sama seperti Audit Keuangan, modul ini akan dibangun berikutnya dengan tabel dan alur yang sama.</div>
        </div>
      )}
    </div>
  );
}
