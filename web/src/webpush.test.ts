// Tests the push edge function's crypto by playing the browser's part: decrypt what it sends, check its signature.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { b64u, unb64u, encrypt, deriveKeys, makeVapid, vapidAuth, sendPush } from '../../supabase/functions/push/webpush.ts';

async function browserKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { kp, p256dh: b64u(pub), auth: b64u(auth), pub, authRaw: auth };
}

async function decrypt(body: Uint8Array, ua: Awaited<ReturnType<typeof browserKeys>>) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const sealed = body.slice(21 + idlen);
  const as = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: as }, ua.kp.privateKey, 256));
  const { cek, nonce } = await deriveKeys(ua.authRaw, secret, ua.pub, asPublic, salt);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, sealed));
  assert.equal(plain[plain.length - 1], 2, 'last-record delimiter');
  return { text: new TextDecoder().decode(plain.slice(0, -1)), rs, idlen };
}

test('base64url round trip', () => {
  const b = Uint8Array.from([0, 251, 255, 62, 63, 1]);
  assert.deepEqual(unb64u(b64u(b)), b);
  assert.ok(!/[+/=]/.test(b64u(b)));
});

test('a browser can decrypt what is sent', async () => {
  const ua = await browserKeys();
  const msg = JSON.stringify({ title: 'Event at 7:00 PM', body: 'dart league ✓' });
  const out = await decrypt(await encrypt(msg, ua.p256dh, ua.auth), ua);
  assert.equal(out.text, msg);
  assert.equal(out.rs, 4096);
  assert.equal(out.idlen, 65);
});

test('VAPID header is a valid ES256 JWT for the push service', async () => {
  const v = await makeVapid();
  const h = await vapidAuth('https://fcm.googleapis.com/fcm/send/abc', v, 'https://example.test/', 1_000_000_000_000);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h);
  assert.ok(m);
  const claims = JSON.parse(new TextDecoder().decode(unb64u(m[2])));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.exp, 1_000_000_000 + 12 * 3600);
  assert.equal(m[4], v.publicKey);
  const pub = await crypto.subtle.importKey('raw', unb64u(v.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64u(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`));
  assert.ok(ok);
});

test('sendPush posts the encrypted body with the right headers', async () => {
  const ua = await browserKeys();
  const v = await makeVapid();
  let seen: { url: string; init: RequestInit } | null = null;
  const fake = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(null, { status: 201 }); }) as unknown as typeof fetch;
  const status = await sendPush({ endpoint: 'https://push.example/x', p256dh: ua.p256dh, auth: ua.auth }, 'hi', v, 'https://example.test/', fake);
  assert.equal(status, 201);
  const h = seen!.init.headers as Record<string, string>;
  assert.equal(h['Content-Encoding'], 'aes128gcm');
  assert.match(h.Authorization, /^vapid t=/);
  assert.equal((await decrypt(seen!.init.body as Uint8Array, ua)).text, 'hi');
});
