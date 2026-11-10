'use client';

// Akun: login username + password (email sintetis @werewolf.local), single login, profil (foto, gelar musim,
// statistik, riwayat), profil pemain lain (read-only), cari pemain, ganti username dan password.
import type { Session } from '@supabase/supabase-js';
import { motion } from 'motion/react';
import { createContext, useCallback, useContext, useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import {
  DAFTAR_PERAN,
  EVENT_DIKELUARKAN,
  JEDA_CEK_SESI_MS,
  PESAN_DIKELUARKAN,
  PESAN_KONFIRMASI_EMAIL,
  bisaGantiLagi,
  cekPassword,
  cekUsername,
  emailDari,
  galatSesiTidakAktif,
  pesanGalatAuth,
  rapikanUsername,
  ringkasStatistik,
  sesiDigantikan,
  type RingkasanStatistik,
} from '@/lib/akun';
import { siapkanAvatar } from '@/lib/gambarAvatar';
import { NAMA_PERAN } from '@/lib/game';
import { META_KATEGORI, labelMusim } from '@/lib/peringkatMusim';
import { supabase } from '@/lib/supabase/klien';
import {
  ambilProfil,
  ambilProfilUsername,
  ambilRiwayat,
  ambilStatistik,
  ambilUsernameDiganti,
  cariProfil,
  gantiUsername,
  hapusAvatar,
  lupakanProfil,
  unggahAvatar,
  type EntriRiwayat,
  type ProfilPublik,
} from '@/lib/supabase/data';
import {
  ambilGelarPemain,
  cekNotifikasiTop3,
  gelarTeksDari,
  kodeMusim,
  pasangGelar,
  teksGelar,
  tulisCacheGelar,
  type GelarPemainApi,
  type SlotMusimApi,
} from '@/lib/supabase/peringkatMusim';
import { Avatar } from './Avatar';
import { IkonDeretan, TeksGelar } from './Gelar';
import { PEGAS, Panel, TeksAcak, Tombol } from './gerak';
import { IkonPeran } from './ui';

export interface Akun {
  id: string;
  username: string;
}

interface NilaiAkun {
  akun: Akun | null;
  memuat: boolean;
  keluar: () => Promise<void>;
  /** Perbarui username lokal setelah diganti. */
  ubahNama: (username: string) => void;
}

const KonteksAkun = createContext<NilaiAkun>({ akun: null, memuat: true, keluar: async () => {}, ubahNama: () => {} });
/** Buka profil pemain lain (read-only) berdasarkan username, dari mana saja (lobby, chat, peringkat, masukan). */
const KonteksLihat = createContext<(username: string) => void>(() => {});

export const useAkun = () => useContext(KonteksAkun);
export const useLihatProfil = () => useContext(KonteksLihat);

function akunDari(s: Session | null): Akun | null {
  if (!s?.user) return null;
  const u = (s.user.user_metadata?.username as string | undefined) ?? s.user.email?.split('@')[0] ?? 'pemain';
  return { id: s.user.id, username: u };
}

export function AkunProvider({ children }: { children: ReactNode }) {
  const [akun, setAkun] = useState<Akun | null>(null);
  const [memuat, setMemuat] = useState(true);
  const [pesanKeluar, setPesanKeluar] = useState<string | null>(null);
  const [lihat, setLihat] = useState<string | null>(null);
  useEffect(() => {
    const sb = supabase();
    let hidup = true;
    void sb.auth.getSession().then(
      ({ data }) => {
        if (!hidup) return;
        setAkun(akunDari(data.session));
        setMemuat(false);
      },
      () => hidup && setMemuat(false),
    );
    const { data } = sb.auth.onAuthStateChange((e, s) => {
      if (!hidup) return;
      setAkun(akunDari(s));
      setMemuat(false);
      if (e === 'SIGNED_IN') setPesanKeluar(null);
    });
    return () => {
      hidup = false;
      data.subscription.unsubscribe();
    };
  }, []);
  // Single login: cek berkala (saat halaman terlihat) dan saat fokus apakah sesi ini masih yang aktif.
  const idMasuk = akun?.id ?? null;
  useEffect(() => {
    if (!idMasuk) return;
    let hidup = true;
    let sedang = false;
    const cek = async () => {
      if (sedang || document.visibilityState !== 'visible') return;
      sedang = true;
      try {
        const sb = supabase();
        const hasil = await sb.rpc('cek_sesi_aktif');
        const ditolak = galatSesiTidakAktif(hasil.error as { message?: string } | null);
        if (!hidup || !(sesiDigantikan(hasil) || ditolak)) return;
        hidup = false;
        // Beri tahu layar online agar keluar room dengan rapi, lalu keluar lokal saja (sesi perangkat lain tetap).
        window.dispatchEvent(new CustomEvent(EVENT_DIKELUARKAN));
        setPesanKeluar(PESAN_DIKELUARKAN);
        await sb.auth.signOut({ scope: 'local' }).catch(() => undefined);
      } catch {
        // Gangguan jaringan: coba lagi di putaran berikutnya.
      } finally {
        sedang = false;
      }
    };
    void cek();
    const id = window.setInterval(() => void cek(), JEDA_CEK_SESI_MS);
    const saatTerlihat = () => void cek();
    window.addEventListener('focus', saatTerlihat);
    document.addEventListener('visibilitychange', saatTerlihat);
    return () => {
      hidup = false;
      window.clearInterval(id);
      window.removeEventListener('focus', saatTerlihat);
      document.removeEventListener('visibilitychange', saatTerlihat);
    };
  }, [idMasuk]);
  const keluar = useCallback(async () => {
    await supabase().auth.signOut({ scope: 'local' });
    setAkun(null);
  }, []);
  const ubahNama = useCallback((username: string) => setAkun((a) => (a ? { ...a, username } : a)), []);
  const tutup = useCallback(() => setLihat(null), []);
  return (
    <KonteksAkun.Provider value={{ akun, memuat, keluar, ubahNama }}>
      <KonteksLihat.Provider value={setLihat}>
        {children}
        {pesanKeluar ? (
          <div className="pita-keluar" role="alert" id="pesan-dikeluarkan">
            <span>{pesanKeluar}</span>
            <button type="button" className="kedua" onClick={() => setPesanKeluar(null)}>Oke</button>
          </div>
        ) : null}
        {lihat && akun ? (
          <div className="lapisan-profil" role="dialog" aria-modal="true" aria-label={`Profil ${lihat}`}>
            <div className="wadah-lapisan">
              <div className="kepala-lapisan">
                <span className="logo-kecil">PROFIL PEMAIN</span>
                <button type="button" className="kecil" onClick={tutup}>Tutup</button>
              </div>
              <IsiProfil key={lihat} akun={akun} usernameLihat={lihat} />
            </div>
          </div>
        ) : null}
      </KonteksLihat.Provider>
    </KonteksAkun.Provider>
  );
}

/** Bar kembali untuk layar menu (Peringkat, Masukan). */
export function Kepala({ onBeranda }: { onBeranda: () => void }) {
  return (
    <div className="kepala-lapisan">
      <button type="button" className="kecil" onClick={onBeranda}>Kembali</button>
    </div>
  );
}

/** Single login: login terbaru menang, sesi akun ini di perangkat lain dicabut. */
async function keluarkanPerangkatLain(): Promise<void> {
  try {
    await supabase().auth.signOut({ scope: 'others' });
  } catch {
    // Gagal mencabut tidak menghalangi login; server tetap menolak sesi lama bila sudah dicabut.
  }
}

/** Tampilkan isi hanya bila sudah login; selain itu layar Masuk/Daftar. */
export function GerbangAkun({ alasan, children }: { alasan: string; children: (akun: Akun) => ReactNode }) {
  const { akun, memuat } = useAkun();
  if (memuat) return <p className="catatan tengah-teks" role="status">Memuat akun...</p>;
  if (!akun) return <LayarMasuk alasan={alasan} />;
  return <>{children(akun)}</>;
}

export function LayarMasuk({ alasan }: { alasan?: string }) {
  const [mode, setMode] = useState<'masuk' | 'daftar'>('masuk');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [galat, setGalat] = useState<string | null>(null);
  const [proses, setProses] = useState(false);

  const kirim = async (e: FormEvent) => {
    e.preventDefault();
    const gu = cekUsername(username);
    const gp = cekPassword(password);
    if (gu || gp) {
      setGalat(gu ?? gp);
      return;
    }
    setProses(true);
    setGalat(null);
    const sb = supabase();
    try {
      if (mode === 'daftar') {
        const { data, error } = await sb.auth.signUp({
          email: emailDari(username),
          password,
          options: { data: { username: rapikanUsername(username) } },
        });
        if (error) setGalat(pesanGalatAuth(error));
        else if (!data.session) setGalat(PESAN_KONFIRMASI_EMAIL);
        else await keluarkanPerangkatLain();
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: emailDari(username), password });
        if (error) setGalat(pesanGalatAuth(error));
        else await keluarkanPerangkatLain();
      }
    } catch (err) {
      setGalat(pesanGalatAuth(err as { message?: string }));
    } finally {
      setProses(false);
    }
  };

  return (
    <Panel className="panel-masuk" label={mode === 'masuk' ? 'MASUK' : 'DAFTAR'} nomor="A/01">
      <TeksAcak as="h2" className="judul-pixel kecil" teks={mode === 'masuk' ? 'MASUK KE DESA' : 'BUAT AKUN'} />
      {alasan ? <p className="redup">{alasan}</p> : null}
      <div className="tab" role="tablist">
        {(['masuk', 'daftar'] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'aktif' : ''} onClick={() => { setMode(m); setGalat(null); }}>
            {mode === m ? <motion.span layoutId="tab-akun" className="tab-latar" transition={PEGAS} /> : null}
            <span>{m === 'masuk' ? 'Masuk' : 'Daftar'}</span>
          </button>
        ))}
      </div>
      <form className="form" onSubmit={kirim} noValidate>
        <label>
          <span>Username</span>
          <input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={20} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="huruf, angka, _" />
        </label>
        <label>
          <span>Password</span>
          <input name="password" type="password" autoComplete={mode === 'masuk' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="minimal 6 karakter" />
        </label>
        {galat ? (
          <motion.p className="galat" role="alert" initial={{ x: -8 }} animate={{ x: [8, -6, 4, 0] }} transition={{ duration: 0.35 }}>
            {galat}
          </motion.p>
        ) : null}
        <Tombol type="submit" besar disabled={proses}>
          {proses ? 'Memproses...' : mode === 'masuk' ? 'Masuk' : 'Daftar'}
        </Tombol>
      </form>
      <p className="catatan">Username 3 sampai 20 karakter (huruf, angka, _). Tidak ada email; simpan password-mu baik-baik. Satu akun hanya aktif di satu perangkat: login baru mengeluarkan perangkat lama.</p>
    </Panel>
  );
}

