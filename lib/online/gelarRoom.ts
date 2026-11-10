// Ambil gelar pemain di room berdasarkan username (uid host tidak dibagikan ke klien).
import { useEffect, useMemo, useState } from 'react';
import { profilTercache } from '../supabase/data';
import {
  ambilGelarPemain, EVENT_GELAR_BERUBAH, gelarTeksDari, type GelarPemainApi, type SlotMusimApi,
} from '../supabase/peringkatMusim';

export interface InfoGelar {
  frame: SlotMusimApi | null;
  teks: string;
  keterangan: string | null;
  slot: SlotMusimApi[];
}

const kosong: InfoGelar = { frame: null, teks: '', keterangan: null, slot: [] };

export function infoDariGelar(g: GelarPemainApi | undefined): InfoGelar {
  if (!g) return kosong;
  const t = gelarTeksDari(g);
  return { frame: t.frame, teks: t.teks, keterangan: t.keterangan, slot: g.slot };
}

/** Peta username(lowercase) → info gelar. Cache singkat di ambilGelarPemain. */
export function usePetaGelar(namas: readonly string[]): Map<string, InfoGelar> {
  const kunci = useMemo(() => [...new Set(namas.map((n) => n.trim()).filter(Boolean))].sort().join('|'), [namas]);
  const [peta, setPeta] = useState<Map<string, InfoGelar>>(() => new Map());
  const [segar, setSegar] = useState(0);
  useEffect(() => {
    const h = () => setSegar((n) => n + 1);
    window.addEventListener(EVENT_GELAR_BERUBAH, h);
    return () => window.removeEventListener(EVENT_GELAR_BERUBAH, h);
  }, []);
  useEffect(() => {
    let hidup = true;
    const daftar = kunci ? kunci.split('|') : [];
    if (!daftar.length) return () => { hidup = false; };
    (async () => {
      const profil = await Promise.all(daftar.map(async (n) => [n, await profilTercache(n)] as const));
      const ids = profil.map(([, p]) => p?.id).filter((x): x is string => !!x);
      const gelar = ids.length ? await ambilGelarPemain(ids).catch(() => []) : [];
      const byId = new Map(gelar.map((g) => [g.user_id, g]));
      const m = new Map<string, InfoGelar>();
      for (const [n, p] of profil) {
        if (!p) continue;
        m.set(n.toLowerCase(), infoDariGelar(byId.get(p.id)));
      }
      if (hidup) setPeta(m);
    })().catch(() => { if (hidup) setPeta(new Map()); });
    return () => { hidup = false; };
  }, [kunci, segar]);
  return kunci ? peta : new Map();
}

export function gelarNama(peta: Map<string, InfoGelar>, nama: string): InfoGelar {
  return peta.get(nama.toLowerCase()) ?? kosong;
}
