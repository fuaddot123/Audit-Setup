-- =========================================================================
-- KLA RADAR — MODUL MONITORING DISPLAY  (tambahan)
--
-- Dijalankan SESUDAH schema.sql. Berdiri sendiri: tidak mengubah satu pun
-- tabel yang sudah ada, tidak menyentuh skor SOP maupun Ranking Cabang.
--
-- Menjawab 4 hal yang diminta:
--   1. Unit apa yang dipajang, brand-nya apa
--   2. Ikut program display brand atau tidak
--   3. Umur pajang — standar maksimal 60 hari
--   4. Kondisi fisik selama dipajang + perlakuan setelah turun display
--
-- CATATAN RANCANGAN: daftar "perlakuan pasca display" dan "kondisi fisik"
-- sengaja dibuat sebagai TABEL, bukan CHECK constraint. Alasannya konkret —
-- schema.sql lama memakai CHECK berisi peran ('admin','auditor','ceo') yang
-- ternyata tidak cocok dengan kenyataan, dan akibatnya seluruh fitur admin
-- mati diam-diam. Istilah operasional yang saya tidak tahu pastinya lebih
-- aman disimpan sebagai baris yang bisa Bapak ubah sendiri.
-- =========================================================================


-- =========================================================================
-- BAGIAN 1 — STANDAR & DAFTAR PILIHAN (semua bisa diubah tanpa ubah kode)
-- =========================================================================

-- Standar umum. Satu baris saja, pola sama seperti settings_keuangan.
-- peringatan_sebelum_hari sengaja dihitung MUNDUR dari batas, bukan angka
-- mutlak. Kalau dibuat mutlak (mis. "ingatkan di hari ke-50"), brand yang
-- batasnya di-override jadi 30 hari tidak akan pernah dapat peringatan —
-- unit lompat dari "Aman" langsung ke "Lewat Batas". Dengan hitungan mundur,
-- ambangnya ikut menyesuaikan sendiri untuk tiap brand.
create table if not exists public.display_standar (
  id                     int primary key default 1,
  maks_hari_pajang       int not null default 60,  -- standar yang Bapak sebutkan
  peringatan_sebelum_hari int not null default 10, -- mulai diingatkan H-10 dari batas
  -- Bobot skor display: umur vs kondisi fisik. Ditaruh di sini, bukan di kode,
  -- supaya bisa digeser tanpa deploy ulang.
  -- Ketetapan pemilik 24 Agu 2026: 70 umur : 30 kondisi — kedisiplinan umur
  -- pajang dinilai lebih penting daripada kerapian fisiknya.
  bobot_umur             int not null default 70,
  bobot_kondisi          int not null default 30,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint display_standar_single_row check (id = 1),
  constraint display_standar_peringatan
    check (peringatan_sebelum_hari >= 0 and peringatan_sebelum_hari <= maks_hari_pajang),
  constraint display_standar_bobot
    check (bobot_umur >= 0 and bobot_kondisi >= 0 and bobot_umur + bobot_kondisi > 0)
);
alter table public.display_standar add column if not exists bobot_umur    int not null default 70;
alter table public.display_standar add column if not exists bobot_kondisi int not null default 30;
alter table public.display_standar alter column bobot_umur    set default 70;
alter table public.display_standar alter column bobot_kondisi set default 30;

-- Untuk database yang sudah terlanjur dijalankan waktu default-nya masih 50:50.
-- Dipagari "where bobot = 50" supaya menjalankan ulang berkas ini TIDAK menimpa
-- bobot yang nanti Bapak setel sendiri lewat Admin. Satu-satunya kasus yang
-- kena: kalau suatu saat Bapak sengaja memilih tepat 50:50, lalu berkas ini
-- dijalankan ulang — nilainya akan terdorong balik ke 70:30.
update public.display_standar set bobot_umur = 70, bobot_kondisi = 30
where id = 1 and bobot_umur = 50 and bobot_kondisi = 50;
insert into public.display_standar (id) values (1) on conflict (id) do nothing;

-- Kalau ada brand yang standarnya beda dari 60 hari, isi di sini.
-- Kosong = semua brand ikut display_standar.
create table if not exists public.display_standar_brand (
  brand             text primary key,
  maks_hari_pajang  int not null,
  catatan           text,
  created_at        timestamptz not null default now()
);

