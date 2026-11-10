// Penyimpanan lokal di perangkat (localStorage). Tidak ada data yang dikirim ke server.
const PREFIX = 'werewolf:';

export const KUNCI = {
  /** Pilihan leaderboard: urutan ('menang' | 'winrate') dan peran ('semua' | peran). */
  peringkatUrut: 'peringkatUrut',
  peringkatPeran: 'peringkatPeran',
  /** Snapshot top 3 musim berjalan milik sendiri (pemberitahuan masuk top 3). */
  top3Musim: 'top3Musim',
  /** Room buatan sendiri tampil di daftar publik (true) atau privat. */
  publikRoom: 'publikRoom',
  /** Batas waktu online pilihan host: { malam, diskusi, voting, lanjut } dalam detik. */
  batasWaktu: 'batasWaktu',
  /** Ukuran matchmaking terakhir (4 sampai 8, atau null = Acak). */
  ukuranMatch: 'ukuranMatch',
} as const;

export function baca<T>(kunci: string, cadangan: T): T {
  if (typeof window === 'undefined') return cadangan;
  try {
    const raw = window.localStorage.getItem(PREFIX + kunci);
    return raw === null ? cadangan : (JSON.parse(raw) as T);
  } catch {
    return cadangan;
  }
}

export function simpan(kunci: string, nilai: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFIX + kunci, JSON.stringify(nilai));
  } catch {
    // Penyimpanan penuh atau diblokir: abaikan, game tetap jalan.
  }
}

export function hapus(kunci: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PREFIX + kunci);
  } catch {
    // abaikan
  }
}
