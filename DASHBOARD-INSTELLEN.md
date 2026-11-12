# C&B-dashboard instellen

Deze versie bouwt verder op de werkende Worker uit `teyreb-art/c-b` (bronversie `6f643a35f9f6be8c2b25bad929a37623c3ab9082`). Het dashboard opent straks via `/beheer/` op dezelfde website.

De code is lokaal getest. Er is nog niets naar jouw GitHub of Cloudflare-account gepubliceerd. De persoonlijke toegang moet eerst in Cloudflare worden ingesteld. De code bevat geen accounts, wachtwoorden of echte klantgegevens.

## Wat je krijgt

- Aanvragen uit de bestaande D1-database, met zoeken en statusfilters.
- Klantdetails, telefoon, e-mail, voertuig, voorkeursdatum en bandenselectie.
- Statussen: nieuw, in behandeling, afgerond en geannuleerd.
- Interne notities en geschiedenis met het e-mailadres van de beheerder.
- Een technische controlepagina voor Upside.
- Een aangepaste weergave voor telefoon en computer.

Beide personen loggen in met hun eigen e-mailadres via Cloudflare Access. Met One-time PIN ontvangt iedere persoon op verzoek een eigen inlogcode per e-mail. De eigenaar krijgt hiervoor geen toegang tot jouw Cloudflare-account nodig. Er is geen gedeeld dashboardwachtwoord.

| Account | Mogelijkheden |
| --- | --- |
| C&B-eigenaar | Aanvragen bekijken, zoeken, status aanpassen, notities toevoegen en activiteit bekijken |
| Upside | Dezelfde mogelijkheden plus technische controle van database en dashboardinstellingen |

De technische controle geeft geen toegang tot Cloudflare-instellingen en toont geen secrets. Het dashboard verstuurt geen mails of afspraakbevestigingen. Je werkende publieke aanvraagroute blijft `/api/request`.

## 1. Twee e-mailadressen kiezen

Kies één bereikbaar e-mailadres voor de eigenaar en één voor Upside. Dit moeten verschillende adressen zijn. Gebruik uitsluitend adressen waarvoor je toegang wilt geven tot de aanvragen.

## 2. Database uitbreiden

1. Open Cloudflare → Storage & databases → D1 → jouw bestaande `cb-banden-db`.
2. Open Console.
3. Kopieer alle SQL uit `migrations/0002_dashboard.sql` en voer die uit.

Dit voegt alleen `dashboard_notes` en `dashboard_audit` met bijbehorende indexen toe. De bestaande `requests`-tabel en aanvragen blijven behouden. Gebruik de bestaande bindingnaam `DB` en de bestaande database-ID uit `wrangler.jsonc`. Maak geen nieuwe database aan.

Alternatief vanuit de projectmap, met aangemelde Wrangler:

```sh
npx wrangler d1 execute cb-banden-db --remote --file migrations/0002_dashboard.sql
```

## 3. Persoonlijke login in Cloudflare Access

1. Open Cloudflare Zero Trust / Cloudflare One.
2. Noteer je teamdomein, bijvoorbeeld `https://jouw-team.cloudflareaccess.com`.
3. Activeer **One-time PIN** als loginmethode bij de identity providers / login methods. De menuplaats kan verschillen met de dashboardversie.
4. Ga naar **Access → Applications → Add an application** en kies een self-hosted applicatie.
5. Noem de applicatie `C&B dashboard` en kies bijvoorbeeld een sessieduur van 8 uur.
6. Voeg binnen **dezelfde applicatie** de twee beschermde paden toe op je echte websitehostnaam:

| Hostnaam | Path |
| --- | --- |
| De hostnaam van je bestaande C&B-website, zonder `https://` | `beheer/*` |
| Dezelfde hostnaam | `api/dashboard/*` |

Gebruik bij een `workers.dev`-adres zo nodig de vrije invoer voor de hostnaam. Cloudflare ondersteunt hostname- en padbeveiliging voor Workers. Bescherm alleen deze dashboardpaden: zet geen login op de hele publieke website of `/api/request`. Gebruik dezelfde Access-applicatie voor scherm en API zodat beide dezelfde AUD gebruiken. Voeg bij een later eigen domein de overeenkomstige paden toe aan dezelfde applicatie.

7. Maak één **Allow**-policy met **Include → Emails** en uitsluitend jullie twee exacte e-mailadressen. Gebruik geen Everyone, brede domeintoegang, Bypass of service-tokenpolicy voor dit dashboard.
8. Kies One-time PIN als toegestane loginmethode en sla op.
9. Kopieer de **Application Audience (AUD) Tag** van deze applicatie. Dit is niet het Application ID.

## 4. Vier variabelen bij de bestaande Worker

Open Workers & Pages → `c-b` → Settings → Variables and Secrets. Voeg toe:

| Variabele | Waarde |
| --- | --- |
| `ACCESS_TEAM_DOMAIN` | Het volledige teamdomein, zoals `https://jouw-team.cloudflareaccess.com` |
| `ACCESS_AUD` | De gekopieerde Application Audience (AUD) Tag |
| `CB_OWNER_EMAIL` | Het exacte toegestane e-mailadres van de eigenaar |
| `UPSIDE_EMAIL` | Het exacte toegestane e-mailadres van Upside |

