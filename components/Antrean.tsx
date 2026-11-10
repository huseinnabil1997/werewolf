'use client';

// Matchmaking Online dan daftar room publik: pilih kapasitas (4 sampai 8) atau Acak, lalu masuk ke room match terbuka.
import { useEffect, useRef, useState } from 'react';
import { labelUkuran, UKURAN_MATCH, type StatusMatch } from '@/lib/online/antrean';
import { rapikanKode } from '@/lib/online/protokol';
import { cariMatch, keluarMatch } from '@/lib/supabase/antrean';
import { daftarRoomPublik, type RoomPublik } from '@/lib/supabase/room';
import { baca, KUNCI, simpan } from '@/lib/storage';
import { Panel, TeksAcak, Tombol } from './gerak';

const SEGAR_DAFTAR_MS = 10_000;

/** Daftar room publik aktif: sekali tap gabung. Segar otomatis tiap 10 detik + tombol muat ulang. */
export function KartuDaftarRoom({ onGabung, nonaktif }: { onGabung: (kode: string) => void; nonaktif?: boolean }) {
  const [daftar, setDaftar] = useState<RoomPublik[] | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [memuat, setMemuat] = useState(false);
  const [tiket, setTiket] = useState(0);

  useEffect(() => {
    let hidup = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        if (!hidup) return;
        setMemuat(true);
        try {
          const rows = await daftarRoomPublik();
          if (!hidup) return;
          setDaftar(Array.isArray(rows) ? rows.filter((r) => rapikanKode(r?.kode)) : []);
          setGalat(null);
        } catch (e: unknown) {
          if (!hidup) return;
          const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message?: unknown }).message) : '';
          setGalat(msg.toLowerCase().includes('login') ? 'Login dulu untuk melihat room publik.' : 'Gagal memuat daftar room.');
          setDaftar([]);
        } finally {
          if (hidup) setMemuat(false);
        }
      })();
    }, 0);
    return () => {
      hidup = false;
      window.clearTimeout(timer);
    };
  }, [tiket]);

  useEffect(() => {
    const id = window.setInterval(() => setTiket((n) => n + 1), SEGAR_DAFTAR_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <Panel label="ROOM AKTIF" nomor="O/04" jeda={0.12}>
      <div id="daftar-room-publik" className="tumpuk">
        <div className="baris-judul">
          <span className="catatan nol">Room publik yang hostnya masih online. Sedang main: masuk sebagai penonton, ikut ronde berikutnya.</span>
          <button type="button" className="tautan" disabled={memuat} onClick={() => setTiket((n) => n + 1)} aria-label="Muat ulang daftar room">
            {memuat ? 'Memuat' : 'Muat ulang'}
          </button>
        </div>
        {galat ? <p className="galat" role="alert">{galat}</p> : null}
        {daftar === null ? (
          <p className="redup">Memuat</p>
        ) : daftar.length === 0 ? (
          <p className="redup">Belum ada room publik. Buat room Publik atau cari match.</p>
        ) : (
          <ul className="daftar-room" role="list">
            {daftar.map((r) => (
              <li key={r.kode}>
                <button type="button" className="item-room" disabled={nonaktif} onClick={() => onGabung(r.kode.toUpperCase())}>
                  <span className="room-atas">
                    <strong className="room-host">{r.host || 'Host'}</strong>
                    <span className={`lencana-status ${r.status === 'main' ? 'main' : 'lobby'}`}>{r.status === 'main' ? 'Sedang main' : 'Lobby'}</span>
                  </span>
                  <span className="room-bawah">
                    <span>{r.jumlah} pemain</span>
                    <span className="room-meta">{r.match ? `Match, kode ${r.kode}` : `Kode ${r.kode}`}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function ukuranTersimpan(): number | null {
  const u = baca<unknown>(KUNCI.ukuranMatch, null);
  return typeof u === 'number' && (UKURAN_MATCH as readonly number[]).includes(u) ? u : null;
}

export function KartuCariMatch({ onCari }: { onCari: (ukuran: number | null) => void }) {
  const [ukuran, setUkuran] = useState<number | null>(ukuranTersimpan);
  const pilih = (u: number | null) => {
    setUkuran(u);
    simpan(KUNCI.ukuranMatch, u);
  };
  return (
    <Panel label="CARI MATCH" nomor="O/03" jeda={0.08}>
      <p className="redup nol">Masuk ke room pemain lain yang belum mulai, atau buka room baru dan tunggu pemain lain.</p>
      <p className="label">Maksimal pemain</p>
      <div className="chip-grup" role="group" aria-label="Maksimal pemain match">
        {[null, ...UKURAN_MATCH].map((u) => (
          <button key={u ?? 'acak'} type="button" className={`chip${ukuran === u ? ' pilih' : ''}`} aria-pressed={ukuran === u} onClick={() => pilih(u)}>
            {u === null ? 'Acak' : u}
          </button>
        ))}
      </div>
      <p className="catatan">
        {ukuran === null
          ? 'Acak: masuk room match mana saja yang belum mulai. Jika tidak ada, dibuat room baru maksimal 8 pemain dan host memulai sendiri.'
          : `Room maksimal ${ukuran} pemain. Mulai otomatis saat mencapai ${ukuran} pemain, atau setelah 60 detik tanpa pemain baru bila sudah minimal 4.`}
      </p>
      <Tombol id="cari-match" besar onClick={() => onCari(ukuran)}>Cari match</Tombol>
    </Panel>
  );
}

export function LayarAntrean({ ukuran, onCocok, onBatal }: { ukuran: number | null; onCocok: (s: StatusMatch) => void; onBatal: (galat?: string) => void }) {
  const cocokRef = useRef(onCocok);
  const batalRef = useRef(onBatal);
  const [galat, setGalat] = useState<string | null>(null);
  useEffect(() => {
    cocokRef.current = onCocok;
    batalRef.current = onBatal;
  }, [onCocok, onBatal]);

  useEffect(() => {
    let hidup = true;
    cariMatch(ukuran)
      .then((s) => {
        if (!hidup) {
          // Sudah dibatalkan saat permintaan berjalan: lepas kursinya.
          if (s) void keluarMatch().catch(() => undefined);
          return;
        }
        if (s) cocokRef.current(s);
        else setGalat('Gagal mencari match. Coba lagi.');
      })
      .catch((e: { message?: string }) => {
        if (hidup) batalRef.current(e?.message?.includes('login') ? 'Login dulu untuk mencari match.' : 'Gagal mencari match. Coba lagi.');
      });
    return () => {
      hidup = false;
    };
  }, [ukuran]);

  return (
    <div className="tumpuk tengah">
      <Panel label="MATCHMAKING" nomor="M/01">
        <div id="layar-antrean" className="tumpuk tengah">
          <div className="pemutar" aria-hidden />
          <TeksAcak as="h2" className="judul-pixel kecil" teks="MENCARI ROOM" />
          <p>Pilihan: <strong>{labelUkuran(ukuran)}</strong></p>
          {galat ? <p className="galat" role="alert">{galat}</p> : null}
          <Tombol id="batal-antrean" varian="garis" onClick={() => onBatal()}>Batal</Tombol>
        </div>
      </Panel>
    </div>
  );
}
