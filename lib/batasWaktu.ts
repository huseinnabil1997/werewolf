// Batas waktu opsional mode online (dipilih host), agar permainan tidak macet menunggu satu pemain.
// Murni (tanpa DOM) kecuali pembacaan pilihan tersimpan, jadi bisa diuji.
import type { Fase, StateGame } from './game';
import { baca, KUNCI } from './storage';

/** Dalam detik. 0 berarti tanpa batas. */
export interface BatasWaktu {
  /** Malam: bila habis, malam diakhiri (pilihan terbanyak werewolf, seri diundi). */
  malam: number;
  /** Diskusi: bila habis, voting dibuka. */
  diskusi: number;
  /** Voting: bila habis, suara yang masuk dihitung. */
  voting: number;
  /** Lanjut otomatis dari layar pagi dan hasil voting. */
  lanjut: number;
}

export const TANPA_BATAS: BatasWaktu = { malam: 0, diskusi: 0, voting: 0, lanjut: 0 };
export const BATAS_BAWAAN: BatasWaktu = { malam: 0, diskusi: 120, voting: 0, lanjut: 0 };
export const PILIHAN_BATAS: Record<keyof BatasWaktu, readonly number[]> = {
  malam: [0, 30, 45, 60, 90],
  diskusi: [0, 60, 120, 180, 300],
  voting: [0, 30, 45, 60, 90],
  lanjut: [0, 5, 10, 15],
};
export const LABEL_BATAS: Record<keyof BatasWaktu, string> = {
  malam: 'Malam',
  diskusi: 'Diskusi',
  voting: 'Voting',
  lanjut: 'Lanjut otomatis',
};
/** Peringatan suara dan getar di detik-detik terakhir. */
export const DETIK_PERINGATAN = 5;
/** Host pulih atau pindah: beri tambahan waktu agar pemain sempat tersambung ulang. */
export const TAMBAHAN_PULIH_MS = 10000;

function pilih(x: unknown, daftar: readonly number[], cadangan: number): number {
  return typeof x === 'number' && daftar.includes(x) ? x : cadangan;
}

export function rapikanBatas(x: unknown): BatasWaktu {
  const o = x && typeof x === 'object' ? (x as Record<string, unknown>) : {};
  return {
    malam: pilih(o.malam, PILIHAN_BATAS.malam, BATAS_BAWAAN.malam),
    diskusi: pilih(o.diskusi, PILIHAN_BATAS.diskusi, BATAS_BAWAAN.diskusi),
    voting: pilih(o.voting, PILIHAN_BATAS.voting, BATAS_BAWAAN.voting),
    lanjut: pilih(o.lanjut, PILIHAN_BATAS.lanjut, BATAS_BAWAAN.lanjut),
  };
}

export function bacaBatasTersimpan(): BatasWaktu {
  return rapikanBatas(baca<unknown>(KUNCI.batasWaktu, BATAS_BAWAAN));
}

/** Lama fase (detik) menurut batas host; 0 = tanpa batas. */
export function durasiFase(fase: Fase, b: BatasWaktu): number {
  switch (fase) {
    case 'malam':
      return b.malam;
    case 'diskusi':
      return b.diskusi;
    case 'voting':
      return b.voting;
    case 'pagi':
    case 'hasil_voting':
      return b.lanjut;
    default:
      return 0;
  }
}

/** Penanda langkah: berganti tepat saat fase, ronde, atau putaran vote berganti. */
export function kunciLangkah(g: StateGame): string {
  return `${g.idMain}:${g.fase}:${g.ronde}:${g.putaranVote}`;
}

/** Tenggat langkah yang sedang berjalan, menurut jam host. */
export interface Tenggat {
  kunci: string;
  /** null = tanpa batas untuk langkah ini. */
  sampai: number | null;
  total: number;
}

export function teksDetik(d: number): string {
  if (d === 0) return 'Tanpa batas';
  return d % 60 === 0 ? `${d / 60} menit` : `${d} detik`;
}

export function formatSisa(detik: number): string {
  const d = Math.max(0, Math.ceil(detik));
  return `${Math.floor(d / 60)}:${String(d % 60).padStart(2, '0')}`;
}
