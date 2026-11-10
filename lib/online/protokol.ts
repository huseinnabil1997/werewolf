// Protokol online: state host, view publik (untuk semua anggota room), dan view pribadi (per pemain).
// Prinsip: view publik TIDAK PERNAH memuat peran pemain yang masih hidup, aksi malam, hasil Peramal, atau chat
// werewolf. Info rahasia hanya masuk ke view pribadi pemain yang berhak, dikirim lewat kanal miliknya sendiri.
import { durasiFase, kunciLangkah, rapikanBatas, BATAS_BAWAAN, TAMBAHAN_PULIH_MS, type BatasWaktu, type Tenggat } from '../batasWaktu';
import { buatStateChat, terimaChat, type PesanChat as PesanChatRoom, type StateChat } from './chat';
import {
  LEWATI,
  aksiMalam,
  batalSiap,
  keluarkanPemain,
  targetSahVoting,
  beriSuara,
  cekKomposisi,
  komposisiOtomatis,
  lanjutMalam,
  malamLengkap,
  mulaiDiskusi,
  mulaiGame,
  mulaiVoting,
  paksaMalam,
  rekanWerewolf,
  selesaikanMalam,
  selesaikanVoting,
  tandaiSiap,
  targetSahMalam,
  votingLengkap,
  type Fase,
  type HasilLihat,
  type HasilVoting,
  type Komposisi,
  type Peran,
  type Rng,
  type StateGame,
  type Tim,
} from '../game';

export const HURUF_KODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function buatKode(rng: Rng = Math.random): string {
  let k = '';
  for (let i = 0; i < 5; i++) k += HURUF_KODE[Math.floor(rng() * HURUF_KODE.length)];
  return k;
}

export function rapikanKode(s: string | null | undefined): string | null {
  const k = (s ?? '').trim().toUpperCase();
  return /^[A-Z]{5}$/.test(k) ? k : null;
}

export function kodeDariUrl(search: string): string | null {
  return rapikanKode(new URLSearchParams(search).get('room'));
}

export const topikRoom = (kode: string) => `ww:${kode}`;
export const topikPemain = (kode: string, uid: string) => `ww:${kode}:${uid}`;
/** Id PeerJS host (jalur cadangan). Memuat id host agar host baru setelah pindah tidak bentrok dengan yang lama. */
export const peerIdHost = (kode: string, hostId: string) => `werewolf-hn-${kode}-${hostId}`;

/** Versi bentuk state; snapshot dengan versi lain tidak dipulihkan. */
export const VERSI_STATE = 2;
/** Pemain dianggap offline bila host tidak menerima pesan apa pun darinya selama ini. */
export const BATAS_OFFLINE_MS = 15000;

export interface PesanChat {
  dari: string;
  teks: string;
  waktu: number;
}

export interface AnggotaRoom {
  id: string;
  nama: string;
}

export interface InfoMatch {
  maks: number;
  acak: boolean;
}

export interface StateHost {
  bentuk: number;
  kode: string;
  hostId: string;
  anggota: AnggotaRoom[];
  komposisiManual: Komposisi | null;
  batas: BatasWaktu;
  game: StateGame | null;
  chatWW: PesanChat[];
  chat: StateChat;
  /** Room tampil di daftar publik. Room match selalu publik. */
  publik: boolean;
  match: InfoMatch | null;
  tenggat: Tenggat | null;
  /** Pemain yang dikeluarkan host; tidak dimasukkan lagi ke room ini. */
  dikeluarkan: string[];
  /** Kunci AES snapshot (base64). Hanya dibagikan ke anggota terverifikasi lewat view pribadi. */
  kunciSnapshot: string;
  versi: number;
}

export function buatKunciSnapshot(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(32));
  let t = '';
  for (const x of b) t += String.fromCharCode(x);
  return btoa(t);
}

export function stateHostBaru(
  kode: string,
  hostId: string,
  nama: string,
  opsi: { batas?: BatasWaktu; publik?: boolean; match?: InfoMatch | null; kunci?: string } = {},
): StateHost {
  return {
    bentuk: VERSI_STATE,
    kode,
    hostId,
    anggota: [{ id: hostId, nama }],
    komposisiManual: null,
    batas: opsi.batas ?? BATAS_BAWAAN,
    game: null,
    chatWW: [],
    chat: buatStateChat(),
    publik: !!opsi.match || !!opsi.publik,
    match: opsi.match ?? null,
    tenggat: null,
    dikeluarkan: [],
    kunciSnapshot: opsi.kunci ?? buatKunciSnapshot(),
    versi: 0,
  };
}

