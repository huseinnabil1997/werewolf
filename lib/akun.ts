// Aturan akun: login cukup dengan username + password. Supabase Auth butuh email, jadi username diubah menjadi
// email sintetis yang tidak pernah dikirimi surat. Keunikan username (tanpa beda besar kecil) dijaga oleh email
// unik di Auth dan indeks unik lower(username) di tabel profil.
import type { Peran } from './game';

export const USERNAME_MIN = 3;
export const USERNAME_MAKS = 20;
export const PASSWORD_MIN = 6;
export const DOMAIN_AKUN = 'werewolf.local';
const POLA_USERNAME = /^[A-Za-z0-9_]+$/;

export function rapikanUsername(u: string): string {
  return u.trim();
}

/** Pesan galat untuk username, atau null jika valid. */
export function cekUsername(u: string): string | null {
  const t = rapikanUsername(u);
  if (t.length < USERNAME_MIN || t.length > USERNAME_MAKS) return `Username ${USERNAME_MIN} sampai ${USERNAME_MAKS} karakter.`;
  if (!POLA_USERNAME.test(t)) return 'Username hanya huruf, angka, dan garis bawah (_).';
  return null;
}

export function cekPassword(p: string): string | null {
  return p.length < PASSWORD_MIN ? `Password minimal ${PASSWORD_MIN} karakter.` : null;
}

export function emailDari(username: string): string {
  return `${rapikanUsername(username).toLowerCase()}@${DOMAIN_AKUN}`;
}

export const PESAN_KONFIRMASI_EMAIL =
  'Akun belum aktif karena "Confirm email" masih menyala di pengaturan Supabase. Pengelola game perlu mematikannya (Authentication > Sign In / Providers > Email).';

/** Terjemahkan galat Supabase Auth ke bahasa Indonesia. */
export function pesanGalatAuth(e: { message?: string; code?: string } | null | undefined): string {
  const kode = e?.code ?? '';
  const pesan = (e?.message ?? '').toLowerCase();
  if (kode === 'user_already_exists' || kode === 'email_exists' || pesan.includes('already registered')) return 'Username sudah dipakai.';
  if (kode === 'invalid_credentials' || pesan.includes('invalid login')) return 'Username atau password salah.';
  if (kode === 'email_not_confirmed' || pesan.includes('email not confirmed') || pesan.includes('confirmation email')) return PESAN_KONFIRMASI_EMAIL;
  // Saat "Confirm email" menyala, Supabase menolak email sintetis @werewolf.local karena tidak bisa dikirimi surat.
  if (kode === 'email_address_invalid' || kode === 'email_address_not_authorized') return PESAN_KONFIRMASI_EMAIL;
  if (kode === 'over_email_send_rate_limit' || kode === 'over_request_rate_limit' || pesan.includes('rate limit')) return 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.';
  if (kode === 'weak_password') return `Password terlalu lemah. Minimal ${PASSWORD_MIN} karakter.`;
  if (kode === 'signup_disabled') return 'Pendaftaran akun sedang ditutup.';
  if (kode === 'unexpected_failure' || pesan.includes('database error')) return 'Username sudah dipakai atau tidak valid.';
  if (pesan.includes('fetch') || pesan.includes('network')) return 'Tidak bisa terhubung ke server. Periksa internet.';
  return 'Gagal. Coba lagi.';
}

export interface BarisStatistik {
  peran: Peran;
  main: number;
  menang: number;
}

export interface RingkasanStatistik {
  main: number;
  menang: number;
  persen: number | null;
  perPeran: Record<Peran, { main: number; menang: number; persen: number | null }>;
}

export const DAFTAR_PERAN: Peran[] = ['werewolf', 'warga', 'peramal', 'dokter'];

export function persen(menang: number, main: number): number | null {
  return main > 0 ? Math.round((menang / main) * 100) : null;
}

export function ringkasStatistik(baris: BarisStatistik[]): RingkasanStatistik {
  const perPeran = {} as RingkasanStatistik['perPeran'];
  for (const p of DAFTAR_PERAN) {
    const b = baris.find((x) => x.peran === p);
    const main = b?.main ?? 0;
    const menang = b?.menang ?? 0;
    perPeran[p] = { main, menang, persen: persen(menang, main) };
  }
  const main = baris.reduce((a, b) => a + b.main, 0);
  const menang = baris.reduce((a, b) => a + b.menang, 0);
  return { main, menang, persen: persen(menang, main), perPeran };
}

/* ------------------------------ Single login ------------------------------ */

export const PESAN_DIKELUARKAN = 'Akunmu masuk di perangkat lain, jadi kamu dikeluarkan dari perangkat ini.';
/** Jeda pengecekan berkala apakah sesi di perangkat ini masih yang aktif (hanya saat halaman terlihat). */
export const JEDA_CEK_SESI_MS = 5000;
/** Nama event window yang memberi tahu layar online bahwa perangkat ini dikeluarkan. */
export const EVENT_DIKELUARKAN = 'werewolf:dikeluarkan';

/** Hasil RPC cek_sesi_aktif: dikeluarkan hanya bila server menjawab tegas `false` (galat jaringan diabaikan). */
export function sesiDigantikan(hasil: { data: unknown; error: unknown }): boolean {
  return !hasil.error && hasil.data === false;
}

/** Galat RPC/RLS yang menolak karena sesi sudah digantikan perangkat lain. */
export function galatSesiTidakAktif(e: { message?: string; code?: string } | null | undefined): boolean {
  return !!e && (e.message ?? '').includes('sesi_tidak_aktif');
}

/* ------------------------------ Ganti username ------------------------------ */

export const JEDA_GANTI_USERNAME_MS = 7 * 24 * 60 * 60 * 1000;

/** Kapan username boleh diganti lagi, atau null bila sudah boleh. */
export function bisaGantiLagi(diganti: string | null, sekarang = Date.now()): Date | null {
  if (!diganti) return null;
  const t = new Date(diganti).getTime() + JEDA_GANTI_USERNAME_MS;
  return Number.isFinite(t) && t > sekarang ? new Date(t) : null;
}

export function pesanGantiUsername(e: { code?: string; message?: string }): string {
  if (e.code === '23505') return 'Username sudah dipakai.';
  if (e.code === '22023' || e.code === 'P0001') return `${e.message ?? 'Username tidak valid'}.`;
  if (e.code === '42501') return 'Harus masuk dulu.';
  if (galatSesiTidakAktif(e)) return PESAN_DIKELUARKAN;
  return 'Gagal mengganti username. Periksa internet lalu coba lagi.';
}
