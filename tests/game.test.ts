import { describe, expect, it } from 'vitest';
import {
  LEWATI,
  aksiMalam,
  bagiPeran,
  beriSuara,
  cekKomposisi,
  cekPemenang,
  hitungSuara,
  komposisiOtomatis,
  korbanPilihan,
  lanjutMalam,
  malamLengkap,
  mulaiDiskusi,
  mulaiGame,
  mulaiVoting,
  selesaikanMalam,
  selesaikanVoting,
  tandaiSiap,
  votingLengkap,
  type Peran,
  type StateGame,
} from '@/lib/game';

/** RNG deterministik (mulberry32). */
function rng(seed = 1) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pemain = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, nama: `Pemain${i}` }));

/** Game dengan peran yang ditentukan, langsung di malam 1. */
function gameDengan(peran: Peran[]): StateGame {
  const p = pemain(peran.length);
  let g = mulaiGame(p, komposisiOtomatis(Math.max(4, peran.length)), { rng: rng(), idMain: 'x' });
  g = { ...g, peran: Object.fromEntries(p.map((x, i) => [x.id, peran[i]])) };
  for (const x of p) g = tandaiSiap(g, x.id);
  return g;
}

describe('komposisi dan pembagian peran', () => {
  it('komposisi otomatis sesuai jumlah pemain', () => {
    expect(komposisiOtomatis(4)).toEqual({ werewolf: 1, peramal: 1, dokter: 0 });
    expect(komposisiOtomatis(5)).toEqual({ werewolf: 1, peramal: 1, dokter: 1 });
    expect(komposisiOtomatis(6).werewolf).toBe(2);
    expect(komposisiOtomatis(9).werewolf).toBe(3);
    expect(komposisiOtomatis(12).werewolf).toBe(4);
    for (let n = 4; n <= 16; n++) expect(cekKomposisi(n, komposisiOtomatis(n))).toBeNull();
  });

  it('menolak komposisi tidak sah', () => {
    expect(cekKomposisi(3, { werewolf: 1, peramal: 0, dokter: 0 })).toMatch(/Minimal 4/);
    expect(cekKomposisi(6, { werewolf: 3, peramal: 1, dokter: 1 })).toMatch(/separuh/);
    expect(cekKomposisi(6, { werewolf: 0, peramal: 1, dokter: 1 })).toMatch(/Minimal 1 werewolf/);
    expect(cekKomposisi(6, { werewolf: 1, peramal: 2, dokter: 1 })).toMatch(/0 atau 1/);
  });

  it('jumlah tiap peran tepat dan semua pemain dapat peran', () => {
    const ids = pemain(10).map((p) => p.id);
    for (let s = 1; s <= 20; s++) {
      const peran = bagiPeran(ids, { werewolf: 3, peramal: 1, dokter: 1 }, rng(s));
      const v = Object.values(peran);
      expect(v).toHaveLength(10);
      expect(v.filter((p) => p === 'werewolf')).toHaveLength(3);
      expect(v.filter((p) => p === 'peramal')).toHaveLength(1);
      expect(v.filter((p) => p === 'dokter')).toHaveLength(1);
      expect(v.filter((p) => p === 'warga')).toHaveLength(5);
    }
  });

  it('pembagian peran acak (tidak selalu sama)', () => {
    const ids = pemain(8).map((p) => p.id);
    const hasil = new Set<string>();
    for (let s = 1; s <= 10; s++) hasil.add(JSON.stringify(bagiPeran(ids, komposisiOtomatis(8), rng(s))));
    expect(hasil.size).toBeGreaterThan(1);
  });

  it('malam pertama dimulai setelah semua siap', () => {
    let g = mulaiGame(pemain(5), komposisiOtomatis(5), { rng: rng() });
    expect(g.fase).toBe('peran');
    for (const p of g.pemain.slice(0, 4)) g = tandaiSiap(g, p.id);
    expect(g.fase).toBe('peran');
    g = tandaiSiap(g, 'p4');
    expect(g.fase).toBe('malam');
    expect(g.ronde).toBe(1);
  });
});

