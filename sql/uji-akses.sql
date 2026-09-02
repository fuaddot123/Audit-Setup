\set ON_ERROR_STOP off
grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
insert into auth.users (id,email) values
 ('00000000-0000-0000-0000-00000000000a','owner@kla.test'),
 ('00000000-0000-0000-0000-00000000000b','kristianto@kla.test'),
 ('00000000-0000-0000-0000-00000000000c','fuad@kla.test'),
 ('00000000-0000-0000-0000-00000000000d','yuni@kla.test'),
 ('00000000-0000-0000-0000-00000000000e','rina@kla.test');
update public.profiles set role='super_admin', full_name='Owner' where id='00000000-0000-0000-0000-00000000000a';
update public.profiles set full_name='Kristianto' where id='00000000-0000-0000-0000-00000000000b';
update public.profiles set full_name='Fuad'       where id='00000000-0000-0000-0000-00000000000c';
update public.profiles set full_name='Yuni'       where id='00000000-0000-0000-0000-00000000000d';
update public.profiles set full_name='Rina'       where id='00000000-0000-0000-0000-00000000000e';

-- Tiap auditor mengisi kas kecil bulan berjalan (sesudah cutoff isolasi)
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
insert into public.audit_keuangan (branch_id,period,submitted_by,pengeluaran) values (1,'2026-08','00000000-0000-0000-0000-00000000000c',111);
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
insert into public.audit_keuangan (branch_id,period,submitted_by,pengeluaran) values (2,'2026-08','00000000-0000-0000-0000-00000000000d',222);
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
insert into public.audit_keuangan (branch_id,period,submitted_by,pengeluaran) values (3,'2026-08','00000000-0000-0000-0000-00000000000e',333);
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into public.audit_keuangan (branch_id,period,submitted_by,pengeluaran) values (4,'2026-08','00000000-0000-0000-0000-00000000000b',444);

\echo '### 1. SEBELUM diberi akses — Kristianto lihat berapa baris? (harus 1: punyanya sendiri)'
select count(*) as terlihat from public.audit_keuangan;

\echo '### 2. Kristianto memberi akses untuk dirinya sendiri (harus DITOLAK)'
insert into public.akses_auditor (pemilik_id,penerima_id,diberikan_oleh)
values ('00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000b');

\echo '### 3. Super Admin memberi akses Fuad + Yuni ke Kristianto (harus BERHASIL)'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.akses_auditor (pemilik_id,penerima_id,catatan,diberikan_oleh) values
 ('00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000b','Supervisi audit','00000000-0000-0000-0000-00000000000a'),
 ('00000000-0000-0000-0000-00000000000d','00000000-0000-0000-0000-00000000000b','Supervisi audit','00000000-0000-0000-0000-00000000000a');

\echo '### 4. SESUDAH diberi akses — Kristianto lihat 3 baris (dirinya + Fuad + Yuni), BUKAN Rina'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select b.name as cabang, p.full_name as pemilik_data from public.audit_keuangan k
join public.branches b on b.id=k.branch_id join public.profiles p on p.id=k.submitted_by order by b.name;

\echo '### 5. Tombol pindah akun berisi apa untuk Kristianto? (harus 3 nama)'
select full_name, diri_sendiri from public.v_akun_bisa_dilihat order by diri_sendiri desc, full_name;

\echo '### 6. Rina (tanpa akses) tetap hanya lihat punyanya sendiri'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select count(*) as terlihat_oleh_rina from public.audit_keuangan;
select count(*) as akun_di_tombol_rina from public.v_akun_bisa_dilihat;

\echo '### 7. Kristianto MENGUBAH data Fuad (harus 0 baris — akses cuma baca)'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
update public.audit_keuangan set pengeluaran = 999 where submitted_by='00000000-0000-0000-0000-00000000000c';

\echo '### 8. Kristianto MENYIMPAN atas nama Fuad (harus DITOLAK)'
insert into public.audit_keuangan (branch_id,period,submitted_by,pengeluaran)
values (5,'2026-08','00000000-0000-0000-0000-00000000000c',777);

\echo '### 9. Kristianto MENGHAPUS data Yuni (harus 0 baris)'
delete from public.audit_keuangan where submitted_by='00000000-0000-0000-0000-00000000000d';

\echo '### 10. Akses dicabut — Kristianto kembali lihat 1 baris'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public.akses_auditor set aktif=false where penerima_id='00000000-0000-0000-0000-00000000000b';
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select count(*) as terlihat_setelah_dicabut from public.audit_keuangan;
