-- Fitur akun dari undercover: single login, foto profil, profil pemain lain, peringkat, ganti username,
-- peringkat musim + gelar, dan masukan. Pola sama dengan v1: fungsi berhak tinggi di skema privat,
-- pembungkus security invoker di public.

-- ========================= Single login =========================
-- Klien memanggil auth.signOut({ scope: 'others' }) setelah masuk. Sesi yang sudah dicabut masih bisa membawa
-- access token yang belum kedaluwarsa, jadi RPC dan penulisan penting mengecek session_id JWT di auth.sessions.
create function privat.sesi_aktif() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.sessions s
    where s.id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid and s.user_id = (select auth.uid())
  )
$$;

create function privat.wajib_sesi_aktif() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not privat.sesi_aktif() then
    raise exception 'sesi_tidak_aktif' using errcode = '28000', hint = 'Akun ini masuk di perangkat lain.';
  end if;
end $$;

create function public.cek_sesi_aktif() returns boolean
language sql stable security invoker set search_path = '' as $$ select privat.sesi_aktif() $$;

revoke all on function privat.sesi_aktif(), privat.wajib_sesi_aktif(), public.cek_sesi_aktif() from public, anon;
grant execute on function privat.sesi_aktif(), privat.wajib_sesi_aktif(), public.cek_sesi_aktif() to authenticated;

-- ========================= Profil: foto, username, gelar =========================
alter table public.profil
  add column avatar_versi integer check (avatar_versi is null or avatar_versi between 1 and 1000000),
  add column username_diganti timestamptz,
  add column gelar_dipasang text;

-- Klien hanya boleh mengubah avatar_versi miliknya sendiri. Username dan gelar hanya lewat RPC.
create policy "profil diubah pemiliknya" on public.profil for update to authenticated
  using (id = (select auth.uid()) and (select privat.sesi_aktif()))
  with check (id = (select auth.uid()) and (select privat.sesi_aktif()));
grant update (avatar_versi) on public.profil to authenticated;

-- Bucket publik `avatars`, objek `<user_id>/avatar.webp`, maksimal 200 KB (klien menargetkan < 100 KB).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 204800, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Foto dibaca lewat URL publik. Policy select hanya folder sendiri (dibutuhkan untuk upsert), jadi isi bucket
-- orang lain tidak bisa di-list lewat API.
create policy "avatar ww dibaca pemiliknya" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatar ww diunggah pemiliknya" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text and (select privat.sesi_aktif()));
create policy "avatar ww diganti pemiliknya" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text and (select privat.sesi_aktif()))
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text and (select privat.sesi_aktif()));
create policy "avatar ww dihapus pemiliknya" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text and (select privat.sesi_aktif()));

-- Profil pemain lain bisa dilihat read-only: riwayat dibuka untuk dibaca semua pengguna login.
-- Isinya hanya peran (sudah terbuka di akhir game), menang/kalah, jumlah pemain, dan waktu.
drop policy "riwayat milik sendiri dibaca" on public.riwayat_main;
create policy "riwayat dibaca pengguna login" on public.riwayat_main for select to authenticated using (true);