describe('resolusi malam', () => {
  // p0 werewolf, p1 peramal, p2 dokter, p3..p4 warga
  const dasar = () => gameDengan(['werewolf', 'peramal', 'dokter', 'warga', 'warga']);

  it('korban tewas bila tidak dilindungi', () => {
    let g = dasar();
    g = (aksiMalam(g, 'p0', 'p3') as { state: StateGame }).state;
    g = (aksiMalam(g, 'p1', 'p0') as { state: StateGame }).state;
    g = (aksiMalam(g, 'p2', 'p4') as { state: StateGame }).state;
    expect(malamLengkap(g)).toBe(true);
    g = selesaikanMalam(g);
    expect(g.fase).toBe('pagi');
    expect(g.korbanMalam).toBe('p3');
    expect(g.hidup.p3).toBe(false);
  });

  it('dokter menyelamatkan korban', () => {
    let g = dasar();
    g = (aksiMalam(g, 'p0', 'p3') as { state: StateGame }).state;
    g = (aksiMalam(g, 'p2', 'p3') as { state: StateGame }).state;
    g = selesaikanMalam(g);
    expect(g.korbanMalam).toBeNull();
    expect(g.hidup.p3).toBe(true);
    expect(g.lindungiSebelum).toBe('p3');
  });

  it('dokter tidak boleh melindungi orang yang sama dua malam berturut-turut', () => {
    let g = dasar();
    g = (aksiMalam(g, 'p2', 'p3') as { state: StateGame }).state;
    g = selesaikanMalam(g);
    g = lanjutMalam(selesaikanVoting(mulaiVoting(mulaiDiskusi(g))));
    expect(g.fase).toBe('malam');
    const h = aksiMalam(g, 'p2', 'p3');
    expect(h.ok).toBe(false);
    expect(aksiMalam(g, 'p2', 'p2').ok).toBe(true);
  });

  it('peramal mendapat hasil yang benar dan hanya sekali per malam', () => {
    let g = dasar();
    const h = aksiMalam(g, 'p1', 'p0');
    expect(h.ok).toBe(true);
    g = (h as { state: StateGame }).state;
    expect(g.riwayatLihat).toEqual([{ ronde: 1, target: 'p0', werewolf: true }]);
    expect(aksiMalam(g, 'p1', 'p3').ok).toBe(false);
  });

  it('werewolf tidak bisa menyerang sesama werewolf; warga tidak punya aksi', () => {
    const g = gameDengan(['werewolf', 'werewolf', 'warga', 'warga', 'warga', 'warga']);
    expect(aksiMalam(g, 'p0', 'p1').ok).toBe(false);
    expect(aksiMalam(g, 'p2', 'p3').ok).toBe(false);
  });

  it('malam belum lengkap bila werewolf belum sepakat', () => {
    let g = gameDengan(['werewolf', 'werewolf', 'warga', 'warga', 'warga', 'warga']);
    g = (aksiMalam(g, 'p0', 'p2') as { state: StateGame }).state;
    g = (aksiMalam(g, 'p1', 'p3') as { state: StateGame }).state;
    expect(malamLengkap(g)).toBe(false);
    g = (aksiMalam(g, 'p1', 'p2') as { state: StateGame }).state;
    expect(malamLengkap(g)).toBe(true);
  });

  it('korban pilihan: suara terbanyak, seri diundi di antara yang seri', () => {
    expect(korbanPilihan({ a: 'x', b: 'x', c: 'y' })).toBe('x');
    expect(korbanPilihan({})).toBeNull();
    const hasil = new Set<string | null>();
    for (let s = 1; s <= 30; s++) hasil.add(korbanPilihan({ a: 'x', b: 'y' }, rng(s)));
    expect([...hasil].sort()).toEqual(['x', 'y']);
  });

  it('host mengakhiri malam tanpa pilihan: tidak ada korban', () => {
    const g = selesaikanMalam(dasar());
    expect(g.korbanMalam).toBeNull();
    expect(g.fase).toBe('pagi');
  });
});

