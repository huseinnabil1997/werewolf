// Pengaman "loading tanpa ujung": jika belum tersambung dalam BATAS_MENYAMBUNG_MS, UI berhenti menampilkan
// pemutar saja dan memberi alasan yang jelas plus tombol Coba lagi / Keluar dari room. Murni.
import type { StatusSambung } from './jaringan';

export const BATAS_MENYAMBUNG_MS = 15000;

/** Sudah terlalu lama belum tersambung atau belum menerima data. `sejak` = awal percobaan atau saat terakhir terputus. */
export function sudahMacet(status: StatusSambung, adaData: boolean, sejak: number, sekarang: number): boolean {
  if (status === 'tidakAda') return true;
  return (status !== 'tersambung' || !adaData) && sejak > 0 && sekarang - sejak >= BATAS_MENYAMBUNG_MS;
}

const PESAN_INTERNET = 'Server penghubung belum bisa dijangkau. Periksa koneksi internet lalu coba lagi.';

/** Pesan yang ditampilkan saat macet, sesuai status jaringan terakhir. */
export function pesanMacet(host: boolean, kode: string, status: StatusSambung): string {
  if (status === 'tidakAda') return `Room ${kode} tidak ditemukan. Mungkin room sudah ditutup atau kodenya salah.`;
  if (host) return `Room ${kode} belum bisa dibuka. ${PESAN_INTERNET}`;
  if (status === 'tersambung') return `Host room ${kode} belum menjawab. Bila host sudah pergi, pemain lain akan mengambil alih otomatis dalam beberapa detik.`;
  return `${PESAN_INTERNET} Jalur cadangan langsung ke HP host juga sedang dicoba.`;
}
