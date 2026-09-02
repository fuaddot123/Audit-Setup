# Uji logika murni

Tidak butuh database, tidak butuh peramban, tidak butuh `npm install` apa pun
di luar yang sudah ada. Dijalankan dari **akar repo**:

```bash
node uji/uji-format-ba.mjs        # aturan periode + katalog inventaris + hitungannya
node uji/uji-impor-lib.mjs        # pengurai berkas impor display
node uji/uji-lihat-sebagai.mjs    # pagar "mode lihat sebagai" (hanya hak baca)
node uji/uji-cetak-baru.mjs       # cetakan Berita Acara format baru, dirender sungguhan
node uji/uji-berkas-asli.mjs      # pengurai diadu ke berkas laporan yang asli
```

Semuanya menyalin berkas sumbernya ke `.mjs` sementara lalu mengimpornya, jadi
yang diuji benar-benar isi berkas di repo ini — bukan salinan yang bisa basi.
Kalau berkas sasarannya tidak ketemu, ujinya **berhenti dengan galat** dan
menyebutkan tempat-tempat yang sudah dicari; ia tidak pernah lolos diam-diam.

## `uji-berkas-asli.mjs` perlu satu berkas yang tidak ikut di-commit

Berkas contoh laporan monitoring display memuat **nama produk dan nomor seri
sungguhan**. Repo ini publik, jadi berkasnya sengaja tidak disertakan.

Mintakan ke pemilik, lalu taruh di:

```
uji/contoh-monitoring-display.xlsx
```

Tanpa berkas itu, ujinya berhenti dan menyatakan dirinya **DILEWATI** — bukan
lolos. Uji yang diam-diam melompat lalu tampak hijau adalah cara paling halus
membuat orang mengira ada penjagaan padahal tidak ada.

## `buat-pdf-produksi.mjs` bukan uji

Ia membangkitkan `uji/prod-sepi.html` dan `uji/prod-ramai.html` dari modul
cetak. Arahkan Chrome ke situ untuk memeriksa halamannya sendiri:

```bash
node uji/buat-pdf-produksi.mjs
chrome --headless=new --no-pdf-header-footer \
       --print-to-pdf=BA.pdf file:///.../uji/prod-ramai.html
```

Yang diperiksa di PDF-nya: A4 595×842 pt, dan **tanda tangan wajib di halaman
terakhir** baik ketika isinya satu halaman maupun dua.
