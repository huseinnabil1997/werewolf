-- Room tahan banting (dari undercover): host berdetak, snapshot state terenkripsi untuk pindah host otomatis,
-- room publik, kick, nonce identitas untuk jalur cadangan PeerJS, pembersihan room basi, dan matchmaking.
-- Semua RPC penting menolak sesi yang sudah digantikan perangkat lain (single login).

alter table public.room
  add column host_detak timestamptz not null default now(),
  add column host_keluar boolean not null default false,
  -- Ciphertext AES-GCM state host. Kuncinya hanya dibagikan host ke anggota terverifikasi, server tidak tahu.
  add column snapshot text check (snapshot is null or char_length(snapshot) <= 400000),
  add column publik boolean not null default false,
  add column meta jsonb;
create index room_publik_detak on public.room (host_detak desc) where publik;

alter table public.anggota_room add column nonce text;

-- Host dianggap pergi bila tidak berdetak selama ini.
create function privat.batas_detak() returns interval language sql immutable set search_path = '' as $$ select interval '15 seconds' $$;

-- Hapus room kedaluwarsa, room yang host-nya diam 2 menit (tidak ada yang mengambil alih), dan room kosong.
create function privat.bersihkan_room() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.room r where r.kedaluwarsa < now() or r.host_detak < now() - interval '2 minutes'
    or not exists (select 1 from public.anggota_room a where a.kode = r.kode);
end $$;

-- Realtime juga butuh sesi aktif.
create or replace function privat.boleh_kanal(p_topik text, p_kirim boolean) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare k text;
begin
  if not privat.sesi_aktif() then return false; end if;
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

-- Host membuat atau mengklaim kembali room miliknya. 'ok' | 'dipakai' (room milik host lain).
create or replace function privat.buat_room(p_kode text) returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); r public.room;
begin
  perform privat.wajib_sesi_aktif();
  if uid is null then raise exception 'perlu login' using errcode = '42501'; end if;
  if p_kode !~ '^[A-Z]{5}$' then raise exception 'kode tidak valid' using errcode = '22023'; end if;
  perform privat.bersihkan_room();
  select * into r from public.room where kode = p_kode for update;
  if found and r.host_id <> uid then return 'dipakai'; end if;
  if not found and (select count(*) from public.room where host_id = uid) >= 3 then
    delete from public.room where kode = (select kode from public.room where host_id = uid order by host_detak limit 1);
  end if;
  insert into public.room (kode, host_id) values (p_kode, uid)
  on conflict (kode) do update set kedaluwarsa = now() + interval '6 hours', host_detak = now(), host_keluar = false;
  insert into public.anggota_room (kode, user_id) values (p_kode, uid) on conflict do nothing;
  return 'ok';
end $$;

-- Pemain gabung: { host, nonce } (nonce sekali pakai untuk verifikasi identitas di jalur PeerJS), atau null.
-- Tidak ada penolakan "penuh" sampai 30 anggota: yang gabung di tengah game menjadi penonton.
drop function public.gabung_room(text);
drop function privat.gabung_room(text);
create function privat.gabung_room(p_kode text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); h uuid; n text := encode(extensions.gen_random_bytes(18), 'hex');
begin
  perform privat.wajib_sesi_aktif();
  if uid is null then raise exception 'perlu login' using errcode = '42501'; end if;
  perform privat.bersihkan_room();
  select host_id into h from public.room where kode = p_kode and kedaluwarsa > now();
  if h is null then return null; end if;
  if not exists (select 1 from public.anggota_room where kode = p_kode and user_id = uid)
     and (select count(*) from public.anggota_room where kode = p_kode) >= 30 then
    raise exception 'room penuh' using errcode = 'P0001';
  end if;
  insert into public.anggota_room (kode, user_id, nonce) values (p_kode, uid, n)
  on conflict (kode, user_id) do update set nonce = n;
  return jsonb_build_object('host', h, 'nonce', n);
end $$;

