// pages/api/sync-kesehatan-stok.js
// Sheet: "Plus Minus dan Barang Bonus All cabang Tahun 2026"
// Struktur per tab (1 tab = 1 cabang, contoh "4. Tegal"):
//   Form kiri  (kolom A-L)  : "Barang Lebih & Tidak Masuk Sistem" -> tiap baris = 1 temuan,
//                              baris "TOTAL UNTUNG / RUGI" di kolom A, nilainya di kolom L.
//   Form kanan (kolom O-X)  : "Barang Bonus Fisik Sudah Tidak Ada" -> tiap baris = 1 temuan.
// Tidak ada kolom tanggal -> sync ini menyimpan SNAPSHOT jumlah temuan saat ini,
// dikunci ke periode yang lagi dipilih di aplikasi (bukan dipisah otomatis per bulan).
//
// PERLU environment variables:
//   GOOGLE_SERVICE_ACCOUNT_EMAIL
//   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
//   GOOGLE_SHEET_ID_KESEHATAN
//   SUPABASE_SERVICE_ROLE_KEY
//   NEXT_PUBLIC_SUPABASE_URL
//   NEXT_PUBLIC_SUPABASE_ANON_KEY

import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

function skorRugi(untungRugi) {
  const n = Number(untungRugi) || 0;
  if (n >= 0) return 0;
  const rugi = Math.abs(n);
  if (rugi <= 50000) return 1;
  if (rugi <= 150000) return 2;
  if (rugi <= 300000) return 3;
  return 4;
}

function parseRupiah(v) {
  if (v === undefined || v === null) return 0;
  const s = String(v).replace(/[^\d-]/g, "");
  return parseInt(s, 10) || 0;
}

function branchNameFromTab(tab) {
  return String(tab).replace(/^\d+\.\s*/, "").trim();
}

// Hitung Form Kiri: baris dihitung KALAU kolom L (Untung/Rugi) ada isinya,
// berhenti pas ketemu baris "TOTAL UNTUNG / RUGI" (ambil nilainya dari situ).
function parseFormKiri(rows) {
  const headerIdx = rows.findIndex((r) => String(r[0] || "").trim() === "No");
  if (headerIdx === -1) return { temuanCount: 0, untungRugi: 0, found: false };
  let temuanCount = 0;
  let untungRugi = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const a = String(row[0] || "").trim();
    if (/^total/i.test(a)) {
      untungRugi = parseRupiah(row[11]);
      break;
    }
    if (!a && !row[1]) break; // baris kosong = akhir data (jaga-jaga)
    const lCell = row[11];
    if (lCell !== undefined && lCell !== null && String(lCell).trim() !== "") {
      temuanCount++;
    }
  }
  return { temuanCount, untungRugi, found: true };
}

// Hitung Form Kanan: bukan jumlah baris, tapi NOMOR TERAKHIR di kolom O (index 14)
function parseFormKanan(rows) {
  const headerIdx = rows.findIndex((r) => String(r[14] || "").trim() === "No");
  if (headerIdx === -1) return { bonusCount: 0, found: false };
  let lastNo = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const o = String(row[14] || "").trim();
    const p = row[15];
    if (!o && !p) break; // baris kosong = akhir data
    const n = parseInt(o, 10);
    if (!isNaN(n)) lastNo = n;
  }
  return { bonusCount: lastNo, found: true };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { period, accessToken, userId } = req.body || {};
  if (!accessToken) return res.status(401).json({ error: "Tidak ada sesi login." });
  if (!period) return res.status(400).json({ error: "Periode wajib diisi." });

  const missingEnv = ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "GOOGLE_SHEET_ID_KESEHATAN", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]
    .filter((k) => !process.env[k]);
  if (missingEnv.length) {
    return res.status(500).json({ error: "Environment variable belum di-set: " + missingEnv.join(", ") });
  }

  try {
    const authClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { data: userData, error: authErr } = await authClient.auth.getUser(accessToken);
    if (authErr || !userData?.user) return res.status(401).json({ error: "Sesi tidak valid, silakan login ulang." });

    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: profile } = await admin.from("profiles").select("role").eq("id", userData.user.id).single();
    if (profile?.role !== "super_admin") return res.status(403).json({ error: "Cuma Super Admin yang boleh sync." });

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
      const cabangName = branchNameFromTab(tab);
      const branchId = branchMap[cabangName.toLowerCase()];
      if (!branchId) { logs.push(`Tab "${tab}": nama cabang "${cabangName}" tidak cocok, dilewati.`); totalSkipped++; continue; }

      const range = `'${tab}'!A1:X200`;
      const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
      const rows = resp.data.values || [];

      const kiri = parseFormKiri(rows);
      const kanan = parseFormKanan(rows);
      if (!kiri.found && !kanan.found) { logs.push(`Tab "${tab}": form tidak ditemukan, dilewati.`); totalSkipped++; continue; }

      const temuanCount = kiri.temuanCount;
      const bonusCount = kanan.bonusCount;
      const untungRugi = kiri.untungRugi;

      const skorTemuan = temuanCount + bonusCount;
      const sRugi = skorRugi(untungRugi);
      const skorTotal = skorTemuan + sRugi * 5;
      const kesehatanPct = Math.max(0, 1 - skorTotal / 100);

      const { error: upsertErr } = await admin.from("audit_generic").upsert({
        module: "stok_kesehatan",
        branch_id: branchId,
        period,
        status: "submitted",
        submitted_by: userId || null,
        data: {
          tidak_visit: false,
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

      if (upsertErr) { logs.push(`Gagal simpan "${cabangName}": ${upsertErr.message}`); totalSkipped++; }
      else { totalSynced++; logs.push(`"${cabangName}": ${temuanCount} temuan barang, ${bonusCount} bonus hilang, untung/rugi Rp${untungRugi.toLocaleString("id-ID")}.`); }
    }

    return res.status(200).json({ success: true, totalSynced, totalSkipped, logs });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