-- Perlakuan pasca display. GANTI istilahnya sesuai kebiasaan KLA —
-- ini tebakan saya, bukan istilah resmi Bapak.
create table if not exists public.display_perlakuan (
  kode           text primary key,
  label          text not null,
  urutan         int not null default 0,
  aktif          boolean not null default true,
  -- Diisi auditor lewat "+ Perlakuan lain…" di form, bukan oleh Super Admin.
  -- Ditandai supaya bisa dirapikan belakangan tanpa menebak mana yang resmi.
  usulan         boolean not null default false,
  diusulkan_oleh uuid references public.profiles(id),
  created_at     timestamptz not null default now()
);
alter table public.display_perlakuan add column if not exists usulan         boolean not null default false;
alter table public.display_perlakuan add column if not exists diusulkan_oleh uuid references public.profiles(id);
alter table public.display_perlakuan add column if not exists created_at     timestamptz not null default now();

-- Penyaring kembar. Tanpa ini, dalam tiga bulan akan ada "Retur brand",
-- "retur ke brand", dan "Retur Brand" sebagai tiga baris berbeda.
create unique index if not exists uq_perlakuan_label
  on public.display_perlakuan (lower(btrim(label)));
insert into public.display_perlakuan (kode, label, urutan) values
  ('dijual_display', 'Dijual sebagai unit display (harga khusus)', 1),
  ('kembali_stok',   'Kembali ke stok normal',                     2),
  ('retur_brand',    'Dikembalikan ke brand / principal',          3),
  ('pindah_cabang',  'Dipindah ke cabang lain',                    4),
  ('rusak_retur',    'Rusak — diretur / klaim',                    5),
  ('lainnya',        'Lainnya (jelaskan di catatan)',              9)
on conflict (kode) do nothing;

-- Skala kondisi fisik. Skor dipakai untuk rata-rata di layar monitoring.
create table if not exists public.display_kondisi_opsi (
  kode           text primary key,
  label          text not null,
  -- Skor ini masuk ke rumus skor display. Kondisi baru yang diketik auditor
  -- WAJIB mewarisi skor dari tingkat yang dia pilih sebagai padanannya —
  -- kalau dibiarkan kosong, unitnya hilang dari rata-rata tanpa ada yang sadar.
  skor           int not null check (skor between 0 and 100),
  urutan         int not null default 0,
  aktif          boolean not null default true,
  usulan         boolean not null default false,
  diusulkan_oleh uuid references public.profiles(id),
  created_at     timestamptz not null default now()
);
alter table public.display_kondisi_opsi add column if not exists usulan         boolean not null default false;
alter table public.display_kondisi_opsi add column if not exists diusulkan_oleh uuid references public.profiles(id);
alter table public.display_kondisi_opsi add column if not exists created_at     timestamptz not null default now();

create unique index if not exists uq_kondisi_opsi_label
  on public.display_kondisi_opsi (lower(btrim(label)));
insert into public.display_kondisi_opsi (kode, label, skor, urutan) values
  ('baik',         'Baik — seperti baru',              100, 1),
  ('lecet_ringan', 'Lecet ringan / debu membandel',     80, 2),
  ('lecet_berat',  'Lecet berat / penyok',              55, 3),
  ('rusak_fungsi', 'Rusak fungsi (layar/keyboard/fan)', 25, 4),
  ('hilang',       'Tidak ditemukan saat audit',         0, 5)
on conflict (kode) do nothing;


-- =========================================================================
-- BAGIAN 2 — UNIT YANG DIPAJANG
-- =========================================================================
-- Satu baris = satu unit yang pernah/sedang dipajang di satu cabang.
-- tanggal_turun kosong berarti unit itu MASIH dipajang hari ini.

