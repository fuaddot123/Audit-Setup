import StokServiceRatio from "./stok/StokServiceRatio";
import StokKesehatan from "./stok/StokKesehatan";
import StokLaporan from "./stok/StokLaporan";

export default function AuditStok({ profile, sub }) {
  if (sub === "kesehatan") return <StokKesehatan profile={profile} />;
  if (sub === "laporan") return <StokLaporan profile={profile} />;
  return <StokServiceRatio profile={profile} />;
}
