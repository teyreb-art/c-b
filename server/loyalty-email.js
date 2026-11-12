
const TEST_EMAIL = 'beratkaranfil2005@gmail.com';
const EMAIL_FROM = 'C&B Bandenservice <onboarding@resend.dev>';

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);

const euro = (cents) =>
  new Intl.NumberFormat('nl-BE', {
    style: 'currency',
    currency: 'EUR'
  }).format(cents / 100);

export async function sendLoyaltyEmail(env, { name, completed, change }) {
  if (!env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY ontbreekt voor loyaliteitsmail.');
    return false;
  }

  const discountPercent = Number(change.discount_percent) || 0;
  const discountCents = Number(change.discount_cents) || 0;
  const finalPriceCents = Number(change.final_price_cents) || 0;

  const nextDiscount = completed % 2 === 1;

  const message = discountPercent === 10
    ? 'Bij deze bandenwissel kreeg je 10% korting op de servicekosten.'
    : nextDiscount
      ? 'Bij je volgende geregistreerde bandenwissel krijg je 10% korting op de servicekosten.'
      : 'Je wisselvoordeel wordt bijgehouden.';

  const subject = discountPercent === 10
    ? 'C&B Wisselvoordeel – je 10% korting is toegepast'
    : 'C&B Wisselvoordeel – je volgende wissel met 10% korting';

  const html = `
    <!doctype html>
    <html lang="nl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
    </head>
    <body style="margin:0;padding:24px 12px;background:#f4f4f4;font-family:Arial,sans-serif;color:#222;">
      <div style="max-width:600px;margin:auto;background:white;">

        <div style="background:#f4d529;padding:28px;">
          <h1 style="margin:0;font-size:25px;color:#111;">
            C&B Bandenservice
          </h1>
          <p style="margin:8px 0 0;color:#111;">
            Wisselvoordeel
          </p>
        </div>

        <div style="padding:28px;">
          <p>Beste ${escapeHtml(name)},</p>

          <p>Je bandenwissel is geregistreerd.</p>

          <p style="padding:16px;background:#fff8d6;">
            <strong>${escapeHtml(message)}</strong>
          </p>

          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:10px;border-bottom:1px solid #eee;">
                Geregistreerde wissels
              </td>
              <td style="padding:10px;border-bottom:1px solid #eee;text-align:right;">
                ${completed}
              </td>
            </tr>

            <tr>
              <td style="padding:10px;border-bottom:1px solid #eee;">
                Korting deze wissel
              </td>
              <td style="padding:10px;border-bottom:1px solid #eee;text-align:right;">
                ${discountPercent}% (${escapeHtml(euro(discountCents))})
              </td>
            </tr>

            <tr>
              <td style="padding:10px;border-bottom:1px solid #eee;">
                Servicekosten na korting
              </td>
              <td style="padding:10px;border-bottom:1px solid #eee;text-align:right;">
                ${escapeHtml(euro(finalPriceCents))}
              </td>
            </tr>
          </table>

          <p style="font-size:13px;color:#555;">
            De korting geldt uitsluitend op de servicekosten,
            niet op banden of andere producten.
            Dit bericht is een testbevestiging.
          </p>

          <p>
            Met vriendelijke groeten,<br>
            <strong>Team C&B Bandenservice</strong>
          </p>
        </div>

      </div>
    </body>
    </html>
  `;

  const text = [
    'C&B Bandenservice – Wisselvoordeel',
    '',
    `Beste ${name},`,
    '',
    'Je bandenwissel is geregistreerd.',
    message,
    '',
    `Geregistreerde wissels: ${completed}`,
    `Korting deze wissel: ${discountPercent}% (${euro(discountCents)})`,
    `Servicekosten na korting: ${euro(finalPriceCents)}`,
    '',
    'Korting geldt uitsluitend op de servicekosten, niet op banden of andere producten.',
    'Dit bericht is een testbevestiging.',
    '',
    'Team C&B Bandenservice'
  ].join('\n');

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [TEST_EMAIL],
        subject,
        html,
        text
      })
    });

    if (!response.ok) {
      console.error(
        'Resend loyaliteitsmail mislukt:',
        response.status,
        await response.text()
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error('Fout bij loyaliteitsmail:', error);
    return false;
  }
}
