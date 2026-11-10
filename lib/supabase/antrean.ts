// RPC room match terbuka (lihat migrasi room_match_terbuka).
import { rapikanStatus, type StatusMatch } from '../online/antrean';
import { KUNCI_SUPABASE, URL_SUPABASE } from './konfig';
import { supabase } from './klien';

async function rpc(nama: string, arg: Record<string, unknown> = {}): Promise<unknown> {
  const { data, error } = await supabase().rpc(nama, arg);
  if (error) throw error;
  return data;
}

export const cariMatch = async (ukuran: number | null): Promise<StatusMatch | null> => rapikanStatus(await rpc('cari_match', { p_ukuran: ukuran }));
export const detakMatch = async (): Promise<StatusMatch | null> => rapikanStatus(await rpc('detak_match'));
export const mulaiMatch = async (): Promise<void> => {
  await rpc('mulai_match');
};
export const keluarMatch = async (): Promise<void> => {
  await rpc('keluar_match');
};

/** Saat halaman ditutup: keluar_match dengan keepalive. Bila gagal, kursi dibebaskan oleh batas detak 30 detik. */
export async function keluarMatchSaatTutup(): Promise<void> {
  try {
    const { data } = await supabase().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    void fetch(`${URL_SUPABASE}/rest/v1/rpc/keluar_match`, {
      method: 'POST',
      keepalive: true,
      headers: { apikey: KUNCI_SUPABASE, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
  } catch {
    // dibersihkan oleh batas detak di server
  }
}
