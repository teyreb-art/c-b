const $ = selector => document.querySelector(selector);
const labels = ['nieuw', 'in behandeling', 'afgerond', 'geannuleerd'];

const calendarState = {
  month: new Date().toLocaleDateString('sv-SE', {
    timeZone: 'Europe/Brussels',
    year: 'numeric',
    month: '2-digit'
  }).slice(0, 7),
  version: 0
};

const euro = value => new Intl.NumberFormat('nl-BE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0
}).format(value || 0);

const state = { user: null, view: 'requests', status: '', q: '', page: 0, activityPage: 0, selected: null, listVersion: 0, detailVersion: 0 };
const date = value => value ? new Intl.DateTimeFormat('nl-BE', { dateStyle: 'medium', timeZone: 'Europe/Brussels' }).format(new Date(value.length === 10 ? value + 'T12:00:00Z' : value)) : 'Te bespreken';
const timestamp = value => new Intl.DateTimeFormat('nl-BE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Brussels' }).format(new Date(value));
const capitalize = value => value.charAt(0).toUpperCase() + value.slice(1);
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function notify(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(notify.timer); notify.timer = setTimeout(() => { $('#toast').hidden = true; }, 3500);
}
function alertError(error) {
  const box = $('#page-alert'); box.replaceChildren(element('span', error.message)); box.hidden = false;
  if (error.status === 401 || error.status === 403) {
    const link = element('a', 'Opnieuw inloggen'); link.href = '/beheer/inloggen'; box.append(link);
    $('#request-rows').replaceChildren(); state.selected = null;
    $('#detail').close(); $('#activity-list').replaceChildren();
    for (const id of ['#stat-new', '#stat-progress', '#stat-done']) $(id).textContent = '—';
  }
}
async function api(path, data) {
  let response;
  try {
    response = await fetch('/api/dashboard/' + path, { method: data ? 'POST' : 'GET', credentials: 'same-origin', redirect: 'error', headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined });
  } catch { throw Object.assign(new Error('De verbinding is onderbroken. Controleer je internetverbinding en probeer opnieuw.'), { status: 503 }); }
  let result;
  try { result = await response.json(); } catch { throw Object.assign(new Error('Je sessie is verlopen. Log opnieuw in.'), { status: 401 }); }
  if (!response.ok) throw Object.assign(new Error(result.error || 'De gegevens konden niet worden geladen.'), { status: response.status });
  return result;
}
function badge(status) {
  const types = { nieuw: 'nieuw', 'in behandeling': 'progress', afgerond: 'done' };
  return element('span', capitalize(status), 'badge badge-' + (types[status] || 'cancelled'));
}
function initials(name) { return name.trim().split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase(); }
function applyFilters(status) {
  state.status = status; state.page = 0;
  document.querySelectorAll('.tabs [data-status]').forEach(button => { const active = button.dataset.status === status; button.classList.toggle('selected', active); button.setAttribute('aria-pressed', String(active)); });
  loadRequests();
}
async function loadRequests() {
  const version = ++state.listVersion;
  $('#refresh').disabled = true; $('#result-caption').textContent = 'Aanvragen laden…'; $('#page-alert').hidden = true;
  try {
    const data = await api('requests?' + new URLSearchParams({ status: state.status, q: state.q, page: state.page }));
    if (version !== state.listVersion) return;
    state.page = data.page;
    $('#stat-new').textContent = data.stats.nieuw || 0;
    $('#stat-progress').textContent = data.stats['in behandeling'] || 0;
    $('#stat-done').textContent = data.stats.afgerond || 0;
    $('#nav-count').textContent = data.stats.nieuw || 0; $('#nav-count').hidden = !data.stats.nieuw;
    $('#result-caption').textContent = data.total + (data.total === 1 ? ' aanvraag' : ' aanvragen') + (state.status || state.q ? ' in deze selectie' : ' ontvangen');
    const rows = $('#request-rows'); rows.replaceChildren();
    for (const item of data.items) {
      const row = element('tr');
      const customer = element('td'), cell = element('div', undefined, 'customer-cell'), text = element('div');
      const name = element('button', item.name, 'text-button'); name.addEventListener('click', () => openDetail(item.id));
      text.append(name, element('small', item.email)); cell.append(element('span', initials(item.name), 'customer-avatar'), text); customer.append(cell);
      const service = element('td'); service.append(element('strong', item.service), element('small', item.vehicle || 'Voertuig te bespreken'));
      const status = element('td'); status.append(badge(item.status));
      const action = element('td'), open = element('button', 'Bekijken', 'open-button'); open.setAttribute('aria-label', 'Bekijk aanvraag van ' + item.name); open.addEventListener('click', () => openDetail(item.id)); action.append(open);
      row.append(customer, service, element('td', date(item.preferred_date)), status, action); rows.append(row);
    }
    $('#empty').hidden = data.items.length > 0;
    $('#empty-copy').textContent = state.status || state.q ? 'Probeer een andere zoekterm of kies een andere status.' : 'Nieuwe aanvragen verschijnen hier zodra iemand het formulier invult.';
    $('#range').textContent = data.total ? `${data.page * data.pageSize + 1}–${Math.min(data.total, (data.page + 1) * data.pageSize)} van ${data.total}` : '0 aanvragen';
    $('#previous').disabled = !data.page; $('#next').disabled = (data.page + 1) * data.pageSize >= data.total;
  } catch (error) { if (version === state.listVersion) { $('#result-caption').textContent = 'Laden mislukt'; alertError(error); } }
  finally { if (version === state.listVersion) $('#refresh').disabled = false; }
}
function detailField(label, value, link) {
  const dl = element('dl'), dd = element('dd');
  if (link) { const a = element('a', value); a.href = link; dd.append(a); } else dd.textContent = value || 'Niet ingevuld';
  dl.append(element('dt', label), dd); return dl;
}
function detailSection(title) { const section = element('section', undefined, 'detail-section'); section.append(element('h3', title)); return section; }
async function openDetail(id) {
  state.selected = id;
  const version = ++state.detailVersion;
  $('#detail-name').textContent = 'Even laden…'; $('#detail-created').textContent = '';
  $('#detail-content').replaceChildren(element('p', 'De aanvraag wordt opgehaald.'));
  if (!$('#detail').open) $('#detail').showModal();
  try {
    const data = await api('request?' + new URLSearchParams({ id }));
    if (state.selected !== id || version !== state.detailVersion) return;
    renderDetail(data);
  } catch (error) {
    if (version !== state.detailVersion) return;
    if (error.status === 401 || error.status === 403) { alertError(error); return; }
    $('#detail-name').textContent = 'Aanvraag'; $('#detail-content').replaceChildren(element('p', error.message, 'detail-error'));
  }
}
function renderDetail({ item, notes, history }) {
  $('#detail-name').textContent = item.name; $('#detail-created').textContent = 'Ontvangen op ' + timestamp(item.created_at);
  const root = $('#detail-content'); root.replaceChildren();
  const customer = detailSection('Klantgegevens'), grid = element('div', undefined, 'detail-grid');
  const phone = item.phone.replace(/[^+\d]/g, '');
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email);
  grid.append(detailField('E-mail', item.email, emailValid ? 'mailto:' + encodeURIComponent(item.email) : null), detailField('Telefoon', item.phone, phone ? 'tel:' + phone : null), detailField('Voertuig / nummerplaat', item.vehicle), detailField('Voorkeursdatum', date(item.preferred_date)));
  customer.append(grid); root.append(customer);
  const request = detailSection('De vraag');
  request.append(detailField('Dienst', item.service), element('p', item.message || 'Geen extra opmerkingen.', 'detail-copy'), detailField('Bandenselectie', item.selection));
  if (item.indicative_total !== null) { const price = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' }).format(item.indicative_total); request.append(element('p', price + ' · Door bezoeker berekende indicatie, geen offerte.', 'detail-copy')); }
  root.append(request);
  const statusSection = detailSection('Opvolging'), form = element('form', undefined, 'status-form');
  const statusLabel = element('label', 'Status van deze aanvraag'); statusLabel.htmlFor = 'detail-status';
  const row = element('div', undefined, 'status-row'), select = element('select'); select.id = 'detail-status';
  for (const status of labels) { const option = element('option', capitalize(status)); option.value = status; option.selected = item.status === status; select.append(option); }
  const save = element('button', 'Opslaan', 'button'); save.type = 'submit'; row.append(select, save);
  const errorBox = element('p', '', 'detail-error'); errorBox.setAttribute('role', 'alert');
  form.append(statusLabel, row, element('p', 'Een statuswijziging verstuurt geen bericht naar de klant.'), errorBox);
  form.addEventListener('submit', async event => {
    event.preventDefault(); save.disabled = true; errorBox.textContent = '';
    try { await api('status', { id: item.id, status: select.value, expectedStatus: item.status }); notify('Status opgeslagen'); await Promise.all([openDetail(item.id), loadRequests()]); }
    catch (error) { if (error.status === 401 || error.status === 403) alertError(error); else { errorBox.textContent = error.message; if (error.status === 409) { const refresh = element('button', 'Aanvraag vernieuwen', 'button secondary small'); refresh.type = 'button'; refresh.addEventListener('click', () => openDetail(item.id)); errorBox.append(element('br'), refresh); } } }
    finally { save.disabled = false; }
  });
  statusSection.append(form); root.append(statusSection);
  const noteSection = detailSection('Interne notities');
  for (const note of notes) { const card = element('article', undefined, 'note'); card.append(element('p', note.body), element('small', (note.author_role === 'upside' ? 'Upside' : 'C&B') + ' · ' + note.author_email + ' · ' + timestamp(note.created_at))); noteSection.append(card); }
  if (!notes.length) noteSection.append(element('p', 'Nog geen notities toegevoegd.', 'detail-copy'));
  const noteForm = element('form', undefined, 'note-form'), label = element('label', 'Notitie toevoegen'); label.htmlFor = 'new-note';
  const textarea = element('textarea'); textarea.id = 'new-note'; textarea.maxLength = 2000; textarea.required = true; textarea.placeholder = 'Bijvoorbeeld: klant gebeld, wacht op bandenmaat.';
  const add = element('button', 'Notitie bewaren', 'button secondary'); add.type = 'submit';
  const noteError = element('p', '', 'detail-error'); noteError.setAttribute('role', 'alert');
  noteForm.append(label, textarea, element('p', 'Alleen zichtbaar voor C&B en Upside. Maximaal 2.000 tekens.'), add, noteError);
  noteForm.addEventListener('submit', async event => {
    event.preventDefault(); add.disabled = true; noteError.textContent = '';
    try { await api('notes', { id: item.id, note: textarea.value }); notify('Notitie bewaard'); await openDetail(item.id); }
    catch (error) { if (error.status === 401 || error.status === 403) alertError(error); else noteError.textContent = error.message; }
    finally { add.disabled = false; }
  });
  noteSection.append(noteForm); root.append(noteSection);
  if (history.length) { const section = detailSection('Geschiedenis'); for (const event of history) section.append(renderEvent(event)); root.append(section); }
}
function renderEvent(event, withCustomer = false) {
  const wrapper = element('article', undefined, 'event');
  const action = event.action === 'status' ? `Status van ${event.old_status} naar ${event.new_status}` : 'Interne notitie toegevoegd';
  const title = element('p', (withCustomer ? event.name + ' · ' : '') + action);
  if (withCustomer) { const open = element('button', 'Aanvraag bekijken', 'text-button'); open.addEventListener('click', () => openDetail(event.request_id)); title.append(element('br'), open); }
  wrapper.append(title, element('small', (event.actor_role === 'upside' ? 'Upside' : 'C&B') + ' · ' + event.actor_email + ' · ' + timestamp(event.created_at))); return wrapper;
}
async function loadActivity() {
  $('#activity-list').replaceChildren(element('p', 'Activiteit laden…'));
  try {
    const data = await api('activity?page=' + state.activityPage);
    $('#activity-list').replaceChildren(...data.items.map(event => renderEvent(event, true)));
    if (!data.items.length) $('#activity-list').append(element('p', 'Nog geen wijzigingen. Hier zie je later wie een status aanpaste of een notitie toevoegde.', 'detail-copy'));
    $('#activity-range').textContent = data.total + ' wijzigingen'; $('#activity-prev').disabled = !state.activityPage; $('#activity-next').disabled = (state.activityPage + 1) * data.pageSize >= data.total;
  } catch (error) { $('#activity-list').replaceChildren(); alertError(error); }
}
async function diagnostics() {
  const root = $('#diagnostics-list'); root.replaceChildren(element('p', 'Verbindingen controleren…'));
  try {
    const data = await api('diagnostics'); root.replaceChildren();
    for (const [label, value] of [['Database', data.database ? 'Verbonden' : 'Niet verbonden'], ['Dashboardtabellen', data.migrations ? 'Ingesteld' : 'Migratie nog uitvoeren'], ['Persoonlijke toegang', 'Gecontroleerd'], ['Versie', data.version]]) { const row = element('div', undefined, 'diagnostic-row'); row.append(element('span', label), element('strong', value)); root.append(row); }
    root.append(element('p', 'Gecontroleerd op ' + timestamp(data.checkedAt)), element('p', 'De website bewaart aanvragen in D1. Dit dashboard verstuurt geen e-mails en bevestigt geen afspraken.'));
  } catch (error) { root.replaceChildren(); alertError(error); }
}

