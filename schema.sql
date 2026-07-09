-- =========================================================
-- KLA AUDIT — Skema Database Supabase
-- Jalankan seluruh file ini di: Supabase Dashboard > SQL Editor > New query > Run
-- =========================================================

-- 1. PROFIL PENGGUNA & ROLE
-- Supabase Auth sudah menangani login (email/password). Tabel ini menyimpan role tiap user.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'auditor' check (role in ('admin', 'auditor', 'ceo')),
  created_at timestamptz default now()
);

-- Otomatis buat baris profil saat ada user baru daftar (role default 'auditor')
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'auditor');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- Helper: ambil role user yang sedang login
create or replace function current_role_name()
returns text as $$
  select role from profiles where id = auth.uid();
$$ language sql stable security definer;

-- 2. CABANG
create table if not exists branches (
  id serial primary key,
  name text unique not null,
  created_at timestamptz default now()
);

insert into branches (name) values
  ('Semarang'), ('Yogyakarta'), ('Slawi'), ('Tegal'), ('Pekalongan'), ('Cirebon'),
  ('Kediri'), ('Ngaliyan'), ('Sukoharjo'), ('Surabaya MERR'), ('Mojokerto'),
  ('Surabaya Babatan'), ('Purwokerto')
on conflict (name) do nothing;

-- 3. PENGATURAN AMBANG BATAS INDIKATOR (Audit Keuangan)
create table if not exists settings_keuangan (
  id int primary key default 1,
  terkendali numeric default 70,
  efisien numeric default 95,
  monitoring numeric default 105,
  constraint single_row check (id = 1)
);
insert into settings_keuangan (id) values (1) on conflict (id) do nothing;

-- 4. AUDIT KEUANGAN (kas kecil, per cabang per bulan)
create table if not exists audit_keuangan (
  id uuid primary key default gen_random_uuid(),
  branch_id int references branches(id) on delete cascade,
  period text not null, -- format 'YYYY-MM'
  saldo_sebelumnya numeric default 0,
  saldo_masuk numeric default 0,
  limit_kas numeric default 0,
  pengeluaran numeric default 0,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected')),
  catatan_ceo text,
  submitted_by uuid references profiles(id),
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (branch_id, period)
);

-- 5. MODUL LAIN (SOP, Service, Stok, KPI) — struktur fleksibel (jsonb) karena field belum final
create table if not exists audit_generic (
  id uuid primary key default gen_random_uuid(),
  module text not null check (module in ('sop', 'service', 'stok', 'kpi')),
  branch_id int references branches(id) on delete cascade,
  period text not null,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected')),
  submitted_by uuid references profiles(id),
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (module, branch_id, period)
);

-- 6. TEMUAN + FOTO (dipakai lintas modul, misal Audit Service/Stok)
create table if not exists findings (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  branch_id int references branches(id) on delete cascade,
  description text,
  photo_url text, -- path di Supabase Storage bucket 'findings'
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- =========================================================
-- ROW LEVEL SECURITY (RLS) — ini yang bikin approval CEO beneran aman
-- =========================================================
alter table profiles enable row level security;
alter table branches enable row level security;
alter table settings_keuangan enable row level security;
alter table audit_keuangan enable row level security;
alter table audit_generic enable row level security;
alter table findings enable row level security;

-- PROFILES: semua user login boleh lihat semua profil (untuk tampilkan nama), tapi cuma admin yang bisa ubah role
drop policy if exists "profiles_select" on profiles;
create policy "profiles_select" on profiles for select using (auth.role() = 'authenticated');
drop policy if exists "profiles_update_admin" on profiles;
create policy "profiles_update_admin" on profiles for update using (current_role_name() = 'admin');

-- BRANCHES: semua user login boleh lihat; cuma admin boleh ubah
drop policy if exists "branches_select" on branches;
create policy "branches_select" on branches for select using (auth.role() = 'authenticated');
drop policy if exists "branches_write_admin" on branches;
create policy "branches_write_admin" on branches for all using (current_role_name() = 'admin');

-- SETTINGS: semua login boleh lihat; cuma admin boleh ubah
drop policy if exists "settings_select" on settings_keuangan;
create policy "settings_select" on settings_keuangan for select using (auth.role() = 'authenticated');
drop policy if exists "settings_write_admin" on settings_keuangan;
create policy "settings_write_admin" on settings_keuangan for update using (current_role_name() = 'admin');

-- AUDIT_KEUANGAN: semua login boleh lihat.
-- Auditor & admin boleh insert/update SELAMA statusnya draft/submitted (belum diputuskan CEO).
-- HANYA ceo/admin yang boleh mengubah status jadi approved/rejected.
drop policy if exists "keuangan_select" on audit_keuangan;
create policy "keuangan_select" on audit_keuangan for select using (auth.role() = 'authenticated');

drop policy if exists "keuangan_insert" on audit_keuangan;
create policy "keuangan_insert" on audit_keuangan for insert with check (
  current_role_name() in ('auditor', 'admin')
);

drop policy if exists "keuangan_update_auditor" on audit_keuangan;
create policy "keuangan_update_auditor" on audit_keuangan for update using (
  current_role_name() in ('auditor', 'admin') and status in ('draft', 'submitted')
);

drop policy if exists "keuangan_update_ceo" on audit_keuangan;
create policy "keuangan_update_ceo" on audit_keuangan for update using (
  current_role_name() in ('ceo', 'admin')
);

-- AUDIT_GENERIC: pola sama seperti audit_keuangan
drop policy if exists "generic_select" on audit_generic;
create policy "generic_select" on audit_generic for select using (auth.role() = 'authenticated');
drop policy if exists "generic_insert" on audit_generic;
create policy "generic_insert" on audit_generic for insert with check (current_role_name() in ('auditor', 'admin'));
drop policy if exists "generic_update_auditor" on audit_generic;
create policy "generic_update_auditor" on audit_generic for update using (
  current_role_name() in ('auditor', 'admin') and status in ('draft', 'submitted')
);
drop policy if exists "generic_update_ceo" on audit_generic;
create policy "generic_update_ceo" on audit_generic for update using (current_role_name() in ('ceo', 'admin'));

-- FINDINGS: semua login boleh lihat & tambah (siapa saja yang audit boleh lapor temuan)
drop policy if exists "findings_select" on findings;
create policy "findings_select" on findings for select using (auth.role() = 'authenticated');
drop policy if exists "findings_insert" on findings;
create policy "findings_insert" on findings for insert with check (auth.role() = 'authenticated');

-- =========================================================
-- STORAGE BUCKET untuk foto temuan
-- Jalankan ini juga, lalu buka Storage di dashboard untuk pastikan bucket "findings" muncul
-- =========================================================
insert into storage.buckets (id, name, public) values ('findings', 'findings', true)
on conflict (id) do nothing;

drop policy if exists "findings_bucket_read" on storage.objects;
create policy "findings_bucket_read" on storage.objects for select using (bucket_id = 'findings');
drop policy if exists "findings_bucket_write" on storage.objects;
create policy "findings_bucket_write" on storage.objects for insert with check (bucket_id = 'findings' and auth.role() = 'authenticated');

-- =========================================================
-- SETELAH MENJALANKAN FILE INI:
-- 1. Buka Authentication > Users, undang/daftarkan akun untuk tiap auditor
-- 2. Buka Table Editor > profiles, ubah kolom "role" untuk akun kamu sendiri jadi 'admin' atau 'ceo'
--    (default semua user baru = 'auditor')
-- =========================================================
