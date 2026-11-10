import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bolehTutupBackdrop, bolehTutupEsc, indeksFokusBerikut, nilaiBatal, nilaiOk, type PermintaanDialog,
} from '../lib/dialog';

describe('dialog in-app', () => {
  it('nilai batal per jenis', () => {
    expect(nilaiBatal('info')).toBeUndefined();
    expect(nilaiBatal('konfirmasi')).toBe(false);
    expect(nilaiBatal('input')).toBeNull();
  });

  it('nilai ok: konfirmasi true, input dirapikan dan dibatasi, input kosong null', () => {
    expect(nilaiOk({ jenis: 'konfirmasi', judul: 'x' })).toBe(true);
    const input: PermintaanDialog = { jenis: 'input', judul: 'x', label: 'y', maksPanjang: 5 };
    expect(nilaiOk(input, '  halo dunia  ')).toBe('halo ');
    expect(nilaiOk(input, '   ')).toBeNull();
    expect(nilaiOk({ jenis: 'info', judul: 'x' })).toBeUndefined();
  });

  it('backdrop tidak menutup dialog kritis atau destruktif, Esc tetap berarti batal', () => {
    expect(bolehTutupBackdrop({ jenis: 'info', judul: 'x' })).toBe(true);
    expect(bolehTutupBackdrop({ jenis: 'konfirmasi', judul: 'x', bahaya: true })).toBe(false);
    expect(bolehTutupBackdrop({ jenis: 'input', judul: 'x', label: 'y', kritis: true })).toBe(false);
    expect(bolehTutupEsc({ jenis: 'konfirmasi', judul: 'x', bahaya: true })).toBe(true);
    expect(bolehTutupEsc({ jenis: 'info', judul: 'x', kritis: true })).toBe(false);
  });

  it('focus trap berputar', () => {
    expect(indeksFokusBerikut(-1, 3, false)).toBe(0);
    expect(indeksFokusBerikut(-1, 3, true)).toBe(2);
    expect(indeksFokusBerikut(2, 3, false)).toBe(0);
    expect(indeksFokusBerikut(0, 3, true)).toBe(2);
    expect(indeksFokusBerikut(0, 0, false)).toBe(-1);
  });
});

function semuaBerkas(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? semuaBerkas(p) : /\.(tsx?|jsx?)$/.test(n) ? [p] : [];
  });
}

describe('tanpa popup bawaan browser', () => {
  it('kode app tidak memakai alert/confirm/prompt/beforeunload native', () => {
    const terlarang = /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(|beforeunload|\.showModal\s*\(/;
    const pelanggar = ['app', 'components', 'lib']
      .flatMap(semuaBerkas)
      .filter((p) => terlarang.test(readFileSync(p, 'utf8')));
    expect(pelanggar).toEqual([]);
  });
});
