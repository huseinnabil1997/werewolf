// Transport online.
// Jalur utama: Supabase Realtime broadcast di kanal privat (RLS di realtime.messages, lihat migrasi).
// - "ww:KODE": hanya host yang boleh mengirim; semua anggota menerima view publik.
// - "ww:KODE:<uid>": hanya pemain itu dan host. View pribadi (peran, hasil Peramal, aksi malam, chat werewolf)
//   dan aksi pemain lewat sini, jadi info rahasia tidak pernah tersiar ke seluruh room.
// Jalur cadangan: PeerJS (WebRTC DataChannel langsung pemain ke host, terenkripsi DTLS). Dipakai pemain bila
// Realtime tidak bisa tersambung. Identitas pemain diverifikasi host lewat nonce sekali pakai dari gabung_room.
// Host berdetak ke server tiap 5 detik dan menyimpan snapshot state terenkripsi. Bila host diam 15 detik atau
// keluar, anggota lain mengambil alih (ambil_alih_host) dan melanjutkan permainan dari snapshot.
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { DataConnection, Peer as PeerT } from 'peerjs';
import { supabase } from '../supabase/klien';
import {
  ambilAlihHost,
  buatRoom,
  catatHasilRoom,
  daftarAnggota,
  detakHost,
  gabungRoom,
  infoRoom,
  keluarkanAnggota,
  keluarRoom,
  verifikasiPemain,
} from '../supabase/room';
import { bukaSandi, imporKunci, sandikan } from './kripto';
import {
  BATAS_OFFLINE_MS,
  aksiSah,
  barisHasil,
  metaPublik,
  peerIdHost,
  pindahHost,
  prosesAksiHost,
  prosesAksiPemain,
  prosesWaktu,
  rapikanStateHost,
  sinkronAnggota,
  stateHostBaru,
  topikPemain,
  topikRoom,
  viewPribadi,
  viewPublik,
  type AksiHost,
  type AksiPemain,
  type InfoMatch,
  type StateHost,
  type ViewPribadi,
  type ViewPublik,
} from './protokol';
import type { BatasWaktu } from '../batasWaktu';

export const JEDA_DETAK_MS = 5000;
export const JEDA_PUBLIK_MS = 4000;
export const JEDA_ANGGOTA_MS = 2500;
export const JEDA_HALO_MS = 4000;
export const BATAS_HOST_DIAM_MS = 15000;
/** Pemain beralih ke jalur cadangan bila Realtime belum tersambung selama ini. */
export const BATAS_REALTIME_MS = 8000;

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

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
    const s = rapikanStateHost(JSON.parse(localStorage.getItem(kunciHost(kode)) ?? 'null'), kode);
    return s && s.hostId === hostId ? s : null;
  } catch {
    return null;
  }
}

export type StatusSambung = 'menyambung' | 'tersambung' | 'terputus' | 'tidakAda';
export type Jalur = 'realtime' | 'peerjs';

export interface Pendengar {
  publik: (v: ViewPublik) => void;
  pribadi: (v: ViewPribadi) => void;
  status: (s: StatusSambung, info?: string) => void;
  /** Pemain ini menjadi host (host lama pergi). */
  jadiHost: (s: StateHost) => void;
  /** Perangkat ini tidak lagi menjadi host (host lain sudah mengambil alih). */
  jadiPemain: () => void;
  jalur?: (j: Jalur) => void;
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

async function buatPeer(id?: string): Promise<PeerT> {
  const { Peer } = await import('peerjs');
  const opsi = { config: { iceServers: ICE_SERVERS }, debug: 0 };
  return id ? new Peer(id, opsi) : new Peer(opsi);
}

type PesanPeer =
  | { t: 'kenal'; nonce: string }
  | { t: 'aksi'; a: unknown }
  | { t: 'publik'; v: ViewPublik }
  | { t: 'pribadi'; v: ViewPribadi };

/* ---------------------------------- Host ---------------------------------- */

export interface OpsiHost {
  /** State hasil pindah host (dari snapshot). */
  state?: StateHost;
  batas?: BatasWaktu;
  publik?: boolean;
  match?: InfoMatch | null;
}

export class HostRoom {
  state: StateHost;
  private ruang: RealtimeChannel | null = null;
  private kanalPemain = new Map<string, RealtimeChannel>();
  private peer: PeerT | null = null;
  private koneksiPeer = new Map<string, DataConnection>();
  private timer: ReturnType<typeof setInterval>[] = [];
  private terlihat = new Map<string, number>();
  private onlineTerakhir = '';
  private versiTerunggah = -1;
  private kunci: CryptoKey | null = null;
  private selesai = false;

