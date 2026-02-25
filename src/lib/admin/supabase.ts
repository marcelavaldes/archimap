import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Create a Supabase client with the service role key for admin write operations.
 * This bypasses RLS policies — use only in authenticated admin routes.
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
