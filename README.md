# KLA Audit — Starter (Next.js + Supabase)

Ini fondasi aplikasi KLA Audit dengan **login sungguhan**, **role (Admin/Auditor/CEO)**, dan **alur approval yang aman** (diamankan lewat Row Level Security di database, bukan cuma tampilan).

Modul **Audit Keuangan** sudah jalan penuh. Modul lain (SOP, Service, Stok, KPI) masih placeholder — dibangun berikutnya dengan pola yang sama.

## Langkah 1 — Setup database Supabase

1. Buka project Supabase kamu → menu **SQL Editor** → **New query**
2. Salin seluruh isi file `schema.sql`, tempel, klik **Run**
3. Setelah berhasil, buka menu **Authentication → Users**, lalu **Add user** untuk akun kamu sendiri dan tim (atau biarkan mereka daftar sendiri dari halaman login nanti)
4. Buka menu **Table Editor → profiles**, cari baris akun kamu, ubah kolom `role` jadi `admin` (atau `ceo` untuk akun bos). Semua akun baru otomatis dapat role `auditor`.

## Langkah 2 — Jalankan di komputer kamu

Butuh [Node.js](https://nodejs.org) terinstall dulu (versi 18 ke atas).

```
npm install
cp .env.local.example .env.local
```

Buka file `.env.local`, isi dua baris ini dengan nilai dari Supabase Dashboard → **Project Settings → API**:
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

Lalu jalankan:
```
npm run dev
```

Buka `http://localhost:3000` di browser — harusnya muncul halaman login.

## Langkah 3 — Deploy supaya bisa diakses lewat internet

Cara paling gampang: pakai [Vercel](https://vercel.com) (gratis untuk pemakaian seperti ini).

1. Push folder ini ke GitHub (bikin repository baru, upload semua file)
2. Buka vercel.com → **Add New Project** → pilih repository tadi
3. Saat diminta **Environment Variables**, isi `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` (sama seperti di `.env.local`)
4. Klik **Deploy** — tunggu beberapa menit, nanti dapat alamat seperti `kla-audit.vercel.app`

Kalau langkah ini terasa berat, ini titik yang wajar untuk minta bantuan IT kantor atau developer — bagian databasenya (schema.sql) sudah siap pakai, mereka tinggal lanjutkan dari sini.

## Struktur yang sudah ada

- `schema.sql` — seluruh struktur database, termasuk keamanan (RLS) supaya:
  - Auditor cuma bisa isi/edit data yang statusnya masih draft
  - Cuma CEO (atau admin) yang bisa mengubah status jadi "Disetujui"/"Ditolak" — ini dicek di **server**, bukan di tampilan, jadi tidak bisa dicurangi dari browser
- `pages/login.js` — halaman login & daftar akun
- `pages/dashboard.js` — kerangka utama, mengecek siapa yang login dan perannya
- `components/Sidebar.js` — menu 5 modul
- `components/AuditKeuangan.js` — modul Audit Keuangan lengkap: isi data, kirim untuk approval, approve/tolak (khusus CEO/admin), export PDF

## Yang belum dibangun (obrolan lanjutan)

- Modul Audit SOP, Audit Service, Audit Kesehatan Stok, KPI (tabel `audit_generic` di database sudah siap menampung, tinggal dibuatkan tampilannya)
- Upload foto temuan (tabel `findings` + storage bucket `findings` sudah dibuat di schema.sql, tinggal disambungkan ke UI)
- Export Excel
- Grafik/dashboard ringkasan lintas modul
- Notifikasi approval ke CEO (misal email atau lonceng notifikasi)

Kabari saya modul mana yang mau dilanjutkan dulu.
