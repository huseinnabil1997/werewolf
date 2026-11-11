'use client';

// Mode Online: tiap pemain di HP sendiri. Host menjalankan aturan game; pemain hanya menerima view publik dan
// view pribadinya sendiri (lihat lib/online/protokol.ts dan lib/online/jaringan.ts). Bila host pergi, pemain lain
// mengambil alih otomatis dari snapshot terenkripsi. Matchmaking, room publik, chat room, dan batas waktu opsional.
import { motion } from 'motion/react';
import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EVENT_DIKELUARKAN, PESAN_DIKELUARKAN } from '@/lib/akun';
import { LABEL_BATAS, PILIHAN_BATAS, bacaBatasTersimpan, teksDetik, type BatasWaktu } from '@/lib/batasWaktu';
import { LEWATI, MIN_PEMAIN, NAMA_PERAN, cekKomposisi } from '@/lib/game';
import { DETAK_MATCH_MS, MIN_MULAI_MATCH, alasanMulaiOtomatis, formatTunggu, sisaHitungMundur, type StatusMatch } from '@/lib/online/antrean';
import { gelarNama, usePetaGelar, type InfoGelar } from '@/lib/online/gelarRoom';
import { HostRoom, PemainRoom, bacaSesi, simpanSesi, type Jalur, type OpsiHost, type Pendengar, type StatusSambung } from '@/lib/online/jaringan';
import { pesanMacet, sudahMacet } from '@/lib/online/macet';
import { buatKode, rapikanKode, type AksiHost, type AksiPemain, type StateHost, type ViewPribadi, type ViewPublik } from '@/lib/online/protokol';
import { META_KATEGORI } from '@/lib/peringkatMusim';
import { KUNCI, baca, simpan } from '@/lib/storage';
import { detakMatch, keluarMatch, keluarMatchSaatTutup, mulaiMatch } from '@/lib/supabase/antrean';
import { pesanGalatRoom } from '@/lib/supabase/room';
import { tutupNotifikasiGiliran, umpan } from '@/lib/umpan/mesin';
import { kunciGiliran, peristiwaOnline, pilihUtama, type ViewPemain } from '@/lib/umpan/peristiwa';
import { LayarMasuk, useAkun, useLihatProfil } from './Akun';
import { KartuCariMatch, KartuDaftarRoom, LayarAntrean } from './Antrean';
import { Avatar } from './Avatar';
import { ChatRoom } from './ChatRoom';
import { TeksGelar } from './Gelar';
import { Layar, PEGAS, Panel, TeksAcak, Tombol } from './gerak';
import { Hitungan } from './Hitungan';
import { PengaturKomposisi } from './LokalGame';
import { useDialog } from './Modal';
import { LapisanPeringkat } from './Peringkat';
import { Catatan, DaftarPeranAkhir, JudulFase, KartuPeran, PilihPemain, RingkasVoting, SpandukPemenang, pesanVoting, type Suasana } from './ui';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const PESAN_KICK = 'Kamu dikeluarkan dari room oleh host.';

export function suasanaOnline(v: ViewPublik | null): Suasana {
  const f = v?.game?.fase;
  if (!f) return 'senja';
  if (f === 'malam' || f === 'peran') return 'malam';
  if (f === 'selesai') return v?.game?.pemenang === 'werewolf' ? 'malam' : 'pagi';
  return 'pagi';
}

export default function OnlineGame({ kodeAwal, onSuasana, onKeluar }: { kodeAwal: string | null; onSuasana: (s: Suasana) => void; onKeluar: () => void }) {
  const { akun, memuat } = useAkun();
  if (memuat) return <p className="muat">Memeriksa akun...</p>;
  if (!akun) return <LayarMasuk alasan="Main online butuh akun supaya hanya pemain room yang bisa masuk dan statistikmu tercatat." />;
  return <Ruang key={akun.id} uid={akun.id} nama={akun.username} kodeAwal={kodeAwal} onSuasana={onSuasana} onKeluar={onKeluar} />;
}

type Koneksi = { jenis: 'host'; h: HostRoom } | { jenis: 'pemain'; p: PemainRoom };
type InfoMatchLokal = { s: StatusMatch; t: number };

function aturUrl(kode: string | null): void {
  const url = new URL(window.location.href);
  if (kode) url.searchParams.set('room', kode);
  else url.searchParams.delete('room');
  window.history.replaceState(window.history.state, '', url);
}

