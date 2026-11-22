# Veero engine ↔ cloud contract (HSE & Quality)

The camera software (`veero-software`, runs on the client's PC) reads the cameras, decides what is a risk, and **pushes** the result to the cloud every ~2 s.
The cloud only displays, alerts, stores and reports: it never touches the cameras.

> `veero-software` (Windows app + `run.py`, HSE & Quality version) implements this contract: `engine/cloud.py` sends it, `engine/risks.py` decides what is a risk.
> Test the whole platform without cameras: `node tools/simulate.js https://YOUR-APP.vercel.app SITE-ID PAIRING-CODE`, or `python run.py --demo` in `veero-software` with `VEERO_PAIR_CODE` set.

## Authentication
Every call is a `POST` with the site id and the pairing code (administration portal → **Compte**):
```json
{ "id": "usine-oran", "code": "ABCD-EFGH-JKLM", ... }
```
Wrong id or code → `401`. 10 failures per minute per IP → `429`. Renewing the code in the portal invalidates the old one.

## `POST /api?op=d_register`
Body: `{ id, code }` → `{ ok: true, name }`. Use it once at start-up to check the pairing.

## `POST /api?op=d_push` (every ~2 s)
```json
{
  "id": "usine-oran", "code": "ABCD-EFGH-JKLM",
  "state":   { "...full snapshot, see below..." },
  "summary": { "...small card for the home screen..." },
  "events":  [ "...only NEW events since the last push..." ]
}
```
`state` and `summary` **replace** the previous ones. `events` are **appended** to the history (daily/monthly reports and analytics are computed from them), so send each event once.
The site shows **online** while the last push is < 30 s old.

**Answer:** `{ "ok": true, "acks": [ { "ref": "r-1042", "by": "Samir" } ] }` — the risks (by `id`) that a manager tapped *Pris en charge* on during the last 12 h
(only computed while the pushed `state` has open risks). Use it to stop escalating those risks and to put `by` in the `responder` of the matching `resolved` event.

### `state`
```json
{
  "meta": { "mode": "live", "generated_at": "2026-11-20T10:15:00Z" },
  "kpi":  { "open": 2, "hse_open": 1, "quality_open": 1, "critical": 1, "alerts": 14, "resolved": 12, "avg_response": 180, "longest_open": 95 },
  "zones": [
    { "name": "Atelier de production", "domain": "hse", "state": "risk", "level": "critical",
      "polygon": [[0.04,0.08],[0.46,0.08],[0.46,0.52],[0.04,0.52]], "center": [0.25,0.30] }
  ],
  "risks": [
    { "id": "r-1042", "domain": "hse", "type": "fire", "zone": "Atelier de production", "level": "critical", "seconds": 95, "camera": "CAM-01", "detail": "près d’un opérateur" }
  ],
  "resolved": [ { "domain": "quality", "type": "dirt", "zone": "Conditionnement", "seconds": 240, "responder": "Responsable Qualité" } ],
  "events":   [ { "ts": 1763633700000, "type": "detected", "domain": "hse", "risk_type": "fire", "zone": "Atelier de production", "level": "critical" } ]
}
```
* `kpi` — counts **for today**: `alerts` = detections sent, `resolved` = risks closed, `avg_response` / `longest_open` in **seconds**.
* `zones[].state` = `ok` | `risk`; `level` = `ok` | `warn` | `critical`. `polygon` / `center` are optional, normalised 0–1 (used for the floor plan).
* `risks[]` = everything open **right now**. `id` must stay **stable** for the whole life of a risk (acknowledgements are matched on it). `seconds` = how long it has been open.
* `domain` ∈ `hse` | `quality`. `type` ∈ the keys of `RISKS` in `public/static/hse.js` (fire, smoke, no_ppe, fall, spill, exit_blocked, restricted, vehicle, height, smoking, dirt, foreign, hygiene_ppe, floor_product, pest, cross, cold_chain, waste, surface, other).
* Keep `state` under ~400 KB. Never send images (the cloud shows no video).

### `summary`
`{ "mode": "live", "health": 82, "kpi": { …same as state.kpi… }, "zones": [ { "name", "domain", "state", "level" } ] }`
`health` (0–100) is your compliance score; Veero shows it in a ring on each site card.

### `events[]`
| field | values |
|---|---|
| `type` | `detected` · `resolved` · `escalated` · `ack` |
| `domain` | `hse` \| `quality` |
| `risk_type` | key of the risk catalogue |
| `level` | `warn` \| `critical` |
| `zone` | zone name |
| `ref` | the risk `id` (links detected → resolved / ack) |
| `responder` | who handled it (for `resolved`) |
| `seconds` | handling time (for `resolved`) / waiting time (for `escalated`) |
| `notify` | `hse` \| `quality` \| `admin` — who was alerted |

* `detected` when a risk opens, `resolved` when it closes, `escalated` when nobody took it in charge after your delay (alert the administration), `ack` is also written by the cloud when a manager taps *Pris en charge*.

## `POST /api?op=d_due`
Body `{ id, code }` → `{ ok, due: [ { name, domain, category, location, expires_on, days, state } ] }`
Items of the manual register that are **expired** (`days < 0`) or **close** (`state: "soon"`). Call it e.g. once a day and forward the list to the managers by WhatsApp / Telegram / e-mail.

## Who gets which alert
| risk domain | alerted | sees it on |
|---|---|---|
| `hse` | the HSE manager (one per site) | `/staff` (ID + PIN), administration portal, platform admin |
| `quality` | the quality manager (one per site) | `/staff`, administration portal, platform admin |
| `escalated` | the administration | portal + reports |

## What the cameras can realistically detect
Industry vendors list these as standard camera-AI use cases: missing PPE (helmet, vest, gloves, goggles, harness), fire and smoke, forklift–pedestrian proximity, restricted-zone entry, falls, spills and leaks, blocked exits. For quality in food environments: foreign objects, dirt near product, missing hairnet/gloves, product on the floor, pests, open cold-chain doors.
Each needs its own trained model and zone rules per camera; start with the 2–3 your client cares about most and measure false alarms before adding more. Camera AI is an **aid**: it does not replace certified fire-detection systems or the HSE / quality manager.
