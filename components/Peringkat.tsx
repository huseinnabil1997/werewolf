'use client';

// Leaderboard Online: semua waktu + top 3 musim (bulan berjalan realtime, arsip award teks).
import { useEffect, useMemo, useState } from 'react';
import { persen } from '@/lib/akun';
import { KUNCI, simpan } from '@/lib/storage';
import { KATEGORI_MUSIM, META_KATEGORI, bolehFrame, kodeMusim, labelMusim, musimSebelumnya } from '@/lib/peringkatMusim';
import { ambilPeringkat, MIN_MAIN_WINRATE, PERAN_PERINGKAT as PERAN, pilihanPeringkat, URUT_PERINGKAT as URUT, type BarisPeringkat } from '@/lib/supabase/data';
import { ambilGelarPemain, ambilTopMusim, finalisasiMusim, gelarTeksDari, type BarisTopMusim, type KategoriMusim, type SlotMusimApi } from '@/lib/supabase/peringkatMusim';
import { Kepala, useLihatProfil } from './Akun';
import { Avatar } from './Avatar';

/** Kelas kotak baris = pola gelar in-game (warna + peringkat). */
function kelasKotakGelar(slot: SlotMusimApi | null | undefined): string {
  if (!slot) return '';
  const meta = META_KATEGORI[slot.kategori];
  return `gelar-${meta.warna} gelar-p${slot.peringkat}`;
}

type Mode = 'semua' | 'musim';

function daftarArsip(n = 6): string[] {
  const out: string[] = [];
  let m = musimSebelumnya(kodeMusim());
  for (let i = 0; i < n; i++) {
    out.push(m);
    m = musimSebelumnya(m);
  }
  return out;
}

/** Isi papan peringkat (tab semua/musim) untuk layar penuh atau overlay room. */
export function IsiPeringkat({ akun }: { akun: { id: string; username: string } }) {
  const [mode, setMode] = useState<Mode>('semua');
  return (
    <>
      <div className="kartu tab-musim" role="tablist" aria-label="Mode peringkat">
        <button type="button" className={`chip${mode === 'semua' ? ' pilih' : ''}`} role="tab" aria-selected={mode === 'semua'} onClick={() => setMode('semua')}>Semua waktu</button>
        <button type="button" className={`chip${mode === 'musim' ? ' pilih' : ''}`} role="tab" aria-selected={mode === 'musim'} onClick={() => setMode('musim')}>Musim</button>
      </div>
      {mode === 'semua' ? <PapanSemua akun={akun} /> : <PapanMusim akun={akun} />}
    </>
  );
}

export function LayarPeringkat({ akun, onBeranda }: { akun: { id: string; username: string }; onBeranda: () => void }) {
  return (
    <div className="tumpuk">
      <Kepala onBeranda={onBeranda} />
      <header className="judul-fase">
        <span className="chip">TOP 50</span>
        <h1 className="judul-pixel">PERINGKAT</h1>
      </header>
      <IsiPeringkat akun={akun} />
    </div>
  );
}

/** Overlay peringkat di dalam room: tutup tanpa keluar room / reset state. */
export function LapisanPeringkat({ akun, onTutup }: { akun: { id: string; username: string }; onTutup: () => void }) {
  return (
    <div className="lapisan-profil" role="dialog" aria-modal="true" aria-label="Papan peringkat">
      <div className="wadah-lapisan">
        <div className="kepala-lapisan">
          <span className="logo-kecil">PERINGKAT</span>
          <button type="button" className="kecil" onClick={onTutup} aria-label="Tutup peringkat">Tutup</button>
        </div>
        <IsiPeringkat akun={akun} />
      </div>
    </div>
  );
}

