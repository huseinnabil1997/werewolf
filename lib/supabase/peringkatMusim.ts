// Akses peringkat musiman & gelar lewat RPC Supabase.
import { baca, KUNCI, simpan } from '../storage';
import {
  KATEGORI_MUSIM, META_KATEGORI, URUT_KATEGORI_DEFAULT, bolehFrame, kodeMusim, keteranganSlot, pesanMasukTop3,
  pilihGelarDefault, slotBaruMasuk, teksGelar, type GelarDipasang, type KategoriMusim, type SlotPeringkat,
} from '../peringkatMusim';
import { supabase } from './klien';

export { KATEGORI_MUSIM, META_KATEGORI, bolehFrame, kodeMusim, keteranganSlot, pesanMasukTop3, teksGelar };
export type { KategoriMusim, SlotPeringkat };

export interface SlotMusimApi {
  kategori: KategoriMusim;
  peringkat: 1 | 2 | 3;
  main: number;
  menang: number;
  metrik: number;
}

export interface AwardApi {
  id: number;
  kategori: KategoriMusim;
  peringkat: 1 | 2 | 3;
  musim: string;
  main: number;
  menang: number;
  metrik: number;
}

export interface GelarPemainApi {
  user_id: string;
  username: string;
  avatar_versi: number | null;
  gelar_dipasang: string | null;
  musim: string;
  slot: SlotMusimApi[];
  award: AwardApi[];
}

export interface BarisTopMusim {
  user_id: string;
  username: string;
  avatar_versi: number | null;
  peringkat: 1 | 2 | 3;
  kategori: KategoriMusim;
  main: number;
  menang: number;
  metrik: number;
  musim: string;
}

const cacheGelar = new Map<string, { waktu: number; data: GelarPemainApi }>();
const CACHE_MS = 30_000;

/** Dipicu setelah pilihan gelar berubah (optimistik atau dari server). */
export const EVENT_GELAR_BERUBAH = 'gelar:berubah';

export function lupakanGelar(userId?: string): void {
  if (!userId) cacheGelar.clear();
  else cacheGelar.delete(userId);
}

/** Hapus cache lalu minta UI (room/profil) memuat ulang frame/gelar. */
export function mintaSegarGelar(userId?: string): void {
  lupakanGelar(userId);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT_GELAR_BERUBAH, { detail: { userId } }));
  }
}

/** Tulis cache lokal lalu beri tahu UI room/profil agar frame ikut. */
export function tulisCacheGelar(g: GelarPemainApi): void {
  cacheGelar.set(g.user_id, { waktu: Date.now(), data: g });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT_GELAR_BERUBAH, { detail: { userId: g.user_id } }));
  }
}

export async function ambilTopMusim(musim?: string): Promise<BarisTopMusim[]> {
  const { data, error } = await supabase().rpc('top_musim', { p_musim: musim ?? null });
  if (error) throw error;
  return (data ?? []) as BarisTopMusim[];
}

