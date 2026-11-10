'use client';

// Mode Online: tiap pemain di HP sendiri. Host menjalankan aturan game; pemain hanya menerima view publik dan
// view pribadinya sendiri (lihat lib/online/protokol.ts dan lib/online/jaringan.ts).
import { motion } from 'motion/react';
import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LEWATI, MIN_PEMAIN, NAMA_PERAN, cekKomposisi } from '@/lib/game';
import { BATAS_HOST_DIAM_MS, HostRoom, PemainRoom, bacaSesi, simpanSesi, type StatusSambung } from '@/lib/online/jaringan';
import { buatKode, rapikanKode, type AksiHost, type AksiPemain, type ViewPribadi, type ViewPublik } from '@/lib/online/protokol';
import { pesanGalatRoom } from '@/lib/supabase/data';
import { useAkun, LayarMasuk } from './Akun';
import { HitungMundur, Layar, PEGAS, Panel, TeksAcak, Tombol } from './gerak';
import { PengaturKomposisi } from './LokalGame';
import { Catatan, DaftarPeranAkhir, JudulFase, KartuPeran, PilihPemain, RingkasVoting, SpandukPemenang, pesanVoting, type Suasana } from './ui';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

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

function Ruang({ uid, nama, kodeAwal, onSuasana, onKeluar }: { uid: string; nama: string; kodeAwal: string | null; onSuasana: (s: Suasana) => void; onKeluar: () => void }) {
  const [kon, setKon] = useState<Koneksi | null>(null);
  const [pub, setPub] = useState<ViewPublik | null>(null);
  const [pri, setPri] = useState<ViewPribadi | null>(null);
  const [status, setStatus] = useState<StatusSambung>('menyambung');
  const [galat, setGalat] = useState<string | null>(null);
  const [proses, setProses] = useState(false);
  const [kodeKetik, setKodeKetik] = useState(kodeAwal ?? '');
  const [sekarang, setSekarang] = useState(() => Date.now());
  const konRef = useRef<Koneksi | null>(null);
  const terhubung = useRef(false);

  useEffect(() => onSuasana(suasanaOnline(pub)), [pub, onSuasana]);
  useEffect(() => {
    const t = setInterval(() => setSekarang(Date.now()), 3000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => () => {
    const k = konRef.current;
    if (k?.jenis === 'host') k.h.hentikan();
    if (k?.jenis === 'pemain') k.p.hentikan();
  }, []);

  const dengar = useCallback(() => ({ publik: setPub, pribadi: setPri, status: (s: StatusSambung) => setStatus(s) }), []);

  const sambung = useCallback(async (kode: string, host: boolean) => {
    setProses(true);
    setGalat(null);
    try {
      if (host) {
        const h = new HostRoom(kode, uid, nama, dengar());
        const r = await h.mulai();
        if (r === 'dipakai') {
          h.hentikan();
          setGalat('Kode room sudah dipakai. Coba lagi.');
          return false;
        }
        konRef.current = { jenis: 'host', h };
        setKon(konRef.current);
      } else {
        const p = new PemainRoom(kode, uid, dengar());
        const r = await p.mulai();
        if (r === 'tidak_ada') {
          p.hentikan();
          simpanSesi(null);
          setGalat('Room tidak ditemukan atau sudah ditutup.');
          return false;
        }
        konRef.current = { jenis: 'pemain', p };
        setKon(konRef.current);
      }
      const url = new URL(window.location.href);
      url.searchParams.set('room', kode);
      window.history.replaceState(window.history.state, '', url);
      return true;
    } catch (e) {
      setGalat(pesanGalatRoom(e));
      return false;
    } finally {
      setProses(false);
    }
  }, [uid, nama, dengar]);

  // Pulihkan sesi setelah refresh, atau langsung gabung dari link ?room=.
  useEffect(() => {
    if (terhubung.current) return;
    terhubung.current = true;
    const sesi = bacaSesi();
    const t = setTimeout(() => {
      if (sesi && (!kodeAwal || sesi.kode === kodeAwal)) void sambung(sesi.kode, sesi.host);
      else if (kodeAwal) void sambung(kodeAwal, false);
    }, 0);
    return () => clearTimeout(t);
  }, [kodeAwal, sambung]);

  const keluar = async () => {
    const k = konRef.current;
    if (k && !window.confirm(k.jenis === 'host' ? 'Tutup room? Semua pemain akan keluar.' : 'Keluar dari room?')) return;
    if (k?.jenis === 'host') await k.h.tutup();
    if (k?.jenis === 'pemain') await k.p.keluar();
    konRef.current = null;
    setKon(null);
    setPub(null);
    setPri(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState(window.history.state, '', url);
  };

  if (!kon) {
    return (
      <div className="tumpuk">
        <JudulFase kecil="MODE ONLINE" judul="MASUK ROOM" sub={`Masuk sebagai ${nama}. Tiap pemain memakai HP sendiri.`} />
        <Panel label="BUAT" nomor="O/01">
          <p className="redup">Jadi host: HP-mu menjalankan permainan. Biarkan layar tetap menyala.</p>
          <Tombol besar disabled={proses} onClick={() => void sambung(buatKode(), true)}>Buat room</Tombol>
        </Panel>
        <Panel label="GABUNG" nomor="O/02" jeda={0.06}>
          <form className="form baris" onSubmit={(e) => { e.preventDefault(); const k = rapikanKode(kodeKetik); if (k) void sambung(k, false); else setGalat('Kode room 5 huruf.'); }}>
            <input aria-label="Kode room" className="input-kode" value={kodeKetik} maxLength={5} autoCapitalize="characters" placeholder="KODE" onChange={(e) => setKodeKetik(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
            <Tombol type="submit" disabled={proses || kodeKetik.length !== 5}>Gabung</Tombol>
          </form>
        </Panel>
        {galat ? <p className="galat" role="alert">{galat}</p> : null}
        {proses ? <p className="redup">Menyambung...</p> : null}
        <Tombol varian="hantu" onClick={onKeluar}>Kembali</Tombol>
      </div>
    );
  }

  const host = kon.jenis === 'host';
  const kirim = (a: AksiPemain) => {
    if (kon.jenis === 'host') kon.h.aksiSendiri(a);
    else kon.p.kirim(a);
  };
  const perintah = (a: AksiHost) => {
    if (kon.jenis !== 'host') return;
    const g = kon.h.aksiHost(a);
    setGalat(g);
  };
  const hostDiam = !host && pub && sekarang - pub.waktu > BATAS_HOST_DIAM_MS && kon.jenis === 'pemain' && sekarang - kon.p.terakhirHost > BATAS_HOST_DIAM_MS;

  return (
    <div className="tumpuk">
      <div className="bar-status">
        <span className={`titik titik-${status}`} aria-hidden />
        <span>{status === 'tersambung' ? 'Tersambung' : status === 'menyambung' ? 'Menyambung...' : 'Terputus, mencoba lagi...'}</span>
        <span className="kode-kecil">{kon.jenis === 'host' ? kon.h.kode : kon.p.kode}</span>
        {host ? <span className="chip">HOST</span> : null}
      </div>
      {hostDiam ? <p className="galat">Host tidak merespons. Menunggu host kembali...</p> : null}
      {!pub ? (
        <p className="muat">Menunggu data dari host...</p>
      ) : (
        <Layar kunci={`${pub.game?.fase ?? 'lobi'}-${pub.game?.ronde ?? 0}-${pub.game?.idMain ?? ''}`}>
          <IsiRoom pub={pub} pri={pri} uid={uid} host={host} kirim={kirim} perintah={perintah} />
        </Layar>
      )}
      {galat ? <p className="galat" role="alert">{galat}</p> : null}
      {pri?.galat ? <p className="galat" role="alert">{pri.galat}</p> : null}
      <Tombol varian="hantu" onClick={() => void keluar()}>{host ? 'Tutup room' : 'Keluar room'}</Tombol>
    </div>
  );
}

function IsiRoom({ pub, pri, uid, host, kirim, perintah }: {
  pub: ViewPublik;
  pri: ViewPribadi | null;
  uid: string;
  host: boolean;
  kirim: (a: AksiPemain) => void;
  perintah: (a: AksiHost) => void;
}) {
  const g = pub.game;
  const nama = (id: string) => pub.pemain.find((p) => p.id === id)?.nama ?? '?';
  const aku = pub.pemain.find((p) => p.id === uid);
  const ikut = !!aku?.main && !!g;
  const tewas = ikut && !aku!.hidup;
  const penonton = !!g && !ikut;

  if (!g) return <Lobi pub={pub} host={host} perintah={perintah} />;

  const spanduk = tewas && g.fase !== 'selesai' ? <Catatan>Kamu sudah tewas. Kamu menonton sampai permainan selesai.</Catatan> : penonton && g.fase !== 'selesai' ? <Catatan>Kamu menonton. Kamu ikut di permainan berikutnya.</Catatan> : null;
  const hidupLain = pub.pemain.filter((p) => p.main && p.hidup);

  switch (g.fase) {
    case 'peran':
      return (
        <div className="tumpuk tengah">
          <JudulFase kecil="PEMBAGIAN PERAN" judul="PERANMU" sub="Ketuk kartu untuk melihat. Jangan tunjukkan ke orang lain." />
          {ikut && pri?.peran ? <KartuOnline pri={pri} nama={nama} /> : spanduk}
          {ikut && pri?.peran ? (
            <Tombol besar disabled={pri.siap} onClick={() => kirim({ jenis: 'siap' })}>{pri.siap ? 'Menunggu yang lain...' : 'Saya siap'}</Tombol>
          ) : null}
          <p className="redup">{g.jumlahSiap}/{pub.pemain.filter((p) => p.main).length} pemain siap</p>
          {host ? <Tombol varian="garis" onClick={() => perintah({ jenis: 'paksa_malam' })}>Mulai malam sekarang</Tombol> : null}
        </div>
      );
    case 'malam':
      return (
        <div className="tumpuk">
          <JudulFase kecil={`MALAM ${g.ronde}`} judul="MALAM TIBA" sub="Desa tertidur. Yang punya kekuatan, beraksilah diam-diam." />
          {spanduk}
          {ikut && !tewas && pri ? <AksiMalamOnline pri={pri} nama={nama} kirim={kirim} /> : null}
          {host ? <Tombol varian="garis" onClick={() => window.confirm('Akhiri malam sekarang? Aksi yang belum masuk dianggap tidak ada.') && perintah({ jenis: 'akhiri_malam' })}>Akhiri malam sekarang</Tombol> : null}
        </div>
      );
    case 'pagi':
      return (
        <div className="tumpuk">
          <JudulFase kecil={`PAGI ${g.ronde}`} judul="MATAHARI TERBIT" sub={g.korbanMalam ? `${nama(g.korbanMalam)} ditemukan tewas.` : 'Semua selamat. Tidak ada yang tewas malam ini.'} />
          {g.korbanMalam ? <PeranTerbuka pub={pub} id={g.korbanMalam} /> : null}
          {spanduk}
          {host ? <Tombol besar onClick={() => perintah({ jenis: 'diskusi' })}>Mulai diskusi</Tombol> : <Catatan>Menunggu host memulai diskusi.</Catatan>}
        </div>
      );
    case 'diskusi':
      return (
        <div className="tumpuk">
          <JudulFase kecil={`HARI ${g.ronde}`} judul="DISKUSI" sub="Siapa yang mencurigakan? Bicarakan bersama." />
          {g.diskusiSampai ? <HitungMundur sampai={g.diskusiSampai} /> : <Catatan>Diskusi tanpa batas waktu.</Catatan>}
          {spanduk}
          <DaftarHidup pub={pub} />
          {host ? <Tombol besar onClick={() => perintah({ jenis: 'voting' })}>Mulai voting</Tombol> : <Catatan>Host akan membuka voting.</Catatan>}
        </div>
      );
    case 'voting': {
      const opsi = hidupLain.filter((p) => p.id !== uid).map((p) => ({ id: p.id, nama: p.nama, catatan: g.sudahVote.includes(p.id) ? 'sudah memilih' : undefined }));
      return (
        <div className="tumpuk">
          <JudulFase kecil={`VOTING ${g.ronde}`} judul="SIAPA WEREWOLF?" sub="Pilihan dibuka setelah semua memilih." />
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
    case 'selesai':
      return (
        <div className="tumpuk">
          {g.pemenang ? <SpandukPemenang pemenang={g.pemenang} /> : null}
          {ikut && pri?.peran ? <Catatan>Kamu {NAMA_PERAN[pri.peran]}. {(pri.peran === 'werewolf') === (g.pemenang === 'werewolf') ? 'Timmu menang!' : 'Timmu kalah.'}</Catatan> : null}
          <DaftarPeranAkhir pemain={pub.pemain.filter((p) => p.main)} />
          <details className="log"><summary>Catatan permainan</summary><ul>{g.log.map((l, i) => <li key={i}>{l}</li>)}</ul></details>
          {host ? <Tombol besar onClick={() => perintah({ jenis: 'main_lagi' })}>Main lagi</Tombol> : <Catatan>Menunggu host memulai permainan baru.</Catatan>}
        </div>
      );
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

function DaftarHidup({ pub }: { pub: ViewPublik }) {
  return (
    <ul className="daftar-hidup">
      {pub.pemain.filter((p) => p.main).map((p) => (
        <li key={p.id} className={p.hidup ? '' : 'tewas'}>
          {p.nama}
          {!p.hidup && p.peran ? <small> ({NAMA_PERAN[p.peran]})</small> : null}
        </li>
      ))}
    </ul>
  );
}

function KartuOnline({ pri, nama }: { pri: ViewPribadi; nama: (id: string) => string }) {
  const [buka, setBuka] = useState(false);
  if (!pri.peran) return null;
  return <KartuPeran peran={pri.peran} rekan={pri.rekan.map(nama)} terbuka={buka} onBalik={() => setBuka(!buka)} />;
}

function AksiMalamOnline({ pri, nama, kirim }: { pri: ViewPribadi; nama: (id: string) => string; kirim: (a: AksiPemain) => void }) {
  const [chat, setChat] = useState('');
  const peran = pri.peran;
  if (!peran) return null;
  if (peran === 'warga') return <Catatan>Kamu Warga dan sedang tertidur. Tunggu pagi.</Catatan>;
  const opsi = pri.targetSah.map((t) => ({
    id: t,
    nama: nama(t),
    catatan: peran === 'werewolf' ? Object.entries(pri.pilihanTim).filter(([, x]) => x === t).map(([w]) => nama(w)).join(', ') || undefined : undefined,
  }));
  const terakhirLihat = pri.riwayatLihat.at(-1);
  return (
    <div className="tumpuk">
      <Panel label={NAMA_PERAN[peran].toUpperCase()} nomor={pri.aksiSelesai ? 'SELESAI' : 'GILIRANMU'}>
        <TeksAcak as="h2" className="judul-pixel kecil" teks={peran === 'werewolf' ? 'PILIH KORBAN' : peran === 'peramal' ? 'LIHAT SATU PEMAIN' : 'LINDUNGI SATU PEMAIN'} />
        {peran === 'werewolf' && pri.rekan.length ? <p className="redup">Rekan: {pri.rekan.map(nama).join(', ')}. Kalian harus sepakat memilih korban yang sama. Bila host mengakhiri malam sebelum sepakat, suara terbanyak menang dan seri diundi.</p> : null}
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

function Lobi({ pub, host, perintah }: { pub: ViewPublik; host: boolean; perintah: (a: AksiHost) => void }) {
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
  const n = pub.pemain.length;
  const galat = n < MIN_PEMAIN ? `Butuh minimal ${MIN_PEMAIN} pemain (sekarang ${n}).` : cekKomposisi(n, pub.komposisi);
  return (
    <div className="tumpuk">
      <JudulFase kecil="LOBI" judul={pub.kode} sub="Bagikan kode, link, atau QR ke teman." />
      <Panel label="UNDANG" nomor="L/01">
        <div className="undang">
          {qr ? <motion.img src={qr} alt={`QR untuk gabung room ${pub.kode}`} width={160} height={160} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={PEGAS} /> : <div className="qr-kosong" />}
          <div className="tumpuk">
            <span className="kode-besar" aria-label={`Kode room ${pub.kode.split('').join(' ')}`}>{pub.kode}</span>
            <Tombol varian="garis" onClick={() => { void navigator.clipboard?.writeText(link).then(() => setTersalin(true)).catch(() => {}); }}>{tersalin ? 'Link tersalin' : 'Salin link'}</Tombol>
          </div>
        </div>
      </Panel>
      <Panel label="PEMAIN" nomor={`${n}/20`} jeda={0.05}>
        <ul className="daftar-lobi">
          {pub.pemain.map((p, i) => (
            <motion.li key={p.id} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ ...PEGAS, delay: i * 0.03 }}>
              <span className="inisial">{p.nama.slice(0, 1).toUpperCase()}</span>
              <span>{p.nama}</span>
              {p.id === pub.hostId ? <span className="chip">HOST</span> : null}
            </motion.li>
          ))}
        </ul>
      </Panel>
      {host ? (
        <>
          <PengaturKomposisi n={Math.max(n, MIN_PEMAIN)} manual={pub.komposisiManual ? pub.komposisi : null} onUbah={(k) => perintah({ jenis: 'komposisi', komposisi: k })} durasi={pub.durasiDiskusi} onDurasi={(d) => perintah({ jenis: 'durasi', detik: d })} />
          {galat ? <p className="galat">{galat}</p> : null}
          <Tombol besar disabled={!!galat} onClick={() => perintah({ jenis: 'mulai' })}>Mulai permainan</Tombol>
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