async function loadOverview() {
  try {
    const data = await api('overview');
    const overview = data.overview;

    $('#stat-total').textContent = overview.total || 0;
    $('#stat-value').textContent = euro(overview.indicative_value);
  } catch (error) {
    $('#stat-total').textContent = '—';
    $('#stat-value').textContent = '—';
    console.error('Statistieken laden mislukt:', error);
  }
}

function changeCalendarMonth(amount) {
  const [year, month] = calendarState.month.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1 + amount, 1));

  calendarState.month = next.toISOString().slice(0, 7);
  loadCalendar();
}

async function loadCalendar() {
  const version = ++calendarState.version;
  const root = $('#calendar-grid');
  root.replaceChildren(element('p', 'Kalender laden…'));

  try {
    const data = await api(
      'calendar?' + new URLSearchParams({ month: calendarState.month })
    );

    if (version !== calendarState.version) return;

    const [year, month] = calendarState.month.split('-').map(Number);
    const firstDay = new Date(Date.UTC(year, month - 1, 1));
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const offset = (firstDay.getUTCDay() + 6) % 7;

    $('#calendar-title').textContent =
      new Intl.DateTimeFormat('nl-BE', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC'
      }).format(firstDay);

    root.replaceChildren();

    for (const label of ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo']) {
      root.append(element('div', label, 'calendar-weekday'));
    }

    for (let i = 0; i < offset; i++) {
      root.append(element('div', '', 'calendar-blank'));
    }

    const today = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Brussels',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());

    for (let day = 1; day <= daysInMonth; day++) {
      const dayKey = calendarState.month + '-' + String(day).padStart(2, '0');
      const cell = element('div', undefined, 'calendar-day');

      if (dayKey === today) cell.classList.add('calendar-current');

      cell.append(element('strong', String(day)));

      const appointments = data.items.filter(
        item => item.preferred_date === dayKey
      );

      for (const item of appointments) {
        const button = element(
          'button',
          item.name + ' · ' + item.service,
          'calendar-appointment'
        );

        button.type = 'button';
        button.title = item.service + ' · ' + item.status;
        button.addEventListener('click', () => openDetail(item.id));
        cell.append(button);
      }

      root.append(cell);
    }

    $('#calendar-caption').textContent =
      data.items.length + ' aanvragen met een voorkeursdatum deze maand.' +
      (data.truncated ? ' Er zijn mogelijk meer aanvragen dan getoond.' : '');

  } catch (error) {
    if (version !== calendarState.version) return;
    root.replaceChildren(element('p', error.message));
  }
}

