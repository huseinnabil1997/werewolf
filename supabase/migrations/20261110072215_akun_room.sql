-- Werewolf v1: akun (username unik), profil, riwayat main, statistik per peran, dan room online.
-- Semua tabel memakai RLS. Fungsi yang butuh hak lebih tinggi ada di skema privat (tidak diekspos API) dan
-- dipanggil lewat pembungkus security invoker di skema public.

create schema if not exists privat;
revoke all on schema privat from public, anon, authenticated;
grant usage on schema privat to authenticated;

-- Profil: satu baris per akun. Username 3 sampai 20 karakter (huruf, angka, _), unik tanpa beda besar kecil.
create table public.profil (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  dibuat timestamptz not null default now()
);
create unique index profil_username_unik on public.profil (lower(username));
alter table public.profil enable row level security;
create policy "profil dibaca pengguna login" on public.profil for select to authenticated using (true);
revoke all on public.profil from anon, authenticated;
grant select on public.profil to authenticated;

-- Profil dibuat otomatis saat akun dibuat. Username dari metadata pendaftaran harus sama dengan bagian lokal
-- email sintetis (username@werewolf.local), sehingga keunikan juga dijaga oleh Supabase Auth.
create function privat.buat_profil() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  u text := new.raw_user_meta_data ->> 'username';
begin
  if u is null or u !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'username tidak valid';
  end if;
  if lower(split_part(new.email, '@', 1)) <> lower(u) then
    raise exception 'username tidak cocok dengan akun';
  end if;
  insert into public.profil (id, username) values (new.id, u);
  return new;
end $$;
revoke all on function privat.buat_profil() from public, anon, authenticated;
create trigger buat_profil after insert on auth.users for each row execute function privat.buat_profil();

-- Riwayat main: satu baris per (permainan, pengguna). Hanya dicatat host lewat RPC; pengguna membaca miliknya.
create table public.riwayat_main (
  id bigint generated always as identity primary key,
  id_main uuid not null,
  user_id uuid not null references public.profil (id) on delete cascade,
  peran text not null check (peran in ('werewolf', 'warga', 'peramal', 'dokter')),
  menang boolean not null,
  pemenang text not null check (pemenang in ('werewolf', 'warga')),
  jumlah_pemain smallint not null check (jumlah_pemain between 4 and 20),
  waktu timestamptz not null default now(),
  constraint riwayat_main_unik unique (id_main, user_id),
  constraint riwayat_main_menang_konsisten check (
    menang = case pemenang when 'werewolf' then peran = 'werewolf' else peran <> 'werewolf' end
  )
);
create index riwayat_main_user_waktu on public.riwayat_main (user_id, waktu desc);
alter table public.riwayat_main enable row level security;
create policy "riwayat milik sendiri dibaca" on public.riwayat_main for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.riwayat_main from anon, authenticated;
grant select on public.riwayat_main to authenticated;

-- Statistik per peran, diperbarui otomatis dari riwayat.
create table public.statistik (
  user_id uuid not null references public.profil (id) on delete cascade,
  peran text not null check (peran in ('werewolf', 'warga', 'peramal', 'dokter')),
  main integer not null default 0,
  menang integer not null default 0,
  primary key (user_id, peran)
);
alter table public.statistik enable row level security;
create policy "statistik dibaca pengguna login" on public.statistik for select to authenticated using (true);
revoke all on public.statistik from anon, authenticated;
grant select on public.statistik to authenticated;

create function privat.tambah_statistik() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.statistik as s (user_id, peran, main, menang)
  values (new.user_id, new.peran, 1, case when new.menang then 1 else 0 end)
  on conflict (user_id, peran) do update set main = s.main + 1, menang = s.menang + excluded.menang;
  return new;
end $$;
revoke all on function privat.tambah_statistik() from public, anon, authenticated;
create trigger tambah_statistik after insert on public.riwayat_main for each row execute function privat.tambah_statistik();