const tunggu = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Ruang({ uid, nama, kodeAwal, onSuasana, onKeluar }: { uid: string; nama: string; kodeAwal: string | null; onSuasana: (s: Suasana) => void; onKeluar: () => void }) {
  const dialog = useDialog();
  const [kon, setKon] = useState<Koneksi | null>(null);
  const [pub, setPub] = useState<ViewPublik | null>(null);
  const [terimaPub, setTerimaPub] = useState(0);
  const [pri, setPri] = useState<ViewPribadi | null>(null);
  const [status, setStatus] = useState<{ s: StatusSambung; sejak: number }>({ s: 'menyambung', sejak: 0 });
  const [jalur, setJalur] = useState<Jalur>('realtime');
  const [galat, setGalat] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [proses, setProses] = useState(false);
  const [kodeKetik, setKodeKetik] = useState(kodeAwal ?? '');
  const [publikBaru, setPublikBaru] = useState(() => baca<boolean>(KUNCI.publikRoom, false) === true);
  const [antrean, setAntrean] = useState<{ ukuran: number | null } | null>(null);
  const [infoMatch, setInfoMatch] = useState<InfoMatchLokal | null>(null);
  const [sekarang, setSekarang] = useState(() => Date.now());
  const [teksChat, setTeksChat] = useState('');
  const [galatChat, setGalatChat] = useState<string | null>(null);
  const [lihatPeringkat, setLihatPeringkat] = useState(false);
  const konRef = useRef<Koneksi | null>(null);
  const terhubung = useRef(false);
  const kodeRef = useRef<string | null>(null);
  const matchAktif = useRef(false);
  // Fungsi pindah peran (host <-> pemain) dipanggil dari kelas jaringan; disimpan di ref agar selalu terbaru.
  const jadiHostRef = useRef<(s: StateHost) => void>(() => {});
  const jadiPemainRef = useRef<() => void>(() => {});

  useEffect(() => onSuasana(suasanaOnline(pub)), [pub, onSuasana]);
  useEffect(() => {
    const t = setInterval(() => setSekarang(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => () => {
    const k = konRef.current;
    if (k?.jenis === 'host') k.h.hentikan();
    if (k?.jenis === 'pemain') k.p.hentikan();
  }, []);

  const dengar = useCallback((): Pendengar => ({
    publik: (v) => {
      setPub(v);
      setTerimaPub(Date.now());
    },
    pribadi: setPri,
    status: (s) => setStatus((lama) => (lama.s === s && lama.sejak ? lama : { s, sejak: Date.now() })),
    jalur: setJalur,
    jadiHost: (s) => jadiHostRef.current(s),
    jadiPemain: () => jadiPemainRef.current(),
  }), []);

  const pakai = useCallback((k: Koneksi | null) => {
    konRef.current = k;
    setKon(k);
    if (k) {
      kodeRef.current = k.jenis === 'host' ? k.h.kode : k.p.kode;
      aturUrl(kodeRef.current);
    }
  }, []);

  const sambungHost = useCallback(async (kode: string, opsi: OpsiHost = {}): Promise<'ok' | 'dipakai'> => {
    const h = new HostRoom(kode, uid, nama, dengar(), opsi);
    const r = await h.mulai();
    if (r === 'dipakai') {
      h.hentikan();
      return r;
    }
    setJalur('realtime');
    pakai({ jenis: 'host', h });
    return 'ok';
  }, [uid, nama, dengar, pakai]);

  const sambungPemain = useCallback(async (kode: string): Promise<'ok' | 'tidak_ada'> => {
    const p = new PemainRoom(kode, uid, dengar());
    const r = await p.mulai();
    if (r === 'tidak_ada') {
      p.hentikan();
      return r;
    }
    pakai({ jenis: 'pemain', p });
    return 'ok';
  }, [uid, dengar, pakai]);

  useEffect(() => {
    jadiHostRef.current = (s: StateHost) => {
      void (async () => {
        const r = await sambungHost(s.kode, { state: s }).catch(() => 'galat' as const);
        if (r === 'ok') setInfo('Host sebelumnya pergi. HP-mu sekarang menjadi host dan permainan berlanjut.');
        else await sambungPemain(s.kode).catch(() => undefined);
      })();
    };
    jadiPemainRef.current = () => {
      const kode = kodeRef.current;
      if (!kode) return;
      setInfo('Pemain lain sudah mengambil alih peran host. Kamu lanjut sebagai pemain.');
      void sambungPemain(kode).catch(() => undefined);
    };
  }, [sambungHost, sambungPemain]);

  const bersihkan = useCallback((pesan: string | null) => {
    const k = konRef.current;
    if (k?.jenis === 'host') k.h.hentikan();
    if (k?.jenis === 'pemain') k.p.hentikan();
    simpanSesi(null);
    if (matchAktif.current) void keluarMatch().catch(() => undefined);
    matchAktif.current = false;
    konRef.current = null;
    kodeRef.current = null;
    setKon(null);
    setPub(null);
    setPri(null);
    setInfoMatch(null);
    setStatus({ s: 'menyambung', sejak: 0 });
    setGalat(pesan);
    setInfo(null);
    aturUrl(null);
  }, []);

  const masuk = useCallback(async (kode: string, host: boolean, opsi: OpsiHost = {}) => {
    setProses(true);
    setGalat(null);
    setInfo(null);
    setStatus({ s: 'menyambung', sejak: Date.now() });
    try {
      if (host) {
        const r = await sambungHost(kode, opsi);
        // Room sudah dipegang host lain (mis. host pindah saat HP ini mati): gabung sebagai pemain.
        if (r === 'dipakai' && (await sambungPemain(kode)) === 'tidak_ada') {
          simpanSesi(null);
          setGalat('Room tidak ditemukan atau sudah ditutup.');
        }
      } else if ((await sambungPemain(kode)) === 'tidak_ada') {
        simpanSesi(null);
        setGalat('Room tidak ditemukan atau sudah ditutup.');
      }
    } catch (e) {
      setGalat(pesanGalatRoom(e));
    } finally {
      setProses(false);
    }
  }, [sambungHost, sambungPemain]);

  const buatBaru = useCallback(async () => {
    setProses(true);
    setGalat(null);
    try {
      for (let i = 0; i < 3; i++) {
        const r = await sambungHost(buatKode(), { batas: bacaBatasTersimpan(), publik: publikBaru });
        if (r === 'ok') return;
      }
      setGalat('Kode room bentrok. Coba lagi.');
    } catch (e) {
      setGalat(pesanGalatRoom(e));
    } finally {
      setProses(false);
    }
  }, [sambungHost, publikBaru]);

  // Pulihkan sesi setelah refresh, atau langsung gabung dari link ?room=.
  useEffect(() => {
    if (terhubung.current) return;
    terhubung.current = true;
    const sesi = bacaSesi();
    const t = setTimeout(() => {
      if (sesi && (!kodeAwal || sesi.kode === kodeAwal)) void masuk(sesi.kode, sesi.host);
      else if (kodeAwal) void masuk(kodeAwal, false);
    }, 0);
    return () => clearTimeout(t);
  }, [kodeAwal, masuk]);

  // Single login: akun masuk di perangkat lain. Tutup koneksi tanpa RPC (sesi ini sudah dicabut).
  useEffect(() => {
    const h = () => bersihkan(PESAN_DIKELUARKAN);
    window.addEventListener(EVENT_DIKELUARKAN, h);
    return () => window.removeEventListener(EVENT_DIKELUARKAN, h);
  }, [bersihkan]);

  // Dikeluarkan host.
  const dikick = !!pri?.dikeluarkan;
  useEffect(() => {
    if (!dikick) return;
    const k = konRef.current;
    if (k?.jenis === 'pemain') void k.p.keluar().catch(() => undefined);
    const t = setTimeout(() => bersihkan(PESAN_KICK), 0);
    return () => clearTimeout(t);
  }, [dikick, bersihkan]);

  // Umpan balik: suara/getar/notifikasi dari perubahan view. Notifikasi HP hanya untuk giliranmu.
  const viewLalu = useRef<ViewPemain | null>(null);
  const chatLalu = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!pub) {
      viewLalu.current = null;
      chatLalu.current = undefined;
      return;
    }
    const v: ViewPemain = { saya: uid, pub, pri };
    const p = pilihUtama(peristiwaOnline(viewLalu.current, v));
    viewLalu.current = v;
    if (p) umpan(p);
    if (!kunciGiliran(v)) void tutupNotifikasiGiliran();
    const akhir = pub.chat.at(-1);
    if (akhir && chatLalu.current !== undefined && akhir.id !== chatLalu.current && akhir.dari !== uid) umpan('chat');
    chatLalu.current = akhir?.id ?? '';
  }, [pub, pri, uid]);

  // Room match: detak kursi ke server (jumlah/maks dan lama tanpa pemain baru), lepas kursi saat halaman ditutup.
  const kodeMatch = pub?.match ? pub.kode : null;
  useEffect(() => {
    if (!kodeMatch) return;
    matchAktif.current = true;
    let hidup = true;
    const detak = () =>
      void detakMatch()
        .then((s) => {
          if (hidup) setInfoMatch(s && s.kode === kodeMatch ? { s, t: Date.now() } : null);
        })
        .catch(() => undefined);
    detak();
    const id = window.setInterval(detak, DETAK_MATCH_MS);
    const tutup = () => void keluarMatchSaatTutup();
    window.addEventListener('pagehide', tutup);
    return () => {
      hidup = false;
      window.clearInterval(id);
      window.removeEventListener('pagehide', tutup);
    };
  }, [kodeMatch]);

  const host = kon?.jenis === 'host';
  const perintah = useCallback((a: AksiHost): string | null => {
    const k = konRef.current;
    if (k?.jenis !== 'host') return 'Hanya host yang bisa melakukan ini.';
    const g = k.h.aksiHost(a);
    setGalat(g);
    if (!g && (a.jenis === 'mulai' || a.jenis === 'main_lagi') && k.h.state.match) void mulaiMatch().catch(() => undefined);
    return g;
  }, []);

  // Host room match mulai otomatis: saat room penuh, atau minimal 4 pemain dan 60 detik tanpa pemain baru.
  const mulaiOtomatis = useRef<string | null>(null);
  const lobbyMatch = host && !!pub?.match && !pub.game && !!kodeMatch;
  const onlineLobby = pub && !pub.game ? pub.pemain.filter((p) => p.online).length : 0;
  useEffect(() => {
    if (!lobbyMatch || !kodeMatch || mulaiOtomatis.current === kodeMatch) return;
    const cek = () => {
      if (mulaiOtomatis.current === kodeMatch || !infoMatch || infoMatch.s.dimulai || !pub?.match) return;
      const diam = infoMatch.s.diamMs + (Date.now() - infoMatch.t);
      if (!alasanMulaiOtomatis(onlineLobby, pub.match.maks, diam, pub.match.acak)) return;
      mulaiOtomatis.current = kodeMatch;
      perintah({ jenis: 'mulai', peserta: pub.pemain.filter((p) => p.online).map((p) => p.id) });
    };
    const id = window.setInterval(cek, 1500);
    return () => window.clearInterval(id);
  }, [lobbyMatch, kodeMatch, infoMatch, onlineLobby, pub, perintah]);

  /** Keluar room dengan rapi. `keBeranda`: langsung ke beranda; `tanpaKonfirmasi`: pemain biasa setelah permainan selesai. */
  const keluar = async ({ keBeranda = false, tanpaKonfirmasi = false } = {}) => {
    const k = konRef.current;
    if (k && !(tanpaKonfirmasi && k.jenis === 'pemain')) {
      const ya = await dialog.konfirmasi(
        k.jenis === 'host'
          ? { judul: 'Keluar dari room?', pesan: 'Peran host pindah otomatis ke pemain lain dan permainan tetap berjalan.', ok: 'Keluar', bahaya: true }
          : { judul: 'Keluar dari room?', pesan: 'Kamu bisa gabung lagi dengan kode yang sama selama room masih dibuka.', ok: 'Keluar', bahaya: true },
      );
      if (!ya) return;
    }
    if (k?.jenis === 'host') await k.h.keluar();
    else if (k) await k.p.keluar();
    bersihkan(null);
    if (keBeranda) onKeluar();
  };

  const cobaLagi = () => {
    const k = konRef.current;
    const kode = kodeRef.current;
    if (!kode) return;
    const hostDulu = k?.jenis === 'host';
    if (k?.jenis === 'host') k.h.hentikan();
    if (k?.jenis === 'pemain') k.p.hentikan();
    konRef.current = null;
    setKon(null);
    setPub(null);
    setPri(null);
    void masuk(kode, hostDulu);
  };

  const cocok = useCallback(async (s: StatusMatch) => {
    setAntrean(null);
    matchAktif.current = true;
    setProses(true);
    setGalat(null);
    setStatus({ s: 'menyambung', sejak: Date.now() });
    try {
      if (s.host) {
        const r = await sambungHost(s.kode, { match: { maks: s.maks, acak: s.acak }, publik: true, batas: bacaBatasTersimpan() });
        if (r === 'ok') return;
      }
      // Host room match mungkin baru membuat room: coba beberapa kali.
      for (let i = 0; i < 8; i++) {
        if ((await sambungPemain(s.kode)) === 'ok') return;
        await tunggu(1500);
      }
      void keluarMatch().catch(() => undefined);
      matchAktif.current = false;
      setGalat('Room match tidak bisa dibuka. Coba cari lagi.');
    } catch (e) {
      setGalat(pesanGalatRoom(e));
    } finally {
      setProses(false);
    }
  }, [sambungHost, sambungPemain]);

  const kirimChat = useCallback((teks: string): boolean => {
    const k = konRef.current;
    if (!k) {
      setGalatChat('Belum tersambung ke host.');
      return false;
    }
    if (k.jenis === 'host') {
      const g = k.h.aksiSendiri({ jenis: 'chat_room', teks });
      setGalatChat(g);
      return !g;
    }
    k.p.kirim({ jenis: 'chat_room', teks });
    setGalatChat(null);
    return true;
  }, []);
  // Penolakan chat dari host datang lewat view pribadi.
  const galatPri = pri?.galat ?? null;

  if (antrean) {
    return (
      <LayarAntrean
        ukuran={antrean.ukuran}
        onCocok={(s) => void cocok(s)}
        onBatal={(g) => {
          void keluarMatch().catch(() => undefined);
          setAntrean(null);
          setGalat(g ?? null);
        }}
      />
    );
  }

  if (!kon) {
    return (
      <div className="tumpuk">
        <JudulFase kecil="MODE ONLINE" judul="MASUK ROOM" sub={`Masuk sebagai ${nama}. Tiap pemain memakai HP sendiri.`} />
        {galat ? <p className="galat" role="alert">{galat}</p> : null}
        <Panel label="BUAT" nomor="O/01">
          <p className="redup nol">Jadi host: HP-mu menjalankan permainan. Bila kamu pergi, pemain lain mengambil alih otomatis.</p>
          <div className="segmen" role="group" aria-label="Tampil di daftar room">
            <button type="button" aria-pressed={!publikBaru} onClick={() => { setPublikBaru(false); simpan(KUNCI.publikRoom, false); }}>Privat</button>
            <button type="button" aria-pressed={publikBaru} onClick={() => { setPublikBaru(true); simpan(KUNCI.publikRoom, true); }}>Publik</button>
          </div>
          <p className="catatan">{publikBaru ? 'Publik: room tampil di daftar Room aktif, siapa pun yang login bisa masuk.' : 'Privat: hanya yang tahu kode, link, atau QR yang bisa masuk.'}</p>
          <Tombol id="buat-room" besar disabled={proses} onClick={() => void buatBaru()}>Buat room</Tombol>
        </Panel>
        <Panel label="GABUNG" nomor="O/02" jeda={0.04}>
          <form className="form baris" onSubmit={(e) => { e.preventDefault(); const k = rapikanKode(kodeKetik); if (k) void masuk(k, false); else setGalat('Kode room 5 huruf.'); }}>
            <input aria-label="Kode room" className="input-kode" value={kodeKetik} maxLength={5} autoCapitalize="characters" placeholder="KODE" onChange={(e) => setKodeKetik(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
            <Tombol type="submit" disabled={proses || kodeKetik.length !== 5}>Gabung</Tombol>
          </form>
        </Panel>
        <KartuCariMatch onCari={(ukuran) => { setGalat(null); setAntrean({ ukuran }); }} />
        <KartuDaftarRoom nonaktif={proses} onGabung={(k) => void masuk(k, false)} />
        {proses ? <p className="redup" role="status">Menyambung...</p> : null}
        <Tombol varian="hantu" onClick={onKeluar}>Kembali</Tombol>
      </div>
    );
  }

  const kode = kon.jenis === 'host' ? kon.h.kode : kon.p.kode;
  const kirim = (a: AksiPemain) => {
    const k = konRef.current;
    if (k?.jenis === 'host') {
      const g = k.h.aksiSendiri(a);
      if (g) setGalat(g);
    } else k?.p.kirim(a);
  };
  const macet = sudahMacet(status.s, !!pub, status.sejak, sekarang);
  const sisaMs = pub?.sisaMs != null ? pub.sisaMs : null;
  const g = pub?.game ?? null;

  return (
    <div className="tumpuk ruang-online">
      <div className="bar-status">
        <span className={`titik titik-${status.s === 'tidakAda' ? 'terputus' : status.s}`} aria-hidden />
        <span>{status.s === 'tersambung' ? (jalur === 'peerjs' ? 'Tersambung (jalur cadangan)' : 'Tersambung') : status.s === 'menyambung' ? 'Menyambung...' : status.s === 'tidakAda' ? 'Room tidak ditemukan' : 'Terputus, mencoba lagi...'}</span>
        <span className="kode-kecil">{kode}</span>
        {host ? <span className="chip" id="lencana-host">HOST</span> : null}
        <button type="button" className="kecil" onClick={() => setLihatPeringkat(true)} aria-label="Lihat peringkat">Peringkat</button>
      </div>
      {info ? (
        <p className="catatan" role="status" id="info-room">{info} <button type="button" className="tautan" onClick={() => setInfo(null)}>Tutup</button></p>
      ) : null}
      {macet ? (
        <Panel label="KONEKSI" nomor="!">
          <p role="alert" id="pesan-macet">{pesanMacet(host, kode, status.s)}</p>
          <div className="baris-tombol">
            <button type="button" className="kedua" onClick={() => void keluar()}>Keluar dari room</button>
            <button type="button" className="utama" onClick={cobaLagi}>Coba lagi</button>
          </div>
        </Panel>
      ) : null}
      {!pub ? (
        macet ? null : <p className="muat">Menunggu data dari host...</p>
      ) : (
        <>
          {g && g.fase !== 'selesai' && sisaMs !== null && pub.totalMs > 0 ? (
            <Hitungan
              key={`${g.idMain}:${g.fase}:${g.ronde}:${g.putaranVote}`}
              sampai={terimaPub + sisaMs}
              awalMs={Math.max(0, terimaPub + sisaMs - sekarang)}
              totalMs={pub.totalMs}
              label={`Sisa waktu ${LABEL_BATAS[g.fase === 'malam' ? 'malam' : g.fase === 'diskusi' ? 'diskusi' : g.fase === 'voting' ? 'voting' : 'lanjut'].toLowerCase()}`}
              bunyi={!!kunciGiliran({ saya: uid, pub, pri })}
            />
          ) : null}
          <Layar kunci={`${g?.fase ?? 'lobi'}-${g?.ronde ?? 0}-${g?.idMain ?? ''}-${g?.putaranVote ?? 1}`}>
            {g ? <IsiGame pub={pub} pri={pri} uid={uid} host={host} kirim={kirim} perintah={perintah} keBeranda={() => void keluar({ keBeranda: true, tanpaKonfirmasi: true })} /> : <Lobi pub={pub} uid={uid} host={host} perintah={perintah} infoMatch={infoMatch} />}
          </Layar>
        </>
      )}
      {galat ? <p className="galat" role="alert">{galat}</p> : null}
      {galatPri && galatPri !== galatChat ? <p className="galat" role="alert">{galatPri}</p> : null}
      {host && g && g.fase !== 'selesai' ? (
        <Tombol varian="garis" onClick={async () => {
          const ya = await dialog.konfirmasi({ judul: 'Batalkan permainan?', pesan: 'Semua pemain kembali ke lobby. Hasil permainan ini tidak dicatat.', ok: 'Ke lobby', bahaya: true });
          if (ya) perintah({ jenis: 'ke_lobby' });
        }}>Batalkan ke lobby</Tombol>
      ) : null}
      <Tombol varian="hantu" id="keluar-room" onClick={() => void keluar()}>Keluar room</Tombol>
      {pub ? (
        <div className="dok">
          <div className="dok-isi">
            <ChatRoom pesan={pub.chat} saya={uid} kirim={kirimChat} galat={galatChat ?? (galatPri && /chat|pesan|Malam hari/i.test(galatPri) ? galatPri : null)} teks={teksChat} ubahTeks={setTeksChat} />
          </div>
        </div>
      ) : null}
      {lihatPeringkat ? <LapisanPeringkat akun={{ id: uid, username: nama }} onTutup={() => setLihatPeringkat(false)} /> : null}
    </div>
  );
}

/* ---------------------------------- Lobi ---------------------------------- */

function kelasBarisGelar(info: InfoGelar): string {
  const f = info.frame;
  return f ? `gelar-${META_KATEGORI[f.kategori].warna} gelar-p${f.peringkat}` : '';
}

/** Daftar pemain dengan avatar berbingkai, status online, dan tombol keluarkan (host). */
function DaftarPemain({ pub, uid, host, perintah, judul = 'Pemain' }: { pub: ViewPublik; uid: string; host: boolean; perintah?: (a: AksiHost) => void; judul?: string }) {
  const lihat = useLihatProfil();
  const dialog = useDialog();
  const peta = usePetaGelar(pub.pemain.map((p) => p.nama));
  const g = pub.game;
  const online = pub.pemain.filter((p) => p.online).length;
  return (
    <Panel label={judul.toUpperCase()} nomor={`${online}/${pub.pemain.length} ONLINE`} jeda={0.04}>
      <ul className="daftar-giliran" id="daftar-pemain">
        {pub.pemain.map((p, i) => {
          const gl = gelarNama(peta, p.nama);
          const status = g && p.main ? (p.hidup ? 'Hidup' : `Tewas${p.peran ? `, ${NAMA_PERAN[p.peran]}` : ''}`) : g ? 'Menonton' : p.id === pub.hostId ? 'Host' : 'Di lobby';
          return (
            <motion.li key={p.id} className={`${kelasBarisGelar(gl)}${g && p.main && !p.hidup ? ' mati' : ''}`} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ ...PEGAS, delay: i * 0.03 }}>
              <span className={`titik-hadir${p.online ? ' online' : ''}`} aria-label={p.online ? 'Online' : 'Offline'} />
              <button type="button" className="tautan dp-ava" aria-label={`Lihat profil ${p.nama}`} onClick={() => lihat(p.nama)}>
                <Avatar username={p.nama} cari ukuran={28} slot={gl.frame} />
              </button>
              <span className="dp-nama">
                <span className="nama-teks">{p.nama}{p.id === uid ? <em className="label-kamu"> (kamu)</em> : null}</span>
                <span className="dp-status">{status}{gl.teks ? <> · <TeksGelar teks={gl.teks} keterangan={gl.keterangan} /></> : null}</span>
              </span>
              {p.id === pub.hostId ? <span className="chip">HOST</span> : !p.online ? <span className="dp-kosong">Offline</span> : null}
              {host && perintah && p.id !== pub.hostId ? (
                <button type="button" className="kecil mini" onClick={async () => {
                  const ya = await dialog.konfirmasi({ judul: `Keluarkan ${p.nama}?`, pesan: g && p.main && p.hidup ? `${p.nama} dianggap tewas (perannya terbuka) dan tidak bisa masuk lagi ke room ini.` : `${p.nama} dikeluarkan dan tidak bisa masuk lagi ke room ini.`, ok: 'Keluarkan', bahaya: true });
                  if (ya) perintah({ jenis: 'keluarkan', id: p.id });
                }}>Keluarkan</button>
              ) : null}
            </motion.li>
          );
        })}
      </ul>
    </Panel>
  );
}

