import SopAuditCabang from "./sop/SopAuditCabang";
import SopRanking from "./sop/SopRanking";
import SopKepatuhan from "./sop/SopKepatuhan";
import SopLaporan from "./sop/SopLaporan";

export default function AuditSOP({ profile, sub }) {
  if (sub === "ranking") return <SopRanking profile={profile} />;
  if (sub === "kepatuhan") return <SopKepatuhan profile={profile} />;
  if (sub === "laporan") return <SopLaporan profile={profile} />;
  return <SopAuditCabang profile={profile} />;
}
