'use client';

// Akun: login username + password (email sintetis @werewolf.local), profil, dan statistik per peran.
import type { Session } from '@supabase/supabase-js';
import { motion } from 'motion/react';
import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  DAFTAR_PERAN,
  PESAN_KONFIRMASI_EMAIL,
  cekPassword,
  cekUsername,
  emailDari,
  pesanGalatAuth,
  rapikanUsername,
  ringkasStatistik,
  type RingkasanStatistik,
} from '@/lib/akun';
import { NAMA_PERAN } from '@/lib/game';
import { supabase } from '@/lib/supabase/klien';
import { ambilRiwayat, ambilStatistik, type EntriRiwayat } from '@/lib/supabase/data';
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
}

const KonteksAkun = createContext<NilaiAkun>({ akun: null, memuat: true, keluar: async () => {} });

export const useAkun = () => useContext(KonteksAkun);

function akunDari(s: Session | null): Akun | null {
  if (!s?.user) return null;
  const u = (s.user.user_metadata?.username as string | undefined) ?? s.user.email?.split('@')[0] ?? 'pemain';
  return { id: s.user.id, username: u };
}

export function AkunProvider({ children }: { children: ReactNode }) {
  const [akun, setAkun] = useState<Akun | null>(null);
  const [memuat, setMemuat] = useState(true);
  useEffect(() => {
    const sb = supabase();
    let hidup = true;
    void sb.auth.getSession().then(({ data }) => {
      if (!hidup) return;
      setAkun(akunDari(data.session));
      setMemuat(false);
    });
    const { data } = sb.auth.onAuthStateChange((_e, s) => {
      setAkun(akunDari(s));
      setMemuat(false);
    });
    return () => {
      hidup = false;
      data.subscription.unsubscribe();
    };
  }, []);
  const keluar = async () => {
    await supabase().auth.signOut({ scope: 'local' });
    setAkun(null);
  };
  return <KonteksAkun.Provider value={{ akun, memuat, keluar }}>{children}</KonteksAkun.Provider>;
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
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: emailDari(username), password });
        if (error) setGalat(pesanGalatAuth(error));
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
      <p className="catatan">Username 3 sampai 20 karakter (huruf, angka, _). Tidak ada email; simpan password-mu baik-baik.</p>
    </Panel>
  );
}

export function LayarProfil() {
  const { akun, keluar } = useAkun();
  const [stat, setStat] = useState<RingkasanStatistik | null>(null);
  const [riwayat, setRiwayat] = useState<EntriRiwayat[]>([]);
  const [galat, setGalat] = useState<string | null>(null);
  useEffect(() => {
    if (!akun) return;
    let hidup = true;
    Promise.all([ambilStatistik(akun.id), ambilRiwayat()])
      .then(([s, r]) => {
        if (!hidup) return;
        setStat(ringkasStatistik(s));
        setRiwayat(r);
      })
      .catch(() => hidup && setGalat('Gagal memuat statistik. Periksa internet.'));
    return () => {
      hidup = false;
    };
  }, [akun]);
  if (!akun) return <LayarMasuk />;
  return (
    <div className="tumpuk">
      <Panel label="PROFIL" nomor="P/01">
        <TeksAcak as="h2" className="judul-pixel kecil" teks={akun.username.toUpperCase()} />
        <div className="angka-besar">
          <div><b>{stat?.main ?? '-'}</b><span>Main</span></div>
          <div><b>{stat?.menang ?? '-'}</b><span>Menang</span></div>
          <div><b>{stat?.persen != null ? `${stat.persen}%` : '-'}</b><span>Winrate</span></div>
        </div>
        {galat ? <p className="galat">{galat}</p> : null}
      </Panel>
      <Panel label="PER PERAN" nomor="P/02" jeda={0.06}>
        <ul className="stat-peran">
          {DAFTAR_PERAN.map((p) => (
            <li key={p} className={`peran-${p}`}>
              <IkonPeran peran={p} />
              <span>{NAMA_PERAN[p]}</span>
              <b>{stat ? `${stat.perPeran[p].menang}/${stat.perPeran[p].main}` : '-'}</b>
            </li>
          ))}
        </ul>
        <p className="catatan">Menang/main. Hanya permainan online yang dicatat.</p>
      </Panel>
      <Panel label="RIWAYAT" nomor="P/03" jeda={0.12}>
        {riwayat.length === 0 ? <p className="redup">Belum ada permainan online.</p> : (
          <ul className="riwayat">
            {riwayat.map((r) => (
              <li key={r.id}>
                <span>{NAMA_PERAN[r.peran]}</span>
                <b className={r.menang ? 'menang' : 'kalah'}>{r.menang ? 'Menang' : 'Kalah'}</b>
                <span className="redup">{new Date(r.waktu).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Tombol varian="garis" onClick={() => void keluar()}>Keluar dari akun</Tombol>
    </div>
  );
}
