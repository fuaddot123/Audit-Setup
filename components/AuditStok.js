import StokDashboard from "./stok/StokDashboard";
import StokServiceRatio from "./stok/StokServiceRatio";
import StokKesehatan from "./stok/StokKesehatan";
import StokLaporan from "./stok/StokLaporan";

export default function AuditStok({ profile, sub }) {
  if (sub === "service") return <StokServiceRatio profile={profile} />;
  if (sub === "kesehatan") return <StokKesehatan profile={profile} />;
  if (sub === "laporan") return <StokLaporan profile={profile} />;
  return <StokDashboard profile={profile} />;
}

function PlaceholderPage({ title, desc }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-faint)", flexDirection: "column", minHeight: "100vh", padding: 24 }}>
      <div className="display" style={{ fontSize: 19, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13.5, maxWidth: 340, textAlign: "center" }}>{desc}</div>
    </div>
  );
}