/** State dari snapshot/penyimpanan: null bila bentuknya tidak cocok. */
export function rapikanStateHost(x: unknown, kode: string): StateHost | null {
  if (!x || typeof x !== 'object') return null;
  const s = x as StateHost;
  if (s.bentuk !== VERSI_STATE || s.kode !== kode || !Array.isArray(s.anggota) || typeof s.kunciSnapshot !== 'string') return null;
  return { ...s, batas: rapikanBatas(s.batas), chat: s.chat ?? buatStateChat(), dikeluarkan: s.dikeluarkan ?? [] };
}

/**
 * Host berpindah: pemain ini menjadi host dengan state terakhir. Tenggat yang sedang berjalan diberi tambahan
 * waktu agar pemain sempat tersambung ulang ke host baru.
 */
export function pindahHost(s: StateHost, hostBaru: string, sekarang = Date.now()): StateHost {
  const tenggat = s.tenggat?.sampai ? { ...s.tenggat, sampai: Math.max(s.tenggat.sampai, sekarang) + TAMBAHAN_PULIH_MS } : s.tenggat;
  return { ...s, hostId: hostBaru, tenggat, versi: s.versi + 1 };
}

export function komposisiDipakai(s: StateHost, jumlah = s.anggota.length): Komposisi {
  return s.komposisiManual ?? komposisiOtomatis(jumlah);
}

/** Pasang tenggat untuk langkah yang baru dimulai (dipanggil setiap state berubah). */
export function aturTenggat(s: StateHost, sekarang = Date.now()): StateHost {
  const g = s.game;
  if (!g || g.fase === 'selesai' || g.fase === 'peran') return s.tenggat ? { ...s, tenggat: null } : s;
  const kunci = kunciLangkah(g);
  if (s.tenggat?.kunci === kunci) return s;
  const d = durasiFase(g.fase, s.batas) * 1000;
  return { ...s, tenggat: { kunci, sampai: d > 0 ? sekarang + d : null, total: d } };
}

/* --------------------------------- View --------------------------------- */

export interface PemainPublik {
  id: string;
  nama: string;
  hidup: boolean;
  /** Peran hanya terlihat bila pemain sudah tewas atau game selesai. */
  peran: Peran | null;
  /** Ikut dalam game yang sedang berjalan. */
  main: boolean;
  online: boolean;
}

export interface ViewPublik {
  kode: string;
  hostId: string;
  versi: number;
  waktu: number;
  pemain: PemainPublik[];
  komposisi: Komposisi;
  komposisiManual: boolean;
  batas: BatasWaktu;
  publik: boolean;
  match: InfoMatch | null;
  chat: PesanChatRoom[];
  /** Host sedang keluar room: anggota lain segera mengambil alih. */
  hostKeluar?: boolean;
  /** Sisa waktu langkah ini menurut host (ms), null bila tanpa batas. Klien menghitung dari waktu terima. */
  sisaMs: number | null;
  totalMs: number;
  game: null | {
    idMain: string;
    fase: Fase;
    ronde: number;
    jumlahSiap: number;
    siap: string[];
    korbanMalam: string | null;
    /** Siapa saja yang sudah memberi suara (bukan pilihannya) saat voting berlangsung. */
    sudahVote: string[];
    /** Rincian suara hanya dibuka setelah voting selesai. */
    suaraTerbuka: Record<string, string> | null;
    putaranVote: 1 | 2;
    kandidat: string[];
    hasilVoting: HasilVoting | null;
    pemenang: Tim | null;
    log: string[];
  };
}

