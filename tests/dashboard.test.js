import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { verifyAccessJWT } from '../server/access.js';
import { handleDashboard } from '../server/dashboard.js';
import worker from '../worker.js';

const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const publicKey = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
const b64 = value => Buffer.from(value).toString('base64url');
async function token(overrides = {}, header = {}) {
  const a = b64(JSON.stringify({ alg: 'RS256', kid: 'test-key', ...header }));
  const b = b64(JSON.stringify({ iss: 'https://cb-test.cloudflareaccess.com', aud: ['test-audience'], sub: 'user-id', email: 'owner@example.test', exp: Date.now() / 1000 + 600, ...overrides }));
  const signed = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(a + '.' + b));
  return a + '.' + b + '.' + b64(signed);
}
globalThis.fetch = async url => {
  assert.equal(url, 'https://cb-test.cloudflareaccess.com/cdn-cgi/access/certs');
  return Response.json({ keys: [publicKey] });
};
function setup() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE requests(id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,vehicle TEXT NOT NULL,service TEXT NOT NULL,preferred_date TEXT NOT NULL,message TEXT NOT NULL,selection TEXT NOT NULL,indicative_total REAL,consent_at TEXT NOT NULL,marketing_optin INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'nieuw',created_at TEXT NOT NULL);`);
  sql.exec(readFileSync(new URL('../migrations/0002_dashboard.sql', import.meta.url), 'utf8'));
  function prepare(query, params = []) {
    return {
      bind(...values) { return prepare(query, values); },
      async first() { return sql.prepare(query).get(...params) || null; },
      async all() { return { results: sql.prepare(query).all(...params) }; },
      async run() {
        const stmt = sql.prepare(query);
        if (stmt.columns().length) return { results: stmt.all(...params) };
        return { results: [], meta: stmt.run(...params) };
      }
    };
  }
  const DB = { prepare, async batch(queries) {
    sql.exec('BEGIN');
    try { const out = []; for (const q of queries) out.push(await q.run()); sql.exec('COMMIT'); return out; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  } };
  const env = { DB, ACCESS_TEAM_DOMAIN: 'https://cb-test.cloudflareaccess.com', ACCESS_AUD: 'test-audience', CB_OWNER_EMAIL: 'owner@example.test', UPSIDE_EMAIL: 'upside@example.test', ASSETS: { async fetch() { return new Response('<html>dashboard</html>', { headers: { 'Content-Type': 'text/html' } }); } } };
  function insert(id = 'request-1', name = 'Test Klant') {
    sql.prepare("INSERT INTO requests VALUES (?,'hash',?,'klant@example.test','0400000000','VW Golf','Bandenwissel','2026-12-01','Testvraag','205/55 R16',434,'2026-11-12',0,'nieuw','2026-11-12T10:00:00Z')").run(id, name);
  }
  return { env, sql, insert };
}
async function request(env, path, jwt, data, headers = {}) {
  return handleDashboard(new Request('https://cb.test' + path, { method: data === undefined ? 'GET' : 'POST', headers: { ...(jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {}), Origin: 'https://cb.test', 'Content-Type': 'application/json', ...headers }, body: data === undefined ? undefined : JSON.stringify(data) }), env);
}
test('Verifies real RSA signatures, exact roles, issuer, audience and expiry', async () => {
  const { env } = setup();
  assert.equal((await verifyAccessJWT(await token(), env)).role, 'eigenaar');
  assert.equal((await verifyAccessJWT(await token({ email: 'UPSIDE@EXAMPLE.TEST' }), env)).role, 'upside');
  for (const claims of [{ email: 'outsider@example.test' }, { exp: 0 }, { iss: 'https://evil.test' }, { aud: ['wrong'] }, { nbf: Date.now() / 1000 + 1000 }, { sub: '' }]) {
    await assert.rejects(verifyAccessJWT(await token(claims), env));
  }
  const real = await token();
  const forged = real.split('.'); forged[1] = b64(JSON.stringify({ email: 'upside@example.test' }));
  await assert.rejects(verifyAccessJWT(forged.join('.'), env));
  await assert.rejects(verifyAccessJWT(await token({}, { alg: 'none' }), env));
  await assert.rejects(verifyAccessJWT('e30.bnVsbA.eA', env));
  await assert.rejects(verifyAccessJWT(real, { ...env, CB_OWNER_EMAIL: env.UPSIDE_EMAIL }));
});
test('Blocks anonymous API and shell, missing config and old bearer codes; keeps public routes available', async () => {
  const { env } = setup();
  assert.equal((await request(env, '/api/dashboard/requests')).status, 401);
  assert.equal((await request(env, '/beheer/')).status, 401);
  assert.equal((await request(env, '/api/dashboard/me', null, undefined, { Authorization: 'Bearer old-code', 'Cf-Access-Authenticated-User-Email': env.UPSIDE_EMAIL })).status, 401);
  assert.equal((await request({ ...env, ACCESS_AUD: '' }, '/api/dashboard/requests')).status, 503);
  assert.equal((await request(env, '/beheer.html')).headers.get('Location'), '/beheer/');
  assert.equal(await request(env, '/api/request'), null);
  const shell = await request(env, '/beheer/', await token());
  assert.equal(shell.status, 200); assert.equal(shell.headers.get('Cache-Control'), 'no-store');
  assert.match(shell.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
});
test('Lists, searches and paginates existing requests without SQL wildcard injection', async () => {
  const { env, insert } = setup(); const jwt = await token();
  for (let n = 0; n < 28; n++) insert('request-' + n, 'Test Klant ' + n);
  const first = await (await request(env, '/api/dashboard/requests', jwt)).json();
  assert.equal(first.items.length, 25); assert.equal(first.total, 28); assert.equal(first.stats.nieuw, 28);
  const next = await (await request(env, '/api/dashboard/requests?page=1', jwt)).json(); assert.equal(next.items.length, 3);
  const filtered = await (await request(env, '/api/dashboard/requests?q=VW%20Golf', jwt)).json(); assert.equal(filtered.total, 28);
  const literal = await (await request(env, '/api/dashboard/requests?q=%25', jwt)).json(); assert.equal(literal.total, 0);
  const bad = await (await request(env, "/api/dashboard/requests?q='OR%201=1--", jwt)).json(); assert.equal(bad.total, 0);
  const empty = await (await request(env, '/api/dashboard/requests?status=afgerond', jwt)).json(); assert.equal(empty.total, 0);
});
test('Saves status and audit atomically, detects stale updates, enforces origin and validates input', async () => {
  const { env, insert, sql } = setup(); insert(); const jwt = await token();
  const data = { id: 'request-1', status: 'in behandeling', expectedStatus: 'nieuw' };
  assert.equal((await request(env, '/api/dashboard/status', jwt, data, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await request(env, '/api/dashboard/status', jwt, { ...data, status: 'hack' })).status, 400);
  assert.equal((await request(env, '/api/dashboard/status', jwt, data)).status, 200);
  assert.equal(sql.prepare('SELECT status FROM requests').get().status, 'in behandeling');
  const event = sql.prepare('SELECT * FROM dashboard_audit').get(); assert.equal(event.actor_email, env.CB_OWNER_EMAIL); assert.equal(event.old_status, 'nieuw');
  assert.equal((await request(env, '/api/dashboard/status', jwt, { ...data, status: 'afgerond' })).status, 409);
  assert.equal(sql.prepare('SELECT count(*) n FROM dashboard_audit').get().n, 1);
  sql.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON dashboard_audit BEGIN SELECT RAISE(ABORT,'simulated failure'); END;");
  const r = await request(env, '/api/dashboard/status', jwt, { id: 'request-1', status: 'afgerond', expectedStatus: 'in behandeling' });
  assert.equal(r.status, 500); assert.equal(sql.prepare('SELECT status FROM requests').get().status, 'in behandeling');
});
test('Stores notes safely with identity, rejects missing records and keeps diagnostics Upside-only', async () => {
  const { env, insert, sql } = setup(); insert(); const jwt = await token({ email: env.UPSIDE_EMAIL });
  assert.equal((await request(env, '/api/dashboard/notes', jwt, { id: 'request-1', note: '<script>alert(1)</script>' })).status, 201);
  const detail = await (await request(env, '/api/dashboard/request?id=request-1', jwt)).json();
  assert.equal(detail.notes[0].body, '<script>alert(1)</script>'); assert.equal(detail.notes[0].author_role, 'upside');
  assert.equal(detail.history[0].action, 'notitie');
  assert.equal((await request(env, '/api/dashboard/notes', jwt, { id: 'gone', note: 'test' })).status, 404);
  assert.equal((await request(env, '/api/dashboard/notes', jwt, { id: 'request-1', note: 'a'.repeat(2001) })).status, 400);
  assert.equal((await request(env, '/api/dashboard/notes', jwt, { id: 'request-1', note: 'a'.repeat(13000) })).status, 413);
  assert.equal((await request(env, '/api/dashboard/diagnostics', await token())).status, 403);
  const diagnostic = await (await request(env, '/api/dashboard/diagnostics', jwt)).json(); assert.equal(diagnostic.migrations, true);
  assert.equal(sql.prepare('SELECT count(*) n FROM requests').get().n, 1);
});
test('Existing public submission still writes the original request schema', async () => {
  const { env, sql } = setup();
  const response = await worker.fetch(new Request('https://cb.test/api/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test Klant', email: 'klant@example.test', phone: '0400000000', service: 'Bandenwissel', vehicle: 'Testwagen' }) }), env);
  assert.equal(response.status, 200); assert.equal((await response.json()).success, true);
  assert.equal(sql.prepare('SELECT count(*) n FROM requests').get().n, 1);
});
