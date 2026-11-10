// Logika murni peringkat musiman (bulan Asia/Jakarta). Tidak menyentuh jaringan/DOM.
// Dipakai server (RPC) lewat salinan SQL dan klien untuk tes/UI.

export const KATEGORI_MUSIM = [
  'keseluruhan',
  'werewolf',
  'warga',
  'peramal',
  'dokter',
  'winrate',
  'main',
] as const;
export type KategoriMusim = (typeof KATEGORI_MUSIM)[number];

export const META_KATEGORI: Record<KategoriMusim, { nama: string; ikon: string; warna: string; labelSingkat: string }> = {
  keseluruhan: { nama: 'Keseluruhan', ikon: '👑', warna: 'emas', labelSingkat: 'Keseluruhan' },
  werewolf: { nama: 'Best Werewolf', ikon: '🐺', warna: 'merah', labelSingkat: 'Werewolf' },
  warga: { nama: 'Best Warga', ikon: '🛡️', warna: 'biru', labelSingkat: 'Warga' },
  peramal: { nama: 'Best Peramal', ikon: '🔮', warna: 'ungu', labelSingkat: 'Peramal' },
  dokter: { nama: 'Best Dokter', ikon: '💉', warna: 'tosca', labelSingkat: 'Dokter' },
  winrate: { nama: 'Winrate tertinggi', ikon: '🎯', warna: 'hijau', labelSingkat: 'Winrate' },
  main: { nama: 'Match terbanyak', ikon: '🔥', warna: 'oranye', labelSingkat: 'Match' },
};

/**
 * Prioritas default gelar/frame: peringkat terkecil dulu;
 * seri -> Keseluruhan, Winrate, lalu peran (Warga, Werewolf, Peramal, Dokter), lalu Match.
 * Urutan sama dengan undercover (Civilian, Undercover, Mr. White, Lovers dipetakan ke Warga, Werewolf, Peramal, Dokter).
 */
export const URUT_KATEGORI_DEFAULT: KategoriMusim[] = [
  'keseluruhan', 'winrate', 'warga', 'werewolf', 'peramal', 'dokter', 'main',
];

export const MIN_MAIN_WINRATE_MUSIM = 10;
export const MIN_MAIN_PERAN_MUSIM = 5;

export type PeranMusim = 'werewolf' | 'warga' | 'peramal' | 'dokter';
export const PERAN_MUSIM: readonly PeranMusim[] = ['werewolf', 'warga', 'peramal', 'dokter'];

export interface BarisMain {
  userId: string;
  peran: PeranMusim;
  menang: boolean;
  waktu: Date | string | number;
}

export interface AgregatPemain {
  userId: string;
  main: number;
  menang: number;
  peran: Record<PeranMusim, { main: number; menang: number }>;
}

export interface SlotPeringkat {
  userId: string;
  peringkat: 1 | 2 | 3;
  kategori: KategoriMusim;
  main: number;
  menang: number;
  /** winrate 0..1 atau null bila kategori bukan winrate. */
  winrate: number | null;
  metrik: number;
}

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Awal bulan kalender Asia/Jakarta untuk waktu `t` (UTC ms). */
export function awalBulanWib(t: number = Date.now()): Date {
  const w = new Date(t + WIB_OFFSET_MS);
  const y = w.getUTCFullYear();
  const m = w.getUTCMonth();
  return new Date(Date.UTC(y, m, 1) - WIB_OFFSET_MS);
}

/** Awal bulan berikutnya (batas eksklusif) Asia/Jakarta. */
export function awalBulanBerikutnyaWib(t: number = Date.now()): Date {
  const w = new Date(t + WIB_OFFSET_MS);
  const y = w.getUTCFullYear();
  const m = w.getUTCMonth();
  return new Date(Date.UTC(y, m + 1, 1) - WIB_OFFSET_MS);
}