export interface ViewPribadi {
  untuk: string;
  versi: number;
  idMain: string | null;
  peran: Peran | null;
  siap: boolean;
  rekan: string[];
  /** Pilihan werewolf malam ini (hanya untuk werewolf). */
  pilihanTim: Record<string, string>;
  aksiSelesai: boolean;
  targetMalam: string | null;
  targetSah: string[];
  targetVoting: string[];
  riwayatLihat: HasilLihat[];
  lindungiSebelum: string | null;
  suaraku: string | null;
  chatWW: PesanChat[];
  /** Kunci snapshot untuk pindah host otomatis (bukan info permainan). */
  kunci: string;
  dikeluarkan: boolean;
  galat: string | null;
}

export function viewPublik(s: StateHost, online: ReadonlySet<string> = new Set(), sekarang = Date.now()): ViewPublik {
  const g = s.game;
  const idMain = new Set(g?.pemain.map((p) => p.id) ?? []);
  const aktif = (id: string) => id === s.hostId || online.has(id);
  const pemain: PemainPublik[] = s.anggota.map((a) => {
    const main = idMain.has(a.id);
    const hidup = !g || !main ? true : !!g.hidup[a.id];
    const buka = !!g && main && (!hidup || g.fase === 'selesai');
    return { id: a.id, nama: a.nama, hidup, peran: buka ? g!.peran[a.id] : null, main, online: aktif(a.id) };
  });
  // Pemain game yang sudah tidak ada di daftar anggota tetap ditampilkan.
  if (g) for (const p of g.pemain) if (!pemain.some((x) => x.id === p.id)) {
    const hidup = !!g.hidup[p.id];
    pemain.push({ id: p.id, nama: p.nama, hidup, peran: !hidup || g.fase === 'selesai' ? g.peran[p.id] : null, main: true, online: aktif(p.id) });
  }
  const t = s.tenggat;
  return {
    kode: s.kode,
    hostId: s.hostId,
    versi: s.versi,
    waktu: sekarang,
    pemain,
    komposisi: komposisiDipakai(s, g ? g.pemain.length : s.anggota.filter((a) => aktif(a.id)).length),
    komposisiManual: !!s.komposisiManual,
    batas: s.batas,
    publik: s.publik,
    match: s.match,
    chat: s.chat.pesan,
    sisaMs: t?.sampai ? Math.max(0, t.sampai - sekarang) : null,
    totalMs: t?.total ?? 0,
    game: g && {
      idMain: g.idMain,
      fase: g.fase,
      ronde: g.ronde,
      jumlahSiap: Object.keys(g.siap).length,
      siap: g.fase === 'peran' ? Object.keys(g.siap) : [],
      korbanMalam: g.korbanMalam,
      sudahVote: g.fase === 'voting' ? Object.keys(g.suara) : [],
      suaraTerbuka: g.fase === 'voting' ? null : g.suara,
      putaranVote: g.putaranVote,
      kandidat: g.kandidat,
      hasilVoting: g.hasilVoting,
      pemenang: g.pemenang,
      log: g.log,
    },
  };
}

export function viewPribadi(s: StateHost, id: string, galat: string | null = null): ViewPribadi {
  const dikeluarkan = s.dikeluarkan.includes(id);
  const g = dikeluarkan ? null : s.game;
  const ikut = !!g && id in (g?.peran ?? {});
  const peran = ikut ? g!.peran[id] : null;
  const ww = peran === 'werewolf';
  const rekan = ikut && ww ? rekanWerewolf(g!, id) : [];
  const timWW = new Set([id, ...rekan]);
  return {
    untuk: id,
    versi: s.versi,
    idMain: g?.idMain ?? null,
    peran,
    siap: ikut ? !!g!.siap[id] : false,
    rekan,
    pilihanTim: ww && g!.fase === 'malam' ? Object.fromEntries(Object.entries(g!.malam.pilihanWW).filter(([k]) => timWW.has(k))) : {},
    aksiSelesai: ikut && g!.fase === 'malam' ? !!g!.malam.selesai[id] : false,
    targetMalam:
      ikut && g!.fase === 'malam'
        ? peran === 'werewolf'
          ? (g!.malam.pilihanWW[id] ?? null)
          : peran === 'peramal'
            ? g!.malam.lihat
            : peran === 'dokter'
              ? g!.malam.lindungi
              : null
        : null,
    targetSah: ikut && g!.fase === 'malam' && g!.hidup[id] ? targetSahMalam(g!, id) : [],
    targetVoting: ikut && g!.fase === 'voting' && g!.hidup[id] ? targetSahVoting(g!, id) : [],
    riwayatLihat: peran === 'peramal' ? g!.riwayatLihat : [],
    lindungiSebelum: peran === 'dokter' ? g!.lindungiSebelum : null,
    suaraku: ikut && g!.fase === 'voting' ? (g!.suara[id] ?? null) : null,
    chatWW: ww ? s.chatWW : [],
    kunci: dikeluarkan ? '' : s.kunciSnapshot,
    dikeluarkan,
    galat,
  };
}