export async function finalisasiMusim(musim?: string): Promise<number> {
  const { data, error } = await supabase().rpc('finalisasi_musim', { p_musim: musim ?? null });
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function ambilGelarPemain(userIds: string[], paksa = false): Promise<GelarPemainApi[]> {
  const sekarang = Date.now();
  const kurang = paksa ? userIds : userIds.filter((id) => {
    const c = cacheGelar.get(id);
    return !c || sekarang - c.waktu > CACHE_MS;
  });
  if (kurang.length) {
    const { data, error } = await supabase().rpc('gelar_pemain', { p_user_id: kurang });
    if (error) throw error;
    for (const g of (data as GelarPemainApi[] | null) ?? []) {
      cacheGelar.set(g.user_id, { waktu: sekarang, data: g });
    }
  }
  return userIds.map((id) => cacheGelar.get(id)?.data).filter((x): x is GelarPemainApi => !!x);
}

export async function pasangGelar(nilai: string | null): Promise<void> {
  const { error } = await supabase().rpc('pasang_gelar', { p_nilai: nilai ?? 'otomatis' });
  if (error) throw error;
}

/** Gelar teks yang sedang dipasang (musim atau award), tanpa memutuskan frame. */
export function gelarTeksDari(g: GelarPemainApi): { teks: string; frame: SlotMusimApi | null; keterangan: string | null } {
  const musim = g.musim || kodeMusim();
  const slotKe = (s: SlotMusimApi): SlotPeringkat => ({
    userId: g.user_id, peringkat: s.peringkat, kategori: s.kategori, main: s.main, menang: s.menang,
    winrate: s.kategori === 'winrate' ? Number(s.metrik) : s.main ? s.menang / s.main : null, metrik: Number(s.metrik),
  });

  let dipilih: GelarDipasang | null = null;
  let award: AwardApi | null = null;

  if (g.gelar_dipasang?.startsWith('musim:')) {
    const [, m, kat, per] = g.gelar_dipasang.split(':');
    const s = g.slot.find((x) => x.kategori === kat && String(x.peringkat) === per && m === musim);
    if (s) dipilih = { sumber: 'musim', kategori: s.kategori, peringkat: s.peringkat, musim };
  } else if (g.gelar_dipasang?.startsWith('award:')) {
    const id = Number(g.gelar_dipasang.slice(6));
    award = g.award.find((a) => a.id === id) ?? null;
    if (award) dipilih = { sumber: 'award', kategori: award.kategori, peringkat: award.peringkat, musim: award.musim };
  }
  if (!dipilih) {
    const slots: SlotPeringkat[] = g.slot.map(slotKe);
    dipilih = pilihGelarDefault(slots, musim);
  }

  // Frame HANYA dari slot musim berjalan, bukan dari award.
  const frameSlot = g.slot.find((s) =>
    dipilih && dipilih.sumber === 'musim' && bolehFrame(musim) && s.kategori === dipilih.kategori && s.peringkat === dipilih.peringkat
  ) ?? (bolehFrame(musim) ? [...g.slot].sort((a, b) => a.peringkat - b.peringkat || URUT_KATEGORI_DEFAULT.indexOf(a.kategori) - URUT_KATEGORI_DEFAULT.indexOf(b.kategori))[0] : undefined);

  // Teks: kalau gelar dipasang award, pakai award; kalau musim, pakai slot; default otomatis.
  let teks = '';
  let ket: string | null = null;
  if (dipilih?.sumber === 'award' && award) {
    teks = teksGelar({ kategori: award.kategori, peringkat: award.peringkat, musim: award.musim, sumber: 'award' });
    ket = keteranganSlot(slotKe({ ...award, metrik: Number(award.metrik) }));
  } else if (dipilih) {
    teks = teksGelar(dipilih);
    const s = g.slot.find((x) => x.kategori === dipilih!.kategori && x.peringkat === dipilih!.peringkat);
    ket = s ? keteranganSlot(slotKe(s)) : null;
  }

  // Visual frame: hanya bila ada slot musim berjalan. Award tidak memberi frame.
  // Frame mengikuti gelar musim yang dipasang, atau default slot terbaik musim ini.
  let frame: SlotMusimApi | null = null;
  if (bolehFrame(musim) && g.slot.length) {
    if (dipilih?.sumber === 'musim') {
      frame = g.slot.find((s) => s.kategori === dipilih!.kategori && s.peringkat === dipilih!.peringkat) ?? null;
    } else {
      // Award dipilih sebagai teks: tetap boleh menampilkan frame dari ranking musim berjalan terbaik.
      frame = frameSlot ?? null;
    }
  }
  return { teks, frame, keterangan: ket };
}

/** Snapshot lokal top-3 milik sendiri untuk notifikasi. */
export function bacaSnapshotTop3(): { kategori: KategoriMusim; peringkat: 1 | 2 | 3 }[] {
  return baca(KUNCI.top3Musim, []);
}

export function simpanSnapshotTop3(slot: SlotMusimApi[]): void {
  simpan(KUNCI.top3Musim, slot.map((s) => ({ kategori: s.kategori, peringkat: s.peringkat })));
}

export function cekNotifikasiTop3(slot: SlotMusimApi[]): string | null {
  const sekarang: SlotPeringkat[] = slot.map((s) => ({
    userId: '', peringkat: s.peringkat, kategori: s.kategori, main: s.main, menang: s.menang, winrate: null, metrik: Number(s.metrik),
  }));
  const baru = slotBaruMasuk(sekarang, bacaSnapshotTop3());
  simpanSnapshotTop3(slot);
  return baru[0] ? pesanMasukTop3(baru[0]) : null;
}