/** Kode musim 'YYYY-MM' dalam zona Asia/Jakarta. */
export function kodeMusim(t: number = Date.now()): string {
  const w = new Date(t + WIB_OFFSET_MS);
  const y = w.getUTCFullYear();
  const m = w.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** Label singkat bulan, mis. 'Nov 2026'. */
export function labelMusim(kode: string): string {
  const [ys, ms] = kode.split('-');
  const y = Number(ys);
  const m = Number(ms);
  if (!y || !m || m < 1 || m > 12) return kode;
  const nama = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'][m - 1];
  return `${nama} ${y}`;
}

/** Musim sebelumnya dari kode 'YYYY-MM'. */
export function musimSebelumnya(kode: string): string {
  const [ys, ms] = kode.split('-').map(Number);
  if (!ys || !ms) return kode;
  if (ms === 1) return `${ys - 1}-12`;
  return `${ys}-${String(ms - 1).padStart(2, '0')}`;
}

export function dalamMusim(waktu: Date | string | number, musim: string): boolean {
  const t = typeof waktu === 'number' ? waktu : new Date(waktu).getTime();
  const [ys, ms] = musim.split('-').map(Number);
  const awal = new Date(Date.UTC(ys, ms - 1, 1) - WIB_OFFSET_MS).getTime();
  const akhir = new Date(Date.UTC(ys, ms, 1) - WIB_OFFSET_MS).getTime();
  return t >= awal && t < akhir;
}

export function agregatMusim(baris: readonly BarisMain[], musim: string): AgregatPemain[] {
  const map = new Map<string, AgregatPemain>();
  for (const b of baris) {
    if (!dalamMusim(b.waktu, musim)) continue;
    let a = map.get(b.userId);
    if (!a) {
      a = {
        userId: b.userId,
        main: 0,
        menang: 0,
        peran: {
          werewolf: { main: 0, menang: 0 },
          warga: { main: 0, menang: 0 },
          peramal: { main: 0, menang: 0 },
          dokter: { main: 0, menang: 0 },
        },
      };
      map.set(b.userId, a);
    }
    a.main += 1;
    if (b.menang) a.menang += 1;
    a.peran[b.peran].main += 1;
    if (b.menang) a.peran[b.peran].menang += 1;
  }
  return [...map.values()];
}

function bandingUsername(a: string, b: string): number {
  return a.localeCompare(b, 'en');
}

/**
 * Top 3 satu kategori. Definisi:
 * - keseluruhan: menang terbanyak; seri -> main lebih sedikit; lalu userId.
 * - werewolf/warga/peramal/dokter: menang peran itu (min 5 main); seri -> winrate peran; lalu main lebih sedikit; lalu userId.
 * - winrate: winrate keseluruhan (min 10 main); seri -> menang lebih banyak; lalu main lebih banyak; lalu userId.
 * - main: main terbanyak; seri -> menang lebih banyak; lalu userId.
 */
export function top3Kategori(agregat: readonly AgregatPemain[], kategori: KategoriMusim): SlotPeringkat[] {
  type Calon = { a: AgregatPemain; metrik: number; main: number; menang: number; winrate: number | null; kunci: number[] };
  const calon: Calon[] = [];
  for (const a of agregat) {
    if (kategori === 'keseluruhan') {
      if (a.menang <= 0) continue;
      calon.push({ a, metrik: a.menang, main: a.main, menang: a.menang, winrate: a.main ? a.menang / a.main : null, kunci: [a.menang, -a.main] });
    } else if ((PERAN_MUSIM as readonly string[]).includes(kategori)) {
      const p = a.peran[kategori as PeranMusim];
      if (p.main < MIN_MAIN_PERAN_MUSIM || p.menang <= 0) continue;
      const wr = p.menang / p.main;
      calon.push({ a, metrik: p.menang, main: p.main, menang: p.menang, winrate: wr, kunci: [p.menang, wr, -p.main] });
    } else if (kategori === 'winrate') {
      if (a.main < MIN_MAIN_WINRATE_MUSIM) continue;
      const wr = a.menang / a.main;
      calon.push({ a, metrik: wr, main: a.main, menang: a.menang, winrate: wr, kunci: [wr, a.menang, a.main] });
    } else {
      if (a.main <= 0) continue;
      calon.push({ a, metrik: a.main, main: a.main, menang: a.menang, winrate: a.main ? a.menang / a.main : null, kunci: [a.main, a.menang] });
    }
  }
  calon.sort((x, y) => {
    for (let i = 0; i < Math.max(x.kunci.length, y.kunci.length); i++) {
      const d = (y.kunci[i] ?? 0) - (x.kunci[i] ?? 0);
      if (d !== 0) return d;
    }
    return bandingUsername(x.a.userId, y.a.userId);
  });
  return calon.slice(0, 3).map((c, i) => ({
    userId: c.a.userId,
    peringkat: (i + 1) as 1 | 2 | 3,
    kategori,
    main: c.main,
    menang: c.menang,
    winrate: c.winrate,
    metrik: c.metrik,
  }));
}

export function top3Semua(agregat: readonly AgregatPemain[]): SlotPeringkat[] {
  return KATEGORI_MUSIM.flatMap((k) => top3Kategori(agregat, k));
}

export interface GelarDipasang {
  sumber: 'musim' | 'award';
  kategori: KategoriMusim;
  peringkat: 1 | 2 | 3;
  musim: string;
}

/** Pilih gelar default: peringkat terkecil, seri kategori mengikuti URUT_KATEGORI_DEFAULT. */
export function pilihGelarDefault(slot: readonly SlotPeringkat[], musim: string): GelarDipasang | null {
  if (slot.length === 0) return null;
  const urut = [...slot].sort((a, b) => {
    if (a.peringkat !== b.peringkat) return a.peringkat - b.peringkat;
    return URUT_KATEGORI_DEFAULT.indexOf(a.kategori) - URUT_KATEGORI_DEFAULT.indexOf(b.kategori);
  });
  const s = urut[0];
  return { sumber: 'musim', kategori: s.kategori, peringkat: s.peringkat, musim };
}

export function teksGelar(g: { kategori: KategoriMusim; peringkat: 1 | 2 | 3; musim: string; sumber?: 'musim' | 'award' }): string {
  const meta = META_KATEGORI[g.kategori];
  const bulan = labelMusim(g.musim);
  if (g.sumber === 'award' || g.musim !== kodeMusim()) {
    if (g.peringkat === 1) return `Juara 1 ${meta.labelSingkat} ${bulan}`;
    return `#${g.peringkat} ${meta.labelSingkat} ${bulan}`;
  }
  if (g.peringkat === 1) return `Juara 1 ${meta.labelSingkat}`;
  return `#${g.peringkat} ${meta.labelSingkat}`;
}

/** Keterangan tap: '#2 Best Peramal · 64% menang dari 25 game'. */
export function keteranganSlot(s: SlotPeringkat): string {
  const meta = META_KATEGORI[s.kategori];
  const wr = s.winrate != null ? Math.round(s.winrate * 100) : s.main > 0 ? Math.round((s.menang / s.main) * 100) : 0;
  if (s.kategori === 'main') {
    return `#${s.peringkat} ${meta.nama} · ${s.main} game (${s.menang} menang)`;
  }
  if (s.kategori === 'winrate') {
    return `#${s.peringkat} ${meta.nama} · ${wr}% menang dari ${s.main} game`;
  }
  if (s.kategori === 'keseluruhan') {
    return `#${s.peringkat} ${meta.nama} · ${s.menang} menang dari ${s.main} game`;
  }
  return `#${s.peringkat} ${meta.nama} · ${wr}% menang dari ${s.main} game`;
}

/** Apakah frame/efek visual boleh dipakai: hanya musim berjalan. */
export function bolehFrame(musim: string, sekarang: number = Date.now()): boolean {
  return musim === kodeMusim(sekarang);
}

export function idSlot(s: Pick<SlotPeringkat, 'kategori' | 'peringkat'>): string {
  return `${s.kategori}:${s.peringkat}`;
}

/** Deteksi masuk top 3 baru dibanding snapshot lokal sebelumnya. */
export function slotBaruMasuk(sekarang: readonly SlotPeringkat[], sebelumnya: readonly { kategori: KategoriMusim; peringkat: 1 | 2 | 3 }[]): SlotPeringkat[] {
  const lama = new Set(sebelumnya.map((s) => `${s.kategori}:${s.peringkat}`));
  return sekarang.filter((s) => !lama.has(idSlot(s)));
}

export function pesanMasukTop3(s: SlotPeringkat): string {
  return `Selamat, kamu masuk Top 3 ${META_KATEGORI[s.kategori].labelSingkat}!`;
}
