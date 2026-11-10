'use client';

// Komponen tampilan bersama mode Lokal dan Online.
import { AnimatePresence, motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { DESKRIPSI_PERAN, LEWATI, NAMA_PERAN, type HasilVoting, type Peran, type Tim } from '@/lib/game';
import { Miring, PEGAS, TeksAcak, TeksMuncul, Tombol } from './gerak';

export type Suasana = 'malam' | 'pagi' | 'senja';

/** Latar langit: malam (bulan, bintang, kabut) atau pagi (fajar). Bergantian dengan crossfade. */
export function Langit({ suasana }: { suasana: Suasana }) {
  return (
    <div className="langit" aria-hidden>
      <AnimatePresence initial={false}>
        <motion.div
          key={suasana}
          className={`langit-lapis langit-${suasana}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.4, ease: [0.44, 0, 0.56, 1] }}
        >
          <motion.div
            className="benda-langit"
            initial={{ y: 80, scale: 0.8, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            transition={{ duration: 1.8, ease: [0.16, 1, 0.3, 1] }}
          />
          {suasana === 'malam' ? <div className="bintang" /> : null}
          <div className="kabut" />
        </motion.div>
      </AnimatePresence>
      <div className="butiran" />
    </div>
  );
}

/** Ikon peran (SVG orisinal, garis tunggal). */
export function IkonPeran({ peran }: { peran: Peran }) {
  return (
    <svg className={`ikon-peran ikon-${peran}`} viewBox="0 0 48 48" width="48" height="48" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round">
      {peran === 'werewolf' ? (
        <>
          <path d="M8 6l8 10h16l8-10-2 16-4 6-4 14h-12L14 28l-4-6z" />
          <path d="M18 24l4 3M30 24l-4 3M20 36l4 3 4-3" />
        </>
      ) : null}
      {peran === 'warga' ? (
        <>
          <path d="M6 22L24 8l18 14" />
          <path d="M11 19v21h26V19" />
          <path d="M20 40V29h8v11" />
        </>
      ) : null}
      {peran === 'peramal' ? (
        <>
          <path d="M3 24s8-12 21-12 21 12 21 12-8 12-21 12S3 24 3 24z" />
          <circle cx="24" cy="24" r="6" />
          <path d="M24 4v4M10 8l3 3M38 8l-3 3" />
        </>
      ) : null}
      {peran === 'dokter' ? (
        <>
          <path d="M24 42s-16-9-16-22a8 8 0 0116-3 8 8 0 0116 3c0 13-16 22-16 22z" />
          <path d="M24 18v12M18 24h12" />
        </>
      ) : null}
    </svg>
  );
}

/** Kartu peran yang dibalik (flip 3D) saat diketuk. Dibuka hanya oleh pemiliknya. */
export function KartuPeran({ peran, rekan = [], terbuka, onBalik }: { peran: Peran; rekan?: string[]; terbuka: boolean; onBalik: () => void }) {
  return (
    <Miring className="wadah-kartu">
      <motion.button
        type="button"
        className="kartu-peran"
        onClick={onBalik}
        aria-label={terbuka ? `Peranmu: ${NAMA_PERAN[peran]}. Ketuk untuk menutup.` : 'Ketuk untuk melihat peranmu'}
        animate={{ rotateY: terbuka ? 180 : 0 }}
        transition={{ type: 'spring', stiffness: 160, damping: 18 }}
        whileTap={{ scale: 0.97 }}
      >
        <span className="sisi sisi-depan">
          <span className="pola-kartu" />
          <span className="label-pixel">WEREWOLF</span>
          <span className="petunjuk-kartu">Ketuk untuk membuka</span>
        </span>
        <span className={`sisi sisi-belakang peran-${peran}`}>
          <IkonPeran peran={peran} />
          {terbuka ? <TeksAcak as="h2" className="nama-peran" teks={NAMA_PERAN[peran].toUpperCase()} /> : <h2 className="nama-peran">?</h2>}
          <span className="deskripsi-peran">{DESKRIPSI_PERAN[peran]}</span>
          {peran === 'werewolf' && rekan.length ? <span className="rekan">Rekan: {rekan.join(', ')}</span> : null}
          {peran === 'werewolf' && !rekan.length ? <span className="rekan">Kamu werewolf satu-satunya.</span> : null}
        </span>
      </motion.button>
    </Miring>
  );
}

export interface OpsiPemain {
  id: string;
  nama: string;
  catatan?: string;
  nonaktif?: boolean;
}

/** Daftar pilihan pemain (target malam / voting) dengan tombol besar. */
export function PilihPemain({ opsi, terpilih, onPilih, lewati, nonaktif }: {
  opsi: OpsiPemain[];
  terpilih: string | null;
  onPilih: (id: string) => void;
  lewati?: boolean;
  nonaktif?: boolean;
}) {
  return (
    <div className="pilih-pemain" role="radiogroup">
      {opsi.map((o, i) => (
        <motion.button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={terpilih === o.id}
          className={`opsi${terpilih === o.id ? ' terpilih' : ''}`}
          disabled={nonaktif || o.nonaktif}
          onClick={() => onPilih(o.id)}
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ ...PEGAS, delay: i * 0.035 }}
          whileTap={{ scale: 0.97 }}
        >
          <span className="inisial">{o.nama.slice(0, 1).toUpperCase()}</span>
          <span className="nama-opsi">{o.nama}</span>
          {o.catatan ? <span className="catatan-opsi">{o.catatan}</span> : null}
        </motion.button>
      ))}
      {lewati ? (
        <motion.button
          type="button"
          role="radio"
          aria-checked={terpilih === LEWATI}
          className={`opsi opsi-lewati${terpilih === LEWATI ? ' terpilih' : ''}`}
          disabled={nonaktif}
          onClick={() => onPilih(LEWATI)}
          whileTap={{ scale: 0.97 }}
        >
          <span className="inisial">–</span>
          <span className="nama-opsi">Lewati (abstain)</span>
        </motion.button>
      ) : null}
    </div>
  );
}

export function JudulFase({ kecil, judul, sub }: { kecil: string; judul: string; sub?: string }) {
  return (
    <header className="judul-fase">
      <span className="chip">{kecil}</span>
      <TeksAcak as="h1" className="judul-pixel" teks={judul} />
      {sub ? <TeksMuncul className="sub" teks={sub} jeda={0.15} /> : null}
    </header>
  );
}

export function RingkasVoting({ hasil, nama }: { hasil: HasilVoting; nama: (id: string) => string }) {
  const baris = Object.entries(hasil.hitung).sort((a, b) => b[1] - a[1]);
  const maks = Math.max(1, ...baris.map((b) => b[1]), hasil.lewati);
  return (
    <div className="rekap">
      {baris.map(([id, n], i) => (
        <div key={id} className="baris-rekap">
          <span>{nama(id)}</span>
          <span className="batang"><motion.i initial={{ width: 0 }} animate={{ width: `${(n / maks) * 100}%` }} transition={{ ...PEGAS, delay: 0.1 + i * 0.06 }} /></span>
          <b>{n}</b>
        </div>
      ))}
      <div className="baris-rekap redup">
        <span>Lewati</span>
        <span className="batang"><motion.i initial={{ width: 0 }} animate={{ width: `${(hasil.lewati / maks) * 100}%` }} transition={PEGAS} /></span>
        <b>{hasil.lewati}</b>
      </div>
    </div>
  );
}

export function pesanVoting(hasil: HasilVoting, nama: (id: string) => string): string {
  if (hasil.tereliminasi) return `${nama(hasil.tereliminasi)} tereliminasi.`;
  if (hasil.seri) return 'Suara seri. Tidak ada yang tereliminasi.';
  return 'Tidak ada yang tereliminasi.';
}

export function SpandukPemenang({ pemenang }: { pemenang: Tim }) {
  return (
    <motion.div
      className={`spanduk spanduk-${pemenang}`}
      initial={{ scale: 0.6, opacity: 0, rotate: -6 }}
      animate={{ scale: 1, opacity: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 14 }}
    >
      <TeksAcak as="h1" className="judul-pixel" teks={pemenang === 'werewolf' ? 'WEREWOLF MENANG' : 'WARGA MENANG'} putaran={6} />
    </motion.div>
  );
}

export function DaftarPeranAkhir({ pemain }: { pemain: { id: string; nama: string; peran: Peran | null; hidup: boolean }[] }) {
  return (
    <ul className="daftar-akhir">
      {pemain.map((p, i) => (
        <motion.li key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...PEGAS, delay: i * 0.05 }} className={p.hidup ? '' : 'tewas'}>
          <span>{p.nama}</span>
          {p.peran ? (
            <span className={`label-peran peran-${p.peran}`}>
              <IkonPeran peran={p.peran} /> {NAMA_PERAN[p.peran]}
            </span>
          ) : null}
        </motion.li>
      ))}
    </ul>
  );
}

/** Layar "berikan HP ke X" untuk pass-and-play. */
export function SerahHp({ nama, keterangan, onSiap }: { nama: string; keterangan?: string; onSiap: () => void }) {
  return (
    <div className="serah">
      <span className="chip">GANTI PEMAIN</span>
      <TeksMuncul as="h2" className="serah-judul" teks={`Berikan HP ke ${nama}`} />
      <p className="redup">{keterangan ?? 'Pastikan pemain lain tidak melihat layar.'}</p>
      <Tombol besar onClick={onSiap}>Saya {nama}</Tombol>
    </div>
  );
}

export function Pengatur({ label, nilai, min, maks, onUbah, satuan }: { label: string; nilai: number; min: number; maks: number; onUbah: (n: number) => void; satuan?: string }) {
  return (
    <div className="pengatur">
      <span>{label}</span>
      <div className="pengatur-kontrol">
        <button type="button" aria-label={`Kurangi ${label}`} disabled={nilai <= min} onClick={() => onUbah(nilai - 1)}>−</button>
        <motion.b key={nilai} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={PEGAS}>
          {nilai}
          {satuan ?? ''}
        </motion.b>
        <button type="button" aria-label={`Tambah ${label}`} disabled={nilai >= maks} onClick={() => onUbah(nilai + 1)}>+</button>
      </div>
    </div>
  );
}

export function Catatan({ children }: { children: ReactNode }) {
  return <p className="catatan">{children}</p>;
}

/** Hook kecil: kartu peran terbuka/tertutup. */
export function useBalik(): [boolean, () => void, (v: boolean) => void] {
  const [buka, setBuka] = useState(false);
  return [buka, () => setBuka((b) => !b), setBuka];
}
