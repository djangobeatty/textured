import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { Miniflare, Response as WorkerResponse } from 'miniflare';

const root = new URL('../', import.meta.url);
const compile = (file, imports = {}) => {
  let code = ts.transpileModule(fs.readFileSync(new URL(file, root), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [from, to] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(from), JSON.stringify(to));
  return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
};

const mf = new Miniflare({
  modules: true, compatibilityDate: '2026-05-15', cf: false,
  script: 'export default { fetch() { return new Response("quota-test"); } };',
  d1Databases: { DB: 'quota-tests' },
});
const originalFetch = globalThis.fetch;
const originalCaches = globalThis.caches;
try {
  const db = await mf.getD1Database('DB');
  const migration = fs.readFileSync(new URL('drizzle/0000_daily_allowances.sql', root), 'utf8');
  for (const sql of migration.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean)) await db.prepare(sql).run();
  const quotaUrl = compile('lib/quota.ts');
  const { dailyLimit, quotaIdentity, readUsage, reserveDescription } = await import(quotaUrl);
  const instant = Date.parse('2026-09-18T23:59:59Z');
  assert.equal(dailyLimit(), 50);
  assert.equal(dailyLimit('0'), 0);
  assert.throws(() => dailyLimit('-1'));
  assert.throws(() => dailyLimit('banana'));
  const a = { subject: 'test:browser-a', scope: 'browser' };
  const b = { subject: 'test:browser-b', scope: 'browser' };
  const results = await Promise.all(Array.from({ length: 80 }, () => reserveDescription(db, a, 25, instant)));
  assert.equal(results.filter(r => r.allowed).length, 25, 'concurrent requests cannot overshoot the allowance');
  assert.equal((await readUsage(db, a, 25, instant)).remaining, 0);
  assert.equal((await readUsage(db, b, 25, instant)).remaining, 25, 'browsers are isolated');
  assert.equal((await reserveDescription(db, a, 25, instant + 1000)).usage.remaining, 24, 'resets exactly at UTC midnight');
  assert.equal((await reserveDescription(db, a, 25, instant)).allowed, false, 'late previous-day work cannot reset the current day');
  assert.equal((await readUsage(await mf.getD1Database('DB'), a, 25, instant + 1000)).remaining, 24, 'usage lives in D1, not a module map');
  assert.equal((await reserveDescription(db, b, 0, instant)).allowed, false);

  const base = 'https://synth.test/api/interpret';
  const request = (headers = {}) => new Request(base, { headers });
  const session = await quotaIdentity(db, request(), { create: true, now: instant });
  assert.ok(session.cookie.includes('HttpOnly; SameSite=Strict; Secure'));
  assert.ok(session.cookie.startsWith('__Host-textured_session='));
  assert.equal(session.sessionToken, undefined, 'standalone HttpOnly sessions are not exposed to JavaScript');
  const cookie = session.cookie.split(';')[0];
  const token = cookie.split('=')[1];
  assert.ok(!session.subject.includes(token), 'raw bearer token is not persisted');
  const browserRequest = request({ cookie });
  assert.equal((await quotaIdentity(db, browserRequest, { create: false, now: instant })).subject, session.subject);
  await reserveDescription(db, session, 25, instant);
  const reused = await quotaIdentity(db, browserRequest, { create: true, now: instant + 1 });
  assert.equal(reused.cookie, undefined, 'reloads do not issue a new token');
  assert.equal((await readUsage(db, reused, 25, instant)).remaining, 24);
  assert.equal(await quotaIdentity(db, request({ cookie: '__Host-textured_session=' + '0'.repeat(64) }), { create: false, now: instant }), null, 'forged token denied');
  assert.equal(await quotaIdentity(db, browserRequest, { create: false, now: instant + 31 * 86400000 }), null, 'expired token denied');

  const semanticUrl = compile('lib/semantic.ts');
  const { dimensionKeys, engineKeys, scaleKeys } = await import(semanticUrl);
  const scores = Object.fromEntries(dimensionKeys.map(k => [k, { type: 'score', score: 2, confidence: 1, probabilities: { 0: 0, 1: 0, 2: 1, 3: 0, 4: 0 } }]));
  const choice = (name, keys) => ({ type: 'choice', choice: name, confidence: 1, probabilities: Object.fromEntries(keys.map(k => [k, k === name ? 1 : 0])) });
  const fixture = { model: 'test', answers: { ...scores, engine: choice('bell', engineKeys), harmony: choice('minor', ['major', 'minor', 'suspended', 'chromatic']), scale: choice('minor', scaleKeys), gesture: choice('pluck', ['drone', 'pulse', 'pluck']) } };
  globalThis.__quotaTestEnv = { DB: db, TYPESAFE_API_KEY: 'test-only-not-a-real-key', TYPESAFE_DAILY_LIMIT: '3' };
  const envUrl = 'data:text/javascript,export const env = globalThis.__quotaTestEnv;';
  const dbUrl = compile('db/client.ts', { 'cloudflare:workers': envUrl });
  const cacheUrl = compile('lib/interpretation-cache.ts', { './semantic': semanticUrl });
  const { interpretationCacheKey, INTERPRETATION_CACHE_SECONDS } = await import(cacheUrl);
  assert.equal(INTERPRETATION_CACHE_SECONDS, 300);
  const nativeCache = (await mf.getCaches()).default;
  // Bridge Node's Response class to Miniflare's RPC-compatible Response while
  // using its real Cache API storage and expiry handling.
  globalThis.caches = { default: {
    match: key => nativeCache.match(key.url),
    put: async (key, response) => nativeCache.put(key.url, new WorkerResponse(await response.text(), { status: response.status, headers: Object.fromEntries(response.headers) })),
  } };
  const { GET, POST } = await import(compile('app/api/interpret/route.ts', { '@/db/client': dbUrl, '@/lib/quota': quotaUrl, '@/lib/semantic': semanticUrl, '@/lib/turnstile': compile('lib/turnstile.ts'), '@/lib/interpretation-cache': cacheUrl }));
  let paidCalls = 0;
  let verificationCalls = 0;
  const usedTokens = new Set();
  let busyOnce = true;
  let fail = false;
  globalThis.fetch = async (url, init) => {
    if (String(url) === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
      verificationCalls++;
      const { response: token, secret } = JSON.parse(init.body);
      assert.equal(secret, 'test-secret');
      if (token === 'unavailable') throw new Error('test verification service unavailable');
      if (usedTokens.has(token) || token === 'invalid') return Response.json({ success: false });
      usedTokens.add(token);
      return Response.json({ success: true, hostname: token === 'wrong-host' ? 'evil.test' : 'synth.test', action: token === 'wrong-action' ? 'other' : 'interpret' });
    }
    // D1 emulator RPC also uses fetch; stub only the paid upstream endpoint.
    if (String(url) !== 'https://api.typesafe.ai/v1/systemone') return originalFetch(url, init);
    paidCalls++;
    if (fail) throw new Error('test upstream unavailable');
    if (busyOnce) { busyOnce = false; return new Response('', { status: 429 }); }
    return Response.json(fixture);
  };
  const firstBrowser = { cookie: (await GET(request())).headers.get('Set-Cookie').split(';')[0] };
  const post = (description, headers = firstBrowser) => POST(new Request(base, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ description }) }));
  assert.equal((await GET(request(firstBrowser))).status, 200);
  assert.equal((await post('')).status, 400);
  assert.equal((await post('blocked', { ...firstBrowser, Origin: 'https://evil.test' })).status, 403);
  const first = await post('first sound');
  assert.equal(first.status, 200);
  assert.equal((await first.json()).usage.remaining, 2);
  assert.equal(paidCalls, 2, 'one upstream retry is within the same description slot');
  const repeated = await post('first sound');
  assert.equal((await repeated.json()).usage.remaining, 1, 'repeated submissions obey the per-description limit');
  assert.equal(paidCalls, 2, 'same description reuses Cloudflare cache after verification and quota');
  assert.equal(repeated.headers.get('Cache-Control'), 'private, no-store');
  const storedKey = await interpretationCacheKey(base, 'first sound');
  assert.ok(!storedKey.url.includes('first'));
  const stored = await nativeCache.match(storedKey.url);
  assert.equal(stored.headers.get('Cache-Control'), 'public, max-age=300');
  const storedBody = await stored.json();
  assert.equal(storedBody.usage, undefined);
  assert.equal(stored.headers.get('Set-Cookie'), null);
  assert.equal((await interpretationCacheKey(base, 'different sound')).url === storedKey.url, false);
  await nativeCache.delete(storedKey.url);
  const secondBrowser = { cookie: (await GET(request())).headers.get('Set-Cookie').split(';')[0] };
  assert.equal((await post('first sound', secondBrowser)).status, 200);
  assert.equal(paidCalls, 3, 'a miss after eviction makes a fresh TypeSafe call');
  fail = true;
  assert.equal((await post('failed sound')).status, 502);
  const callsAtLimit = paidCalls;
  const denied = await Promise.all(Array.from({ length: 10 }, () => post('one too many')));
  assert.ok(denied.every(r => r.status === 429));
  assert.ok(Number(denied[0].headers.get('Retry-After')) > 0);
  assert.equal(paidCalls, callsAtLimit, 'no paid call after exhaustion');
  assert.equal((await (await GET(request(firstBrowser))).json()).usage.remaining, 0);

  assert.equal((await post('missing browser', {})).status, 401);
  const browserStatus = await GET(request());
  const browserCookie = browserStatus.headers.get('Set-Cookie').split(';')[0];
  fail = false;
  const browserResult = await post('browser sound', { cookie: browserCookie });
  assert.equal(browserResult.status, 200);
  assert.equal((await browserResult.json()).usage.remaining, 2);
  const embedHeaders = { 'X-Textured-Embed': '1' };
  const embedStatus = await GET(request(embedHeaders));
  const embedSetCookie = embedStatus.headers.get('Set-Cookie');
  assert.ok(embedSetCookie.startsWith('__Host-textured_embed='));
  assert.ok(embedSetCookie.includes('HttpOnly; SameSite=None; Secure; Partitioned'));
  const embedCookie = embedSetCookie.split(';')[0];
  const embedStatusBody = await embedStatus.json();
  const embedToken = embedStatusBody.sessionToken;
  assert.match(embedToken, /^[a-f0-9]{64}$/);
  assert.equal(embedToken, embedCookie.split('=')[1], 'cookie and explicit transport share the same quota');
  assert.equal(embedStatus.headers.get('Cache-Control'), 'private, no-store');
  const embedded = await post('embedded sound', { ...embedHeaders, cookie: embedCookie });
  assert.equal(embedded.status, 200);
  assert.equal((await embedded.json()).usage.remaining, 2);
  const embedReload = await GET(request({ ...embedHeaders, cookie: embedCookie }));
  assert.equal(embedReload.headers.get('Set-Cookie'), null);
  assert.equal((await embedReload.json()).usage.remaining, 2, 'embed reload retains allowance');
  assert.equal((await post('wrong session mode', { cookie: embedCookie })).status, 401);
  assert.equal((await post('foreign origin', { ...embedHeaders, cookie: embedCookie, Origin: 'https://other.test' })).status, 403);
  const cookielessHeaders = { ...embedHeaders, 'X-Textured-Session': embedToken };
  const cookielessStatus = await GET(request(cookielessHeaders));
  assert.equal(cookielessStatus.headers.get('Set-Cookie'), null, 'a cookieless reload does not issue a new session');
  assert.equal((await cookielessStatus.json()).usage.remaining, 2);
  const cookieless = await post('mobile sound', cookielessHeaders);
  assert.equal(cookieless.status, 200);
  const cookielessBody = await cookieless.json();
  assert.equal(cookielessBody.usage.remaining, 1);
  assert.equal(cookielessBody.sessionToken, undefined, 'interpretation responses do not carry credentials');
  assert.equal((await post('last mobile sound', cookielessHeaders)).status, 200);
  const callsBeforeMobileLimit = paidCalls;
  assert.equal((await post('over mobile limit', cookielessHeaders)).status, 429);
  assert.equal(paidCalls, callsBeforeMobileLimit, 'cookieless sessions enforce the same daily cap');
  assert.equal((await post('forged session', { ...embedHeaders, 'X-Textured-Session': '0'.repeat(64) })).status, 401);
  assert.equal((await post('wrong mode', { 'X-Textured-Session': embedToken })).status, 401);
  assert.equal((await post('foreign token request', { ...cookielessHeaders, Origin: 'https://evil.test' })).status, 403);
  assert.equal((await GET(request({ ...cookielessHeaders, Origin: 'https://evil.test' }))).status, 403);
  assert.equal(await quotaIdentity(db, request(cookielessHeaders), { create: false, now: Date.now() + 31 * 86400000 }), null, 'explicit tokens expire too');
  Object.assign(globalThis.__quotaTestEnv, { TURNSTILE_REQUIRED: 'true', TURNSTILE_SITE_KEY: 'public-site-key', TURNSTILE_SECRET_KEY: 'test-secret' });
  const verifyPost = token => POST(new Request(base, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: browserCookie }, body: JSON.stringify({ description: 'protected sound', turnstileToken: token }) }));
  const beforeVerification = paidCalls;
  assert.equal((await post('cookieless without verification', cookielessHeaders)).status, 403, 'explicit session tokens cannot bypass Turnstile');
  assert.equal((await verifyPost(undefined)).status, 403);
  assert.equal(verificationCalls, 0, 'missing token rejected without network');
  for (const token of ['invalid', 'wrong-host', 'wrong-action']) assert.equal((await verifyPost(token)).status, 403);
  assert.equal((await verifyPost('unavailable')).status, 503);
  assert.equal(paidCalls, beforeVerification, 'no upstream calls for invalid or unavailable verification');
  const status = await (await GET(request({ cookie: browserCookie }))).json();
  assert.equal(status.usage.remaining, 2, 'failed browser checks do not consume quota');
  assert.equal(status.turnstileSiteKey, 'public-site-key');
  assert.ok(!JSON.stringify(status).includes('test-secret'));
  const accepted = await verifyPost('one-use');
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).usage.remaining, 1);
  assert.equal((await verifyPost('one-use')).status, 403, 'a used token cannot repeat an inference');
  globalThis.__quotaTestEnv.TURNSTILE_SECRET_KEY = '';
  assert.equal((await verifyPost('any')).status, 503, 'missing production secrets fail closed');
  assert.equal((await GET(request({ cookie: browserCookie }))).status, 503);
  globalThis.__quotaTestEnv.TURNSTILE_REQUIRED = 'false';
  const beforeFailure = paidCalls;
  globalThis.__quotaTestEnv.DB = undefined;
  assert.equal((await post('storage unavailable', { cookie: browserCookie })).status, 503);
  assert.equal(paidCalls, beforeFailure, 'storage failures fail closed');
  console.log('PASS real D1 concurrency, UTC reset, durable counts, separate browsers, token validation, route limits, native Cloudflare caching/eviction/retries/errors Turnstile hostname/action/replay checks and fail-closed storage.');
} finally {
  globalThis.fetch = originalFetch;
  if (originalCaches === undefined) delete globalThis.caches; else globalThis.caches = originalCaches;
  delete globalThis.__quotaTestEnv;
  await mf.dispose();
}
