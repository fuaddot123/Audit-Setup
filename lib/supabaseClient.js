import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Supabase belum dikonfigurasi. Salin .env.local.example jadi .env.local dan isi kredensialnya."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Capture recovery events even if auth initializes before the home page mounts.
export let passwordRecoveryPending = false;
if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") passwordRecoveryPending = true;
  });
}