-- Info host terkini untuk anggota (setelah host berpindah).
create function privat.info_room(p_kode text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.room;
begin
  perform privat.wajib_sesi_aktif();
  if not privat.anggota(p_kode) then return null; end if;
  select * into r from public.room where kode = p_kode;
  return jsonb_build_object('host', r.host_id, 'hidup', r.host_detak > now() - privat.batas_detak() and not r.host_keluar,
    'keluar', r.host_keluar);
end $$;

-- Detak host: perpanjang room, simpan snapshot terenkripsi, dan meta room publik. false = bukan host lagi.
create function privat.detak_host(p_kode text, p_snapshot text, p_publik boolean, p_meta jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare meta_aman jsonb;
begin
  perform privat.wajib_sesi_aktif();
  if p_publik then
    meta_aman := jsonb_build_object(
      'host', left(btrim(coalesce(p_meta->>'host', '')), 20),
      'jumlah', greatest(0, least(30, coalesce((p_meta->>'jumlah')::int, 0))),
      'status', case when p_meta->>'status' in ('lobby', 'main') then p_meta->>'status' else 'lobby' end,
      'match', coalesce((p_meta->>'match')::boolean, false));
  end if;
  update public.room set host_detak = now(), host_keluar = false, kedaluwarsa = now() + interval '6 hours',
    snapshot = coalesce(p_snapshot, snapshot),
    publik = coalesce(p_publik, publik),
    meta = case when p_publik is null then meta when p_publik then meta_aman else null end
  where kode = p_kode and host_id = (select auth.uid());
  return found;
end $$;

-- Ambil alih host bila host lama diam lebih dari batas detak atau sudah keluar. Mengembalikan snapshot.
create function privat.ambil_alih_host(p_kode text) returns table (snapshot text, host_keluar boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare uid uuid := (select auth.uid()); r public.room;
begin
  perform privat.wajib_sesi_aktif();
  if not privat.anggota(p_kode) then raise exception 'bukan anggota' using errcode = '42501'; end if;
  select * into r from public.room where kode = p_kode for update;
  if not found or r.snapshot is null then return; end if;
  if r.host_id <> uid and r.host_detak > now() - privat.batas_detak() and not r.host_keluar then return; end if;
  update public.room set host_id = uid, host_detak = now(), host_keluar = false where kode = p_kode;
  return query select r.snapshot, r.host_keluar;
end $$;

-- Host memverifikasi nonce pemain yang menyambung lewat jalur PeerJS. Nonce dipakai sekali.
create function privat.verifikasi_pemain(p_kode text, p_nonce text) returns table (user_id uuid, username text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform privat.wajib_sesi_aktif();
  if not privat.host(p_kode) then raise exception 'bukan host' using errcode = '42501'; end if;
  return query
    update public.anggota_room a set nonce = null from public.profil p
    where a.kode = p_kode and p_nonce is not null and a.nonce = p_nonce and p.id = a.user_id
    returning a.user_id, p.username;
end $$;

-- Host mengeluarkan anggota (kick). Kanal pribadinya tidak bisa disambung ulang.
create function privat.keluarkan_anggota(p_kode text, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform privat.wajib_sesi_aktif();
  if not privat.host(p_kode) then raise exception 'bukan host' using errcode = '42501'; end if;
  if p_user = (select auth.uid()) then raise exception 'host tidak bisa mengeluarkan diri sendiri' using errcode = '22023'; end if;
  delete from public.anggota_room where kode = p_kode and user_id = p_user;
end $$;

-- Keluar room. Host yang keluar menyerahkan room ke anggota paling awal (host_keluar = true, snapshot tetap)
-- sehingga anggota lain langsung bisa mengambil alih. Room tanpa anggota dihapus.
-- Sengaja tanpa cek sesi aktif agar perangkat yang dikeluarkan bisa pergi dengan rapi.
create or replace function privat.keluar_room(p_kode text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); pengganti uuid;
begin
  delete from public.anggota_room where kode = p_kode and user_id = uid;
  if exists (select 1 from public.room where kode = p_kode and host_id = uid) then
    select a.user_id into pengganti from public.anggota_room a where a.kode = p_kode order by a.gabung limit 1;
    if pengganti is null then
      delete from public.room where kode = p_kode;
    else
      update public.room set host_id = pengganti, host_keluar = true where kode = p_kode;
    end if;
  elsif not exists (select 1 from public.anggota_room where kode = p_kode) then
    delete from public.room where kode = p_kode;
  end if;
end $$;

-- Daftar room publik (host aktif 15 detik terakhir). Hanya kode dan meta aman, tanpa peran.
create function privat.daftar_room_publik() returns table (kode text, host text, jumlah int, status text, match boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform privat.wajib_sesi_aktif();
  return query
  select r.kode, coalesce(r.meta->>'host', ''), coalesce((r.meta->>'jumlah')::int, 0),
    case when r.meta->>'status' = 'main' then 'main' else 'lobby' end, coalesce((r.meta->>'match')::boolean, false)
  from public.room r
  where r.publik and r.kedaluwarsa > now() and not r.host_keluar and r.host_detak > now() - privat.batas_detak()
  order by r.host_detak desc limit 40;
end $$;

-- Catat hasil dan daftar anggota juga wajib sesi aktif.
create or replace function privat.daftar_anggota(p_kode text) returns table (user_id uuid, username text, gabung timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform privat.wajib_sesi_aktif();
  if not privat.host(p_kode) then raise exception 'bukan host' using errcode = '42501'; end if;
  return query select a.user_id, p.username, a.gabung from public.anggota_room a
    join public.profil p on p.id = a.user_id where a.kode = p_kode order by a.gabung;
end $$;

create or replace function privat.catat_hasil_room(p_kode text, p_id_main uuid, p_baris jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform privat.wajib_sesi_aktif();
  if not privat.host(p_kode) then raise exception 'bukan host' using errcode = '42501'; end if;
  if jsonb_typeof(p_baris) <> 'array' or jsonb_array_length(p_baris) < 4 or jsonb_array_length(p_baris) > 20 then
    raise exception 'baris tidak valid' using errcode = '22023';
  end if;
  if (select count(distinct e->>'user_id') from jsonb_array_elements(p_baris) e) <> jsonb_array_length(p_baris) then
    raise exception 'pemain ganda' using errcode = '22023';
  end if;
  -- Pemain yang sudah keluar room tidak dicatat (bukan galat), sisanya tetap tercatat.
  insert into public.riwayat_main (id_main, user_id, peran, menang, pemenang, jumlah_pemain)
  select p_id_main, (e->>'user_id')::uuid, e->>'peran', (e->>'menang')::boolean, e->>'pemenang', jsonb_array_length(p_baris)
  from jsonb_array_elements(p_baris) e
  where exists (select 1 from public.anggota_room a where a.kode = p_kode and a.user_id = (e->>'user_id')::uuid)
  on conflict (id_main, user_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ========================= Matchmaking (room match terbuka) =========================
-- Ukuran 4 sampai 8 = kapasitas maksimal. Pemain ditempatkan di room match terbuka tertua dengan ukuran sama
-- (atau, untuk Acak, yang paling ramai) yang masih di lobby, belum penuh, dan masih ada anggota berdetak.
-- Bila tidak ada, room baru dibuat dan pemain itu menjadi host. Kursi tanpa detak 30 detik dibebaskan.
-- Semua perubahan diserialisasi advisory lock, jadi room tidak pernah terisi lebih dari maks.
create table public.room_match (
  kode text primary key check (kode ~ '^[A-HJ-NP-Z]{5}$'),
  maks smallint not null check (maks between 4 and 8),
  acak boolean not null default false,
  status text not null default 'lobby' check (status in ('lobby', 'dimulai')),
  dibuat timestamptz not null default now(),
  terakhir_gabung timestamptz not null default now()
);
create table public.anggota_match (
  user_id uuid primary key references public.profil (id) on delete cascade,
  kode text not null references public.room_match (kode) on delete cascade,
  masuk timestamptz not null default now(),
  detak timestamptz not null default now()
);
create index anggota_match_kode on public.anggota_match (kode);
create index room_match_lobby on public.room_match (maks, dibuat) where status = 'lobby';
alter table public.room_match enable row level security;
alter table public.anggota_match enable row level security;
revoke all on public.room_match, public.anggota_match from anon, authenticated;
create policy "room match tanpa akses langsung" on public.room_match for select to authenticated using (false);
create policy "anggota match tanpa akses langsung" on public.anggota_match for select to authenticated using (false);

create function privat.bersihkan_match() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('werewolf:room_match'));
  delete from public.anggota_match where detak < now() - interval '30 seconds';
  delete from public.room_match r where r.dibuat < now() - interval '6 hours'
    or not exists (select 1 from public.anggota_match a where a.kode = r.kode);
end $$;

create function privat.status_match(p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('kode', r.kode, 'maks', r.maks, 'acak', r.acak, 'status', r.status,
    'jumlah', (select count(*) from public.anggota_match x where x.kode = r.kode),
    'diam_ms', floor(extract(epoch from now() - r.terakhir_gabung) * 1000)::bigint)
  from public.anggota_match a join public.room_match r on r.kode = a.kode where a.user_id = p_uid
$$;

create function privat.kode_match() returns text
language plpgsql volatile set search_path = '' as $$
declare huruf text := 'ABCDEFGHJKLMNPQRSTUVWXYZ'; k text := ''; i int;
begin
  for i in 1..5 loop
    k := k || substr(huruf, 1 + floor(random() * length(huruf))::int, 1);
  end loop;
  return k;
end $$;

create function privat.cari_match(p_ukuran integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); k text; h boolean := false;
begin
  perform privat.wajib_sesi_aktif();
  if uid is null then raise exception 'perlu login' using errcode = '42501'; end if;
  if p_ukuran is not null and p_ukuran not between 4 and 8 then raise exception 'ukuran tidak valid' using errcode = '22023'; end if;
  perform privat.bersihkan_match();
  delete from public.anggota_match where user_id = uid;
  delete from public.room_match r where r.status = 'lobby' and not exists (select 1 from public.anggota_match a where a.kode = r.kode);
  select r.kode into k from public.room_match r
    cross join lateral (select count(*) n from public.anggota_match a where a.kode = r.kode) c
    where r.status = 'lobby' and c.n < r.maks and (p_ukuran is null or (r.maks = p_ukuran and not r.acak))
      and exists (select 1 from public.anggota_match a where a.kode = r.kode and a.detak > now() - interval '15 seconds')
    order by case when p_ukuran is null then c.n end desc nulls last, r.dibuat, r.kode
    limit 1;
  if k is null then
    loop
      k := privat.kode_match();
      exit when not exists (select 1 from public.room_match where kode = k) and not exists (select 1 from public.room where kode = k);
    end loop;
    insert into public.room_match (kode, maks, acak) values (k, coalesce(p_ukuran, 8), p_ukuran is null);
    h := true;
  else
    update public.room_match set terakhir_gabung = now() where kode = k;
  end if;
  insert into public.anggota_match (user_id, kode) values (uid, k);
  return privat.status_match(uid) || jsonb_build_object('host', h);
end $$;

create function privat.detak_match() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  perform privat.wajib_sesi_aktif();
  if uid is null then raise exception 'perlu login' using errcode = '42501'; end if;
  perform privat.bersihkan_match();
  update public.anggota_match set detak = now() where user_id = uid;
  return privat.status_match(uid);
end $$;

-- Setelah dimulai, room match tidak menerima pemain matchmaking baru.
create function privat.mulai_match() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform privat.wajib_sesi_aktif();
  update public.room_match set status = 'dimulai'
  where kode = (select kode from public.anggota_match where user_id = (select auth.uid()));
end $$;

create function privat.keluar_match() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); k text;
begin
  perform pg_advisory_xact_lock(hashtext('werewolf:room_match'));
  delete from public.anggota_match where user_id = uid returning kode into k;
  if k is not null then
    delete from public.room_match r where r.kode = k and not exists (select 1 from public.anggota_match a where a.kode = k);
  end if;
end $$;

-- Pembungkus publik (security invoker).
create function public.gabung_room(p_kode text) returns jsonb language sql security invoker set search_path = '' as $$ select privat.gabung_room(p_kode) $$;
create function public.info_room(p_kode text) returns jsonb language sql stable security invoker set search_path = '' as $$ select privat.info_room(p_kode) $$;
create function public.detak_host(p_kode text, p_snapshot text default null, p_publik boolean default null, p_meta jsonb default null) returns boolean
  language sql security invoker set search_path = '' as $$ select privat.detak_host(p_kode, p_snapshot, p_publik, p_meta) $$;
create function public.ambil_alih_host(p_kode text) returns table (snapshot text, host_keluar boolean)
  language sql security invoker set search_path = '' as $$ select * from privat.ambil_alih_host(p_kode) $$;
create function public.verifikasi_pemain(p_kode text, p_nonce text) returns table (user_id uuid, username text)
  language sql security invoker set search_path = '' as $$ select * from privat.verifikasi_pemain(p_kode, p_nonce) $$;
create function public.keluarkan_anggota(p_kode text, p_user uuid) returns void
  language sql security invoker set search_path = '' as $$ select privat.keluarkan_anggota(p_kode, p_user) $$;
create function public.daftar_room_publik() returns table (kode text, host text, jumlah int, status text, match boolean)
  language sql stable security invoker set search_path = '' as $$ select * from privat.daftar_room_publik() $$;
create function public.cari_match(p_ukuran integer) returns jsonb language sql security invoker set search_path = '' as $$ select privat.cari_match(p_ukuran) $$;
create function public.detak_match() returns jsonb language sql security invoker set search_path = '' as $$ select privat.detak_match() $$;
create function public.mulai_match() returns void language sql security invoker set search_path = '' as $$ select privat.mulai_match() $$;
create function public.keluar_match() returns void language sql security invoker set search_path = '' as $$ select privat.keluar_match() $$;

do $$
declare f text;
begin
  foreach f in array array['gabung_room(text)', 'info_room(text)', 'detak_host(text,text,boolean,jsonb)', 'ambil_alih_host(text)',
    'verifikasi_pemain(text,text)', 'keluarkan_anggota(text,uuid)', 'daftar_room_publik()', 'cari_match(integer)', 'detak_match()',
    'mulai_match()', 'keluar_match()'] loop
    execute format('revoke all on function privat.%s from public, anon', f);
    execute format('grant execute on function privat.%s to authenticated', f);
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function privat.batas_detak(), privat.bersihkan_room(), privat.bersihkan_match(), privat.status_match(uuid), privat.kode_match()
  from public, anon;
grant execute on function privat.batas_detak(), privat.bersihkan_room(), privat.bersihkan_match(), privat.status_match(uuid), privat.kode_match()
  to authenticated;