function PapanSemua({ akun }: { akun: { id: string } }) {
  const lihat = useLihatProfil();
  const [data, setData] = useState<BarisPeringkat[] | 'galat' | null>(null);
  const [muat, setMuat] = useState(0);
  const [pilih, setPilih] = useState(pilihanPeringkat);
  const [frame, setFrame] = useState<Map<string, SlotMusimApi | null>>(() => new Map());
  useEffect(() => {
    let hidup = true;
    ambilPeringkat(pilih.urut, pilih.peran).then((d) => hidup && setData(d), () => hidup && setData('galat'));
    return () => { hidup = false; };
  }, [muat, pilih]);
  useEffect(() => {
    if (!Array.isArray(data) || data.length === 0) return;
    let hidup = true;
    ambilGelarPemain(data.map((r) => r.id)).then(
      (list) => {
        if (!hidup) return;
        const m = new Map<string, SlotMusimApi | null>();
        for (const g of list) m.set(g.user_id, gelarTeksDari(g).frame);
        setFrame(m);
      },
      () => { if (hidup) setFrame(new Map()); },
    );
    return () => { hidup = false; };
  }, [data]);
  const ubah = (p: Partial<typeof pilih>) => {
    const n = { ...pilih, ...p };
    simpan(KUNCI.peringkatUrut, n.urut);
    simpan(KUNCI.peringkatPeran, n.peran);
    setFrame(new Map());
    setData(null);
    setPilih(n);
  };
  const namaPeran = PERAN.find((x) => x.id === pilih.peran)!.nama;
  return (
    <>
      <div className="kartu">
        <span className="label">Urutkan</span>
        <div className="chip-grup" role="group" aria-label="Urutkan">
          {URUT.map((x) => <button key={x.id} type="button" className={`chip${pilih.urut === x.id ? ' pilih' : ''}`} aria-pressed={pilih.urut === x.id} onClick={() => ubah({ urut: x.id })}>{x.nama}</button>)}
        </div>
        <span className="label">Peran</span>
        <div className="chip-grup" role="group" aria-label="Peran">
          {PERAN.map((x) => <button key={x.id} type="button" className={`chip${pilih.peran === x.id ? ' pilih' : ''}`} aria-pressed={pilih.peran === x.id} onClick={() => ubah({ peran: x.id })}>{x.nama}</button>)}
        </div>
      </div>
      <p className="catatan tengah-teks nol">
        {pilih.urut === 'menang'
          ? `50 pemain dengan kemenangan Online terbanyak (${namaPeran}). Seri: main lebih sedikit di atas.`
          : `50 pemain dengan winrate Online tertinggi (${namaPeran}), minimal ${MIN_MAIN_WINRATE} kali main. Seri: menang lebih banyak di atas.`}
      </p>
      {data === null && <p className="catatan tengah-teks" role="status">Memuat...</p>}
      {data === 'galat' && (
        <>
          <p className="galat" role="alert">Gagal memuat peringkat. Periksa internet.</p>
          <button className="kedua" onClick={() => { setData(null); setMuat((n) => n + 1); }}>Coba lagi</button>
        </>
      )}
      {Array.isArray(data) && data.length === 0 && <p className="catatan tengah-teks">{pilih.urut === 'winrate' ? `Belum ada pemain dengan minimal ${MIN_MAIN_WINRATE} kali main.` : 'Belum ada permainan tercatat.'}</p>}
      {Array.isArray(data) && data.length > 0 && (
        <ol className="kartu daftar-peringkat">
          {data.map((r, i) => {
            const slot = frame.get(r.id) ?? null;
            const kotak = kelasKotakGelar(slot);
            return (
            <li key={r.id} className={[r.id === akun.id ? 'sendiri' : '', kotak].filter(Boolean).join(' ') || undefined}>
              <span className="nomor">{i + 1}</span>
              <button type="button" className="tautan nama-dengan-avatar" aria-label={`Lihat profil ${r.username}`} onClick={() => lihat(r.username)}>
                <Avatar username={r.username} id={r.id} versi={r.avatar_versi} ukuran={32} slot={slot} />
                <span className="nama-peringkat nama-teks">{r.username}</span>{r.id === akun.id && <em className="label-kamu">(kamu)</em>}
              </button>
              {pilih.urut === 'winrate'
                ? <span className="angka-peringkat"><strong>{persen(r.menang, r.main) ?? 0}%</strong><br /><small>{r.menang} menang, {r.main} main</small></span>
                : <span className="angka-peringkat"><strong>{r.menang}</strong> menang<br /><small>{r.main} main, {persen(r.menang, r.main) ?? 0}%</small></span>}
            </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

function PapanMusim({ akun }: { akun: { id: string } }) {
  const lihat = useLihatProfil();
  const sekarang = kodeMusim();
  const arsip = useMemo(() => daftarArsip(6), []);
  const [musim, setMusim] = useState(sekarang);
  const [kat, setKat] = useState<KategoriMusim>('keseluruhan');
  const [data, setData] = useState<BarisTopMusim[] | 'galat' | null>(null);
  const [muat, setMuat] = useState(0);
  const pakaiFrame = bolehFrame(musim);
  useEffect(() => {
    let hidup = true;
    (async () => {
      if (musim !== sekarang) await finalisasiMusim(musim).catch(() => 0);
      return ambilTopMusim(musim);
    })().then((d) => hidup && setData(d), () => hidup && setData('galat'));
    return () => { hidup = false; };
  }, [musim, muat, sekarang]);
  const baris = Array.isArray(data) ? data.filter((b) => b.kategori === kat) : [];
  return (
    <>
      <div className="kartu">
        <span className="label">Bulan</span>
        <div className="chip-grup" role="group" aria-label="Bulan musim">
          <button type="button" className={`chip${musim === sekarang ? ' pilih' : ''}`} aria-pressed={musim === sekarang} onClick={() => { setData(null); setMusim(sekarang); }}>{labelMusim(sekarang)} (berjalan)</button>
          {arsip.map((m) => (
            <button key={m} type="button" className={`chip${musim === m ? ' pilih' : ''}`} aria-pressed={musim === m} onClick={() => { setData(null); setMusim(m); }}>{labelMusim(m)}</button>
          ))}
        </div>
        <span className="label">Kategori</span>
        <div className="chip-grup" role="group" aria-label="Kategori musim">
          {KATEGORI_MUSIM.map((k) => (
            <button key={k} type="button" className={`chip${kat === k ? ' pilih' : ''}`} aria-pressed={kat === k} onClick={() => setKat(k)}>
              {META_KATEGORI[k].ikon} {META_KATEGORI[k].labelSingkat}
            </button>
          ))}
        </div>
      </div>
      <p className="catatan tengah-teks nol">
        {pakaiFrame
          ? `Top 3 ${META_KATEGORI[kat].nama} bulan ${labelMusim(musim)}. Frame avatar aktif di room selama musim berjalan.`
          : `Top 3 ${META_KATEGORI[kat].nama} ${labelMusim(musim)} (arsip). Award teks permanen, tanpa frame.`}
      </p>
      {data === null && <p className="catatan tengah-teks" role="status">Memuat...</p>}
      {data === 'galat' && (
        <>
          <p className="galat" role="alert">Gagal memuat peringkat musim. Periksa internet.</p>
          <button className="kedua" onClick={() => { setData(null); setMuat((n) => n + 1); }}>Coba lagi</button>
        </>
      )}
      {Array.isArray(data) && baris.length === 0 && <p className="catatan tengah-teks">Belum ada top 3 untuk kategori ini.</p>}
      {baris.length > 0 && (
        <ol className="kartu daftar-peringkat">
          {baris.map((r) => {
            const slot = pakaiFrame
              ? { kategori: r.kategori, peringkat: r.peringkat, main: r.main, menang: r.menang, metrik: r.metrik } satisfies SlotMusimApi
              : null;
            const kotak = kelasKotakGelar(slot);
            return (
            <li key={`${r.kategori}-${r.peringkat}-${r.user_id}`} className={[r.user_id === akun.id ? 'sendiri' : '', kotak].filter(Boolean).join(' ') || undefined}>
              <span className="nomor">{r.peringkat}</span>
              <button type="button" className="tautan nama-dengan-avatar" aria-label={`Lihat profil ${r.username}`} onClick={() => lihat(r.username)}>
                <Avatar
                  username={r.username}
                  id={r.user_id}
                  versi={r.avatar_versi}
                  ukuran={32}
                  slot={slot}
                />
                <span className="nama-peringkat nama-teks">{r.username}</span>
                {r.user_id === akun.id && <em className="label-kamu">(kamu)</em>}
              </button>
              <span className="angka-peringkat">
                <strong>{r.kategori === 'winrate' ? `${Math.round(Number(r.metrik) * 100)}%` : r.kategori === 'main' ? r.main : r.menang}</strong>
                <br />
                <small>{r.menang} menang, {r.main} main</small>
              </span>
            </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
