-- Tabel room dan anggota_room hanya diakses lewat fungsi privat. Policy eksplisit "tolak semua" menegaskan
-- bahwa klien tidak punya akses langsung (lint 0008 rls_enabled_no_policy).
create policy "room tanpa akses langsung" on public.room for select to authenticated using (false);
create policy "anggota tanpa akses langsung" on public.anggota_room for select to authenticated using (false);