-- Ganti username: sekali per 7 hari, format dan keunikan sama seperti daftar. Email sintetis ikut diganti.
create function privat.ganti_username(baru text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  lama text;
  terakhir timestamptz;
  email_baru text;
begin
  perform privat.wajib_sesi_aktif();
  if uid is null then raise exception 'Harus masuk dulu' using errcode = '42501'; end if;
  baru := btrim(coalesce(baru, ''));
  if baru !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'Username 3 sampai 20 karakter: huruf, angka, atau underscore' using errcode = '22023';
  end if;
  select username, username_diganti into lama, terakhir from public.profil where id = uid for update;
  if lama is null then raise exception 'Profil tidak ditemukan' using errcode = 'P0002'; end if;
  if baru = lama then raise exception 'Username baru sama dengan yang sekarang' using errcode = '22023'; end if;
  if terakhir is not null and terakhir > now() - interval '7 days' then
    raise exception 'Username baru bisa diganti lagi pada %',
      to_char((terakhir + interval '7 days') at time zone 'Asia/Jakarta', 'DD-MM-YYYY HH24:MI') || ' WIB'
      using errcode = 'P0001', hint = 'tunggu';
  end if;
  email_baru := lower(baru) || '@werewolf.local';
  if lower(baru) <> lower(lama) and (
       exists (select 1 from public.profil where lower(username) = lower(baru) and id <> uid)
       or exists (select 1 from auth.users where lower(email) = email_baru and id <> uid)) then
    raise exception 'Username sudah dipakai' using errcode = '23505';
  end if;
  update public.profil set username = baru, username_diganti = now() where id = uid;
  update auth.users set email = email_baru,
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('username', baru),
         updated_at = now()
   where id = uid;
  update auth.identities set identity_data = identity_data || jsonb_build_object('email', email_baru), updated_at = now()
   where user_id = uid and provider = 'email';
  return now();
end $$;
create function public.ganti_username(baru text) returns timestamptz
language sql security invoker set search_path = '' as $$ select privat.ganti_username(baru) $$;
revoke all on function privat.ganti_username(text), public.ganti_username(text) from public, anon;
grant execute on function privat.ganti_username(text), public.ganti_username(text) to authenticated;

-- ========================= Peringkat (sepanjang waktu) =========================
-- Per peran dan gabungan ('semua'). security_invoker agar RLS tabel asal berlaku; hanya authenticated.
create view public.papan_peringkat_peran with (security_invoker = true) as
select p.id, p.username, p.avatar_versi, s.peran, s.main, s.menang,
       round(s.menang::numeric / nullif(s.main, 0), 4) as winrate
from public.profil p
join public.statistik s on s.user_id = p.id
union all
select p.id, p.username, p.avatar_versi, 'semua' as peran, sum(s.main)::integer, sum(s.menang)::integer,
       round(sum(s.menang)::numeric / nullif(sum(s.main), 0), 4)
from public.profil p
join public.statistik s on s.user_id = p.id
group by p.id, p.username, p.avatar_versi;
revoke all on public.papan_peringkat_peran from public, anon;
grant select on public.papan_peringkat_peran to authenticated;

create index riwayat_main_waktu on public.riwayat_main (waktu);

-- ========================= Peringkat musim bulanan (Asia/Jakarta) =========================
-- Musim berjalan: top 3 dihitung langsung dari riwayat_main. Setelah bulan lewat, award teks permanen di
-- award_musim (diisi lazy dan idempotent oleh finalisasi_musim). Frame avatar hanya untuk musim berjalan.
create table public.award_musim (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profil (id) on delete cascade,
  musim text not null check (musim ~ '^\d{4}-\d{2}$'),
  kategori text not null check (kategori in ('keseluruhan', 'werewolf', 'warga', 'peramal', 'dokter', 'winrate', 'main')),
  peringkat smallint not null check (peringkat between 1 and 3),
  main integer not null check (main >= 0),
  menang integer not null check (menang >= 0),
  metrik numeric not null,
  dibuat timestamptz not null default now(),
  constraint award_musim_slot unique (musim, kategori, peringkat),
  constraint award_musim_pemain unique (musim, kategori, user_id)
);
create index award_musim_user on public.award_musim (user_id, musim desc);
alter table public.award_musim enable row level security;
create policy "award dibaca pengguna login" on public.award_musim for select to authenticated using (true);
revoke all on public.award_musim from public, anon, authenticated;
grant select on public.award_musim to authenticated;

create function privat.kode_musim(p_saat timestamptz default now()) returns text
language sql stable set search_path = '' as $$ select to_char(p_saat at time zone 'Asia/Jakarta', 'YYYY-MM') $$;

create function privat.batas_musim(p_musim text, out awal timestamptz, out akhir timestamptz)
language plpgsql immutable set search_path = '' as $$
declare y int; m int;
begin
  if p_musim is null or p_musim !~ '^\d{4}-\d{2}$' then raise exception 'musim tidak valid' using errcode = '22023'; end if;
  y := substr(p_musim, 1, 4)::int;
  m := substr(p_musim, 6, 2)::int;
  if m < 1 or m > 12 then raise exception 'musim tidak valid' using errcode = '22023'; end if;
  awal := make_timestamp(y, m, 1, 0, 0, 0) at time zone 'Asia/Jakarta';
  akhir := (make_timestamp(y, m, 1, 0, 0, 0) + interval '1 month') at time zone 'Asia/Jakarta';
end $$;

-- Top 3 satu kategori, logika sama dengan lib/peringkatMusim.ts:
-- keseluruhan: menang terbanyak, seri main lebih sedikit. Peran: menang peran itu (min 5 main), seri winrate
-- lalu main lebih sedikit. winrate: min 10 main, seri menang lalu main lebih banyak. main: main terbanyak, seri menang.
create function privat.top3_kategori(p_musim text, p_kategori text)
returns table (user_id uuid, peringkat int, kategori text, main int, menang int, metrik numeric)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare b record; per boolean := p_kategori in ('werewolf', 'warga', 'peramal', 'dokter');
begin
  if p_kategori not in ('keseluruhan', 'werewolf', 'warga', 'peramal', 'dokter', 'winrate', 'main') then
    raise exception 'kategori tidak valid' using errcode = '22023';
  end if;
  select * into b from privat.batas_musim(p_musim);
  return query
  with d as (
    select r.user_id as uid, count(*)::int as m, (count(*) filter (where r.menang))::int as w
    from public.riwayat_main r
    where r.waktu >= b.awal and r.waktu < b.akhir and (not per or r.peran = p_kategori)
    group by r.user_id
  ), c as (
    select d.uid, d.m, d.w, row_number() over (order by
      case when p_kategori = 'winrate' then d.w::numeric / d.m end desc nulls last,
      case when p_kategori = 'main' then d.m end desc nulls last,
      d.w desc,
      case when per then d.w::numeric / d.m end desc nulls last,
      case when p_kategori = 'winrate' then d.m end desc nulls last,
      case when p_kategori = 'keseluruhan' or per then d.m end asc nulls last,
      d.uid) as rk
    from d
    where case
      when p_kategori = 'keseluruhan' then d.w > 0
      when p_kategori = 'winrate' then d.m >= 10
      when p_kategori = 'main' then d.m > 0
      else d.m >= 5 and d.w > 0 end
  )
  select c.uid, c.rk::int, p_kategori, c.m, c.w,
    case p_kategori when 'winrate' then round(c.w::numeric / c.m, 4) when 'main' then c.m::numeric else c.w::numeric end
  from c where c.rk <= 3 order by c.rk;
end $$;

create function privat.top_musim(p_musim text default null)
returns table (user_id uuid, username text, avatar_versi int, peringkat int, kategori text, main int, menang int, metrik numeric, musim text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare m text := coalesce(p_musim, privat.kode_musim()); k text;
begin
  perform privat.wajib_sesi_aktif();
  foreach k in array array['keseluruhan', 'werewolf', 'warga', 'peramal', 'dokter', 'winrate', 'main'] loop
    return query
    select t.user_id, p.username, p.avatar_versi, t.peringkat, t.kategori, t.main, t.menang, t.metrik, m
    from privat.top3_kategori(m, k) t join public.profil p on p.id = t.user_id;
  end loop;
end $$;

-- Finalisasi lazy: isi award untuk musim yang sudah lewat. Idempotent.
create function privat.finalisasi_musim(p_musim text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare m text := coalesce(p_musim, to_char((now() at time zone 'Asia/Jakarta') - interval '1 month', 'YYYY-MM'));
declare n int := 0; c int; k text;
begin
  perform privat.wajib_sesi_aktif();
  if m >= privat.kode_musim() then return 0; end if;
  foreach k in array array['keseluruhan', 'werewolf', 'warga', 'peramal', 'dokter', 'winrate', 'main'] loop
    insert into public.award_musim (user_id, musim, kategori, peringkat, main, menang, metrik)
    select t.user_id, m, t.kategori, t.peringkat, t.main, t.menang, t.metrik from privat.top3_kategori(m, k) t
    on conflict do nothing;
    get diagnostics c = row_count;
    n := n + c;
  end loop;
  return n;
end $$;

-- Gelar terpasang, slot top 3 musim berjalan, dan award lama untuk sekumpulan pemain (room / profil).
create function privat.gelar_pemain(p_user_id uuid[] default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m text := privat.kode_musim(); ids uuid[]; hasil jsonb;
begin
  perform privat.wajib_sesi_aktif();
  perform privat.finalisasi_musim(null);
  ids := coalesce(p_user_id, array[(select auth.uid())]);
  if cardinality(ids) > 40 then raise exception 'terlalu banyak pemain' using errcode = '22023'; end if;
  with slot as (
    select * from privat.top3_kategori(m, 'keseluruhan')
    union all select * from privat.top3_kategori(m, 'werewolf')
    union all select * from privat.top3_kategori(m, 'warga')
    union all select * from privat.top3_kategori(m, 'peramal')
    union all select * from privat.top3_kategori(m, 'dokter')
    union all select * from privat.top3_kategori(m, 'winrate')
    union all select * from privat.top3_kategori(m, 'main')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', p.id, 'username', p.username, 'avatar_versi', p.avatar_versi, 'gelar_dipasang', p.gelar_dipasang, 'musim', m,
    'slot', coalesce((select jsonb_agg(jsonb_build_object('kategori', s.kategori, 'peringkat', s.peringkat, 'main', s.main,
                'menang', s.menang, 'metrik', s.metrik) order by s.peringkat) from slot s where s.user_id = p.id), '[]'::jsonb),
    'award', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kategori', a.kategori, 'peringkat', a.peringkat,
                'musim', a.musim, 'main', a.main, 'menang', a.menang, 'metrik', a.metrik) order by a.musim desc, a.peringkat)
              from public.award_musim a where a.user_id = p.id), '[]'::jsonb)
  ) order by p.id), '[]'::jsonb) into hasil
  from public.profil p where p.id = any(ids);
  return hasil;
