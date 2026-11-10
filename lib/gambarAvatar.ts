// Siapkan foto profil di browser: potong persegi tengah, kecilkan ke 256 px, WebP (cadangan JPEG), target < 100 KB.
import { potongTengah, SISI_AVATAR, TARGET_BYTE_AVATAR } from './avatar';

function keBlob(c: HTMLCanvasElement, tipe: string, mutu: number): Promise<Blob | null> {
  return new Promise((r) => c.toBlob(r, tipe, mutu));
}

export async function siapkanAvatar(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Pilih file gambar.');
  const bmp = await createImageBitmap(file);
  const { x, y, sisi } = potongTengah(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = SISI_AVATAR;
  c.height = SISI_AVATAR;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Browser tidak mendukung pengolahan gambar.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, x, y, sisi, sisi, 0, 0, SISI_AVATAR, SISI_AVATAR);
  bmp.close();
  let terakhir: Blob | null = null;
  for (const mutu of [0.85, 0.7, 0.55, 0.4]) {
    let b = await keBlob(c, 'image/webp', mutu);
    // Browser tanpa encoder WebP mengembalikan PNG: pakai JPEG.
    if (!b || b.type !== 'image/webp') b = await keBlob(c, 'image/jpeg', mutu);
    if (!b) continue;
    terakhir = b;
    if (b.size <= TARGET_BYTE_AVATAR) return b;
  }
  if (terakhir && terakhir.size <= 200 * 1024) return terakhir;
  throw new Error('Gambar terlalu besar.');
}
