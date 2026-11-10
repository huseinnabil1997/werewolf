'use client';

// Primitif animasi. Gaya geraknya meniru overrrides.com (situs Framer): pegas cepat yang teredam
// (stiffness 400, damping 30), teks acak (text scramble) yang mengendap jadi kata, mask reveal, ticker berjalan
// dengan tepi memudar, dan tilt kartu. Semua kode dan aset di sini orisinal. prefers-reduced-motion dihormati
// lewat MotionConfig reducedMotion="user" dan pemeriksaan manual untuk efek berbasis requestAnimationFrame.
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform, type HTMLMotionProps } from 'motion/react';
import { Fragment, useEffect, useState, type ReactNode } from 'react';

export const PEGAS = { type: 'spring', stiffness: 400, damping: 30, mass: 1 } as const;
export const PEGAS_LEMBUT = { type: 'spring', stiffness: 170, damping: 26 } as const;
export const EASE_KELUAR = [0.16, 1, 0.3, 1] as const;

const GLIF = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=?/<>';

/** Teks acak: tiap huruf berganti glif acak lalu mengendap berurutan dari kiri. */
export function TeksAcak({ teks, className, kecepatan = 0.6, putaran = 4, as: Tag = 'span' }: {
  teks: string;
  className?: string;
  kecepatan?: number;
  putaran?: number;
  as?: 'span' | 'h1' | 'h2' | 'p';
}) {
  const kurang = useReducedMotion();
  const [tampil, setTampil] = useState(teks);
  useEffect(() => {
    if (kurang) return;
    let bingkai = 0;
    let id = 0;
    const langkahPerHuruf = Math.max(1, Math.round(putaran / Math.max(0.1, kecepatan)));
    const total = teks.length * langkahPerHuruf * 0.5 + langkahPerHuruf * 2;
    const jalan = () => {
      bingkai++;
      const s = teks
        .split('')
        .map((c, i) => {
          if (c === ' ') return ' ';
          const kunci = i * langkahPerHuruf * 0.5 + langkahPerHuruf;
          return bingkai >= kunci ? c : GLIF[Math.floor(Math.random() * GLIF.length)];
        })
        .join('');
      setTampil(s);
      if (bingkai < total) id = requestAnimationFrame(jalan);
      else setTampil(teks);
    };
    id = requestAnimationFrame(jalan);
    return () => cancelAnimationFrame(id);
  }, [teks, kecepatan, putaran, kurang]);
  return (
    <Tag className={className} aria-label={teks}>
      <span aria-hidden>{kurang ? teks : tampil}</span>
    </Tag>
  );
}

/** Teks muncul per kata dari balik mask, bergiliran (stagger). */
export function TeksMuncul({ teks, className, jeda = 0, as: Tag = 'p' }: { teks: string; className?: string; jeda?: number; as?: 'p' | 'h1' | 'h2' | 'h3' | 'span' }) {
  const kata = teks.split(' ');
  return (
    <Tag className={className} aria-label={teks}>
      {kata.map((k, i) => (
        <Fragment key={`${k}-${i}`}>
          <span className="mask-kata" aria-hidden>
            <motion.span
              className="isi-kata"
              initial={{ y: '110%', rotate: 4, opacity: 0 }}
              animate={{ y: '0%', rotate: 0, opacity: 1 }}
              transition={{ ...PEGAS, delay: jeda + i * 0.045 }}
            >
              {k}
            </motion.span>
          </span>
          {i < kata.length - 1 ? ' ' : null}
        </Fragment>
      ))}
    </Tag>
  );
}

type PropsTombol = HTMLMotionProps<'button'> & { varian?: 'utama' | 'garis' | 'bahaya' | 'hantu'; besar?: boolean };

