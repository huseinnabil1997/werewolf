import { describe, expect, it } from 'vitest';
import { BATAS_BAWAAN, durasiFase, kunciLangkah, rapikanBatas, teksDetik } from '@/lib/batasWaktu';
import { LEWATI, batalSiap, hitungSuara, keluarkanPemain, komposisiOtomatis, mulaiGame, mulaiVoting, selesaikanVoting, tandaiSiap, type Peran, type StateGame } from '@/lib/game';
import { bukaSandi, imporKunci, sandikan } from '@/lib/online/kripto';
import { BATAS_MENYAMBUNG_MS, pesanMacet, sudahMacet } from '@/lib/online/macet';
import {
  GALAT_CHAT_MALAM,
  GALAT_CHAT_TEWAS,
  aturTenggat,
  buatKunciSnapshot,
  metaPublik,
  pindahHost,
  prosesAksiHost,
  prosesAksiPemain,
  prosesWaktu,
  rapikanStateHost,
  sinkronAnggota,
  stateHostBaru,
  viewPribadi,
  viewPublik,
  type StateHost,
} from '@/lib/online/protokol';
import { kunciGiliran, menangkah, peristiwaOnline, pilihUtama, type ViewPemain } from '@/lib/umpan/peristiwa';

function rng(seed = 3) {
  let a = seed;
  return () => {
    a = (a * 16807) % 2147483647;
    return a / 2147483647;
  };
}

const T0 = 1_000_000;

function host(n = 6, batas = BATAS_BAWAAN): StateHost {
  let s = stateHostBaru('ABCDE', 'u0', 'Host', { batas });
  s = sinkronAnggota(s, Array.from({ length: n }, (_, i) => ({ id: `u${i}`, nama: `P${i}` })));
  return s;
}

function mulai(s: StateHost, peserta?: string[]): StateHost {
  const h = prosesAksiHost(s, { jenis: 'mulai', peserta }, rng(), T0);
  expect(h.galat).toBeNull();
  return h.state;
}

function keMalam(s: StateHost): StateHost {
  for (const a of s.game!.pemain) s = prosesAksiPemain(s, a.id, { jenis: 'siap' }, rng(), T0).state;
  expect(s.game!.fase).toBe('malam');
  return s;
}

/** Game dengan peran tertentu langsung di fase voting. */
function gameVoting(peran: Peran[]): StateGame {
  const p = peran.map((_, i) => ({ id: `p${i}`, nama: `N${i}` }));
  let g = mulaiGame(p, komposisiOtomatis(Math.max(4, peran.length)), { rng: rng(), idMain: 'g' });
  g = { ...g, peran: Object.fromEntries(p.map((x, i) => [x.id, peran[i]])) };
  for (const x of p) g = tandaiSiap(g, x.id);
  g = { ...g, fase: 'diskusi' };
  return mulaiVoting(g);
}

describe('vote ulang', () => {
  it('seri di putaran 1 memicu vote ulang hanya antara yang seri', () => {
    let g = gameVoting(['werewolf', 'warga', 'warga', 'warga', 'peramal', 'dokter']);
    g = { ...g, suara: { p0: 'p1', p1: 'p0', p2: 'p1', p3: 'p0', p4: LEWATI, p5: LEWATI } };
    g = selesaikanVoting(g);
    expect(g.fase).toBe('voting');
    expect(g.putaranVote).toBe(2);
    expect(g.kandidat.sort()).toEqual(['p0', 'p1']);
    expect(g.hasilVoting?.keputusan).toBe('voteUlang');
    expect(g.suara).toEqual({});
  });
  it('seri lagi di putaran 2: tidak ada yang tereliminasi', () => {
    const h = hitungSuara({ a: 'b', b: 'a' }, ['a', 'b', 'c'], 2);
    expect(h.keputusan).toBe('tanpaEliminasi');
    expect(h.tereliminasi).toBeNull();
  });
  it('seri dengan Lewati juga vote ulang', () => {
    const h = hitungSuara({ a: 'b', c: LEWATI }, ['a', 'b', 'c'], 1);
    expect(h.keputusan).toBe('voteUlang');
    expect(h.kandidatSeri).toEqual(['b']);
  });
  it('suara tunggal terbanyak langsung tereliminasi', () => {
    const h = hitungSuara({ a: 'b', c: 'b', b: 'a' }, ['a', 'b', 'c'], 1);
    expect(h.keputusan).toBe('eliminasi');
    expect(h.tereliminasi).toBe('b');
  });
});

