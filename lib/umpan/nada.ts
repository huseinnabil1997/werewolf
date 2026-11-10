// Efek suara disintesis dengan Web Audio API (tanpa berkas audio, jadi bebas hak cipta).
// Setiap efek berupa beberapa nada pendek. Data murni agar bisa diuji (durasi dan kerasnya dibatasi).
import type { Peristiwa } from './peristiwa';

export interface Nada {
  /** Frekuensi awal (Hz). */
  f: number;
  /** Frekuensi akhir untuk efek meluncur (opsional). */
  f2?: number;
  /** Mulai (detik) sejak efek dimainkan. */
  t: number;
  /** Lama nada (detik). */
  d: number;
  bentuk: 'sine' | 'triangle' | 'square' | 'sawtooth';
  /** Kekerasan relatif 0 sampai 1, dikalikan volume pengaturan. */
  g: number;
}

const N = { A3: 220, C4: 261.63, E4: 329.63, G4: 392, A4: 440, C5: 523.25, D5: 587.33, Ds5: 622.25, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5 };

export const EFEK: Record<Peristiwa, Nada[]> = {
  // Utama: tiga nada naik yang jelas, diulang sekali agar terdengar walau HP di meja.
  giliranmu: [
    { f: N.E5, t: 0, d: 0.12, bentuk: 'triangle', g: 0.55 },
    { f: N.G5, t: 0.12, d: 0.12, bentuk: 'triangle', g: 0.55 },
    { f: N.C6, t: 0.24, d: 0.3, bentuk: 'triangle', g: 0.6 },
    { f: N.E5, t: 0.7, d: 0.1, bentuk: 'triangle', g: 0.4 },
    { f: N.C6, t: 0.8, d: 0.2, bentuk: 'triangle', g: 0.45 },
  ],
  // Malam tiba: interval tritone yang muram.
  malam: [
    { f: N.A4, t: 0, d: 0.18, bentuk: 'sine', g: 0.5 },
    { f: N.Ds5, t: 0.18, d: 0.18, bentuk: 'sine', g: 0.5 },
    { f: N.A5, t: 0.36, d: 0.35, bentuk: 'triangle', g: 0.5 },
  ],
  // Mode lokal: ding-dong yang jelas untuk pemain berikutnya.
  giliranLokal: [
    { f: N.C6, t: 0, d: 0.16, bentuk: 'triangle', g: 0.45 },
    { f: N.G5, t: 0.16, d: 0.3, bentuk: 'triangle', g: 0.45 },
  ],
  // Sisanya halus dan singkat.
  gabung: [{ f: N.C6, t: 0, d: 0.08, bentuk: 'sine', g: 0.15 }],
  mulai: [
    { f: N.G4, t: 0, d: 0.1, bentuk: 'sine', g: 0.25 },
    { f: N.C5, t: 0.1, d: 0.18, bentuk: 'sine', g: 0.25 },
  ],
  vote: [
    { f: N.A4, t: 0, d: 0.06, bentuk: 'sine', g: 0.22 },
    { f: N.E4, t: 0.14, d: 0.08, bentuk: 'sine', g: 0.22 },
  ],
  eliminasi: [{ f: N.G4, f2: 196, t: 0, d: 0.4, bentuk: 'triangle', g: 0.3 }],
  aman: [
    { f: N.C5, t: 0, d: 0.1, bentuk: 'sine', g: 0.2 },
    { f: N.E5, t: 0.1, d: 0.16, bentuk: 'sine', g: 0.2 },
  ],
  menang: [
    { f: N.C5, t: 0, d: 0.1, bentuk: 'triangle', g: 0.35 },
    { f: N.E5, t: 0.1, d: 0.1, bentuk: 'triangle', g: 0.35 },
    { f: N.G5, t: 0.2, d: 0.1, bentuk: 'triangle', g: 0.35 },
    { f: N.C6, t: 0.3, d: 0.35, bentuk: 'triangle', g: 0.4 },
  ],
  kalah: [
    { f: N.E4, t: 0, d: 0.16, bentuk: 'sine', g: 0.3 },
    { f: N.C4, t: 0.16, d: 0.16, bentuk: 'sine', g: 0.3 },
    { f: N.A3, t: 0.32, d: 0.35, bentuk: 'sine', g: 0.3 },
  ],
  chat: [{ f: N.A5, t: 0, d: 0.05, bentuk: 'sine', g: 0.1 }],
  oper: [{ f: 300, f2: 620, t: 0, d: 0.16, bentuk: 'sine', g: 0.12 }],
  buka: [
    { f: N.D5, t: 0, d: 0.05, bentuk: 'sine', g: 0.15 },
    { f: N.A5, t: 0.06, d: 0.08, bentuk: 'sine', g: 0.15 },
  ],
  // Hitung mundur: ketukan pendek per detik di 5 detik terakhir.
  detik: [{ f: 1000, t: 0, d: 0.05, bentuk: 'square', g: 0.12 }],
  // Waktu habis: dua bip turun yang tegas.
  waktuHabis: [
    { f: N.A5, t: 0, d: 0.16, bentuk: 'square', g: 0.25 },
    { f: N.E5, t: 0.2, d: 0.16, bentuk: 'square', g: 0.25 },
    { f: N.A4, f2: N.E4, t: 0.4, d: 0.35, bentuk: 'square', g: 0.25 },
  ],
};

/** Lama total efek (detik). */
export function lamaEfek(n: Nada[]): number {
  return n.reduce((m, x) => Math.max(m, x.t + x.d), 0);
}
