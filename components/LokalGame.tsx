'use client';

// Mode Lokal (pass-and-play): satu HP diputar bergiliran. Peran dan aksi malam dibuka hanya setelah pemain
// menekan "Saya <nama>", lalu disembunyikan lagi sebelum HP diserahkan ke pemain berikutnya.
import { useEffect, useState } from 'react';
import {
  LEWATI,
  MAKS_PEMAIN,
  MIN_PEMAIN,
  NAMA_PERAN,
  aksiMalam,
  beriSuara,
  cekKomposisi,
  idHidup,
  komposisiOtomatis,
  lanjutMalam,
  mulaiDiskusi,
  mulaiGame,
  mulaiVoting,
  namaPemain,
  rekanWerewolf,
  selesaikanMalam,
  selesaikanVoting,
  tandaiSiap,
  targetSahMalam,
  type Komposisi,
  type StateGame,
} from '@/lib/game';
import { HitungMundur, Layar, Panel, Tombol } from './gerak';
import {
  Catatan,
  DaftarPeranAkhir,
  JudulFase,
  KartuPeran,
  Pengatur,
  PilihPemain,
  RingkasVoting,
  SerahHp,
  SpandukPemenang,
  pesanVoting,
  type Suasana,
} from './ui';

const KUNCI = 'werewolf:lokal';

interface StateLokal {
  nama: string[];
  manual: Komposisi | null;
  durasi: number;
  game: StateGame | null;
  /** Indeks giliran pass-and-play di fase peran/malam/voting. */
  giliran: number;
  /** Layar giliran sudah dibuka oleh pemiliknya. */
  buka: boolean;
}

const awal = (): StateLokal => ({ nama: ['', '', '', '', ''], manual: null, durasi: 120, game: null, giliran: 0, buka: false });

function baca(): StateLokal {
  try {
    const s = JSON.parse(localStorage.getItem(KUNCI) ?? 'null') as StateLokal | null;
    return s && Array.isArray(s.nama) ? s : awal();
  } catch {
    return awal();
  }
}

export function suasanaDari(g: StateGame | null): Suasana {
  if (!g) return 'senja';
  if (g.fase === 'malam' || g.fase === 'peran') return 'malam';
  if (g.fase === 'selesai') return g.pemenang === 'werewolf' ? 'malam' : 'pagi';
  return 'pagi';
}

