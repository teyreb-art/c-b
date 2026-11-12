
import { problem } from './access.js';
import { sendLoyaltyEmail } from './loyalty-email.js';

const reply = (data, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });

const clean = (value, max = 150) =>
  typeof value === 'string'
    ? value.trim().slice(0, max)
    : '';

async function body(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    throw problem('Gebruik JSON.', 415);
  }

  const raw = await request.text();
  if (raw.length > 12000) {
    throw problem('Aanvraag is te groot.', 413);
  }

  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error();
    }
    return data;
  } catch {
    throw problem('Ongeldige gegevens.', 400);
  }
}

export async function handleLoyalty(request, env, user) {
  const url = new URL(request.url);
  const path = url.pathname;
  const db = env.DB;

  if (!path.startsWith('/api/dashboard/loyalty/')) {
    return null;
  }

  if (path === '/api/dashboard/loyalty/customers' &&
      request.method === 'GET') {
    const rows = await db.prepare(`
      SELECT
        c.*,
        COUNT(t.id) AS change_count
      FROM loyalty_customers c
      LEFT JOIN loyalty_tire_changes t
        ON t.customer_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
      LIMIT 500
    `).all();

    return reply({ items: rows.results });
  }

  if (path === '/api/dashboard/loyalty/customers' &&
      request.method === 'POST') {
    const data = await body(request);

    const name = clean(data.name);
    const email = clean(data.email, 254).toLowerCase();
    const phone = clean(data.phone, 40);
    const vehicle = clean(data.vehicle);
    const plate = clean(data.license_plate, 30);

    if (!name || (!email && !phone)) {
      throw problem('Vul een naam en e-mail of telefoonnummer in.');
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw problem('Ongeldig e-mailadres.');
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.prepare(`
      INSERT INTO loyalty_customers (
        id, name, email, phone, vehicle,
        license_plate, reminder_consent,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).bind(
      id, name, email, phone, vehicle,
      plate, now, now
    ).run();

    return reply({ ok: true, id }, 201);
  }

  if (path === '/api/dashboard/loyalty/customer' &&
      request.method === 'GET') {
    const id = clean(url.searchParams.get('id'), 100);

    const customer = await db.prepare(`
      SELECT * FROM loyalty_customers WHERE id = ?
    `).bind(id).first();

    if (!customer) {
      throw problem('Klant niet gevonden.', 404);
    }

    const changes = await db.prepare(`
      SELECT *
      FROM loyalty_tire_changes
      WHERE customer_id = ?
      ORDER BY created_at DESC, id DESC
    `).bind(id).all();

    return reply({
      customer,
      changes: changes.results,
      completed: changes.results.length,
      next_discount:
        changes.results.length % 2 === 1 ? 10 : 0
    });
  }

  if (path === '/api/dashboard/loyalty/change' &&
      request.method === 'POST') {
    const data = await body(request);
    const customerId = clean(data.customer_id, 100);
    const operationId = clean(data.operation_id, 100);
    const price = Number(data.price);

    if (!/^[0-9a-f-]{36}$/i.test(customerId) ||
        !/^[0-9a-f-]{36}$/i.test(operationId)) {
      throw problem('Ongeldige registratiegegevens.');
    }

    if (!Number.isFinite(price) ||
        price < 0 || price > 10000 ||
        Math.round(price * 100) !== price * 100) {
      throw problem('Geef een geldige prijs met maximaal twee decimalen.');
    }

    const priceCents = Math.round(price * 100);
    const now = new Date().toISOString();

    // De telling en registratie gebeuren in één SQL-statement.
    // operation_id voorkomt herhaalde verwerking van dezelfde actie.
    const result = await db.prepare(`
      INSERT INTO loyalty_tire_changes (
        id, customer_id, performed_at,
        service_price_cents, discount_percent,
        discount_cents, final_price_cents,
        created_by, created_at
      )
      SELECT
        ?, c.id, ?,
        ?,
        CASE WHEN (
          SELECT COUNT(*)
          FROM loyalty_tire_changes
          WHERE customer_id = c.id
        ) % 2 = 1 THEN 10 ELSE 0 END,
        CASE WHEN (
          SELECT COUNT(*)
          FROM loyalty_tire_changes
          WHERE customer_id = c.id
        ) % 2 = 1
          THEN CAST((? + 5) / 10 AS INTEGER)
          ELSE 0
        END,
        ? - CASE WHEN (
          SELECT COUNT(*)
          FROM loyalty_tire_changes
          WHERE customer_id = c.id
        ) % 2 = 1
          THEN CAST((? + 5) / 10 AS INTEGER)
          ELSE 0
        END,
        ?, ?
      FROM loyalty_customers c
      WHERE c.id = ?
      ON CONFLICT(id) DO NOTHING
      RETURNING
        id, discount_percent,
        discount_cents, final_price_cents
    `).bind(
      operationId, now,
      priceCents, priceCents,
      priceCents, priceCents,
      user.email, now, customerId
    ).first();

    if (!result) {
      const existing = await db.prepare(`
        SELECT customer_id, discount_percent,
               discount_cents, final_price_cents
        FROM loyalty_tire_changes
        WHERE id = ?
      `).bind(operationId).first();

      if (existing) {
        if (existing.customer_id !== customerId) {
          throw problem('Registratiecode is al gebruikt.', 409);
        }
        return reply({ ok: true, duplicate: true, change: existing });
      }

      throw problem('Klant niet gevonden.', 404);
    }

// Haal de klant op voor de bevestigingsmail.
const customer = await db.prepare(`
  SELECT name
  FROM loyalty_customers
  WHERE id = ?
`).bind(customerId).first();

// Tel de geregistreerde bandenwissels.
const countRow = await db.prepare(`
  SELECT COUNT(*) AS total
  FROM loyalty_tire_changes
  WHERE customer_id = ?
`).bind(customerId).first();

const completed = Number(countRow?.total || 0);

// Verstuur uitsluitend bij een nieuwe registratie.
// De testmail gaat altijd naar het ingestelde Gmail-adres.
let emailSent = false;

if (customer) {
  try {
    emailSent = await sendLoyaltyEmail(env, {
      name: customer.name,
      completed,
      change: result
    });
  } catch (error) {
    console.error('Loyaliteitsmail mislukt:', error);
  }
}

return reply({
  ok: true,
  change: result,
  email_sent: emailSent
}, 201);  }

  throw problem('Loyaliteitsfunctie niet gevonden.', 404);
}
