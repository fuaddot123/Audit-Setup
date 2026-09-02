-- =========================================================================
-- KLA RADAR — AKSES ANTAR AUDITOR  (tambahan)
--
-- Dijalankan SESUDAH schema.sql. Menjawab: "Kristianto bisa akses punya
-- Fuad dan Yuni."
--
-- CARA KERJANYA — dan kenapa dibuat begini:
--
-- Yang diberikan cuma HAK BACA. Tidak ada mekanisme menulis atas nama orang
-- lain, dan itu disengaja. RLS insert di seluruh modul mensyaratkan
-- submitted_by = auth.uid(), jadi walaupun tampilan sedang menampilkan data
-- Yuni, apa pun yang disimpan tetap tercatat atas nama pengguna sungguhan.
-- Berita Acara yang bertanda tangan "Yuni" tapi diisi orang lain akan
-- merusak justru barang yang dijual aplikasi ini.
--
-- Pemberian akses HANYA bisa dilakukan Super Admin. Auditor tidak bisa
-- memberi akses kepada dirinya sendiri — kalau bisa, seluruh pemisahan data
-- antar-auditor jadi pagar yang bisa dibuka dari dalam.
-- =========================================================================


-- =========================================================================
-- BAGIAN 1 — DAFTAR PEMBERIAN AKSES
-- =========================================================================

create table if not exists public.akses_auditor (
  pemilik_id   uuid not null references public.profiles(id) on delete cascade,  -- datanya siapa
  penerima_id  uuid not null references public.profiles(id) on delete cascade,  -- yang boleh melihat
  aktif        boolean not null default true,
  catatan      text,
  diberikan_oleh uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  primary key (pemilik_id, penerima_id),
  constraint akses_bukan_diri_sendiri check (pemilik_id <> penerima_id)
);

create index if not exists idx_akses_penerima on public.akses_auditor (penerima_id) where aktif;

-- Apakah pengguna sekarang boleh melihat data milik `pemilik`?
-- security definer + search_path terkunci, seperti fungsi lain di skema ini.
create or replace function public.boleh_lihat(pemilik uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select pemilik is not null and exists (
    select 1 from public.akses_auditor a
    where a.pemilik_id = pemilik
      and a.penerima_id = (select auth.uid())
      and a.aktif
  )
$$;

-- Daftar akun yang boleh dilihat pengguna sekarang — ini yang mengisi
-- tombol pindah akun di aplikasi. Dirinya sendiri selalu ikut.
create or replace view public.v_akun_bisa_dilihat as
select p.id, p.full_name, p.role,
       (p.id = (select auth.uid())) as diri_sendiri
from public.profiles p
where p.id = (select auth.uid())
   or public.current_role_name() = 'super_admin'
   or exists (
        select 1 from public.akses_auditor a
        where a.pemilik_id = p.id and a.penerima_id = (select auth.uid()) and a.aktif
      );

alter table public.akses_auditor enable row level security;

drop policy if exists "akses_select" on public.akses_auditor;
drop policy if exists "akses_write"  on public.akses_auditor;

-- Boleh melihat baris yang menyangkut dirinya; Super Admin melihat semua.
create policy "akses_select" on public.akses_auditor
  for select to authenticated using (
    public.current_role_name() = 'super_admin'
    or penerima_id = (select auth.uid())
    or pemilik_id  = (select auth.uid())
  );

-- HANYA Super Admin yang boleh memberi/mencabut. Ini pagar utamanya.
create policy "akses_write" on public.akses_auditor
  for all to authenticated
  using (public.current_role_name() = 'super_admin')
  with check (public.current_role_name() = 'super_admin');

alter view public.v_akun_bisa_dilihat set (security_invoker = on);
grant select on public.v_akun_bisa_dilihat to authenticated;


-- =========================================================================
-- BAGIAN 2 — POLICY SELECT DIPERLUAS
-- =========================================================================
-- Hanya baris "or public.boleh_lihat(...)" yang ditambahkan. Sisa aturannya
-- persis seperti di schema.sql — isolasi antar-auditor tetap berlaku untuk
-- siapa pun yang tidak diberi akses.

drop policy if exists "keuangan_select" on public.audit_keuangan;
create policy "keuangan_select" on public.audit_keuangan
  for select to authenticated using (
    public.is_privileged()
    or period < public.isolation_start_period()
    or submitted_by = (select auth.uid())
    or public.boleh_lihat(submitted_by)
  );

drop policy if exists "generic_select" on public.audit_generic;
create policy "generic_select" on public.audit_generic
  for select to authenticated using (
    public.is_privileged()
    or period < public.isolation_start_period()
    or submitted_by = (select auth.uid())
    or public.boleh_lihat(submitted_by)
  );

drop policy if exists "ba_select" on public.berita_acara;
create policy "ba_select" on public.berita_acara
  for select to authenticated using (
    public.is_privileged()
    or period < public.isolation_start_period()
    or submitted_by = (select auth.uid())
    or public.boleh_lihat(submitted_by)
  );

drop policy if exists "sched_select" on public.audit_schedule;
create policy "sched_select" on public.audit_schedule
  for select to authenticated using (
    public.is_privileged()
    or start_date < (public.isolation_start_period() || '-01')::date
    or auditor_id = (select auth.uid())
    or public.boleh_lihat(auditor_id)
  );

drop policy if exists "kpi_select" on public.audit_kpi;
create policy "kpi_select" on public.audit_kpi
  for select to authenticated using (
    public.is_privileged()
    or period < public.isolation_start_period()
    or auditor_id = (select auth.uid())
    or public.boleh_lihat(auditor_id)
  );

drop policy if exists "dinas_select" on public.dinas_luar_kota;
create policy "dinas_select" on public.dinas_luar_kota
  for select to authenticated using (
    public.is_privileged()
    or auditor_id = (select auth.uid())
    or public.boleh_lihat(auditor_id)
  );


-- =========================================================================
-- BAGIAN 3 — MEMBERIKAN AKSESNYA
-- =========================================================================
-- Bisa lewat menu Master Data di aplikasi, atau langsung di sini.
-- Ganti ketiga alamat email di bawah dengan yang sebenarnya.
--
--   insert into public.akses_auditor (pemilik_id, penerima_id, catatan, diberikan_oleh)
--   select pemilik.id, penerima.id, 'Supervisi audit', (select auth.uid())
--   from public.profiles penerima
--   cross join public.profiles pemilik
--   where penerima.full_name ilike '%kristianto%'
--     and pemilik.full_name in ('Fuad', 'Yuni')
--   on conflict (pemilik_id, penerima_id) do update set aktif = true;
--
-- Memeriksa hasilnya:
--
--   select pm.full_name as datanya_siapa, pn.full_name as boleh_dilihat_oleh, a.aktif
--   from public.akses_auditor a
--   join public.profiles pm on pm.id = a.pemilik_id
--   join public.profiles pn on pn.id = a.penerima_id;
--
-- Mencabut (jangan dihapus — biar jejaknya tetap ada):
--
--   update public.akses_auditor set aktif = false
--   where penerima_id = (select id from public.profiles where full_name ilike '%kristianto%');
-- =========================================================================
