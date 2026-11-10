import { describe, expect, it } from 'vitest';
import {
  agregatMusim, awalBulanBerikutnyaWib, awalBulanWib, bolehFrame, dalamMusim,
  keteranganSlot, kodeMusim, labelMusim, musimSebelumnya, pesanMasukTop3,
  pilihGelarDefault, slotBaruMasuk, teksGelar, top3Kategori, top3Semua,
  type BarisMain,
} from '../lib/peringkatMusim';

/** 15 Nov 2026 12:00 WIB = 05:00 UTC. */
const TENGAH_NOV = Date.parse('2026-11-15T05:00:00Z');
/** 31 Okt 2026 23:30 WIB = 16:30 UTC. */
const AKHIR_OKT = Date.parse('2026-10-31T16:30:00Z');
/** 1 Nov 2026 00:30 WIB = 2026-10-31 17:30 UTC. */
const AWAL_NOV = Date.parse('2026-10-31T17:30:00Z');

function baris(userId: string, peran: BarisMain['peran'], menang: boolean, t: number): BarisMain {
  return { userId, peran, menang, waktu: t };
}

describe('batas bulan Asia/Jakarta', () => {
  it('kode dan label musim', () => {
    expect(kodeMusim(TENGAH_NOV)).toBe('2026-11');
    expect(labelMusim('2026-11')).toBe('Nov 2026');
    expect(labelMusim('2026-10')).toBe('Okt 2026');
    expect(musimSebelumnya('2026-11')).toBe('2026-10');
    expect(musimSebelumnya('2026-01')).toBe('2025-12');
  });
  it('awal bulan tepat di 00:00 WIB', () => {
    expect(awalBulanWib(TENGAH_NOV).toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(awalBulanBerikutnyaWib(TENGAH_NOV).toISOString()).toBe('2026-11-30T17:00:00.000Z');
  });
  it('batas bulan tidak bocor ke UTC', () => {
    expect(dalamMusim(AKHIR_OKT, '2026-10')).toBe(true);
    expect(dalamMusim(AKHIR_OKT, '2026-11')).toBe(false);
    expect(dalamMusim(AWAL_NOV, '2026-11')).toBe(true);
    expect(dalamMusim(AWAL_NOV, '2026-10')).toBe(false);
  });
  it('frame hanya untuk musim berjalan', () => {
    expect(bolehFrame('2026-11', TENGAH_NOV)).toBe(true);
    expect(bolehFrame('2026-10', TENGAH_NOV)).toBe(false);
  });
});

describe('agregat dan top 3', () => {
  const t = TENGAH_NOV;
  const data: BarisMain[] = [
    // a: 12 main, 8 menang keseluruhan; 6 warga (5 menang); 3 Werewolf (2); 3 Peramal (1)
    ...Array.from({ length: 5 }, () => baris('a', 'warga', true, t)),
    baris('a', 'warga', false, t),
    ...Array.from({ length: 2 }, () => baris('a', 'werewolf', true, t)),
    baris('a', 'werewolf', false, t),
    baris('a', 'peramal', true, t),
    ...Array.from({ length: 2 }, () => baris('a', 'peramal', false, t)),
    // b: 11 main, 9 menang; 5 warga (4); 3 Werewolf (3); 3 Peramal (2)
    ...Array.from({ length: 4 }, () => baris('b', 'warga', true, t)),
    baris('b', 'warga', false, t),
    ...Array.from({ length: 3 }, () => baris('b', 'werewolf', true, t)),
    ...Array.from({ length: 2 }, () => baris('b', 'peramal', true, t)),
    baris('b', 'peramal', false, t),
    // c: 10 main, 7 menang; winrate 0.7
    ...Array.from({ length: 5 }, () => baris('c', 'warga', true, t)),
    ...Array.from({ length: 2 }, () => baris('c', 'warga', false, t)),
    ...Array.from({ length: 2 }, () => baris('c', 'werewolf', true, t)),
    baris('c', 'werewolf', false, t),
    // d: 6 main sebagai warga (4 menang) - lolos min peran, kalah menang
    ...Array.from({ length: 4 }, () => baris('d', 'warga', true, t)),
    ...Array.from({ length: 2 }, () => baris('d', 'warga', false, t)),
    // e: 9 main (di bawah min winrate 10)
    ...Array.from({ length: 8 }, () => baris('e', 'warga', true, t)),
    baris('e', 'warga', false, t),
    // f: 4 warga menang - di bawah min 5 peran
    ...Array.from({ length: 4 }, () => baris('f', 'warga', true, t)),
    // lama: di bulan lalu, diabaikan
    ...Array.from({ length: 20 }, () => baris('lama', 'warga', true, AKHIR_OKT)),
  ];

  it('hanya menghitung match musim ini', () => {
    const ag = agregatMusim(data, '2026-11');
    expect(ag.find((x) => x.userId === 'lama')).toBeUndefined();
    expect(ag.find((x) => x.userId === 'a')?.main).toBe(12);
  });

  it('keseluruhan: menang terbanyak, seri main lebih sedikit', () => {
    const top = top3Kategori(agregatMusim(data, '2026-11'), 'keseluruhan');
    expect(top.map((x) => x.userId)).toEqual(['b', 'e', 'a']);
    expect(top[0].peringkat).toBe(1);
  });

  it('best peran: min 5 main peran; f tidak masuk', () => {
    const top = top3Kategori(agregatMusim(data, '2026-11'), 'warga');
    expect(top.map((x) => x.userId)).toEqual(['e', 'a', 'c']);
    expect(top.find((x) => x.userId === 'f')).toBeUndefined();
  });

  it('winrate: min 10 main; e (9) tidak masuk', () => {
    const top = top3Kategori(agregatMusim(data, '2026-11'), 'winrate');
    expect(top.every((x) => x.main >= 10)).toBe(true);
    expect(top.find((x) => x.userId === 'e')).toBeUndefined();
    // b 9/11 ≈ 0.818, a 8/12 ≈ 0.667, c 7/10 = 0.7 → b, c, a
    expect(top.map((x) => x.userId)).toEqual(['b', 'c', 'a']);
  });

  it('match terbanyak', () => {
    const top = top3Kategori(agregatMusim(data, '2026-11'), 'main');
    expect(top[0].userId).toBe('a');
    expect(top[0].metrik).toBe(12);
  });

  it('tie-break userId deterministik', () => {
    const sama: BarisMain[] = [
      ...Array.from({ length: 5 }, () => baris('z', 'warga', true, t)),
      ...Array.from({ length: 5 }, () => baris('m', 'warga', true, t)),
    ];
    expect(top3Kategori(agregatMusim(sama, '2026-11'), 'keseluruhan').map((x) => x.userId)).toEqual(['m', 'z']);
  });
});

describe('pemilihan gelar dan teks', () => {
  it('default: peringkat terkecil, seri keseluruhan dulu sebelum yang lain', () => {
    const slot = top3Semua(agregatMusim([
      ...Array.from({ length: 10 }, () => baris('a', 'warga', true, TENGAH_NOV)),
      ...Array.from({ length: 10 }, () => baris('b', 'werewolf', true, TENGAH_NOV)),
    ], '2026-11')).filter((s) => s.userId === 'a');
    const g = pilihGelarDefault(slot, '2026-11');
    expect(g?.kategori).toBe('keseluruhan');
    expect(g?.peringkat).toBe(1);
  });
  it('default seri sama peringkat: winrate mengalahkan warga', () => {
    const slot = [
      { userId: 'a', peringkat: 2 as const, kategori: 'warga' as const, main: 8, menang: 5, winrate: null, metrik: 5 },
      { userId: 'a', peringkat: 2 as const, kategori: 'winrate' as const, main: 12, menang: 9, winrate: 0.75, metrik: 0.75 },
      { userId: 'a', peringkat: 3 as const, kategori: 'keseluruhan' as const, main: 12, menang: 9, winrate: null, metrik: 9 },
    ];
    const g = pilihGelarDefault(slot, '2026-11');
    expect(g?.kategori).toBe('winrate');
    expect(g?.peringkat).toBe(2);
  });
  it('default peringkat 1 warga mengalahkan peringkat 2 winrate', () => {
    const slot = [
      { userId: 'a', peringkat: 1 as const, kategori: 'warga' as const, main: 8, menang: 5, winrate: null, metrik: 5 },
      { userId: 'a', peringkat: 2 as const, kategori: 'winrate' as const, main: 12, menang: 9, winrate: 0.75, metrik: 0.75 },
    ];
    expect(pilihGelarDefault(slot, '2026-11')?.kategori).toBe('warga');
  });
  it('teks award bulan lalu tanpa frame', () => {
    expect(teksGelar({ kategori: 'werewolf', peringkat: 1, musim: '2026-10', sumber: 'award' })).toBe('Juara 1 Werewolf Okt 2026');
    expect(teksGelar({ kategori: 'winrate', peringkat: 2, musim: '2026-10', sumber: 'award' })).toBe('#2 Winrate Okt 2026');
    expect(teksGelar({ kategori: 'peramal', peringkat: 2, musim: '2026-11' })).toBe('#2 Peramal');
  });
  it('keterangan tap dan notifikasi', () => {
    const s = { userId: 'a', peringkat: 2 as const, kategori: 'peramal' as const, main: 25, menang: 16, winrate: 0.64, metrik: 16 };
    expect(keteranganSlot(s)).toBe('#2 Best Peramal · 64% menang dari 25 game');
    expect(pesanMasukTop3(s)).toBe('Selamat, kamu masuk Top 3 Peramal!');
  });
  it('deteksi masuk top 3 baru', () => {
    const sekarang = [
      { userId: 'a', peringkat: 1 as const, kategori: 'keseluruhan' as const, main: 5, menang: 5, winrate: 1, metrik: 5 },
      { userId: 'a', peringkat: 3 as const, kategori: 'winrate' as const, main: 10, menang: 7, winrate: 0.7, metrik: 0.7 },
    ];
    const baru = slotBaruMasuk(sekarang, [{ kategori: 'keseluruhan', peringkat: 1 }]);
    expect(baru.map((x) => x.kategori)).toEqual(['winrate']);
  });
});

describe('kategori peran werewolf', () => {
  it('Dokter dihitung per peran seperti peran lain (min 5 main, menang > 0)', () => {
    const t = TENGAH_NOV;
    const data: BarisMain[] = [
      ...Array.from({ length: 5 }, () => baris('dok', 'dokter', true, t)),
      ...Array.from({ length: 4 }, () => baris('kurang', 'dokter', true, t)),
      ...Array.from({ length: 5 }, () => baris('kalah', 'dokter', false, t)),
    ];
    expect(top3Kategori(agregatMusim(data, '2026-11'), 'dokter').map((x) => x.userId)).toEqual(['dok']);
  });
  it('urutan default sama dengan undercover: keseluruhan, winrate, warga, werewolf, peramal, dokter, main', () => {
    const slot = (['main', 'dokter', 'peramal', 'werewolf', 'warga'] as const).map((k) => ({
      userId: 'a', peringkat: 1 as const, kategori: k, main: 10, menang: 6, winrate: null, metrik: 6,
    }));
    expect(pilihGelarDefault(slot, '2026-11')?.kategori).toBe('warga');
    expect(pilihGelarDefault(slot.filter((s) => s.kategori !== 'warga'), '2026-11')?.kategori).toBe('werewolf');
  });
});
