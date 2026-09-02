-- =========================================================================
-- KLA RADAR (Audit-Setup) — SKEMA DATABASE SUPABASE  [REKONSTRUKSI]
--
-- Disusun ulang dari kode aplikasi (11.775 baris, commit 59e6663, 16 Agu 2026),
-- BUKAN dari schema.sql lama. Skema lama hanya memuat 6 tabel sementara kode
-- menyentuh 12, memakai peran 'admin'/'ceo' yang tidak ada di kode, dan
-- melarang 'super_admin' yang dipakai 24 kali.
--
-- CARA PAKAI: Supabase Dashboard > SQL Editor > New query > tempel > Run.
-- Aman dijalankan berulang (idempoten). TIDAK ADA satu pun perintah
-- DROP TABLE — data yang sudah ada tidak akan hilang.
--
-- PERINGATAN: Bagian 0-5 mengubah CHECK constraint yang sudah terpasang.
-- Ambil cadangan dulu: Dashboard > Database > Backups.
-- =========================================================================


-- =========================================================================
-- BAGIAN 0 — KONSTANTA & FUNGSI BANTU
-- =========================================================================

-- Tanggal mulai isolasi data antar-auditor. Di kode nilainya "2026-08",
-- diketik ulang di 4 berkas (AuditKeuangan, AuditKPI, BeritaAcara, StokLaporan).
-- Di sini SATU sumber saja — semua RLS di bawah mengacu ke fungsi ini.
create or replace function public.isolation_start_period()
returns text language sql immutable
as $$ select '2026-08'::text $$;

-- CATATAN URUTAN: current_role_name() & is_privileged() TIDAK bisa ditaruh di
-- sini. Keduanya "language sql" yang membaca tabel public.profiles, dan
-- Postgres memeriksa isi fungsi sql saat dibuat — tabelnya harus sudah ada
-- lebih dulu. Karena itu dua fungsi tersebut ada di akhir Bagian 1.

-- Menjaga kolom updated_at benar-benar terisi. Skema lama punya
-- "default now()" tapi tanpa trigger, jadi nilainya tidak pernah berubah
-- setelah baris dibuat.
create or replace function public.touch_updated_at()
returns trigger language plpgsql
as $$ begin new.updated_at = now(); return new; end $$;


-- =========================================================================
-- BAGIAN 1 — PROFIL & PERAN
-- =========================================================================

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  nik         text,                      -- dipakai dokumen SPDLK (BiayaDinas.js:494)
  role        text not null default 'auditor',
  created_at  timestamptz not null default now()
);

alter table public.profiles add column if not exists nik text;

-- Peran yang BENAR-BENAR dipakai kode: super_admin & auditor.
-- ceo & viewer ikut diizinkan karena Sidebar.js:71 sudah menyiapkan labelnya.
-- 'admin' DIBUANG — tidak ada satu baris kode pun yang memakainya.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('super_admin', 'auditor', 'ceo', 'viewer'));

-- Peran user yang sedang login.
-- security definer + search_path terkunci: tanpa "set search_path", fungsi
-- security definer bisa dibajak lewat schema palsu (Supabase linter menandainya
-- sebagai function_search_path_mutable).
create or replace function public.current_role_name()
returns text
language sql stable security definer
set search_path = ''
as $$ select role from public.profiles where id = (select auth.uid()) $$;

-- true kalau user sekarang BUKAN auditor biasa (super_admin/ceo/viewer).
-- Tidak punya baris profil => false. Gagal ke arah aman.
create or replace function public.is_privileged()
returns boolean language sql stable
as $$ select coalesce(public.current_role_name() <> 'auditor', false) $$;

-- Baris profil dibuat otomatis saat ada pendaftaran baru. Default 'auditor'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'auditor')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- =========================================================================
-- BAGIAN 2 — CABANG
-- =========================================================================

create table if not exists public.branches (
  id          serial primary key,
  name        text unique not null,
  limit_kas   numeric not null default 0,   -- AuditKeuangan.js:237 & :315
  created_at  timestamptz not null default now()
);

alter table public.branches add column if not exists limit_kas numeric not null default 0;

