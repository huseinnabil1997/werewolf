import { describe, expect, it } from 'vitest';
import { alasanMulaiOtomatis, formatTunggu, labelUkuran, maksRoomBaru, pilihRoom, rapikanStatus, sisaHitungMundur, ukuranValid, type RoomTerbuka } from '../lib/online/antrean';

const r = (kode: string, maks: number, jumlah: number, dibuat: number, dimulai = false): RoomTerbuka => ({ kode, maks, jumlah, dibuat, dimulai });

describe('pilihRoom', () => {
  it('ukuran N: room terbuka tertua dengan maks N yang belum penuh', () => {
    const rooms = [r('BBBBB', 5, 2, 20), r('AAAAA', 5, 4, 10), r('CCCCC', 6, 1, 1)];
    expect(pilihRoom(rooms, 5)?.kode).toBe('AAAAA');
    expect(pilihRoom(rooms, 6)?.kode).toBe('CCCCC');
    expect(pilihRoom(rooms, 7)).toBeNull();
  });
  it('tidak memilih room penuh atau yang sudah dimulai', () => {
    const rooms = [r('AAAAA', 5, 5, 1), r('BBBBB', 5, 3, 2, true), r('CCCCC', 5, 1, 3)];
    expect(pilihRoom(rooms, 5)?.kode).toBe('CCCCC');
    expect(pilihRoom([r('AAAAA', 5, 5, 1), r('BBBBB', 5, 2, 2, true)], 5)).toBeNull();
  });
  it('room tanpa anggota yang berdetak tidak dipilih', () => {
    expect(pilihRoom([{ ...r('AAAAA', 5, 2, 1), hidup: false }, r('BBBBB', 5, 1, 2)], null)?.kode).toBe('BBBBB');
  });
  it('Acak: room mana saja, paling ramai dulu lalu paling lama', () => {
    const rooms = [r('AAAAA', 8, 2, 1), r('BBBBB', 4, 3, 5), r('CCCCC', 6, 3, 3), r('DDDDD', 5, 5, 0)];
    expect(pilihRoom(rooms, null)?.kode).toBe('CCCCC');
    expect(pilihRoom([], null)).toBeNull();
  });
  it('room baru: maks N, atau 8 untuk Acak', () => {
    expect(maksRoomBaru(6)).toBe(6);
    expect(maksRoomBaru(null)).toBe(8);
  });
});

describe('mulai otomatis', () => {
  it('penuh langsung mulai', () => {
    expect(alasanMulaiOtomatis(5, 5, 0)).toBe('penuh');
  });
  it('minimal 4 dan 60 detik tanpa pemain baru', () => {
    expect(alasanMulaiOtomatis(4, 6, 59_999)).toBeNull();
    expect(alasanMulaiOtomatis(4, 6, 60_000)).toBe('diam');
    expect(alasanMulaiOtomatis(3, 6, 999_000)).toBeNull();
  });
  it('room Acak tidak pernah mulai otomatis, room tetap tetap mulai', () => {
    expect(alasanMulaiOtomatis(8, 8, 0, true)).toBeNull();
    expect(alasanMulaiOtomatis(5, 8, 999_000, true)).toBeNull();
    expect(alasanMulaiOtomatis(8, 8, 0, false)).toBe('penuh');
  });
  it('hitung mundur hanya berjalan saat minimal 4', () => {
    expect(sisaHitungMundur(3, 10_000)).toBeNull();
    expect(sisaHitungMundur(4, 15_000)).toBe(45_000);
    expect(sisaHitungMundur(4, 90_000)).toBe(0);
  });
});

describe('pembantu', () => {
  it('ukuranValid dan label', () => {
    expect(ukuranValid(null)).toBe(true);
    expect(ukuranValid(8)).toBe(true);
    expect(ukuranValid(3)).toBe(false);
    expect(labelUkuran(null)).toBe('Acak');
    expect(labelUkuran(6)).toBe('Maks 6 pemain');
  });
  it('rapikanStatus', () => {
    expect(rapikanStatus(null)).toBeNull();
    expect(rapikanStatus({ kode: 'ABCDE', maks: 5, jumlah: 3, status: 'lobby', diam_ms: 1200, host: true })).toEqual({ kode: 'ABCDE', maks: 5, jumlah: 3, dimulai: false, diamMs: 1200, host: true, acak: false });
    expect(rapikanStatus({ kode: 'ABCDE', maks: 8, acak: true })?.acak).toBe(true);
    expect(rapikanStatus({ kode: 'ABCDE', maks: 5, jumlah: 3, status: 'dimulai' })?.dimulai).toBe(true);
    expect(rapikanStatus({ kode: 'ABCDI', maks: 5 })).toBeNull();
    expect(rapikanStatus({ kode: 'ABCDE', maks: 9 })).toBeNull();
  });
  it('formatTunggu', () => {
    expect(formatTunggu(65_400)).toBe('1:05');
  });
});
