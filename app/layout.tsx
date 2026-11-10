import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Silkscreen } from 'next/font/google';
import './globals.css';

// Font gratis (SIL OFL) pengganti font piksel dan mono di overrrides.com. next/font mengunduhnya saat build
// dan menyajikannya dari situs ini sendiri.
const piksel = Silkscreen({ subsets: ['latin'], weight: ['400', '700'], display: 'swap', variable: '--font-piksel' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500', '700'], display: 'swap', variable: '--font-mono' });

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export const metadata: Metadata = {
  title: 'Werewolf: Awas Malam',
  description: 'Game Werewolf: main online dengan HP masing-masing atau bergiliran di satu HP.',
  icons: { icon: [{ url: `${BASE}/icon.svg`, type: 'image/svg+xml' }] },
  appleWebApp: { capable: true, title: 'Werewolf', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  themeColor: '#090909',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" className={`${piksel.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
