-- Urutan slot gelar sama dengan undercover: peringkat terkecil, lalu Keseluruhan, Winrate, Warga, Werewolf,
-- Peramal, Dokter, Match (Civilian, Undercover, Mr. White, Lovers dipetakan ke peran Werewolf).
create or replace function privat.gelar_pemain(p_user_id uuid[] default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m text := privat.kode_musim(); ids uuid[]; hasil jsonb;
begin
  perform privat.wajib_sesi_aktif();
  perform privat.finalisasi_musim(null);
  ids := coalesce(p_user_id, array[(select auth.uid())]);
  if cardinality(ids) > 40 then raise exception 'terlalu banyak pemain' using errcode = '22023'; end if;
  with slot as (
    select * from privat.top3_kategori(m, 'keseluruhan')
    union all select * from privat.top3_kategori(m, 'warga')
    union all select * from privat.top3_kategori(m, 'werewolf')
    union all select * from privat.top3_kategori(m, 'peramal')
    union all select * from privat.top3_kategori(m, 'dokter')
    union all select * from privat.top3_kategori(m, 'winrate')
    union all select * from privat.top3_kategori(m, 'main')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', p.id, 'username', p.username, 'avatar_versi', p.avatar_versi, 'gelar_dipasang', p.gelar_dipasang, 'musim', m,
    'slot', coalesce((select jsonb_agg(jsonb_build_object('kategori', s.kategori, 'peringkat', s.peringkat, 'main', s.main,
                'menang', s.menang, 'metrik', s.metrik)
              order by s.peringkat, case s.kategori when 'keseluruhan' then 0 when 'winrate' then 1 when 'warga' then 2
                when 'werewolf' then 3 when 'peramal' then 4 when 'dokter' then 5 else 6 end)
              from slot s where s.user_id = p.id), '[]'::jsonb),
    'award', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kategori', a.kategori, 'peringkat', a.peringkat,
                'musim', a.musim, 'main', a.main, 'menang', a.menang, 'metrik', a.metrik) order by a.musim desc, a.peringkat, a.kategori)
              from public.award_musim a where a.user_id = p.id), '[]'::jsonb)
  ) order by p.id), '[]'::jsonb) into hasil
  from public.profil p where p.id = any(ids);
  return hasil;
end $$;