create table if not exists public.display_unit (
  id                  uuid primary key default gen_random_uuid(),
  branch_id           int  not null references public.branches(id) on delete cascade,
  brand               text not null,
  model               text not null,
  serial_number       text,
  sku                 text,

  -- Program display bersama brand
  program_brand       boolean not null default false,
  program_nama        text,
  program_mulai       date,
  program_selesai     date,

  -- Umur pajang
  tanggal_pajang      date not null,
  tanggal_turun       date,

  -- Perlakuan setelah turun display
  perlakuan_kode      text references public.display_perlakuan(kode),
  perlakuan_tanggal   date,
  perlakuan_catatan   text,
  harga_jual_display  numeric,

  kondisi_awal        text references public.display_kondisi_opsi(kode),
  catatan             text,
  dicatat_oleh        uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint display_unit_urutan_tanggal
    check (tanggal_turun is null or tanggal_turun >= tanggal_pajang),

  -- Inti dari "perlakuan pasca display": unit tidak boleh diturunkan tanpa
  -- dicatat dikemanakan. Tanpa pagar ini, kolom perlakuan akan kosong
  -- separuh waktu dan pertanyaan Bapak tidak akan pernah terjawab datanya.
  constraint display_unit_turun_wajib_perlakuan
    check (tanggal_turun is null or perlakuan_kode is not null),

  constraint display_unit_program_lengkap
    check (program_brand = false or program_nama is not null)
);

-- Satu serial number tidak boleh tercatat sedang dipajang di dua tempat.
create unique index if not exists uq_display_unit_sn_aktif
  on public.display_unit (serial_number)
  where tanggal_turun is null and serial_number is not null;

create index if not exists idx_display_unit_cabang  on public.display_unit (branch_id);
create index if not exists idx_display_unit_brand   on public.display_unit (brand);
create index if not exists idx_display_unit_aktif   on public.display_unit (tanggal_pajang)
  where tanggal_turun is null;

drop trigger if exists touch_display_unit on public.display_unit;
create trigger touch_display_unit before update on public.display_unit
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_display_standar on public.display_standar;
create trigger touch_display_standar before update on public.display_standar
  for each row execute function public.touch_updated_at();


-- =========================================================================
-- BAGIAN 3 — RIWAYAT KONDISI FISIK
-- =========================================================================
-- Satu baris tiap kali unit diperiksa saat audit cabang. Riwayat, bukan
-- satu kolom yang ditimpa — supaya kelihatan unit yang menurun dari
-- "Baik" ke "Lecet berat" selama dipajang.

create table if not exists public.display_kondisi (
  id                uuid primary key default gen_random_uuid(),
  display_unit_id   uuid not null references public.display_unit(id) on delete cascade,
  audit_date        date not null,
  period            text not null,                    -- 'YYYY-MM'
  kondisi_kode      text not null references public.display_kondisi_opsi(kode),

  -- ── Nilai yang DIBEKUKAN saat audit ──
  -- Tanpa dua kolom ini, mengubah master data akan menulis ulang sejarah:
  -- Berita Acara Agustus yang dicetak 81% bisa jadi 78,8% bulan depan hanya
  -- karena Super Admin menurunkan skor "Lecet ringan". Terbukti di uji.
  -- Master data karena itu hanya berlaku untuk audit BERIKUTNYA.
  skor_saat_audit       int,
  batas_hari_saat_audit int,

  catatan           text,
  photos            jsonb not null default '[]'::jsonb,  -- pola sama dgn modul SOP
  -- Penghubung opsional ke catatan audit SOP kunjungan yang sama.
  audit_generic_id  uuid references public.audit_generic(id) on delete set null,
  dicatat_oleh      uuid references public.profiles(id),
  created_at        timestamptz not null default now()
);

alter table public.display_kondisi add column if not exists skor_saat_audit       int;
alter table public.display_kondisi add column if not exists batas_hari_saat_audit int;

-- Isi mundur untuk baris yang terlanjur tersimpan tanpa nilai beku.
-- Dijalankan sekali; baris yang sudah terisi tidak disentuh.
update public.display_kondisi dk
set skor_saat_audit = ko.skor
from public.display_kondisi_opsi ko
where ko.kode = dk.kondisi_kode and dk.skor_saat_audit is null;

update public.display_kondisi dk
set batas_hari_saat_audit = coalesce(sb.maks_hari_pajang, st.maks_hari_pajang)
from public.display_unit u
join public.display_standar st on st.id = 1
left join public.display_standar_brand sb on sb.brand = u.brand
where u.id = dk.display_unit_id and dk.batas_hari_saat_audit is null;

