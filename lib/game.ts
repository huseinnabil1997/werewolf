// Logika inti Werewolf (murni, tanpa React/jaringan) dipakai mode Lokal dan Online.
// Semua fungsi mengembalikan state baru; state lama tidak diubah.

export type Peran = 'werewolf' | 'warga' | 'peramal' | 'dokter';
export type Tim = 'werewolf' | 'warga';
export type Fase = 'peran' | 'malam' | 'pagi' | 'diskusi' | 'voting' | 'hasil_voting' | 'selesai';
export type Rng = () => number;

export const MIN_PEMAIN = 4;
export const MAKS_PEMAIN = 20;
export const LEWATI = 'lewati';

export const NAMA_PERAN: Record<Peran, string> = {
  werewolf: 'Werewolf',
  warga: 'Warga',
  peramal: 'Peramal',
  dokter: 'Dokter',
};

export const DESKRIPSI_PERAN: Record<Peran, string> = {
  werewolf: 'Tiap malam, sepakati satu korban bersama werewolf lain. Menang jika jumlah werewolf menyamai sisa warga.',
  warga: 'Tidak punya kekuatan malam. Diskusikan dan voting untuk menemukan werewolf.',
  peramal: 'Tiap malam, lihat satu pemain: werewolf atau bukan.',
  dokter: 'Tiap malam, lindungi satu pemain dari serangan. Tidak boleh orang yang sama dua malam berturut-turut.',
};

export interface Pemain {
  id: string;
  nama: string;
}

export interface Komposisi {
  werewolf: number;
  peramal: number;
  dokter: number;
}

export interface HasilLihat {
  ronde: number;
  target: string;
  werewolf: boolean;
}

export interface StateMalam {
  /** id werewolf -> id target pilihannya. */
  pilihanWW: Record<string, string>;
  lihat: string | null;
  lindungi: string | null;
  /** Pemain dengan aksi malam yang sudah selesai (werewolf, peramal, dokter). */
  selesai: Record<string, boolean>;
}

export interface HasilVoting {
  hitung: Record<string, number>;
  lewati: number;
  tereliminasi: string | null;
  seri: boolean;
  /** Pemain yang seri di posisi teratas (atau seri dengan Lewati). */
  kandidatSeri: string[];
  keputusan: 'eliminasi' | 'voteUlang' | 'tanpaEliminasi';
  putaran: 1 | 2;
}

export interface StateGame {
  idMain: string;
  pemain: Pemain[];
  peran: Record<string, Peran>;
  hidup: Record<string, boolean>;
  fase: Fase;
  ronde: number;
  siap: Record<string, boolean>;
  malam: StateMalam;
  /** Pemain yang dilindungi dokter malam sebelumnya. */
  lindungiSebelum: string | null;
  riwayatLihat: HasilLihat[];
  /** Korban malam terakhir (null = tidak ada yang tewas). */
  korbanMalam: string | null;
  suara: Record<string, string>;
  /** Putaran voting: 2 = vote ulang sekali, hanya antara pemain yang seri. */
  putaranVote: 1 | 2;
  /** Kandidat yang boleh dipilih di vote ulang (kosong di putaran 1 = semua pemain hidup). */
  kandidat: string[];
  hasilVoting: HasilVoting | null;
  pemenang: Tim | null;
  durasiDiskusi: number;
  diskusiSampai: number | null;
  log: string[];
}

export function komposisiOtomatis(n: number): Komposisi {
  const werewolf = n <= 5 ? 1 : n <= 8 ? 2 : n <= 11 ? 3 : 4;
  return { werewolf, peramal: n >= 4 ? 1 : 0, dokter: n >= 5 ? 1 : 0 };
}