function PanelBatas({ batas, host, perintah }: { batas: BatasWaktu; host: boolean; perintah: (a: AksiHost) => void }) {
  const ubah = (k: keyof BatasWaktu, v: number) => {
    const b = { ...batas, [k]: v };
    simpan(KUNCI.batasWaktu, b);
    perintah({ jenis: 'batas', batas: b });
  };
  return (
    <Panel label="BATAS WAKTU" nomor={host ? 'HOST' : 'INFO'} jeda={0.08}>
      <div className="batas-waktu tumpuk" id="panel-batas">
        {(Object.keys(PILIHAN_BATAS) as (keyof BatasWaktu)[]).map((k) => (
          <div key={k} className="baris-batas">
            <p className="label-batas">{LABEL_BATAS[k]}</p>
            <div className="chip-grup" role="group" aria-label={`Batas waktu ${LABEL_BATAS[k]}`}>
              {PILIHAN_BATAS[k].map((v) => (
                <button key={v} type="button" className={`chip${batas[k] === v ? ' pilih' : ''}`} aria-pressed={batas[k] === v} disabled={!host} onClick={() => ubah(k, v)}>
                  {v === 0 ? 'Tanpa' : teksDetik(v)}
                </button>
              ))}
            </div>
          </div>
        ))}
        <p className="catatan">Waktu habis: malam berakhir (aksi yang belum masuk dianggap tidak ada), diskusi lanjut ke voting, voting ditutup dengan suara yang sudah masuk. Lanjut otomatis berlaku untuk layar pagi dan hasil voting.</p>
      </div>
    </Panel>
  );
}

