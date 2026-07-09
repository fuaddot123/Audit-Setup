import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";
import Sidebar from "../components/Sidebar";
import AuditKeuangan from "../components/AuditKeuangan";

export default function Dashboard() {
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [active, setActive] = useState("keuangan");
  const [loading, setLoading] = useState(true);

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
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#8B909C" }}>Memuat…</div>;
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar active={active} onSelect={setActive} profile={profile} />
      {active === "keuangan" ? (
        <AuditKeuangan profile={profile} />
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#9AA0AC", flexDirection: "column" }}>
          <div className="display" style={{ fontSize: 19, fontWeight: 600, color: "#5B6270", marginBottom: 6 }}>Modul ini belum dibuat</div>
          <div style={{ fontSize: 13.5, maxWidth: 320, textAlign: "center" }}>Sama seperti Audit Keuangan, modul ini akan dibangun berikutnya dengan tabel dan alur yang sama.</div>
        </div>
      )}
    </div>
  );
}