async function exportRequests() {
  const button = $('#export-csv');
  button.disabled = true;

  try {
    const response = await fetch(
      '/api/dashboard/export?' + new URLSearchParams({
        status: state.status
      }),
      { credentials: 'same-origin' }
    );

    if (!response.ok) {
      throw new Error('Exporteren is mislukt.');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'cb-testaanvragen.csv';
    document.body.append(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('CSV-bestand gedownload');

  } catch (error) {
    notify(error.message);
  } finally {
    button.disabled = false;
  }
}

function setView(view) {
  if (view === 'diagnostics' && state.user?.role !== 'upside') return;

  state.view = view;
  $('#page-alert').hidden = true;

for (const name of ['requests', 'calendar', 'loyalty', 'activity', 'diagnostics']) {    $('#' + name + '-view').hidden = name !== view;
  }

  document.querySelectorAll('[data-view]').forEach(button => {
    button.classList.toggle('active', button.dataset.view === view);
  });

  if (view === 'requests') {
    loadRequests();
    loadOverview();
  }

  if (view === 'calendar') loadCalendar();
  if (view === 'loyalty') loadLoyalty();
  if (view === 'activity') loadActivity();
  if (view === 'diagnostics') diagnostics();
}

document.querySelectorAll('[data-status]').forEach(button => button.addEventListener('click', () => applyFilters(button.dataset.status)));
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
$('#refresh').addEventListener('click', () => loadRequests());
$('#logout').addEventListener('click', async () => {
  $('#logout').disabled = true;
  try { await api('auth/logout', {}); window.location.replace('/beheer/inloggen'); }
  catch (error) { alertError(error); $('#logout').disabled = false; }
});
$('#previous').addEventListener('click', () => { state.page--; loadRequests(); }); $('#next').addEventListener('click', () => { state.page++; loadRequests(); });
$('#activity-prev').addEventListener('click', () => { state.activityPage--; loadActivity(); }); $('#activity-next').addEventListener('click', () => { state.activityPage++; loadActivity(); });
let searchTimer; $('#search').addEventListener('input', event => { state.q = event.target.value; state.page = 0; clearTimeout(searchTimer); searchTimer = setTimeout(loadRequests, 250); });
$('#close-detail').addEventListener('click', () => $('#detail').close());
$('#detail').addEventListener('close', () => { state.selected = null; state.detailVersion++; $('#detail-content').replaceChildren(); });
$('#today').textContent = new Intl.DateTimeFormat('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' }).format(new Date());
try {
  const { user } = await api('me'); state.user = user;
  $('#account-name').textContent = user.name; $('#account-email').textContent = user.email; $('#avatar').textContent = user.role === 'upside' ? 'UP' : 'CB'; $('#tech-nav').hidden = user.role !== 'upside';
  await loadRequests();
} catch (error) { $('#account-name').textContent = 'Geen actieve sessie'; $('#result-caption').textContent = 'Log in om aanvragen te bekijken.'; alertError(error); }


$('#calendar-prev').addEventListener('click', () => {
  changeCalendarMonth(-1);
});

$('#calendar-next').addEventListener('click', () => {
  changeCalendarMonth(1);
});

$('#calendar-today').addEventListener('click', () => {
  calendarState.month = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Brussels',
    year: 'numeric',
    month: '2-digit'
  }).format(new Date()).slice(0, 7);

  loadCalendar();
});

