import { describe, expect, it } from 'vitest';
import { PESAN_KONFIRMASI_EMAIL, cekPassword, cekUsername, emailDari, pesanGalatAuth, ringkasStatistik } from '@/lib/akun';

describe('akun', () => {
  it('validasi username', () => {
    expect(cekUsername('ab')).toMatch(/3 sampai 20/);
    expect(cekUsername('a'.repeat(21))).toMatch(/3 sampai 20/);
    expect(cekUsername('nama spasi')).toMatch(/huruf, angka/);
    expect(cekUsername('uji_ww1')).toBeNull();
    expect(cekUsername('  Budi_99  ')).toBeNull();
  });
  it('validasi password', () => {
    expect(cekPassword('12345')).toMatch(/minimal 6/);
    expect(cekPassword('123456')).toBeNull();
  });
  it('email sintetis huruf kecil', () => {
    expect(emailDari(' Uji_WW1 ')).toBe('uji_ww1@werewolf.local');
  });
  it('pesan galat auth dalam bahasa Indonesia', () => {
    expect(pesanGalatAuth({ code: 'invalid_credentials' })).toBe('Username atau password salah.');
    expect(pesanGalatAuth({ code: 'user_already_exists' })).toBe('Username sudah dipakai.');
    expect(pesanGalatAuth({ code: 'email_not_confirmed' })).toBe(PESAN_KONFIRMASI_EMAIL);
    expect(pesanGalatAuth({ message: 'Error sending confirmation email' })).toBe(PESAN_KONFIRMASI_EMAIL);
    expect(pesanGalatAuth({ code: 'email_address_invalid' })).toBe(PESAN_KONFIRMASI_EMAIL);
    expect(pesanGalatAuth({ message: 'Failed to fetch' })).toMatch(/internet/);
  });
  it('ringkasan statistik per peran', () => {
    const r = ringkasStatistik([{ peran: 'werewolf', main: 4, menang: 3 }, { peran: 'warga', main: 6, menang: 2 }]);
    expect(r.main).toBe(10);
    expect(r.menang).toBe(5);
    expect(r.persen).toBe(50);
    expect(r.perPeran.werewolf.persen).toBe(75);
    expect(r.perPeran.dokter).toEqual({ main: 0, menang: 0, persen: null });
  });
});
