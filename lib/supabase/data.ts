// Akses data akun, profil, statistik, dan peringkat (dibatasi RLS).
import { BUCKET_AVATAR, pathAvatar } from '../avatar';
import { pesanGantiUsername, type BarisStatistik } from '../akun';
import type { Peran, Tim } from '../game';
import { baca, KUNCI } from '../storage';
import { supabase } from './klien';

export interface ProfilPublik {
  id: string;
  username: string;
  avatar_versi: number | null;
}

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

export const UKURAN_HALAMAN_RIWAYAT = 10;

export async function ambilRiwayat(userId: string, halaman = 0): Promise<{ baris: EntriRiwayat[]; adaLagi: boolean }> {
  const dari = halaman * UKURAN_HALAMAN_RIWAYAT;
  // Satu baris ekstra untuk tahu apakah masih ada halaman berikutnya.
  const { data, error } = await supabase()
    .from('riwayat_main')
    .select('id, peran, menang, pemenang, jumlah_pemain, waktu')
    .eq('user_id', userId)
    .order('waktu', { ascending: false })
    .order('id', { ascending: false })
    .range(dari, dari + UKURAN_HALAMAN_RIWAYAT);
  if (error) throw error;
  const baris = (data ?? []) as EntriRiwayat[];
  return { baris: baris.slice(0, UKURAN_HALAMAN_RIWAYAT), adaLagi: baris.length > UKURAN_HALAMAN_RIWAYAT };
}

/* --------------------------------- Profil --------------------------------- */

const cacheProfil = new Map<string, { waktu: number; p: Promise<ProfilPublik | null> }>();
const UMUR_CACHE_MS = 60_000;

/** Profil berdasarkan username (dengan cache singkat), dipakai avatar di room dan hasil. */
export function profilTercache(username: string): Promise<ProfilPublik | null> {
  const k = username.toLowerCase();
  const c = cacheProfil.get(k);
  if (c && Date.now() - c.waktu < UMUR_CACHE_MS) return c.p;
  const p = ambilProfilUsername(username).catch(() => null);
  cacheProfil.set(k, { waktu: Date.now(), p });
  return p;
}

export function lupakanProfil(username: string): void {
  cacheProfil.delete(username.toLowerCase());
}

/** Pola ilike yang cocok persis (tanpa beda besar kecil); _ dan % di-escape. */
export function polaPersis(teks: string): string {
  return teks.trim().replace(/[\\%_]/g, (c) => '\\' + c);
}

export async function ambilProfil(id: string): Promise<ProfilPublik | null> {
  const { data, error } = await supabase().from('profil').select('id, username, avatar_versi').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function ambilProfilUsername(username: string): Promise<ProfilPublik | null> {
  const { data, error } = await supabase().from('profil').select('id, username, avatar_versi').ilike('username', polaPersis(username)).maybeSingle();
  if (error) throw error;
  return data;
}

/** Cari username yang diawali teks tertentu (maksimal 10). */
export async function cariProfil(teks: string): Promise<ProfilPublik[]> {
  const t = teks.trim();
  if (!t) return [];
  const { data, error } = await supabase().from('profil').select('id, username, avatar_versi').ilike('username', polaPersis(t) + '%').order('username').limit(10);
  if (error) throw error;
  return data ?? [];
}

export async function ambilUsernameDiganti(id: string): Promise<string | null> {
  const { data, error } = await supabase().from('profil').select('username_diganti').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data?.username_diganti as string | null) ?? null;
}

/** Ganti username lewat RPC (sekali per 7 hari). Mengembalikan waktu diganti. */
export async function gantiUsername(lama: string, baru: string): Promise<string> {
  const { data, error } = await supabase().rpc('ganti_username', { baru });
  if (error) throw Object.assign(new Error(pesanGantiUsername(error)), { code: error.code });
  lupakanProfil(lama);
  lupakanProfil(baru);
  await supabase().auth.refreshSession().catch(() => {});
  return data as string;
}

/** Unggah foto (sudah diproses) lalu naikkan versi di profil. */
export async function unggahAvatar(userId: string, blob: Blob, versiLama: number | null): Promise<number> {
  const { error } = await supabase().storage.from(BUCKET_AVATAR).upload(pathAvatar(userId), blob, { upsert: true, contentType: blob.type, cacheControl: '31536000' });
  if (error) throw error;
  const versi = (versiLama ?? 0) + 1;
  const { error: e2 } = await supabase().from('profil').update({ avatar_versi: versi }).eq('id', userId);
  if (e2) throw e2;
  return versi;
}

export async function hapusAvatar(userId: string): Promise<void> {
  const { error } = await supabase().storage.from(BUCKET_AVATAR).remove([pathAvatar(userId)]);
  if (error) throw error;
  const { error: e2 } = await supabase().from('profil').update({ avatar_versi: null }).eq('id', userId);
  if (e2) throw e2;
}

/* -------------------------------- Peringkat -------------------------------- */

export interface BarisPeringkat { id: string; username: string; avatar_versi: number | null; main: number; menang: number }
export type UrutPeringkat = 'menang' | 'winrate';
export type PeranPeringkat = 'semua' | Peran;
export const MIN_MAIN_WINRATE = 5;

export const URUT_PERINGKAT: { id: UrutPeringkat; nama: string }[] = [{ id: 'menang', nama: 'Jumlah menang' }, { id: 'winrate', nama: 'Winrate' }];
export const PERAN_PERINGKAT: { id: PeranPeringkat; nama: string }[] = [
  { id: 'semua', nama: 'Keseluruhan' },
  { id: 'werewolf', nama: 'Werewolf' },
  { id: 'warga', nama: 'Warga' },
  { id: 'peramal', nama: 'Peramal' },
  { id: 'dokter', nama: 'Dokter' },
];

/** Pilihan tersimpan; nilai tidak dikenal kembali ke bawaan. */
export function pilihanPeringkat(): { urut: UrutPeringkat; peran: PeranPeringkat } {
  const u = baca<unknown>(KUNCI.peringkatUrut, null);
  const p = baca<unknown>(KUNCI.peringkatPeran, null);
  return {
    urut: URUT_PERINGKAT.some((x) => x.id === u) ? (u as UrutPeringkat) : 'menang',
    peran: PERAN_PERINGKAT.some((x) => x.id === p) ? (p as PeranPeringkat) : 'semua',
  };
}

/**
 * Leaderboard per peran ('semua' = gabungan). Urut 'menang': menang terbanyak, lalu main paling sedikit,
 * lalu username. Urut 'winrate': winrate tertinggi (minimal MIN_MAIN_WINRATE main), lalu menang, lalu main terbanyak.
 */
export async function ambilPeringkat(urut: UrutPeringkat = 'menang', peran: PeranPeringkat = 'semua', batas = 50): Promise<BarisPeringkat[]> {
  let q = supabase().from('papan_peringkat_peran').select('id, username, avatar_versi, main, menang').eq('peran', peran);
  q = urut === 'winrate'
    ? q.gte('main', MIN_MAIN_WINRATE).order('winrate', { ascending: false }).order('menang', { ascending: false }).order('main', { ascending: false })
    : q.order('menang', { ascending: false }).order('main', { ascending: true });
  const { data, error } = await q.order('username').limit(batas);
  if (error) throw error;
  return (data ?? []) as BarisPeringkat[];
}