/* --------------------------------- Profil --------------------------------- */

const persenTeks = (p: number | null) => (p === null ? '-' : `${p}%`);

function KartuStatistik({ r }: { r: RingkasanStatistik }) {
  return (
    <>
      <Panel label="STATISTIK" nomor="P/02">
        <div className="angka-besar">
          <div><b>{r.main}</b><span>Main</span></div>
          <div><b>{r.menang}</b><span>Menang</span></div>
          <div><b>{persenTeks(r.persen)}</b><span>Winrate</span></div>
        </div>
      </Panel>
      <Panel label="PER PERAN" nomor="P/03" jeda={0.04}>
        <ul className="stat-peran">
          {DAFTAR_PERAN.map((p) => (
            <li key={p} className={`peran-${p}`}>
              <IkonPeran peran={p} />
              <span>{NAMA_PERAN[p]}</span>
              <b>{`${r.perPeran[p].menang}/${r.perPeran[p].main}`}</b>
            </li>
          ))}
        </ul>
        <p className="catatan">Menang/main. Hanya permainan online yang dicatat.</p>
      </Panel>
    </>
  );
}

function waktuTeks(iso: string): string {
  return `${new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} WIB`;
}

function Riwayat({ userId }: { userId: string }) {
  const [baris, setBaris] = useState<EntriRiwayat[]>([]);
  const [halaman, setHalaman] = useState(0);
  const [adaLagi, setAdaLagi] = useState(false);
  const [status, setStatus] = useState<'memuat' | 'siap' | 'galat'>('memuat');
  useEffect(() => {
    let hidup = true;
    ambilRiwayat(userId, halaman).then(
      (h) => {
        if (!hidup) return;
        setBaris((lama) => (halaman === 0 ? h.baris : [...lama, ...h.baris]));
        setAdaLagi(h.adaLagi);
        setStatus('siap');
      },
      () => hidup && setStatus('galat'),
    );
    return () => {
      hidup = false;
    };
  }, [userId, halaman]);
  return (
    <Panel label="RIWAYAT" nomor="P/04" jeda={0.08}>
      {status === 'siap' && baris.length === 0 ? <p className="redup">Belum ada permainan online.</p> : null}
      <ul className="daftar-riwayat">
        {baris.map((b) => (
          <li key={b.id}>
            <div>
              <strong className={b.menang ? 'teks-menang' : 'teks-kalah'}>{b.menang ? 'Menang' : 'Kalah'}</strong>
              <span> sebagai {NAMA_PERAN[b.peran]}</span>
            </div>
            <div className="catatan nol">{b.jumlah_pemain} pemain, {b.pemenang === 'werewolf' ? 'Werewolf' : 'Warga'} menang</div>
            <div className="catatan nol">{waktuTeks(b.waktu)}</div>
          </li>
        ))}
      </ul>
      {status === 'memuat' ? <p className="catatan">Memuat...</p> : null}
      {status === 'galat' ? <p className="galat">Gagal memuat riwayat.</p> : null}
      {adaLagi && status === 'siap' ? (
        <button type="button" className="kedua jarak-atas" onClick={() => { setStatus('memuat'); setHalaman((h) => h + 1); }}>Muat lagi</button>
      ) : null}
    </Panel>
  );
}