end $$;

-- Pasang gelar sendiri: 'musim:<YYYY-MM>:<kategori>:<peringkat>' (harus milik sendiri musim ini), 'award:<id>', atau otomatis.
create function privat.pasang_gelar(p_nilai text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); m text := privat.kode_musim(); bagian text[]; aid bigint;
begin
  perform privat.wajib_sesi_aktif();
  if uid is null then raise exception 'perlu login' using errcode = '42501'; end if;
  if p_nilai is null or p_nilai in ('', 'otomatis') then
    update public.profil set gelar_dipasang = null where id = uid;
    return;
  end if;
  if p_nilai like 'musim:%' then
    bagian := string_to_array(p_nilai, ':');
    if array_length(bagian, 1) <> 4 or bagian[2] <> m or bagian[4] !~ '^[1-3]$' then
      raise exception 'gelar musim tidak valid' using errcode = '22023';
    end if;
    if not exists (select 1 from privat.top3_kategori(m, bagian[3]) t where t.user_id = uid and t.peringkat = bagian[4]::int) then
      raise exception 'bukan peringkatmu' using errcode = '42501';
    end if;
    update public.profil set gelar_dipasang = p_nilai where id = uid;
    return;
  end if;
  if p_nilai ~ '^award:\d{1,18}$' then
    aid := substr(p_nilai, 7)::bigint;
    if not exists (select 1 from public.award_musim a where a.id = aid and a.user_id = uid) then
      raise exception 'bukan awardmu' using errcode = '42501';
    end if;
    update public.profil set gelar_dipasang = p_nilai where id = uid;
    return;
  end if;
  raise exception 'gelar tidak valid' using errcode = '22023';
