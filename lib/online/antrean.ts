// Matchmaking Online: room match terbuka yang terisi bertahap. Logika murni (cermin RPC cari_match di server).

export const UKURAN_MATCH = [4, 5, 6, 7, 8] as const;
/** Minimal pemain agar room match boleh dimulai (manual atau otomatis). */
export const MIN_MULAI_MATCH = 4;
/** Room Acak baru dibuat dengan kapasitas ini. */
export const MAKS_ACAK = 8;
/** Mulai otomatis bila sudah minimal 4 pemain dan tidak ada pemain baru selama ini. */
export const BATAS_DIAM_MS = 60_000;
export const DETAK_MATCH_MS = 5000;

export interface RoomTerbuka {
  kode: string;
  maks: number;
  jumlah: number;
  dibuat: number;
  dimulai: boolean;
  /** false bila tidak ada anggota yang berdetak dalam 15 detik terakhir (host kemungkinan sudah pergi). */
  hidup?: boolean;
}

export function ukuranValid(x: unknown): x is number | null {
  return x === null || (typeof x === 'number' && Number.isInteger(x) && x >= 4 && x <= 8);
}

/**
 * Pilih room untuk pemain baru. Ukuran N: room terbuka tertua dengan maks N yang belum penuh.
 * Acak (null): room terbuka mana saja yang belum penuh, paling ramai dulu lalu paling lama.
 * null = tidak ada, buat room baru (maks N, atau 8 untuk Acak).
 */
export function pilihRoom(rooms: readonly RoomTerbuka[], ukuran: number | null): RoomTerbuka | null {
  const calon = rooms.filter((r) => !r.dimulai && r.hidup !== false && r.jumlah > 0 && r.jumlah < r.maks && (ukuran === null || r.maks === ukuran));
  calon.sort((a, b) => (ukuran === null ? b.jumlah - a.jumlah : 0) || a.dibuat - b.dibuat || a.kode.localeCompare(b.kode));
  return calon[0] ?? null;
}

export const maksRoomBaru = (ukuran: number | null): number => ukuran ?? MAKS_ACAK;

export function labelUkuran(ukuran: number | null): string {
  return ukuran === null ? 'Acak' : `Maks ${ukuran} pemain`;
}

export interface StatusMatch {
  kode: string;
  maks: number;
  jumlah: number;
  dimulai: boolean;
  /** Lama sejak pemain terakhir gabung, menurut jam server. */
  diamMs: number;
  host: boolean;
  /** Room dibuat pemain Acak: tidak pernah mulai otomatis, hanya host yang memulai. */
  acak: boolean;
}

/** Kode room match = kode room game (5 huruf tanpa I dan O). */
const KODE = /^[A-HJ-NP-Z]{5}$/;
export function rapikanStatus(x: unknown): StatusMatch | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.kode !== 'string' || !KODE.test(o.kode)) return null;
  const maks = Number(o.maks);
  if (!ukuranValid(maks)) return null;
  return {
    kode: o.kode,
    maks,
    jumlah: Math.max(0, Math.floor(Number(o.jumlah) || 0)),
    dimulai: o.status === 'dimulai',
    diamMs: Math.max(0, Number(o.diam_ms) || 0),
    host: o.host === true,
    acak: o.acak === true,
  };
}

/** Kapan host memulai otomatis (room Acak tidak pernah): 'penuh' saat room penuh, 'diam' saat minimal 4 dan tidak ada yang gabung 60 detik. */
export function alasanMulaiOtomatis(online: number, maks: number, diamMs: number, acak = false): 'penuh' | 'diam' | null {
  if (acak) return null;
  if (online >= maks) return 'penuh';
  if (online >= MIN_MULAI_MATCH && diamMs >= BATAS_DIAM_MS) return 'diam';
  return null;
}

/** Sisa hitung mundur mulai otomatis (ms), atau null bila belum berjalan (kurang dari 4 pemain). */
export function sisaHitungMundur(online: number, diamMs: number): number | null {
  if (online < MIN_MULAI_MATCH) return null;
  return Math.max(0, BATAS_DIAM_MS - diamMs);
}

export function formatTunggu(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