function tanggalTeks(d: Date): string {
  return `${d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })} WIB`;
}

/** Ganti username sendiri: sekali per 7 hari. Nama di room yang sedang berjalan tetap nama lama. */
function GantiUsername({ id, username, onGanti }: { id: string; username: string; onGanti: (baru: string) => void }) {
  const [buka, setBuka] = useState(false);
  const [baru, setBaru] = useState('');
  const [diganti, setDiganti] = useState<string | null | undefined>(undefined);
  const [pesan, setPesan] = useState<{ ok: boolean; teks: string } | null>(null);
  const [proses, setProses] = useState(false);
  useEffect(() => {
    let hidup = true;
    ambilUsernameDiganti(id).then((d) => hidup && setDiganti(d), () => hidup && setDiganti(null));
    return () => {
      hidup = false;
    };
  }, [id]);
  const lagi = bisaGantiLagi(diganti ?? null);
  async function simpan(e: FormEvent) {
    e.preventDefault();
    const nama = rapikanUsername(baru);
    const g = cekUsername(nama);
    if (g) return setPesan({ ok: false, teks: g });
    if (nama === username) return setPesan({ ok: false, teks: 'Username baru sama dengan yang sekarang.' });
    setProses(true);
    try {
      setDiganti(await gantiUsername(username, nama));
      setBaru('');
      setPesan({ ok: true, teks: `Username diganti menjadi ${nama}. Masuk berikutnya pakai nama ini.` });
      onGanti(nama);
    } catch (err) {
      setPesan({ ok: false, teks: err instanceof Error ? err.message : 'Gagal mengganti username.' });
    } finally {
      setProses(false);
    }
  }
  return (
    <Panel label="USERNAME" nomor="P/06">
      {lagi ? <p className="catatan" data-uji="ganti-lagi">Bisa diganti lagi pada {tanggalTeks(lagi)}.</p> : null}
      {!buka ? (
        <>
          {pesan ? <p className={pesan.ok ? 'catatan' : 'galat'} role="status">{pesan.teks}</p> : null}
          <button className="kedua" type="button" onClick={() => { setBuka(true); setPesan(null); }}>Ganti username</button>
        </>
      ) : (
        <form className="form" onSubmit={simpan} noValidate>
          <label>
            <span>Username baru</span>
            <input value={baru} maxLength={20} autoComplete="off" autoCapitalize="none" placeholder="3 sampai 20 karakter" onChange={(e) => setBaru(e.target.value)} />
          </label>
          <p className="catatan">Huruf, angka, atau underscore. Bisa diganti sekali tiap 7 hari. Statistik, riwayat, gelar, dan foto tetap. Di room yang sedang berjalan namamu tetap nama lama.</p>
          {pesan ? <p className={pesan.ok ? 'catatan' : 'galat'} role="status">{pesan.teks}</p> : null}
          <div className="baris-tombol">
            <button className="kedua" type="button" onClick={() => { setBuka(false); setPesan(pesan?.ok ? pesan : null); }}>Batal</button>
            <button className="utama" type="submit" disabled={proses}>Simpan</button>
          </div>
        </form>
      )}
    </Panel>
  );
}

