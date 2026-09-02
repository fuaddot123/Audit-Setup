insert into auth.users (id,email) values ('22222222-2222-2222-2222-222222222222','a@kla.test');
insert into public.display_unit (id,branch_id,brand,model,serial_number,tanggal_pajang,dicatat_oleh,program_brand,program_nama) values
 ('aaaaaaa1-0000-0000-0000-000000000001',1,'ASUS','ROG Strix G16','4KN0CV02X','2026-06-08','22222222-2222-2222-2222-222222222222',false,null),
 ('aaaaaaa1-0000-0000-0000-000000000002',1,'Lenovo','ThinkPad X1 Carbon','PF3TQ9L2','2026-06-25','22222222-2222-2222-2222-222222222222',true,'Lenovo Pro Display Q3'),
 ('aaaaaaa1-0000-0000-0000-000000000003',1,'Acer','Swift Go 14','NXKF6SN001','2026-07-25','22222222-2222-2222-2222-222222222222',false,null),
 ('aaaaaaa1-0000-0000-0000-000000000004',1,'HP','Pavilion Plus 14','5CD3210XYZ','2026-08-07','22222222-2222-2222-2222-222222222222',false,null);
insert into public.display_unit (branch_id,brand,model,serial_number,tanggal_pajang,tanggal_turun,perlakuan_kode,perlakuan_tanggal,harga_jual_display,dicatat_oleh)
 values (1,'MSI','Katana 15','K1552089','2026-05-20','2026-08-19','dijual_display','2026-08-19',11450000,'22222222-2222-2222-2222-222222222222');
insert into public.display_kondisi (display_unit_id,audit_date,period,kondisi_kode,dicatat_oleh) values
 ('aaaaaaa1-0000-0000-0000-000000000001','2026-08-19','2026-08','lecet_ringan','22222222-2222-2222-2222-222222222222'),
 ('aaaaaaa1-0000-0000-0000-000000000002','2026-08-19','2026-08','baik','22222222-2222-2222-2222-222222222222'),
 ('aaaaaaa1-0000-0000-0000-000000000003','2026-08-19','2026-08','baik','22222222-2222-2222-2222-222222222222'),
 ('aaaaaaa1-0000-0000-0000-000000000004','2026-08-19','2026-08','baik','22222222-2222-2222-2222-222222222222');
\echo '=== SKOR DISPLAY (harap: umur 75,0 | kondisi 95,0 | display 85,0) ==='
select nama_cabang, period, unit_dinilai, unit_dalam_batas, skor_umur, skor_kondisi, skor_display
from public.v_display_skor_periode;
\echo '=== bobot digeser jadi 70 umur : 30 kondisi (harap 81,0) ==='
update public.display_standar set bobot_umur=70, bobot_kondisi=30 where id=1;
select skor_umur, skor_kondisi, skor_display from public.v_display_skor_periode;
\echo '=== dicetak ulang "bulan Desember": umur dihitung dari tanggal audit, angka harus TETAP 81,0 ==='
update public.display_standar set bobot_umur=50, bobot_kondisi=50 where id=1;
select skor_display as harus_85 from public.v_display_skor_periode;
\echo '=== bandingkan: umur kalau dihitung dari HARI INI (bukan tgl audit) ==='
select model, (current_date - tanggal_pajang) as umur_hari_ini, ('2026-08-19'::date - tanggal_pajang) as umur_saat_audit
from public.display_unit where branch_id=1 order by tanggal_pajang;
