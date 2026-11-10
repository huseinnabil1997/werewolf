// Logika murni dialog in-app (pengganti popup bawaan browser).
// Dipisah dari komponen agar mudah diuji tanpa DOM.

export type JenisDialog = 'info' | 'konfirmasi' | 'input';

interface OpsiDasar {
  judul: string;
  pesan?: string;
  /** Label tombol utama. */
  ok?: string;
  /**
   * Dialog kritis tidak bisa ditutup dengan klik backdrop.
   * Esc tetap berarti "Batal" (aman) kecuali untuk dialog info kritis.
   */
  kritis?: boolean;
}

export interface OpsiInfo extends OpsiDasar {
  /** Teks yang ditampilkan di kolom baca-saja agar mudah disalin manual (mis. link room). */
  teksSalin?: string;
}

export interface OpsiKonfirmasi extends OpsiDasar {
  batal?: string;
  /** Aksi destruktif: tombol utama merah dan fokus awal di tombol Batal. */
  bahaya?: boolean;
}

export interface OpsiInput extends OpsiDasar {
  batal?: string;
  label: string;
  nilaiAwal?: string;
  placeholder?: string;
  maksPanjang?: number;
}

export type PermintaanDialog =
  | ({ jenis: 'info' } & OpsiInfo)
  | ({ jenis: 'konfirmasi' } & OpsiKonfirmasi)
  | ({ jenis: 'input' } & OpsiInput);

export type HasilDialog = undefined | boolean | string | null;

export const DURASI_MASUK_MS = 200;
export const DURASI_KELUAR_MS = 160;

/** Nilai yang dikembalikan saat dialog ditutup tanpa memilih tombol utama. */
export function nilaiBatal(jenis: JenisDialog): HasilDialog {
  if (jenis === 'konfirmasi') return false;
  if (jenis === 'input') return null;
  return undefined;
}

/** Nilai saat tombol utama dipilih. Input kosong (setelah trim) tidak boleh dikirim. */
export function nilaiOk(p: PermintaanDialog, teks = ''): HasilDialog {
  if (p.jenis === 'konfirmasi') return true;
  if (p.jenis === 'input') {
    const rapi = teks.trim();
    return rapi ? rapi.slice(0, p.maksPanjang ?? 200) : null;
  }
  return undefined;
}

export function bolehTutupBackdrop(p: PermintaanDialog): boolean {
  return !p.kritis && !(p.jenis === 'konfirmasi' && p.bahaya);
}

export function bolehTutupEsc(p: PermintaanDialog): boolean {
  // Esc pada konfirmasi/input = Batal, selalu aman. Info kritis wajib dibaca dan ditekan tombolnya.
  return !(p.jenis === 'info' && p.kritis);
}

/** Focus trap sederhana: indeks elemen fokus berikutnya saat Tab / Shift+Tab. */
export function indeksFokusBerikut(sekarang: number, total: number, mundur: boolean): number {
  if (total <= 0) return -1;
  if (sekarang < 0) return mundur ? total - 1 : 0;
  return (sekarang + (mundur ? -1 : 1) + total) % total;
}
