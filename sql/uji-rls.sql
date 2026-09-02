\set ON_ERROR_STOP off
grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;

insert into auth.users (id, email) values
 ('11111111-1111-1111-1111-111111111111','owner@kla.test'),
 ('22222222-2222-2222-2222-222222222222','auditorA@kla.test'),
 ('33333333-3333-3333-3333-333333333333','auditorB@kla.test');
update public.profiles set role='super_admin' where id='11111111-1111-1111-1111-111111111111';

\echo '### 1. trigger bikin 3 profil otomatis, 1 diangkat jadi super_admin'
select role, count(*) from public.profiles group by role order by role;

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
\echo '### 2. auditor A menyimpan kas kecil (harus BERHASIL)'
insert into public.audit_keuangan (branch_id, period, submitted_by, pengeluaran)
values (1,'2026-08','22222222-2222-2222-2222-222222222222', 500000);
\echo '### 3. auditor A memalsukan submitted_by jadi auditor B (harus DITOLAK)'
insert into public.audit_keuangan (branch_id, period, submitted_by)
values (1,'2026-08','33333333-3333-3333-3333-333333333333', 0);
\echo '### 4. auditor A menyimpan langsung berstatus approved (harus DITOLAK)'
insert into public.audit_keuangan (branch_id, period, submitted_by, status)
values (1,'2026-08','22222222-2222-2222-2222-222222222222','approved');
\echo '### 5. auditor A menaikkan perannya sendiri jadi super_admin (harus 0 baris)'
update public.profiles set role='super_admin' where id='22222222-2222-2222-2222-222222222222';
\echo '### 6. auditor A mengubah NIK sendiri (harus 1 baris)'
update public.profiles set nik='3374xxxx' where id='22222222-2222-2222-2222-222222222222';

set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
\echo '### 7. auditor B melihat kas kecil (harus 0 baris - data punya A)'
select count(*) as terlihat_oleh_B from public.audit_keuangan;
\echo '### 8. auditor B menghapus data A (harus 0 baris)'
delete from public.audit_keuangan where period='2026-08';

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
\echo '### 9. super_admin melihat semua (harus 1 baris)'
select count(*) as terlihat_oleh_owner from public.audit_keuangan;
\echo '### 10. super_admin menyetujui (harus 1 baris)'
update public.audit_keuangan set status='approved' where period='2026-08';
\echo '### 11. super_admin menghapus (harus 1 baris)'
delete from public.audit_keuangan where period='2026-08';
\echo '### 12. super_admin mengangkat auditor B jadi ceo (harus 1 baris)'
update public.profiles set role='ceo' where id='33333333-3333-3333-3333-333333333333';
reset role;
\echo '### 13. modul salah nama (harus DITOLAK oleh CHECK)'
insert into public.audit_generic (module, branch_id, period) values ('kpi',1,'2026-08');
\echo '### 14. updated_at ikut berubah saat diedit?'
insert into public.audit_kpi (auditor_id, period) values ('22222222-2222-2222-2222-222222222222','2026-08');
update public.audit_kpi set realisasi_coverage=5 where period='2026-08';
select (updated_at > created_at) as updated_at_bergerak from public.audit_kpi;
