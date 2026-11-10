// URL project dan kunci PUBLISHABLE Supabase (sb_publishable_). Kunci jenis ini memang dirancang untuk ditanam di
// kode frontend: aksesnya dibatasi RLS dan GRANT di database (lihat supabase/migrations). Bisa diganti saat build
// lewat NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Jangan pernah menaruh secret atau
// service_role key di sini.
export const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://scnegojuqctylqlpmlbs.supabase.co';
export const KUNCI_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_x8U2NlmcDu9MpjDBysiR8g_fSSJ8-0x';
