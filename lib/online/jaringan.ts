// Transport online: Supabase Realtime broadcast di kanal privat (RLS di realtime.messages, lihat migrasi).
// - "ww:KODE": hanya host yang boleh mengirim; semua anggota menerima view publik.
// - "ww:KODE:<uid>": hanya pemain itu dan host. View pribadi (peran, hasil Peramal, aksi malam, chat werewolf)
//   dan aksi pemain lewat sini, jadi info rahasia tidak pernah tersiar ke seluruh room.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../supabase/klien';
import { buatRoom, catatHasilRoom, daftarAnggota, gabungRoom, keluarRoom } from '../supabase/data';
import {
  aksiSah,
  barisHasil,
  prosesAksiHost,
  prosesAksiPemain,
  sinkronAnggota,
  stateHostBaru,
  topikPemain,
  topikRoom,
  viewPribadi,
  viewPublik,
  type AksiHost,
  type AksiPemain,
  type StateHost,
  type ViewPribadi,
  type ViewPublik,
} from './protokol';

export const JEDA_DETAK_MS = 4000;
export const JEDA_ANGGOTA_MS = 2500;
export const BATAS_HOST_DIAM_MS = 15000;

export interface SesiOnline {
  kode: string;
  host: boolean;
}

const KUNCI_SESI = 'werewolf:sesi';
const kunciHost = (kode: string) => `werewolf:host:${kode}`;
const kunciTercatat = (idMain: string) => `werewolf:tercatat:${idMain}`;

export function bacaSesi(): SesiOnline | null {
  try {
    const s = JSON.parse(localStorage.getItem(KUNCI_SESI) ?? 'null') as SesiOnline | null;
    return s && typeof s.kode === 'string' ? s : null;
  } catch {
    return null;
  }
}

export function simpanSesi(s: SesiOnline | null): void {
  if (s) localStorage.setItem(KUNCI_SESI, JSON.stringify(s));
  else localStorage.removeItem(KUNCI_SESI);
}

function bacaStateHost(kode: string, hostId: string): StateHost | null {
  try {
    const s = JSON.parse(localStorage.getItem(kunciHost(kode)) ?? 'null') as StateHost | null;
    return s && s.kode === kode && s.hostId === hostId ? s : null;
  } catch {
    return null;
  }
}

export type StatusSambung = 'menyambung' | 'tersambung' | 'terputus';

export interface Pendengar {
  publik: (v: ViewPublik) => void;
  pribadi: (v: ViewPribadi) => void;
  status: (s: StatusSambung, info?: string) => void;
}

async function kanal(topik: string): Promise<RealtimeChannel> {
  const sb = supabase();
  try {
    // Kanal privat memakai JWT pengguna; pastikan token terbaru sudah dipasang.
    await sb.realtime.setAuth();
  } catch {
    // tetap coba; subscribe akan gagal bila token tidak sah
  }
  return sb.channel(topik, { config: { private: true, broadcast: { self: false, ack: false } } });
}

function langgan(ch: RealtimeChannel, siap: (ok: boolean, status: string) => void): void {
  ch.subscribe((s) => siap(s === 'SUBSCRIBED', s));
}

/* ---------------------------------- Host ---------------------------------- */

export class HostRoom {
  state: StateHost;
  private ruang: RealtimeChannel | null = null;
  private kanalPemain = new Map<string, RealtimeChannel>();
  private timer: ReturnType<typeof setInterval>[] = [];
  private selesai = false;

  constructor(
    readonly kode: string,
    readonly hostId: string,
    nama: string,
    private dengar: Pendengar,
  ) {
    this.state = bacaStateHost(kode, hostId) ?? stateHostBaru(kode, hostId, nama);
  }

