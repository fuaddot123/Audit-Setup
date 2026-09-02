\set ON_ERROR_STOP off
grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id,email) values
 ('11111111-1111-1111-1111-111111111111','owner@kla.test'),
 ('22222222-2222-2222-2222-222222222222','auditorA@kla.test');
update public.profiles set role='super_admin' where id='11111111-1111-1111-1111-111111111111';

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

\echo '### 1. Catat 3 unit: umur 70 / 55 / 10 hari (batas standar 60)'
insert into public.display_unit (branch_id,brand,model,serial_number,tanggal_pajang,dicatat_oleh) values
 (1,'ASUS','ROG Strix G16','SN-TUA-001', current_date-70,'22222222-2222-2222-2222-222222222222'),
 (1,'Lenovo','ThinkPad X1',  'SN-SDG-002', current_date-55,'22222222-2222-2222-2222-222222222222'),
 (2,'ASUS','Vivobook 14',    'SN-BARU-003',current_date-10,'22222222-2222-2222-2222-222222222222');
select model, umur_hari, batas_hari, sisa_hari, status_umur from public.v_display_monitoring order by umur_hari desc;

\echo '### 2. Brand ASUS dibatasi 30 hari (harus mengubah status Vivobook 10hr? tidak; ROG makin lewat)'
reset role;
insert into public.display_standar_brand (brand,maks_hari_pajang) values ('ASUS',30);
set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select model, brand, umur_hari, batas_hari, status_umur from public.v_display_monitoring order by brand, umur_hari desc;

\echo '### 3. Turunkan unit TANPA mengisi perlakuan (harus DITOLAK)'
update public.display_unit set tanggal_turun = current_date where serial_number='SN-TUA-001';

\echo '### 4. Turunkan unit DENGAN perlakuan (harus BERHASIL)'
update public.display_unit set tanggal_turun=current_date, perlakuan_kode='dijual_display',
       perlakuan_tanggal=current_date, harga_jual_display=7250000 where serial_number='SN-TUA-001';

\echo '### 5. Serial number sama dipajang lagi setelah turun (harus BERHASIL)'
insert into public.display_unit (branch_id,brand,model,serial_number,tanggal_pajang,dicatat_oleh)
values (3,'ASUS','ROG Strix G16','SN-TUA-001',current_date-5,'22222222-2222-2222-2222-222222222222');

\echo '### 6. Serial number yang SEDANG dipajang, dipajang lagi (harus DITOLAK)'
insert into public.display_unit (branch_id,brand,model,serial_number,tanggal_pajang,dicatat_oleh)
values (4,'ASUS','ROG Strix G16','SN-TUA-001',current_date,'22222222-2222-2222-2222-222222222222');

\echo '### 7. program_brand=true tanpa nama program (harus DITOLAK)'
insert into public.display_unit (branch_id,brand,model,tanggal_pajang,program_brand,dicatat_oleh)
values (1,'HP','Pavilion',current_date,true,'22222222-2222-2222-2222-222222222222');

\echo '### 8. tanggal_turun mendahului tanggal_pajang (harus DITOLAK)'
insert into public.display_unit (branch_id,brand,model,tanggal_pajang,tanggal_turun,perlakuan_kode,dicatat_oleh)
values (1,'HP','Pavilion',current_date,current_date-3,'kembali_stok','22222222-2222-2222-2222-222222222222');

\echo '### 9. Riwayat kondisi: Baik -> Lecet berat, view harus ambil yang TERBARU'
insert into public.display_kondisi (display_unit_id,audit_date,period,kondisi_kode,dicatat_oleh)
select id, current_date-40,'2026-07','baik','22222222-2222-2222-2222-222222222222'
from public.display_unit where serial_number='SN-SDG-002';
insert into public.display_kondisi (display_unit_id,audit_date,period,kondisi_kode,dicatat_oleh)
select id, current_date-5,'2026-08','lecet_berat','22222222-2222-2222-2222-222222222222'
from public.display_unit where serial_number='SN-SDG-002';
select model, kondisi_terakhir_label, kondisi_terakhir_skor, kondisi_terakhir_tanggal
from public.v_display_monitoring where serial_number='SN-SDG-002';

\echo '### 10. Ringkasan per cabang'
select nama_cabang, unit_dipajang, lewat_batas, mendekati_batas, rata_umur_hari, rata_skor_kondisi
from public.v_display_ringkasan_cabang order by lewat_batas desc, nama_cabang;

\echo '### 11. Auditor memalsukan dicatat_oleh jadi owner (harus DITOLAK)'
insert into public.display_unit (branch_id,brand,model,tanggal_pajang,dicatat_oleh)
values (1,'MSI','Katana',current_date,'11111111-1111-1111-1111-111111111111');

\echo '### 12. Auditor mengubah standar 60 hari jadi 200 (harus 0 baris - hanya super_admin)'
update public.display_standar set maks_hari_pajang=200 where id=1;

\echo '### 13. Super admin mengubah standar (harus 1 baris)'
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update public.display_standar set maks_hari_pajang=45 where id=1;
select maks_hari_pajang from public.display_standar;