/** Pesan galat komposisi, atau null jika valid. */
export function cekKomposisi(n: number, k: Komposisi): string | null {
  if (n < MIN_PEMAIN) return `Minimal ${MIN_PEMAIN} pemain.`;
  if (n > MAKS_PEMAIN) return `Maksimal ${MAKS_PEMAIN} pemain.`;
  if (!Number.isInteger(k.werewolf) || k.werewolf < 1) return 'Minimal 1 werewolf.';
  if (k.peramal < 0 || k.peramal > 1 || k.dokter < 0 || k.dokter > 1) return 'Peramal dan Dokter masing-masing 0 atau 1.';
  if (k.werewolf * 2 >= n) return 'Werewolf harus lebih sedikit dari separuh pemain.';
  if (k.werewolf + k.peramal + k.dokter > n) return 'Peran khusus lebih banyak dari jumlah pemain.';
  return null;
}

export function acak<T>(arr: readonly T[], rng: Rng = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function bagiPeran(ids: readonly string[], k: Komposisi, rng: Rng = Math.random): Record<string, Peran> {
  const galat = cekKomposisi(ids.length, k);
  if (galat) throw new Error(galat);
  const kartu: Peran[] = [
    ...Array<Peran>(k.werewolf).fill('werewolf'),
    ...Array<Peran>(k.peramal).fill('peramal'),
    ...Array<Peran>(k.dokter).fill('dokter'),
  ];
  while (kartu.length < ids.length) kartu.push('warga');
  const acakKartu = acak(kartu, rng);
  const hasil: Record<string, Peran> = {};
  ids.forEach((id, i) => (hasil[id] = acakKartu[i]));
  return hasil;
}

export function timDari(p: Peran): Tim {
  return p === 'werewolf' ? 'werewolf' : 'warga';
}

export function cekPemenang(peran: Record<string, Peran>, hidup: Record<string, boolean>): Tim | null {
  let ww = 0;
  let lain = 0;
  for (const id of Object.keys(peran)) {
    if (!hidup[id]) continue;
    if (peran[id] === 'werewolf') ww++;
    else lain++;
  }
  if (ww === 0) return 'warga';
  if (ww >= lain) return 'werewolf';
  return null;
}

export function menang(peran: Peran, pemenang: Tim): boolean {
  return timDari(peran) === pemenang;
}

const malamKosong = (): StateMalam => ({ pilihanWW: {}, lihat: null, lindungi: null, selesai: {} });

export function buatId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return '00000000-0000-4000-8000-' + Math.random().toString(16).slice(2, 14).padEnd(12, '0');
}

export function mulaiGame(
  pemain: Pemain[],
  k: Komposisi,
  opsi: { durasiDiskusi?: number; rng?: Rng; idMain?: string } = {},
): StateGame {
  const peran = bagiPeran(pemain.map((p) => p.id), k, opsi.rng);
  const hidup: Record<string, boolean> = {};
  for (const p of pemain) hidup[p.id] = true;
  return {
    idMain: opsi.idMain ?? buatId(),
    pemain: pemain.map((p) => ({ ...p })),
    peran,
    hidup,
    fase: 'peran',
    ronde: 0,
    siap: {},
    malam: malamKosong(),
    lindungiSebelum: null,
    riwayatLihat: [],
    korbanMalam: null,
    suara: {},
    putaranVote: 1,
    kandidat: [],
    hasilVoting: null,
    pemenang: null,
    durasiDiskusi: opsi.durasiDiskusi ?? 0,
    diskusiSampai: null,
    log: [],
  };
}

export const idHidup = (s: StateGame): string[] => s.pemain.filter((p) => s.hidup[p.id]).map((p) => p.id);
export const namaPemain = (s: StateGame, id: string | null | undefined): string =>
  s.pemain.find((p) => p.id === id)?.nama ?? '?';

function keMalam(s: StateGame): StateGame {
  return { ...s, fase: 'malam', ronde: s.ronde + 1, malam: malamKosong(), suara: {}, putaranVote: 1, kandidat: [], hasilVoting: null, diskusiSampai: null };
}