describe('siap, batal siap, dan keluarkan pemain', () => {
  it('batal siap menghapus tanda siap', () => {
    let s = mulai(host(5));
    s = prosesAksiPemain(s, 'u1', { jenis: 'siap' }, rng(), T0).state;
    expect(s.game!.siap.u1).toBe(true);
    s = prosesAksiPemain(s, 'u1', { jenis: 'batal_siap' }, rng(), T0).state;
    expect(s.game!.siap.u1).toBeUndefined();
    expect(batalSiap(s.game!, 'u1')).toBe(s.game);
  });
  it('pemain yang dikeluarkan dianggap tewas, perannya terbuka, dan tidak bisa masuk lagi', () => {
    let s = keMalam(mulai(host(6)));
    const h = prosesAksiHost(s, { jenis: 'keluarkan', id: 'u3' }, rng(), T0);
    expect(h.galat).toBeNull();
    s = h.state;
    expect(s.game!.hidup.u3).toBe(false);
    expect(s.dikeluarkan).toContain('u3');
    expect(viewPublik(s).pemain.find((p) => p.id === 'u3')?.peran).toBe(s.game!.peran.u3);
    const pri = viewPribadi(s, 'u3');
    expect(pri.dikeluarkan).toBe(true);
    expect(pri.peran).toBeNull();
    expect(pri.kunci).toBe('');
    s = sinkronAnggota(s, [{ id: 'u3', nama: 'P3' }, ...s.anggota]);
    expect(s.anggota.some((a) => a.id === 'u3')).toBe(false);
    expect(prosesAksiPemain(s, 'u3', { jenis: 'chat_room', teks: 'halo' }).galat).toMatch(/dikeluarkan/);
  });
  it('host tidak bisa mengeluarkan dirinya sendiri', () => {
    expect(prosesAksiHost(host(4), { jenis: 'keluarkan', id: 'u0' }).galat).toMatch(/Host/);
  });
  it('keluarkan pemain membuat pemenang langsung dicek', () => {
    const g = gameVoting(['werewolf', 'warga', 'warga', 'warga']);
    const n = keluarkanPemain(g, 'p0');
    expect(n.fase).toBe('selesai');
    expect(n.pemenang).toBe('warga');
  });
});

describe('peserta, penonton, dan visibilitas', () => {
  it('pemain offline tidak ikut dan menjadi penonton', () => {
    const s = mulai(host(6), ['u0', 'u1', 'u2', 'u3']);
    expect(s.game!.pemain.map((p) => p.id)).toEqual(['u0', 'u1', 'u2', 'u3']);
    const v = viewPublik(s);
    expect(v.pemain.find((p) => p.id === 'u5')?.main).toBe(false);
    expect(viewPribadi(s, 'u5').peran).toBeNull();
  });
  it('room match selalu publik; meta publik tanpa info permainan', () => {
    const s = stateHostBaru('ABCDE', 'u0', 'Host', { match: { maks: 6, acak: false } });
    expect(s.publik).toBe(true);
    expect(prosesAksiHost(s, { jenis: 'publik', publik: false }).galat).toMatch(/match/);
    const m = metaPublik(mulai(host(5)), 'Host', new Set(['u1', 'u2']));
    expect(m).toEqual({ host: 'Host', jumlah: 3, status: 'main', match: false });
  });
  it('status online dari host', () => {
    const v = viewPublik(host(4), new Set(['u2']));
    expect(v.pemain.filter((p) => p.online).map((p) => p.id)).toEqual(['u0', 'u2']);
  });
});

