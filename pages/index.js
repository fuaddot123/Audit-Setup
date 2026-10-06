import { useEffect } from "react";
import { useRouter } from "next/router";
import { supabase, passwordRecoveryPending } from "../lib/supabaseClient";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    // Supabase may return password recovery links to the project's Site URL.
    // Keep the auth fragment so the reset page can exchange its tokens.
    if (new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery") {
      window.location.replace(`/reset-password${window.location.hash}`);
      return;
    }
    let recoveryDetected = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        recoveryDetected = true;
        router.replace("/reset-password");
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (!recoveryDetected) router.replace(passwordRecoveryPending ? "/reset-password" : data.session ? "/dashboard" : "/login");
    });
    return () => subscription.unsubscribe();
  }, [router]);
  return null;
}
