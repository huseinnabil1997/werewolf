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

describe('pencarian username', () => {
  it('escape karakter ilike', async () => {
    const { polaPersis } = await import('../lib/supabase/data');
    expect(polaPersis(' uji_a ')).toBe('uji\\_a');
    expect(polaPersis('a%b')).toBe('a\\%b');
  });
});

describe('avatar', () => {
  it('inisial, warna tetap, url berversi, potong tengah', async () => {
    const a = await import('../lib/avatar');
    expect(a.inisial('uji_budi')).toBe('UJ');
    expect(a.inisial('__')).toBe('_');
    expect(a.warnaAvatar('Budi')).toBe(a.warnaAvatar('budi'));
    expect(a.urlAvatar('u1', null)).toBeNull();
    expect(a.urlAvatar('u1', 3)).toMatch(/\/storage\/v1\/object\/public\/avatars\/u1\/avatar\.webp\?v=3$/);
    expect(a.potongTengah(400, 300)).toEqual({ x: 50, y: 0, sisi: 300 });
    expect(a.potongTengah(300, 401)).toEqual({ x: 0, y: 50, sisi: 300 });
    expect(a.SISI_AVATAR).toBe(256);
    expect(a.TARGET_BYTE_AVATAR).toBeLessThanOrEqual(100 * 1024);
  });
});

describe('single login', () => {
  it('dikeluarkan hanya bila server menjawab false tanpa galat', async () => {
    const { sesiDigantikan } = await import('../lib/akun');
    expect(sesiDigantikan({ data: false, error: null })).toBe(true);
    expect(sesiDigantikan({ data: true, error: null })).toBe(false);
    expect(sesiDigantikan({ data: null, error: null })).toBe(false);
    expect(sesiDigantikan({ data: false, error: { message: 'Failed to fetch' } })).toBe(false);
  });
  it('mengenali galat sesi tidak aktif dari RPC', async () => {
    const { galatSesiTidakAktif, PESAN_DIKELUARKAN } = await import('../lib/akun');
    expect(galatSesiTidakAktif({ message: 'sesi_tidak_aktif' })).toBe(true);
    expect(galatSesiTidakAktif({ message: 'room penuh' })).toBe(false);
    expect(galatSesiTidakAktif(null)).toBe(false);
    expect(PESAN_DIKELUARKAN).toContain('perangkat lain');
    expect(PESAN_DIKELUARKAN).not.toMatch(/\u2014/);
  });
});

describe('ganti username', () => {
  it('jeda 7 hari sejak terakhir diganti', async () => {
    const { bisaGantiLagi, pesanGantiUsername } = await import('../lib/akun');
    const t = Date.parse('2026-11-04T09:00:00Z');
    expect(bisaGantiLagi(null, t)).toBeNull();
    expect(bisaGantiLagi('2026-11-01T09:00:00Z', t)?.toISOString()).toBe('2026-11-08T09:00:00.000Z');
    expect(bisaGantiLagi('2026-10-28T08:59:00Z', t)).toBeNull();
    expect(pesanGantiUsername({ code: '23505' })).toBe('Username sudah dipakai.');
    expect(pesanGantiUsername({ code: 'xx' })).toContain('Gagal mengganti username');
  });
});

describe('pilihan peringkat', () => {
  it('bawaan jumlah menang dan keseluruhan; tersimpan dibaca; nilai aneh diabaikan', async () => {
    const isi = new Map<string, string>();
    const g = globalThis as unknown as { window?: unknown };
    g.window = { localStorage: { getItem: (k: string) => isi.get(k) ?? null, setItem: (k: string, v: string) => void isi.set(k, v), removeItem: (k: string) => void isi.delete(k) } };
    try {
      const { pilihanPeringkat } = await import('../lib/supabase/data');
      const { KUNCI, simpan } = await import('../lib/storage');
      expect(pilihanPeringkat()).toEqual({ urut: 'menang', peran: 'semua' });
      simpan(KUNCI.peringkatUrut, 'winrate');
      simpan(KUNCI.peringkatPeran, 'peramal');
      expect(pilihanPeringkat()).toEqual({ urut: 'winrate', peran: 'peramal' });
      simpan(KUNCI.peringkatPeran, 'raja');
      expect(pilihanPeringkat().peran).toBe('semua');
    } finally {
      delete g.window;
    }
  });
});
