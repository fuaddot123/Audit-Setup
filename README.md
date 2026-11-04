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

### Saldo kas kecil dari Google Sheets

Pada periode bulan berjalan, kolom **Sisa saldo** di Audit Keuangan membaca saldo terakhir dari spreadsheet [REKAP KAS KECIL CABANG KLA COMP](https://docs.google.com/spreadsheets/d/1He7KkKyyTbBTe_CbbIXrQpLxTicxsfH-/edit). Aplikasi memilih baris transaksi terakhir pada tab cabang, sehingga baris kosong yang hanya berisi rumus saldo tidak dianggap transaksi. Tab `JOGJA`, `SURABAYA`, dan `BABATAN` masing-masing dipetakan ke cabang Yogyakarta, Surabaya MERR, dan Surabaya Babatan.

Saldo dimuat ulang setiap dua menit saat halaman Audit Keuangan terbuka, saat jendela kembali aktif, dan sekali lagi sebelum audit disimpan. Jika spreadsheet tidak bisa dibaca atau tab cabang tidak ada, penyimpanan audit bulan berjalan dibatalkan dengan pesan kesalahan agar angka lama tidak tersimpan tanpa disadari. Audit periode lampau tetap memakai angka yang sudah tersimpan di Supabase. Spreadsheet harus tetap dapat diakses melalui tautan; server membaca ekspor XLSX, sementara endpoint aplikasi hanya melayani pengguna yang sudah login. ID spreadsheet dapat diganti lewat `GOOGLE_SHEET_ID_KAS_KECIL` di environment server.

## Laporan Audit SOP dengan AI

Di **Audit SOP → Laporan Audit**, tombol **Generate Temuan Krusial** memakai OpenAI untuk memilih temuan yang berdampak material pada SOP atau operasional. Tambahkan `OPENAI_API_KEY` sebagai environment variable **server** di Vercel; jangan memakai awalan `NEXT_PUBLIC_`. Model dapat diganti lewat `OPENAI_SOP_MODEL` (default `gpt-4.1-mini`). Aplikasi mengirim teks temuan dan catatan auditor, tanpa foto, lalu memeriksa agar hasil AI hanya merujuk temuan yang memang tersimpan. **Generate Semua Temuan** tidak memanggil OpenAI dan mencetak semua jawaban gagal beserta catatan dan lampiran checklist lengkap.

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

## Rekap Stock Opname

Menu **Rekap Stock Opname** (`/dashboard?m=rekap_stock_opname`) membaca data `berita_acara` untuk bulan yang dipilih. Default memakai bulan sebelumnya dan semua berita acara, dengan opsi audit terakhir per cabang. Ringkasan memisahkan baris pemeriksaan berstatus Selisih dari rincian barang pada baris tersebut. Semua BA mengakumulasi kunjungan berulang; mode terakhir memilih menurut tanggal audit, waktu dibuat, lalu ID. Data auditor sejak Agustus 2026 tetap dibatasi ke pemiliknya melalui filter dan RLS yang sudah ada.

Pilih satu cabang untuk rekap, PDF dan Excel khusus cabang tersebut, atau **Semua cabang (gabungan)**. Nomor per cabang menambahkan kode ID cabang, misalnya `BA-REKAP-SO/KLA/2026/10/CB-2/SEMUA`, sehingga berbeda dari nomor gabungan dan cabang lain. Judul, cakupan, rincian, sumber BA, total, dan nama file mengikuti pilihan cabang.

Tombol **Generate Nomor BA** atau ekspor membentuk nomor rekap bulanan deterministik `BA-REKAP-SO/KLA/YYYY/MM/SEMUA` (atau `TERAKHIR`; data personal menambahkan ID auditor). Ini nomor dokumen rekap per bulan/cakupan, bukan urutan penerbitan atau nomor baru pada BA cabang. Export ulang memakai nomor yang sama, tanpa perubahan skema. PDF diunduh langsung; Excel berisi Ringkasan Cabang, Detail Selisih, dan Sumber Berita Acara dengan ID sumber.

Jumlah kosong mengikuti form lama (1); harga atau jumlah tidak valid tetap belum bernilai. Jalankan `node --test uji/stock-opname-recap.test.mjs` untuk menguji agregasi, nomor, dan ekspor.

## Impor Stock Opname Nexa ke BA

Impor tersedia hanya di **Rekap Stock Opname**, setelah memilih satu cabang. Pilih BA tujuan yang dapat diedit, atau **Buat BA stock opname baru** dan isi tanggal audit. Gunakan ekspor rincian barang Nexa, tampilkan **All** di sumber sebelum ekspor. Ekspor daftar header opname tanpa kuantitas ditolak. Pilih sheet, lengkapi metadata yang tidak tercantum di file sesuai Nexa, periksa pratinjau, pilih nomor opname dan Kategori 1/2, tambahkan, lalu klik **Simpan impor ke rekap**. Data tersimpan langsung masuk ringkasan dan export rekap; BA tetap menjadi dokumen sumber. File tidak dikirim ke Nexa atau OpenAI; data dibaca di browser dan disimpan melalui akses/RLS yang sudah ada.

Satu nomor opname menjadi satu baris pemeriksaan (bukan setiap SKU sebagai pemeriksaan terpisah). Seluruh barang pada opname terpilih, termasuk yang cocok, disimpan di `stock_opname_kat1/2[].nexa` dengan kode, tanggal, gudang, SHA-256 file, nama file dan waktu impor. Sistem, fisik, arah selisih, serial dan keterangan sumber tetap terpisah dari catatan auditor dan harga yang dilengkapi kemudian. Tidak ada perubahan schema, kunci API, atau posting adjustment. Cabang, bulan, tanggal audit, angka sumber, selisih dan nomor opname ganda dalam BA yang sama divalidasi sebelum penambahan. Duplikasi lintas BA belum dicegah; referensi dokumen tidak boleh digunakan untuk mem-posting adjustment dua kali.

Referensi BA tersimpan adalah `BA-SO/KLA/{uuid-berita-acara}`, berbeda dari nomor rekap bulanan. Rincian sumber ikut PDF BA; rekap menampilkan rincian Nexa serta menambahkan bagian PDF dan sheet **Rincian Nexa** bila ada impor. Penambahan ke BA lama membaca ulang data dan memakai pemeriksaan versi `updated_at`, mempertahankan isian lain dan pemilik audit. BA baru memakai UUID tetap untuk mencegah duplikasi akibat percobaan simpan ulang. Ini snapshot pemeriksaan untuk acuan adjustment manual, bukan status persetujuan/posting yang tersinkron ke Nexa. BA lama tanpa impor mempertahankan tampilan dan format ekspornya. Uji: `node --test uji/nexa-opname-import.test.mjs uji/nexa-recap-save.test.mjs uji/stock-opname-recap.test.mjs`.

### Nilai otomatis dari Report Persediaan

Rekap memakai tab Ringkasan Cabang, Detail Stok Admin & Fisik, serta Impor Excel & Sumber Nilai. Tabel barang menyediakan pencarian, filter kurang/lebih/belum bernilai, dan 25 baris per halaman. Pada tab impor, muat Excel **Report Persediaan** dan isi periode report sesuai filter Nexa (tanggal pada nama file hanya tanggal unduh). Harga per kode barang dihitung dari **Sisa Nilai / Sisa Qty**, lalu dikalikan **qty fisik − qty admin**. Selisih kurang bernilai negatif dan lebih positif. Pembulatan hanya untuk tampilan; perhitungan memakai presisi penuh.

Format asli Nexa dengan 14 kolom dan subjudul Qty/Total berulang dibaca menurut urutan Saldo Awal, Pembelian, In, Out, Sisa. Format dengan judul Sisa Qty/Sisa Nilai juga didukung. Kode dicocokkan persis setelah trim dan uppercase; kode ganda, qty nol, saldo tidak valid atau kode tidak ditemukan tetap belum bernilai, tanpa fallback ke harga jual atau harga lama. Periode report harus sama dengan rekap. Ini jalur Excel, tanpa penarikan API Nexa dari Vercel.

Muat report untuk menghitung tampilan/ekspor secara langsung. **Simpan nilai ke N BA** memperbarui snapshot harga pada BA yang sedang ditampilkan sesuai cabang dan mode audit, menggunakan read ulang dan pemeriksaan updated_at per BA; kegagalan sebagian dilaporkan. Impor baru menyimpan harga bersama hasil opname. Snapshot mencatat nominal, qty, harga, periode, file/hash dan baris sumber. Harga manual tidak lagi diperlukan pada rincian Nexa. Baris audit manual tetap mengikuti catatan semula. Uji tambahan: `node --test uji/persediaan-valuation.test.mjs`.
