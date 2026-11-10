import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { jenisTransisi, temaTerang } from '@/lib/suasana';
import { suasanaDari } from '@/components/LokalGame';

describe('suasana siang/malam', () => {
  it('malam ke siang = terbit, siang ke malam = terbenam', () => {
    expect(jenisTransisi('malam', 'pagi')).toBe('terbit');
    expect(jenisTransisi('pagi', 'malam')).toBe('terbenam');
    expect(jenisTransisi('pagi', 'senja')).toBe('terbenam');
    expect(jenisTransisi('senja', 'malam')).toBeNull();
    expect(jenisTransisi('malam', 'malam')).toBeNull();
  });
  it('tema terang hanya saat siang', () => {
    expect(temaTerang('pagi')).toBe(true);
    expect(temaTerang('malam')).toBe(false);
    expect(temaTerang('senja')).toBe(false);
  });
  it('fase siang (pagi, diskusi, voting) memakai suasana pagi', () => {
    for (const fase of ['pagi', 'diskusi', 'voting'] as const) {
      expect(suasanaDari({ fase } as never)).toBe('pagi');
    }
    expect(suasanaDari({ fase: 'malam' } as never)).toBe('malam');
    expect(suasanaDari(null)).toBe('senja');
  });
  it('CSS tema siang menghormati prefers-reduced-motion dan memakai token warna', () => {
    const css = readFileSync('app/suasana.css', 'utf8');
    expect(css).toMatch(/:root\[data-suasana='pagi'\]/);
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*--durasi-suasana: 0s/);
    expect(css).toMatch(/@property --teks/);
  });
});

function luminans(hex: string): number {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const kontras = (a: string, b: string) => {
  const [x, y] = [luminans(a), luminans(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('kontras tema siang (WCAG AA)', () => {
  const css = readFileSync('app/suasana.css', 'utf8');
  const blok = css.slice(css.indexOf(":root[data-suasana='pagi'] {"));
  const token = (n: string) => blok.match(new RegExp(`--${n}: (#[0-9a-f]{6});`))![1];
  it('teks dan redup pada kartu putih dan langit teratas', () => {
    for (const latar of ['#ffffff', '#6db3ef', token('bg')]) {
      expect(kontras(token('teks'), latar)).toBeGreaterThanOrEqual(4.5);
      expect(kontras(token('redup'), latar)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('aksen, darah, hijau sebagai teks pada putih, dan teks di atas tombol', () => {
    for (const n of ['aksen', 'darah', 'hijau', 'ungu', 'bulan']) expect(kontras(token(n), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(kontras(token('pada-aksen'), token('aksen'))).toBeGreaterThanOrEqual(4.5);
    expect(kontras(token('pada-darah'), token('darah'))).toBeGreaterThanOrEqual(4.5);
    expect(kontras(token('garis-kuat'), '#ffffff')).toBeGreaterThanOrEqual(3);
  });
});