  async mulai(): Promise<'ok' | 'dipakai'> {
    const r = await buatRoom(this.kode);
    if (r !== 'ok') return r;
    simpanSesi({ kode: this.kode, host: true });
    this.dengar.status('menyambung');
    const ruang = await kanal(topikRoom(this.kode));
    this.ruang = ruang;
    langgan(ruang, (ok, s) => {
      this.dengar.status(ok ? 'tersambung' : s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' ? 'terputus' : 'menyambung', s);
      if (ok) this.siarkan();
    });
    for (const a of this.state.anggota) if (a.id !== this.hostId) void this.pasangPemain(a.id);
    this.timer.push(setInterval(() => void this.sinkronAnggota(), JEDA_ANGGOTA_MS));
    this.timer.push(setInterval(() => this.kirimPublik(), JEDA_DETAK_MS));
    // Perpanjang masa room di server tiap 30 menit.
    this.timer.push(setInterval(() => void buatRoom(this.kode).catch(() => {}), 30 * 60 * 1000));
    void this.sinkronAnggota();
    this.terbitLokal();
    return 'ok';
  }

  private async sinkronAnggota(): Promise<void> {
    try {
      const daftar = await daftarAnggota(this.kode);
      const baru = sinkronAnggota(this.state, daftar.map((d) => ({ id: d.user_id, nama: d.username })));
      for (const d of daftar) if (d.user_id !== this.hostId && !this.kanalPemain.has(d.user_id)) void this.pasangPemain(d.user_id);
      if (baru !== this.state) this.ganti(baru);
    } catch {
      // coba lagi pada putaran berikutnya
    }
  }

  private async pasangPemain(uid: string): Promise<void> {
    if (this.selesai || this.kanalPemain.has(uid)) return;
    const ch = await kanal(topikPemain(this.kode, uid));
    if (this.selesai || this.kanalPemain.has(uid)) {
      void supabase().removeChannel(ch);
      return;
    }
    this.kanalPemain.set(uid, ch);
    ch.on('broadcast', { event: 'aksi' }, (m: { payload?: unknown }) => {
      const a = aksiSah(m.payload);
      if (a) this.terimaAksi(uid, a);
    });
    langgan(ch, (ok) => {
      if (ok) this.kirimPribadi(uid);
    });
  }

  private terimaAksi(uid: string, a: AksiPemain): void {
    if (a.jenis === 'halo') {
      this.kirimPribadi(uid);
      this.kirimPublik();
      return;
    }
    const h = prosesAksiPemain(this.state, uid, a);
    if (h.berubah) this.ganti(h.state);
    if (h.galat) this.kirimPribadi(uid, h.galat);
  }

  /** Aksi host sebagai pemain (lewat jalur yang sama dengan pemain lain, tanpa jaringan). */
  aksiSendiri(a: AksiPemain): string | null {
    const h = prosesAksiPemain(this.state, this.hostId, a);
    if (h.berubah) this.ganti(h.state);
    else this.terbitLokal(h.galat);
    return h.galat;
  }

  aksiHost(a: AksiHost): string | null {
    const h = prosesAksiHost(this.state, a);
    if (h.berubah) this.ganti(h.state);
    return h.galat;
  }

  private ganti(s: StateHost): void {
    this.state = s;
    try {
      localStorage.setItem(kunciHost(this.kode), JSON.stringify(s));
    } catch {
      // penyimpanan penuh: tetap jalan
    }
    this.siarkan();
    void this.catatHasil();
  }

  private async catatHasil(): Promise<void> {
    const g = this.state.game;
    if (!g || g.fase !== 'selesai') return;
    if (localStorage.getItem(kunciTercatat(g.idMain))) return;
    const baris = barisHasil(g);
    if (baris.length < 4) return;
    localStorage.setItem(kunciTercatat(g.idMain), '1');
    try {
      await catatHasilRoom(this.kode, g.idMain, baris);
    } catch {
      localStorage.removeItem(kunciTercatat(g.idMain));
    }
  }

  private siarkan(): void {
    this.kirimPublik();
    for (const uid of this.kanalPemain.keys()) this.kirimPribadi(uid);
    this.terbitLokal();
  }

  private terbitLokal(galat: string | null = null): void {
    this.dengar.publik(viewPublik(this.state));
    this.dengar.pribadi(viewPribadi(this.state, this.hostId, galat));
  }

  private kirimPublik(): void {
    if (!this.ruang) return;
    void this.ruang.send({ type: 'broadcast', event: 'publik', payload: viewPublik(this.state) }).catch(() => {});
  }

  private kirimPribadi(uid: string, galat: string | null = null): void {
    const ch = this.kanalPemain.get(uid);
    if (!ch) return;
    void ch.send({ type: 'broadcast', event: 'pribadi', payload: viewPribadi(this.state, uid, galat) }).catch(() => {});
  }

  hentikan(): void {
    this.selesai = true;
    for (const t of this.timer) clearInterval(t);
    const sb = supabase();
    if (this.ruang) void sb.removeChannel(this.ruang);
    for (const ch of this.kanalPemain.values()) void sb.removeChannel(ch);
    this.kanalPemain.clear();
  }

  async tutup(): Promise<void> {
    this.hentikan();
    localStorage.removeItem(kunciHost(this.kode));
    simpanSesi(null);
    await keluarRoom(this.kode).catch(() => {});
  }
}

/* --------------------------------- Pemain --------------------------------- */

export class PemainRoom {
  private ruang: RealtimeChannel | null = null;
  private milikku: RealtimeChannel | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private dapatPribadi = false;
  private selesai = false;
  terakhirHost = 0;

