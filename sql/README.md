# Skema database

Modul Monitoring Display (masuk lewat PR #1) butuh tabel yang belum ada di
Supabase. Kodenya sudah hidup di produksi; selama tabelnya belum dibuat, menu
Monitoring Display menampilkan pesan galat dan **modul lain tidak terganggu**.

## Vercel tidak perlu disetel apa pun

Sudah diperiksa terhadap `c9ba0a2..a33b62b`:

- `package.json` dan `package-lock.json` **tidak berubah** — tidak ada
  dependensi baru. Pustaka `xlsx` yang dipakai impor Excel sudah ada di sana
  sejak awal, hanya belum pernah terpakai.
- Kode barunya **tidak membaca satu pun `process.env`** — tidak ada env var
  baru.

Jadi yang tersisa memang hanya database.

## Urutan menjalankan

Di SQL Editor Supabase, berurutan:

| Berkas | Isi |
|---|---|
| `01-schema.sql` | Rekonstruksi skema dasar dari kode |
| `02-schema-display.sql` | Tabel modul display + **trigger pembeku nilai** |
| `03-schema-akses.sql` | `akses_auditor` + `boleh_lihat()` untuk mode lihat-sebagai |

### `01-schema.sql` — baca dulu sebelum dijalankan

Berkas ini **rekonstruksi dari kode**, bukan dump dari server. `schema.sql` di
akar repo sudah jauh tertinggal: 6 tabel sementara kodenya memakai 12, dan peran
`super_admin` dilarang oleh CHECK padahal dipakai 24 kali di aplikasi.

Kalau database produksi sudah benar, **pakai berkas ini sebagai pembanding
saja** — jangan dijalankan buta di atas data hidup. Yang benar-benar baru dan
memang harus dijalankan adalah `02` dan `03`.

### `02-schema-display.sql` — triggernya wajib

Di dalamnya ada `bekukan_nilai_kondisi()`. Ia **bukan hiasan**.

Tanpa trigger itu, menurunkan skor "Lecet ringan" di Master Data akan
**menulis ulang Berita Acara bulan-bulan yang sudah lewat**. Sudah terjadi saat
diuji: Agustus berubah dari 81% jadi 78,8% tanpa ada yang menyentuh audit
Agustus.

Pembekuan lewat aplikasi saja tidak cukup — baris yang masuk lewat skrip
melewatinya. Karena itu ia dipasang di database, bukan di kode.

## Membuktikannya

### Yang benar-benar menjaga: dua uji Node

```bash
npm install --no-save @electric-sql/pglite
node uji/uji-skema.mjs        # 27 pemeriksaan
node uji/uji-pembekuan.mjs    # 13 pemeriksaan
```

Keduanya memasang skema ini di Postgres sungguhan (PGlite, Postgres 18 di dalam
proses Node) lalu memeriksa hasilnya. `uji-pembekuan.mjs` menjalankan skenario
yang dulu benar-benar merusak: simpan audit Agustus, turunkan skor di master,
lalu baca ulang baris Agustus — angkanya wajib tidak bergeser. Ia juga memuat
kendali negatif: triggernya dilepas, dan angka Agustus memang ikut berubah
80 -> 50. Tanpa kendali itu, hijaunya tidak berarti apa-apa.

### Skrip `.sql` di bawah ini BUKAN uji otomatis

Ini perlu dikatakan terus terang. Skrip `uji-*.sql` adalah **peragaan psql untuk
dibaca manusia**, bukan pagar:

- Semuanya memakai `\set ON_ERROR_STOP off` dan sengaja memancing penolakan.
- Mereka **satu sesi berurutan yang saling bergantung** — `uji-rls.sql` yang
  memberi `grant` ke `authenticated`, dan skrip lain memakainya. Dijalankan
  sendiri-sendiri, sebagian gagal karena itu.
- **Lima di antaranya tidak menyatakan harapan apa pun** — `uji-ambang`,
  `uji-beku`, `uji-retroaktif`, `uji-sept`, `uji-skor`. Mereka mencetak angka
  untuk dibaca, jadi mereka tidak pernah bisa merah.

Yang paling perlu diketahui: dua di antaranya (`uji-beku`, `uji-retroaktif`)
justru tentang jaminan paling penting di skema ini, dan keduanya tidak menjaga
apa pun. Itulah sebabnya `uji/uji-pembekuan.mjs` ditulis.

Skrip-skrip ini tetap disimpan karena berguna dibaca sambil melihat keluarannya
di psql — bukan karena ia membuktikan sesuatu secara otomatis.

## Menjalankan skrip peragaan itu

Skrip `uji-*.sql` dijalankan di Postgres **kosong**, bukan di produksi.
`tiruan-supabase.sql` menyediakan `auth.uid()` dan kawan-kawannya supaya
kebijakan RLS bisa diadu tanpa Supabase.

Kolom di bawah menyebut apa yang skripnya *peragakan*, bukan apa yang ia jaga —
lihat catatan di atas.

| Skrip | Yang diperagakan |
|---|---|
| `uji-rls.sql` | Auditor tidak bisa membaca/menulis milik auditor lain |
| `uji-akses.sql` | `akses_auditor` memberi hak BACA saja |
| `uji-beku.sql` | Skor & batas dibekukan saat audit disimpan |
| `uji-retroaktif.sql` | Mengubah master **tidak** mengubah audit yang lalu |
| `uji-sept.sql` | Dua periode berdampingan: Agustus beku, September aturan baru |
| `uji-skor.sql` | Perhitungan skor umur & kondisi |
| `uji-ambang.sql` | Ambang peringatan per brand |
| `uji-display.sql` | Tabel display: sisip, ubah, turunkan unit |
| `uji-cabang.sql` | Ganti nama cabang tidak memutus data lama |
| `uji-usulan.sql` | Istilah kondisi baru dari auditor masuk master |

Jalankan misalnya:

```bash
psql "$DATABASE_URL_UJI" -f sql/tiruan-supabase.sql -f sql/01-schema.sql \
                          -f sql/02-schema-display.sql -f sql/03-schema-akses.sql \
                          -f sql/uji-beku.sql
```

## Yang belum diverifikasi

Skema ini **belum pernah dijalankan di Supabase produksi**. Yang sudah:
dijalankan dan diuji di Postgres kosong. Yang belum: diadu dengan bentuk
database produksi yang sebenarnya — dan hanya pemilik akses Supabase yang bisa
melakukannya.

Sesudah dijalankan, dua hal yang paling perlu dilihat dengan mata:

1. Menu Monitoring Display terbuka tanpa pesan galat.
2. **Cetak Berita Acara Agustus 2026, bandingkan dengan cetakan sebelumnya.**
   Harus sama persis.
