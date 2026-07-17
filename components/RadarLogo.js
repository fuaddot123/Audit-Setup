// Logo radar animasi KLA — sapuan berputar + titik blip berkedip.
// Dipakai di Sidebar, halaman loading, dan halaman login.
export default function RadarLogo({ size = 40, label }) {
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: label ? 10 : 0 }}>
      <svg width={size} height={size} viewBox="0 0 64 64" style={{ flexShrink: 0 }}>
        <defs>
          <radialGradient id="klaRadarBg" cx="30%" cy="24%" r="75%">
            <stop offset="0%" stopColor="#4b3a68" />
            <stop offset="72%" stopColor="#1c1730" />
          </radialGradient>
          <radialGradient id="klaRadarBackdrop" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#4b3a68" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#4b3a68" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="klaRadarSweep" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#e0b04a" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#e0b04a" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="klaRadarBlip" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#f2d99a" />
            <stop offset="100%" stopColor="#e0b04a" />
          </radialGradient>
          <clipPath id="klaRadarClip">
            <circle cx="32" cy="32" r="24" />
          </clipPath>
        </defs>

        <rect x="1.2" y="1.2" width="61.6" height="61.6" rx="14.6" fill="url(#klaRadarBg)" />
        <rect x="1.2" y="1.2" width="61.6" height="61.6" rx="14.6" fill="none" stroke="#e0b04a" strokeWidth="1" opacity="0.5" />
        <circle cx="32" cy="32" r="24" fill="none" stroke="#e0b04a" strokeWidth="1.1" opacity="0.55" />
        <circle cx="32" cy="32" r="17.5" fill="none" stroke="#a06be0" strokeWidth="0.9" opacity="0.4" />
        <circle cx="32" cy="32" r="11" fill="none" stroke="#a06be0" strokeWidth="0.9" opacity="0.35" />
        <circle cx="32" cy="32" r="5" fill="none" stroke="#a06be0" strokeWidth="0.9" opacity="0.3" />
        <line x1="32" y1="8" x2="32" y2="56" stroke="#a06be0" strokeWidth="0.6" opacity="0.2" />
        <line x1="8" y1="32" x2="56" y2="32" stroke="#a06be0" strokeWidth="0.6" opacity="0.2" />

        <g clipPath="url(#klaRadarClip)">
          <path d="M32 32 L32 4 A28 28 0 0 1 51.8 12.2 Z" fill="url(#klaRadarSweep)" style={{ transformOrigin: "32px 32px", animation: "klaRadarSpin 3s linear infinite" }} />
        </g>

        <circle cx="38.2" cy="26.3" r="1.4" fill="url(#klaRadarBlip)" style={{ animation: "klaRadarBlip1 2.6s ease-in-out infinite" }} />
        <circle cx="24.3" cy="40.6" r="1" fill="#e0b04a" opacity="0.9" style={{ animation: "klaRadarBlip2 2.6s ease-in-out infinite 1.1s" }} />

        <circle cx="32" cy="32" r="11" fill="url(#klaRadarBackdrop)" />
        <text x="32" y="38.5" textAnchor="middle" fontFamily="'Helvetica Neue', Helvetica, Arial, sans-serif" fontWeight="800" fontSize="13.7" fill="#f2d99a" letterSpacing="-0.3">K</text>
      </svg>
      {label && <div className="display" style={{ color: "var(--sidebar-text, #fff)", fontSize: 15, fontWeight: 600 }}>{label}</div>}

      <style jsx>{`
        @keyframes klaRadarSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes klaRadarBlip1 {
          0%, 100% { opacity: 0.25; }
          50% { opacity: 1; }
        }
        @keyframes klaRadarBlip2 {
          0%, 100% { opacity: 0.25; }
          50% { opacity: 0.95; }
        }
      `}</style>
    </div>
  );
}
