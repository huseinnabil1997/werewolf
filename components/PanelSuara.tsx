'use client';

// Tombol ikon speaker + panel "Suara & notifikasi": efek suara, getar, volume, dan notifikasi giliran.
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent as KeyboardEventReact } from 'react';
import { indeksFokusBerikut } from '@/lib/dialog';
import {
  bacaUmpan, cobaSuara, cuplikanUmpan, dengarUmpan, lingkunganNotifikasi, mintaIzinNotifikasi, simpanUmpan,
} from '@/lib/umpan/mesin';
import { PILIHAN_VOLUME, statusIzin, TEKS_IZIN, type IzinNotifikasi, type PengaturanUmpan } from '@/lib/umpan/pengaturan';

const SELEKTOR_FOKUS = 'button:not([disabled])';
const NAMA_VOLUME = ['Pelan', 'Sedang', 'Keras'];

function IkonSuara({ mati }: { mati: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" />
      {mati ? <path d="m16 9 5 6m0-6-5 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />}
    </svg>
  );
}

function Saklar({ nilai, ubah, label, nonaktif }: { nilai: boolean; ubah: (v: boolean) => void; label: string; nonaktif?: boolean }) {
  return (
    <div className="segmen" role="group" aria-label={label}>
      <button type="button" aria-pressed={nilai} disabled={nonaktif} onClick={() => ubah(true)}>Aktif</button>
      <button type="button" aria-pressed={!nilai} disabled={nonaktif} onClick={() => ubah(false)}>Mati</button>
    </div>
  );
}

export function TombolSuara() {
  const [buka, setBuka] = useState(false);
  const atur = useSyncExternalStore(dengarUmpan, cuplikanUmpan, () => null);
  const [izin, setIzin] = useState<IzinNotifikasi>('didukung');
  const [adaGetar, setAdaGetar] = useState(true);
  const tombolRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const judulId = useId();

  const bukaPanel = () => {
    setIzin(statusIzin(lingkunganNotifikasi()));
    setAdaGetar(typeof navigator.vibrate === 'function');
    setBuka(true);
  };

  useEffect(() => {
    if (!buka) return;
    panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const lama = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = lama; };
  }, [buka]);

  const tutup = () => {
    setBuka(false);
    tombolRef.current?.focus();
  };

  const ubah = (p: Partial<PengaturanUmpan>) => {
    if (!atur) return;
    simpanUmpan({ ...atur, ...p });
  };

  const ubahNotifikasi = async (v: boolean) => {
    if (!v) return ubah({ notifikasi: false });
    const hasil = await mintaIzinNotifikasi();
    const st = statusIzin(lingkunganNotifikasi());
    setIzin(st);
    simpanUmpan({ ...bacaUmpan(), notifikasi: hasil === 'granted' });
  };

  const tombolKeyboard = (e: KeyboardEventReact<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      tutup();
      return;
    }
    if (e.key !== 'Tab' || !panelRef.current) return;
    const el = Array.from(panelRef.current.querySelectorAll<HTMLElement>(SELEKTOR_FOKUS));
    const i = indeksFokusBerikut(el.indexOf(document.activeElement as HTMLElement), el.length, e.shiftKey);
    if (i >= 0) {
      e.preventDefault();
      el[i].focus();
    }
  };

  const mati = !!atur && !atur.suara;
  const notifBisa = izin === 'didukung' || izin === 'diizinkan';

  return (
    <>
      <button
        ref={tombolRef}
        className="kecil ikon"
        onClick={bukaPanel}
        aria-haspopup="dialog"
        aria-expanded={buka}
        aria-label="Suara dan notifikasi"
        title="Suara dan notifikasi"
      >
        <IkonSuara mati={mati} />
      </button>
      {buka && atur && (
        <div className="dialog-latar" onMouseDown={(e) => { if (e.target === e.currentTarget) tutup(); }}>
          <div ref={panelRef} className="dialog-panel panel-suara" role="dialog" aria-modal="true" aria-labelledby={judulId} onKeyDown={tombolKeyboard}>
            <h2 id={judulId}>Suara & notifikasi</h2>
            <p className="dialog-pesan">Bunyi dan getar jelas saat giliranmu. Momen lain cukup bunyi halus.</p>

            <div className="baris-atur">
              <span className="label nol">Suara</span>
              <Saklar label="Suara" nilai={atur.suara} ubah={(v) => ubah({ suara: v })} />
            </div>
            {atur.suara && (
              <div className="baris-atur">
                <span className="label nol">Volume</span>
                <div className="chip-grup" role="group" aria-label="Volume">
                  {PILIHAN_VOLUME.map((v, i) => (
                    <button key={v} type="button" className={`chip ${atur.volume === v ? 'pilih' : ''}`} aria-pressed={atur.volume === v} onClick={() => ubah({ volume: v })}>
                      {NAMA_VOLUME[i]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="baris-atur">
              <span className="label nol">Getar</span>
              <Saklar label="Getar" nilai={adaGetar && atur.getar} nonaktif={!adaGetar} ubah={(v) => ubah({ getar: v })} />
            </div>
            {!adaGetar && <p className="catatan nol">Getar tidak didukung di perangkat ini (mis. iPhone).</p>}
            <div className="baris-atur">
              <span className="label nol">Notifikasi giliran</span>
              <Saklar label="Notifikasi giliran" nilai={notifBisa && atur.notifikasi && izin === 'diizinkan'} nonaktif={!notifBisa} ubah={(v) => void ubahNotifikasi(v)} />
            </div>
            <p className="catatan nol" role="status">
              {izin === 'diizinkan' && !atur.notifikasi ? TEKS_IZIN.didukung : TEKS_IZIN[izin]}
              {' '}Hanya selama room masih terbuka di latar; tidak muncul jika aplikasi sudah ditutup.
            </p>

            <div className="dialog-tombol">
              <button className="kedua" onClick={cobaSuara}>Coba</button>
              <button className="utama" onClick={tutup}>Selesai</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
