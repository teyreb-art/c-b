
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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

        return json({
          success: true,
          message: "Je aanvraag is goed ontvangen."
        });

      } catch (error) {
        console.error("D1 opslaan mislukt:", error);

        return json({
          error: "Aanvraag kon niet worden opgeslagen."
        }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