export default function LokalGame({ onSuasana, onKeluar }: { onSuasana: (s: Suasana) => void; onKeluar: () => void }) {
  const [s, setS] = useState<StateLokal>(baca);
  const g = s.game;
  useEffect(() => {
    localStorage.setItem(KUNCI, JSON.stringify(s));
  }, [s]);
  useEffect(() => onSuasana(suasanaDari(g)), [g, onSuasana]);

  const ubah = (p: Partial<StateLokal>) => setS((x) => ({ ...x, ...p }));
  const ubahGame = (game: StateGame, giliran = 0) => setS((x) => ({ ...x, game, giliran, buka: false }));

  if (!g) return <Atur s={s} ubah={ubah} onKeluar={onKeluar} />;

  const hidup = idHidup(g);
  const nama = (id: string) => namaPemain(g, id);
  const kunciLayar = `${g.fase}-${g.ronde}-${s.giliran}-${s.buka ? 1 : 0}`;

  const selesaiGame = () => {
    setS((x) => ({ ...x, game: null, giliran: 0, buka: false }));
  };

  let isi: React.ReactNode = null;

  if (g.fase === 'peran') {
    const p = g.pemain[s.giliran];
    isi = !s.buka ? (
      <SerahHp nama={p.nama} keterangan={`Pembagian peran ${s.giliran + 1} dari ${g.pemain.length}.`} onSiap={() => ubah({ buka: true })} />
    ) : (
      <BukaPeran
        g={g}
        id={p.id}
        onLanjut={() => {
          const n = tandaiSiap(g, p.id);
          ubahGame(n, n.fase === 'peran' ? s.giliran + 1 : 0);
        }}
      />
    );
  } else if (g.fase === 'malam') {
    const id = hidup[s.giliran];
    const lanjut = (n: StateGame) => {
      if (s.giliran + 1 >= hidup.length) ubahGame(selesaikanMalam(n));
      else ubahGame(n, s.giliran + 1);
    };
    isi = !s.buka ? (
      <SerahHp nama={nama(id)} keterangan={`Malam ${g.ronde}. Giliran ${s.giliran + 1} dari ${hidup.length}.`} onSiap={() => ubah({ buka: true })} />
    ) : (
      <AksiMalamLokal g={g} id={id} onSelesai={lanjut} />
    );
  } else if (g.fase === 'pagi') {
    isi = (
      <div className="tumpuk">
        <JudulFase kecil={`PAGI ${g.ronde}`} judul="MATAHARI TERBIT" sub={g.korbanMalam ? `${nama(g.korbanMalam)} ditemukan tewas. Ia adalah ${NAMA_PERAN[g.peran[g.korbanMalam]]}.` : 'Semua selamat. Tidak ada yang tewas malam ini.'} />
        <Tombol besar onClick={() => ubahGame(mulaiDiskusi(g))}>Mulai diskusi</Tombol>
      </div>
    );
  } else if (g.fase === 'diskusi') {
    isi = (
      <div className="tumpuk">
        <JudulFase kecil={`HARI ${g.ronde}`} judul="DISKUSI" sub="Siapa yang mencurigakan? Bicarakan bersama." />
        {g.diskusiSampai ? <HitungMundur sampai={g.diskusiSampai} /> : <Catatan>Diskusi tanpa batas waktu.</Catatan>}
        <Tombol besar onClick={() => ubahGame(mulaiVoting(g))}>Mulai voting</Tombol>
      </div>
    );
  } else if (g.fase === 'voting') {
    const id = hidup[s.giliran];
    isi = !s.buka ? (
      <SerahHp nama={nama(id)} keterangan={`Voting rahasia. Pemilih ${s.giliran + 1} dari ${hidup.length}.`} onSiap={() => ubah({ buka: true })} />
    ) : (
      <VoteLokal
        g={g}
        id={id}
        onPilih={(t) => {
          const h = beriSuara(g, id, t);
          if (!h.ok) return;
          if (s.giliran + 1 >= hidup.length) ubahGame(selesaikanVoting(h.state));
          else ubahGame(h.state, s.giliran + 1);
        }}
      />
    );
  } else if (g.fase === 'hasil_voting' && g.hasilVoting) {
    const t = g.hasilVoting.tereliminasi;
    isi = (
      <div className="tumpuk">
        <JudulFase kecil={`HASIL VOTING ${g.ronde}`} judul={t ? 'TERELIMINASI' : 'TIDAK ADA'} sub={`${pesanVoting(g.hasilVoting, nama)}${t ? ` Ia adalah ${NAMA_PERAN[g.peran[t]]}.` : ''}`} />
        <RingkasVoting hasil={g.hasilVoting} nama={nama} />
        <Tombol besar onClick={() => ubahGame(lanjutMalam(g))}>Malam berikutnya</Tombol>
      </div>
    );
  } else if (g.fase === 'selesai' && g.pemenang) {
    isi = (
      <div className="tumpuk">
        <SpandukPemenang pemenang={g.pemenang} />
        {g.hasilVoting && g.log.at(-1)?.startsWith('Voting') ? <Catatan>{pesanVoting(g.hasilVoting, nama)}</Catatan> : null}
        <DaftarPeranAkhir pemain={g.pemain.map((p) => ({ ...p, peran: g.peran[p.id], hidup: g.hidup[p.id] }))} />
        <Tombol besar onClick={() => ubahGame(mulaiGame(g.pemain, s.manual ?? komposisiOtomatis(g.pemain.length), { durasiDiskusi: s.durasi }))}>Main lagi</Tombol>
        <Tombol varian="garis" onClick={selesaiGame}>Ubah pemain</Tombol>
      </div>
    );
  }

  return (
    <div className="tumpuk">
      <Layar kunci={kunciLayar}>{isi}</Layar>
      {g.fase !== 'selesai' ? (
        <details className="log">
          <summary>Catatan permainan</summary>
          <ul>{g.log.map((l, i) => <li key={i}>{l}</li>)}</ul>
          <button type="button" className="tautan" onClick={() => window.confirm('Akhiri permainan ini?') && selesaiGame()}>Akhiri permainan</button>
        </details>
      ) : null}
    </div>
  );
}

