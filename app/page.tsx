'use client';

import dynamic from 'next/dynamic';

// Game sepenuhnya berjalan di browser (state React + localStorage + Supabase), jadi tidak dirender di server.
const App = dynamic(() => import('@/components/App'), {
  ssr: false,
  loading: () => (
    <main className="wadah">
      <p className="muat">Memuat desa...</p>
    </main>
  ),
});

export default function Halaman() {
  return <App />;
}