-- Room online. Kode 5 huruf. Hanya diakses lewat fungsi di bawah.
create table public.room (
  kode text primary key check (kode ~ '^[A-Z]{5}$'),
  host_id uuid not null references public.profil (id) on delete cascade,
  dibuat timestamptz not null default now(),
  kedaluwarsa timestamptz not null default now() + interval '6 hours'
);
create index room_host on public.room (host_id);
alter table public.room enable row level security;
revoke all on public.room from anon, authenticated;

create table public.anggota_room (
  kode text not null references public.room (kode) on delete cascade,
  user_id uuid not null references public.profil (id) on delete cascade,
  gabung timestamptz not null default now(),
  primary key (kode, user_id)
);
create index anggota_room_user on public.anggota_room (user_id);
alter table public.anggota_room enable row level security;
revoke all on public.anggota_room from anon, authenticated;

create function privat.anggota(p_kode text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.anggota_room a join public.room r using (kode)
    where a.kode = p_kode and a.user_id = (select auth.uid()) and r.kedaluwarsa > now()
  )
$$;

create function privat.host(p_kode text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.room r where r.kode = p_kode and r.host_id = (select auth.uid()) and r.kedaluwarsa > now()
  )
$$;

-- Realtime (broadcast, kanal privat):
-- - "ww:KODE": semua anggota menerima, hanya host yang boleh mengirim (state publik).
-- - "ww:KODE:<user_id>": hanya pemain itu dan host yang boleh menerima dan mengirim (info rahasia dan aksi).
create function privat.boleh_kanal(p_topik text, p_kirim boolean) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare k text;
begin
  if p_topik ~ '^ww:[A-Z]{5}$' then
    k := substr(p_topik, 4, 5);
    return case when p_kirim then privat.host(k) else privat.anggota(k) end;
  end if;
  if p_topik ~ '^ww:[A-Z]{5}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    k := substr(p_topik, 4, 5);
    return privat.host(k) or (substr(p_topik, 10) = (select auth.uid())::text and privat.anggota(k));
  end if;
  return false;
end $$;

revoke all on function privat.anggota(text), privat.host(text), privat.boleh_kanal(text, boolean) from public, anon;
grant execute on function privat.anggota(text), privat.host(text), privat.boleh_kanal(text, boolean) to authenticated;

create policy "ww anggota menerima broadcast" on realtime.messages for select to authenticated
  using (realtime.messages.extension = 'broadcast' and (select privat.boleh_kanal(realtime.topic(), false)));
create policy "ww anggota mengirim broadcast" on realtime.messages for insert to authenticated
  with check (realtime.messages.extension = 'broadcast' and (select privat.boleh_kanal(realtime.topic(), true)));

-- Host membuat atau mengklaim kembali room. 'ok' | 'dipakai'.
create function privat.buat_room(p_kode text) returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); r public.room;
begin
  if uid is null then raise exception 'perlu login' using errcode = '42501'; end if;
  if p_kode !~ '^[A-Z]{5}$' then raise exception 'kode tidak valid' using errcode = '22023'; end if;
  delete from public.room where kedaluwarsa < now();
  select * into r from public.room where kode = p_kode for update;
  if found and r.host_id <> uid then return 'dipakai'; end if;
  if not found and (select count(*) from public.room where host_id = uid) >= 3 then
    delete from public.room where kode = (select kode from public.room where host_id = uid order by dibuat limit 1);
  end if;
  insert into public.room (kode, host_id) values (p_kode, uid)
  on conflict (kode) do update set kedaluwarsa = now() + interval '6 hours';
  insert into public.anggota_room (kode, user_id) values (p_kode, uid) on conflict do nothing;
  return 'ok';
end $$;

