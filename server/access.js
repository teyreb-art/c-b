const COOKIE = '__Host-cb_session';
const SESSION_SECONDS = 8 * 60 * 60;
export function problem(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
export async function hash(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function legacyRole(key) {
  try { return JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role; }
  catch { return null; }
}
export function authConfig(env) {
  const url = String(env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = String(env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  const ownerId = String(env.CB_OWNER_USER_ID || '').trim();
  const upsideId = String(env.UPSIDE_USER_ID || '').trim();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) ||
      !(key.startsWith('sb_publishable_') || legacyRole(key) === 'anon') ||
      !uuid.test(ownerId) || (upsideId && (!uuid.test(upsideId) || upsideId === ownerId))) {
    throw problem('De Supabase-login is nog niet volledig ingesteld.', 503);
  }
  if (!env.DB) throw problem('De database is nog niet gekoppeld.', 503);
  return { url, key, ownerId, upsideId };
}
function authorize(user, cfg) {
  if (!user || typeof user.id !== 'string' || typeof user.email !== 'string' || !user.email_confirmed_at || user.is_anonymous) {
    throw problem('Log in met een bevestigd C&B-account.', 403);
  }
  const role = user.id === cfg.ownerId ? 'eigenaar' : cfg.upsideId && user.id === cfg.upsideId ? 'upside' : null;
  if (!role) throw problem('Dit account heeft geen toegang tot C&B-beheer.', 403);
  return { id: user.id, email: user.email, role, name: role === 'upside' ? 'Upside Agency' : 'C&B eigenaar' };
}
async function supabase(cfg, path, { token, data, method } = {}) {
  let response;
  try {
    response = await fetch(cfg.url + '/auth/v1/' + path, {
      method: method || (data ? 'POST' : 'GET'),
      headers: { apikey: cfg.key, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) },
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(8000), redirect: 'error'
    });
  }  catch (error) {
  console.error('Supabase-verbindingsfout:', {
    name: error?.name,
    message: error?.message
  });

  throw problem('Supabase is tijdelijk niet bereikbaar. Probeer opnieuw.', 503);
} 
  if (response.status === 429) throw problem('Te veel inlogpogingen. Probeer later opnieuw.', 429);
  if (response.status >= 500) throw problem('Inloggen is tijdelijk niet beschikbaar. Probeer opnieuw.', 503);
  let result = {};
  if (response.status !== 204) {
    try { result = await response.json(); }
    catch { throw problem('De loginservice gaf geen geldig antwoord.', 503); }
  }
  return { ok: response.ok, status: response.status, result };
}
function sessionCookie(value, age = SESSION_SECONDS) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
}
export const clearSessionCookie = () => sessionCookie('', 0);
function cookie(req) {
  const matches = (req.headers.get('Cookie') || '').split(';').map(v => v.trim()).filter(v => v.startsWith(COOKIE + '='));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(COOKIE.length + 1);
  return /^[0-9a-f]{64}$/.test(value) ? value : null;
}
function validTokens(session) {
  return typeof session?.access_token === 'string' && session.access_token.length <= 12000 && session.access_token.length > 5 &&
    typeof session.refresh_token === 'string' && session.refresh_token.length <= 4000 && session.refresh_token.length > 5 &&
    Number.isFinite(session.expires_in) && session.expires_in > 0;
}
async function rateLimit(db, key, max) {
  const now = Math.floor(Date.now() / 1000), bucket = Math.floor(now / 600);
  const result = await db.prepare('INSERT INTO dashboard_auth_limits(key,hits,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET hits=hits+1 RETURNING hits')
    .bind(key + ':' + bucket, (bucket + 2) * 600).first();
  if (result.hits > max) throw problem('Te veel inlogpogingen. Wacht enkele minuten en probeer opnieuw.', 429);
}
export async function signIn(req, env, data) {
  const cfg = authConfig(env);
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  const password = typeof data.password === 'string' ? data.password : '';
  if (!email || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email) || !password || password.length > 4096) {
    throw problem('Vul je e-mailadres en wachtwoord in.');
  }
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  await rateLimit(env.DB, 'ip:' + await hash(ip), 30);
  await rateLimit(env.DB, 'email:' + await hash(email), 10);
  const response = await supabase(cfg, 'token?grant_type=password', { data: { email, password } });
  if (!response.ok || !validTokens(response.result)) throw problem('Inloggen mislukt. Controleer je gegevens en of je account bevestigd is.', 401);
  const session = response.result;
  const user = authorize(session.user, cfg);
  const now = Math.floor(Date.now() / 1000);
  // De browser krijgt uitsluitend een willekeurige sessiecode, geen Supabase-tokens.
  const sid = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(v => v.toString(16).padStart(2, '0')).join('');
  const oldSid = cookie(req);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM dashboard_sessions WHERE id_hash=? OR expires_at<=?').bind(oldSid ? await hash(oldSid) : '', now),
    env.DB.prepare('DELETE FROM dashboard_auth_limits WHERE expires_at<=?').bind(now),
    env.DB.prepare('INSERT INTO dashboard_sessions(id_hash,user_id,access_token,refresh_token,token_expires_at,expires_at,refreshing_until) VALUES (?,?,?,?,?,?,0)')
      .bind(await hash(sid), user.id, session.access_token, session.refresh_token, now + Math.floor(session.expires_in), now + SESSION_SECONDS)
  ]);
  return { user, cookie: sessionCookie(sid) };
}
export async function authenticate(req, env) {
  const cfg = authConfig(env), sid = cookie(req);
  if (!sid) throw problem('Log in om de aanvragen te bekijken.', 401);
  const idHash = await hash(sid), now = Math.floor(Date.now() / 1000);
  let row = await env.DB.prepare('SELECT * FROM dashboard_sessions WHERE id_hash=? AND expires_at>?').bind(idHash, now).first();
  if (!row) throw problem('Je sessie is verlopen. Log opnieuw in.', 401);
  // Bij iedere actie beslist Supabase of het opgeslagen toegangstoken geldig is.
  let result = await supabase(cfg, 'user', { token: row.access_token });
  if (!result.ok && [400, 401, 403].includes(result.status)) {
    const lock = await env.DB.prepare('UPDATE dashboard_sessions SET refreshing_until=? WHERE id_hash=? AND expires_at>? AND refreshing_until<=? RETURNING id_hash')
      .bind(now + 20, idHash, now, now).first();
    if (lock) {
      try {
        const refreshed = await supabase(cfg, 'token?grant_type=refresh_token', { data: { refresh_token: row.refresh_token } });
        if (!refreshed.ok || !validTokens(refreshed.result)) {
          await env.DB.prepare('DELETE FROM dashboard_sessions WHERE id_hash=?').bind(idHash).run();
          throw problem('Je sessie is verlopen. Log opnieuw in.', 401);
        }
        const session = refreshed.result;
        const trusted = authorize(session.user, cfg);
        if (trusted.id !== row.user_id) throw problem('Ongeldige sessie. Log opnieuw in.', 401);
        const updated = await env.DB.prepare('UPDATE dashboard_sessions SET access_token=?,refresh_token=?,token_expires_at=?,refreshing_until=0 WHERE id_hash=? AND expires_at>? RETURNING id_hash')
          .bind(session.access_token, session.refresh_token, now + Math.floor(session.expires_in), idHash, now).first();
        if (!updated) throw problem('Je sessie is verlopen. Log opnieuw in.', 401);
        result = await supabase(cfg, 'user', { token: session.access_token });
      } finally {
        await env.DB.prepare('UPDATE dashboard_sessions SET refreshing_until=0 WHERE id_hash=?').bind(idHash).run();
      }
    } else {
      // Een ander tabblad kan dezelfde sessie al aan het vernieuwen zijn.
      for (let attempt = 0; attempt < 4; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 200));
        const fresh = await env.DB.prepare('SELECT * FROM dashboard_sessions WHERE id_hash=? AND expires_at>?').bind(idHash, now).first();
        if (!fresh) throw problem('Je sessie is verlopen. Log opnieuw in.', 401);
        if (fresh.access_token !== row.access_token) { result = await supabase(cfg, 'user', { token: fresh.access_token }); break; }
      }
      if (!result.ok) throw problem('Je sessie wordt vernieuwd. Probeer het zo opnieuw.', 503);
    }
  }
  if (!result.ok) throw problem('Je sessie is ongeldig. Log opnieuw in.', 401);
  const user = authorize(result.result, cfg);
  if (user.id !== row.user_id) throw problem('Ongeldige sessie. Log opnieuw in.', 401);
  return user;
}
export async function signOut(req, env) {
  const sid = cookie(req);
  if (sid && env.DB) {
    // Intrekken in D1 maakt deze dashboardsessie onmiddellijk onbruikbaar.
    const idHash = await hash(sid);
    const row = await env.DB.prepare('SELECT access_token FROM dashboard_sessions WHERE id_hash=?').bind(idHash).first();
    await env.DB.prepare('DELETE FROM dashboard_sessions WHERE id_hash=?').bind(idHash).run();
    if (row) {
      try { await supabase(authConfig(env), 'logout?scope=local', { token: row.access_token, method: 'POST' }); }
      catch { /* De dashboardsessie is al ingetrokken, ook als Supabase niet bereikbaar is. */ }
    }
  }
  return clearSessionCookie();
}