-- Pembekuan TIDAK boleh bergantung pada aplikasi mengisinya dengan benar.
-- Baris yang masuk lewat jalan lain — skrip, impor, perbaikan manual di
-- Table Editor — akan lolos tanpa nilai beku, dan diam-diam kembali ikut
-- berubah setiap master diutak-atik. Trigger ini menutup semua jalan itu.
create or replace function public.bekukan_nilai_kondisi()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.skor_saat_audit is null then
    select ko.skor into new.skor_saat_audit
    from public.display_kondisi_opsi ko where ko.kode = new.kondisi_kode;
  end if;
  if new.batas_hari_saat_audit is null then
    select coalesce(sb.maks_hari_pajang, st.maks_hari_pajang)
      into new.batas_hari_saat_audit
    from public.display_unit u
    join public.display_standar st on st.id = 1
    left join public.display_standar_brand sb on sb.brand = u.brand
    where u.id = new.display_unit_id;
  end if;
  return new;
end $$;

drop trigger if exists bekukan_kondisi_trg on public.display_kondisi;
create trigger bekukan_kondisi_trg
  before insert on public.display_kondisi
  for each row execute function public.bekukan_nilai_kondisi();

create index if not exists idx_display_kondisi_unit   on public.display_kondisi (display_unit_id, audit_date desc);
create index if not exists idx_display_kondisi_period on public.display_kondisi (period);


-- =========================================================================
-- BAGIAN 4 — TAMPILAN MONITORING
-- =========================================================================
-- Umur pajang TIDAK bisa jadi kolom tersimpan: nilainya berubah tiap hari,
-- dan Postgres melarang generated column memakai current_date. Jadi dihitung
-- di view — selalu benar, tidak perlu job harian.

create or replace view public.v_display_monitoring as
select
  u.id,
  u.branch_id,
  b.name                                as nama_cabang,
  u.brand,
  u.model,
  u.serial_number,
  u.sku,
  u.program_brand,
  u.program_nama,
  u.tanggal_pajang,
  u.tanggal_turun,
  (u.tanggal_turun is null)             as masih_dipajang,

  -- Umur: sampai hari ini kalau masih dipajang, sampai tanggal turun kalau sudah
  (coalesce(u.tanggal_turun, current_date) - u.tanggal_pajang)::int as umur_hari,

  coalesce(sb.maks_hari_pajang, s.maks_hari_pajang) as batas_hari,
  (coalesce(sb.maks_hari_pajang, s.maks_hari_pajang)
     - (coalesce(u.tanggal_turun, current_date) - u.tanggal_pajang))::int as sisa_hari,

  -- Ambang peringatan ikut batas yang berlaku untuk brand ini, bukan angka
  -- mutlak — lihat komentar di tabel display_standar.
  case
    when (coalesce(u.tanggal_turun, current_date) - u.tanggal_pajang)
         >  coalesce(sb.maks_hari_pajang, s.maks_hari_pajang) then 'Lewat Batas'
    when (coalesce(u.tanggal_turun, current_date) - u.tanggal_pajang)
         >= coalesce(sb.maks_hari_pajang, s.maks_hari_pajang)
             - s.peringatan_sebelum_hari                      then 'Mendekati Batas'
    else 'Aman'
  end as status_umur,

  -- Kondisi fisik terakhir yang tercatat
  k.kondisi_kode                        as kondisi_terakhir,
  ko.label                              as kondisi_terakhir_label,
  ko.skor                               as kondisi_terakhir_skor,
  k.audit_date                          as kondisi_terakhir_tanggal,

  u.perlakuan_kode,
  p.label                               as perlakuan_label,
  u.perlakuan_tanggal,
  u.harga_jual_display
from public.display_unit u
join public.branches b            on b.id    = u.branch_id
cross join public.display_standar s
left join public.display_standar_brand sb on sb.brand = u.brand
left join public.display_perlakuan p      on p.kode  = u.perlakuan_kode
left join lateral (
  select dk.kondisi_kode, dk.audit_date
  from public.display_kondisi dk
  where dk.display_unit_id = u.id
  order by dk.audit_date desc, dk.created_at desc
  limit 1
) k on true
left join public.display_kondisi_opsi ko on ko.kode = k.kondisi_kode
where s.id = 1;