/* ------------------------------ Aksi pemain ------------------------------ */

export type AksiPemain =
  | { jenis: 'halo' }
  | { jenis: 'siap' }
  | { jenis: 'batal_siap' }
  | { jenis: 'malam'; target: string }
  | { jenis: 'suara'; target: string }
  | { jenis: 'chat'; teks: string }
  | { jenis: 'chat_room'; teks: string }
  | { jenis: 'keluar' };

export type AksiHost =
  | { jenis: 'komposisi'; komposisi: Komposisi | null }
  | { jenis: 'batas'; batas: BatasWaktu }
  | { jenis: 'publik'; publik: boolean }
  | { jenis: 'mulai'; peserta?: string[] }
  | { jenis: 'paksa_malam' }
  | { jenis: 'akhiri_malam' }
  | { jenis: 'diskusi' }
  | { jenis: 'voting' }
  | { jenis: 'tutup_voting' }
  | { jenis: 'malam_berikut' }
  | { jenis: 'main_lagi'; peserta?: string[] }
  | { jenis: 'ke_lobby' }
  | { jenis: 'keluarkan'; id: string };

export function aksiSah(x: unknown): AksiPemain | null {
  if (!x || typeof x !== 'object') return null;
  const a = x as Record<string, unknown>;
  if (a.jenis === 'halo' || a.jenis === 'siap' || a.jenis === 'batal_siap' || a.jenis === 'keluar') return { jenis: a.jenis };
  if ((a.jenis === 'malam' || a.jenis === 'suara') && typeof a.target === 'string' && a.target.length <= 64) return { jenis: a.jenis, target: a.target };
  if ((a.jenis === 'chat' || a.jenis === 'chat_room') && typeof a.teks === 'string') {
    const teks = a.teks.trim().slice(0, 200);
    return teks ? { jenis: a.jenis, teks } : null;
  }
  return null;
}

export interface HasilProses {
  state: StateHost;
  /** Galat untuk pengirim saja. */
  galat: string | null;
  berubah: boolean;
}

const naik = (s: StateHost, game: StateGame | null, extra: Partial<StateHost> = {}, sekarang = Date.now()): StateHost =>
  aturTenggat({ ...s, ...extra, game, versi: s.versi + 1 }, sekarang);

export const GALAT_CHAT_MALAM = 'Malam hari: chat room ditutup sampai pagi.';
export const GALAT_CHAT_TEWAS = 'Pemain yang tewas dan penonton tidak bisa chat sampai permainan selesai.';

/** Siapa yang boleh chat room sekarang: semua anggota di lobby/hasil; saat main hanya pemain hidup dan bukan malam. */
export function alasanTolakChat(s: StateHost, id: string): string | null {
  const g = s.game;
  if (!g || g.fase === 'selesai') return null;
  if (!(id in g.peran) || !g.hidup[id]) return GALAT_CHAT_TEWAS;
  if (g.fase === 'malam') return GALAT_CHAT_MALAM;
  return null;
}

