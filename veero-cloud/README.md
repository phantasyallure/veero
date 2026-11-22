# Veero Solutions — HSE & Quality control by camera

Cameras detect **HSE risks** (fire, smoke, missing PPE, falls, spills, blocked exits, restricted zones…) and **quality issues**
(dirt or foreign objects near food/product, missing hygiene gear, pests, cold-chain breaks…). The right manager is alerted, the
administration sees both domains in one dashboard, and a manual **register** tracks everything that expires (extinguishers, lots,
calibrations, certificates) with alerts before the date.

Stack: static pages + one serverless function (`api/index.js`) on **Vercel**, data in **Supabase**, optional AI (Gemini).

## Who uses what
| Who | Where | What they see |
|---|---|---|
| Platform owner (you) | `/admin` (access code) | All sites: live risks, register, reports (day/month), analytics, subscriptions, software health, members |
| Site administration | `/app` (e-mail + password) | Their site, both domains: risks, **Registre**, reports + analytics, the two managers, pairing code |
| HSE manager (1 per site) | `/staff` (ID + PIN, from the home page → *Responsable*) | Only HSE alerts + HSE deadlines; one tap *Pris en charge* |
| Quality manager (1 per site) | `/staff` | Only quality alerts + quality deadlines |
| Camera software (`veero-software`, Windows app) | `POST /api?op=d_push` | Detects risks on site, sends them here. See `docs/ENGINE_CONTRACT.md` |

There is no team to manage: exactly one HSE manager and one quality manager per site.

## Set up
1. **Supabase** → SQL Editor → paste `supabase.sql` → Run (safe to re-run; it upgrades an existing restaurant-version database).
   Old restaurant data is ignored by the new screens; to start clean run `truncate nj_events, nj_state;`.
2. **Vercel** → import the project → add the variables of `.env.example` (`ACCESS_CODE`, `SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`; optional `GEMINI_API_KEY`, `TZ_NAME`) → Deploy.
3. Open the site → **Créer un compte** (the client's administration) → **Compte** shows the *site id* and *pairing code*.
4. In the administration portal → **Responsables** → create the HSE manager and the quality manager (each gets an ID + one-time PIN).
5. Connect the engine with the id + code, or try without cameras: `node tools/simulate.js https://YOUR-APP.vercel.app SITE-ID PAIRING-CODE`.

Local test: `cp .env.example .env`, fill it, `npm run dev` → http://localhost:3000. Tests: `npm test`.

## Registre (manual entry)
Equipment and checks with a deadline: extinguishers, fire hose reels, alarms, electrical checks, first-aid kits, PPE, lifting gear,
trainings (HSE) and lots / use-by dates, probe calibration, pest control, water tests, ISO / HACCP certificates (quality).
Each item has a *remind X days before* setting (default 30). Pick a type and the form suggests a date; **Renouveler** pushes the deadline by the
suggested interval after a check. Suggested intervals live in `public/static/hse.js` and are only defaults — adapt them to your
supplier, your standard (ISO 45001 / 14001 / 9001 / 22000, HACCP plan) and the local regulation (in Algeria, law 88-07 on hygiene, safety and occupational medicine).

## Reports and analytics
* **Daily / monthly report** (text, copy or print): detections by domain, critical, resolved, average and longest handling time, escalations,
  most frequent risk, most exposed zone, busiest day, deadlines of the register.
* **Analytics**: detections per day, HSE vs quality, risks by type, zones and hours, per site (platform admin) — computed from the real event history.

## Customising for a client
* Risk catalogue and register types: `public/static/hse.js` (labels in FR / EN / AR).
* Name, pricing, plans: platform admin → *Général* / *Abonnements*.
* Wording of each page: the pages are plain HTML (`public/*.html`); admin strings are in the `I` object of `admin.html`.

## Security notes
The Supabase secret key and the Gemini key stay on the server. Tables have row-level security on and no public policy.
Managers can only read and acknowledge the risks of their own domain; the domain is read from the database, never from the request.
