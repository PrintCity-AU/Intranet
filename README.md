# PrintCity Intranet

An internal web app for the PrintCity team, built around work health and safety.
It runs entirely on Cloudflare: Pages for the site, Pages Functions for the API, D1 for the database, R2 for uploaded files, and Cloudflare Access for staff login.
Staff can install it on a phone from the browser ("Add to Home Screen").

## What is in it

| Area | What it does |
| --- | --- |
| Machinery | A page per machine: PPE, key hazards, SOP, safe working procedure, shutdown, emergency stop, documents, and a printable QR label that opens the page. |
| Training | A module per machine: read the training, pass a quiz, make a declaration, then a manager observes a practical checklist and signs the person off. A training matrix and CSV export show who is competent on what. |
| Hazards and near misses | Anyone can report in a minute, with photos and a risk rating. Managers raise corrective actions with an owner and due date. |
| Incident register | Injuries and incidents, with notifiable-incident tracking. Staff see only what they reported. |
| Pre-start checks | A checklist per machine. A failed item raises a hazard automatically. |
| Test and tag | Electrical items, RCDs, extinguishers and first aid kits with test history and next-due dates. |
| Licences and tickets | Forklift, first aid, warden and other tickets with expiry reminders. |
| Chemicals and SDS | Chemical register with safety data sheets, flagged when an SDS reaches 5 years old. |
| Emergency | One-tap call buttons, first aiders and wardens, and the emergency plan. |
| Toolbox talks | Minutes and attendance, with each person confirming they attended. |
| Policies | Policy library with "read and acknowledged" records per version. |
| Team | Staff directory, org chart, leave calendar and requests, uniform ordering with manager approval, noticeboard, handbook pages. |
| Dashboard | Open hazards, overdue actions, sign-offs waiting, test and tag due, licences expiring, and each person's own to-do list. |

Roles: **staff** (use everything), **manager** (also approves uniforms and leave, signs off training, manages the registers), **admin** (also manages people and roles).

## Putting it live (Cloudflare dashboard)

You do all of this in the browser. Allow about 30 minutes.

### 1. Create the Pages project
1. Cloudflare dashboard, **Workers & Pages**, **Create**, **Pages**, **Connect to Git**.
2. Choose the `Intranet` repository and the `main` branch.
3. Framework preset: **None**. Build command: leave empty. Build output directory: `public`.
4. **Save and Deploy**. The site will load but show "The database is not connected". That is expected.

### 2. Create the database and file storage
1. **Storage & Databases**, **D1 SQL Database**, **Create**. Name it `printcity-intranet`.
2. **R2 Object Storage**, **Create bucket**. Name it `printcity-intranet-files`. (Cloudflare asks for a card to turn R2 on. The free allowance is 10 GB.)

You do not need to run any SQL. The app creates its own tables the first time it is opened.

### 3. Connect them to the Pages project
In the Pages project, **Settings**, **Bindings**, **Add**:

| Type | Variable name | Value |
| --- | --- | --- |
| D1 database | `DB` | `printcity-intranet` |
| R2 bucket | `FILES` | `printcity-intranet-files` |

The variable names must be exactly `DB` and `FILES`.

### 4. Turn on staff login (Cloudflare Access)
1. Cloudflare dashboard, **Zero Trust**, **Access**, **Applications**, **Add an application**, **Self-hosted**.
2. Application domain: add the address staff will use (for example `intranet.yourdomain.com.au`) **and** the `your-project.pages.dev` address, plus `*.your-project.pages.dev` so preview builds are covered too.
3. Add a policy: Action **Allow**, Include **Emails ending in** `@yourdomain.com.au` (or list each person's email).
4. Login method: **One-time PIN** works out of the box and emails each person a code. You can add Google or Microsoft sign-in later.
5. Save, then open the application and copy the **Application Audience (AUD) Tag**.
6. Your team domain is shown under **Zero Trust**, **Settings**, **Custom Pages** (it looks like `yourteam.cloudflareaccess.com`).

### 5. Add the settings
In the Pages project, **Settings**, **Variables and Secrets**, add for **Production** (and Preview if you use it):

| Name | Value |
| --- | --- |
| `ACCESS_TEAM_DOMAIN` | `yourteam.cloudflareaccess.com` |
| `ACCESS_AUD` | the AUD tag from step 4 |
| `ADMIN_EMAILS` | your work email (comma-separated for more than one) |

Do **not** add `DEV_USER_EMAIL`. That is for testing on a developer's computer only.

Until `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are set, the app refuses every request, so nothing is exposed while you are setting up.

### 6. Redeploy
Bindings and variables only apply to new deployments. **Deployments**, find the latest, **Retry deployment**.

### 7. Custom address (optional)
Pages project, **Custom domains**, **Set up a domain**, for example `intranet.yourdomain.com.au`.

### 8. First sign-in
1. Open the site and sign in with the email you put in `ADMIN_EMAILS`. You are the admin.
2. **Manage people**: add each staff member's email, role and who they report to (this builds the org chart). People who are not added in advance appear automatically as "staff" the first time they sign in.
3. **Machinery**: add each machine. **Print QR labels** when you are done.
4. **Training**, **Manage modules**: add a module per machine with quiz questions and the practical checks a supervisor must observe.
5. On a phone, open the site and choose "Add to Home Screen".

## Things to know

- **Sign-off rule**: nobody can sign off their own training, and a "competent" sign-off needs every practical check ticked plus the observer's confirmation. Records are never deleted, only revoked with a reason.
- **Retraining**: raise a module's version number and every existing sign-off for it shows as "Retraining required".
- **Reminders** show on the dashboard. Email reminders are not built yet.
- **Changing colours or the name**: the colours are at the top of `public/css/app.css`.
- **Adding a field to a register**: add it to `public/js/schema.js`. The database column is added automatically on the next request.
- **Backups**: D1 keeps 30 days of point-in-time recovery (Time Travel). For your own copy, managers can use the **Export** button on each register.
- The procedure, training and quiz content has to come from you: the manufacturer's manual, your risk assessments and how the job is done on your floor. The app holds and enforces it; it does not write it.

## For developers

```
npm install
cp .dev.vars.example .dev.vars
npm run dev          # http://localhost:8788 with a local database and file store
npm test             # with the dev server running against a fresh local database
```

No build step. `public/` is served as-is, `functions/api/[[path]].js` hands every `/api/*` request to `src/api.js`.
In local dev, send an `X-Dev-User: someone@example.com` header to act as another person.

- `public/js/schema.js`: every register's fields and permissions, shared by the browser and the API.
- `src/api.js`: generic create/read/update/delete with permission checks.
- `src/custom.js`: training sign-off, pre-starts, uniform orders, dashboard, files.
- `src/auth.js`: verifies the Cloudflare Access token.
- `src/migrations.js`: creates and upgrades tables automatically.
- `public/vendor/qrcode.js`: QR Code Generator by Kazuhiko Arase, MIT licence.