/** Proses aksi dari pemain id (setelah host yakin id berasal dari kanal pemain itu). */
export function prosesAksiPemain(s: StateHost, id: string, a: AksiPemain, rng: Rng = Math.random, sekarang = Date.now()): HasilProses {
  const g = s.game;
  const tetap = (galat: string | null = null): HasilProses => ({ state: s, galat, berubah: false });
  if (a.jenis === 'halo') return tetap();
  if (s.dikeluarkan.includes(id)) return tetap('Kamu dikeluarkan dari room ini.');
  if (a.jenis === 'chat_room') {
    const anggota = s.anggota.find((x) => x.id === id);
    const tolak = anggota ? alasanTolakChat(s, id) : 'Kamu bukan anggota room ini.';
    if (tolak) return tetap(tolak);
    const h = terimaChat(s.chat, anggota, a.teks, sekarang);
    if (!h.pesan) return tetap(h.tolak ?? null);
    return { state: { ...s, chat: h.state, versi: s.versi + 1 }, galat: null, berubah: true };
  }
  if (a.jenis === 'keluar') {
    if (id === s.hostId) return tetap();
    const main = !!g && g.fase !== 'selesai' && id in g.peran;
    if (main) return tetap();
    return { state: { ...s, anggota: s.anggota.filter((x) => x.id !== id), versi: s.versi + 1 }, galat: null, berubah: true };
  }
  if (!g || !(id in g.peran)) return tetap('Kamu tidak ikut permainan ini.');
  if (a.jenis === 'siap') {
    if (g.fase !== 'peran' || g.siap[id]) return tetap();
    return { state: naik(s, tandaiSiap(g, id), {}, sekarang), galat: null, berubah: true };
  }
  if (a.jenis === 'batal_siap') {
    if (g.fase !== 'peran' || !g.siap[id]) return tetap();
    return { state: naik(s, batalSiap(g, id), {}, sekarang), galat: null, berubah: true };
  }
  if (a.jenis === 'malam') {
    const h = aksiMalam(g, id, a.target);
    if (!h.ok) return tetap(h.galat);
    let game = h.state;
    if (malamLengkap(game)) game = selesaikanMalam(game, rng);
    return { state: naik(s, game, {}, sekarang), galat: null, berubah: true };
  }
  if (a.jenis === 'suara') {
    const h = beriSuara(g, id, a.target === LEWATI ? LEWATI : a.target);
    if (!h.ok) return tetap(h.galat);
    let game = h.state;
    if (votingLengkap(game)) game = selesaikanVoting(game);
    return { state: naik(s, game, {}, sekarang), galat: null, berubah: true };
  }
  if (a.jenis === 'chat') {
    if (g.peran[id] !== 'werewolf' || !g.hidup[id]) return tetap('Chat ini khusus werewolf yang masih hidup.');
    const chatWW = [...s.chatWW, { dari: id, teks: a.teks, waktu: sekarang }].slice(-50);
    return { state: naik(s, g, { chatWW }, sekarang), galat: null, berubah: true };
  }
  return tetap();
}

/** Peserta game baru: pilihan host (pemain online) yang masih anggota; selain itu semua anggota. */
export function pesertaGame(s: StateHost, peserta?: string[]): AnggotaRoom[] {
  if (!peserta) return s.anggota;
  const pilih = new Set([...peserta, s.hostId]);
  return s.anggota.filter((a) => pilih.has(a.id));
}

export function prosesAksiHost(s: StateHost, a: AksiHost, rng: Rng = Math.random, sekarang = Date.now()): HasilProses {
  const g = s.game;
  const tetap = (galat: string | null = null): HasilProses => ({ state: s, galat, berubah: false });
  const ganti = (game: StateGame | null, extra: Partial<StateHost> = {}): HasilProses => ({ state: naik(s, game, extra, sekarang), galat: null, berubah: true });
  const berjalan = !!g && g.fase !== 'selesai';
  switch (a.jenis) {
    case 'komposisi':
      if (berjalan) return tetap('Permainan sedang berjalan.');
      return ganti(g, { komposisiManual: a.komposisi });
    case 'batas':
      return ganti(g, { batas: rapikanBatas(a.batas) });
    case 'publik':
      if (s.match) return tetap('Room match selalu publik.');
      return ganti(g, { publik: a.publik });
    case 'mulai':
    case 'main_lagi': {
      if (berjalan) return tetap('Permainan sedang berjalan.');
      const peserta = pesertaGame(s, a.peserta);
      const k = komposisiDipakai(s, peserta.length);
      const galat = cekKomposisi(peserta.length, k);
      if (galat) return tetap(galat);
      return ganti(mulaiGame(peserta, k, { durasiDiskusi: s.batas.diskusi, rng }), { chatWW: [] });
    }
    case 'ke_lobby':
      return g ? ganti(null, { chatWW: [], tenggat: null }) : tetap();
    case 'keluarkan': {
      if (a.id === s.hostId) return tetap('Host tidak bisa mengeluarkan diri sendiri.');
      if (!s.anggota.some((x) => x.id === a.id) && !(g && a.id in g.peran)) return tetap();
      const game = g && berjalan && a.id in g.peran ? keluarkanPemain(g, a.id, rng) : g;
      return ganti(game, {
        anggota: s.anggota.filter((x) => x.id !== a.id),
        dikeluarkan: [...new Set([...s.dikeluarkan, a.id])],
      });
    }
    case 'paksa_malam':
      return g ? ganti(paksaMalam(g)) : tetap();
    case 'akhiri_malam':
      return g && g.fase === 'malam' ? ganti(selesaikanMalam(g, rng)) : tetap();
    case 'diskusi':
      return g ? ganti(mulaiDiskusi(g, sekarang)) : tetap();
    case 'voting':
      return g ? ganti(mulaiVoting(g)) : tetap();
    case 'tutup_voting':
      return g && g.fase === 'voting' ? ganti(selesaikanVoting(g)) : tetap();
    case 'malam_berikut':
      return g ? ganti(lanjutMalam(g)) : tetap();
  }
}

