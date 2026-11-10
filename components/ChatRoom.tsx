'use client';

// Chat room mode online: tombol di dok bawah (tetap di tempat saat digulir) dengan badge belum dibaca + panel bottom sheet.
// Semua teks dirender sebagai teks React biasa (otomatis di-escape), tanpa HTML mentah.
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent as KeyboardEventReact } from 'react';
import { indeksFokusBerikut } from '@/lib/dialog';
import { Avatar } from './Avatar';
import { gelarNama, usePetaGelar } from '@/lib/online/gelarRoom';
import { META_KATEGORI } from '@/lib/peringkatMusim';
import {
  EMOJI_CEPAT, MAKS_PANJANG_CHAT, hanyaEmoji, hitungBelumDibaca, jamChat, type PesanChat,
} from '@/lib/online/chat';

const DURASI_TUTUP_MS = 220;
const SELEKTOR_FOKUS = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function gerakDikurangi(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function ChatRoom({ pesan, saya, kirim, galat, teks, ubahTeks }: {
  pesan: PesanChat[];
  saya: string;
  /** Draf pesan, disimpan di induk agar pesan yang ditolak host bisa dikembalikan ke kolom input. */
  teks: string;
  ubahTeks: (t: string) => void;
  /** Kirim teks; false jika gagal (alasannya masuk ke `galat`). */
  kirim: (teks: string) => boolean;
  /** Alasan terakhir pesan ditolak (mis. terlalu cepat), ditampilkan di panel. */
  galat: string | null;
}) {
  const [fase, setFase] = useState<'tutup' | 'buka' | 'menutup'>('tutup');
  const [dibaca, setDibaca] = useState<string | null>(null);
  const tombolRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const daftarRef = useRef<HTMLOListElement>(null);
  const dekatBawah = useRef(true);
  const judulId = useId();
  const terakhir = pesan.length > 0 ? pesan[pesan.length - 1] : null;
  const terbuka = fase !== 'tutup';
  const belum = fase === 'buka' ? 0 : hitungBelumDibaca(pesan, dibaca, saya);
  const peta = usePetaGelar(pesan.map((x) => x.nama));

  const buka = () => {
    dekatBawah.current = true;
    setDibaca(terakhir?.id ?? null);
    setFase('buka');
  };
  const tutup = () => {
    if (fase !== 'buka') return;
    setDibaca(terakhir?.id ?? null);
    setFase('menutup');
    window.setTimeout(() => {
      setFase('tutup');
      tombolRef.current?.focus();
    }, gerakDikurangi() ? 0 : DURASI_TUTUP_MS);
  };

  // Fokus awal ke kolom pesan saat panel dibuka; kunci scroll halaman di belakang.
  useEffect(() => {
    if (fase !== 'buka') return;
    panelRef.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
    const lama = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = lama; };
  }, [fase]);

  // Esc tetap menutup panel walau fokus sempat lepas ke body (mis. tombol Kirim jadi disabled setelah terkirim).
  useEffect(() => {
    if (fase !== 'buka') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !panelRef.current?.contains(e.target as Node)) tutup();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // Gulir otomatis ke pesan terbaru jika pengguna sedang di bawah atau pesan itu miliknya sendiri.
  useEffect(() => {
    const el = daftarRef.current;
    if (!el || fase !== 'buka') return;
    if (dekatBawah.current || terakhir?.dari === saya) el.scrollTop = el.scrollHeight;
  }, [terakhir, fase, saya]);

  const kirimTeks = (t: string) => {
    if (!kirim(t)) return false;
    dekatBawah.current = true;
    return true;
  };

  const kirimForm = (e: FormEvent) => {
    e.preventDefault();
    if (!teks.trim()) return;
    // Kolom hanya dikosongkan jika pesan lolos cek (termasuk rate limit di klien).
    if (kirimTeks(teks)) ubahTeks('');
    panelRef.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
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

  const sisa = MAKS_PANJANG_CHAT - Array.from(teks).length;

  return (
    <>
      <button
        ref={tombolRef}
        className="kecil tombol-dok tombol-chat"
        onClick={buka}
        aria-haspopup="dialog"
        aria-expanded={terbuka}
        aria-label={belum > 0 ? `Chat, ${belum} pesan belum dibaca` : 'Chat'}
      >
        Chat
        {belum > 0 && <span className="badge-chat" aria-hidden>{belum > 9 ? '9+' : belum}</span>}
      </button>

      {terbuka && (
        <div
          className={`chat-latar${fase === 'menutup' ? ' tutup' : ''}`}
          onMouseDown={(e) => { if (e.target === e.currentTarget) tutup(); }}
        >
          <div
            ref={panelRef}
            className="chat-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={judulId}
            onKeyDown={tombolKeyboard}
          >
            <div className="chat-kepala">
              <h2 id={judulId}>Chat</h2>
              <button className="kecil" onClick={tutup} aria-label="Tutup chat">Tutup</button>
            </div>

            <ol
              ref={daftarRef}
              className="chat-daftar"
              aria-live="polite"
              aria-label="Pesan"
              onScroll={(e) => {
                const el = e.currentTarget;
                dekatBawah.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
              }}
            >
              {pesan.length === 0 && (
                <li className="chat-kosong">Belum ada pesan. Hilang saat room ditutup.</li>
              )}
              {pesan.map((p) => {
                const milikku = p.dari === saya;
                return (
                  <li key={p.id} className={`chat-pesan${milikku ? ' saya' : ''}${(() => { const g = gelarNama(peta, p.nama).frame; return g ? ` gelar-${META_KATEGORI[g.kategori].warna} gelar-p${g.peringkat}` : ''; })()}`}>
                    <div className="chat-meta">
                      <span className="chat-nama nama-dengan-avatar">{!milikku && <Avatar username={p.nama} cari ukuran={20} slot={gelarNama(peta, p.nama).frame} />}<span className="nama-teks">{milikku ? 'Kamu' : p.nama}</span></span>
                      <time dateTime={new Date(p.waktu).toISOString()}>{jamChat(p.waktu)}</time>
                    </div>
                    <p className={`chat-teks${hanyaEmoji(p.teks) ? ' emoji' : ''}`}>{p.teks}</p>
                  </li>
                );
              })}
            </ol>

            <div className="chat-emoji" role="group" aria-label="Reaksi cepat">
              {EMOJI_CEPAT.map((e) => (
                <button key={e} type="button" onClick={() => kirimTeks(e)} aria-label={`Kirim ${e}`}>{e}</button>
              ))}
            </div>

            <form className="chat-form" onSubmit={kirimForm}>
              <input
                value={teks}
                onChange={(e) => ubahTeks(Array.from(e.target.value).slice(0, MAKS_PANJANG_CHAT).join(''))}
                placeholder="Pesan"
                aria-label="Pesan"
                enterKeyHint="send"
                autoComplete="off"
              />
              <button type="submit" className="utama" disabled={!teks.trim()}>Kirim</button>
            </form>
            <p className="chat-info" role="status">
              {galat ?? (sisa <= 40 ? `Sisa ${sisa} karakter` : '')}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