/** Pemain sudah melihat kartunya. Saat semua siap, malam pertama dimulai. */
export function tandaiSiap(s: StateGame, id: string): StateGame {
  if (s.fase !== 'peran' || !(id in s.peran)) return s;
  const siap = { ...s.siap, [id]: true };
  const n = { ...s, siap };
  return s.pemain.filter((p) => s.hidup[p.id]).every((p) => siap[p.id]) ? keMalam(n) : n;
}

/** Batalkan Siap selama malam pertama belum dimulai. */
export function batalSiap(s: StateGame, id: string): StateGame {
  if (s.fase !== 'peran' || !s.siap[id]) return s;
  const siap = { ...s.siap };
  delete siap[id];
  return { ...s, siap };
}

/** Paksa mulai malam (host), meski belum semua menekan siap. */
export function paksaMalam(s: StateGame): StateGame {
  return s.fase === 'peran' ? keMalam(s) : s;
}

/** Pemain yang wajib beraksi malam ini (werewolf, peramal, dokter yang masih hidup). */
export function pelakuMalam(s: StateGame): string[] {
  return idHidup(s).filter((id) => s.peran[id] !== 'warga');
}

export type HasilAksi = { ok: true; state: StateGame } | { ok: false; galat: string };

/** Target yang sah untuk aksi malam pemain id. */
export function targetSahMalam(s: StateGame, id: string): string[] {
  const p = s.peran[id];
  const hidup = idHidup(s);
  if (p === 'werewolf') return hidup.filter((t) => s.peran[t] !== 'werewolf');
  if (p === 'peramal') return hidup.filter((t) => t !== id);
  if (p === 'dokter') return hidup.filter((t) => t !== s.lindungiSebelum);
  return [];
}

export function aksiMalam(s: StateGame, id: string, target: string): HasilAksi {
  if (s.fase !== 'malam') return { ok: false, galat: 'Bukan waktunya aksi malam.' };
  if (!s.hidup[id]) return { ok: false, galat: 'Pemain yang tewas tidak bisa beraksi.' };
  const p = s.peran[id];
  if (p === 'warga') return { ok: false, galat: 'Warga tidak punya aksi malam.' };
  if (!targetSahMalam(s, id).includes(target)) {
    if (p === 'dokter' && target === s.lindungiSebelum) return { ok: false, galat: 'Tidak boleh melindungi orang yang sama dua malam berturut-turut.' };
    return { ok: false, galat: 'Target tidak sah.' };
  }
  const m = s.malam;
  if (p === 'peramal' && m.selesai[id]) return { ok: false, galat: 'Kamu sudah melihat satu pemain malam ini.' };
  const malam: StateMalam = { ...m, pilihanWW: { ...m.pilihanWW }, selesai: { ...m.selesai, [id]: true } };
  let riwayatLihat = s.riwayatLihat;
  if (p === 'werewolf') malam.pilihanWW[id] = target;
  if (p === 'dokter') malam.lindungi = target;
  if (p === 'peramal') {
    malam.lihat = target;
    riwayatLihat = [...s.riwayatLihat, { ronde: s.ronde, target, werewolf: s.peran[target] === 'werewolf' }];
  }
  return { ok: true, state: { ...s, malam, riwayatLihat } };
}

/** Werewolf yang masih hidup sudah sepakat pada satu korban yang sama. */
export function werewolfSepakat(s: StateGame): boolean {
  const pilihan = idHidup(s).filter((id) => s.peran[id] === 'werewolf').map((id) => s.malam.pilihanWW[id]);
  return pilihan.length > 0 && pilihan.every((t) => t && t === pilihan[0]);
}

/** Malam selesai otomatis bila semua pelaku sudah beraksi dan werewolf sepakat satu korban. */
export function malamLengkap(s: StateGame): boolean {
  return s.fase === 'malam' && pelakuMalam(s).every((id) => s.malam.selesai[id]) && werewolfSepakat(s);
}