  constructor(
    readonly kode: string,
    readonly hostId: string,
    readonly nama: string,
    private dengar: Pendengar,
    opsi: OpsiHost = {},
  ) {
    this.state = opsi.state ?? bacaStateHost(kode, hostId) ?? stateHostBaru(kode, hostId, nama, opsi);
    // Anggota lama diberi waktu tenggang agar tidak langsung tampil offline setelah host pulih atau pindah.
    const sekarang = Date.now();
    for (const a of this.state.anggota) this.terlihat.set(a.id, sekarang);
  }

  get online(): Set<string> {
    const s = new Set<string>([this.hostId]);
    const sekarang = Date.now();
    for (const [id, t] of this.terlihat) if (sekarang - t < BATAS_OFFLINE_MS) s.add(id);
    return s;
  }

  async mulai(): Promise<'ok' | 'dipakai'> {
    const r = await buatRoom(this.kode);
    if (r !== 'ok') return r;
    simpanSesi({ kode: this.kode, host: true });
    this.kunci = await imporKunci(this.state.kunciSnapshot);
    this.dengar.status('menyambung');
    const ruang = await kanal(topikRoom(this.kode));
    this.ruang = ruang;
    langgan(ruang, (ok, s) => {
      this.dengar.status(ok ? 'tersambung' : s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' ? 'terputus' : 'menyambung', s);
      if (ok) this.siarkan();
    });
    for (const a of this.state.anggota) if (a.id !== this.hostId) void this.pasangPemain(a.id);
    this.timer.push(setInterval(() => void this.sinkronAnggota(), JEDA_ANGGOTA_MS));
    this.timer.push(setInterval(() => this.kirimPublik(), JEDA_PUBLIK_MS));
    this.timer.push(setInterval(() => void this.detak(), JEDA_DETAK_MS));
    this.timer.push(setInterval(() => this.detik(), 1000));
    void this.sinkronAnggota();
    void this.detak();
    void this.pasangPeer();
    this.terbitLokal();
    return 'ok';
  }

  /** Tiap detik: tenggat langkah dan perubahan status online. */
  private detik(): void {
    const h = prosesWaktu(this.state);
    if (h.berubah) this.ganti(h.state);
    const on = [...this.online].sort().join(',');
    if (on !== this.onlineTerakhir) {
      this.onlineTerakhir = on;
      this.kirimPublik();
      this.terbitLokal();
    }
  }

  private async detak(): Promise<void> {
    if (this.selesai) return;
    try {
      const versi = this.state.versi;
      const snapshot = this.kunci && versi !== this.versiTerunggah ? await sandikan(this.kunci, this.state) : null;
      const ok = await detakHost(this.kode, snapshot, this.state.publik, this.state.publik ? metaPublik(this.state, this.nama, this.online) : null);
      if (snapshot) this.versiTerunggah = versi;
      if (!ok && !this.selesai) {
        // Host lain sudah mengambil alih room ini.
        this.hentikan();
        this.dengar.jadiPemain();
      }
    } catch {
      // coba lagi pada detak berikutnya
    }
  }

  private async sinkronAnggota(): Promise<void> {
    try {
      const daftar = await daftarAnggota(this.kode);
      for (const d of daftar) {
        if (d.user_id === this.hostId) continue;
        if (this.state.dikeluarkan.includes(d.user_id)) {
          this.kirimPribadi(d.user_id);
          void keluarkanAnggota(this.kode, d.user_id).catch(() => {});
          continue;
        }
        if (!this.kanalPemain.has(d.user_id)) void this.pasangPemain(d.user_id);
      }
      const baru = sinkronAnggota(this.state, daftar.map((d) => ({ id: d.user_id, nama: d.username })));
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

  private async pasangPeer(): Promise<void> {
    try {
      const peer = await buatPeer(peerIdHost(this.kode, this.hostId));
      if (this.selesai) {
        peer.destroy();
        return;
      }
      this.peer = peer;
      peer.on('connection', (conn) => this.terimaKoneksi(conn));
      peer.on('error', (e: { type?: string }) => {
        // Id masih dipegang sesi lama (mis. setelah muat ulang): coba lagi sebentar lagi.
        if (e?.type === 'unavailable-id' || e?.type === 'network' || e?.type === 'server-error') {
          peer.destroy();
          if (this.peer === peer) this.peer = null;
          if (!this.selesai) setTimeout(() => void this.pasangPeer(), 8000);
        }
      });
      peer.on('disconnected', () => {
        if (!this.selesai && !peer.destroyed) peer.reconnect();
      });
    } catch {
      // PeerJS tidak tersedia: jalur utama tetap jalan.
    }
  }

  private terimaKoneksi(conn: DataConnection): void {
    let uid: string | null = null;
    conn.on('data', (d: unknown) => {
      const p = d as PesanPeer;
      if (!p || typeof p !== 'object') return;
      if (!uid) {
        if (p.t !== 'kenal' || typeof p.nonce !== 'string') return;
        void verifikasiPemain(this.kode, p.nonce).then((v) => {
          if (!v || this.selesai || this.state.dikeluarkan.includes(v.uid)) {
            conn.close();
            return;
          }
          uid = v.uid;
          this.koneksiPeer.get(uid)?.close();
          this.koneksiPeer.set(uid, conn);
          this.terlihat.set(uid, Date.now());
          void this.sinkronAnggota();
          this.kirimPribadi(uid);
          this.kirimPublikKe(conn);
        }, () => conn.close());
        return;
      }
      if (p.t === 'aksi') {
        const a = aksiSah(p.a);
        if (a) this.terimaAksi(uid, a);
      }
    });
    conn.on('close', () => {
      if (uid && this.koneksiPeer.get(uid) === conn) this.koneksiPeer.delete(uid);
    });
  }

  private terimaAksi(uid: string, a: AksiPemain): void {
    this.terlihat.set(uid, Date.now());
    if (a.jenis === 'halo') {
      this.kirimPribadi(uid);
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
    if (h.berubah && a.jenis === 'keluarkan') {
      this.kirimPribadi(a.id);
      this.koneksiPeer.get(a.id)?.close();
      void keluarkanAnggota(this.kode, a.id).catch(() => {});
    }
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
      setTimeout(() => void this.catatHasil(), 5000);
    }
  }

  private siarkan(): void {
    this.kirimPublik();
    for (const uid of new Set([...this.kanalPemain.keys(), ...this.koneksiPeer.keys()])) this.kirimPribadi(uid);
    this.terbitLokal();
  }

  private terbitLokal(galat: string | null = null): void {
    this.dengar.publik(viewPublik(this.state, this.online));
    this.dengar.pribadi(viewPribadi(this.state, this.hostId, galat));
  }

  private kirimPublik(extra: Partial<ViewPublik> = {}): void {
    const v = { ...viewPublik(this.state, this.online), ...extra };
    if (this.ruang) void this.ruang.send({ type: 'broadcast', event: 'publik', payload: v }).catch(() => {});
    for (const conn of this.koneksiPeer.values()) this.kirimPeer(conn, { t: 'publik', v });
  }

  private kirimPublikKe(conn: DataConnection): void {
    this.kirimPeer(conn, { t: 'publik', v: viewPublik(this.state, this.online) });
  }

  private kirimPeer(conn: DataConnection, p: PesanPeer): void {
    try {
      if (conn.open) void conn.send(p);
    } catch {
      // koneksi putus: dibersihkan saat close
    }
  }

  private kirimPribadi(uid: string, galat: string | null = null): void {
    const v = { ...viewPribadi(this.state, uid, galat), dari: this.hostId };
    const ch = this.kanalPemain.get(uid);
    if (ch) void ch.send({ type: 'broadcast', event: 'pribadi', payload: v }).catch(() => {});
    const conn = this.koneksiPeer.get(uid);
    if (conn) this.kirimPeer(conn, { t: 'pribadi', v });
  }

  hentikan(): void {
    this.selesai = true;
    for (const t of this.timer) clearInterval(t);
    const sb = supabase();
    if (this.ruang) void sb.removeChannel(this.ruang);
    for (const ch of this.kanalPemain.values()) void sb.removeChannel(ch);
    this.kanalPemain.clear();
    for (const c of this.koneksiPeer.values()) c.close();
    this.koneksiPeer.clear();
    this.peer?.destroy();
    this.peer = null;
  }

  /** Host keluar: snapshot terakhir disimpan, room diserahkan ke anggota lain yang langsung mengambil alih. */
  async keluar(): Promise<void> {
    try {
      if (this.kunci) await detakHost(this.kode, await sandikan(this.kunci, this.state), null, null);
    } catch {
      // tetap keluar
    }
    this.kirimPublik({ hostKeluar: true });
    await new Promise((r) => setTimeout(r, 300));
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
  private peer: PeerT | null = null;
  private conn: DataConnection | null = null;
  private dapatPribadi = false;
  private selesai = false;
  private realtimeOk = false;
  private mulaiSejak = Date.now();
  private sedangCekHost = false;
  private cekHostTerakhir = 0;
  private haloTerakhir = 0;
  private kunci = '';
  hostKini = '';
  terakhirHost = 0;
  jalur: Jalur = 'realtime';

  constructor(
    readonly kode: string,
    readonly uid: string,
    private dengar: Pendengar,
  ) {}

  /** 'ok', atau 'tidak_ada' bila room tidak ditemukan. */
  async mulai(): Promise<'ok' | 'tidak_ada'> {
    const info = await gabungRoom(this.kode);
    if (!info) return 'tidak_ada';
    this.hostKini = info.host;
    simpanSesi({ kode: this.kode, host: false });
    this.dengar.status('menyambung');
    this.mulaiSejak = Date.now();
    this.terakhirHost = Date.now();
    const ruang = await kanal(topikRoom(this.kode));
    this.ruang = ruang;
    ruang.on('broadcast', { event: 'publik' }, (m: { payload?: unknown }) => this.terimaPublik(m.payload as ViewPublik | undefined));
    langgan(ruang, (ok, s) => {
      this.realtimeOk = ok;
      if (this.jalur === 'realtime') this.dengar.status(ok ? 'tersambung' : s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' ? 'terputus' : 'menyambung', s);
    });
    const milikku = await kanal(topikPemain(this.kode, this.uid));
    this.milikku = milikku;
    milikku.on('broadcast', { event: 'pribadi' }, (m: { payload?: unknown }) => this.terimaPribadi(m.payload as (ViewPribadi & { dari?: string }) | undefined));
    langgan(milikku, (ok) => {
      if (ok) this.kirim({ jenis: 'halo' });
    });
    this.timer = setInterval(() => this.jaga(), 1000);
    return 'ok';
  }

  private terimaPublik(v: ViewPublik | undefined): void {
    if (!v || v.kode !== this.kode || this.selesai) return;
    if (v.hostId !== this.hostKini) {
      // Pesan dari host yang berbeda: pastikan siapa host sekarang ke server dulu.
      void this.cekHost(true);
      return;
    }
    this.terakhirHost = Date.now();
    this.dengar.publik(v);
    if (v.hostKeluar) void this.cobaAmbilAlih(true);
  }

  private terimaPribadi(v: (ViewPribadi & { dari?: string }) | undefined): void {
    if (!v || v.untuk !== this.uid || this.selesai) return;
    if (v.dari && v.dari !== this.hostKini) return;
    this.dapatPribadi = true;
    this.terakhirHost = Date.now();
    if (v.kunci) this.kunci = v.kunci;
    this.dengar.pribadi(v);
  }

  /** Tiap detik: sapa host, pindah ke jalur cadangan bila perlu, dan ambil alih bila host hilang. */
  private jaga(): void {
    if (this.selesai) return;
    const sekarang = Date.now();
    const jeda = this.dapatPribadi ? JEDA_HALO_MS : 2000;
    if (sekarang - this.haloTerakhir >= jeda) {
      this.haloTerakhir = sekarang;
      this.kirim({ jenis: 'halo' });
    }
    if (!this.realtimeOk && !this.peer && sekarang - this.mulaiSejak > BATAS_REALTIME_MS) void this.pakaiPeer();
    if (sekarang - this.terakhirHost > BATAS_HOST_DIAM_MS) void this.cobaAmbilAlih(false);
  }

  private async cekHost(paksa: boolean): Promise<void> {
    if (this.sedangCekHost || (!paksa && Date.now() - this.cekHostTerakhir < 3000)) return;
    if (paksa && Date.now() - this.cekHostTerakhir < 1500) return;
    this.sedangCekHost = true;
    this.cekHostTerakhir = Date.now();
    try {
      const info = await infoRoom(this.kode);
      if (!info) return;
      if (info.host !== this.hostKini) {
        this.hostKini = info.host;
        this.terakhirHost = Date.now();
        this.tutupPeer();
        if (!this.realtimeOk) void this.pakaiPeer();
        this.kirim({ jenis: 'halo' });
      }
    } catch {
      // coba lagi nanti
    } finally {
      this.sedangCekHost = false;
    }
  }

  private sedangAmbil = false;
  private ambilTerakhir = 0;

  private async cobaAmbilAlih(segera: boolean): Promise<void> {
    if (this.sedangAmbil || this.selesai || (!segera && Date.now() - this.ambilTerakhir < 4000)) return;
    this.sedangAmbil = true;
    this.ambilTerakhir = Date.now();
    try {
      if (segera) await new Promise((r) => setTimeout(r, 400 + Math.random() * 600));
      const info = await infoRoom(this.kode);
      if (!info) {
        this.dengar.status('tidakAda');
        return;
      }
      if (info.hidup && info.host !== this.uid) {
        if (info.host !== this.hostKini) {
          this.hostKini = info.host;
          this.tutupPeer();
          this.kirim({ jenis: 'halo' });
        }
        this.terakhirHost = Date.now();
        return;
      }
      if (!this.kunci) return;
      const r = await ambilAlihHost(this.kode);
      if (!r) return;
      const kunci = await imporKunci(this.kunci);
      const isi = kunci ? await bukaSandi(kunci, r.snapshot) : null;
      const st = rapikanStateHost(isi, this.kode);
      if (!st || this.selesai) return;
      this.hentikan();
      this.dengar.jadiHost(pindahHost(st, this.uid));
    } catch {
      // coba lagi nanti
    } finally {
      this.sedangAmbil = false;
    }
  }

  private async pakaiPeer(): Promise<void> {
    if (this.peer || this.selesai) return;
    try {
      const peer = await buatPeer();
      if (this.selesai) {
        peer.destroy();
        return;
      }
      this.peer = peer;
      peer.on('open', async () => {
        const info = await gabungRoom(this.kode).catch(() => null);
        if (!info || this.selesai || this.peer !== peer) return;
        this.hostKini = info.host;
        const conn = peer.connect(peerIdHost(this.kode, info.host), { reliable: true });
        this.conn = conn;
        conn.on('open', () => {
          void conn.send({ t: 'kenal', nonce: info.nonce } satisfies PesanPeer);
          this.jalur = 'peerjs';
          this.dengar.jalur?.('peerjs');
          this.dengar.status('tersambung', 'peerjs');
        });
        conn.on('data', (d: unknown) => {
          const p = d as PesanPeer;
          if (p?.t === 'publik') this.terimaPublik(p.v);
          else if (p?.t === 'pribadi') this.terimaPribadi(p.v as ViewPribadi & { dari?: string });
        });
        conn.on('close', () => {
          if (this.conn === conn) this.tutupPeer();
        });
      });
      peer.on('error', () => {
        if (this.peer === peer) this.tutupPeer();
      });
    } catch {
      this.peer = null;
    }
  }

  private tutupPeer(): void {
    this.conn?.close();
    this.conn = null;
    this.peer?.destroy();
    this.peer = null;
    if (this.jalur === 'peerjs') {
      this.jalur = 'realtime';
      this.dengar.jalur?.('realtime');
      this.mulaiSejak = Date.now();
    }
  }

  kirim(a: AksiPemain): void {
    if (this.selesai) return;
    if (this.conn?.open) {
      try {
        void this.conn.send({ t: 'aksi', a } satisfies PesanPeer);
        return;
      } catch {
        // jatuh ke Realtime
      }
    }
    if (this.milikku) void this.milikku.send({ type: 'broadcast', event: 'aksi', payload: a }).catch(() => {});
  }

  hentikan(): void {
    this.selesai = true;
    if (this.timer) clearInterval(this.timer);
    const sb = supabase();
    if (this.ruang) void sb.removeChannel(this.ruang);
    if (this.milikku) void sb.removeChannel(this.milikku);
    this.conn?.close();
    this.peer?.destroy();
  }

  async keluar(): Promise<void> {
    this.kirim({ jenis: 'keluar' });
    await new Promise((r) => setTimeout(r, 200));
    this.hentikan();
    simpanSesi(null);
    await keluarRoom(this.kode).catch(() => {});
  }
}
