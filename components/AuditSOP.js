import SopDashboard from "./sop/SopDashboard";
import SopAuditCabang from "./sop/SopAuditCabang";
import SopRanking from "./sop/SopRanking";
import SopLaporan from "./sop/SopLaporan";

export default function AuditSOP({ profile, sub }) {
  if (sub === "cabang") return <SopAuditCabang profile={profile} />;
  if (sub === "ranking") return <SopRanking profile={profile} />;
  if (sub === "laporan") return <SopLaporan profile={profile} />;
  return <SopDashboard profile={profile} />;
}
