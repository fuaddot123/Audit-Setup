import SopAuditCabang from "./sop/SopAuditCabang";
import SopRanking from "./sop/SopRanking";
import SopLaporan from "./sop/SopLaporan";

export default function AuditSOP({ profile, sub }) {
  if (sub === "ranking") return <SopRanking profile={profile} />;
  if (sub === "laporan") return <SopLaporan profile={profile} />;
  return <SopAuditCabang profile={profile} />;
}
