#!/usr/bin/env node
"use strict";
/* Fake "camera engine": pushes realistic HSE and quality data to your Veero site so you can see the dashboards alive
   without cameras. Same protocol as the real engine (see docs/ENGINE_CONTRACT.md).
   Usage:  node tools/simulate.js https://your-app.vercel.app <site-id> <pairing-code>
   Stop with Ctrl+C. Data is marked mode:"demo". */
const [base, id, code] = process.argv.slice(2);
if (!base || !id || !code) { console.log("Usage: node tools/simulate.js <https://your-app.vercel.app> <site-id> <pairing-code>"); process.exit(1); }
const HSE = require("../public/static/hse.js");

const ZONES = [
  { name: "Atelier de production", domain: "hse", polygon: [[.04, .08], [.46, .08], [.46, .52], [.04, .52]] },
  { name: "Quai de chargement", domain: "hse", polygon: [[.5, .08], [.96, .08], [.96, .4], [.5, .4]] },
  { name: "Conditionnement", domain: "quality", polygon: [[.04, .58], [.46, .58], [.46, .96], [.04, .96]] },
  { name: "Préparation / cuisine", domain: "quality", polygon: [[.5, .46], [.96, .46], [.96, .96], [.5, .96]] },
].map((z) => ({ ...z, center: [z.polygon.reduce((a, p) => a + p[0], 0) / 4, z.polygon.reduce((a, p) => a + p[1], 0) / 4] }));
const CRITICAL = new Set(["fire", "smoke", "fall", "height"]);
const TYPES = { hse: ["fire", "smoke", "no_ppe", "no_ppe", "spill", "restricted", "vehicle", "exit_blocked"], quality: ["dirt", "dirt", "foreign", "hygiene_ppe", "hygiene_ppe", "floor_product", "pest", "cold_chain"] };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const STEP = 2;                                              // seconds between pushes

let n = 0, detectedToday = 0, resolvedTotal = 0, resolvedSecs = 0;
const risks = new Map(), resolved = [], events = [];

function tick() {
  const fresh = [];
  const log = (e) => { const ev = { ts: Date.now(), ...e }; events.push(ev); fresh.push(e); if (events.length > 40) events.shift(); };
  for (const r of [...risks.values()]) {
    r.seconds += STEP;
    if (r.seconds >= 20 && Math.random() < 0.12) {           // someone handled it
      risks.delete(r.id); resolvedTotal++; resolvedSecs += r.seconds;
      const by = r.domain === "hse" ? "Responsable HSE" : "Responsable Qualité";
      resolved.unshift({ domain: r.domain, type: r.type, zone: r.zone, seconds: r.seconds, responder: by }); resolved.length = Math.min(resolved.length, 8);
      log({ type: "resolved", domain: r.domain, risk_type: r.type, zone: r.zone, seconds: r.seconds, responder: by, ref: r.id });
    } else if (r.seconds >= 90 && !r.escalated) {            // nobody reacted: tell the administration
      r.escalated = true; log({ type: "escalated", domain: r.domain, risk_type: r.type, zone: r.zone, seconds: r.seconds, notify: "admin", ref: r.id });
    }
  }
  if (risks.size < 4 && (n === 0 || Math.random() < 0.25)) {
    const z = pick(ZONES), domain = Math.random() < 0.6 ? z.domain : (z.domain === "hse" ? "quality" : "hse"), type = pick(TYPES[domain]);
    const r = { id: "sim" + (++n), domain, type, zone: z.name, level: CRITICAL.has(type) ? "critical" : "warn", seconds: 0, camera: "CAM-0" + (1 + ZONES.indexOf(z)) };
    risks.set(r.id, r); detectedToday++;
    log({ type: "detected", domain, risk_type: type, level: r.level, zone: z.name, notify: domain, ref: r.id });
  }
  const open = [...risks.values()], crit = open.filter((r) => r.level === "critical").length;
  const zones = ZONES.map((z) => { const zr = open.filter((r) => r.zone === z.name); return { name: z.name, domain: z.domain, polygon: z.polygon, center: z.center, state: zr.length ? "risk" : "ok", level: zr.some((r) => r.level === "critical") ? "critical" : zr.length ? "warn" : "ok" }; });
  const kpi = { open: open.length, hse_open: open.filter((r) => r.domain === "hse").length, quality_open: open.filter((r) => r.domain === "quality").length, critical: crit,
    alerts: detectedToday, resolved: resolvedTotal, avg_response: resolvedTotal ? resolvedSecs / resolvedTotal : null, longest_open: open.reduce((m, r) => Math.max(m, r.seconds), 0) };
  const health = Math.max(0, Math.min(100, Math.round(100 - crit * 15 - (open.length - crit) * 5)));
  return {
    state: { meta: { mode: "demo", generated_at: new Date().toISOString() }, kpi, zones, risks: open.map((r) => ({ id: r.id, domain: r.domain, type: r.type, zone: r.zone, level: r.level, seconds: r.seconds, camera: r.camera })), resolved, events },
    summary: { mode: "demo", speed: 1, health, kpi, zones: zones.map(({ name, domain, state, level }) => ({ name, domain, state, level })) },
    events: fresh,
  };
}

async function push() {
  const body = { id, code, ...tick() };
  try {
    const r = await fetch(base.replace(/\/$/, "") + "/api?op=d_push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const open = body.state.kpi.open;
    console.log(new Date().toLocaleTimeString(), r.ok ? "pushed" : "REFUSED " + r.status + " " + (await r.text()), "· open risks:", open, "· new events:", body.events.length);
    if (r.status === 401) { console.log("Wrong site id or pairing code (administration portal -> Compte)."); process.exit(1); }
  } catch (e) { console.log("network error:", e.message); }
}
console.log("Simulating site", id, "->", base, "(Ctrl+C to stop). Types used:", Object.keys(HSE.RISKS).length, "risk types in the catalog.");
push(); setInterval(push, STEP * 1000);