/** Tombol dengan pegas saat ditekan dan kilau yang mengikuti jari/kursor. */
export function Tombol({ varian = 'utama', besar, className, children, onPointerMove, ...rest }: PropsTombol) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.96 }}
      whileHover={{ y: -2 }}
      transition={PEGAS}
      className={`tombol tombol-${varian}${besar ? ' tombol-besar' : ''}${className ? ` ${className}` : ''}`}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty('--gx', `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty('--gy', `${e.clientY - r.top}px`);
        onPointerMove?.(e);
      }}
      {...rest}
    >
      <span className="isi-tombol">{children as ReactNode}</span>
    </motion.button>
  );
}

/** Panel/kartu bertepi yang muncul dengan pegas dan blur. */
export function Panel({ children, className, jeda = 0, label, nomor }: { children: ReactNode; className?: string; jeda?: number; label?: string; nomor?: string }) {
  return (
    <motion.section
      className={`panel${className ? ` ${className}` : ''}`}
      initial={{ opacity: 0, y: 24, filter: 'blur(8px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ ...PEGAS, delay: jeda }}
    >
      {label ? <span className="chip">{label}</span> : null}
      {children}
      {nomor ? <span className="nomor-panel">{nomor}</span> : null}
    </motion.section>
  );
}

/** Pita teks berjalan dengan tepi memudar. */
export function Ticker({ isi, terbalik }: { isi: string[]; terbalik?: boolean }) {
  const baris = [...isi, ...isi];
  return (
    <div className="ticker" aria-hidden>
      <div className={`ticker-jalur${terbalik ? ' terbalik' : ''}`}>
        {baris.map((t, i) => (
          <span key={i}>
            {t}
            <i>{'//'}</i>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Transisi antar layar: mask reveal (clip-path) + blur. */
export function Layar({ kunci, children }: { kunci: string; children: ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={kunci}
        className="layar"
        initial={{ opacity: 0, clipPath: 'inset(0 0 100% 0 round 16px)', filter: 'blur(6px)' }}
        animate={{ opacity: 1, clipPath: 'inset(0 0 0% 0 round 0px)', filter: 'blur(0px)' }}
        exit={{ opacity: 0, clipPath: 'inset(100% 0 0 0 round 16px)', filter: 'blur(6px)' }}
        transition={{ duration: 0.55, ease: EASE_KELUAR }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** Kartu yang miring mengikuti jari/kursor (card tilt). */
export function Miring({ children, className }: { children: ReactNode; className?: string }) {
  const x = useMotionValue(0.5);
  const y = useMotionValue(0.5);
  const rx = useSpring(useTransform(y, [0, 1], [10, -10]), PEGAS);
  const ry = useSpring(useTransform(x, [0, 1], [-12, 12]), PEGAS);
  return (
    <motion.div
      className={className}
      style={{ rotateX: rx, rotateY: ry, transformPerspective: 900 }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - r.left) / r.width);
        y.set((e.clientY - r.top) / r.height);
      }}
      onPointerLeave={() => {
        x.set(0.5);
        y.set(0.5);
      }}
    >
      {children}
    </motion.div>
  );
}

/** Hitung mundur dengan angka yang bergulir. */
export function HitungMundur({ sampai }: { sampai: number }) {
  const [sisa, setSisa] = useState(() => Math.max(0, Math.ceil((sampai - Date.now()) / 1000)));
  useEffect(() => {
    const t = setInterval(() => setSisa(Math.max(0, Math.ceil((sampai - Date.now()) / 1000))), 250);
    return () => clearInterval(t);
  }, [sampai]);
  const teks = `${Math.floor(sisa / 60)}:${String(sisa % 60).padStart(2, '0')}`;
  return (
    <div className={`hitung${sisa <= 10 ? ' genting' : ''}`} role="timer" aria-live="polite" aria-label={`Sisa waktu ${teks}`}>
      {teks.split('').map((c, i) => (
        <span key={i} className="digit">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={c} initial={{ y: '-100%', opacity: 0 }} animate={{ y: '0%', opacity: 1 }} exit={{ y: '100%', opacity: 0 }} transition={PEGAS}>
              {c}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </div>
  );
}

/** Daftar dengan anak yang muncul bergiliran. */
export function Bergiliran({ children, className }: { children: ReactNode[]; className?: string }) {
  return (
    <div className={className}>
      {children.map((c, i) => (
        <motion.div key={i} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...PEGAS, delay: 0.04 * i }}>
          {c}
        </motion.div>
      ))}
    </div>
  );
}