/** Korban pilihan werewolf: suara terbanyak; seri diundi. null bila belum ada pilihan. */
export function korbanPilihan(pilihan: Record<string, string>, rng: Rng = Math.random): string | null {
  const hitung = new Map<string, number>();
  for (const t of Object.values(pilihan)) hitung.set(t, (hitung.get(t) ?? 0) + 1);
  if (hitung.size === 0) return null;
  const maks = Math.max(...hitung.values());
  const teratas = [...hitung.entries()].filter(([, n]) => n === maks).map(([t]) => t).sort();
  return teratas.length === 1 ? teratas[0] : teratas[Math.floor(rng() * teratas.length)];
}

/** Akhiri malam: korban tewas kecuali dilindungi dokter. Bisa dipanggil host walau belum lengkap. */
export function selesaikanMalam(s: StateGame, rng: Rng = Math.random): StateGame {
  if (s.fase !== 'malam') return s;
  const pilihanHidup: Record<string, string> = {};
  for (const [ww, t] of Object.entries(s.malam.pilihanWW)) if (s.hidup[ww] && s.hidup[t]) pilihanHidup[ww] = t;
  const target = korbanPilihan(pilihanHidup, rng);
  const korban = target && target !== s.malam.lindungi ? target : null;
  const hidup = { ...s.hidup };
  if (korban) hidup[korban] = false;
  const log = [...s.log, korban ? `Malam ${s.ronde}: ${namaPemain(s, korban)} tewas.` : `Malam ${s.ronde}: tidak ada yang tewas.`];
  const pemenang = cekPemenang(s.peran, hidup);
  return {
    ...s,
    hidup,
    korbanMalam: korban,
    lindungiSebelum: s.malam.lindungi,
    fase: pemenang ? 'selesai' : 'pagi',
    pemenang,
    log,
  };
}

export function mulaiDiskusi(s: StateGame, sekarang = Date.now()): StateGame {
  if (s.fase !== 'pagi' && s.fase !== 'hasil_voting') return s;
  return { ...s, fase: 'diskusi', diskusiSampai: s.durasiDiskusi > 0 ? sekarang + s.durasiDiskusi * 1000 : null };
}

export function mulaiVoting(s: StateGame): StateGame {
  if (s.fase !== 'diskusi' && s.fase !== 'pagi') return s;
  return { ...s, fase: 'voting', suara: {}, putaranVote: 1, kandidat: [], hasilVoting: null, diskusiSampai: null };
}

/** Target yang boleh dipilih pemain id di putaran voting ini (tanpa Lewati). */
export function targetSahVoting(s: StateGame, id: string): string[] {
  const calon = s.putaranVote === 2 && s.kandidat.length ? s.kandidat : idHidup(s);
  return calon.filter((t) => t !== id && s.hidup[t]);
}

export function beriSuara(s: StateGame, id: string, target: string): HasilAksi {
  if (s.fase !== 'voting') return { ok: false, galat: 'Voting belum dibuka.' };
  if (!s.hidup[id]) return { ok: false, galat: 'Pemain yang tewas tidak bisa memilih.' };
  if (target !== LEWATI && !targetSahVoting(s, id).includes(target)) {
    return { ok: false, galat: s.putaranVote === 2 ? 'Vote ulang hanya antara pemain yang seri.' : 'Pilihan tidak sah.' };
  }
  return { ok: true, state: { ...s, suara: { ...s.suara, [id]: target } } };
}

export function votingLengkap(s: StateGame): boolean {
  return s.fase === 'voting' && idHidup(s).every((id) => id in s.suara);
}

/**
 * Hitung suara. Satu pemain unggul sendiri DAN suaranya lebih banyak dari Lewati: tereliminasi.
 * Seri di posisi teratas (termasuk seri dengan Lewati): vote ulang sekali hanya antara yang seri; bila di vote
 * ulang masih seri, tidak ada yang tereliminasi. Lewati lebih banyak dari suara teratas: tidak ada yang tereliminasi.
 */
