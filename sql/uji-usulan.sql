\set ON_ERROR_STOP off
grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id,email) values
 ('11111111-1111-1111-1111-111111111111','owner@kla.test'),
 ('22222222-2222-2222-2222-222222222222','auditorA@kla.test');
update public.profiles set role='super_admin' where id='11111111-1111-1111-1111-111111111111';

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

\echo '### 1. auditor mengusulkan kondisi baru, skor diwarisi Lecet berat=55 (harus BERHASIL)'
insert into public.display_kondisi_opsi (kode,label,skor,urutan,aktif,usulan,diusulkan_oleh)
values ('engsel_longgar','Engsel longgar',55,90,true,true,'22222222-2222-2222-2222-222222222222');

\echo '### 2. auditor menyelundupkan usulan=false biar tampak resmi (harus DITOLAK)'
insert into public.display_kondisi_opsi (kode,label,skor,urutan,aktif,usulan,diusulkan_oleh)
values ('palsu','Kondisi Resmi Palsu',100,1,true,false,'22222222-2222-2222-2222-222222222222');

\echo '### 3. auditor mengaku-aku atas nama owner (harus DITOLAK)'
insert into public.display_kondisi_opsi (kode,label,skor,urutan,aktif,usulan,diusulkan_oleh)
values ('atasnama','Atas Nama Orang Lain',80,90,true,true,'11111111-1111-1111-1111-111111111111');

\echo '### 4. auditor mengubah istilah RESMI yang sudah dipakai data lama (harus 0 baris)'
update public.display_kondisi_opsi set label='Bagus Banget' where kode='baik';

\echo '### 5. istilah kembar beda huruf besar-kecil (harus DITOLAK unique index)'
insert into public.display_kondisi_opsi (kode,label,skor,urutan,aktif,usulan,diusulkan_oleh)
values ('engsel2','  ENGSEL LONGGAR  ',55,90,true,true,'22222222-2222-2222-2222-222222222222');

\echo '### 6. perlakuan baru (harus BERHASIL)'
insert into public.display_perlakuan (kode,label,urutan,aktif,usulan,diusulkan_oleh)
values ('pinjam_pameran','Dipinjamkan ke pameran',90,true,true,'22222222-2222-2222-2222-222222222222');

\echo '### 7. skor ikut berubah? unit dgn kondisi baru (55) menggantikan Baik (100)'
insert into public.display_unit (id,branch_id,brand,model,serial_number,tanggal_pajang,dicatat_oleh) values
 ('bbbbbbb1-0000-0000-0000-000000000001',1,'ASUS','ROG','SN-1','2026-06-08','22222222-2222-2222-2222-222222222222'),
 ('bbbbbbb1-0000-0000-0000-000000000002',1,'Lenovo','X1','SN-2','2026-06-25','22222222-2222-2222-2222-222222222222'),
 ('bbbbbbb1-0000-0000-0000-000000000003',1,'Acer','Swift','SN-3','2026-07-25','22222222-2222-2222-2222-222222222222'),
 ('bbbbbbb1-0000-0000-0000-000000000004',1,'HP','Pavilion','SN-4','2026-08-07','22222222-2222-2222-2222-222222222222');
insert into public.display_kondisi (display_unit_id,audit_date,period,kondisi_kode,dicatat_oleh) values
 ('bbbbbbb1-0000-0000-0000-000000000001','2026-08-19','2026-08','lecet_ringan','22222222-2222-2222-2222-222222222222'),
 ('bbbbbbb1-0000-0000-0000-000000000002','2026-08-19','2026-08','engsel_longgar','22222222-2222-2222-2222-222222222222'),
 ('bbbbbbb1-0000-0000-0000-000000000003','2026-08-19','2026-08','baik','22222222-2222-2222-2222-222222222222'),
 ('bbbbbbb1-0000-0000-0000-000000000004','2026-08-19','2026-08','baik','22222222-2222-2222-2222-222222222222');
select unit_dalam_batas||'/'||unit_dinilai as dalam_batas, skor_umur, skor_kondisi, skor_display
from public.v_display_skor_periode;

\echo '### 8. daftar usulan yang menunggu ditinjau'
select jenis, label, catatan as skor, diusulkan_oleh from public.v_display_usulan order by jenis, label;

\echo '### 9. super admin merapikan istilah usulan jadi resmi (harus BERHASIL)'
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update public.display_kondisi_opsi set label='Engsel longgar / goyang', usulan=false, urutan=4 where kode='engsel_longgar';
select label, skor, usulan from public.display_kondisi_opsi where kode='engsel_longgar';
