// Suasana tampilan mengikuti fase game: senja (menu), malam, atau pagi (siang terang).
export type Suasana = 'malam' | 'pagi' | 'senja';
export type Transisi = 'terbit' | 'terbenam';

/** Lama animasi matahari terbit/terbenam (ms), sama dengan --durasi-suasana ditambah cahaya cakrawala. */
export const DURASI_TRANSISI_MS = 3400;

/** Malam ke siang = terbit, siang ke malam/menu = terbenam, selain itu cukup crossfade. */
export function jenisTransisi(dari: Suasana, ke: Suasana): Transisi | null {
  if (dari === ke) return null;
  if (ke === 'pagi') return 'terbit';
  if (dari === 'pagi') return 'terbenam';
  return null;
}

/** Tema terang hanya saat fase siang. */
export const temaTerang = (s: Suasana): boolean => s === 'pagi';
