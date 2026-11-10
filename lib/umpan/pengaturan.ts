// Pengaturan umpan balik (suara, getar, notifikasi) yang disimpan di perangkat ini saja.

export interface PengaturanUmpan {
  /** Efek suara di dalam aplikasi. */
  suara: boolean;
  /** Getar (hanya HP yang mendukung, mis. Android). */
  getar: boolean;
  /** Notifikasi HP saat giliranmu dan aplikasi sedang tidak dilihat. Butuh izin browser. */
  notifikasi: boolean;
  /** Volume efek suara, 0 sampai 1. */
  volume: number;
}

export const KUNCI_UMPAN = 'umpanBalik';

export const UMPAN_BAWAAN: PengaturanUmpan = { suara: true, getar: true, notifikasi: false, volume: 0.7 };

/** Pilihan volume di layar pengaturan. */
export const PILIHAN_VOLUME = [0.3, 0.7, 1] as const;

/** Rapikan nilai dari localStorage (bisa rusak atau versi lama) menjadi pengaturan yang sah. */
export function rapikanUmpan(raw: unknown): PengaturanUmpan {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const bool = (k: keyof PengaturanUmpan) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : (UMPAN_BAWAAN[k] as boolean));
  const v = typeof r.volume === 'number' && Number.isFinite(r.volume) ? Math.min(1, Math.max(0, r.volume)) : UMPAN_BAWAAN.volume;
  return { suara: bool('suara'), getar: bool('getar'), notifikasi: bool('notifikasi'), volume: v };
}

export type IzinNotifikasi = 'didukung' | 'diizinkan' | 'diblokir' | 'tidakDidukung' | 'perluPasang';

/**
 * Status notifikasi untuk ditampilkan di pengaturan.
 * iPhone/iPad hanya mengizinkan notifikasi web jika situs dipasang ke Layar Utama lebih dulu.
 */
export function statusIzin(o: { adaApi: boolean; izin: string | null; ios: boolean; terpasang: boolean }): IzinNotifikasi {
  if (o.ios && !o.terpasang) return 'perluPasang';
  if (!o.adaApi) return 'tidakDidukung';
  if (o.izin === 'granted') return 'diizinkan';
  if (o.izin === 'denied') return 'diblokir';
  return 'didukung';
}

export const TEKS_IZIN: Record<IzinNotifikasi, string> = {
  didukung: 'Muncul di HP saat giliranmu dan aplikasi sedang tidak dilihat.',
  diizinkan: 'Aktif. Muncul di HP saat giliranmu dan aplikasi sedang tidak dilihat.',
  diblokir: 'Diblokir. Izinkan notifikasi untuk situs ini di pengaturan browser.',
  tidakDidukung: 'Browser ini tidak mendukung notifikasi.',
  perluPasang: 'Di iPhone, pasang dulu: Bagikan lalu Tambah ke Layar Utama, buka dari sana, lalu aktifkan.',
};