function Atur({ s, ubah, onKeluar }: { s: StateLokal; ubah: (p: Partial<StateLokal>) => void; onKeluar: () => void }) {
  const nama = s.nama.map((n) => n.trim());
  const terisi = nama.filter(Boolean);
  const unik = new Set(terisi.map((n) => n.toLowerCase())).size === terisi.length;
  const k = s.manual ?? komposisiOtomatis(Math.max(terisi.length, MIN_PEMAIN));
  const galat = !unik ? 'Nama pemain tidak boleh sama.' : cekKomposisi(terisi.length, k);
  return (
    <div className="tumpuk">
      <JudulFase kecil="MODE LOKAL" judul="SATU HP" sub="Isi nama pemain. HP diputar bergiliran." />
      <Panel label="PEMAIN" nomor={`${terisi.length}/${MAKS_PEMAIN}`}>
        <div className="daftar-nama">
          {s.nama.map((n, i) => (
            <div key={i} className="baris-nama">
              <input aria-label={`Nama pemain ${i + 1}`} value={n} maxLength={16} placeholder={`Pemain ${i + 1}`} onChange={(e) => ubah({ nama: s.nama.map((x, j) => (j === i ? e.target.value : x)) })} />
              <button type="button" aria-label={`Hapus pemain ${i + 1}`} disabled={s.nama.length <= MIN_PEMAIN} onClick={() => ubah({ nama: s.nama.filter((_, j) => j !== i) })}>×</button>
            </div>
          ))}
        </div>
        <Tombol varian="garis" disabled={s.nama.length >= MAKS_PEMAIN} onClick={() => ubah({ nama: [...s.nama, ''] })}>+ Tambah pemain</Tombol>
      </Panel>
      <PengaturKomposisi n={Math.max(terisi.length, MIN_PEMAIN)} manual={s.manual} onUbah={(m) => ubah({ manual: m })} durasi={s.durasi} onDurasi={(d) => ubah({ durasi: d })} />
      {galat && terisi.length > 0 ? <p className="galat">{galat}</p> : null}
      <Tombol besar disabled={!!galat} onClick={() => ubah({ game: mulaiGame(terisi.map((n, i) => ({ id: `p${i}`, nama: n })), k, { durasiDiskusi: s.durasi }), giliran: 0, buka: false })}>
        Bagikan peran
      </Tombol>
      <Tombol varian="hantu" onClick={onKeluar}>Kembali</Tombol>
    </div>
  );
}

export function PengaturKomposisi({ n, manual, onUbah, durasi, onDurasi, kunci }: {
  n: number;
  manual: Komposisi | null;
  onUbah: (k: Komposisi | null) => void;
  durasi: number;
  onDurasi: (d: number) => void;
  kunci?: boolean;
}) {
  const k = manual ?? komposisiOtomatis(n);
  const warga = Math.max(0, n - k.werewolf - k.peramal - k.dokter);
  return (
    <Panel label="KOMPOSISI" nomor={manual ? 'MANUAL' : 'OTOMATIS'}>
      <label className="sakelar">
        <input type="checkbox" checked={!manual} disabled={kunci} onChange={(e) => onUbah(e.target.checked ? null : komposisiOtomatis(n))} />
        <span>Atur otomatis sesuai jumlah pemain</span>
      </label>
      <fieldset disabled={!manual || kunci} className="komposisi">
        <Pengatur label="Werewolf" nilai={k.werewolf} min={1} maks={Math.max(1, Math.ceil(n / 2) - 1)} onUbah={(v) => onUbah({ ...k, werewolf: v })} />
        <Pengatur label="Peramal" nilai={k.peramal} min={0} maks={1} onUbah={(v) => onUbah({ ...k, peramal: v })} />
        <Pengatur label="Dokter" nilai={k.dokter} min={0} maks={1} onUbah={(v) => onUbah({ ...k, dokter: v })} />
      </fieldset>
      <p className="catatan">Warga: {warga}. Werewolf harus kurang dari separuh pemain.</p>
      <fieldset disabled={kunci} className="komposisi">
        <Pengatur label="Timer diskusi" nilai={Math.round(durasi / 30) / 2} min={0} maks={10} satuan=" mnt" onUbah={(v) => onDurasi(Math.round(v * 2) * 30)} />
      </fieldset>
      <p className="catatan">0 = tanpa timer.</p>
    </Panel>
  );
}

