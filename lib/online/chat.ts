// Chat room mode online. Host menjadi relay: menerima pesan dari pemain, memvalidasi,
// lalu meneruskan ke semua pemain. Pesan hanya hidup di memori HP host selama room dibuka.
// Tidak ada pesan sistem otomatis, jadi kata rahasia atau peran tidak pernah dikirim lewat chat.

export const MAKS_PANJANG_CHAT = 200;
export const MAKS_RIWAYAT_CHAT = 50;
/** Rate limit: maksimal sekian pesan per pemain dalam jendela waktu ini. */
export const LIMIT_CHAT = { jumlah: 5, jendelaMs: 10_000 } as const;
export const EMOJI_CEPAT = ['👍', '😂', '😮', '🤔', '👏', '🔥'] as const;

export interface PesanChat {
  id: string;
  dari: string;
  nama: string;
  teks: string;
  /** Waktu terima di host (ms epoch). */
  waktu: number;
}

export interface StateChat {
  pesan: PesanChat[];
  /** Waktu pesan terakhir per pemain, untuk rate limit. */
  laju: Record<string, number[]>;
  urut: number;
}

export function buatStateChat(): StateChat {
  return { pesan: [], laju: {}, urut: 0 };
}

/**
 * Rapikan teks chat: buang karakter kontrol, satukan spasi berlebih, potong ke batas panjang
 * (dihitung per karakter Unicode agar emoji tidak terpotong setengah). null jika kosong / bukan string.
 * Teks selalu dirender sebagai teks biasa oleh React (tanpa HTML), jadi tag apa pun tampil apa adanya.
 */
export function rapikanTeksChat(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const bersih = x
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b\u200c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!bersih) return null;
  return Array.from(bersih).slice(0, MAKS_PANJANG_CHAT).join('');
}

export const GALAT_CHAT_CEPAT = 'Terlalu cepat mengirim pesan. Tunggu sebentar.';

/**
 * Rate limit di sisi klien, dicek SEBELUM pesan dikirim dan kolom input dikosongkan, dengan aturan yang sama
 * seperti di host. Mengembalikan riwayat waktu kirim yang baru, atau null jika harus ditolak.
 */
export function lajuKlien(riwayat: readonly number[], now: number): number[] | null {
  const baru = riwayat.filter((t) => now - t < LIMIT_CHAT.jendelaMs);
  if (baru.length >= LIMIT_CHAT.jumlah) return null;
  return [...baru, now];
}

export interface HasilChat {
  state: StateChat;
  pesan?: PesanChat;
  tolak?: string;
}

/**
 * Terima satu pesan di host. `pengirim` diambil dari daftar pemain di state host (bukan dari isi pesan),
 * jadi pemain tidak bisa memalsukan nama atau id orang lain. Pemain tereliminasi tetap boleh chat.
 */
export function terimaChat(
  s: StateChat,
  pengirim: { id: string; nama: string } | undefined,
  teksMentah: unknown,
  now: number,
): HasilChat {
  if (!pengirim) return { state: s, tolak: 'Kamu bukan anggota room ini.' };
  const teks = rapikanTeksChat(teksMentah);
  if (!teks) return { state: s };
  const baru = (s.laju[pengirim.id] ?? []).filter((t) => now - t < LIMIT_CHAT.jendelaMs);
  if (baru.length >= LIMIT_CHAT.jumlah) {
    return { state: s, tolak: GALAT_CHAT_CEPAT };
  }
  const urut = s.urut + 1;
  const pesan: PesanChat = { id: `${now.toString(36)}-${urut}`, dari: pengirim.id, nama: pengirim.nama, teks, waktu: now };
  return {
    state: {
      pesan: [...s.pesan, pesan].slice(-MAKS_RIWAYAT_CHAT),
      laju: { ...s.laju, [pengirim.id]: [...baru, now] },
      urut,
    },
    pesan,
  };
}

/** Bentuk aman pesan dari jaringan (di klien). Pesan yang tidak valid dibuang. */
export function validasiPesanChat(x: unknown): PesanChat | null {
  if (!x || typeof x !== 'object') return null;
  const p = x as Record<string, unknown>;
  const teks = rapikanTeksChat(p.teks);
  if (typeof p.id !== 'string' || typeof p.dari !== 'string' || typeof p.nama !== 'string' || typeof p.waktu !== 'number' || !teks) return null;
  return { id: p.id.slice(0, 40), dari: p.dari.slice(0, 40), nama: p.nama.slice(0, 40), teks, waktu: p.waktu };
}

/** Gabungkan pesan baru ke daftar di klien: tanpa duplikat (berdasarkan id), urut waktu, maksimal riwayat. */
export function gabungChat(lama: PesanChat[], masuk: unknown[]): PesanChat[] {
  const ada = new Set(lama.map((p) => p.id));
  const tambahan: PesanChat[] = [];
  for (const m of masuk) {
    const p = validasiPesanChat(m);
    if (p && !ada.has(p.id)) {
      ada.add(p.id);
      tambahan.push(p);
    }
  }
  if (tambahan.length === 0) return lama;
  return [...lama, ...tambahan].sort((a, b) => a.waktu - b.waktu).slice(-MAKS_RIWAYAT_CHAT);
}

/** Jumlah pesan dari orang lain setelah pesan terakhir yang sudah dibaca. */
export function hitungBelumDibaca(pesan: PesanChat[], idTerakhirDibaca: string | null, saya: string): number {
  const i = idTerakhirDibaca ? pesan.findIndex((p) => p.id === idTerakhirDibaca) : -1;
  return pesan.slice(i + 1).filter((p) => p.dari !== saya).length;
}

/** Pesan yang hanya berisi 1 sampai 3 emoji ditampilkan lebih besar. */
export function hanyaEmoji(teks: string): boolean {
  return /^(?:\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*\s?){1,3}$/u.test(teks);
}

export function jamChat(waktu: number): string {
  const d = new Date(waktu);
  return `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
}
