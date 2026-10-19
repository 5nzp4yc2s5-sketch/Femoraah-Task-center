import { createServerClient } from '@supabase/ssr';
import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase/server';

// The company logo, public because the sign-in page shows it. Only PNG, JPEG and WebP are ever
// stored (checked by file signature in the database), and the browser is told not to guess types.
export async function GET(request: Request) {
  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), { cookies: { getAll: () => [], setAll: () => {} } });
  const { data, error } = await supabase.rpc('brand_logo');
  const row = Array.isArray(data) ? (data[0] as { mime: string; data: string } | undefined) : undefined;
  if (error || !row || !['image/png', 'image/jpeg', 'image/webp'].includes(row.mime)) {
    return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  const versioned = new URL(request.url).searchParams.has('v');
  return new Response(Buffer.from(row.data, 'base64'), {
    headers: {
      'Content-Type': row.mime,
      'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}