describe('voting', () => {
  const hidup = ['a', 'b', 'c', 'd', 'e'];

  it('suara terbanyak tunggal tereliminasi', () => {
    const h = hitungSuara({ a: 'b', c: 'b', d: 'a', e: LEWATI }, hidup);
    expect(h.tereliminasi).toBe('b');
    expect(h.lewati).toBe(1);
    expect(h.seri).toBe(false);
  });

  it('seri di posisi teratas: tidak ada yang tereliminasi', () => {
    const h = hitungSuara({ a: 'b', b: 'a', c: 'b', d: 'a' }, hidup);
    expect(h.tereliminasi).toBeNull();
    expect(h.seri).toBe(true);
  });

  it('lewati sama atau lebih banyak dari suara teratas: tidak ada yang tereliminasi', () => {
    expect(hitungSuara({ a: 'b', c: 'b', d: LEWATI, e: LEWATI }, hidup).tereliminasi).toBeNull();
    expect(hitungSuara({ a: LEWATI, b: LEWATI }, hidup).tereliminasi).toBeNull();
    expect(hitungSuara({}, hidup).tereliminasi).toBeNull();
  });

  it('suara dari atau untuk pemain tewas diabaikan', () => {
    const h = hitungSuara({ a: 'b', x: 'c', c: 'x' }, hidup);
    expect(h.hitung).toEqual({ b: 1 });
    expect(h.tereliminasi).toBe('b');
  });

  it('validasi suara dan alur voting penuh', () => {
    let g = gameDengan(['werewolf', 'warga', 'warga', 'warga', 'warga', 'peramal']);
    g = selesaikanMalam(g);
    g = mulaiVoting(mulaiDiskusi(g));
    expect(beriSuara(g, 'p1', 'p1').ok).toBe(false);
    expect(beriSuara(g, 'p1', 'zzz').ok).toBe(false);
    for (const id of ['p1', 'p2', 'p3', 'p4', 'p5']) g = (beriSuara(g, id, 'p0') as { state: StateGame }).state;
    expect(votingLengkap(g)).toBe(false);
    g = (beriSuara(g, 'p0', LEWATI) as { state: StateGame }).state;
    expect(votingLengkap(g)).toBe(true);
    g = selesaikanVoting(g);
    expect(g.hidup.p0).toBe(false);
    expect(g.fase).toBe('selesai');
    expect(g.pemenang).toBe('warga');
  });

  it('diskusi dengan timer mengisi batas waktu', () => {
    let g = gameDengan(['werewolf', 'warga', 'warga', 'warga']);
    g = { ...selesaikanMalam(g), durasiDiskusi: 90 };
    g = mulaiDiskusi(g, 1000);
    expect(g.fase).toBe('diskusi');
    expect(g.diskusiSampai).toBe(91000);
  });
});

describe('kondisi menang', () => {
  it('warga menang bila semua werewolf tewas', () => {
    expect(cekPemenang({ a: 'werewolf', b: 'warga', c: 'warga' }, { a: false, b: true, c: true })).toBe('warga');
  });

  it('werewolf menang bila jumlahnya sama dengan sisa pemain', () => {
    expect(cekPemenang({ a: 'werewolf', b: 'warga', c: 'dokter' }, { a: true, b: true, c: false })).toBe('werewolf');
    expect(cekPemenang({ a: 'werewolf', b: 'werewolf', c: 'warga', d: 'peramal' }, { a: true, b: true, c: true, d: false })).toBe('werewolf');
  });

  it('permainan berlanjut bila belum ada pemenang', () => {
    expect(cekPemenang({ a: 'werewolf', b: 'warga', c: 'warga' }, { a: true, b: true, c: true })).toBeNull();
  });

  it('kemenangan werewolf terdeteksi setelah serangan malam', () => {
    let g = gameDengan(['werewolf', 'warga', 'warga', 'warga']);
    g = { ...g, hidup: { ...g.hidup, p3: false } };
    g = (aksiMalam(g, 'p0', 'p1') as { state: StateGame }).state;
    g = selesaikanMalam(g);
    expect(g.fase).toBe('selesai');
    expect(g.pemenang).toBe('werewolf');
  });
});