-- Skor display per cabang per periode — inilah angka yang dicetak di Berita Acara.
--
-- Rumusnya sengaja dibuat yang bisa dijelaskan ke cabang dalam satu kalimat:
--   skor umur    = berapa persen unit yang masih dalam batas umur SAAT DIAUDIT
--   skor kondisi = rata-rata skor kondisi fisik terakhir
--   skor display = keduanya digabung menurut bobot di display_standar
--
-- DUA hal dikunci ke waktu audit, bukan ke keadaan sekarang:
--   1. umur  -> (k.audit_date - u.tanggal_pajang), bukan umur hari ini
--   2. skor & batas -> diambil dari kolom beku di display_kondisi
-- Keduanya jatuh ke master hanya kalau kolom bekunya kosong (data lama).
--
-- Perhatikan (k.audit_date - u.tanggal_pajang), bukan umur hari ini. Berita
-- Acara Agustus harus memakai umur pada tanggal auditnya; kalau dicetak ulang
-- bulan Desember, angkanya wajib sama persis seperti waktu itu.
create or replace view public.v_display_skor_periode as
with kondisi_terakhir as (
  select distinct on (dk.display_unit_id, dk.period)
         dk.display_unit_id, dk.period, dk.audit_date, dk.kondisi_kode,
         dk.skor_saat_audit, dk.batas_hari_saat_audit
  from public.display_kondisi dk
  order by dk.display_unit_id, dk.period, dk.audit_date desc, dk.created_at desc
)
select
  u.branch_id,
  b.name  as nama_cabang,
  k.period,
  count(*)::int as unit_dinilai,
  count(*) filter (
    where (k.audit_date - u.tanggal_pajang) <= coalesce(k.batas_hari_saat_audit, sb.maks_hari_pajang, s.maks_hari_pajang)
  )::int as unit_dalam_batas,
  round(100.0 * count(*) filter (
    where (k.audit_date - u.tanggal_pajang) <= coalesce(k.batas_hari_saat_audit, sb.maks_hari_pajang, s.maks_hari_pajang)
  ) / count(*), 1) as skor_umur,
  round(avg(coalesce(k.skor_saat_audit, ko.skor))::numeric, 1) as skor_kondisi,
  round((
      s.bobot_umur * (100.0 * count(*) filter (
        where (k.audit_date - u.tanggal_pajang) <= coalesce(k.batas_hari_saat_audit, sb.maks_hari_pajang, s.maks_hari_pajang)
      ) / count(*))
    + s.bobot_kondisi * avg(coalesce(k.skor_saat_audit, ko.skor))
  ) / (s.bobot_umur + s.bobot_kondisi), 1) as skor_display
from kondisi_terakhir k
join public.display_unit u  on u.id = k.display_unit_id
join public.branches b      on b.id = u.branch_id
cross join public.display_standar s
left join public.display_standar_brand sb on sb.brand = u.brand
left join public.display_kondisi_opsi ko  on ko.kode  = k.kondisi_kode
where s.id = 1
group by u.branch_id, b.name, k.period, s.bobot_umur, s.bobot_kondisi;

-- Berapa kali tiap istilah benar-benar dipakai. Dibutuhkan layar Master Data:
-- istilah yang dipakai ratusan kali TIDAK boleh dihapus atau diganti begitu
-- saja, dan istilah yang tidak pernah dipakai justru aman dirapikan.
create or replace view public.v_display_opsi_pakai as
select 'kondisi'::text as jenis, o.kode, o.label, o.skor, o.urutan, o.aktif, o.usulan,
       p.full_name as diusulkan_oleh, o.created_at,
       (select count(*) from public.display_kondisi dk where dk.kondisi_kode = o.kode)::int as dipakai
from public.display_kondisi_opsi o
left join public.profiles p on p.id = o.diusulkan_oleh
union all
select 'perlakuan'::text, o.kode, o.label, null, o.urutan, o.aktif, o.usulan,
       p.full_name, o.created_at,
       (select count(*) from public.display_unit du where du.perlakuan_kode = o.kode)::int
from public.display_perlakuan o
left join public.profiles p on p.id = o.diusulkan_oleh;

