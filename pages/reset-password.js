import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";
import RadarLogo from "../components/RadarLogo";

export default function ResetPassword() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const linkError = fragment.get("error_description") || new URLSearchParams(window.location.search).get("error_description");
    if (linkError) {
      setError("Tautan pemulihan tidak berlaku atau sudah kedaluwarsa. Minta tautan baru dari halaman login.");
      return;
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session) {
        setError("");
        setReady(true);
      }
    });
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (data.session) setReady(true);
      else if (sessionError) setError("Gagal memeriksa tautan pemulihan. Coba buka tautan email lagi.");
      else setError("Tautan pemulihan tidak berlaku atau sudah kedaluwarsa. Minta tautan baru dari halaman login.");
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    if (password !== confirm) {
      setError("Konfirmasi password tidak sama.");
      return;
    }
    setLoading(true);
    setError("");
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message || "Gagal mengubah password. Minta tautan pemulihan baru.");
      setLoading(false);
      return;
    }
    router.replace("/dashboard");
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-page)" }}>
      <div style={{ background: "var(--surface)", border: "1px solid rgba(139,110,255,0.2)", borderRadius: 14, padding: 32, width: 360 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}><RadarLogo size={56} /></div>
        <div className="display" style={{ fontSize: 22, fontWeight: 600, marginBottom: 4, textAlign: "center", color: "var(--text-primary)" }}>Buat password baru</div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 24, textAlign: "center" }}>Untuk akun KLA Radar kamu</div>
        {ready && <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 5 }}>Password baru</label>
            <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </div>
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: "block", fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 5 }}>Ulangi password baru</label>
            <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={6} />
          </div>
          {error && <div role="alert" style={{ background: "var(--danger-bg)", color: "var(--danger-text)", padding: "8px 12px", borderRadius: 8, fontSize: 12.5, marginBottom: 14 }}>{error}</div>}
          <button className="btn" type="submit" disabled={loading} style={{ width: "100%" }}>{loading ? "Menyimpan…" : "Simpan password baru"}</button>
        </form>}
        {!ready && error && <div role="alert" style={{ color: "var(--danger-text)", fontSize: 12.5, marginBottom: 14 }}>{error}</div>}
        <div style={{ textAlign: "center", marginTop: 16, fontSize: 12.5 }}><a href="/login" style={{ color: "#F4B740" }}>Kembali ke login</a></div>
      </div>
    </div>
  );
}