De e-mails moeten overeenkomen met de Allow-policy. Zet deze waarden in Cloudflare, niet in de publieke browserbestanden. Bewaar je bestaande D1-binding en overige instellingen. Publiceer opnieuw na het aanpassen van de variabelen.

## 5. Bestanden naar GitHub

1. Pak de zip uit.
2. Open je bestaande repository `teyreb-art/c-b`.
3. Kies Add file → Upload files.
4. Upload de **inhoud** van de uitgepakte map met alle submappen op het hoogste niveau van de repository. Zet er geen extra bovenliggende map omheen.
5. Commit de wijziging. De bestaande GitHub-koppeling van de Cloudflare Worker kan dan opnieuw publiceren.

De gewijzigde configuratie gebruikt nog steeds `worker.js`. De build-opdracht `node build-static.mjs` staat in `wrangler.jsonc` en kopieert uitsluitend websitebestanden naar `public/`. Servercode, tests en SQL worden daardoor niet als publieke assets aangeboden. Gebruik de bestaande Workers-deployment; dit pakket gebruikt geen Pages Functions.

Belangrijkste toegevoegde en gewijzigde bestanden:

| Bestand | Functie |
| --- | --- |
| `worker.js` | Verbindt het dashboard met de bestaande Worker |
| `wrangler.jsonc` | Bestaande databasebinding en routes voor het dashboard |
| `beheer/index.html`, `beheer/style.css`, `beheer/app.js` | Het dashboard |
| `server/access.js` | Controle van ondertekende Cloudflare Access-sessies en rollen |
| `server/dashboard.js` | Afgeschermde dashboard-API en schermroutes |
| `migrations/0002_dashboard.sql` | Interne notities en activiteitenlog |
| `build-static.mjs` | Verzamelt publieke bestanden voor publicatie |
| `package.json`, `tests/dashboard.test.js` | Bouw- en testopdrachten |

Je bestaande `index.html`, `style.css`, `script.js` en afbeeldingen zijn meegenomen vanuit de genoemde bronversie. Als je die bestanden daarna zelf hebt aangepast, behoud dan jouw nieuwere versies: de dashboardwijziging heeft geen aanpassing van deze publieke websitebestanden nodig. Het oude lege `admin.html` wordt niet meer gepubliceerd; die route verwijst naar `/beheer/`.

## 6. Live controleren

1. Open `/beheer/` op de gepubliceerde C&B-site. Je hoort eerst de Cloudflare-inlogpagina te zien.
2. Log in met het Upside-adres en de code die Cloudflare naar dat adres stuurt.
3. Controleer of je bestaande testaanvraag verschijnt en of je Technische controle kunt openen.
4. Voeg een herkenbare testnotitie toe en verander de status van die testaanvraag.
5. Log uit. Test in een andere privésessie met het eigenaarsadres.
6. Controleer dat de eigenaar de aanvraag, notitie en geschiedenis ziet, en geen technische controlepagina heeft.
7. Zonder ingelogde sessie mag `/api/dashboard/requests` geen klantgegevens teruggeven. Bij Access kan eerst een redirect naar de login volgen.
8. Verstuur een fictieve aanvraag via het publieke formulier en controleer of die in het dashboard verschijnt.

## Toegang later intrekken

Verwijder het betreffende adres uit de Access-policy en beëindig de Access-sessies van die persoon. Pas ook het overeenkomstige e-mailadres bij de Worker aan naar dat van de vervanger en publiceer opnieuw. De Worker controleert het adres bij iedere dashboardactie, ook bij een nog ondertekende sessie. Gebruik geen leeg adres als tijdelijke instelling: bij onvolledige configuratie sluit het dashboard voor beide accounts.

## Problemen oplossen

| Melding | Controle |
| --- | --- |
| Persoonlijke toegang nog niet ingesteld | Zijn alle vier variabelen ingevuld en is opnieuw gepubliceerd? |
| Sessie verlopen of ongeldig | Gebruiken scherm en API dezelfde Access-applicatie en de juiste AUD en teamdomein? |
| Geen toegang voor dit account | Staat hetzelfde exacte adres in de Access-policy én in de Worker-variabele? |
| Geen inlogcode ontvangen | Is One-time PIN actief, staat het adres in de Allow-policy en zit de mail niet bij spam? |
| Aanvragenlijst laadt, details of opslaan mislukken | Is de SQL-migratie op dezelfde database als binding `DB` uitgevoerd? |
| Aanvraag intussen gewijzigd | Vernieuw de aanvraag: de andere beheerder heeft de status al aangepast. |
| Geen aanvragen | Controleer filters en dat binding `DB` naar de bestaande `cb-banden-db` wijst. |

## Validatie

`npm test` gebruikt Node.js 24 met een lokale SQLite-database en echte lokaal gegenereerde RSA-testsleutels. Er wordt geen echte Cloudflare-login uitgevoerd en er worden geen echte e-mails verstuurd. De tests controleren onder meer rollen, ondertekening, verlopen en ongeldige sessies, afwijzing zonder login, zoeken, paginering, auditopslag, notities, statusconflicten, herkomstcontrole en de bestaande aanvraagfunctie. De interface is afzonderlijk bekeken met fictieve gegevens op een breed en een smal scherm.

```sh
npm test
npm run build
```

Officiële documentatie:

- https://developers.cloudflare.com/workers/configuration/cloudflare-access/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/

