'use client';

// Halaman QA: frame tiap kategori × tingkat pada ukuran avatar asli di app.
import { BingkaiAvatar } from '@/components/Gelar';
import { META_KATEGORI, KATEGORI_MUSIM, type KategoriMusim } from '@/lib/peringkatMusim';
import type { SlotMusimApi } from '@/lib/supabase/peringkatMusim';

function slot(kategori: KategoriMusim, peringkat: 1 | 2 | 3): SlotMusimApi {
  return { kategori, peringkat, main: 20, menang: 15, metrik: 15 };
}

function AvatarDummy({ nama, ukuran }: { nama: string; ukuran: number }) {
  return (
    <span
      className="avatar"
      aria-hidden
      style={{
        width: ukuran,
        height: ukuran,
        fontSize: Math.round(ukuran * 0.4),
        background: '#3a3a3a',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '50%',
        fontWeight: 800,
      }}
    >
      {nama.slice(0, 2).toUpperCase()}
    </span>
  );
}

/** Ukuran nyata di app: chat 20, daftar/lobby 28, leaderboard 32, profil 88. */
const UKURAN_KONTEKS = [
  { label: 'Chat', sz: 20 },
  { label: 'Daftar / lobby', sz: 28 },
  { label: 'Leaderboard', sz: 32 },
  { label: 'Profil', sz: 88 },
] as const;

export default function FramePreview() {
  return (
    <main style={{ padding: 16, maxWidth: 390, margin: '0 auto', background: '#0b0b0b', minHeight: '100dvh', color: '#eee' }}>
      <h1 style={{ fontSize: 18, margin: '0 0 8px' }}>Preview frame gelar</h1>
      <p style={{ fontSize: 12, color: '#999', margin: '0 0 16px', lineHeight: 1.4 }}>
        Ukuran sama dengan app: chat 20, daftar/lobby 28, leaderboard 32, profil 88. Lencana = lingkaran ikon di luar pojok kanan bawah (semua ukuran); #peringkat di frame/tip ketuk.
      </p>
      {KATEGORI_MUSIM.map((k) => (
        <section key={k} style={{ marginBottom: 24 }} data-kat={k}>
          <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>{META_KATEGORI[k].ikon} {META_KATEGORI[k].nama}</h2>
          {/* #1 #2 #3 pada ukuran daftar/lobby (28), konteks frame paling sering terlihat */}
          <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
            {([1, 2, 3] as const).map((p) => (
              <div key={p} style={{ textAlign: 'center' }}>
                <BingkaiAvatar
                  slot={slot(k, p)}
                  ukuran={28}
                  anak={<AvatarDummy nama={`${k}${p}`} ukuran={28} />}
                />
                <div style={{ fontSize: 11, marginTop: 8, color: '#aaa' }}>#{p} · 28</div>
              </div>
            ))}
          </div>
          {/* Semua konteks ukuran untuk #1 */}
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
            {UKURAN_KONTEKS.map(({ label, sz }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <BingkaiAvatar
                  slot={slot(k, 1)}
                  ukuran={sz}
                  anak={<AvatarDummy nama={k} ukuran={sz} />}
                />
                <div style={{ fontSize: 10, marginTop: 6, color: '#888' }}>{label} {sz}</div>
              </div>
            ))}
          </div>
          <ul className="daftar-giliran" style={{ marginTop: 10 }}>
            <li className={`sekarang gelar-${META_KATEGORI[k].warna} gelar-p1`}>
              <span className="nomor">1</span>
              <span className="dp-ava">
                <BingkaiAvatar
                  slot={slot(k, 1)}
                  ukuran={28}
                  anak={<AvatarDummy nama="gi" ukuran={28} />}
                />
              </span>
              <span className="dp-nama">
                <span className="nama-teks">pemainpanjang_{META_KATEGORI[k].labelSingkat} <em>(kamu)</em></span>
                <span className="dp-status">Hidup</span>
              </span>
              <span className="dp-kosong">Online</span>
            </li>
          </ul>
          <ul style={{ listStyle: 'none', padding: 0, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li className={`chat-pesan gelar-${META_KATEGORI[k].warna} gelar-p1`}>
              <div className="chat-meta">
                <span className="chat-nama nama-dengan-avatar" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <BingkaiAvatar
                    slot={slot(k, 1)}
                    ukuran={20}
                    anak={<AvatarDummy nama="ch" ukuran={20} />}
                  />
                  Pemain {META_KATEGORI[k].labelSingkat}
                </span>
              </div>
              <div>Bubble chat contoh</div>
            </li>
          </ul>
        </section>
      ))}
    </main>
  );
}
