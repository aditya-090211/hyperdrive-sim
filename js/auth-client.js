// One Overdrive account for the simulator and Overdrive Scout: every page uses this same Supabase client
// (same storage key, PKCE sign-in), so signing in on /signin signs you in everywhere on the site.
import { SUPABASE_URL, SUPABASE_KEY } from './supabase-config.js';

let client = null;
export function getClient() {
  if (client) return client;
  if (!window.supabase?.createClient) return null;
  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'hyperdrive.auth' },
  });
  return client;
}

// where the shared sign-in page should send people back to (only our own pages)
export const RETURN_PAGES = ['/', '/sim', '/scout'];
export const signInUrl = (next) => `/signin?next=${encodeURIComponent(RETURN_PAGES.includes(next) ? next : '/')}`;