function InfoMatch({ pub, host, info }: { pub: ViewPublik; host: boolean; info: InfoMatchLokal | null }) {
  const [sekarang, setSekarang] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setSekarang(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (!pub.match) return null;
  const online = pub.pemain.filter((p) => p.online).length;
  const maks = pub.match.maks;
  const acak = pub.match.acak;
  const diam = info ? info.s.diamMs + Math.max(0, sekarang - info.t) : 0;
  const sisa = info && !info.s.dimulai && !acak ? sisaHitungMundur(online, diam) : null;
  return (
    <Panel label="MATCH" nomor={acak ? 'ACAK' : `MAKS ${maks}`}>
      <div id="info-match" className="tumpuk">
        <h2 className="nol" data-uji="jumlah-match">Menunggu pemain {online}/{maks}</h2>
        {sisa !== null ? (
          <p className="catatan" role="timer" data-uji="hitung-mundur">Mulai otomatis dalam {formatTunggu(sisa + 999)} jika tidak ada pemain baru.</p>
        ) : info?.s.dimulai ? (
          <p className="catatan">Room ini sudah pernah mulai, jadi tidak menerima pemain match baru.</p>
        ) : acak ? (
          <p className="catatan" data-uji="host-memulai">Room Acak: host yang memulai. Tidak ada mulai otomatis.</p>
        ) : (
          <p className="catatan">Room match terbuka. Pemain lain bisa masuk sampai game dimulai. Minimal {MIN_MULAI_MATCH} pemain untuk mulai.</p>
        )}
        <p className="catatan">{host ? (acak ? `Tekan Mulai bila sudah minimal ${MIN_MULAI_MATCH} pemain.` : `Mulai otomatis saat ${maks} pemain, atau tekan Mulai bila sudah minimal ${MIN_MULAI_MATCH}.`) : 'Host memulai permainan.'}</p>
      </div>
    </Panel>
  );
}

function Lobi({ pub, uid, host, perintah, infoMatch }: { pub: ViewPublik; uid: string; host: boolean; perintah: (a: AksiHost) => void; infoMatch: InfoMatchLokal | null }) {
  const [qr, setQr] = useState<string | null>(null);
  const [tersalin, setTersalin] = useState(false);
  const link = typeof window === 'undefined' ? '' : `${window.location.origin}${BASE}/?room=${pub.kode}`;
  useEffect(() => {
    let hidup = true;
    QRCode.toDataURL(link, { margin: 1, width: 320, color: { dark: '#0b0b0b', light: '#f3f2e8' } })
      .then((d) => hidup && setQr(d))
      .catch(() => {});
    return () => {
      hidup = false;
    };
  }, [link]);
  const peserta = pub.pemain.filter((p) => p.online);
  const n = peserta.length;
  const galat = n < MIN_PEMAIN ? `Butuh minimal ${MIN_PEMAIN} pemain online (sekarang ${n}).` : cekKomposisi(n, pub.komposisi);
  const offline = pub.pemain.length - n;
  return (
    <div className="tumpuk">
      <JudulFase kecil={pub.match ? 'LOBI MATCH' : pub.publik ? 'LOBI PUBLIK' : 'LOBI PRIVAT'} judul={pub.kode} sub="Bagikan kode, link, atau QR ke teman." />
      <InfoMatch pub={pub} host={host} info={infoMatch} />
      <Panel label="UNDANG" nomor="L/01">
        <div className="undang">
          {qr ? <motion.img src={qr} alt={`QR untuk gabung room ${pub.kode}`} width={160} height={160} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={PEGAS} /> : <div className="qr-kosong" />}
          <div className="tumpuk">
            <span className="kode-besar" aria-label={`Kode room ${pub.kode.split('').join(' ')}`}>{pub.kode}</span>
            <Tombol varian="garis" onClick={() => { void navigator.clipboard?.writeText(link).then(() => setTersalin(true)).catch(() => {}); }}>{tersalin ? 'Link tersalin' : 'Salin link'}</Tombol>
          </div>
        </div>
      </Panel>
      <DaftarPemain pub={pub} uid={uid} host={host} perintah={perintah} />
      {host && !pub.match ? (
        <Panel label="VISIBILITAS" nomor="L/03">
          <div className="segmen" role="group" aria-label="Tampil di daftar room">
            <button type="button" aria-pressed={!pub.publik} onClick={() => { simpan(KUNCI.publikRoom, false); perintah({ jenis: 'publik', publik: false }); }}>Privat</button>
            <button type="button" aria-pressed={pub.publik} onClick={() => { simpan(KUNCI.publikRoom, true); perintah({ jenis: 'publik', publik: true }); }}>Publik</button>
          </div>
          <p className="catatan">{pub.publik ? 'Room tampil di daftar Room aktif.' : 'Hanya yang tahu kode yang bisa masuk.'}</p>
        </Panel>
      ) : null}
      <PanelBatas batas={pub.batas} host={host} perintah={perintah} />
      {host ? (
        <>
          <PengaturKomposisi n={Math.max(n, MIN_PEMAIN)} manual={pub.komposisiManual ? pub.komposisi : null} onUbah={(k) => perintah({ jenis: 'komposisi', komposisi: k })} />
          {offline > 0 ? <p className="catatan">{offline} pemain offline tidak ikut dan menjadi penonton.</p> : null}
          {galat ? <p className="galat">{galat}</p> : null}
          <Tombol id="mulai-game" besar disabled={!!galat} onClick={() => perintah({ jenis: 'mulai', peserta: peserta.map((p) => p.id) })}>Mulai permainan</Tombol>
        </>
      ) : (
        <Panel label="KOMPOSISI" nomor="L/02">
          <p>Werewolf {pub.komposisi.werewolf}, Peramal {pub.komposisi.peramal}, Dokter {pub.komposisi.dokter}, Warga {Math.max(0, n - pub.komposisi.werewolf - pub.komposisi.peramal - pub.komposisi.dokter)}.</p>
          <p className="redup">Menunggu host memulai...</p>
        </Panel>
      )}
    </div>
  );
}

/* --------------------------------- Permainan -------------------------------- */

function IsiGame({ pub, pri, uid, host, kirim, perintah, keBeranda }: {
  pub: ViewPublik;
  pri: ViewPribadi | null;
  uid: string;
  host: boolean;
  kirim: (a: AksiPemain) => void;
  perintah: (a: AksiHost) => string | null;
  /** Keluar room lalu kembali ke beranda (layar akhir). */
  keBeranda: () => void;
}) {
  const dialog = useDialog();
  const g = pub.game!;
  const peta = usePetaGelar(pub.pemain.map((p) => p.nama));
  const nama = (id: string) => pub.pemain.find((p) => p.id === id)?.nama ?? '?';
  const ikon = (id: string) => {
    const n = nama(id);
    return <Avatar username={n} cari ukuran={28} slot={gelarNama(peta, n).frame} />;
  };
  const aku = pub.pemain.find((p) => p.id === uid);
  const ikut = !!aku?.main;
  const tewas = ikut && !aku!.hidup;
  const penonton = !ikut;
  const pemainMain = pub.pemain.filter((p) => p.main);
  const hidupLain = pemainMain.filter((p) => p.hidup);

  const spanduk = tewas && g.fase !== 'selesai' ? <Catatan>Kamu sudah tewas. Kamu menonton sampai permainan selesai.</Catatan> : penonton && g.fase !== 'selesai' ? <Catatan>Kamu menonton. Kamu ikut di permainan berikutnya.</Catatan> : null;
  const daftar = <DaftarPemain pub={pub} uid={uid} host={host} perintah={perintah} judul="Pemain" />;

  switch (g.fase) {
    case 'peran': {
      const totalHidup = pemainMain.filter((p) => p.hidup).length;
      return (
        <div className="tumpuk tengah">
          <JudulFase kecil="PEMBAGIAN PERAN" judul="PERANMU" sub="Ketuk kartu untuk melihat. Jangan tunjukkan ke orang lain." />
          {ikut && pri?.peran ? <KartuOnline pri={pri} nama={nama} /> : spanduk}
          {ikut && pri?.peran && !tewas ? (
            pri.siap
              ? <Tombol besar varian="garis" onClick={() => kirim({ jenis: 'batal_siap' })}>Batal siap</Tombol>
              : <Tombol besar id="tombol-siap" onClick={() => kirim({ jenis: 'siap' })}>Saya siap</Tombol>
          ) : null}
          <p className="redup">{g.jumlahSiap}/{totalHidup} pemain siap</p>
          {host ? <Tombol varian="garis" onClick={() => perintah({ jenis: 'paksa_malam' })}>Mulai malam sekarang</Tombol> : null}
          {daftar}
        </div>
      );
    }
    case 'malam':
      return (
        <div className="tumpuk">
          <JudulFase kecil={`MALAM ${g.ronde}`} judul="MALAM TIBA" sub="Desa tertidur. Yang punya kekuatan, beraksilah diam-diam." />
          {spanduk}
          {ikut && !tewas && pri ? <AksiMalamOnline pri={pri} nama={nama} ikon={ikon} kirim={kirim} /> : null}
          {host ? (
            <Tombol varian="garis" onClick={async () => {
              const ya = await dialog.konfirmasi({ judul: 'Akhiri malam sekarang?', pesan: 'Aksi yang belum masuk dianggap tidak ada.', ok: 'Akhiri malam' });
              if (ya) perintah({ jenis: 'akhiri_malam' });
            }}>Akhiri malam sekarang</Tombol>
          ) : null}
        </div>
      );
    case 'pagi':
      return (
        <div className="tumpuk">
          <JudulFase kecil={`PAGI ${g.ronde}`} judul="MATAHARI TERBIT" sub={g.korbanMalam ? `${nama(g.korbanMalam)} ditemukan tewas.` : 'Semua selamat. Tidak ada yang tewas malam ini.'} />
          {g.korbanMalam ? <PeranTerbuka pub={pub} id={g.korbanMalam} /> : null}
          {spanduk}
          {host ? <Tombol besar onClick={() => perintah({ jenis: 'diskusi' })}>Mulai diskusi</Tombol> : <Catatan>Menunggu host memulai diskusi.</Catatan>}
          {daftar}
        </div>
      );
    case 'diskusi':
      return (
        <div className="tumpuk">
          <JudulFase kecil={`HARI ${g.ronde}`} judul="DISKUSI" sub="Siapa yang mencurigakan? Bicarakan bersama, juga lewat chat." />
          {pub.sisaMs === null ? <Catatan>Diskusi tanpa batas waktu.</Catatan> : null}
          {spanduk}
          {daftar}
          {host ? <Tombol besar onClick={() => perintah({ jenis: 'voting' })}>Mulai voting</Tombol> : <Catatan>Host akan membuka voting.</Catatan>}
        </div>
      );
    case 'voting': {
      const ulang = g.putaranVote === 2;
      const opsi = (pri?.targetVoting ?? []).map((id) => ({ id, nama: nama(id), ikon: ikon(id), catatan: g.sudahVote.includes(id) ? 'sudah memilih' : undefined }));
      return (
        <div className="tumpuk">
          <JudulFase kecil={`VOTING ${g.ronde}${ulang ? ', PUTARAN 2' : ''}`} judul={ulang ? 'VOTE ULANG' : 'SIAPA WEREWOLF?'} sub={ulang ? `Suara seri. Pilih antara ${g.kandidat.map(nama).join(', ')} atau Lewati. Bila seri lagi, tidak ada yang tereliminasi.` : 'Pilihan dibuka setelah semua memilih.'} />
          {ulang && g.hasilVoting ? <RingkasVoting hasil={g.hasilVoting} nama={nama} /> : null}
          {spanduk}
          {ikut && !tewas ? <PilihPemain opsi={opsi} terpilih={pri?.suaraku ?? null} onPilih={(t) => kirim({ jenis: 'suara', target: t })} lewati /> : null}
          <p className="redup">{g.sudahVote.length}/{hidupLain.length} sudah memilih{pri?.suaraku ? `. Pilihanmu: ${pri.suaraku === LEWATI ? 'Lewati' : nama(pri.suaraku)} (boleh diganti).` : '.'}</p>
          {host ? <Tombol varian="garis" onClick={() => perintah({ jenis: 'tutup_voting' })}>Tutup voting sekarang</Tombol> : null}
        </div>
      );
    }
    case 'hasil_voting':
      return (
        <div className="tumpuk">
          <JudulFase kecil={`HASIL VOTING ${g.ronde}`} judul={g.hasilVoting?.tereliminasi ? 'TERELIMINASI' : 'TIDAK ADA'} sub={g.hasilVoting ? pesanVoting(g.hasilVoting, nama) : ''} />
          {g.hasilVoting?.tereliminasi ? <PeranTerbuka pub={pub} id={g.hasilVoting.tereliminasi} /> : null}
          {g.hasilVoting ? <RingkasVoting hasil={g.hasilVoting} nama={nama} /> : null}
          {spanduk}
          {host ? <Tombol besar onClick={() => perintah({ jenis: 'malam_berikut' })}>Malam berikutnya</Tombol> : <Catatan>Menunggu host memulai malam.</Catatan>}
        </div>
      );
    case 'selesai': {
      const peserta = pub.pemain.filter((p) => p.online).map((p) => p.id);
      return (
        <div className="tumpuk">
          {g.pemenang ? <SpandukPemenang pemenang={g.pemenang} /> : null}
          {ikut && pri?.peran ? <Catatan>Kamu {NAMA_PERAN[pri.peran]}. {(pri.peran === 'werewolf') === (g.pemenang === 'werewolf') ? 'Timmu menang!' : 'Timmu kalah.'}</Catatan> : null}
          <DaftarPeranAkhir pemain={pemainMain} />
          <p className="catatan">Hasil dicatat ke statistik dan peringkat (minimal 4 pemain).</p>
          <details className="log"><summary>Catatan permainan</summary><ul>{g.log.map((l, i) => <li key={i}>{l}</li>)}</ul></details>
          {host ? (
            <>
              <Tombol besar id="main-lagi" onClick={() => perintah({ jenis: 'main_lagi', peserta })}>Main lagi</Tombol>
              <Tombol varian="garis" onClick={() => perintah({ jenis: 'ke_lobby' })}>Kembali ke lobby</Tombol>
            </>
          ) : <Catatan>Menunggu host memulai permainan baru. Atau keluar dulu ke beranda.</Catatan>}
          <Tombol varian={host ? 'hantu' : 'garis'} id="keluar-beranda" onClick={keBeranda}>Keluar ke beranda</Tombol>
          {daftar}
        </div>
      );
    }
  }
}

function PeranTerbuka({ pub, id }: { pub: ViewPublik; id: string }) {
  const p = pub.pemain.find((x) => x.id === id);
  if (!p?.peran) return null;
  return (
    <motion.p className={`label-peran besar peran-${p.peran}`} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...PEGAS, delay: 0.4 }}>
      {p.nama} adalah {NAMA_PERAN[p.peran]}
    </motion.p>
  );
}