-- Usulan istilah baru yang belum ditinjau Super Admin. Sengaja dibuat view
-- supaya tidak perlu diingat-ingat: kalau isinya bertambah, ada istilah baru
-- dari lapangan yang perlu dirapikan atau dijadikan resmi.
create or replace view public.v_display_usulan as
select 'kondisi'::text as jenis, o.kode, o.label, o.skor::text as catatan,
       p.full_name as diusulkan_oleh, o.created_at
from public.display_kondisi_opsi o
left join public.profiles p on p.id = o.diusulkan_oleh
where o.usulan
union all
select 'perlakuan'::text, o.kode, o.label, null,
       p.full_name, o.created_at
from public.display_perlakuan o
left join public.profiles p on p.id = o.diusulkan_oleh
where o.usulan;

-- Ringkasan per cabang — ini yang jadi kartu KPI di layar monitoring.
create or replace view public.v_display_ringkasan_cabang as
select
  branch_id,
  nama_cabang,
  count(*) filter (where masih_dipajang)                                  as unit_dipajang,
  count(*) filter (where masih_dipajang and status_umur = 'Lewat Batas')  as lewat_batas,
  count(*) filter (where masih_dipajang and status_umur = 'Mendekati Batas') as mendekati_batas,
  count(*) filter (where masih_dipajang and program_brand)                as unit_program_brand,
  round(avg(umur_hari) filter (where masih_dipajang), 1)                  as rata_umur_hari,
  round(avg(kondisi_terakhir_skor) filter (where masih_dipajang), 1)      as rata_skor_kondisi
from public.v_display_monitoring
group by branch_id, nama_cabang;


-- =========================================================================
-- BAGIAN 5 — ROW LEVEL SECURITY
-- =========================================================================
-- KEPUTUSAN yang saya ambil, tolong dikoreksi kalau salah:
-- data display diperlakukan sebagai DATA OPERASIONAL CABANG (seperti tabel
-- branches), bukan temuan audit milik seorang auditor. Karena itu semua user
-- yang login boleh MEMBACA, tapi hanya auditor & super_admin yang boleh
-- menulis. Isolasi antar-auditor sengaja TIDAK dipasang di sini — kalau
-- ternyata display juga harus dipisah per auditor, bilang saja, tinggal
-- ditambahkan pola yang sama seperti audit_keuangan.

alter table public.display_standar       enable row level security;
alter table public.display_standar_brand enable row level security;
alter table public.display_perlakuan     enable row level security;
alter table public.display_kondisi_opsi  enable row level security;
alter table public.display_unit          enable row level security;
alter table public.display_kondisi       enable row level security;

drop policy if exists "display_standar_select"  on public.display_standar;
drop policy if exists "display_standar_write"   on public.display_standar;
create policy "display_standar_select" on public.display_standar
  for select to authenticated using (true);
create policy "display_standar_write" on public.display_standar
  for update to authenticated using (public.current_role_name() = 'super_admin');

drop policy if exists "display_sbrand_select" on public.display_standar_brand;
drop policy if exists "display_sbrand_write"  on public.display_standar_brand;
create policy "display_sbrand_select" on public.display_standar_brand
  for select to authenticated using (true);
create policy "display_sbrand_write" on public.display_standar_brand
  for all to authenticated using (public.current_role_name() = 'super_admin');

drop policy if exists "display_perlakuan_select" on public.display_perlakuan;
drop policy if exists "display_perlakuan_write"  on public.display_perlakuan;
drop policy if exists "display_perlakuan_usul"   on public.display_perlakuan;
create policy "display_perlakuan_select" on public.display_perlakuan
  for select to authenticated using (true);
create policy "display_perlakuan_write" on public.display_perlakuan
  for all to authenticated using (public.current_role_name() = 'super_admin');
-- Auditor boleh MENAMBAH pilihan baru, tapi hanya yang bertanda usulan dan
-- atas namanya sendiri. Mengubah atau menghapus pilihan yang sudah resmi
-- tetap hak Super Admin — kalau tidak, satu salah ketik bisa mengganti
-- istilah yang sudah dipakai ratusan baris data lama.
create policy "display_perlakuan_usul" on public.display_perlakuan
  for insert to authenticated with check (
    public.current_role_name() in ('auditor','super_admin')
    and usulan = true
    and aktif = true
    and diusulkan_oleh = (select auth.uid())
  );

