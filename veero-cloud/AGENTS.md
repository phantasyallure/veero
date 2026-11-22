# Veero Solutions — project briefing (read first)

Camera-based **HSE (hygiene, safety, environment) + quality** monitoring dashboard. Vercel serverless + Supabase. No framework, no build step.
Converted from a restaurant product: internal names kept on purpose (`nj_restaurants` = **sites**, column `table_name` = **zone**, `restaurant_id` = site id).

## Layout
- `api/index.js` → `lib/core.js` — all API logic (`createHandler`). Pure helpers at the top are unit-tested.
- `lib/brand.js` — platform name + public pricing. `dev-server.js` — local server (`npm run dev`).
- `public/*.html` — `index` (landing/login), `app` (site administration), `staff` (HSE / quality manager alerts), `admin` (platform owner), about/contact/privacy.
- `public/static/hse.js` — **single source** of risk types and register types (FR/EN/AR), used by server and pages.
- `supabase.sql` — idempotent schema. `docs/ENGINE_CONTRACT.md` — what the camera engine must push. `tools/simulate.js` — fake engine.

## Domain rules
- Two domains only: `hse`, `quality`. Exactly **one manager per domain per site** (`nj_employees.role` ∈ hse|quality). No staff team.
- Events (`nj_events`): `type` ∈ detected|resolved|escalated|ack, plus `domain`, `risk_type`, `level` (warn|critical), `ref` (risk id), `table_name` (zone).
- Register (`nj_assets`): manual items with `expires_on`; status expired / soon / ok comes from `HSE.assetState` in the **site's timezone** (`TZ_NAME`).
- A manager only gets risks of his own domain; the domain comes from the DB, never from the request body.

## Commands
`npm test` (must stay green) · `npm run dev` · `npm run simulate -- <url> <site-id> <pairing-code>`

## Conventions
- Never put the Supabase secret key or any key in a page. Validate every id (`idOk`) and use `encodeURIComponent` in PostgREST filters.
- New risk or register type → edit `hse.js` only (all three languages), then `npm test`.
- UI strings: `admin.html` has an `I = {fr,en,ar}` object (add keys in all three); other pages are French.
- Add or change an API op → add a test in `test/core.test.js` (fake `fetch`, see existing tests).
- Keep answers and UI texts short; the readers are managers on phones.
