// Pemutar umpan balik di browser: efek suara (Web Audio), getar, dan notifikasi HP saat giliranmu.
// Tidak ada server push: notifikasi dibuat oleh halaman ini sendiri selama halaman masih hidup di latar.
import { baca, simpan } from '@/lib/storage';
import { EFEK, type Nada } from './nada';
import { KUNCI_UMPAN, rapikanUmpan, type PengaturanUmpan } from './pengaturan';
import { perluNotifikasi, POLA_GETAR, TEKS_NOTIFIKASI, type Peristiwa } from './peristiwa';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const TAG_GILIRAN = 'werewolf-giliran';

export interface CatatanUmpan { p: Peristiwa; suara: boolean; getar: boolean; notif: boolean; waktu: number }

declare global {
  interface Window {
    /** Jejak umpan balik terakhir (hanya di memori tab ini), berguna untuk uji dan diagnosis. */
    __umpan?: CatatanUmpan[];
    webkitAudioContext?: typeof AudioContext;
  }
}

let ctx: AudioContext | null = null;
const pendengar = new Set<() => void>();

export function bacaUmpan(): PengaturanUmpan {
  return rapikanUmpan(baca<unknown>(KUNCI_UMPAN, null));
}

let cuplikan: PengaturanUmpan | null = null;

/** Pengaturan yang sama (referensi stabil) selama belum diubah; untuk useSyncExternalStore. */
export function cuplikanUmpan(): PengaturanUmpan {
  if (!cuplikan) cuplikan = bacaUmpan();
  return cuplikan;
}

export function simpanUmpan(p: PengaturanUmpan): void {
  simpan(KUNCI_UMPAN, p);
  cuplikan = rapikanUmpan(p);
  pendengar.forEach((f) => f());
}

export function dengarUmpan(f: () => void): () => void {
  pendengar.add(f);
  return () => pendengar.delete(f);
}

/** Buat atau lanjutkan AudioContext. Harus dipanggil dari ketukan pengguna (aturan autoplay browser). */
export function bukaKunciAudio(): void {
  if (typeof window === 'undefined') return;
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    // Audio tidak tersedia; game tetap jalan tanpa suara.
  }
}

/** Pasang pembuka audio pada ketukan pertama, dan kembalikan judul tab saat halaman dilihat lagi. */
export function pasangUmpan(): () => void {
  const buka = () => bukaKunciAudio();
  const opsi = { capture: true, passive: true } as const;
  window.addEventListener('pointerdown', buka, opsi);
  window.addEventListener('keydown', buka, opsi);
  const terlihat = () => {
    if (document.visibilityState === 'visible') {
      pulihkanJudul();
      void tutupNotifikasiGiliran();
    }
  };
  document.addEventListener('visibilitychange', terlihat);
  return () => {
    window.removeEventListener('pointerdown', buka, opsi);
    window.removeEventListener('keydown', buka, opsi);
    document.removeEventListener('visibilitychange', terlihat);
  };
}

function mainkanNada(nada: Nada[], volume: number): boolean {
  if (!ctx || ctx.state !== 'running' || volume <= 0) return false;
  const c = ctx;
  const t0 = c.currentTime + 0.01;
  const keluar = c.createGain();
  keluar.gain.value = volume * 0.5;
  keluar.connect(c.destination);
  for (const n of nada) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = n.bentuk;
    o.frequency.setValueAtTime(n.f, t0 + n.t);
    if (n.f2) o.frequency.exponentialRampToValueAtTime(n.f2, t0 + n.t + n.d);
    // Selubung singkat agar tidak ada bunyi klik.
    g.gain.setValueAtTime(0.0001, t0 + n.t);
    g.gain.exponentialRampToValueAtTime(n.g, t0 + n.t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.t + n.d);
    o.connect(g).connect(keluar);
    o.start(t0 + n.t);
    o.stop(t0 + n.t + n.d + 0.02);
  }
  return true;
}