drop policy if exists "display_kopsi_select" on public.display_kondisi_opsi;
drop policy if exists "display_kopsi_write"  on public.display_kondisi_opsi;
drop policy if exists "display_kopsi_usul"   on public.display_kondisi_opsi;
create policy "display_kopsi_select" on public.display_kondisi_opsi
  for select to authenticated using (true);
create policy "display_kopsi_write" on public.display_kondisi_opsi
  for all to authenticated using (public.current_role_name() = 'super_admin');
create policy "display_kopsi_usul" on public.display_kondisi_opsi
  for insert to authenticated with check (
    public.current_role_name() in ('auditor','super_admin')
    and usulan = true
    and aktif = true
    and diusulkan_oleh = (select auth.uid())
  );

drop policy if exists "display_unit_select" on public.display_unit;
drop policy if exists "display_unit_insert" on public.display_unit;
drop policy if exists "display_unit_update" on public.display_unit;
drop policy if exists "display_unit_delete" on public.display_unit;
create policy "display_unit_select" on public.display_unit
  for select to authenticated using (true);
create policy "display_unit_insert" on public.display_unit
  for insert to authenticated with check (
    public.current_role_name() in ('auditor','super_admin')
    and dicatat_oleh = (select auth.uid())
  );
create policy "display_unit_update" on public.display_unit
  for update to authenticated
  using (public.current_role_name() in ('auditor','super_admin'));
create policy "display_unit_delete" on public.display_unit
  for delete to authenticated
  using (public.current_role_name() = 'super_admin');

drop policy if exists "display_kondisi_select" on public.display_kondisi;
drop policy if exists "display_kondisi_insert" on public.display_kondisi;
drop policy if exists "display_kondisi_update" on public.display_kondisi;
drop policy if exists "display_kondisi_delete" on public.display_kondisi;
create policy "display_kondisi_select" on public.display_kondisi
  for select to authenticated using (true);
create policy "display_kondisi_insert" on public.display_kondisi
  for insert to authenticated with check (
    public.current_role_name() in ('auditor','super_admin')
    and dicatat_oleh = (select auth.uid())
  );
create policy "display_kondisi_update" on public.display_kondisi
  for update to authenticated using (
    public.current_role_name() = 'super_admin'
    or dicatat_oleh = (select auth.uid())
  );
create policy "display_kondisi_delete" on public.display_kondisi
  for delete to authenticated using (
    public.current_role_name() = 'super_admin'
    or dicatat_oleh = (select auth.uid())
  );

-- View mewarisi RLS tabel di baliknya selama security_invoker menyala.
alter view public.v_display_monitoring       set (security_invoker = on);
alter view public.v_display_ringkasan_cabang set (security_invoker = on);
alter view public.v_display_skor_periode      set (security_invoker = on);
alter view public.v_display_usulan            set (security_invoker = on);
alter view public.v_display_opsi_pakai        set (security_invoker = on);

grant select on public.v_display_monitoring       to authenticated;
grant select on public.v_display_ringkasan_cabang to authenticated;
grant select on public.v_display_skor_periode      to authenticated;
grant select on public.v_display_usulan            to authenticated;
grant select on public.v_display_opsi_pakai        to authenticated;


-- =========================================================================
-- CONTOH PEMAKAIAN (untuk sisi aplikasi)
-- =========================================================================
--
-- Daftar unit yang lewat 60 hari, cabang paling parah di atas:
--   supabase.from("v_display_monitoring").select("*")
--     .eq("masih_dipajang", true).eq("status_umur","Lewat Batas")
--     .order("umur_hari", { ascending: false })
--
-- Kartu KPI per cabang:
--   supabase.from("v_display_ringkasan_cabang").select("*").order("lewat_batas", { ascending: false })
--
-- Menurunkan unit dari display (perlakuan WAJIB diisi, dijaga constraint):
--   supabase.from("display_unit").update({
--     tanggal_turun: "2026-09-01",
--     perlakuan_kode: "dijual_display",
--     perlakuan_tanggal: "2026-09-01",
--     harga_jual_display: 7250000
--   }).eq("id", unitId)
-- =========================================================================
