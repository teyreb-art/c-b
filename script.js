
'use strict';

// ALGEMENE FUNCTIES

const $ = id => document.getElementById(id);

const money = n =>
  new Intl.NumberFormat('nl-BE', {
    style: 'currency',
    currency: 'EUR'
  }).format(n);

const localDate = () =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Brussels',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

$('year').textContent = new Date().getFullYear();

$('reminder-date').min = localDate();
document.querySelector('input[name="datum"]').min = localDate();

let selection = '';


// BANDENZOEKER

$('finder').addEventListener('submit', event => {
  event.preventDefault();

  selection =
    `${$('width').value}/${$('aspect').value} ` +
    `R${$('rim').value} · ${$('season').value}`;

  $('result-title').textContent = selection;
  $('products').replaceChildren();

  const base =
    65 +
    (Number($('rim').value) - 15) * 12 +
    (
      $('season').value === 'Winter'
        ? 15
        : $('season').value === 'Vierseizoen'
          ? 10
          : 0
    );

  [
    ['Budget', base],
    ['Comfort', base + 25],
    ['Premium', base + 55]
  ].forEach(([label, price]) => {

    const card = document.createElement('article');
    card.className = 'card';

    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = 'Voorbeeldoptie';

    const title = document.createElement('h3');
    title.textContent = label;

    const size = document.createElement('p');
    size.textContent = selection;

    const amount = document.createElement('strong');
    amount.className = 'price';
    amount.textContent = money(price);

    const note = document.createElement('p');
    note.className = 'small';
    note.textContent =
      'Per band incl. btw · exclusief montage en overige kosten';

    const choose = document.createElement('button');
    choose.className = 'button';
    choose.type = 'button';
    choose.textContent = 'Bereken mijn set';

    choose.addEventListener('click', () => {
      $('price').value = price;
      calculate();

      $('question').value =
        `Ik zoek ${label.toLowerCase()} banden: ` +
        `${selection}. Graag jullie actuele prijs en advies.`;

      $('calculator').scrollIntoView({
        behavior: 'smooth'
      });
    });

    card.append(
      tag,
      title,
      size,
      amount,
      note,
      choose
    );

    $('products').append(card);
  });

  $('results').hidden = false;

  $('results').scrollIntoView({
    behavior: 'smooth'
  });
});


// PRIJSONDICATIE

function calculate() {
  const form = $('calculator-form');

  if (!form.checkValidity()) {
    $('total').textContent = 'Controleer de bedragen';
    return null;
  }

  const result =
    Number($('quantity').value) *
    (
      Number($('price').value) +
      Number($('mounting').value)
    ) +
    Number($('extras').value);

  $('total').textContent = money(result);

  return result;
}

$('calculator-form').addEventListener('input', calculate);
$('calculator-form').addEventListener('change', calculate);

$('calculator-form').addEventListener('submit', event => {
  event.preventDefault();
});

calculate();


// BESTAND DOWNLOADEN (ALLEEN AGENDA)

function download(filename, text, type) {
  const url = URL.createObjectURL(
    new Blob([text], { type })
  );

  const a = document.createElement('a');

  a.href = url;
  a.download = filename;

  document.body.append(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


// AGENDA-HERINNERING

function icsEscape(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

$('reminder-form').addEventListener('submit', event => {
  event.preventDefault();

  const date = $('reminder-date').value;

  if (!date || date < localDate()) {
    alert('Kies vandaag of een toekomstige datum.');
    return;
  }

  const day = date.replaceAll('-', '');

  const next = new Date(date + 'T12:00:00Z');
  next.setUTCDate(next.getUTCDate() + 1);

  const end = next
    .toISOString()
    .slice(0, 10)
    .replaceAll('-', '');

  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z/, 'Z');

  const uid =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Date.now() + '-' + Math.random().toString(36).slice(2);

  const calendar = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CB Banden//Herinnering//NL',
    'BEGIN:VEVENT',
    'UID:' + uid + '@cb-banden',
    'DTSTAMP:' + stamp,
    'DTSTART;VALUE=DATE:' + day,
    'DTEND;VALUE=DATE:' + end,
    'SUMMARY:' + icsEscape(
      'C&B · ' + $('reminder-kind').value
    ),
    'DESCRIPTION:' + icsEscape(
      'Neem contact op met C&B Banden Centrale: ' +
      '09 286 89 36. Deze herinnering is geen afspraakbevestiging.'
    ),
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    'DESCRIPTION:Bandenwissel bespreken',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  download(
    'cb-banden-herinnering.ics',
    calendar,
    'text/calendar;charset=utf-8'
  );
});


// OFFERTEAANVRAAG VERSTUREN NAAR CLOUDFLARE D1

$('request-form').addEventListener('submit', async event => {
  event.preventDefault();

  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const status = $('request-status');

  if (!form.reportValidity()) {
    return;
  }

  const data = new FormData(form);

  const total = calculate();

  const payload = {
    name: String(data.get('naam') || '').trim(),
    email: String(data.get('email') || '').trim(),
    phone: String(data.get('telefoon') || '').trim(),
    vehicle: String(data.get('voertuig') || '').trim(),
    service: String(data.get('dienst') || '').trim(),
    preferredDate: String(data.get('datum') || '').trim(),
    message: String(data.get('vraag') || '').trim(),
    tireSelection: selection || 'Nog te bespreken',
    indicativeTotal: total
  };

  // Controle van verplichte gegevens

  if (!payload.name || !payload.phone) {
    status.style.color = '#b42318';
    status.textContent =
      'Vul je naam en telefoonnummer in.';
    return;
  }

  // Voorkom dubbel verzenden

  button.disabled = true;
  button.textContent = 'Aanvraag verzenden...';

  status.textContent = '';
  status.style.color = '#65707b';

  try {

    const response = await fetch('/api/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    let result;

    try {
      result = await response.json();
    } catch {
      throw new Error(
        'De server gaf geen geldig antwoord.'
      );
    }

    if (!response.ok || !result.success) {
      throw new Error(
        result.error || 'De aanvraag kon niet worden verzonden.'
      );
    }

    // SUCCES

    status.style.color = '#287a40';

    status.textContent =
      'Bedankt! Je aanvraag is goed ontvangen. ' +
      'C&B neemt contact met je op om alles te bespreken.';

    form.reset();

    // Terug naar het formulier voor de bevestiging

    status.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });

  } catch (error) {

    console.error('Fout bij offerteaanvraag:', error);

    status.style.color = '#b42318';

    status.textContent =
      'Je aanvraag kon niet worden verzonden. ' +
      'Probeer opnieuw of bel C&B op 09 286 89 36.';

  } finally {

    button.disabled = false;
    button.textContent = 'Verstuur mijn aanvraag';

  }
});
