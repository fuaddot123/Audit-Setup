import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";
import RadarLogo from "../components/RadarLogo";

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/dashboard");
    });
  }, [router]);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (error) throw error;
        setError("Akun dibuat. Cek email untuk verifikasi, lalu login. Role default: Auditor (admin bisa ubah nanti).");
        setLoading(false);
        return;
      }
      router.replace("/dashboard");
    } catch (err) {
      setError(err.message || "Gagal login.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-page)" }}>
      <div style={{ background: "var(--surface)", border: "1px solid rgba(139,110,255,0.2)", borderRadius: 14, padding: 32, width: 360 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <RadarLogo size={56} />
        </div>
        <div className="display" style={{ fontSize: 22, fontWeight: 600, marginBottom: 4, textAlign: "center", color: "var(--text-primary)" }}>KLA Radar</div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 24, textAlign: "center" }}>
          {mode === "login" ? "Masuk ke akun kamu" : "Buat akun baru"}
        </div>
        <form onSubmit={handleSubmit}>
          {mode === "signup" && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 5 }}>Nama lengkap</label>
              <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 5 }}>Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "var(--text-secondary)", marginBottom: 5 }}>Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </div>
          {error && <div style={{ background: "var(--danger-bg)", border: "1px solid rgba(239,68,68,0.35)", color: "var(--danger-text)", padding: "8px 12px", borderRadius: 8, fontSize: 12.5, marginBottom: 14 }}>{error}</div>}
          <button className="btn" type="submit" disabled={loading} style={{ width: "100%" }}>
            {loading ? "Memproses\u2026" : mode === "login" ? "Masuk" : "Daftar"}
          </button>
        </form>
        <div style={{ textAlign: "center", marginTop: 16, fontSize: 12.5, color: "var(--text-secondary)" }}>
          {mode === "login" ? (
            <>Belum punya akun? <a href="#" onClick={(e) => { e.preventDefault(); setMode("signup"); setError(null); }} style={{ color: "#F4B740", fontWeight: 500 }}>Daftar</a></>
          ) : (
            <>Sudah punya akun? <a href="#" onClick={(e) => { e.preventDefault(); setMode("login"); setError(null); }} style={{ color: "#F4B740", fontWeight: 500 }}>Masuk</a></>
          )}
        </div>
      </div>
    </div>
  );
}