end $$;

create function public.top_musim(p_musim text default null)
returns table (user_id uuid, username text, avatar_versi int, peringkat int, kategori text, main int, menang int, metrik numeric, musim text)
language sql stable security invoker set search_path = '' as $$ select * from privat.top_musim(p_musim) $$;
create function public.finalisasi_musim(p_musim text default null) returns integer
language sql security invoker set search_path = '' as $$ select privat.finalisasi_musim(p_musim) $$;
create function public.gelar_pemain(p_user_id uuid[] default null) returns jsonb
language sql security invoker set search_path = '' as $$ select privat.gelar_pemain(p_user_id) $$;
create function public.pasang_gelar(p_nilai text) returns void
language sql security invoker set search_path = '' as $$ select privat.pasang_gelar(p_nilai) $$;

revoke all on function privat.kode_musim(timestamptz), privat.batas_musim(text) from public, anon;
grant execute on function privat.kode_musim(timestamptz), privat.batas_musim(text) to authenticated;
do $$
declare f text;
begin
  foreach f in array array['top3_kategori(text,text)', 'top_musim(text)', 'finalisasi_musim(text)', 'gelar_pemain(uuid[])', 'pasang_gelar(text)'] loop
    execute format('revoke all on function privat.%s from public, anon', f);
    execute format('grant execute on function privat.%s to authenticated', f);
  end loop;
  foreach f in array array['top_musim(text)', 'finalisasi_musim(text)', 'gelar_pemain(uuid[])', 'pasang_gelar(text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ========================= Masukan (saran) + vote + balasan =========================
create table public.masukan (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profil (id) on delete cascade,
  isi text not null check (char_length(btrim(isi)) between 1 and 500),
  kategori text not null default 'lainnya' check (kategori in ('bug', 'fitur', 'lainnya')),
  status text not null default 'baru' check (status in ('baru', 'diterima', 'dikerjakan', 'selesai', 'ditolak')),
  dibuat timestamptz not null default now()
);
create index masukan_dibuat on public.masukan (dibuat desc);
create index masukan_user_hari on public.masukan (user_id, dibuat desc);
alter table public.masukan enable row level security;
revoke all on public.masukan from public, anon, authenticated;
grant select, insert on public.masukan to authenticated;
create policy "masukan dibaca pengguna login" on public.masukan for select to authenticated using (true);
-- Status hanya diubah admin lewat SQL (tidak ada policy update/delete).
create policy "masukan ditambah sendiri" on public.masukan for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'baru' and (select privat.sesi_aktif()));

