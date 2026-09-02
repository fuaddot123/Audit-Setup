\echo '### Berita Acara AGUSTUS 2026, dicetak hari ini'
select period, skor_umur, skor_kondisi, skor_display from public.v_display_skor_periode;
\echo ''
\echo '### Super Admin merasa "Lecet ringan" terlalu murah hati: 80 -> 50'
update public.display_kondisi_opsi set skor = 50 where kode = 'lecet_ringan';
\echo '### Berita Acara AGUSTUS 2026 yang SAMA, dicetak lagi sesudahnya'
select period, skor_umur, skor_kondisi, skor_display from public.v_display_skor_periode;