function KartuOnline({ pri, nama }: { pri: ViewPribadi; nama: (id: string) => string }) {
  const [buka, setBuka] = useState(false);
  if (!pri.peran) return null;
  return <KartuPeran peran={pri.peran} rekan={pri.rekan.map(nama)} terbuka={buka} onBalik={() => setBuka(!buka)} />;
}

function AksiMalamOnline({ pri, nama, ikon, kirim }: { pri: ViewPribadi; nama: (id: string) => string; ikon: (id: string) => React.ReactNode; kirim: (a: AksiPemain) => void }) {
  const [chat, setChat] = useState('');
  const peran = pri.peran;
  if (!peran) return null;
  if (peran === 'warga') return <Catatan>Kamu Warga dan sedang tertidur. Tunggu pagi.</Catatan>;
  const opsi = pri.targetSah.map((t) => ({
    id: t,
    nama: nama(t),
    ikon: ikon(t),
    catatan: peran === 'werewolf' ? Object.entries(pri.pilihanTim).filter(([, x]) => x === t).map(([w]) => nama(w)).join(', ') || undefined : undefined,
  }));
  const terakhirLihat = pri.riwayatLihat.at(-1);
  return (
    <div className="tumpuk">
      <Panel label={NAMA_PERAN[peran].toUpperCase()} nomor={pri.aksiSelesai ? 'SELESAI' : 'GILIRANMU'}>
        <TeksAcak as="h2" className="judul-pixel kecil" teks={peran === 'werewolf' ? 'PILIH KORBAN' : peran === 'peramal' ? 'LIHAT SATU PEMAIN' : 'LINDUNGI SATU PEMAIN'} />
        {peran === 'werewolf' && pri.rekan.length ? <p className="redup">Rekan: {pri.rekan.map(nama).join(', ')}. Kalian harus sepakat memilih korban yang sama. Bila malam berakhir sebelum sepakat, suara terbanyak menang dan seri diundi.</p> : null}
        {peran === 'dokter' && pri.lindungiSebelum ? <p className="redup">Malam lalu kamu melindungi {nama(pri.lindungiSebelum)}.</p> : null}
        {peran === 'peramal' && pri.aksiSelesai && terakhirLihat ? (
          <motion.p className={`hasil-lihat ${terakhirLihat.werewolf ? 'ya' : 'tidak'}`} initial={{ rotateX: 90, opacity: 0 }} animate={{ rotateX: 0, opacity: 1 }} transition={PEGAS}>
            {nama(terakhirLihat.target)} {terakhirLihat.werewolf ? 'adalah WEREWOLF' : 'bukan werewolf'}
          </motion.p>
        ) : (
          <PilihPemain opsi={opsi} terpilih={pri.targetMalam} onPilih={(t) => kirim({ jenis: 'malam', target: t })} />
        )}
        {peran !== 'peramal' && pri.aksiSelesai ? <p className="catatan">Pilihan tersimpan. Kamu masih boleh menggantinya sampai malam berakhir.</p> : null}
      </Panel>
      {peran === 'peramal' && pri.riwayatLihat.length > 1 ? (
        <Catatan>Penglihatan sebelumnya: {pri.riwayatLihat.slice(0, -1).map((r) => `${nama(r.target)} (${r.werewolf ? 'werewolf' : 'bukan'})`).join(', ')}</Catatan>
      ) : null}
      {peran === 'werewolf' ? (
        <Panel label="CHAT WEREWOLF" nomor="RAHASIA">
          <ul className="chat">
            {pri.chatWW.slice(-8).map((c, i) => <li key={i}><b>{nama(c.dari)}:</b> {c.teks}</li>)}
            {pri.chatWW.length === 0 ? <li className="redup">Belum ada pesan. Hanya werewolf yang bisa membaca.</li> : null}
          </ul>
          <form className="form baris" onSubmit={(e) => { e.preventDefault(); if (chat.trim()) { kirim({ jenis: 'chat', teks: chat }); setChat(''); } }}>
            <input aria-label="Pesan untuk werewolf" value={chat} maxLength={200} onChange={(e) => setChat(e.target.value)} placeholder="Bisikkan rencana..." />
            <Tombol type="submit" disabled={!chat.trim()}>Kirim</Tombol>
          </form>
        </Panel>
      ) : null}
    </div>
  );
}

