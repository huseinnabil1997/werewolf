// Peristiwa game yang diberi suara, getar, atau notifikasi. Murni (tanpa DOM), jadi bisa diuji.
import type { ViewPribadi, ViewPublik } from '@/lib/online/protokol';

export type Peristiwa =
  /** Pemain baru masuk room (lobby). */
  | 'gabung'
  /** Game dimulai, peran dibagikan. */
  | 'mulai'
  /** Malam tiba. */
  | 'malam'
  /** Giliranmu: aksi malam (Werewolf, Peramal, Dokter) atau voting dibuka. Suara jelas, getar, dan notifikasi. */
  | 'giliranmu'
  /** Voting dimulai (atau vote ulang). */
  | 'vote'
  /** Ada pemain tewas atau tereliminasi. */
  | 'eliminasi'
  /** Malam atau voting tanpa korban. */
  | 'aman'
  | 'menang'
  | 'kalah'
  /** Pesan chat baru dari pemain lain. */
  | 'chat'
  /** Mode lokal: oper HP ke pemain berikutnya. */
  | 'oper'
  /** Mode lokal: kartu peran dibuka. */
  | 'buka'
  /** Mode lokal: giliran pemain berikutnya. */
  | 'giliranLokal'
  /** Hitung mundur batas waktu: satu ketukan per detik di 5 detik terakhir. */
  | 'detik'
  /** Batas waktu habis. */
  | 'waktuHabis';

/** Hanya peristiwa yang khusus untuk pemain ini yang memunculkan notifikasi HP. */
export const PERISTIWA_NOTIFIKASI: readonly Peristiwa[] = ['giliranmu'];

export function perluNotifikasi(p: Peristiwa): boolean {
  return PERISTIWA_NOTIFIKASI.includes(p);
}

/** Pola getar (ms) per peristiwa. Getar panjang hanya untuk giliran; sisanya singkat atau tanpa getar. */
export const POLA_GETAR: Partial<Record<Peristiwa, number[]>> = {
  giliranmu: [180, 90, 180, 90, 320],
  giliranLokal: [120, 70, 200],
  mulai: [60],
  malam: [40],
  vote: [40],
  eliminasi: [90],
  menang: [60, 60, 120],
  kalah: [200],
  detik: [25],
  waktuHabis: [250, 80, 250],
};

export const TEKS_NOTIFIKASI: Partial<Record<Peristiwa, { judul: string; isi: string }>> = {
  giliranmu: { judul: 'Giliranmu!', isi: 'Buka Werewolf: ada aksi yang menunggumu.' },
};

export interface ViewPemain {
  saya: string;
  pub: ViewPublik;
  pri: ViewPribadi | null;
}

/** Kunci unik momen giliran, agar notifikasi untuk giliran yang sama tidak muncul dua kali. */
export function kunciGiliran(v: ViewPemain | null): string | null {
  const g = v?.pub.game;
  const pri = v?.pri;
  if (!v || !g || !pri?.peran || pri.idMain !== g.idMain) return null;
  const aku = v.pub.pemain.find((p) => p.id === v.saya);
  if (!aku?.main || !aku.hidup) return null;
  if (g.fase === 'malam' && pri.peran !== 'warga' && !pri.aksiSelesai && pri.targetSah.length > 0) return `malam-${g.idMain}-${g.ronde}`;
  if (g.fase === 'voting' && !pri.suaraku) return `vote-${g.idMain}-${g.ronde}-${g.putaranVote}`;
  return null;
}

/** Bandingkan view lama dan baru, kembalikan peristiwa yang terjadi untuk pemain ini. */
export function peristiwaOnline(lama: ViewPemain | null, baru: ViewPemain): Peristiwa[] {
  const hasil: Peristiwa[] = [];
  const a = lama?.pub.game ?? null;
  const b = baru.pub.game;
  // Peristiwa pertama setelah menyambung (view awal) tidak dibunyikan, kecuali giliranmu.
  if (!lama) {
    if (kunciGiliran(baru)) hasil.push('giliranmu');
    return hasil;
  }
  if (!b) {
    if (!a && baru.pub.pemain.length > lama.pub.pemain.length) hasil.push('gabung');
    return hasil;
  }
  const gameBaru = !a || a.idMain !== b.idMain;
  if (gameBaru && b.fase === 'peran') hasil.push('mulai');
  if (b.fase === 'malam' && a?.fase !== 'malam') hasil.push('malam');
  if (b.fase === 'voting' && (a?.fase !== 'voting' || a.putaranVote !== b.putaranVote)) hasil.push('vote');
  if (b.fase === 'pagi' && a?.fase !== 'pagi') hasil.push(b.korbanMalam ? 'eliminasi' : 'aman');
  if (b.fase === 'hasil_voting' && a?.fase !== 'hasil_voting') hasil.push(b.hasilVoting?.tereliminasi ? 'eliminasi' : 'aman');
  if (b.fase === 'selesai' && a?.fase !== 'selesai' && b.pemenang) hasil.push(menangkah(baru) ? 'menang' : 'kalah');
  const kA = kunciGiliran(lama);
  const kB = kunciGiliran(baru);
  if (kB && kB !== kA) hasil.push('giliranmu');
  return hasil;
}

/** Apakah pemain ini ada di tim pemenang. Penonton (tidak ikut) dianggap tidak menang. */
export function menangkah(v: ViewPemain): boolean {
  const g = v.pub.game;
  const peran = v.pri?.peran ?? v.pub.pemain.find((x) => x.id === v.saya)?.peran ?? null;
  if (!g?.pemenang || !peran) return false;
  return (peran === 'werewolf') === (g.pemenang === 'werewolf');
}

const PRIORITAS: readonly Peristiwa[] = ['giliranmu', 'menang', 'kalah', 'eliminasi', 'aman', 'vote', 'malam', 'mulai', 'gabung'];

/** Dari beberapa peristiwa sekaligus, bunyikan satu saja yang paling penting agar tidak bertumpuk. */
export function pilihUtama(daftar: Peristiwa[]): Peristiwa | null {
  if (daftar.length === 0) return null;
  return [...daftar].sort((a, b) => urut(a) - urut(b))[0];
}

function urut(p: Peristiwa): number {
  const i = PRIORITAS.indexOf(p);
  return i < 0 ? PRIORITAS.length : i;
}
