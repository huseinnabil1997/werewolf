// Sandi snapshot state host (AES-GCM 256). Kunci acak dibuat host dan hanya dibagikan ke anggota terverifikasi
// lewat view pribadi, sehingga server (dan siapa pun yang hanya tahu kode room) tidak bisa membaca isinya.

export function keBase64(b: Uint8Array): string {
  let t = '';
  for (let i = 0; i < b.length; i += 0x8000) t += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(t);
}

export function dariBase64(t: string): Uint8Array | null {
  try {
    const s = atob(t);
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  } catch {
    return null;
  }
}

export async function imporKunci(base64: string): Promise<CryptoKey | null> {
  const raw = dariBase64(base64);
  if (!raw || raw.length !== 32) return null;
  return globalThis.crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function sandikan(kunci: CryptoKey, isi: unknown): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kunci, new TextEncoder().encode(JSON.stringify(isi))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return keBase64(out);
}

/** Buka sandi; null jika rusak, kunci salah, atau bukan JSON. */
export async function bukaSandi(kunci: CryptoKey, teks: string): Promise<unknown> {
  const data = dariBase64(teks);
  if (!data || data.length < 13) return null;
  try {
    const pt = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, kunci, data.slice(12));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch {
    return null;
  }
}