$('#export-csv').addEventListener('click', exportRequests);

loadOverview();

/* =========================================
   C&B WISSELVOORDEEL
   Klanten en loyaliteitsregistraties
========================================= */

const loyaltyState = {
  customers: [],
  selected: null,
  version: 0,
  detailVersion: 0
};

const loyaltyMoney = cents =>
  new Intl.NumberFormat('nl-BE', {
    style: 'currency',
    currency: 'EUR'
  }).format((Number(cents) || 0) / 100);

function loyaltyField(label, value) {
  const wrapper = element('div', undefined, 'loyalty-info-field');
  wrapper.append(
    element('small', label),
    element('strong', value || 'Niet ingevuld')
  );
  return wrapper;
}

async function loadLoyalty() {
  const version = ++loyaltyState.version;
  const caption = $('#loyalty-caption');

  caption.textContent = 'Klanten laden…';
  $('#loyalty-refresh').disabled = true;

  try {
    const data = await api('loyalty/customers');

    if (version !== loyaltyState.version) return;

    loyaltyState.customers = data.items || [];

    const customers = loyaltyState.customers;
    const ready = customers.filter(
      customer => Number(customer.change_count) % 2 === 1
    ).length;

    $('#loyalty-total').textContent = customers.length;
    $('#loyalty-ready').textContent = ready;
    caption.textContent =
      customers.length + ' geregistreerde klanten';

    renderLoyaltyCustomers();
  } catch (error) {
    if (version !== loyaltyState.version) return;
    caption.textContent = 'Laden mislukt';
    alertError(error);
  } finally {
    if (version === loyaltyState.version) {
      $('#loyalty-refresh').disabled = false;
    }
  }
}