export function hitungSuara(suara: Record<string, string>, hidup: readonly string[], putaran: 1 | 2 = 1): HasilVoting {
  const hitung: Record<string, number> = {};
  let lewati = 0;
  for (const [pemilih, t] of Object.entries(suara)) {
    if (!hidup.includes(pemilih)) continue;
    if (t === LEWATI) lewati++;
    else if (hidup.includes(t)) hitung[t] = (hitung[t] ?? 0) + 1;
  }
  const nilai = Object.values(hitung);
  const maks = nilai.length ? Math.max(...nilai) : 0;
  const teratas = Object.keys(hitung).filter((t) => hitung[t] === maks).sort();
  const unggul = maks > 0 && teratas.length === 1 && maks > lewati;
  const seri = maks > 0 && maks >= lewati && !unggul;
  const keputusan: HasilVoting['keputusan'] = unggul ? 'eliminasi' : seri && putaran === 1 ? 'voteUlang' : 'tanpaEliminasi';
  return { hitung, lewati, tereliminasi: unggul ? teratas[0] : null, seri, kandidatSeri: seri ? teratas : [], keputusan, putaran };
}

export function selesaikanVoting(s: StateGame): StateGame {
  if (s.fase !== 'voting') return s;
  const hasil = hitungSuara(s.suara, idHidup(s), s.putaranVote);
  if (hasil.keputusan === 'voteUlang') {
    return {
      ...s,
      suara: {},
      putaranVote: 2,
      kandidat: hasil.kandidatSeri,
      hasilVoting: hasil,
      log: [...s.log, `Voting hari ${s.ronde}: seri, vote ulang antara ${hasil.kandidatSeri.map((id) => namaPemain(s, id)).join(', ')}.`],
    };
  }
  const hidup = { ...s.hidup };
  if (hasil.tereliminasi) hidup[hasil.tereliminasi] = false;
  const pesan = hasil.tereliminasi
    ? `Voting hari ${s.ronde}: ${namaPemain(s, hasil.tereliminasi)} tereliminasi.`
    : hasil.seri
      ? `Voting hari ${s.ronde}: masih seri, tidak ada yang tereliminasi.`
      : `Voting hari ${s.ronde}: tidak ada yang tereliminasi.`;
  const pemenang = cekPemenang(s.peran, hidup);
  return { ...s, hidup, hasilVoting: hasil, fase: pemenang ? 'selesai' : 'hasil_voting', pemenang, log: [...s.log, pesan] };
}

/**
 * Pemain dikeluarkan host di tengah permainan: dianggap tewas (perannya terbuka), lalu pemenang dicek.
 * Malam atau voting yang menjadi lengkap karenanya langsung diselesaikan.
 */
export function keluarkanPemain(s: StateGame, id: string, rng: Rng = Math.random): StateGame {
  if (!s.hidup[id] || s.fase === 'selesai') return s;
  const hidup = { ...s.hidup, [id]: false };
  const suara = { ...s.suara };
  delete suara[id];
  for (const [k, v] of Object.entries(suara)) if (v === id) delete suara[k];
  const kandidat = s.kandidat.filter((k) => k !== id);
  let n: StateGame = { ...s, hidup, suara, kandidat, log: [...s.log, `${namaPemain(s, id)} dikeluarkan dari permainan.`] };
  const pemenang = cekPemenang(s.peran, hidup);
  if (pemenang) return { ...n, fase: 'selesai', pemenang };
  if (n.fase === 'peran' && n.pemain.filter((p) => n.hidup[p.id]).every((p) => n.siap[p.id])) n = keMalam(n);
  else if (malamLengkap(n)) n = selesaikanMalam(n, rng);
  else if (votingLengkap(n)) n = selesaikanVoting(n);
  return n;
}

export function lanjutMalam(s: StateGame): StateGame {
  return s.fase === 'hasil_voting' ? keMalam(s) : s;
}

/** Werewolf lain (rekan satu tim) untuk pemain id. Kosong bila bukan werewolf. */
export function rekanWerewolf(s: StateGame, id: string): string[] {
  if (s.peran[id] !== 'werewolf') return [];
  return s.pemain.filter((p) => p.id !== id && s.peran[p.id] === 'werewolf').map((p) => p.id);
}
