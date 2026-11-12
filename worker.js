
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

    // Controleer of de database gekoppeld is
    if (url.pathname === "/api/health") {
      return json({
        success: true,
        database: Boolean(env.DB)
      });
    }

    // Offerteaanvraag verwerken
    if (url.pathname === "/api/request") {
      if (request.method !== "POST") {
        return json({ error: "Methode niet toegestaan." }, 405);
      }

      if (!env.DB) {
        return json({ error: "Database niet beschikbaar." }, 503);
      }

      if (!(request.headers.get("content-type") || "")
        .includes("application/json")) {
        return json({ error: "Ongeldig formaat." }, 415);
      }

      let data;

      try {
        data = await request.json();
      } catch {
        return json({ error: "Ongeldige gegevens." }, 400);
      }

      const clean = (value, max) =>
        typeof value === "string"
          ? value.trim().slice(0, max)
          : "";

      const name = clean(data.name, 100);
      const phone = clean(data.phone, 40);
      const vehicle = clean(data.vehicle, 100);
      const service = clean(data.service, 100);
      const preferredDate = clean(data.preferredDate, 10);
      const message = clean(data.message, 2000);
      const tireSelection = clean(data.tireSelection, 150);

      const allowedServices = [
        "Bandenadvies / offerte",
        "Bandenwissel",
        "Montage",
        "Herstelling / controle"
      ];

      if (
        !name ||
        !/^[+0-9 ()/-]{6,40}$/.test(phone) ||
        !allowedServices.includes(service)
      ) {
        return json({
          error: "Controleer je naam, telefoon en dienst."
        }, 400);
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

      try {
        await env.DB.prepare(`
          INSERT INTO requests (
            id, name, phone, vehicle, service,
            preferred_date, message, tire_selection,
            indicative_total, status, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'nieuw', ?)
        `).bind(
          crypto.randomUUID(),
          name,
          phone,
          vehicle,
          service,
          preferredDate,
          message,
          tireSelection,
          total,
          new Date().toISOString()
        ).run();

        return json({
          success: true,
          message: "Je aanvraag is goed ontvangen."
        });
      } catch (error) {
        console.error("Opslaan mislukt:", error);

        return json({
          error: "Aanvraag kon niet worden opgeslagen."
        }, 500);
      }
    }

    // Bestaande website blijven serveren
    return env.ASSETS.fetch(request);
  }
};