  constructor(
    readonly kode: string,
    readonly uid: string,
    private dengar: Pendengar,
  ) {}

  /** 'ok', atau 'tidak_ada' bila room tidak ditemukan. */
  async mulai(): Promise<'ok' | 'tidak_ada'> {
    const host = await gabungRoom(this.kode);
    if (!host) return 'tidak_ada';
    simpanSesi({ kode: this.kode, host: false });
    this.dengar.status('menyambung');
    const ruang = await kanal(topikRoom(this.kode));
    this.ruang = ruang;
    ruang.on('broadcast', { event: 'publik' }, (m: { payload?: unknown }) => {
      const v = m.payload as ViewPublik | undefined;
      if (!v || v.kode !== this.kode) return;
      this.terakhirHost = Date.now();
      this.dengar.publik(v);
    });
    langgan(ruang, (ok, s) => this.dengar.status(ok ? 'tersambung' : s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' ? 'terputus' : 'menyambung', s));
    const milikku = await kanal(topikPemain(this.kode, this.uid));
    this.milikku = milikku;
    milikku.on('broadcast', { event: 'pribadi' }, (m: { payload?: unknown }) => {
      const v = m.payload as ViewPribadi | undefined;
      if (!v || v.untuk !== this.uid) return;
      this.dapatPribadi = true;
      this.terakhirHost = Date.now();
      this.dengar.pribadi(v);
    });
    langgan(milikku, (ok) => {
      if (ok) this.kirim({ jenis: 'halo' });
    });
    // Sapa host berulang sampai view pribadi pertama datang, lalu sesekali (pulih setelah putus).
    let n = 0;
    this.timer = setInterval(() => {
      n++;
      if (!this.dapatPribadi || n % 5 === 0 || Date.now() - this.terakhirHost > BATAS_HOST_DIAM_MS) this.kirim({ jenis: 'halo' });
    }, 2000);
    return 'ok';
  }

  kirim(a: AksiPemain): void {
    if (!this.milikku || this.selesai) return;
    void this.milikku.send({ type: 'broadcast', event: 'aksi', payload: a }).catch(() => {});
  }

  hentikan(): void {
    this.selesai = true;
    if (this.timer) clearInterval(this.timer);
    const sb = supabase();
    if (this.ruang) void sb.removeChannel(this.ruang);
    if (this.milikku) void sb.removeChannel(this.milikku);
  }

  async keluar(): Promise<void> {
    this.hentikan();
    simpanSesi(null);
    await keluarRoom(this.kode).catch(() => {});
  }
}
