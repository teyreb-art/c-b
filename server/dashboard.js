import { problem, authenticate, signIn, signOut, clearSessionCookie } from './access.js';

const statuses = ['nieuw', 'in behandeling', 'afgerond', 'geannuleerd'];
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY'
};
const json = (data, status = 200, extra = {}) => Response.json(data, { status, headers: { ...headers, ...extra } });
async function readBody(req) {
  if (!req.headers.get('content-type')?.includes('application/json')) throw problem('Gebruik JSON.', 415);
  const reader = req.body?.getReader();
  if (!reader) throw problem('Lege aanvraag.');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 12000) { await reader.cancel(); throw problem('Te veel tekst.', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch { throw problem('Ongeldige gegevens.'); }
}
const text = (value, max = 100) => typeof value === 'string' ? value.trim().slice(0, max) : '';
function pagination(url) {
  return Math.max(0, Math.min(100000, parseInt(url.searchParams.get('page') || '0', 10) || 0));
}
export async function handleDashboard(req, env) {
  const url = new URL(req.url);
  const path = url.pathname;
  if (['/beheer', '/admin.html', '/beheer.html'].includes(path)) {
    return new Response(null, { status: 302, headers: { ...headers, Location: '/beheer/' } });
  }
  const api = path === '/api/dashboard' || path.startsWith('/api/dashboard/');
  if (!api && !path.startsWith('/beheer/')) return null;
  try {
    if (!['GET', 'HEAD', 'POST'].includes(req.method)) throw problem('Methode niet toegestaan.', 405);
    if (req.method === 'POST' && req.headers.get('Origin') !== url.origin) throw problem('Onjuiste herkomst.', 403);
    // De login en de bijbehorende statische bestanden bevatten geen klantgegevens.
    if (!api && ['/beheer/inloggen', '/beheer/inloggen.html', '/beheer/login.js', '/beheer/style.css'].includes(path)) {
      if (!['GET', 'HEAD'].includes(req.method)) throw problem('Methode niet toegestaan.', 405);
      const response = await env.ASSETS.fetch(req);
      return new Response(response.body, { status: response.status, headers: { ...Object.fromEntries(response.headers), ...headers } });
    }
    if (path === '/api/dashboard/auth/login' && req.method === 'POST') {
      const signed = await signIn(req, env, await readBody(req));
      return json({ ok: true, user: signed.user }, 200, { 'Set-Cookie': signed.cookie });
    }
    if (path === '/api/dashboard/auth/logout' && req.method === 'POST') {
      return json({ ok: true }, 200, { 'Set-Cookie': await signOut(req, env) });
    }
    const user = await authenticate(req, env);
    if (!api) {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw problem('Methode niet toegestaan.', 405);
      const allowed = ['/beheer/', '/beheer/index.html', '/beheer/app.js', '/beheer/style.css'];
      if (!allowed.includes(path)) throw problem('Pagina niet gevonden.', 404);
      const response = await env.ASSETS.fetch(req);
      return new Response(response.body, { status: response.status, headers: { ...Object.fromEntries(response.headers), ...headers } });
    }
    if (!env.DB) throw problem('De database is nog niet gekoppeld.', 503);
    if (path === '/api/dashboard/me' && req.method === 'GET') return json({ user });
    if (path === '/api/dashboard/requests' && req.method === 'GET') {
      const status = text(url.searchParams.get('status'));
      if (status && !statuses.includes(status)) throw problem('Ongeldige status.');
      const q = text(url.searchParams.get('q')).replace(/[\\%_]/g, '\\$&');
      const where = "WHERE (?='' OR status=?) AND (?='' OR name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR vehicle LIKE ? ESCAPE '\\')";
      const params = [status, status, q, ...Array(4).fill('%' + q + '%')];
      const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM requests ' + where).bind(...params).first();
      const page = Math.min(pagination(url), Math.max(0, Math.ceil(count.total / 25) - 1));
      const items = await env.DB.prepare(`SELECT id,name,email,phone,vehicle,service,preferred_date,status,created_at FROM requests ${where} ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET ?`).bind(...params, page * 25).all();
      const stats = await env.DB.prepare('SELECT status,COUNT(*) AS count FROM requests GROUP BY status').all();
      return json({ items: items.results, total: count.total, page, pageSize: 25, stats: Object.fromEntries(stats.results.map(r => [r.status, r.count])) });
    }
    if (path === '/api/dashboard/request' && req.method === 'GET') {
      const id = text(url.searchParams.get('id'), 100);
      const item = await env.DB.prepare('SELECT id,name,email,phone,vehicle,service,preferred_date,message,selection,indicative_total,status,created_at FROM requests WHERE id=?').bind(id).first();
      if (!item) throw problem('Aanvraag niet gevonden.', 404);
      const notes = await env.DB.prepare('SELECT id,body,author_email,author_role,created_at FROM dashboard_notes WHERE request_id=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(id).all();
      const history = await env.DB.prepare('SELECT actor_email,actor_role,action,old_status,new_status,created_at FROM dashboard_audit WHERE request_id=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(id).all();
      return json({ item, notes: notes.results, history: history.results });
    }
    if (path === '/api/dashboard/status' && req.method === 'POST') {
      const data = await readBody(req);
      if (!statuses.includes(data.status) || !statuses.includes(data.expectedStatus)) throw problem('Ongeldige status.');
      const id = text(data.id, 100);
      const current = await env.DB.prepare('SELECT status FROM requests WHERE id=?').bind(id).first();
      if (!current) throw problem('Aanvraag niet gevonden.', 404);
      if (current.status !== data.expectedStatus) throw problem('Deze aanvraag is intussen gewijzigd. Vernieuw de gegevens.', 409);
      if (data.status === current.status) return json({ ok: true });
      const result = await env.DB.batch([
        env.DB.prepare("INSERT INTO dashboard_audit(id,request_id,actor_email,actor_role,action,old_status,new_status,created_at) SELECT ?,id,?,?,'status',status,?,? FROM requests WHERE id=? AND status=?")
          .bind(crypto.randomUUID(), user.email, user.role, data.status, new Date().toISOString(), id, data.expectedStatus),
        env.DB.prepare('UPDATE requests SET status=? WHERE id=? AND status=? RETURNING id').bind(data.status, id, data.expectedStatus)
      ]);
      if (!result[1].results.length) throw problem('Deze aanvraag is intussen gewijzigd. Vernieuw de gegevens.', 409);
      return json({ ok: true });
    }
    if (path === '/api/dashboard/notes' && req.method === 'POST') {
      const data = await readBody(req);
      const id = text(data.id, 100), note = typeof data.note === 'string' ? data.note.trim() : '';
      if (!note || note.length > 2000) throw problem('Schrijf een notitie van maximaal 2.000 tekens.');
      const exists = await env.DB.prepare('SELECT id FROM requests WHERE id=?').bind(id).first();
      if (!exists) throw problem('Aanvraag niet gevonden.', 404);
      const created = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare('INSERT INTO dashboard_notes(id,request_id,body,author_email,author_role,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(), id, note, user.email, user.role, created),
        env.DB.prepare("INSERT INTO dashboard_audit(id,request_id,actor_email,actor_role,action,created_at) VALUES (?,?,?,?,'notitie',?)").bind(crypto.randomUUID(), id, user.email, user.role, created)
      ]);
      return json({ ok: true }, 201);
    }
    if (path === '/api/dashboard/activity' && req.method === 'GET') {
      const page = pagination(url);
      const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM dashboard_audit').first();
      const rows = await env.DB.prepare('SELECT a.*,r.name FROM dashboard_audit a JOIN requests r ON r.id=a.request_id ORDER BY a.created_at DESC,a.id DESC LIMIT 25 OFFSET ?').bind(page * 25).all();
      return json({ items: rows.results, total: count.total, page, pageSize: 25 });
    }
    if (path === '/api/dashboard/diagnostics' && req.method === 'GET') {
      if (user.role !== 'upside') throw problem('Deze pagina is alleen beschikbaar voor Upside.', 403);
      await env.DB.prepare('SELECT 1 AS ok').first();
      const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('dashboard_notes','dashboard_audit')").all();
      return json({ database: true, migrations: tables.results.length === 2, login: true, version: 'C&B dashboard 2.0 · Supabase', checkedAt: new Date().toISOString() });
    }
    throw problem('Niet gevonden.', 404);
  } catch (error) {
    if (!error.status) console.error('Dashboardbewerking mislukt');
    const status = error.status || 500;
    const message = error.status ? error.message : 'De gegevens konden niet worden verwerkt. Probeer opnieuw of contacteer Upside.';
    if (api) return json({ error: message }, status, status === 401 ? { 'Set-Cookie': clearSessionCookie() } : {});
    if ([401, 403].includes(status)) return new Response(null, { status: 303, headers: { ...headers, Location: '/beheer/inloggen', 'Set-Cookie': clearSessionCookie() } });
    return new Response(`<!doctype html><html lang="nl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>C&B beheer</title><link rel="stylesheet" href="/beheer/style.css"><main class="access-message"><h1>C&B beheer</h1><p>${message}</p><a href="/beheer/">Opnieuw proberen</a></main></html>`, { status, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
  }
}