function GantiPassword() {
  const [baru, setBaru] = useState('');
  const [pesan, setPesan] = useState<{ ok: boolean; teks: string } | null>(null);
  const [proses, setProses] = useState(false);
  async function simpan(e: FormEvent) {
    e.preventDefault();
    const g = cekPassword(baru);
    if (g) return setPesan({ ok: false, teks: g });
    setProses(true);
    const { error } = await supabase().auth.updateUser({ password: baru });
    setProses(false);
    setPesan(error ? { ok: false, teks: error.code === 'same_password' ? 'Password baru sama dengan yang lama.' : pesanGalatAuth(error) } : { ok: true, teks: 'Password diganti.' });
    if (!error) setBaru('');
  }
  return (
    <Panel label="PASSWORD" nomor="P/07">
      <form className="form" onSubmit={simpan} noValidate>
        <label>
          <span>Password baru</span>
          <input type="password" value={baru} autoComplete="new-password" placeholder="minimal 6 karakter" onChange={(e) => setBaru(e.target.value)} />
        </label>
        {pesan ? <p className={pesan.ok ? 'catatan' : 'galat'} role="status">{pesan.teks}</p> : null}
        <button className="kedua" type="submit" disabled={proses}>Simpan password</button>
      </form>
    </Panel>
  );
}