insert into public.branches (name) values
  ('Semarang'), ('Yogyakarta'), ('Slawi'), ('Tegal'), ('Pekalongan'), ('Cirebon'),
  ('Kediri'), ('Ngaliyan'), ('Sukoharjo'), ('Surabaya MERR'), ('Mojokerto'),
  ('Surabaya Babatan'), ('Purwokerto')
on conflict (name) do nothing;

-- Auditor perlu bisa menulis kolom limit_kas, tapi TIDAK boleh mengganti nama
-- cabang. RLS tidak bisa membatasi per-kolom, jadi dipagari trigger.
create or replace function public.guard_branch_name()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.name is distinct from old.name and public.current_role_name() <> 'super_admin' then
    raise exception 'Hanya Super Admin yang boleh mengubah nama cabang';
  end if;
  return new;
end $$;

drop trigger if exists guard_branch_name_trg on public.branches;
create trigger guard_branch_name_trg
  before update on public.branches
  for each row execute function public.guard_branch_name();


-- =========================================================================
-- BAGIAN 3 — AMBANG BATAS INDIKATOR KEUANGAN
-- =========================================================================

create table if not exists public.settings_keuangan (
  id            int primary key default 1,
  terkendali    numeric not null default 70,
  efisien       numeric not null default 95,
  monitoring    numeric not null default 105,
  constraint single_row check (id = 1)
);
insert into public.settings_keuangan (id) values (1) on conflict (id) do nothing;


-- =========================================================================
-- BAGIAN 4 — AUDIT KEUANGAN (kas kecil)
-- =========================================================================
-- 4 kolom di bawah TIDAK ADA di skema lama padahal ditulis setiap kali simpan
-- (AuditKeuangan.js:283-296): audit_date, sisa_saldo, cabang_baru, tidak_visit.