describe('chat room', () => {
  it('lobby: semua anggota boleh chat; malam: ditutup; pemain tewas dan penonton tidak bisa', () => {
    let s = host(6);
    const h = prosesAksiPemain(s, 'u1', { jenis: 'chat_room', teks: 'halo semua' }, rng(), T0);
    expect(h.berubah).toBe(true);
    expect(viewPublik(h.state).chat.at(-1)).toMatchObject({ dari: 'u1', nama: 'P1', teks: 'halo semua' });
    s = keMalam(mulai(h.state, ['u0', 'u1', 'u2', 'u3', 'u4']));
    expect(prosesAksiPemain(s, 'u1', { jenis: 'chat_room', teks: 'x' }, rng(), T0).galat).toBe(GALAT_CHAT_MALAM);
    expect(prosesAksiPemain(s, 'u5', { jenis: 'chat_room', teks: 'x' }, rng(), T0).galat).toBe(GALAT_CHAT_TEWAS);
    s = prosesAksiHost(s, { jenis: 'keluarkan', id: 'u4' }, rng(), T0).state;
    if (s.game!.fase !== 'selesai') {
      s = { ...s, game: { ...s.game!, fase: 'diskusi' } };
      expect(prosesAksiPemain(s, 'u1', { jenis: 'chat_room', teks: 'pagi' }, rng(), T0).galat).toBeNull();
    }
  });
});

describe('batas waktu', () => {
  it('rapikan: nilai di luar pilihan kembali ke bawaan', () => {
    expect(rapikanBatas({ malam: 45, diskusi: 7, voting: 'x' })).toEqual({ ...BATAS_BAWAAN, malam: 45 });
    expect(durasiFase('pagi', { malam: 0, diskusi: 0, voting: 0, lanjut: 10 })).toBe(10);
    expect(durasiFase('peran', { malam: 30, diskusi: 60, voting: 30, lanjut: 10 })).toBe(0);
    expect(teksDetik(120)).toMatch(/2/);
  });
  it('tenggat dipasang per langkah dan aksi otomatis jalan saat habis', () => {
    let s = keMalam(mulai(host(5, { malam: 30, diskusi: 60, voting: 30, lanjut: 0 })));
    s = aturTenggat(s, T0);
    expect(s.tenggat?.kunci).toBe(kunciLangkah(s.game!));
    expect(s.tenggat?.sampai).toBe(T0 + 30_000);
    expect(viewPublik(s, new Set(), T0 + 10_000).sisaMs).toBe(20_000);
    expect(prosesWaktu(s, rng(), T0 + 29_999).berubah).toBe(false);
    const h = prosesWaktu(s, rng(), T0 + 30_000);
    expect(h.berubah).toBe(true);
    expect(h.state.game!.fase).toBe('pagi');
    // Lanjut otomatis 0 = tanpa batas di layar pagi.
    expect(h.state.tenggat?.sampai).toBeNull();
  });
  it('vote ulang memulai tenggat baru', () => {
    let s = mulai(host(6, { malam: 0, diskusi: 0, voting: 30, lanjut: 0 }));
    const g = gameVoting(['werewolf', 'warga', 'warga', 'warga', 'peramal', 'dokter']);
    s = aturTenggat({ ...s, game: g }, T0);
    const k1 = s.tenggat!.kunci;
    const g2 = selesaikanVoting({ ...g, suara: { p0: 'p1', p1: 'p0' } });
    s = aturTenggat({ ...s, game: g2 }, T0 + 5000);
    expect(s.tenggat!.kunci).not.toBe(k1);
    expect(s.tenggat!.sampai).toBe(T0 + 5000 + 30_000);
  });
});

