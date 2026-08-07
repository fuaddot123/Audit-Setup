import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";
import Sidebar from "../components/Sidebar";
import RadarLogo from "../components/RadarLogo";
import AuditKeuangan from "../components/AuditKeuangan";
import Timeline from "../components/Timeline";
import AuditSOP from "../components/AuditSOP";
import AuditStok from "../components/AuditStok";
import AuditKPI from "../components/AuditKPI";
import BeritaAcara from "../components/BeritaAcara";
import LaporanBulanan from "../components/LaporanBulanan";
import BiayaDinas from "../components/BiayaDinas";
import DashboardAudit from "../components/DashboardAudit";

export default function Dashboard() {
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Menu aktif sekarang ditarik dari URL (?m=...&sub=...), bukan state React doang — biar
  // tiap menu punya alamat beneran (klik-kanan "Open in new tab" / "Copy link address" jalan,
  // refresh halaman tetap di menu yang sama, dst).
  const active = typeof router.query.m === "string" ? router.query.m : "keuangan";
  const activeSub = typeof router.query.sub === "string" ? router.query.sub : null;

  function handleSelect(moduleKey, subKey) {
    const query = subKey ? { m: moduleKey, sub: subKey } : { m: moduleKey };
    router.push({ pathname: "/dashboard", query }, undefined, { shallow: true });
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

  if (loading || !profile || !router.isReady) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg-page)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, color: "var(--text-secondary)" }}>
        <RadarLogo size={64} />
        <div>Memuat\u2026</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar active={active} activeSub={activeSub} onSelect={handleSelect} profile={profile} />
      {active === "dashboard_audit" ? (
        <DashboardAudit profile={profile} />
      ) : active === "keuangan" ? (
        <AuditKeuangan profile={profile} />
      ) : active === "timeline" ? (
        <Timeline profile={profile} onSelect={handleSelect} />
      ) : active === "sop" ? (
        <AuditSOP profile={profile} sub={activeSub || "cabang"} />
      ) : active === "stok" ? (
        <AuditStok profile={profile} sub={activeSub || "service"} />
      ) : active === "kpi" ? (
        <AuditKPI profile={profile} />
      ) : active === "berita_acara" ? (
        <BeritaAcara profile={profile} />
      ) : active === "biaya_dinas" ? (
        <BiayaDinas profile={profile} />
      ) : active === "laporan_bulanan" ? (
        <LaporanBulanan profile={profile} />
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-faint)", flexDirection: "column" }}>
          <div className="display" style={{ fontSize: 19, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>Modul ini belum dibuat</div>
          <div style={{ fontSize: 13.5, maxWidth: 320, textAlign: "center" }}>Sama seperti Audit Keuangan, modul ini akan dibangun berikutnya dengan tabel dan alur yang sama.</div>
        </div>
      )}
    </div>
  );
}
