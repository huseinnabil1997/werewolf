// RPC room online. Tabel room hanya bisa diakses lewat fungsi ini (lihat migrasi akun_room dan room_hidup_match).
import { galatSesiTidakAktif, PESAN_DIKELUARKAN } from '../akun';
import { supabase } from './klien';

async function rpc<T>(nama: string, arg: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase().rpc(nama, arg);
  if (error) throw error;
  return data as T;
}

/** 'ok' bila kita host room ini, 'dipakai' bila room milik host lain. */
export const buatRoom = (kode: string) => rpc<'ok' | 'dipakai'>('buat_room', { p_kode: kode });

/** Host saat ini + nonce identitas sekali pakai, atau null bila room tidak ada. */
export async function gabungRoom(kode: string): Promise<{ host: string; nonce: string } | null> {
  const r = await rpc<{ host?: string; nonce?: string } | null>('gabung_room', { p_kode: kode });
  return r && typeof r.host === 'string' && typeof r.nonce === 'string' ? { host: r.host, nonce: r.nonce } : null;
}

export async function infoRoom(kode: string): Promise<{ host: string; hidup: boolean; keluar: boolean } | null> {
  const r = await rpc<{ host?: string; hidup?: boolean; keluar?: boolean } | null>('info_room', { p_kode: kode });
  return r && typeof r.host === 'string' ? { host: r.host, hidup: !!r.hidup, keluar: !!r.keluar } : null;
}

export const daftarAnggota = (kode: string) =>
  rpc<{ user_id: string; username: string; gabung: string }[]>('daftar_anggota', { p_kode: kode });

export const detakHost = (kode: string, snapshot: string | null, publik: boolean | null, meta: Record<string, unknown> | null) =>
  rpc<boolean>('detak_host', { p_kode: kode, p_snapshot: snapshot, p_publik: publik, p_meta: meta });

export async function ambilAlihHost(kode: string): Promise<{ snapshot: string; hostKeluar: boolean } | null> {
  const rows = await rpc<{ snapshot: string; host_keluar: boolean }[]>('ambil_alih_host', { p_kode: kode });
  const r = rows?.[0];
  return r?.snapshot ? { snapshot: r.snapshot, hostKeluar: r.host_keluar } : null;
}

export async function verifikasiPemain(kode: string, nonce: string): Promise<{ uid: string; username: string } | null> {
  const rows = await rpc<{ user_id: string; username: string }[]>('verifikasi_pemain', { p_kode: kode, p_nonce: nonce });
  const r = rows?.[0];
  return r ? { uid: r.user_id, username: r.username } : null;
}

export const keluarkanAnggota = (kode: string, uid: string) => rpc<null>('keluarkan_anggota', { p_kode: kode, p_user: uid });
export const keluarRoom = (kode: string) => rpc<null>('keluar_room', { p_kode: kode });
export const catatHasilRoom = (kode: string, idMain: string, baris: unknown[]) =>
  rpc<number>('catat_hasil_room', { p_kode: kode, p_id_main: idMain, p_baris: baris });

export interface RoomPublik {
  kode: string;
  host: string;
  jumlah: number;
  status: 'lobby' | 'main';
  match: boolean;
}
export const daftarRoomPublik = () => rpc<RoomPublik[]>('daftar_room_publik');

export const PESAN_GAGAL_CATAT = 'Hasil gagal dicatat ke riwayat. Mencoba lagi otomatis.';

/** Penolakan tegas dari server (bukan gangguan jaringan). */
export function galatDitolakServer(e: unknown): boolean {
  const x = e as { code?: string; message?: string } | null;
  return !!x && typeof x.code === 'string' && ['P0001', '42501', '28000', '22023'].includes(x.code);
}

export function pesanGalatRoom(e: unknown): string {
  const x = e as { code?: string; message?: string } | null;
  if (galatSesiTidakAktif(x)) return PESAN_DIKELUARKAN;
  if (x?.code === '42501') return 'Harus login dulu.';
  if (x?.message?.includes('room penuh')) return 'Room penuh (maksimal 30 anggota).';
  if ((x?.message ?? '').toLowerCase().includes('fetch')) return 'Tidak bisa terhubung ke server. Periksa internet.';
  return 'Gagal menghubungi server. Coba lagi.';
}