describe('pindah host dan snapshot', () => {
  it('state pindah ke host baru dengan tambahan waktu', () => {
    let s = keMalam(mulai(host(5, { malam: 30, diskusi: 0, voting: 0, lanjut: 0 })));
    s = aturTenggat(s, T0);
    const p = pindahHost(s, 'u2', T0 + 1000);
    expect(p.hostId).toBe('u2');
    expect(p.tenggat!.sampai).toBe(T0 + 30_000 + 10_000);
    expect(p.versi).toBe(s.versi + 1);
    expect(viewPublik(p).hostId).toBe('u2');
  });
  it('rapikanStateHost menolak bentuk lain', () => {
    const s = host(4);
    expect(rapikanStateHost(JSON.parse(JSON.stringify(s)), 'ABCDE')).not.toBeNull();
    expect(rapikanStateHost({ ...s, bentuk: 1 }, 'ABCDE')).toBeNull();
    expect(rapikanStateHost(s, 'ZZZZZ')).toBeNull();
    expect(rapikanStateHost(null, 'ABCDE')).toBeNull();
  });
  it('kunci snapshot hanya di view pribadi, tidak di view publik', () => {
    const s = host(4);
    expect(viewPribadi(s, 'u1').kunci).toBe(s.kunciSnapshot);
    expect(JSON.stringify(viewPublik(s))).not.toContain(s.kunciSnapshot);
  });
  it('snapshot AES-GCM: bolak-balik dengan kunci benar, gagal dengan kunci lain', async () => {
    const s = keMalam(mulai(host(5)));
    const k = (await imporKunci(s.kunciSnapshot))!;
    const teks = await sandikan(k, s);
    expect(teks).not.toContain('werewolf');
    expect(await bukaSandi(k, teks)).toEqual(JSON.parse(JSON.stringify(s)));
    const lain = (await imporKunci(buatKunciSnapshot()))!;
    expect(await bukaSandi(lain, teks)).toBeNull();
    expect(await imporKunci('bukan base64!')).toBeNull();
  });
});

describe('umpan balik giliran', () => {
  const view = (s: StateHost, saya: string): ViewPemain => ({ saya, pub: viewPublik(s), pri: viewPribadi(s, saya) });
  it('giliranmu untuk aksi malam peran khusus dan voting; warga tidak', () => {
    const s = keMalam(mulai(host(6)));
    const g = s.game!;
    const ww = Object.keys(g.peran).find((id) => g.peran[id] === 'werewolf')!;
    const warga = Object.keys(g.peran).find((id) => g.peran[id] === 'warga')!;
    expect(kunciGiliran(view(s, ww))).toMatch(/^malam-/);
    expect(kunciGiliran(view(s, warga))).toBeNull();
    const lalu = view(mulai(host(6)), ww);
    expect(peristiwaOnline(lalu, view(s, ww))).toContain('giliranmu');
    expect(pilihUtama(['malam', 'giliranmu', 'gabung'])).toBe('giliranmu');
  });
  it('menang atau kalah sesuai tim', () => {
    let s = mulai(host(4));
    s = { ...s, game: { ...s.game!, fase: 'selesai', pemenang: 'warga' } };
    const g = s.game!;
    const ww = Object.keys(g.peran).find((id) => g.peran[id] === 'werewolf')!;
    const lain = Object.keys(g.peran).find((id) => g.peran[id] !== 'werewolf')!;
    expect(menangkah(view(s, ww))).toBe(false);
    expect(menangkah(view(s, lain))).toBe(true);
  });
});

describe('pengaman macet', () => {
  it('macet hanya bila belum tersambung atau belum ada data melewati batas', () => {
    expect(sudahMacet('menyambung', false, 1000, 1000 + BATAS_MENYAMBUNG_MS - 1)).toBe(false);
    expect(sudahMacet('menyambung', false, 1000, 1000 + BATAS_MENYAMBUNG_MS)).toBe(true);
    expect(sudahMacet('tersambung', true, 1000, 1000 + BATAS_MENYAMBUNG_MS * 3)).toBe(false);
    expect(sudahMacet('tersambung', false, 1000, 1000 + BATAS_MENYAMBUNG_MS)).toBe(true);
    expect(sudahMacet('tidakAda', false, 0, 0)).toBe(true);
    expect(sudahMacet('menyambung', false, 0, 10 ** 12)).toBe(false);
  });
  it('pesan berbahasa Indonesia tanpa em dash', () => {
    const p = [pesanMacet(false, 'ABCDE', 'tidakAda'), pesanMacet(true, 'ABCDE', 'terputus'), pesanMacet(false, 'ABCDE', 'tersambung'), pesanMacet(false, 'ABCDE', 'menyambung')];
    expect(p[0]).toMatch(/tidak ditemukan/);
    expect(p[2]).toMatch(/mengambil alih/);
    for (const x of p) expect(x).not.toMatch(/\u2014/);
  });
});
