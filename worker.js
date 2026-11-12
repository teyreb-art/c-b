
import { handleDashboard } from './server/dashboard.js';

const TEST_EMAIL = "beratkaranfil2005@gmail.com";
const EMAIL_FROM = "C&B Bandenservice <onboarding@resend.dev>";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);

async function sendConfirmationEmail(env, details) {
  if (!env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY ontbreekt.");
    return false;
  }

  const {
    name,
    email,
    phone,
    vehicle,
    service,
    preferredDate,
    message,
    selection,
    total
  } = details;

  const price = total === null
    ? "Nog te bepalen"
    : new Intl.NumberFormat("nl-BE", {
        style: "currency",
        currency: "EUR"
      }).format(total);

  const rows = [
    ["Naam", name],
    ["E-mailadres", email],
    ["Telefoonnummer", phone],
    ["Voertuig", vehicle || "Niet opgegeven"],
    ["Dienst", service],
    ["Gewenste datum", preferredDate || "Niet opgegeven"],
    ["Bandenkeuze", selection || "Niet opgegeven"],
    ["Indicatieve prijs", price],
    ["Opmerking", message || "Geen"]
  ];

  const tableRows = rows.map(([label, value]) => `
    <tr>
      <td style="padding:12px;border-bottom:1px solid #eeeeee;font-weight:600;">
        ${escapeHtml(label)}
      </td>
      <td style="padding:12px;border-bottom:1px solid #eeeeee;">
        ${escapeHtml(value)}
      </td>
    </tr>
  `).join("");

  const html = `
    <!doctype html>
    <html lang="nl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
    </head>
    <body style="margin:0;padding:30px 15px;background:#f4f4f4;font-family:Arial,sans-serif;color:#222;">
      <div style="max-width:600px;margin:auto;background:#fff;">

        <div style="background:#f4d529;padding:30px;">
          <h1 style="margin:0;color:#111;font-size:27px;">
            C&B Bandenservice
          </h1>
          <p style="margin:10px 0 0;color:#111;">
            Bevestiging van je aanvraag
          </p>
        </div>

        <div style="padding:30px;">
          <h2 style="margin-top:0;">
            Bedankt voor je aanvraag!
          </h2>

          <p>Beste ${escapeHtml(name)},</p>

          <p>
            We hebben je aanvraag goed ontvangen.
            Ons team bekijkt je gegevens en neemt
            zo snel mogelijk contact met je op.
          </p>

          <h3 style="margin-top:30px;">
            Overzicht van je aanvraag
          </h3>

          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            ${tableRows}
          </table>

          <p style="margin-top:25px;padding:15px;background:#fff8d6;">
            <strong>Let op:</strong> dit is een ontvangstbevestiging.
            Je afspraak is nog niet definitief bevestigd.
            Een medewerker van C&B neemt contact met je op.
          </p>

          <p style="margin-top:30px;">
            Met vriendelijke groeten,<br>
            <strong>Team C&B Bandenservice</strong>
          </p>
        </div>

        <div style="background:#191919;color:#fff;padding:20px;text-align:center;font-size:12px;">
          C&B Bandenservice
        </div>
      </div>
    </body>
    </html>
  `;

  const text = [
    "C&B Bandenservice",
    "",
    `Beste ${name},`,
    "",
    "We hebben je aanvraag goed ontvangen.",
    "Ons team neemt zo snel mogelijk contact met je op.",
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    "Dit is geen definitieve afspraakbevestiging.",
    "",
    "Met vriendelijke groeten,",
    "Team C&B Bandenservice"
  ].join("\n");

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [TEST_EMAIL],
        subject: "C&B - We hebben je aanvraag ontvangen",
        html,
        text
      })
    });

    if (!response.ok) {
      console.error(
        "Resend verzending mislukt:",
        response.status,
        await response.text()
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error("E-mailfout:", error);
    return false;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const dashboard = await handleDashboard(request, env);
    if (dashboard) return dashboard;

    if (url.pathname === "/api/health") {
      return json({
        success: true,
        database: Boolean(env.DB)
      });
    }

    if (url.pathname === "/api/request") {
      if (request.method !== "POST") {
        return json({ error: "Methode niet toegestaan." }, 405);
      }

      if (!env.DB) {
        return json({ error: "Database niet beschikbaar." }, 503);
      }

      if (!request.headers.get("content-type")?.includes("application/json")) {
        return json({ error: "Ongeldig formaat." }, 415);
      }

      let data;

      try {
        data = await request.json();
      } catch {
        return json({ error: "Ongeldige gegevens." }, 400);
      }

      if (!data || typeof data !== "object" || Array.isArray(data)) {
        return json({ error: "Ongeldige aanvraag." }, 400);
      }

      const clean = (value, max) =>
        typeof value === "string"
          ? value.trim().slice(0, max)
          : "";

      const name = clean(data.name, 100);
      const email = clean(data.email, 254);
      const phone = clean(data.phone, 40);
      const vehicle = clean(data.vehicle, 100);
      const service = clean(data.service, 100);
      const preferredDate = clean(data.preferredDate, 10);
      const message = clean(data.message, 2000);
      const selection = clean(data.tireSelection, 150);

      const allowedServices = [
        "Bandenadvies / offerte",
        "Bandenwissel",
        "Montage",
        "Herstelling / controle"
      ];

      if (!name || !email || !phone) {
        return json({
          error: "Naam, e-mailadres en telefoonnummer zijn verplicht."
        }, 400);
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ error: "Ongeldig e-mailadres." }, 400);
      }

      if (!/^[+0-9 ()/-]{6,40}$/.test(phone)) {
        return json({ error: "Ongeldig telefoonnummer." }, 400);
      }

      if (!allowedServices.includes(service)) {
        return json({ error: "Ongeldige dienst." }, 400);
      }

      if (
        preferredDate &&
        !/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)
      ) {
        return json({ error: "Ongeldige datum." }, 400);
      }

      const total =
        typeof data.indicativeTotal === "number" &&
        Number.isFinite(data.indicativeTotal) &&
        data.indicativeTotal >= 0 &&
        data.indicativeTotal <= 100000
          ? data.indicativeTotal
          : null;

      const now = new Date().toISOString();

      const payloadText = JSON.stringify({
        name,
        email,
        phone,
        vehicle,
        service,
        preferredDate,
        message,
        selection
      });

      const hashBuffer = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(payloadText)
      );

      const payloadHash = Array.from(
        new Uint8Array(hashBuffer)
      )
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");

      try {
        await env.DB.prepare(`
          INSERT INTO requests (
            id,
            payload_hash,
            name,
            email,
            phone,
            vehicle,
            service,
            preferred_date,
            message,
            selection,
            indicative_total,
            consent_at,
            marketing_optin,
            status,
            created_at
          )
          VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, 0, 'nieuw', ?
          )
        `).bind(
          crypto.randomUUID(),
          payloadHash,
          name,
          email,
          phone,
          vehicle,
          service,
          preferredDate,
          message,
          selection,
          total,
          now,
          now
        ).run();

      } catch (error) {
        console.error("D1 opslaan mislukt:", error);

        return json({
          error: "Aanvraag kon niet worden opgeslagen."
        }, 500);
      }

      // De aanvraag is opgeslagen.
      // Probeer nu de testmail te versturen.
      const emailDetails = {
        name,
        email,
        phone,
        vehicle,
        service,
        preferredDate,
        message,
        selection,
        total
      };

      ctx.waitUntil(
        sendConfirmationEmail(env, emailDetails)
          .catch(error => console.error("Mailtaak mislukt:", error))
      );

      return json({
        success: true,
        message: "Je aanvraag is goed ontvangen."
      });
    }

    return env.ASSETS.fetch(request);
  }
};