function getar(pola: number[] | undefined): boolean {
  if (!pola || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  try {
    return navigator.vibrate(pola);
  } catch {
    return false;
  }
}

let judulAsli: string | null = null;
function tandaiJudul(teks: string): void {
  if (judulAsli === null) judulAsli = document.title;
  document.title = `${teks} ${judulAsli}`;
}
function pulihkanJudul(): void {
  if (judulAsli !== null) document.title = judulAsli;
  judulAsli = null;
}

async function registrasi(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return (await navigator.serviceWorker.getRegistration(`${BASE}/`)) ?? null;
  } catch {
    return null;
  }
}

async function tampilkanNotifikasi(p: Peristiwa): Promise<boolean> {
  const teks = TEKS_NOTIFIKASI[p];
  if (!teks || typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  const opsi: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
    body: teks.isi,
    tag: TAG_GILIRAN,
    renotify: true,
    icon: `${BASE}/icon-192.png?v=2`,
    badge: `${BASE}/icon-192.png?v=2`,
    vibrate: POLA_GETAR[p],
    data: { url: window.location.href },
  };
  const reg = await registrasi();
  try {
    // Android Chrome hanya mengizinkan notifikasi lewat service worker.
    if (reg) await reg.showNotification(teks.judul, opsi);
    else new Notification(teks.judul, opsi);
    return true;
  } catch {
    return false;
  }
}

/** Tutup notifikasi giliran yang masih tampil (mis. sudah bukan giliranmu atau aplikasi dibuka lagi). */
export async function tutupNotifikasiGiliran(): Promise<void> {
  const reg = await registrasi();
  try {
    (await reg?.getNotifications({ tag: TAG_GILIRAN }))?.forEach((n) => n.close());
  } catch {
    // abaikan
  }
}

/** Bunyikan umpan balik sebuah peristiwa sesuai pengaturan pemain. */
export function umpan(p: Peristiwa): void {
  if (typeof window === 'undefined') return;
  const s = bacaUmpan();
  const tersembunyi = document.visibilityState === 'hidden';
  const suara = s.suara && mainkanNada(EFEK[p], s.volume);
  const bergetar = s.getar && getar(POLA_GETAR[p]);
  const notif = s.notifikasi && tersembunyi && perluNotifikasi(p);
  if (tersembunyi && perluNotifikasi(p)) tandaiJudul('(Giliranmu!)');
  const catatan: CatatanUmpan = { p, suara, getar: bergetar, notif, waktu: Date.now() };
  window.__umpan = [...(window.__umpan ?? []).slice(-49), catatan];
  if (notif) void tampilkanNotifikasi(p).then((ok) => { catatan.notif = ok; });
}

/** Daftarkan service worker minimal (hanya untuk notifikasi; tidak menyimpan cache halaman). */
export async function daftarkanSW(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register(`${BASE}/sw.js`, { scope: `${BASE}/`, updateViaCache: 'none' });
  } catch {
    // Tanpa service worker, notifikasi memakai Notification biasa (desktop).
  }
}

/** Minta izin notifikasi (harus dari ketukan pengguna). */
export async function mintaIzinNotifikasi(): Promise<NotificationPermission | 'tidakDidukung'> {
  if (typeof Notification === 'undefined') return 'tidakDidukung';
  try {
    await daftarkanSW();
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function lingkunganNotifikasi(): { adaApi: boolean; izin: string | null; ios: boolean; terpasang: boolean } {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const terpasang = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const adaApi = typeof Notification !== 'undefined';
  return { adaApi, izin: adaApi ? Notification.permission : null, ios, terpasang: !!terpasang };
}

/** Putar contoh suara dari layar pengaturan (dipanggil dari ketukan, jadi audio pasti terbuka). */
export function cobaSuara(): void {
  bukaKunciAudio();
  const s = bacaUmpan();
  window.setTimeout(() => {
    if (s.suara) mainkanNada(EFEK.giliranmu, s.volume);
    if (s.getar) getar(POLA_GETAR.giliranmu);
  }, 30);
}
