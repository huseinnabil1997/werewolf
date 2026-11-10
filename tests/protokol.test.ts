import { describe, expect, it } from 'vitest';
import { komposisiOtomatis } from '@/lib/game';
import {
  aksiSah,
  barisHasil,
  buatKode,
  kodeDariUrl,
  prosesAksiHost,
  prosesAksiPemain,
  sinkronAnggota,
  stateHostBaru,
  viewPribadi,
  viewPublik,
  type StateHost,
} from '@/lib/online/protokol';

function rng(seed = 7) {
  let a = seed;
  return () => {
    a = (a * 16807) % 2147483647;
    return a / 2147483647;
  };
}

function hostDenganGame(n = 6): StateHost {
  let s = stateHostBaru('ABCDE', 'u0', 'Host');
  s = sinkronAnggota(s, Array.from({ length: n }, (_, i) => ({ id: `u${i}`, nama: `P${i}` })));
  const h = prosesAksiHost(s, { jenis: 'mulai' }, rng());
  expect(h.galat).toBeNull();
  return h.state;
}

describe('kode room', () => {
  it('5 huruf tanpa huruf mirip angka', () => {
    for (let i = 0; i < 50; i++) expect(buatKode()).toMatch(/^[A-HJ-NP-Z]{5}$/);
  });
  it('dibaca dari ?room=', () => {
    expect(kodeDariUrl('?room=abcde')).toBe('ABCDE');
    expect(kodeDariUrl('?room=AB')).toBeNull();
  });
});

describe('kerahasiaan view', () => {
  it('view publik tidak memuat peran pemain hidup, aksi malam, hasil peramal, atau chat werewolf', () => {
    let s = hostDenganGame();
    for (const a of s.anggota) s = prosesAksiPemain(s, a.id, { jenis: 'siap' }).state;
    const g = s.game!;
    expect(g.fase).toBe('malam');
    const ww = Object.keys(g.peran).find((id) => g.peran[id] === 'werewolf')!;
    const korban = Object.keys(g.peran).find((id) => g.peran[id] !== 'werewolf')!;
    s = prosesAksiPemain(s, ww, { jenis: 'malam', target: korban }).state;
    s = prosesAksiPemain(s, ww, { jenis: 'chat', teks: 'RAHASIA_WW' }).state;
    const v = viewPublik(s);
    const json = JSON.stringify(v);
    expect(v.pemain.every((p) => p.peran === null)).toBe(true);
    expect(json).not.toContain('RAHASIA_WW');
    expect(json).not.toContain('pilihanWW');
    expect(json).not.toMatch(/"peran":"(werewolf|warga|peramal|dokter)"/);
    expect(json).not.toContain('riwayatLihat');
  });

  it('view pribadi hanya memuat peran pemilik; rekan dan chat hanya untuk werewolf', () => {
    let s = hostDenganGame(8);
    const g = s.game!;
    const wws = Object.keys(g.peran).filter((id) => g.peran[id] === 'werewolf');
    expect(wws.length).toBe(komposisiOtomatis(8).werewolf);
    s = prosesAksiPemain(s, wws[0], { jenis: 'chat', teks: 'halo tim' }).state;
    for (const a of s.anggota) {
      const v = viewPribadi(s, a.id);
      expect(v.peran).toBe(g.peran[a.id]);
      if (g.peran[a.id] === 'werewolf') {
        expect(v.rekan.sort()).toEqual(wws.filter((w) => w !== a.id).sort());
        expect(v.chatWW).toHaveLength(1);
      } else {
        expect(v.rekan).toEqual([]);
        expect(v.chatWW).toEqual([]);
        expect(JSON.stringify(v)).not.toContain('halo tim');
      }
    }
  });

  it('hasil peramal hanya untuk peramal', () => {
    let s = hostDenganGame(6);
    for (const a of s.anggota) s = prosesAksiPemain(s, a.id, { jenis: 'siap' }).state;
    const g = s.game!;
    const peramal = Object.keys(g.peran).find((id) => g.peran[id] === 'peramal')!;
    const target = Object.keys(g.peran).find((id) => id !== peramal)!;
    s = prosesAksiPemain(s, peramal, { jenis: 'malam', target }).state;
    expect(viewPribadi(s, peramal).riwayatLihat).toHaveLength(1);
    for (const a of s.anggota) if (a.id !== peramal) expect(viewPribadi(s, a.id).riwayatLihat).toEqual([]);
  });

  it('peran pemain tewas terbuka di view publik; semua terbuka saat selesai', () => {
    let s = hostDenganGame(5);
    for (const a of s.anggota) s = prosesAksiPemain(s, a.id, { jenis: 'siap' }).state;
    const g = s.game!;
    const ww = Object.keys(g.peran).find((id) => g.peran[id] === 'werewolf')!;
    const korban = Object.keys(g.peran).find((id) => g.peran[id] === 'warga')!;
    s = prosesAksiPemain(s, ww, { jenis: 'malam', target: korban }).state;
    s = prosesAksiHost(s, { jenis: 'akhiri_malam' }, rng()).state;
    const v = viewPublik(s);
    expect(v.pemain.find((p) => p.id === korban)!.peran).toBe('warga');
    expect(v.pemain.filter((p) => p.peran !== null)).toHaveLength(1);
  });

  it('suara voting tidak dibuka saat voting berlangsung', () => {
    let s = hostDenganGame(5);
    s = prosesAksiHost(s, { jenis: 'paksa_malam' }).state;
    s = prosesAksiHost(s, { jenis: 'akhiri_malam' }).state;
    s = prosesAksiHost(s, { jenis: 'diskusi' }).state;
    s = prosesAksiHost(s, { jenis: 'voting' }).state;
    s = prosesAksiPemain(s, 'u1', { jenis: 'suara', target: 'u2' }).state;
    const v = viewPublik(s);
    expect(v.game!.sudahVote).toEqual(['u1']);
    expect(v.game!.suaraTerbuka).toBeNull();
    expect(viewPribadi(s, 'u1').suaraku).toBe('u2');
    expect(viewPribadi(s, 'u3').suaraku).toBeNull();
  });
});

