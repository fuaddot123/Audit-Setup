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
import LaporanTahunan from "../components/LaporanTahunan";
import BiayaDinas from "../components/BiayaDinas";
import DashboardAudit from "../components/DashboardAudit";
import MasterDisplay from "../components/MasterDisplay";

export default function Dashboard() {
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  // Akun yang sedang "dilihat" lewat tombol pindah akun. null = akun sendiri.
  const [liatSebagai, setLiatSebagai] = useState(null);
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

  // Profil yang dioper ke seluruh modul. Saat melihat akun orang lain,
  // id-nya ditukar supaya query menampilkan data orang itu, dan penanda
  // liatSebagai membuat setiap modul mengunci isiannya.
  //
  // roleAsli sengaja dibawa terpisah: gerbang "menu ini khusus Super Admin"
  // harus melihat peran SUNGGUHAN, bukan peran orang yang sedang dilihat.
  const profileEfektif = profile && liatSebagai
    ? { ...profile, id: liatSebagai.id, full_name: liatSebagai.full_name,
        role: liatSebagai.role || "auditor", roleAsli: profile.role, liatSebagai }
    : profile && { ...profile, roleAsli: profile.role, liatSebagai: null };

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
      <Sidebar active={active} activeSub={activeSub} onSelect={handleSelect}
        profile={profileEfektif} profileAsli={profile}
        liatSebagai={liatSebagai} onGantiAkun={setLiatSebagai} />
      {active === "dashboard_audit" ? (
        <DashboardAudit profile={profileEfektif} />
      ) : active === "keuangan" ? (
        <AuditKeuangan profile={profileEfektif} />
      ) : active === "timeline" ? (
        <Timeline profile={profileEfektif} onSelect={handleSelect} />
      ) : active === "sop" ? (
        <AuditSOP profile={profileEfektif} sub={activeSub || "cabang"} />
      ) : active === "stok" ? (
        <AuditStok profile={profileEfektif} sub={activeSub || "service"} />
      ) : active === "kpi" ? (
        <AuditKPI profile={profileEfektif} />
      ) : active === "berita_acara" ? (
        <BeritaAcara profile={profileEfektif} />
      ) : active === "biaya_dinas" ? (
        <BiayaDinas profile={profileEfektif} />
      ) : active === "master" ? (
        <MasterDisplay profile={profileEfektif} />
      ) : active === "laporan_bulanan" ? (
        <LaporanBulanan profile={profileEfektif} />
      ) : active === "laporan_tahunan" ? (
        <LaporanTahunan profile={profileEfektif} />
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-faint)", flexDirection: "column" }}>
          <div className="display" style={{ fontSize: 19, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>Modul ini belum dibuat</div>
          <div style={{ fontSize: 13.5, maxWidth: 320, textAlign: "center" }}>Sama seperti Audit Keuangan, modul ini akan dibangun berikutnya dengan tabel dan alur yang sama.</div>
        </div>
      )}
    </div>
  );
}
