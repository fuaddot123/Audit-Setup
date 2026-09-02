set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
\echo '### A. auditor mengubah limit_kas (harus BERHASIL)'
update public.branches set limit_kas = 5000000 where id = 1;
\echo '### B. auditor mengganti NAMA cabang (harus DITOLAK trigger)'
update public.branches set name = 'Cabang Palsu' where id = 1;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
\echo '### C. super_admin mengganti nama cabang (harus BERHASIL)'
update public.branches set name = 'Semarang Kota' where id = 1;
\echo '### D. jadwal: super_admin membuat jadwal (harus DITOLAK - Timeline.js hanya auditor)'
insert into public.audit_schedule (branch_id, auditor_id, start_date, end_date)
values (1,'11111111-1111-1111-1111-111111111111','2026-08-01','2026-08-03');