describe('aksi pemain dan host', () => {
  it('aksi tidak sah ditolak oleh validator', () => {
    expect(aksiSah(null)).toBeNull();
    expect(aksiSah({ jenis: 'mulai' })).toBeNull();
    expect(aksiSah({ jenis: 'chat', teks: '   ' })).toBeNull();
    expect(aksiSah({ jenis: 'malam', target: 5 })).toBeNull();
    expect(aksiSah({ jenis: 'chat', teks: 'x'.repeat(500) })).toEqual({ jenis: 'chat', teks: 'x'.repeat(200) });
  });

  it('chat werewolf ditolak dari non-werewolf', () => {
    const s = hostDenganGame(6);
    const g = s.game!;
    const warga = Object.keys(g.peran).find((id) => g.peran[id] !== 'werewolf')!;
    const h = prosesAksiPemain(s, warga, { jenis: 'chat', teks: 'x' });
    expect(h.berubah).toBe(false);
    expect(h.galat).toMatch(/khusus werewolf/);
  });

  it('host tidak bisa mulai dengan kurang dari 4 pemain', () => {
    const s = sinkronAnggota(stateHostBaru('ABCDE', 'u0', 'Host'), [{ id: 'u1', nama: 'A' }, { id: 'u2', nama: 'B' }]);
    expect(prosesAksiHost(s, { jenis: 'mulai' }).galat).toMatch(/Minimal 4/);
  });

  it('pemain yang gabung saat game berjalan menjadi penonton', () => {
    let s = hostDenganGame(4);
    s = sinkronAnggota(s, [...s.anggota, { id: 'baru', nama: 'Telat' }]);
    const v = viewPublik(s);
    expect(v.pemain.find((p) => p.id === 'baru')!.main).toBe(false);
    expect(viewPribadi(s, 'baru').peran).toBeNull();
  });

  it('baris hasil konsisten dengan pemenang', () => {
    let s = hostDenganGame(4);
    const g = s.game!;
    const ww = Object.keys(g.peran).find((id) => g.peran[id] === 'werewolf')!;
    s = prosesAksiHost(s, { jenis: 'paksa_malam' }).state;
    s = prosesAksiHost(s, { jenis: 'akhiri_malam' }).state;
    s = prosesAksiHost(s, { jenis: 'voting' }).state;
    for (const a of s.anggota) if (a.id !== ww) s = prosesAksiPemain(s, a.id, { jenis: 'suara', target: ww }).state;
    s = prosesAksiPemain(s, ww, { jenis: 'suara', target: 'lewati' }).state;
    expect(s.game!.pemenang).toBe('warga');
    const b = barisHasil(s.game!);
    expect(b).toHaveLength(4);
    for (const r of b) expect(r.menang).toBe(r.peran !== 'werewolf');
  });
});