/** Aksi host otomatis saat tenggat langkah habis. */
export const AKSI_WAKTU_HABIS: Partial<Record<Fase, AksiHost['jenis']>> = {
  malam: 'akhiri_malam',
  pagi: 'diskusi',
  diskusi: 'voting',
  voting: 'tutup_voting',
  hasil_voting: 'malam_berikut',
};

/** Dipanggil host tiap detik: jalankan aksi otomatis bila tenggat langkah sudah lewat. */
export function prosesWaktu(s: StateHost, rng: Rng = Math.random, sekarang = Date.now()): HasilProses {
  const g = s.game;
  const t = s.tenggat;
  if (!g || !t?.sampai || sekarang < t.sampai || t.kunci !== kunciLangkah(g)) return { state: s, galat: null, berubah: false };
  const jenis = AKSI_WAKTU_HABIS[g.fase];
  if (!jenis) return { state: s, galat: null, berubah: false };
  return prosesAksiHost(s, { jenis } as AksiHost, rng, sekarang);
}

/** Tambah anggota baru dari daftar server (urutan gabung). Anggota yang keluar dihapus bila tidak sedang main. */
export function sinkronAnggota(s: StateHost, daftar: AnggotaRoom[]): StateHost {
  const g = s.game;
  const main = new Set(g && g.fase !== 'selesai' ? g.pemain.map((p) => p.id) : []);
  const keluar = new Set(s.dikeluarkan);
  const masuk = daftar.filter((d) => !keluar.has(d.id));
  const ada = new Set(masuk.map((d) => d.id));
  const anggota = [
    ...s.anggota.filter((a) => a.id === s.hostId || ada.has(a.id) || main.has(a.id)),
    ...masuk.filter((d) => !s.anggota.some((a) => a.id === d.id)),
  ];
  const sama = anggota.length === s.anggota.length && anggota.every((a, i) => a.id === s.anggota[i].id && a.nama === s.anggota[i].nama);
  return sama ? s : { ...s, anggota, versi: s.versi + 1 };
}

/** Baris hasil untuk RPC catat_hasil_room. */
export function barisHasil(g: StateGame): { user_id: string; peran: Peran; menang: boolean; pemenang: Tim }[] {
  if (g.fase !== 'selesai' || !g.pemenang) return [];
  return g.pemain.map((p) => ({
    user_id: p.id,
    peran: g.peran[p.id],
    menang: (g.peran[p.id] === 'werewolf') === (g.pemenang === 'werewolf'),
    pemenang: g.pemenang!,
  }));
}

/** Meta aman untuk daftar room publik (tanpa peran). */
export function metaPublik(s: StateHost, namaHost: string, online: ReadonlySet<string>): { host: string; jumlah: number; status: 'lobby' | 'main'; match: boolean } {
  const g = s.game;
  return {
    host: namaHost,
    jumlah: s.anggota.filter((a) => a.id === s.hostId || online.has(a.id)).length,
    status: g && g.fase !== 'selesai' ? 'main' : 'lobby',
    match: !!s.match,
  };
}
