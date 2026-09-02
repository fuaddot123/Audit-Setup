\echo '### Master sekarang: Lecet ringan=50, batas=45 hari'
select maks_hari_pajang, bobot_umur||':'||bobot_kondisi as bobot from display_standar;
\echo ''
\echo '### Audit SEPTEMBER — trigger mengisi nilai beku sendiri (kolomnya tidak disebut)'
insert into display_kondisi (display_unit_id,audit_date,period,kondisi_kode,dicatat_oleh)
select id,'2026-09-16','2026-09','lecet_ringan','22222222-2222-2222-2222-222222222222'
from display_unit where tanggal_turun is null;
select k.period, k.kondisi_kode, k.skor_saat_audit, k.batas_hari_saat_audit
from display_kondisi k where k.period='2026-09' limit 2;
\echo ''
\echo '### Dua periode berdampingan — Agustus beku, September pakai aturan baru'
select period, unit_dalam_batas||'/'||unit_dinilai as dalam_batas, skor_umur, skor_kondisi, skor_display
from v_display_skor_periode order by period;
