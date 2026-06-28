import { createClient, type SupabaseClient, type Session, type User } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Lazily-constructed Supabase client. Auth-sync features are opt-in: if the
 * Supabase env vars aren't configured, every export here no-ops so the app
 * still works in local-only mode.
 */
let _client: SupabaseClient | null = null;
export function getSupabase(): SupabaseClient | null {
  if (_client) return _client;
  if (!url || !anonKey) return null;
  _client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // Use the URL flow that puts the OAuth code in the query string so
      // canvas's hash router doesn't intercept the fragment.
      flowType: 'pkce',
    },
  });
  return _client;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}

export type { Session, User };