-- Pemain gabung. Mengembalikan id host, atau null bila room tidak ada.
create function privat.gabung_room(p_kode text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); h uuid;
begin
  if uid is null then raise exception 'perlu login' using errcode = '42501'; end if;
  select host_id into h from public.room where kode = p_kode and kedaluwarsa > now();
  if h is null then return null; end if;
  if not exists (select 1 from public.anggota_room where kode = p_kode and user_id = uid)
     and (select count(*) from public.anggota_room where kode = p_kode) >= 20 then
    raise exception 'room penuh' using errcode = 'P0001';
  end if;
  insert into public.anggota_room (kode, user_id) values (p_kode, uid) on conflict do nothing;
  return h;
end $$;

-- Host membaca daftar anggota beserta username.
create function privat.daftar_anggota(p_kode text) returns table (user_id uuid, username text, gabung timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not privat.host(p_kode) then raise exception 'bukan host' using errcode = '42501'; end if;
  return query select a.user_id, p.username, a.gabung from public.anggota_room a
    join public.profil p on p.id = a.user_id where a.kode = p_kode order by a.gabung;
end $$;

-- Keluar dari room. Bila host keluar, room ditutup.
create function privat.keluar_room(p_kode text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  delete from public.room where kode = p_kode and host_id = uid;
  delete from public.anggota_room where kode = p_kode and user_id = uid;
end $$;

-- Host mencatat hasil untuk semua pemain. Tiap baris harus anggota room, 4 sampai 20 pemain.
create function privat.catat_hasil_room(p_kode text, p_id_main uuid, p_baris jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not privat.host(p_kode) then raise exception 'bukan host' using errcode = '42501'; end if;
  if jsonb_typeof(p_baris) <> 'array' or jsonb_array_length(p_baris) < 4 or jsonb_array_length(p_baris) > 20 then
    raise exception 'baris tidak valid' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_baris) e
    where not exists (select 1 from public.anggota_room a where a.kode = p_kode and a.user_id = (e->>'user_id')::uuid)
  ) then
    raise exception 'pemain bukan anggota room' using errcode = '42501';
  end if;
  if (select count(distinct e->>'user_id') from jsonb_array_elements(p_baris) e) <> jsonb_array_length(p_baris) then
    raise exception 'pemain ganda' using errcode = '22023';
  end if;
  insert into public.riwayat_main (id_main, user_id, peran, menang, pemenang, jumlah_pemain)
  select p_id_main, (e->>'user_id')::uuid, e->>'peran', (e->>'menang')::boolean, e->>'pemenang', jsonb_array_length(p_baris)
  from jsonb_array_elements(p_baris) e
  on conflict (id_main, user_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Pembungkus publik (security invoker) agar bisa dipanggil lewat API sebagai RPC.
create function public.buat_room(p_kode text) returns text language sql security invoker set search_path = '' as $$ select privat.buat_room(p_kode) $$;
create function public.gabung_room(p_kode text) returns uuid language sql security invoker set search_path = '' as $$ select privat.gabung_room(p_kode) $$;
create function public.daftar_anggota(p_kode text) returns table (user_id uuid, username text, gabung timestamptz)
  language sql stable security invoker set search_path = '' as $$ select * from privat.daftar_anggota(p_kode) $$;
create function public.keluar_room(p_kode text) returns void language sql security invoker set search_path = '' as $$ select privat.keluar_room(p_kode) $$;
create function public.catat_hasil_room(p_kode text, p_id_main uuid, p_baris jsonb) returns integer
  language sql security invoker set search_path = '' as $$ select privat.catat_hasil_room(p_kode, p_id_main, p_baris) $$;

do $$
declare f text;
begin
  foreach f in array array['buat_room(text)', 'gabung_room(text)', 'daftar_anggota(text)', 'keluar_room(text)', 'catat_hasil_room(text,uuid,jsonb)'] loop
    execute format('revoke all on function privat.%s from public, anon', f);
    execute format('grant execute on function privat.%s to authenticated', f);
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