function renderLoyaltyCustomers() {
  const query = $('#loyalty-search').value
    .trim()
    .toLocaleLowerCase('nl-BE');

  const customers = loyaltyState.customers.filter(customer => {
    const searchable = [
      customer.name,
      customer.email,
      customer.phone,
      customer.vehicle,
      customer.license_plate
    ].join(' ').toLocaleLowerCase('nl-BE');

    return searchable.includes(query);
  });

  const root = $('#loyalty-rows');
  root.replaceChildren();

  for (const customer of customers) {
    const count = Number(customer.change_count) || 0;
    const discountNext = count % 2 === 1;

    const row = element('tr');

    const nameCell = element('td');
    const nameButton = element(
      'button',
      customer.name,
      'text-button'
    );

    nameButton.type = 'button';
    nameButton.addEventListener('click', () => {
      openLoyaltyCustomer(customer.id);
    });

    nameCell.append(
      nameButton,
      element(
        'small',
        customer.email || customer.phone || ''
      )
    );

    const vehicleCell = element('td');
    vehicleCell.append(
      element('strong', customer.vehicle || 'Niet ingevuld'),
      element('small', customer.license_plate || '')
    );

    const countCell = element('td', String(count));

    const advantageCell = element('td');
    advantageCell.append(
      element(
        'span',
        discountNext ? '10% korting' : 'Normaal tarief',
        discountNext
          ? 'badge badge-nieuw'
          : 'badge'
      )
    );

    const actionCell = element('td');
    const button = element(
      'button',
      'Bekijken',
      'open-button'
    );

    button.type = 'button';
    button.addEventListener('click', () => {
      openLoyaltyCustomer(customer.id);
    });

    actionCell.append(button);

    row.append(
      nameCell,
      vehicleCell,
      countCell,
      advantageCell,
      actionCell
    );

    root.append(row);
  }

  $('#loyalty-empty').hidden = customers.length > 0;
}