function BukaPeran({ g, id, onLanjut }: { g: StateGame; id: string; onLanjut: () => void }) {
  const [buka, setBuka] = useState(false);
  const [pernah, setPernah] = useState(false);
  return (
    <div className="tumpuk tengah">
      <JudulFase kecil={namaPemain(g, id).toUpperCase()} judul="PERANMU" />
      <KartuPeran peran={g.peran[id]} rekan={rekanWerewolf(g, id).map((r) => namaPemain(g, r))} terbuka={buka} onBalik={() => { setBuka(!buka); setPernah(true); }} />
      <Tombol besar disabled={!pernah} onClick={onLanjut}>Sembunyikan dan serahkan</Tombol>
    </div>
  );
}

function AksiMalamLokal({ g, id, onSelesai }: { g: StateGame; id: string; onSelesai: (n: StateGame) => void }) {
  const peran = g.peran[id];
  const [pilih, setPilih] = useState<string | null>(null);
  const [hasil, setHasil] = useState<StateGame | null>(null);
  const nama = (x: string) => namaPemain(g, x);
  const opsi = targetSahMalam(g, id).map((t) => ({ id: t, nama: nama(t) }));
  if (peran === 'warga') {
    return (
      <div className="tumpuk">
        <JudulFase kecil={`MALAM ${g.ronde}`} judul="KAMU TERTIDUR" sub="Warga tidak beraksi di malam hari. Ketuk lanjut lalu serahkan HP." />
        <Tombol besar onClick={() => onSelesai(g)}>Lanjut</Tombol>
      </div>
    );
  }
  if (peran === 'peramal' && hasil) {
    const r = hasil.riwayatLihat.at(-1)!;
    return (
      <div className="tumpuk">
        <JudulFase kecil="PENGLIHATAN" judul={r.werewolf ? 'WEREWOLF!' : 'BUKAN WEREWOLF'} sub={`${nama(r.target)} ${r.werewolf ? 'adalah werewolf.' : 'bukan werewolf.'}`} />
        <Tombol besar onClick={() => onSelesai(hasil)}>Sembunyikan dan serahkan</Tombol>
      </div>
    );
  }
  const rekan = rekanWerewolf(g, id);
  const judul = peran === 'werewolf' ? 'PILIH KORBAN' : peran === 'peramal' ? 'LIHAT SATU PEMAIN' : 'LINDUNGI SATU PEMAIN';
  return (
    <div className="tumpuk">
      <JudulFase kecil={`MALAM ${g.ronde} / ${NAMA_PERAN[peran].toUpperCase()}`} judul={judul} />
      {peran === 'werewolf' && rekan.length ? (
        <Catatan>
          Rekan: {rekan.map((r) => `${nama(r)}${g.hidup[r] ? '' : ' (tewas)'}${g.malam.pilihanWW[r] ? ` memilih ${nama(g.malam.pilihanWW[r])}` : ''}`).join(', ')}
        </Catatan>
      ) : null}
      {peran === 'dokter' && g.lindungiSebelum ? <Catatan>Malam lalu kamu melindungi {nama(g.lindungiSebelum)}.</Catatan> : null}
      <PilihPemain opsi={opsi} terpilih={pilih} onPilih={setPilih} />
      <Tombol
        besar
        disabled={!pilih}
        onClick={() => {
          const h = aksiMalam(g, id, pilih!);
          if (!h.ok) return;
          if (peran === 'peramal') setHasil(h.state);
          else onSelesai(h.state);
        }}
      >
        Konfirmasi
      </Tombol>
    </div>
  );
}

function VoteLokal({ g, id, onPilih }: { g: StateGame; id: string; onPilih: (t: string) => void }) {
  const [pilih, setPilih] = useState<string | null>(null);
  const opsi = idHidup(g).filter((t) => t !== id).map((t) => ({ id: t, nama: namaPemain(g, t) }));
  return (
    <div className="tumpuk">
      <JudulFase kecil={`VOTING ${g.ronde}`} judul="SIAPA WEREWOLF?" sub="Pilihanmu rahasia sampai semua memilih." />
      <PilihPemain opsi={opsi} terpilih={pilih} onPilih={setPilih} lewati />
      <Tombol besar disabled={!pilih} onClick={() => onPilih(pilih ?? LEWATI)}>Kunci pilihan</Tombol>
    </div>
  );
}
