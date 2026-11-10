'use client';

// Frame avatar, lencana, dan keterangan gelar musiman. Frame HANYA untuk top 3 musim berjalan.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { META_KATEGORI, type KategoriMusim } from '@/lib/peringkatMusim';
import type { SlotMusimApi } from '@/lib/supabase/peringkatMusim';

export function kelasFrame(slot: SlotMusimApi | null | undefined): string {
  if (!slot) return '';
  const meta = META_KATEGORI[slot.kategori];
  return `frame-gelar frame-${meta.warna} frame-kat-${slot.kategori} frame-p${slot.peringkat}`;
}

export function LencanaGelar({ slot, ukuran = 32 }: { slot: SlotMusimApi; ukuran?: number }) {
  const meta = META_KATEGORI[slot.kategori];
  const judul = `${meta.ikon} #${slot.peringkat} ${meta.nama}`;
  // Semua ukuran: lingkaran ikon kategori saja (tanpa teks #n) di luar pojok kanan bawah.
  // Peringkat dibedakan frame/animasi; #n ada di title + sr-only BingkaiAvatar / tip ketuk.
  const sz = ukuran <= 22 ? 'titik-mikro' : ukuran < 48 ? 'titik' : 'titik-profil';
  const kelas = ['lencana-gelar', sz, slot.peringkat === 1 ? 'juara' : ''].filter(Boolean).join(' ');
  return (
    <span className={kelas} title={judul} aria-hidden>
      <span className="ikon-gelar">{meta.ikon}</span>
    </span>
  );
}

/** Padding luar frame: tebal jelas di avatar kecil (3–5px) dan lebih besar di profil. */
function paddingBingkai(ukuran: number, peringkat: 1 | 2 | 3): number {
  if (ukuran >= 64) return peringkat === 1 ? 10 : peringkat === 2 ? 8 : 7;
  if (ukuran >= 40) return peringkat === 1 ? 8 : peringkat === 2 ? 6 : 5;
  // Avatar kecil (kotak giliran / bubble / daftar): minimal 4px agar frame terbaca
  return peringkat === 1 ? 5 : peringkat === 2 ? 5 : 4;
}

/** Bungkus avatar dengan frame peringkat musim berjalan. */
export function BingkaiAvatar({ slot, anak, ukuran = 32 }: { slot?: SlotMusimApi | null; anak: ReactNode; ukuran?: number }) {
  if (!slot) return <>{anak}</>;
  const meta = META_KATEGORI[slot.kategori];
  const pad = paddingBingkai(ukuran, slot.peringkat);
  const luar = ukuran + pad * 2;
  return (
    <span
      className={`bingkai-avatar ${kelasFrame(slot)}`}
      style={{ width: luar, height: luar, ['--frame-pad' as string]: `${pad}px`, ['--avatar-sz' as string]: `${ukuran}px` }}
    >
      <span className="frame-lapisan" aria-hidden>
        <span className="frame-dasar" />
        <span className="frame-efek" />
        <span className="frame-aksen frame-aksen-a" />
        <span className="frame-aksen frame-aksen-b" />
        <span className="frame-aksen frame-aksen-c" />
        <span className="frame-aksen frame-aksen-d" />
      </span>
      <span className="frame-isi">{anak}</span>
      <LencanaGelar slot={slot} ukuran={ukuran} />
      <span className="sr-only">{`#${slot.peringkat} ${meta.nama}`}</span>
    </span>
  );
}

/** Teks gelar di samping nama + tap untuk keterangan. */
export function TeksGelar({ teks, keterangan, ikon }: { teks: string; keterangan?: string | null; ikon?: string }) {
  const [buka, setBuka] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!buka) return;
    const tutup = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setBuka(false);
    };
    document.addEventListener('pointerdown', tutup);
    return () => document.removeEventListener('pointerdown', tutup);
  }, [buka]);
  if (!teks) return null;
  return (
    <span className="teks-gelar-bungkus" ref={ref}>
      <button
        type="button"
        className="teks-gelar"
        aria-describedby={buka ? id : undefined}
        onClick={(e) => { e.stopPropagation(); setBuka((v) => !v); }}
      >
        {ikon && <span aria-hidden>{ikon}</span>} {teks}
      </button>
      {buka && keterangan && (
        <span role="tooltip" id={id} className="tip-gelar">{keterangan}</span>
      )}
    </span>
  );
}

export function IkonDeretan({ slot }: { slot: SlotMusimApi[] }) {
  if (!slot.length) return null;
  return (
    <span className="deretan-gelar" aria-label="Peringkat musim ini">
      {slot.map((s) => (
        <span key={`${s.kategori}-${s.peringkat}`} title={`#${s.peringkat} ${META_KATEGORI[s.kategori].nama}`}>
          {META_KATEGORI[s.kategori].ikon}
        </span>
      ))}
    </span>
  );
}

export function warnaKelas(kategori: KategoriMusim): string {
  return META_KATEGORI[kategori].warna;
}