create table if not exists public.audit_keuangan (
  id                uuid primary key default gen_random_uuid(),
  branch_id         int not null references public.branches(id) on delete cascade,
  period            text not null,                    -- 'YYYY-MM'
  audit_date        date,
  saldo_sebelumnya  numeric not null default 0,
  saldo_masuk       numeric not null default 0,
  limit_kas         numeric not null default 0,
  pengeluaran       numeric not null default 0,
  sisa_saldo        numeric not null default 0,
  cabang_baru       boolean not null default false,
  tidak_visit       boolean not null default false,
  status            text not null default 'draft'
                    check (status in ('draft','submitted','approved','rejected')),
  catatan_ceo       text,
  submitted_by      uuid references public.profiles(id),
  approved_by       uuid references public.profiles(id),
  approved_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.audit_keuangan add column if not exists audit_date   date;
alter table public.audit_keuangan add column if not exists sisa_saldo   numeric not null default 0;
alter table public.audit_keuangan add column if not exists cabang_baru  boolean not null default false;
alter table public.audit_keuangan add column if not exists tidak_visit  boolean not null default false;

-- Skema lama memasang unique(branch_id, period) — itu SALAH. Kode jelas
-- menyimpan banyak entri per cabang per bulan (entriesHere adalah array,
-- lalu diambil latestOf()). Kunjungan audit kedua di bulan yang sama akan
-- ditolak kalau constraint ini dibiarkan.
alter table public.audit_keuangan drop constraint if exists audit_keuangan_branch_id_period_key;

create index if not exists idx_keuangan_branch_period on public.audit_keuangan (branch_id, period);
create index if not exists idx_keuangan_submitted_by  on public.audit_keuangan (submitted_by);

drop trigger if exists touch_keuangan on public.audit_keuangan;
create trigger touch_keuangan before update on public.audit_keuangan
  for each row execute function public.touch_updated_at();


-- =========================================================================
-- BAGIAN 5 — AUDIT GENERIC (SOP / Inventaris / Stok)
-- =========================================================================
-- CHECK lama hanya mengizinkan (sop, service, stok, kpi). Kode memakai 4 nilai
-- lain — 3 di antaranya tidak akan pernah bisa disimpan.

create table if not exists public.audit_generic (
  id            uuid primary key default gen_random_uuid(),
  module        text not null,
  branch_id     int not null references public.branches(id) on delete cascade,
  period        text not null,
  data          jsonb not null default '{}'::jsonb,
  status        text not null default 'draft'
                check (status in ('draft','submitted','approved','rejected')),
  submitted_by  uuid references public.profiles(id),
  approved_by   uuid references public.profiles(id),
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.audit_generic drop constraint if exists audit_generic_module_check;
alter table public.audit_generic add constraint audit_generic_module_check
  check (module in ('sop', 'inventaris', 'stok_kesehatan', 'stok_service'));

-- Sama seperti audit_keuangan: unique(module,branch_id,period) DIBUANG karena
-- semua modul UI menyimpan banyak entri per periode (latestFor() menyortir
-- beberapa baris). Lihat CATATAN 2 soal endpoint sync.
alter table public.audit_generic drop constraint if exists audit_generic_module_branch_id_period_key;

create index if not exists idx_generic_lookup       on public.audit_generic (module, branch_id, period);
create index if not exists idx_generic_submitted_by on public.audit_generic (submitted_by);
create index if not exists idx_generic_updated_at   on public.audit_generic (updated_at desc);

drop trigger if exists touch_generic on public.audit_generic;
create trigger touch_generic before update on public.audit_generic
  for each row execute function public.touch_updated_at();


-- =========================================================================
-- BAGIAN 6 — BERITA ACARA  [TABEL BARU — tidak ada di skema lama]
-- =========================================================================

create table if not exists public.berita_acara (
  id                  uuid primary key default gen_random_uuid(),
  branch_id           int not null references public.branches(id) on delete cascade,
  period              text not null,
  audit_date          date,
  waktu_audit         text,
  kegiatan            text,
  perlengkapan        text,
  stock_opname_kat1   jsonb not null default '[]'::jsonb,
  stock_opname_kat2   jsonb not null default '[]'::jsonb,
  store_manager_name  text,
  store_leader_name   text,
  tidak_visit         boolean not null default false,
  cabang_baru         boolean not null default false,
  submitted_by        uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_ba_branch_period on public.berita_acara (branch_id, period);
create index if not exists idx_ba_submitted_by  on public.berita_acara (submitted_by);

drop trigger if exists touch_ba on public.berita_acara;
create trigger touch_ba before update on public.berita_acara
  for each row execute function public.touch_updated_at();


-- =========================================================================
-- BAGIAN 7 — JADWAL AUDIT (Timeline)  [TABEL BARU]
-- =========================================================================

create table if not exists public.audit_schedule (
  id          uuid primary key default gen_random_uuid(),
  branch_id   int not null references public.branches(id) on delete cascade,
  auditor_id  uuid references public.profiles(id) on delete set null,
  start_date  date not null,
  end_date    date not null,
  notes       text,
  color       text,
  status      text not null default 'Terjadwal'
              check (status in ('Terjadwal','Sudah Visit','Ada Kendala')),
  status_note text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  constraint audit_schedule_date_order check (end_date >= start_date)
);

create index if not exists idx_sched_start   on public.audit_schedule (start_date);
create index if not exists idx_sched_auditor on public.audit_schedule (auditor_id);


-- =========================================================================
-- BAGIAN 8 — KPI AUDITOR  [TABEL BARU]
-- =========================================================================
-- AuditKPI.js:358 memakai upsert onConflict "auditor_id,period" —
-- jadi unique di sini WAJIB ada, berbeda dengan tabel audit lainnya.

create table if not exists public.audit_kpi (
  id                           uuid primary key default gen_random_uuid(),
  auditor_id                   uuid not null references public.profiles(id) on delete cascade,
  period                       text not null,
  realisasi_coverage           numeric not null default 0,
  realisasi_kepatuhan_sop      numeric not null default 0,   -- disimpan 0..1 (UI membagi 100)
  realisasi_temuan_berulang    numeric not null default 0,
  realisasi_temuan_audit       numeric not null default 0,
  realisasi_ketepatan_laporan  numeric not null default 0,
  submitted_by                 uuid references public.profiles(id),
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  unique (auditor_id, period)
);

create index if not exists idx_kpi_period on public.audit_kpi (period desc);

drop trigger if exists touch_kpi on public.audit_kpi;
create trigger touch_kpi before update on public.audit_kpi
  for each row execute function public.touch_updated_at();


-- =========================================================================
-- BAGIAN 9 — BIAYA DINAS LUAR KOTA (SPDLK)  [TABEL BARU]
-- =========================================================================

create table if not exists public.dinas_luar_kota (
  id                uuid primary key default gen_random_uuid(),
  doc_seq           bigint generated by default as identity,  -- nomor SPDLK (BiayaDinas.js:11)
  auditor_id        uuid not null references public.profiles(id) on delete cascade,
  period            text not null,
  maksud            text,
  tujuan_kota       text not null,
  tanggal_mulai     date not null,
  tanggal_selesai   date,
  jenis_perjalanan  text not null default 'Sementara'
                    check (jenis_perjalanan in ('Sementara','Mandah')),
  items             jsonb not null default '[]'::jsonb,
  total_anggaran    numeric not null default 0,
  realisasi_items   jsonb,
  total_realisasi   numeric,
  catatan_khusus    text,
  submitted_by      uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_dinas_auditor on public.dinas_luar_kota (auditor_id);
create index if not exists idx_dinas_mulai   on public.dinas_luar_kota (tanggal_mulai desc);

drop trigger if exists touch_dinas on public.dinas_luar_kota;
create trigger touch_dinas before update on public.dinas_luar_kota
  for each row execute function public.touch_updated_at();


-- =========================================================================
-- BAGIAN 10 — TABEL YANG DIBACA TAPI BELUM DIPAKAI
-- =========================================================================
-- SopLaporan.js:41-42 mengambil kedua tabel ini, lalu hasilnya tidak pernah
-- dipakai di mana pun (rankingRows & targetRows cuma di-set, tidak dibaca).
-- Kolomnya karena itu TIDAK BISA disimpulkan dari kode — ini kerangka minimum
-- supaya query-nya tidak error. Lihat CATATAN 3.

create table if not exists public.ranking_scores (
  id          uuid primary key default gen_random_uuid(),
  branch_id   int references public.branches(id) on delete cascade,
  period      text,
  score       numeric,
  created_at  timestamptz not null default now()
);

create table if not exists public.sales_targets (
  id          uuid primary key default gen_random_uuid(),
  branch_id   int references public.branches(id) on delete cascade,
  period      text,
  target      numeric,
  created_at  timestamptz not null default now()
);

-- Tabel findings dari skema lama SENGAJA dipertahankan walau tidak dipakai
-- satu baris kode pun — foto bukti disimpan sebagai URL di audit_generic.data.
-- Yang benar-benar dipakai adalah BUCKET storage bernama "findings" (Bagian 12).
create table if not exists public.findings (
  id          uuid primary key default gen_random_uuid(),
  module      text not null,
  branch_id   int references public.branches(id) on delete cascade,
  description text,
  photo_url   text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);


-- =========================================================================
-- BAGIAN 11 — ROW LEVEL SECURITY
-- =========================================================================
-- Yang berubah dari skema lama:
--   1. Semua policy diberi "to authenticated" — anon tidak dapat apa-apa.
--   2. Isolasi antar-auditor DIPINDAH dari browser ke sini. Sebelumnya
--      pembatasnya hanya query di klien, sementara RLS mengizinkan setiap
--      user yang login membaca SEMUA baris.
--   3. auth.uid() dibungkus (select ...) supaya dievaluasi sekali, bukan
--      per baris — selisih kecepatannya terasa di tabel ribuan baris.
--   4. Ada policy DELETE. Tanpa itu .delete() memulangkan "0 baris terhapus
--      tanpa error", dan aplikasi mengira berhasil padahal datanya utuh.
--   5. submitted_by / auditor_id dipaksa sama dengan pengirim sungguhan,
--      jadi jejak audit tidak bisa dipalsukan dari browser.

alter table public.profiles          enable row level security;
alter table public.branches          enable row level security;
alter table public.settings_keuangan enable row level security;
alter table public.audit_keuangan    enable row level security;
alter table public.audit_generic     enable row level security;
alter table public.berita_acara      enable row level security;
alter table public.audit_schedule    enable row level security;
alter table public.audit_kpi         enable row level security;
alter table public.dinas_luar_kota   enable row level security;
alter table public.ranking_scores    enable row level security;
alter table public.sales_targets     enable row level security;
alter table public.findings          enable row level security;

-- ── PROFILES ────────────────────────────────────────────────────────────
drop policy if exists "profiles_select"       on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;
drop policy if exists "profiles_update_self"  on public.profiles;

create policy "profiles_select" on public.profiles
  for select to authenticated using (true);

-- User boleh mengubah data dirinya sendiri (nama, NIK) TAPI tidak boleh
-- menaikkan perannya sendiri — with check mengunci kolom role.
create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and role = public.current_role_name());

create policy "profiles_update_admin" on public.profiles
  for update to authenticated
  using (public.current_role_name() = 'super_admin');

-- ── BRANCHES ────────────────────────────────────────────────────────────
drop policy if exists "branches_select"       on public.branches;
drop policy if exists "branches_write_admin"  on public.branches;
drop policy if exists "branches_update"       on public.branches;
drop policy if exists "branches_insert_admin" on public.branches;
drop policy if exists "branches_delete_admin" on public.branches;

create policy "branches_select" on public.branches
  for select to authenticated using (true);
-- limit_kas diubah dari modul Audit Keuangan; nama dijaga trigger di Bagian 2.
create policy "branches_update" on public.branches
  for update to authenticated
  using (public.current_role_name() in ('auditor','super_admin'));
create policy "branches_insert_admin" on public.branches
  for insert to authenticated
  with check (public.current_role_name() = 'super_admin');
create policy "branches_delete_admin" on public.branches
  for delete to authenticated
  using (public.current_role_name() = 'super_admin');

-- ── SETTINGS ────────────────────────────────────────────────────────────
drop policy if exists "settings_select"      on public.settings_keuangan;
drop policy if exists "settings_write_admin" on public.settings_keuangan;

create policy "settings_select" on public.settings_keuangan
  for select to authenticated using (true);
create policy "settings_write_admin" on public.settings_keuangan
  for update to authenticated
  using (public.current_role_name() = 'super_admin');

-- ── AUDIT KEUANGAN ──────────────────────────────────────────────────────
drop policy if exists "keuangan_select"         on public.audit_keuangan;
drop policy if exists "keuangan_insert"         on public.audit_keuangan;
drop policy if exists "keuangan_update_auditor" on public.audit_keuangan;
drop policy if exists "keuangan_update_ceo"     on public.audit_keuangan;
drop policy if exists "keuangan_update"         on public.audit_keuangan;
drop policy if exists "keuangan_delete"         on public.audit_keuangan;

-- Auditor: hanya data lama (sebelum cutoff) + data yang dia kirim sendiri.
create policy "keuangan_select" on public.audit_keuangan
  for select to authenticated using (
    public.is_privileged()
    or period < public.isolation_start_period()
    or submitted_by = (select auth.uid())
  );

create policy "keuangan_insert" on public.audit_keuangan
  for insert to authenticated with check (
    public.current_role_name() in ('auditor','super_admin')
    and submitted_by = (select auth.uid())
    and status = 'draft'
  );

create policy "keuangan_update" on public.audit_keuangan
  for update to authenticated
  using (
    public.current_role_name() = 'super_admin'
    or (public.current_role_name() = 'auditor'
        and submitted_by = (select auth.uid())
        and status in ('draft','submitted'))
  )
  with check (
    public.current_role_name() = 'super_admin'
    or (public.current_role_name() = 'auditor' and status in ('draft','submitted'))
  );

create policy "keuangan_delete" on public.audit_keuangan
  for delete to authenticated
  using (public.current_role_name() = 'super_admin');

-- ── AUDIT GENERIC ───────────────────────────────────────────────────────
drop policy if exists "generic_select"         on public.audit_generic;
drop policy if exists "generic_insert"         on public.audit_generic;
drop policy if exists "generic_update_auditor" on public.audit_generic;
drop policy if exists "generic_update_ceo"     on public.audit_generic;
drop policy if exists "generic_update"         on public.audit_generic;
drop policy if exists "generic_delete"         on public.audit_generic;

create policy "generic_select" on public.audit_generic
  for select to authenticated using (
    public.is_privileged()
    or period < public.isolation_start_period()
    or submitted_by = (select auth.uid())
  );

create policy "generic_insert" on public.audit_generic
  for insert to authenticated with check (
    public.current_role_name() in ('auditor','super_admin')
    and submitted_by = (select auth.uid())
  );

create policy "generic_update" on public.audit_generic
  for update to authenticated
  using (
    public.current_role_name() = 'super_admin'
    or (public.current_role_name() = 'auditor'
        and submitted_by = (select auth.uid())
        and status in ('draft','submitted'))
  );

create policy "generic_delete" on public.audit_generic
  for delete to authenticated
  using (
    public.current_role_name() = 'super_admin'
    or (public.current_role_name() = 'auditor' and submitted_by = (select auth.uid()))
  );

-- ── BERITA ACARA ────────────────────────────────────────────────────────
drop policy if exists "ba_select" on public.berita_acara;
drop policy if exists "ba_insert" on public.berita_acara;
drop policy if exists "ba_update" on public.berita_acara;
drop policy if exists "ba_delete" on public.berita_acara;

create policy "ba_select" on public.berita_acara
  for select to authenticated using (
    public.is_privileged()
    or period < public.isolation_start_period()
    or submitted_by = (select auth.uid())
  );
create policy "ba_insert" on public.berita_acara
  for insert to authenticated with check (
    public.current_role_name() in ('auditor','super_admin')
    and submitted_by = (select auth.uid())
  );
create policy "ba_update" on public.berita_acara
  for update to authenticated using (
    public.current_role_name() = 'super_admin'
    or (public.current_role_name() = 'auditor' and submitted_by = (select auth.uid()))
  );
create policy "ba_delete" on public.berita_acara
  for delete to authenticated using (
    public.current_role_name() = 'super_admin'
    or (public.current_role_name() = 'auditor' and submitted_by = (select auth.uid()))
  );

-- ── JADWAL AUDIT ────────────────────────────────────────────────────────
-- Timeline.js:81 → canManage = HANYA 'auditor'. Super Admin melihat saja.
drop policy if exists "sched_select" on public.audit_schedule;
drop policy if exists "sched_insert" on public.audit_schedule;
drop policy if exists "sched_update" on public.audit_schedule;
drop policy if exists "sched_delete" on public.audit_schedule;

create policy "sched_select" on public.audit_schedule
  for select to authenticated using (
    public.is_privileged()
    or start_date < (public.isolation_start_period() || '-01')::date
    or auditor_id = (select auth.uid())
  );
create policy "sched_insert" on public.audit_schedule
  for insert to authenticated with check (
    public.current_role_name() = 'auditor' and auditor_id = (select auth.uid())
  );
create policy "sched_update" on public.audit_schedule
  for update to authenticated
  using (public.current_role_name() = 'auditor' and auditor_id = (select auth.uid()));
create policy "sched_delete" on public.audit_schedule
  for delete to authenticated
  using (public.current_role_name() = 'auditor' and auditor_id = (select auth.uid()));

-- ── KPI ─────────────────────────────────────────────────────────────────
drop policy if exists "kpi_select" on public.audit_kpi;
drop policy if exists "kpi_insert" on public.audit_kpi;
drop policy if exists "kpi_update" on public.audit_kpi;
drop policy if exists "kpi_delete" on public.audit_kpi;

create policy "kpi_select" on public.audit_kpi
  for select to authenticated using (
    public.is_privileged()
    or period < public.isolation_start_period()
    or auditor_id = (select auth.uid())
  );
-- canEdit = super_admin, atau auditor untuk kartunya sendiri (AuditKPI.js:20)
create policy "kpi_insert" on public.audit_kpi
  for insert to authenticated with check (
    public.current_role_name() = 'super_admin'
    or (public.current_role_name() = 'auditor' and auditor_id = (select auth.uid()))
  );
create policy "kpi_update" on public.audit_kpi
  for update to authenticated using (
    public.current_role_name() = 'super_admin'
    or (public.current_role_name() = 'auditor' and auditor_id = (select auth.uid()))
  );
create policy "kpi_delete" on public.audit_kpi
  for delete to authenticated
  using (public.current_role_name() = 'super_admin');

-- ── BIAYA DINAS ─────────────────────────────────────────────────────────
drop policy if exists "dinas_select" on public.dinas_luar_kota;
drop policy if exists "dinas_insert" on public.dinas_luar_kota;
drop policy if exists "dinas_update" on public.dinas_luar_kota;
drop policy if exists "dinas_delete" on public.dinas_luar_kota;

create policy "dinas_select" on public.dinas_luar_kota
  for select to authenticated using (
    public.is_privileged() or auditor_id = (select auth.uid())
  );
create policy "dinas_insert" on public.dinas_luar_kota
  for insert to authenticated with check (
    public.current_role_name() in ('auditor','super_admin')
    and auditor_id = (select auth.uid())
  );
create policy "dinas_update" on public.dinas_luar_kota
  for update to authenticated using (
    public.current_role_name() = 'super_admin' or auditor_id = (select auth.uid())
  );
create policy "dinas_delete" on public.dinas_luar_kota
  for delete to authenticated using (
    public.current_role_name() = 'super_admin' or auditor_id = (select auth.uid())
  );

-- ── TABEL PENDUKUNG ─────────────────────────────────────────────────────
drop policy if exists "ranking_select" on public.ranking_scores;
drop policy if exists "ranking_write"  on public.ranking_scores;
drop policy if exists "target_select"  on public.sales_targets;
drop policy if exists "target_write"   on public.sales_targets;
drop policy if exists "findings_select" on public.findings;
drop policy if exists "findings_insert" on public.findings;

create policy "ranking_select" on public.ranking_scores
  for select to authenticated using (true);
create policy "ranking_write" on public.ranking_scores
  for all to authenticated using (public.current_role_name() = 'super_admin');
create policy "target_select" on public.sales_targets
  for select to authenticated using (true);
create policy "target_write" on public.sales_targets
  for all to authenticated using (public.current_role_name() = 'super_admin');
create policy "findings_select" on public.findings
  for select to authenticated using (true);
create policy "findings_insert" on public.findings
  for insert to authenticated with check (created_by = (select auth.uid()));


-- =========================================================================
-- BAGIAN 12 — STORAGE BUCKET "findings" (foto & video bukti)
-- =========================================================================
-- Bucket TETAP public karena kode memanggil getPublicUrl()
-- (AuditInventaris.js:124, SopAuditCabang.js:198). Lihat CATATAN 1 — ini
-- lubang yang perlu keputusan pemilik, bukan sesuatu yang bisa ditutup
-- sepihak tanpa mematikan tampilan foto di aplikasi.

insert into storage.buckets (id, name, public)
values ('findings', 'findings', true)
on conflict (id) do nothing;

drop policy if exists "findings_bucket_read"   on storage.objects;
drop policy if exists "findings_bucket_write"  on storage.objects;
drop policy if exists "findings_bucket_update" on storage.objects;
drop policy if exists "findings_bucket_delete" on storage.objects;

create policy "findings_bucket_read" on storage.objects
  for select using (bucket_id = 'findings');

create policy "findings_bucket_write" on storage.objects
  for insert to authenticated with check (bucket_id = 'findings');

-- WAJIB: kode meng-upload dengan { upsert: true }. Tanpa policy UPDATE,
-- unggah ulang foto dengan nama sama diam-diam gagal.
create policy "findings_bucket_update" on storage.objects
  for update to authenticated using (bucket_id = 'findings');

-- WAJIB: AuditInventaris.js:51 & :69 memanggil .remove().
-- Tanpa ini, file lama menumpuk selamanya dan hanya hilang dari tampilan.
create policy "findings_bucket_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'findings');


-- =========================================================================
-- BAGIAN 13 — LANGKAH TERAKHIR: ANGKAT AKUN OWNER
-- =========================================================================
-- Daftar dulu lewat halaman /login aplikasi, baru jalankan ini
-- (ganti alamat emailnya):
--
--   update public.profiles set role = 'super_admin'
--   where id = (select id from auth.users where email = 'ganti@email.kamu');
--
-- Periksa hasilnya:
--
--   select u.email, p.full_name, p.role
--   from public.profiles p join auth.users u on u.id = p.id
--   order by p.role;


-- =========================================================================
-- CATATAN — HAL YANG SKEMA SAJA TIDAK BISA SELESAIKAN
-- =========================================================================
--
-- CATATAN 1 — Bucket "findings" masih terbuka untuk umum.
--   Kode memanggil getPublicUrl(), jadi bucket HARUS public supaya foto
--   temuan tampil. Akibatnya siapa pun yang tahu URL-nya bisa membuka foto
--   audit internal tanpa login. Menutupnya butuh perubahan kode, bukan SQL:
--     - ganti getPublicUrl(path) menjadi createSignedUrl(path, 3600)
--       di AuditInventaris.js:124 dan SopAuditCabang.js:198 (jadi async)
--     - lalu: update storage.buckets set public = false where id = 'findings';
--     - lalu ganti policy findings_bucket_read menjadi:
--         for select to authenticated using (bucket_id = 'findings')
--   Selama itu belum dilakukan, jangan unggah foto yang memuat angka
--   rahasia atau data pribadi.
--
-- CATATAN 2 — pages/api/sync-kesehatan-stok.js masih perlu 3 perbaikan.
--   Endpoint ini mati total hari ini, dan skema saja tidak menghidupkannya:
--     a) baris 100 menuntut role 'super_admin' — sekarang sudah sah,
--        tapi akun Bapak memang harus diangkat dulu (Bagian 13).
--     b) baris 145 menulis module 'stok_kesehatan' — sekarang sudah sah.
--     c) baris 162 memakai .upsert(..., { onConflict: "module,branch_id,period" }).
--        Constraint itu SENGAJA dibuang (modul UI menyimpan banyak entri per
--        periode). Ganti menjadi: cari dulu barisnya dengan .select(), lalu
--        .update() kalau ketemu / .insert() kalau belum. Tanpa ini, sync
--        akan gagal dengan "no unique or exclusion constraint matching".
--     d) baris 149 memakai submitted_by dari body request. Ganti dengan
--        userData.user.id yang sudah terverifikasi di baris 95.
--
-- CATATAN 3 — ranking_scores & sales_targets adalah tebakan.
--   SopLaporan.js:41-42 mengambil keduanya lalu hasilnya tidak pernah
--   dipakai, jadi kolom sebenarnya tidak bisa disimpulkan dari kode.
--   Kalau kedua tabel ini memang belum dipakai, lebih baik hapus saja
--   dua baris query itu daripada memelihara tabel kosong. Perhatikan juga
--   bahwa error kedua query itu TIDAK diperiksa di kode (hanya brRes dan
--   sopRes yang dicek) — makanya aplikasi terlihat normal walau tabelnya
--   tidak ada.
--
-- CATATAN 4 — Super Admin sengaja TIDAK bisa membuat jadwal audit.
--   Ini menyalin Timeline.js:81 (canManage = hanya 'auditor') apa adanya.
--   Kalau ternyata itu bug di kodenya, ubah policy sched_insert/update/delete
--   supaya menerima 'super_admin' juga.
--
-- CATATAN 5 — Fitur approval belum ada di aplikasi.
--   Kolom status/approved_by/approved_at/catatan_ceo sudah siap dan RLS-nya
--   sudah memagari (hanya super_admin yang bisa mengubah status), tapi tidak
--   ada satu baris kode pun yang menulis status 'approved' atau 'rejected'.
--   README menyebutnya sudah jalan — itu belum benar.
-- =========================================================================
