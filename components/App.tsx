'use client';

// Kerangka aplikasi: beranda, mode Lokal, mode Online, akun/profil, dan cara main.
import { MotionConfig, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { bacaSesi } from '@/lib/online/jaringan';
import { kodeDariUrl } from '@/lib/online/protokol';
import { bacaUmpan, daftarkanSW, pasangUmpan } from '@/lib/umpan/mesin';
import { DURASI_TRANSISI_MS, jenisTransisi } from '@/lib/suasana';
import { AkunProvider, GerbangAkun, LayarProfil, useAkun } from './Akun';
import { LayarMasukan } from './Masukan';
import { DialogProvider } from './Modal';
import { TombolSuara } from './PanelSuara';
import { LayarPeringkat } from './Peringkat';
import { Layar, PEGAS, Panel, TeksAcak, TeksMuncul, Ticker, Tombol } from './gerak';
import LokalGame from './LokalGame';
import OnlineGame from './OnlineGame';
import { IkonPeran, Langit, type Suasana } from './ui';

type Mode = 'beranda' | 'online' | 'lokal' | 'profil' | 'cara' | 'peringkat' | 'masukan';

export default function App() {
  return (
    <MotionConfig reducedMotion="user" transition={PEGAS}>
      <DialogProvider>
        <AkunProvider>
          <Isi />
        </AkunProvider>
      </DialogProvider>
    </MotionConfig>
  );
}

function modeAwal(): { mode: Mode; kode: string | null } {
  const kode = kodeDariUrl(window.location.search);
  if (kode || bacaSesi()) return { mode: 'online', kode };
  return { mode: 'beranda', kode: null };
}

function Isi() {
  const [awal] = useState(modeAwal);
  const [mode, setMode] = useState<Mode>(awal.mode);
  const [suasana, setSuasana] = useState<Suasana>('senja');
  const { akun } = useAkun();
  const ubahSuasana = useCallback((s: Suasana) => setSuasana(s), []);
  useEffect(() => {
    const lepas = pasangUmpan();
    if (bacaUmpan().notifikasi) void daftarkanSW();
    return lepas;
  }, []);
  useEffect(() => {
    if (mode !== 'online' && mode !== 'lokal') {
      const t = setTimeout(() => setSuasana('senja'), 0);
      return () => clearTimeout(t);
    }
  }, [mode]);
  const suasanaLalu = useRef<Suasana | null>(null);
  useEffect(() => {
    const akar = document.documentElement;
    const dari = suasanaLalu.current;
    suasanaLalu.current = suasana;
    const t = dari ? jenisTransisi(dari, suasana) : null;
    if (t) akar.dataset.transisi = t;
    akar.dataset.suasana = suasana;
    if (!t) return;
    const h = setTimeout(() => {
      if (akar.dataset.transisi === t) delete akar.dataset.transisi;
    }, DURASI_TRANSISI_MS);
    return () => clearTimeout(h);
  }, [suasana]);
  const keBeranda = useCallback(() => setMode('beranda'), []);

  return (
    <>
      <Langit />
      <main className="wadah">
        <header className="kepala">
          <button type="button" className="logo" onClick={() => setMode('beranda')} aria-label="Werewolf, ke beranda">
            <TeksAcak teks="WEREWOLF" />
          </button>
          <nav className="navigasi">
            <TombolSuara />
            <button type="button" className={mode === 'profil' ? 'aktif' : ''} onClick={() => setMode('profil')}>
              {akun ? akun.username : 'Masuk'}
            </button>
          </nav>
        </header>
        <Layar kunci={mode}>
          {mode === 'beranda' ? <Beranda pilih={setMode} /> : null}
          {mode === 'lokal' ? <LokalGame onSuasana={ubahSuasana} onKeluar={keBeranda} /> : null}
          {mode === 'online' ? <OnlineGame kodeAwal={awal.kode} onSuasana={ubahSuasana} onKeluar={keBeranda} /> : null}
          {mode === 'profil' ? <LayarProfil /> : null}
          {mode === 'cara' ? <CaraMain kembali={keBeranda} /> : null}
          {mode === 'peringkat' ? (
            <GerbangAkun alasan="Peringkat hanya untuk pemain yang login.">{(a) => <LayarPeringkat akun={a} onBeranda={keBeranda} />}</GerbangAkun>
          ) : null}
          {mode === 'masukan' ? (
            <GerbangAkun alasan="Login dulu untuk mengirim dan membaca masukan.">{(a) => <LayarMasukan akun={a} onBeranda={keBeranda} />}</GerbangAkun>
          ) : null}
        </Layar>
      </main>
    </>
  );
}

function Beranda({ pilih }: { pilih: (m: Mode) => void }) {
  const kartu: { m: Mode; no: string; label: string; judul: string; isi: string }[] = [
    { m: 'online', no: '001', label: 'HP MASING-MASING', judul: 'Main Online', isi: 'Buat room, bagikan kode atau QR. Butuh login.' },
    { m: 'lokal', no: '002', label: 'SATU HP', judul: 'Main Lokal', isi: 'Pass-and-play bergiliran. Tanpa login.' },
    { m: 'peringkat', no: '003', label: 'TOP 50', judul: 'Peringkat', isi: 'Semua waktu dan musim bulan ini. Top 3 dapat frame avatar.' },
    { m: 'cara', no: '004', label: 'ATURAN', judul: 'Cara Main', isi: 'Peran, fase malam dan siang, voting.' },
    { m: 'masukan', no: '005', label: 'SARAN', judul: 'Masukan', isi: 'Kirim saran atau laporan bug, dukung masukan pemain lain.' },
  ];
  return (
    <div className="tumpuk">
      <section className="pahlawan">
        <span className="chip">4 SAMPAI 20 PEMAIN</span>
        <TeksAcak as="h1" className="judul-raksasa" teks="AWAS MALAM" putaran={6} />
        <TeksMuncul className="sub" teks="Ada werewolf di antara kalian. Temukan sebelum desa habis." jeda={0.2} />
      </section>
      <Ticker isi={['MALAM TIBA', 'JANGAN PERCAYA SIAPA PUN', 'PERAMAL MELIHAT', 'DOKTER BERJAGA', 'VOTING DIMULAI']} />
      <div className="kisi-kartu">
        {kartu.map((k, i) => (
          <motion.button
            key={k.m}
            type="button"
            className="kartu-menu"
            onClick={() => pilih(k.m)}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...PEGAS, delay: 0.15 + i * 0.07 }}
            whileTap={{ scale: 0.98 }}
          >
            <span className="chip">{k.label}</span>
            <span className="judul-kartu">{k.judul}</span>
            <span className="isi-kartu">{k.isi}</span>
            <span className="kaki-kartu">
              <span>W</span>
              <span>{k.no}</span>
              <span className="panah" aria-hidden>→</span>
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function CaraMain({ kembali }: { kembali: () => void }) {
  return (
    <div className="tumpuk">
      <header className="judul-fase">
        <span className="chip">ATURAN</span>
        <TeksAcak as="h1" className="judul-pixel" teks="CARA MAIN" />
      </header>
      <Panel label="PERAN" nomor="R/01">
        <ul className="stat-peran">
          <li className="peran-werewolf"><IkonPeran peran="werewolf" /><span><b>Werewolf</b>: tiap malam sepakat memilih satu korban.</span></li>
          <li className="peran-peramal"><IkonPeran peran="peramal" /><span><b>Peramal</b>: tiap malam melihat apakah satu pemain werewolf.</span></li>
          <li className="peran-dokter"><IkonPeran peran="dokter" /><span><b>Dokter</b>: tiap malam melindungi satu pemain (tidak boleh sama dua malam berturut-turut).</span></li>
          <li className="peran-warga"><IkonPeran peran="warga" /><span><b>Warga</b>: tidak punya aksi malam, ikut diskusi dan voting.</span></li>
        </ul>
      </Panel>
      <Panel label="ALUR" nomor="R/02" jeda={0.05}>
        <ol className="alur">
          <li><b>Malam</b>: werewolf memilih korban, Peramal melihat, Dokter melindungi.</li>
          <li><b>Pagi</b>: korban diumumkan beserta perannya. Korban yang dilindungi Dokter selamat.</li>
          <li><b>Diskusi</b>: bicarakan siapa yang mencurigakan, langsung atau lewat chat room (batas waktu opsional).</li>
          <li><b>Voting</b>: pilih satu pemain atau Lewati. Hanya pemain dengan suara terbanyak tunggal yang tereliminasi, dan suaranya harus lebih banyak dari jumlah Lewati. Bila seri (termasuk seri dengan Lewati), ada vote ulang khusus pemain yang seri. Seri lagi berarti tidak ada yang tereliminasi.</li>
          <li><b>Menang</b>: warga menang bila semua werewolf tewas. Werewolf menang bila jumlahnya sama atau lebih banyak dari sisa pemain lain.</li>
        </ol>
      </Panel>
      <Panel label="KOMPOSISI OTOMATIS" nomor="R/03" jeda={0.1}>
        <p>4 sampai 5 pemain: 1 werewolf. 6 sampai 8: 2. 9 sampai 11: 3. 12 ke atas: 4. Peramal mulai 4 pemain, Dokter mulai 5 pemain. Host bisa mengubahnya.</p>
      </Panel>
      <Panel label="ONLINE" nomor="R/04" jeda={0.15}>
        <ul className="alur">
          <li><b>Host</b>: HP host menjalankan aturan. Bila host keluar atau hilang 15 detik, pemain lain mengambil alih otomatis dan permainan berlanjut.</li>
          <li><b>Cari match</b>: pilih maksimal 4 sampai 8 pemain atau Acak. Room mulai otomatis saat penuh, atau 60 detik tanpa pemain baru bila sudah minimal 4.</li>
          <li><b>Peringkat musim</b>: tiap bulan (WIB). Top 3 tiap kategori (Keseluruhan, Werewolf, Warga, Peramal, Dokter, Winrate tertinggi, Match terbanyak) mendapat frame avatar selama bulan itu; setelah musim berakhir jadi gelar teks.</li>
        </ul>
      </Panel>
      <Tombol varian="hantu" onClick={kembali}>Kembali</Tombol>
    </div>
  );
}