function FotoProfil({ id, username, versi, onGanti }: { id: string; username: string; versi: number | null; onGanti: (v: number | null) => void }) {
  const [proses, setProses] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  async function pilih(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setProses(true);
    setGalat(null);
    try {
      const blob = await siapkanAvatar(f);
      onGanti(await unggahAvatar(id, blob, versi));
      lupakanProfil(username);
    } catch (err) {
      setGalat(err instanceof Error && err.message.endsWith('.') ? err.message : 'Gagal mengunggah foto.');
    } finally {
      setProses(false);
    }
  }
  async function hapus() {
    setProses(true);
    setGalat(null);
    try {
      await hapusAvatar(id);
      lupakanProfil(username);
      onGanti(null);
    } catch {
      setGalat('Gagal menghapus foto.');
    } finally {
      setProses(false);
    }
  }
  return (
    <>
      <div className="baris-avatar">
        <label className={`kedua tombol-label${proses ? ' nonaktif' : ''}`}>
          {proses ? 'Memproses...' : versi ? 'Ganti foto' : 'Pasang foto'}
          <input type="file" accept="image/*" hidden disabled={proses} onChange={pilih} data-uji="unggah-foto" />
        </label>
        {versi ? <button className="kedua" type="button" disabled={proses} onClick={hapus}>Hapus foto</button> : null}
      </div>
      {galat ? <p className="galat" role="alert">{galat}</p> : null}
    </>
  );
}

