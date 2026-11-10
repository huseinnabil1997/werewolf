// Foto profil: URL publik di Supabase Storage, atau avatar inisial dengan warna tetap per username.
import { URL_SUPABASE } from './supabase/konfig';

export const BUCKET_AVATAR = 'avatars';
export const SISI_AVATAR = 256;
export const TARGET_BYTE_AVATAR = 100 * 1024;

export function pathAvatar(userId: string): string {
  return `${userId}/avatar.webp`;
}

/** URL publik foto, dengan versi agar cache browser berganti saat foto diganti. null = tanpa foto. */
export function urlAvatar(userId: string, versi: number | null | undefined): string | null {
  if (!versi) return null;
  return `${URL_SUPABASE}/storage/v1/object/public/${BUCKET_AVATAR}/${pathAvatar(userId)}?v=${versi}`;
}

export function inisial(username: string): string {
  const t = username.replace(/[^A-Za-z0-9]/g, '');
  return (t.slice(0, 2) || username.slice(0, 1) || '?').toUpperCase();
}

/** Warna latar deterministik dari username (tanpa beda besar kecil). */
export function warnaAvatar(username: string): string {
  let h = 2166136261;
  for (const c of username.toLowerCase()) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return `hsl(${(h >>> 0) % 360} 55% 38%)`;
}

/** Potongan persegi di tengah gambar w x h. */
export function potongTengah(w: number, h: number): { x: number; y: number; sisi: number } {
  const sisi = Math.min(w, h);
  return { x: Math.floor((w - sisi) / 2), y: Math.floor((h - sisi) / 2), sisi };
}