create table public.vote_masukan (
  masukan_id bigint not null references public.masukan (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profil (id) on delete cascade,
  dibuat timestamptz not null default now(),
  primary key (masukan_id, user_id)
);
create index vote_masukan_user on public.vote_masukan (user_id);
alter table public.vote_masukan enable row level security;
revoke all on public.vote_masukan from public, anon, authenticated;
grant select, insert, delete on public.vote_masukan to authenticated;
create policy "vote dibaca pengguna login" on public.vote_masukan for select to authenticated using (true);
create policy "vote ditambah sendiri" on public.vote_masukan for insert to authenticated
  with check (user_id = (select auth.uid()) and (select privat.sesi_aktif()));
create policy "vote dihapus sendiri" on public.vote_masukan for delete to authenticated
  using (user_id = (select auth.uid()));

create table public.balasan_masukan (
  id bigint generated always as identity primary key,
  masukan_id bigint not null references public.masukan (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profil (id) on delete cascade,
  isi text not null check (char_length(btrim(isi)) between 1 and 300),
  dibuat timestamptz not null default now()
);
create index balasan_masukan_masukan on public.balasan_masukan (masukan_id, dibuat);
create index balasan_masukan_user_hari on public.balasan_masukan (user_id, dibuat desc);
alter table public.balasan_masukan enable row level security;
revoke all on public.balasan_masukan from public, anon, authenticated;
grant select, insert, delete on public.balasan_masukan to authenticated;
create policy "balasan dibaca pengguna login" on public.balasan_masukan for select to authenticated using (true);
create policy "balasan ditambah sendiri" on public.balasan_masukan for insert to authenticated
  with check (user_id = (select auth.uid()) and (select privat.sesi_aktif()));
create policy "balasan dihapus sendiri" on public.balasan_masukan for delete to authenticated
  using (user_id = (select auth.uid()));

-- Anti spam: 5 masukan dan 20 balasan per pengguna per hari (Asia/Jakarta).
create function privat.batas_harian_masukan() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int; batas int;
begin
  if new.user_id is distinct from (select auth.uid()) then raise exception 'user_id tidak cocok' using errcode = '42501'; end if;
  new.isi := btrim(new.isi);
  if tg_table_name = 'masukan' then
    new.status := 'baru';
    batas := 5;
    select count(*)::int into n from public.masukan m where m.user_id = new.user_id
      and (m.dibuat at time zone 'Asia/Jakarta')::date = (now() at time zone 'Asia/Jakarta')::date;
  else
    batas := 20;
    select count(*)::int into n from public.balasan_masukan b where b.user_id = new.user_id
      and (b.dibuat at time zone 'Asia/Jakarta')::date = (now() at time zone 'Asia/Jakarta')::date;
  end if;
  if n >= batas then raise exception 'batas % per hari', batas using errcode = 'P0001'; end if;
  return new;
end $$;
revoke all on function privat.batas_harian_masukan() from public, anon, authenticated;
create trigger masukan_batas_harian before insert on public.masukan for each row execute function privat.batas_harian_masukan();
create trigger balasan_batas_harian before insert on public.balasan_masukan for each row execute function privat.batas_harian_masukan();

create function public.daftar_masukan(p_urut text default 'vote')
returns table (id bigint, user_id uuid, username text, avatar_versi int, isi text, kategori text, status text, dibuat timestamptz,
  jumlah_vote bigint, saya_vote boolean, jumlah_balasan bigint)
language sql stable security invoker set search_path = '' as $$
  select m.id, m.user_id, p.username, p.avatar_versi, m.isi, m.kategori, m.status, m.dibuat,
    (select count(*) from public.vote_masukan v where v.masukan_id = m.id),
    exists (select 1 from public.vote_masukan v where v.masukan_id = m.id and v.user_id = (select auth.uid())),
    (select count(*) from public.balasan_masukan b where b.masukan_id = m.id)
  from public.masukan m join public.profil p on p.id = m.user_id
  order by
    case when p_urut = 'baru' then m.dibuat end desc nulls last,
    case when p_urut is distinct from 'baru' then (select count(*) from public.vote_masukan v where v.masukan_id = m.id) end desc nulls last,
    m.dibuat desc
  limit 200
$$;

create function public.daftar_balasan_masukan(p_masukan_id bigint)
returns table (id bigint, masukan_id bigint, user_id uuid, username text, isi text, dibuat timestamptz)
language sql stable security invoker set search_path = '' as $$
  select b.id, b.masukan_id, b.user_id, p.username, b.isi, b.dibuat
  from public.balasan_masukan b join public.profil p on p.id = b.user_id
  where b.masukan_id = p_masukan_id order by b.dibuat, b.id
$$;

create function public.toggle_vote_masukan(p_id bigint) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'harus masuk' using errcode = '42501'; end if;
  if exists (select 1 from public.vote_masukan v where v.masukan_id = p_id and v.user_id = uid) then
    delete from public.vote_masukan where masukan_id = p_id and user_id = uid;
    return false;
  end if;
  insert into public.vote_masukan (masukan_id, user_id) values (p_id, uid);
  return true;
end $$;

revoke all on function public.daftar_masukan(text), public.daftar_balasan_masukan(bigint), public.toggle_vote_masukan(bigint) from public, anon;
grant execute on function public.daftar_masukan(text), public.daftar_balasan_masukan(bigint), public.toggle_vote_masukan(bigint) to authenticated;
