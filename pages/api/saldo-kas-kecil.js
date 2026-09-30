import { createClient } from "@supabase/supabase-js";
import { readKasKecilBalances } from "../../lib/kasKecilSheet";

const SHEET_ID = process.env.GOOGLE_SHEET_ID_KAS_KECIL || "1He7KkKyyTbBTe_CbbIXrQpLxTicxsfH-";
let cached = null;
let loading = null;

async function fetchBalances() {
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(SHEET_ID)}/export?format=xlsx`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!response.ok) throw new Error(`Google Sheets: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 10_000_000) throw new Error("File kas kecil terlalu besar.");
  const balances = readKasKecilBalances(bytes);
  if (!Object.keys(balances).length) throw new Error("Tidak ada saldo cabang yang dapat dibaca.");
  cached = { balances, updatedAt: new Date().toISOString(), expiresAt: Date.now() + 120_000 };
  return cached;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  res.setHeader("Cache-Control", "private, no-store");

  const token = /^Bearer (.+)$/i.exec(req.headers.authorization || "")?.[1];
  if (!token) return res.status(401).json({ error: "Tidak ada sesi login." });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: "Supabase belum dikonfigurasi." });
  }

  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: "Sesi tidak valid." });

  try {
    if (!cached || cached.expiresAt <= Date.now() || req.query.fresh === "1") {
      loading ||= fetchBalances().finally(() => { loading = null; });
      await loading;
    }
    return res.status(200).json({ balances: cached.balances, updatedAt: cached.updatedAt });
  } catch (err) {
    return res.status(502).json({ error: "Gagal membaca saldo dari Google Sheets: " + err.message });
  }
}
