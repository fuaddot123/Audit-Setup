// pages/api/sync-kesehatan-stok.js
// Menarik data dari Google Sheet (struktur sama seperti Presentase_Kesehatan_Cabang.xlsx),
// menghitung ulang Skor Temuan / Skor Rugi / Skor Total / % Kesehatan Barang di server
// (bukan sekadar menyalin nilai dari sheet, biar rumusnya konsisten & tervalidasi),
// lalu upsert ke tabel audit_generic (module = 'stok_kesehatan').
//
// PERLU environment variables (lihat panduan setup):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL
//   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
//   GOOGLE_SHEET_ID_KESEHATAN
//   SUPABASE_SERVICE_ROLE_KEY   (JANGAN pakai NEXT_PUBLIC_, ini rahasia)
//   NEXT_PUBLIC_SUPABASE_URL    (sudah ada)

import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const MONTHS_ID = ["januari", "februari", "maret", "april", "mei", "juni", "juli", "agustus", "september", "oktober", "november", "desember"];

function parseSheetTabToPeriod(tabName) {
  const m = String(tabName).trim().toLowerCase().match(/^([a-z]+)\s+(\d{2,4})$/);
  if (!m) return null;
  const monthIdx = MONTHS_ID.indexOf(m[1]);
  if (monthIdx === -1) return null;
  let year = parseInt(m[2], 10);
  if (year < 100) year += 2000;
  return `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
}

function skorRugi(untungRugi) {
  const n = Number(untungRugi) || 0;
  if (n >= 0) return 0;
  const rugi = Math.abs(n);
  if (rugi <= 50000) return 1;
  if (rugi <= 150000) return 2;
  if (rugi <= 300000) return 3;
  return 4;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { period, accessToken, userId } = req.body || {};
  if (!accessToken) return res.status(401).json({ error: "Tidak ada sesi login." });

  const missingEnv = ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "GOOGLE_SHEET_ID_KESEHATAN", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL"]
    .filter((k) => !process.env[k]);
  if (missingEnv.length) {
    return res.status(500).json({ error: "Environment variable belum di-set: " + missingEnv.join(", ") });
  }

  try {
    // ── Verifikasi: yang minta sync harus super_admin ──
    const authClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { data: userData, error: authErr } = await authClient.auth.getUser(accessToken);
    if (authErr || !userData?.user) return res.status(401).json({ error: "Sesi tidak valid, silakan login ulang." });

    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: profile } = await admin.from("profiles").select("role").eq("id", userData.user.id).single();
    if (profile?.role !== "super_admin") return res.status(403).json({ error: "Cuma Super Admin yang boleh sync." });

    // ── Ambil data dari Google Sheet ──
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n"),
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID_KESEHATAN;

    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const tabTitles = meta.data.sheets.map((s) => s.properties.title);

    const { data: branches } = await admin.from("branches").select("id,name");
    const branchMap = {};
    (branches || []).forEach((b) => { branchMap[b.name.trim().toLowerCase()] = b.id; });

    let totalSynced = 0, totalSkipped = 0;
    const logs = [];

    for (const tab of tabTitles) {
      if (tab.toLowerCase().includes("cara")) continue;
      const tabPeriod = parseSheetTabToPeriod(tab);
      if (!tabPeriod) continue;
      if (period && tabPeriod !== period) continue;

      const range = `'${tab}'!A1:J60`;
      const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
      const rows = resp.data.values || [];

      const headerIdx = rows.findIndex((r) => r.some((c) => String(c).trim() === "Cabang"));
      if (headerIdx === -1) { logs.push(`Tab "${tab}": header "Cabang" tidak ditemukan, dilewati.`); continue; }

      for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i] || [];
        const cabangName = String(row[1] || "").trim();
        if (!cabangName) continue;
        if (/rata|indikator|presentase/i.test(cabangName)) break;

        const branchId = branchMap[cabangName.toLowerCase()];
        if (!branchId) { logs.push(`"${cabangName}" (${tab}): nama cabang tidak cocok, dilewati.`); totalSkipped++; continue; }

        const rawTemuan = row[2];
        if (rawTemuan === undefined || rawTemuan === "" || /tidak visit/i.test(String(rawTemuan))) {
          totalSkipped++;
          continue;
        }

        const temuanCount = parseFloat(rawTemuan) || 0;
        const bonusCount = parseFloat(row[3]) || 0;
        const untungRugi = parseFloat(row[4]) || 0;

        const skorTemuan = temuanCount + bonusCount;
        const sRugi = skorRugi(untungRugi);
        const skorTotal = skorTemuan + sRugi * 5;
        const kesehatanPct = Math.max(0, 1 - skorTotal / 100);

        const { error: upsertErr } = await admin.from("audit_generic").upsert({
          module: "stok_kesehatan",
          branch_id: branchId,
          period: tabPeriod,
          status: "submitted",
          submitted_by: userId || null,
          data: {
            temuan_count: temuanCount,
            bonus_count: bonusCount,
            untung_rugi: untungRugi,
            skor_temuan: skorTemuan,
            skor_rugi: sRugi,
            skor_total: skorTotal,
            kesehatan_pct: kesehatanPct,
            sumber: "google_sheet",
            synced_at: new Date().toISOString(),
          },
        }, { onConflict: "module,branch_id,period" });

        if (upsertErr) { logs.push(`Gagal simpan "${cabangName}" (${tab}): ${upsertErr.message}`); totalSkipped++; }
        else totalSynced++;
      }
    }

    return res.status(200).json({ success: true, totalSynced, totalSkipped, logs });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
