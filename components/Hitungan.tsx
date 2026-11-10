'use client';

// Hitung mundur batas waktu. Ketukan halus tiap detik di 5 detik terakhir dan bip saat habis,
// lewat sistem umpan (mengikuti pengaturan Suara & notifikasi). Hanya pemain yang sedang
// harus bertindak yang diberi bunyi, agar tidak semua HP berbunyi bersamaan.
import { useEffect, useRef, useState } from 'react';
import { DETIK_PERINGATAN, formatSisa } from '@/lib/batasWaktu';
import { umpan } from '@/lib/umpan/mesin';

export function Hitungan({ sampai, awalMs, totalMs, label, bunyi, onHabis }: {
  /** Tenggat dalam jam HP ini (ms). Kosong: dihitung dari awalMs saat mulai tampil. */
  sampai?: number | null;
  /** Sisa waktu saat pertama tampil (ms). */
  awalMs: number;
  totalMs: number;
  label: string;
  /** Bunyikan peringatan dan bip habis di HP ini. */
  bunyi: boolean;
  onHabis?: () => void;
}) {
  const [sisa, setSisa] = useState(awalMs);
  const bunyiRef = useRef(bunyi);
  const onHabisRef = useRef(onHabis);
  const detikTerakhir = useRef<number | null>(null);
  const sudahHabis = useRef(false);
  useEffect(() => {
    bunyiRef.current = bunyi;
    onHabisRef.current = onHabis;
  });

  useEffect(() => {
    const akhir = sampai ?? Date.now() + awalMs;
    const jalan = () => {
      const s = Math.max(0, akhir - Date.now());
      setSisa(s);
      const d = Math.ceil(s / 1000);
      if (s > 0 && d <= DETIK_PERINGATAN && d !== detikTerakhir.current) {
        detikTerakhir.current = d;
        if (bunyiRef.current) umpan('detik');
      }
      if (s <= 0 && !sudahHabis.current) {
        sudahHabis.current = true;
        if (bunyiRef.current) umpan('waktuHabis');
        onHabisRef.current?.();
      }
    };
    const awal = window.setTimeout(jalan, 0);
    const id = window.setInterval(jalan, 250);
    return () => {
      window.clearTimeout(awal);
      window.clearInterval(id);
    };
  }, [sampai, awalMs]);

  const detik = Math.ceil(sisa / 1000);
  const habis = sisa <= 0;
  const mendesak = !habis && detik <= DETIK_PERINGATAN;
  const rasio = totalMs > 0 ? Math.min(1, sisa / totalMs) : 0;
  return (
    <div className={`hitungan ${mendesak ? 'mendesak' : ''} ${habis ? 'habis' : ''}`} role="timer" aria-label={`${label}: ${habis ? 'waktu habis' : `sisa ${detik} detik`}`}>
      <div className="hitungan-baris">
        <span className="hitungan-label">{label}</span>
        <span className="hitungan-angka" aria-hidden>{habis ? 'Waktu habis' : formatSisa(detik)}</span>
      </div>
      <div className="hitungan-bar" aria-hidden><span style={{ transform: `scaleX(${rasio})` }} /></div>
    </div>
  );
}