async function openLoyaltyCustomer(id) {
  loyaltyState.selected = id;
  const version = ++loyaltyState.detailVersion;

  $('#loyalty-detail-name').textContent = 'Even laden…';
  $('#loyalty-detail-subtitle').textContent = '';
  $('#loyalty-detail-content').replaceChildren(
    element('p', 'Klantgegevens laden…')
  );

  if (!$('#loyalty-detail').open) {
    $('#loyalty-detail').showModal();
  }

  try {
    const data = await api(
      'loyalty/customer?' + new URLSearchParams({ id })
    );

    if (
      version !== loyaltyState.detailVersion ||
      loyaltyState.selected !== id
    ) return;

    renderLoyaltyDetail(data);
  } catch (error) {
    if (version !== loyaltyState.detailVersion) return;

    $('#loyalty-detail-content').replaceChildren(
      element('p', error.message, 'detail-error')
    );
  }
}

function renderLoyaltyDetail(data) {
  const customer = data.customer;
  const changes = data.changes || [];
  const count = Number(data.completed) || 0;
  const discountNext = count % 2 === 1;

  $('#loyalty-detail-name').textContent = customer.name;
  $('#loyalty-detail-subtitle').textContent =
    customer.vehicle || 'Klantgegevens';

  const root = $('#loyalty-detail-content');
  root.replaceChildren();

  const information = element(
    'section',
    undefined,
    'detail-section'
  );

  information.append(element('h3', 'Klantgegevens'));

  const grid = element('div', undefined, 'loyalty-info-grid');

  grid.append(
    loyaltyField('E-mail', customer.email),
    loyaltyField('Telefoon', customer.phone),
    loyaltyField('Voertuig', customer.vehicle),
    loyaltyField('Nummerplaat', customer.license_plate)
  );

  information.append(grid);
  root.append(information);

  const progress = element(
    'section',
    undefined,
    'detail-section'
  );

  progress.append(
    element('h3', 'C&B Wisselvoordeel'),
    element(
      'p',
      count + ' uitgevoerde bandenwissel(s)',
      'loyalty-count'
    ),
    element(
      'p',
      discountNext
        ? 'Bij de volgende wissel krijgt deze klant 10% korting op de wisseldienst.'
        : 'Bij de volgende wissel geldt het normale tarief. Daarna volgt 10% korting.',
      'loyalty-hint'
    )
  );

  root.append(progress);

  const register = element(
    'section',
    undefined,
    'detail-section'
  );

  register.append(element('h3', 'Bandenwissel registreren'));

  const form = element('form', undefined, 'loyalty-form');

  const label = element(
    'label',
    'Prijs van de wisseldienst (€)'
  );

  const input = element('input');
  input.type = 'number';
  input.min = '0';
  input.max = '10000';
  input.step = '0.01';
  input.required = true;
  input.placeholder = 'Bijvoorbeeld 60.00';

  const preview = element(
    'p',
    '',
    'loyalty-price-preview'
  );

  const errorBox = element(
    'p',
    '',
    'detail-error'
  );

  errorBox.setAttribute('role', 'alert');

  const save = element(
    'button',
    'Uitgevoerde wissel registreren',
    'button'
  );

  save.type = 'submit';

  function updatePreview() {
    const price = Number(input.value);

    if (
      !input.value ||
      !Number.isFinite(price) ||
      price < 0
    ) {
      preview.textContent = '';
      return;
    }

    const cents = Math.round(price * 100);
    const discount = discountNext
      ? Math.round(cents * 0.1)
      : 0;

    preview.textContent =
      'Wisseldienst: ' + loyaltyMoney(cents) +
      ' · Korting: ' + loyaltyMoney(discount) +
      ' · Totaal: ' + loyaltyMoney(cents - discount);
  }

  input.addEventListener('input', updatePreview);

  let operationId = crypto.randomUUID();

  form.addEventListener('submit', async event => {
    event.preventDefault();

    const price = Number(input.value);

    if (
      !Number.isFinite(price) ||
      price < 0 ||
      price > 10000 ||
      !/^\d+(?:[.,]\d{1,2})?$/.test(input.value)
    ) {
      errorBox.textContent =
        'Vul een geldig bedrag met maximaal twee decimalen in.';
      return;
    }

    const confirmed = window.confirm(
      'Bevestig dat deze bandenwissel daadwerkelijk is uitgevoerd. ' +
      'De registratie telt mee voor het loyaliteitsvoordeel.'
    );

    if (!confirmed) return;

    save.disabled = true;
    errorBox.textContent = '';

    try {
      const result = await api('loyalty/change', {
        customer_id: customer.id,
        operation_id: operationId,
        price
      });

      if (result.duplicate) {
        notify('Deze wissel was al geregistreerd.');
      } else {
        notify(
          'Wissel geregistreerd · korting ' +
          loyaltyMoney(result.change.discount_cents)
        );
      }

      operationId = crypto.randomUUID();

      await loadLoyalty();
      await openLoyaltyCustomer(customer.id);
    } catch (error) {
      errorBox.textContent = error.message;
      if (error.status === 401 || error.status === 403) {
        alertError(error);
      }
    } finally {
      save.disabled = false;
    }
  });

  form.append(
    label,
    input,
    preview,
    element(
      'p',
      'Registreer uitsluitend een werkelijk uitgevoerde wisseldienst. ' +
      'Banden en andere producten tellen niet mee voor de korting.',
      'loyalty-hint'
    ),
    errorBox,
    save
  );

  register.append(form);
  root.append(register);

  const history = element(
    'section',
    undefined,
    'detail-section'
  );

  history.append(element('h3', 'Geschiedenis'));

  if (!changes.length) {
    history.append(
      element(
        'p',
        'Nog geen bandenwissels geregistreerd.',
        'loyalty-hint'
      )
    );
  }

  changes.forEach((change, index) => {
    const number = changes.length - index;

    const item = element(
      'article',
      undefined,
      'loyalty-history-item'
    );

    item.append(
      element(
        'strong',
        'Wissel ' + number +
        (change.discount_percent === 10
          ? ' · 10% korting'
          : '')
      ),
      element(
        'small',
        timestamp(change.performed_at)
      ),
      element(
        'p',
        'Dienst: ' +
        loyaltyMoney(change.service_price_cents) +
        ' · Korting: ' +
        loyaltyMoney(change.discount_cents) +
        ' · Totaal: ' +
        loyaltyMoney(change.final_price_cents)
      ),
      element(
        'small',
        'Geregistreerd door ' + change.created_by
      )
    );

    history.append(item);
  });

  root.append(history);
}

