// Akses data akun dan statistik (dibatasi RLS) serta RPC room online.
import type { BarisStatistik } from '../akun';
import type { Peran, Tim } from '../game';
import { supabase } from './klien';

export async function ambilStatistik(userId: string): Promise<BarisStatistik[]> {
  const { data, error } = await supabase().from('statistik').select('peran, main, menang').eq('user_id', userId);
  if (error) throw error;
  return (data ?? []) as BarisStatistik[];
}

export interface EntriRiwayat {
  id: number;
  peran: Peran;
  menang: boolean;
  pemenang: Tim;
  jumlah_pemain: number;
  waktu: string;
}

export async function ambilRiwayat(): Promise<EntriRiwayat[]> {
  const { data, error } = await supabase()
    .from('riwayat_main')
    .select('id, peran, menang, pemenang, jumlah_pemain, waktu')
    .order('waktu', { ascending: false })
    .limit(10);
  if (error) throw error;
  return (data ?? []) as EntriRiwayat[];
}

async function rpc<T>(nama: string, arg: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().rpc(nama, arg);
  if (error) throw error;
  return data as T;
}

export const buatRoom = (kode: string) => rpc<'ok' | 'dipakai'>('buat_room', { p_kode: kode });
/** Id host room, atau null bila room tidak ada / kedaluwarsa. */
export const gabungRoom = (kode: string) => rpc<string | null>('gabung_room', { p_kode: kode });
export const daftarAnggota = (kode: string) =>
  rpc<{ user_id: string; username: string; gabung: string }[]>('daftar_anggota', { p_kode: kode });
export const keluarRoom = (kode: string) => rpc<null>('keluar_room', { p_kode: kode });
export const catatHasilRoom = (kode: string, idMain: string, baris: unknown[]) =>
  rpc<number>('catat_hasil_room', { p_kode: kode, p_id_main: idMain, p_baris: baris });

export function pesanGalatRoom(e: unknown): string {
  const x = e as { code?: string; message?: string } | null;
  if (x?.code === '42501') return 'Harus login dulu.';
  if (x?.message?.includes('room penuh')) return 'Room penuh (maksimal 20 pemain).';
  if ((x?.message ?? '').toLowerCase().includes('fetch')) return 'Tidak bisa terhubung ke server. Periksa internet.';
  return 'Gagal menghubungi server. Coba lagi.';
}
