\echo '### Baris kondisi Agustus — nilai yang dibekukan (dari isi-mundur)'
select k.kondisi_kode, k.skor_saat_audit, k.batas_hari_saat_audit from display_kondisi k order by 1;
\echo ''
\echo '### Skor Agustus SEBELUM master diutak-atik'
select period, skor_kondisi, skor_display from v_display_skor_periode;
\echo ''
\echo '### Super Admin: Lecet ringan 80 -> 50, DAN batas 60 -> 45'
update display_kondisi_opsi set skor = 50 where kode = 'lecet_ringan';
update display_standar set maks_hari_pajang = 45, peringatan_sebelum_hari = 10 where id = 1;
\echo '### Skor Agustus SESUDAHNYA (harus TETAP sama)'
select period, skor_umur, skor_kondisi, skor_display from v_display_skor_periode;
\echo ''
\echo '### Audit BERIKUTNYA (September) — di sinilah master baru berlaku'
insert into display_kondisi (display_unit_id,audit_date,period,kondisi_kode,skor_saat_audit,batas_hari_saat_audit,dicatat_oleh)
select id,'2026-09-15','2026-09','lecet_ringan',50,45,'22222222-2222-2222-2222-222222222222'
from display_unit where serial_number in ('SN-TUA-001','SN-SDG-002','SN-BARU-003') and tanggal_turun is null;
select period, unit_dalam_batas||'/'||unit_dinilai as dalam_batas, skor_kondisi, skor_display
from v_display_skor_periode order by period;