$('#loyalty-refresh').addEventListener(
  'click',
  loadLoyalty
);

$('#loyalty-search').addEventListener(
  'input',
  renderLoyaltyCustomers
);

$('#loyalty-close').addEventListener('click', () => {
  $('#loyalty-detail').close();
});

$('#loyalty-detail').addEventListener('close', () => {
  loyaltyState.selected = null;
  loyaltyState.detailVersion++;
  $('#loyalty-detail-content').replaceChildren();
});

$('#loyalty-customer-form').addEventListener(
  'submit',
  async event => {
    event.preventDefault();

    const form = event.currentTarget;
    const save = $('#loyalty-add');
    const errorBox = $('#loyalty-form-error');

    const data = {
      name: $('#loyalty-name').value.trim(),
      email: $('#loyalty-email').value.trim(),
      phone: $('#loyalty-phone').value.trim(),
      vehicle: $('#loyalty-vehicle').value.trim(),
      license_plate: $('#loyalty-plate').value.trim()
    };

    errorBox.textContent = '';

    if (!data.name || (!data.email && !data.phone)) {
      errorBox.textContent =
        'Vul een naam en e-mail of telefoonnummer in.';
      return;
    }

    save.disabled = true;

    try {
      await api('loyalty/customers', data);

      form.reset();
      notify('Klant toegevoegd');

      await loadLoyalty();
    } catch (error) {
      errorBox.textContent = error.message;
      if (error.status === 401 || error.status === 403) {
        alertError(error);
      }
    } finally {
      save.disabled = false;
    }
  }
);

