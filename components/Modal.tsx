'use client';

// Dialog in-app pengganti popup bawaan browser (dialog native).
// Pakai: const dialog = useDialog(); if (await dialog.konfirmasi({ ... })) { ... }
import {
  createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode,
} from 'react';
import {
  bolehTutupBackdrop, bolehTutupEsc, DURASI_KELUAR_MS, indeksFokusBerikut, nilaiBatal, nilaiOk,
  type HasilDialog, type OpsiInfo, type OpsiInput, type OpsiKonfirmasi, type PermintaanDialog,
} from '@/lib/dialog';

export interface ApiDialog {
  info(opsi: OpsiInfo): Promise<void>;
  konfirmasi(opsi: OpsiKonfirmasi): Promise<boolean>;
  input(opsi: OpsiInput): Promise<string | null>;
}

interface ItemAntrian {
  id: number;
  p: PermintaanDialog;
  selesai: (h: HasilDialog) => void;
}

const KonteksDialog = createContext<ApiDialog | null>(null);

export function useDialog(): ApiDialog {
  const api = useContext(KonteksDialog);
  if (!api) throw new Error('useDialog harus dipakai di dalam <DialogProvider>.');
  return api;
}

function gerakDikurangi(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [antrian, setAntrian] = useState<ItemAntrian[]>([]);
  const [menutup, setMenutup] = useState(false);
  const idBerikut = useRef(1);

  const buka = useCallback(
    (p: PermintaanDialog) =>
      new Promise<HasilDialog>((resolve) => {
        const id = idBerikut.current++;
        setAntrian((a) => [...a, { id, p, selesai: resolve }]);
      }),
    [],
  );

  const api = useMemo<ApiDialog>(
    () => ({
      info: (o) => buka({ jenis: 'info', ...o }).then(() => undefined),
      konfirmasi: (o) => buka({ jenis: 'konfirmasi', ...o }).then((h) => h === true),
      input: (o) => buka({ jenis: 'input', ...o }).then((h) => (typeof h === 'string' ? h : null)),
    }),
    [buka],
  );

  const aktif = antrian[0];

  const tutup = useCallback(
    (hasil: HasilDialog) => {
      if (!aktif || menutup) return;
      // Hasil langsung dikirim ke pemanggil; animasi keluar berjalan setelahnya.
      aktif.selesai(hasil);
      setMenutup(true);
      window.setTimeout(() => {
        setAntrian((a) => a.slice(1));
        setMenutup(false);
      }, gerakDikurangi() ? 0 : DURASI_KELUAR_MS);
    },
    [aktif, menutup],
  );

  return (
    <KonteksDialog.Provider value={api}>
      {children}
      {aktif && <Modal key={aktif.id} p={aktif.p} menutup={menutup} onTutup={tutup} />}
    </KonteksDialog.Provider>
  );
}

const SELEKTOR_FOKUS = 'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])';

export function Modal({ p, menutup, onTutup }: { p: PermintaanDialog; menutup: boolean; onTutup: (h: HasilDialog) => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [teks, setTeks] = useState(p.jenis === 'input' ? p.nilaiAwal ?? '' : '');
  const idJudul = useId();
  const idPesan = useId();
  const bahaya = p.jenis === 'konfirmasi' && !!p.bahaya;
  const kosong = p.jenis === 'input' && !teks.trim();

  // Fokus awal, kunci scroll halaman, dan kembalikan fokus saat dialog hilang.
  useEffect(() => {
    const sebelum = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = panel.current;
    const target = el?.querySelector<HTMLElement>('[data-fokus-awal]') ?? el;
    target?.focus();
    if (target instanceof HTMLInputElement) target.select();
    const overflowLama = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflowLama;
      if (sebelum && document.contains(sebelum)) sebelum.focus();
    };
  }, []);

  // Esc dan focus trap (Tab / Shift+Tab berputar di dalam dialog).
  useEffect(() => {
    function tombol(e: KeyboardEvent) {
      if (menutup) return;
      if (e.key === 'Escape') {
        if (bolehTutupEsc(p)) {
          e.preventDefault();
          onTutup(nilaiBatal(p.jenis));
        }
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const daftar = Array.from(panel.current.querySelectorAll<HTMLElement>(SELEKTOR_FOKUS));
      const aktif = document.activeElement instanceof HTMLElement ? daftar.indexOf(document.activeElement) : -1;
      const i = indeksFokusBerikut(aktif, daftar.length, e.shiftKey);
      e.preventDefault();
      (daftar[i] ?? panel.current).focus();
    }
    document.addEventListener('keydown', tombol);
    return () => document.removeEventListener('keydown', tombol);
  }, [p, menutup, onTutup]);

  function batal() {
    onTutup(nilaiBatal(p.jenis));
  }

  return (
    <div
      className={`dialog-latar${menutup ? ' tutup' : ''}`}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (bolehTutupBackdrop(p)) batal();
        else panel.current?.focus();
      }}
    >
      <div
        ref={panel}
        className={`dialog-panel ${p.jenis}${bahaya ? ' bahaya' : ''}`}
        role={bahaya ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={idJudul}
        aria-describedby={p.pesan ? idPesan : undefined}
        tabIndex={-1}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (kosong) return;
            onTutup(nilaiOk(p, teks));
          }}
        >
          <h2 id={idJudul}>{p.judul}</h2>
          {p.pesan && <p id={idPesan} className="dialog-pesan">{p.pesan}</p>}
          {p.jenis === 'info' && p.teksSalin && (
            <input
              className="dialog-input"
              readOnly
              value={p.teksSalin}
              aria-label="Teks untuk disalin"
              onFocus={(e) => e.currentTarget.select()}
              data-fokus-awal=""
            />
          )}
          {p.jenis === 'input' && (
            <label className="dialog-label">
              {p.label}
              <input
                className="dialog-input"
                value={teks}
                maxLength={p.maksPanjang}
                placeholder={p.placeholder}
                onChange={(e) => setTeks(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                data-fokus-awal=""
              />
            </label>
          )}
          <div className="dialog-tombol">
            {p.jenis !== 'info' && (
              <button type="button" className="kedua" onClick={batal} data-fokus-awal={bahaya ? '' : undefined}>
                {p.batal ?? 'Batal'}
              </button>
            )}
            <button
              type="submit"
              className={`utama${bahaya ? ' bahaya' : ''}`}
              disabled={kosong}
              data-fokus-awal={!bahaya && p.jenis !== 'input' ? '' : undefined}
            >
              {p.ok ?? (p.jenis === 'info' ? 'Oke' : 'Ya')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
