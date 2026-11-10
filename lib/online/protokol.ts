// Protokol online: state host, view publik (untuk semua anggota room), dan view pribadi (per pemain).
// Prinsip: view publik TIDAK PERNAH memuat peran pemain yang masih hidup, aksi malam, hasil Peramal, atau chat
// werewolf. Info rahasia hanya masuk ke view pribadi pemain yang berhak, dikirim lewat kanal miliknya sendiri.
import {
  LEWATI,
  aksiMalam,
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

export interface PesanChat {
  dari: string;
  teks: string;
  waktu: number;
}

export interface AnggotaRoom {
  id: string;
  nama: string;
}

export interface StateHost {
  kode: string;
  hostId: string;
  anggota: AnggotaRoom[];
  komposisiManual: Komposisi | null;
  durasiDiskusi: number;
  game: StateGame | null;
  chatWW: PesanChat[];
  versi: number;
}

export function stateHostBaru(kode: string, hostId: string, nama: string): StateHost {
  return { kode, hostId, anggota: [{ id: hostId, nama }], komposisiManual: null, durasiDiskusi: 120, game: null, chatWW: [], versi: 0 };
}

export function komposisiDipakai(s: StateHost): Komposisi {
  return s.komposisiManual ?? komposisiOtomatis(s.anggota.length);
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
}

export interface ViewPublik {
  kode: string;
  hostId: string;
  versi: number;
  waktu: number;
  pemain: PemainPublik[];
  komposisi: Komposisi;
  komposisiManual: boolean;
  durasiDiskusi: number;
  game: null | {
    idMain: string;
    fase: Fase;
    ronde: number;
    jumlahSiap: number;
    korbanMalam: string | null;
    /** Siapa saja yang sudah memberi suara (bukan pilihannya) saat voting berlangsung. */
    sudahVote: string[];
    /** Rincian suara hanya dibuka setelah voting selesai. */
    suaraTerbuka: Record<string, string> | null;
    hasilVoting: HasilVoting | null;
    pemenang: Tim | null;
    diskusiSampai: number | null;
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
  riwayatLihat: HasilLihat[];
  lindungiSebelum: string | null;
  suaraku: string | null;
  chatWW: PesanChat[];
  galat: string | null;
}

export function viewPublik(s: StateHost, sekarang = Date.now()): ViewPublik {
  const g = s.game;
  const idMain = new Set(g?.pemain.map((p) => p.id) ?? []);
  const pemain: PemainPublik[] = s.anggota.map((a) => {
    const main = idMain.has(a.id);
    const hidup = !g || !main ? true : !!g.hidup[a.id];
    const buka = !!g && main && (!hidup || g.fase === 'selesai');
    return { id: a.id, nama: a.nama, hidup, peran: buka ? g!.peran[a.id] : null, main };
  });
  // Pemain game yang sudah tidak ada di daftar anggota tetap ditampilkan.
  if (g) for (const p of g.pemain) if (!pemain.some((x) => x.id === p.id)) {
    const hidup = !!g.hidup[p.id];
    pemain.push({ id: p.id, nama: p.nama, hidup, peran: !hidup || g.fase === 'selesai' ? g.peran[p.id] : null, main: true });
  }
  return {
    kode: s.kode,
    hostId: s.hostId,
    versi: s.versi,
    waktu: sekarang,
    pemain,
    komposisi: komposisiDipakai(s),
    komposisiManual: !!s.komposisiManual,
    durasiDiskusi: s.durasiDiskusi,
    game: g && {
      idMain: g.idMain,
      fase: g.fase,
      ronde: g.ronde,
      jumlahSiap: Object.keys(g.siap).length,
      korbanMalam: g.korbanMalam,
      sudahVote: g.fase === 'voting' ? Object.keys(g.suara) : [],
      suaraTerbuka: g.fase === 'voting' ? null : g.suara,
      hasilVoting: g.hasilVoting,
      pemenang: g.pemenang,
      diskusiSampai: g.diskusiSampai,
      log: g.log,
    },
  };
}

export function viewPribadi(s: StateHost, id: string, galat: string | null = null): ViewPribadi {
  const g = s.game;
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
    riwayatLihat: peran === 'peramal' ? g!.riwayatLihat : [],
    lindungiSebelum: peran === 'dokter' ? g!.lindungiSebelum : null,
    suaraku: ikut && g!.fase === 'voting' ? (g!.suara[id] ?? null) : null,
    chatWW: ww ? s.chatWW : [],
    galat,
  };
}

/* ------------------------------ Aksi pemain ------------------------------ */

export type AksiPemain =
  | { jenis: 'halo' }
  | { jenis: 'siap' }
  | { jenis: 'malam'; target: string }
  | { jenis: 'suara'; target: string }
  | { jenis: 'chat'; teks: string };

export type AksiHost =
  | { jenis: 'komposisi'; komposisi: Komposisi | null }
  | { jenis: 'durasi'; detik: number }
  | { jenis: 'mulai' }
  | { jenis: 'paksa_malam' }
  | { jenis: 'akhiri_malam' }
  | { jenis: 'diskusi' }
  | { jenis: 'voting' }
  | { jenis: 'tutup_voting' }
  | { jenis: 'malam_berikut' }
  | { jenis: 'main_lagi' };

export function aksiSah(x: unknown): AksiPemain | null {
  if (!x || typeof x !== 'object') return null;
  const a = x as Record<string, unknown>;
  if (a.jenis === 'halo' || a.jenis === 'siap') return { jenis: a.jenis };
  if ((a.jenis === 'malam' || a.jenis === 'suara') && typeof a.target === 'string' && a.target.length <= 64) return { jenis: a.jenis, target: a.target };
  if (a.jenis === 'chat' && typeof a.teks === 'string') {
    const teks = a.teks.trim().slice(0, 200);
    return teks ? { jenis: 'chat', teks } : null;
  }
  return null;
}

export interface HasilProses {
  state: StateHost;
  /** Galat untuk pengirim saja. */
  galat: string | null;
  berubah: boolean;
}

const naik = (s: StateHost, game: StateGame | null, extra: Partial<StateHost> = {}): StateHost => ({ ...s, ...extra, game, versi: s.versi + 1 });

/** Proses aksi dari pemain id (setelah host yakin id berasal dari kanal pemain itu). */
export function prosesAksiPemain(s: StateHost, id: string, a: AksiPemain, rng: Rng = Math.random, sekarang = Date.now()): HasilProses {
  const g = s.game;
  const tetap = (galat: string | null = null): HasilProses => ({ state: s, galat, berubah: false });
  if (a.jenis === 'halo') return tetap();
  if (!g || !(id in g.peran)) return tetap('Kamu tidak ikut permainan ini.');
  if (a.jenis === 'siap') {
    if (g.fase !== 'peran' || g.siap[id]) return tetap();
    return { state: naik(s, tandaiSiap(g, id)), galat: null, berubah: true };
  }
  if (a.jenis === 'malam') {
    const h = aksiMalam(g, id, a.target);
    if (!h.ok) return tetap(h.galat);
    let game = h.state;
    if (malamLengkap(game)) game = selesaikanMalam(game, rng);
    return { state: naik(s, game), galat: null, berubah: true };
  }
  if (a.jenis === 'suara') {
    const h = beriSuara(g, id, a.target === LEWATI ? LEWATI : a.target);
    if (!h.ok) return tetap(h.galat);
    let game = h.state;
    if (votingLengkap(game)) game = selesaikanVoting(game);
    return { state: naik(s, game), galat: null, berubah: true };
  }
  if (a.jenis === 'chat') {
    if (g.peran[id] !== 'werewolf' || !g.hidup[id]) return tetap('Chat ini khusus werewolf yang masih hidup.');
    const chatWW = [...s.chatWW, { dari: id, teks: a.teks, waktu: sekarang }].slice(-50);
    return { state: naik(s, g, { chatWW }), galat: null, berubah: true };
  }
  return tetap();
}

export function prosesAksiHost(s: StateHost, a: AksiHost, rng: Rng = Math.random, sekarang = Date.now()): HasilProses {
  const g = s.game;
  const tetap = (galat: string | null = null): HasilProses => ({ state: s, galat, berubah: false });
  const ganti = (game: StateGame | null, extra: Partial<StateHost> = {}): HasilProses => ({ state: naik(s, game, extra), galat: null, berubah: true });
  switch (a.jenis) {
    case 'komposisi':
      if (g && g.fase !== 'selesai') return tetap('Permainan sedang berjalan.');
      return ganti(g, { komposisiManual: a.komposisi });
    case 'durasi':
      return ganti(g ? { ...g, durasiDiskusi: Math.max(0, Math.min(600, Math.round(a.detik))) } : g, { durasiDiskusi: Math.max(0, Math.min(600, Math.round(a.detik))) });
    case 'mulai':
    case 'main_lagi': {
      if (g && g.fase !== 'selesai') return tetap('Permainan sedang berjalan.');
      const k = komposisiDipakai(s);
      const galat = cekKomposisi(s.anggota.length, k);
      if (galat) return tetap(galat);
      return ganti(mulaiGame(s.anggota, k, { durasiDiskusi: s.durasiDiskusi, rng }), { chatWW: [] });
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

/** Tambah anggota baru dari daftar server (urutan gabung). Anggota yang keluar dihapus bila tidak sedang main. */
export function sinkronAnggota(s: StateHost, daftar: AnggotaRoom[]): StateHost {
  const g = s.game;
  const main = new Set(g && g.fase !== 'selesai' ? g.pemain.map((p) => p.id) : []);
  const ada = new Set(daftar.map((d) => d.id));
  const anggota = [
    ...s.anggota.filter((a) => a.id === s.hostId || ada.has(a.id) || main.has(a.id)),
    ...daftar.filter((d) => !s.anggota.some((a) => a.id === d.id)),
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
