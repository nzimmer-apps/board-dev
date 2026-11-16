// Called once a minute by pg_cron (see migration 20261116210000_web_push.sql).
// Sends every reminder in push_schedule that has come due to each of that user's browsers.
// Deploy with verify_jwt = false: it checks the timer's own secret instead.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import { makeVapid, sendPush, type Vapid } from './webpush.ts';

const SUBJECT = Deno.env.get('PUSH_SUBJECT') ?? 'https://github.com/nzimmer-apps';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

async function secret(name: string): Promise<string | null> {
  const { data, error } = await db.rpc('push_secret', { secret_name: name });
  if (error) throw error;
  return (data as string | null) ?? null;
}

// The sender keys are made on the first run and then kept in the vault.
async function vapid(): Promise<Vapid> {
  const priv = await secret('push_vapid_private');
  if (priv) {
    const { data } = await db.from('push_config').select('public_key').eq('id', 1).single();
    return { privateJwk: JSON.parse(priv), publicKey: data!.public_key };
  }
  const v = await makeVapid();
  const { error } = await db.rpc('push_save_keys', { private_jwk: JSON.stringify(v.privateJwk), public_key: v.publicKey });
  if (error) throw error;
  return vapid(); // read back, in case two runs raced
}

Deno.serve(async (req) => {
  const want = await secret('push_cron');
  if (!want || req.headers.get('x-cron-secret') !== want) return new Response('forbidden', { status: 403 });

  const v = await vapid();
  const now = new Date();
  // Due now, and not more than 15 minutes late (after that a reminder is no use).
  const { data: due, error } = await db
    .from('push_schedule')
    .select('user_id,key,title,body,item_id')
    .is('sent_at', null)
    .lte('fire_at', now.toISOString())
    .gte('fire_at', new Date(now.getTime() - 15 * 60e3).toISOString())
    .limit(500);
  if (error) return new Response(error.message, { status: 500 });
  if (!due?.length) return Response.json({ sent: 0, ready: true });

  // Mark them first so a slow run and the next one can't both send the same reminder.
  for (const r of due) {
    await db.from('push_schedule').update({ sent_at: now.toISOString() }).eq('user_id', r.user_id).eq('key', r.key).is('sent_at', null);
  }

  const users = [...new Set(due.map((r) => r.user_id))];
  const { data: subs } = await db.from('push_subscriptions').select('endpoint,p256dh,auth,user_id').in('user_id', users);
  let sent = 0;
  const gone: string[] = [];
  for (const r of due) {
    const payload = JSON.stringify({ title: r.title, body: r.body, itemId: r.item_id, tag: r.key });
    for (const s of (subs ?? []).filter((s) => s.user_id === r.user_id)) {
      try {
        const status = await sendPush(s, payload, v, SUBJECT);
        if (status === 404 || status === 410) gone.push(s.endpoint);
        else if (status < 300) sent++;
        else console.warn('push failed', status, new URL(s.endpoint).host);
      } catch (e) {
        console.warn('push error', (e as Error).message);
      }
    }
  }
  if (gone.length) await db.from('push_subscriptions').delete().in('endpoint', gone);
  // Old sent rows are no longer needed.
  await db.from('push_schedule').delete().lt('fire_at', new Date(now.getTime() - 2 * 864e5).toISOString());
  return Response.json({ sent, due: due.length, removed: gone.length });
});