function CariPemain() {
  const lihat = useLihatProfil();
  const [teks, setTeks] = useState('');
  const [hasil, setHasil] = useState<ProfilPublik[] | null>(null);
  const [galat, setGalat] = useState(false);
  async function cari(e: FormEvent) {
    e.preventDefault();
    setGalat(false);
    try {
      setHasil(await cariProfil(teks));
    } catch {
      setGalat(true);
    }
  }
  return (
    <Panel label="CARI PEMAIN" nomor="P/05">
      <form onSubmit={cari} role="search" className="tumpuk">
        <div className="baris-cari">
          <input className="isian" aria-label="Username" value={teks} maxLength={20} autoCapitalize="none" spellCheck={false} placeholder="Username" onChange={(e) => setTeks(e.target.value)} />
          <button className="kedua" type="submit" disabled={!teks.trim()}>Cari</button>
        </div>
        {galat ? <p className="galat">Gagal mencari. Periksa internet.</p> : null}
        {hasil && hasil.length === 0 ? <p className="catatan">Tidak ditemukan.</p> : null}
        {hasil && hasil.length > 0 ? (
          <ul className="daftar-cari">
            {hasil.map((p) => (
              <li key={p.id}>
                <button type="button" className="tautan nama-dengan-avatar" onClick={() => lihat(p.username)}>
                  <Avatar username={p.username} id={p.id} versi={p.avatar_versi} ukuran={28} cari />
                  <span className="nama-teks">{p.username}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </form>
    </Panel>
  );
}

type InfoTampilGelar = { teks: string; frame: SlotMusimApi | null; keterangan: string | null };

/** Gelar musim berjalan (bisa dipilih) + daftar award teks bulan lalu. Frame hanya dari slot musim ini. */
function KartuGelar({ userId, sendiri, onTampil }: { userId: string; sendiri: boolean; onTampil?: (info: InfoTampilGelar) => void }) {
  const [gelar, setGelar] = useState<GelarPemainApi | null | 'galat'>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  useEffect(() => {
    let hidup = true;
    ambilGelarPemain([userId]).then(
      ([g]) => {
        if (!hidup) return;
        setGelar(g ?? null);
        if (g) onTampil?.(gelarTeksDari(g));
        if (sendiri && g) {
          const n = cekNotifikasiTop3(g.slot);
          if (n) setPesan(n);
        }
      },
      () => {
        if (hidup) setGelar('galat');
      },
    );
    return () => {
      hidup = false;
    };
  }, [userId, sendiri, onTampil]);
  if (gelar === 'galat') return <p className="galat" role="alert">Gagal memuat gelar.</p>;
  if (!gelar) return <p className="catatan" role="status">Memuat gelar...</p>;
  const tampil = gelarTeksDari(gelar);
  const musim = gelar.musim || kodeMusim();
  function pasang(nilai: string | null) {
    if (!sendiri || gelar === 'galat' || !gelar) return;
    const sebelumnya = gelar;
    const berikutnya: GelarPemainApi = { ...gelar, gelar_dipasang: nilai };
    // Optimistic: frame/teks profil + cache room langsung ikut pilihan.
    setGelar(berikutnya);
    onTampil?.(gelarTeksDari(berikutnya));
    tulisCacheGelar(berikutnya);
    setPesan(null);
    void pasangGelar(nilai).then(
      () => setPesan(nilai ? 'Gelar dipasang.' : 'Gelar otomatis.'),
      (e: unknown) => {
        setGelar(sebelumnya);
        onTampil?.(gelarTeksDari(sebelumnya));
        tulisCacheGelar(sebelumnya);
        setPesan(e instanceof Error ? e.message : 'Gagal memasang gelar.');
      },
    );
  }
  const nilaiAktif = gelar.gelar_dipasang ?? 'otomatis';
  return (
    <Panel label="GELAR" nomor="P/01b">
      {tampil.teks ? (
        <p className="nol">
          <TeksGelar teks={tampil.teks} keterangan={tampil.keterangan} ikon={tampil.frame ? META_KATEGORI[tampil.frame.kategori].ikon : undefined} />{' '}
          <IkonDeretan slot={gelar.slot} />
        </p>
      ) : (
        <p className="catatan">Belum ada gelar musim {labelMusim(musim)}.</p>
      )}
      {pesan ? <p className="catatan" role="status">{pesan}</p> : null}
      {gelar.slot.length > 0 ? (
        <>
          <p className="catatan kecil-teks">Top 3 {labelMusim(musim)} (frame avatar hanya di musim ini)</p>
          {sendiri ? (
            <div className="pilih-gelar" role="radiogroup" aria-label="Pilih gelar musim">
              <label>
                <input type="radio" name="gelar" checked={nilaiAktif === 'otomatis' || !gelar.gelar_dipasang} onChange={() => pasang(null)} />
                Otomatis (peringkat terbaik)
              </label>
              {gelar.slot.map((s) => {
                const nilai = `musim:${musim}:${s.kategori}:${s.peringkat}`;
                return (
                  <label key={nilai}>
                    <input type="radio" name="gelar" checked={nilaiAktif === nilai} onChange={() => pasang(nilai)} />
                    {META_KATEGORI[s.kategori].ikon} {teksGelar({ kategori: s.kategori, peringkat: s.peringkat, musim })}
                  </label>
                );
              })}
            </div>
          ) : null}
        </>
      ) : null}
      {gelar.award.length > 0 ? (
        <>
          <h3 className="nol" style={{ marginTop: 12 }}>Award bulan lalu</h3>
          <p className="catatan kecil-teks">Hanya gelar teks di profil, tanpa frame.</p>
          <ul className="daftar-award">
            {gelar.award.map((a) => {
              const nilai = `award:${a.id}`;
              const teks = teksGelar({ kategori: a.kategori, peringkat: a.peringkat, musim: a.musim, sumber: 'award' });
              return (
                <li key={a.id}>
                  <span>{META_KATEGORI[a.kategori].ikon} {teks}</span>
                  {sendiri ? (
                    <button type="button" className={`kecil mini${nilaiAktif === nilai ? ' utama' : ' kedua'}`} onClick={() => pasang(nilaiAktif === nilai ? null : nilai)}>
                      {nilaiAktif === nilai ? 'Dipakai' : 'Pakai'}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </Panel>
  );
}

/** Profil sendiri (lengkap) atau pemain lain (read-only: foto, gelar, statistik, riwayat). */
function IsiProfil({ akun, usernameLihat }: { akun: Akun; usernameLihat?: string }) {
  const { keluar, ubahNama } = useAkun();
  const [data, setData] = useState<{ id: string; username: string; versi: number | null; r: RingkasanStatistik } | 'galat' | 'tidakAda' | null>(null);
  const [infoGelar, setInfoGelar] = useState<InfoTampilGelar | null>(null);
  const onTampilGelar = useCallback((info: InfoTampilGelar) => setInfoGelar(info), []);
  useEffect(() => {
    let hidup = true;
    (async () => {
      const p = usernameLihat ? await ambilProfilUsername(usernameLihat) : await ambilProfil(akun.id);
      if (!p) return null;
      return { id: p.id, username: p.username, versi: p.avatar_versi, r: ringkasStatistik(await ambilStatistik(p.id)) };
    })().then((d) => hidup && setData(d ?? 'tidakAda'), () => hidup && setData('galat'));
    return () => {
      hidup = false;
    };
  }, [akun.id, usernameLihat]);
  const siap = data && typeof data === 'object' ? data : null;
  const sendiri = !usernameLihat && (!siap || siap.id === akun.id);
  const nama = siap ? siap.username : usernameLihat ?? akun.username;
  return (
    <div className="tumpuk">
      <Panel label={sendiri ? 'PROFIL' : 'PEMAIN'} nomor="P/01">
        <div className="profil-kepala">
          <Avatar username={nama} id={siap?.id ?? 'memuat'} versi={siap?.versi} ukuran={88} slot={infoGelar?.frame} />
          <TeksAcak as="h2" className="judul-pixel kecil" teks={nama.toUpperCase()} />
          {infoGelar?.teks ? <TeksGelar teks={infoGelar.teks} keterangan={infoGelar.keterangan} /> : null}
          {siap && sendiri ? <FotoProfil id={siap.id} username={siap.username} versi={siap.versi} onGanti={(v) => setData({ ...siap, versi: v })} /> : null}
          {sendiri ? <p className="catatan nol">Foto dikecilkan otomatis (256 px, WebP) sebelum diunggah.</p> : null}
        </div>
        {data === 'galat' ? <p className="galat" role="alert">Gagal memuat profil. Periksa internet.</p> : null}
        {data === 'tidakAda' ? <p className="catatan tengah-teks">Pemain tidak ditemukan.</p> : null}
        {data === null ? <p className="catatan tengah-teks" role="status">Memuat...</p> : null}
      </Panel>
      {siap ? <KartuGelar userId={siap.id} sendiri={sendiri} onTampil={onTampilGelar} /> : null}
      {siap ? <KartuStatistik r={siap.r} /> : null}
      {siap ? <Riwayat userId={siap.id} /> : null}
      {sendiri ? <CariPemain /> : null}
      {siap && sendiri ? (
        <GantiUsername id={siap.id} username={siap.username} onGanti={(u) => { setData({ ...siap, username: u }); ubahNama(u); }} />
      ) : null}
      {sendiri ? <GantiPassword /> : null}
      {sendiri ? <Tombol varian="garis" onClick={() => void keluar()}>Keluar dari akun</Tombol> : null}
    </div>
  );
}

export function LayarProfil() {
  const { akun, memuat } = useAkun();
  if (memuat) return <p className="catatan tengah-teks" role="status">Memuat akun...</p>;
  if (!akun) return <LayarMasuk />;
  return <IsiProfil akun={akun} />;
}
