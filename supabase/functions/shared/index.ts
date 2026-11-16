// Opens a Board share link: given its secret token, returns the shared note (or every note with the shared tag)
// read-only, with short-lived links to any pictures, PDFs or recordings.
// Anyone holding the link may call it, so deploy with verify_jwt = false. It never reveals who shared it.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

// Only what a reader needs to see: no owner id, no internal fields.
const COLS = 'id,body,url,tags,due_at,all_day,kind,done,created_at,image_path,ocr_text,repeat,location,file_path,file_type,file_name,duration_min';
const HOUR = 3600;

async function signed(bucket: string, path: string | null) {
  if (!path) return null;
  const { data } = await db.storage.from(bucket).createSignedUrl(path, HOUR);
  return data?.signedUrl ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const { token } = await req.json().catch(() => ({}));
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return json({ error: 'This link is not valid.' }, 404);

  const { data: share, error } = await db.from('shares').select('owner_id,item_id,tag').eq('token', token).maybeSingle();
  if (error) return json({ error: 'Could not open the link.' }, 500);
  if (!share) return json({ error: 'This link has been turned off, or never existed.' }, 404);

  let q = db.from('items').select(COLS).eq('user_id', share.owner_id).eq('archived', false);
  q = share.item_id ? q.eq('id', share.item_id) : q.contains('tags', [share.tag]);
  const { data: items, error: e2 } = await q.order('due_at', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }).limit(500);
  if (e2) return json({ error: 'Could not open the link.' }, 500);

  const out = await Promise.all((items ?? []).map(async (it) => {
    const { image_path, file_path, ...rest } = it as Record<string, unknown> & { image_path: string | null; file_path: string | null };
    return { ...rest, image_url: await signed('images', image_path), file_url: await signed('files', file_path) };
  }));
  return json({ title: share.tag ? `#${share.tag}` : null, items: out });
});
