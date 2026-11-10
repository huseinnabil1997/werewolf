// Klien Supabase tunggal untuk browser (sesi login disimpan di localStorage dan diperbarui otomatis).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { KUNCI_SUPABASE, URL_SUPABASE } from './konfig';

let klien: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!klien) {
    klien = createClient(URL_SUPABASE, KUNCI_SUPABASE, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'werewolf:auth' },
    });
  }
  return klien;
}
