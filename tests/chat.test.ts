import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buatStateChat, gabungChat, hanyaEmoji, hitungBelumDibaca, LIMIT_CHAT, MAKS_PANJANG_CHAT, MAKS_RIWAYAT_CHAT,
  rapikanTeksChat, terimaChat, validasiPesanChat, type PesanChat,
} from '../lib/online/chat';

const budi = { id: 'b', nama: 'Budi' };
const ani = { id: 'a', nama: 'Ani' };

describe('rapikanTeksChat', () => {
  it('membuang spasi berlebih dan karakter kontrol, menolak teks kosong', () => {
    expect(rapikanTeksChat('  halo \n\t semua\u0000 ')).toBe('halo semua');
    expect(rapikanTeksChat('   ')).toBeNull();
    expect(rapikanTeksChat(42)).toBeNull();
    expect(rapikanTeksChat({ teks: 'x' })).toBeNull();
  });

  it('memotong ke batas panjang tanpa merusak emoji', () => {
    expect(Array.from(rapikanTeksChat('a'.repeat(500))!).length).toBe(MAKS_PANJANG_CHAT);
    const emoji = rapikanTeksChat('😂'.repeat(300))!;
    expect(Array.from(emoji).length).toBe(MAKS_PANJANG_CHAT);
    expect(emoji.endsWith('😂')).toBe(true);
    expect(rapikanTeksChat('👨‍👩‍👧')).toBe('👨‍👩‍👧');
  });

  it('teks HTML tetap teks biasa (tidak diubah, dirender sebagai teks oleh React)', () => {
    expect(rapikanTeksChat('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('terimaChat (relay di host)', () => {
  it('mengambil nama dari daftar pemain, memberi id unik, dan menyimpan pesan', () => {
    let s = buatStateChat();
    const r1 = terimaChat(s, budi, 'halo', 1000);
    expect(r1.pesan).toMatchObject({ dari: 'b', nama: 'Budi', teks: 'halo', waktu: 1000 });
    s = r1.state;
    const r2 = terimaChat(s, ani, 'hai', 1000);
    expect(r2.pesan!.id).not.toBe(r1.pesan!.id);
    expect(r2.state.pesan.map((p) => p.teks)).toEqual(['halo', 'hai']);
    // State lama tidak dimutasi.
    expect(s.pesan).toHaveLength(1);
  });

  it('menolak pengirim yang bukan anggota room dan mengabaikan teks kosong', () => {
    const s = buatStateChat();
    expect(terimaChat(s, undefined, 'halo', 0).tolak).toBeTruthy();
    const kosong = terimaChat(s, budi, '   ', 0);
    expect(kosong.pesan).toBeUndefined();
    expect(kosong.tolak).toBeUndefined();
    expect(kosong.state).toBe(s);
  });

  it('rate limit per pemain, lalu pulih setelah jendela waktu lewat', () => {
    let s = buatStateChat();
    for (let i = 0; i < LIMIT_CHAT.jumlah; i++) {
      const r = terimaChat(s, budi, `p${i}`, 1000 + i * 100);
      expect(r.pesan).toBeDefined();
      s = r.state;
    }
    const lebih = terimaChat(s, budi, 'spam', 1600);
    expect(lebih.tolak).toMatch(/Terlalu cepat/);
    expect(lebih.state).toBe(s);
    // Pemain lain tidak terkena limit Budi.
    expect(terimaChat(s, ani, 'hai', 1600).pesan).toBeDefined();
    expect(terimaChat(s, budi, 'lagi', 1000 + LIMIT_CHAT.jendelaMs + 1).pesan).toBeDefined();
  });

  it('hanya menyimpan riwayat terakhir untuk pemain yang tersambung ulang', () => {
    let s = buatStateChat();
    for (let i = 0; i < MAKS_RIWAYAT_CHAT + 15; i++) {
      s = terimaChat(s, i % 2 ? budi : ani, `pesan ${i}`, i * 60_000).state;
    }
    expect(s.pesan).toHaveLength(MAKS_RIWAYAT_CHAT);
    expect(s.pesan[0].teks).toBe('pesan 15');
    expect(s.pesan.at(-1)!.teks).toBe(`pesan ${MAKS_RIWAYAT_CHAT + 14}`);
  });

  it('pesan relay hanya berisi id, nama, teks, dan waktu (tidak ada data permainan)', () => {
    const r = terimaChat(buatStateChat(), budi, 'halo', 5);
    expect(Object.keys(r.pesan!).sort()).toEqual(['dari', 'id', 'nama', 'teks', 'waktu']);
  });
});

describe('chat di klien', () => {
  const p = (id: string, waktu: number, dari = 'a'): PesanChat => ({ id, dari, nama: 'Ani', teks: `t${id}`, waktu });

  it('menggabungkan riwayat dan pesan baru tanpa duplikat, urut waktu', () => {
    const awal = gabungChat([], [p('2', 20), p('1', 10)]);
    expect(awal.map((x) => x.id)).toEqual(['1', '2']);
    const lagi = gabungChat(awal, [p('2', 20), p('3', 30)]);
    expect(lagi.map((x) => x.id)).toEqual(['1', '2', '3']);
    expect(gabungChat(lagi, [p('3', 30)])).toBe(lagi);
  });

  it('membuang pesan dari jaringan yang tidak valid', () => {
    expect(validasiPesanChat(null)).toBeNull();
    expect(validasiPesanChat({ id: 1, dari: 'a', nama: 'x', teks: 'y', waktu: 1 })).toBeNull();
    expect(validasiPesanChat({ id: 'a', dari: 'a', nama: 'x', teks: '  ', waktu: 1 })).toBeNull();
    expect(gabungChat([], [{ id: 'z' }, 'x', p('ok', 1)]).map((x) => x.id)).toEqual(['ok']);
    expect(validasiPesanChat({ id: 'a', dari: 'a', nama: 'x', teks: 'y'.repeat(999), waktu: 1, peran: 'werewolf' }))
      .toEqual({ id: 'a', dari: 'a', nama: 'x', teks: 'y'.repeat(MAKS_PANJANG_CHAT), waktu: 1 });
  });

  it('menghitung pesan belum dibaca dari orang lain saja', () => {
    const daftar = [p('1', 1, 'a'), p('2', 2, 'saya'), p('3', 3, 'a'), p('4', 4, 'b')];
    expect(hitungBelumDibaca(daftar, null, 'saya')).toBe(3);
    expect(hitungBelumDibaca(daftar, '2', 'saya')).toBe(2);
    expect(hitungBelumDibaca(daftar, '4', 'saya')).toBe(0);
  });

  it('mengenali pesan yang hanya berisi emoji', () => {
    expect(hanyaEmoji('😂')).toBe(true);
    expect(hanyaEmoji('👍👍')).toBe(true);
    expect(hanyaEmoji('ok 👍')).toBe(false);
  });
});

describe('keamanan render chat', () => {
  it('tidak ada HTML mentah di komponen', () => {
    const berkas: string[] = [];
    const jelajah = (d: string) => {
      for (const n of readdirSync(d)) {
        const f = join(d, n);
        if (statSync(f).isDirectory()) jelajah(f);
        else if (/\.(tsx?|jsx?)$/.test(n)) berkas.push(f);
      }
    };
    for (const d of ['app', 'components', 'lib']) jelajah(join(__dirname, '..', d));
    const temuan = berkas.filter((f) => /dangerouslySetInnerHTML|innerHTML\s*=/.test(readFileSync(f, 'utf8')));
    expect(temuan).toEqual([]);
  });
});
