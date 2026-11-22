"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHandler, groupOverview, buildContext, buildReport, buildRiskReport, midnightISO, monthStartISO, cleanAsset, dueOnly, dueCounts, gemini } = require("../lib/core");
const HSE = require("../public/static/hse.js");

const KPI = { open: 3, hse_open: 2, quality_open: 1, critical: 1, alerts: 4, resolved: 10, avg_response: 180, longest_open: 120 };
const summary = (name, extra = {}) => ({ id: name, name, mode: "demo", speed: 20, health: 80, kpi: KPI, zones: [{ name: "Z1", state: "ok", level: "ok" }], ...extra });
const STATE = {
  meta: { mode: "demo" }, kpi: KPI,
  zones: [{ name: "Atelier 2", domain: "hse", state: "risk", level: "critical", polygon: [[0, 0]], center: [0, 0] }],
  risks: [
    { id: "r1", domain: "hse", type: "fire", zone: "Atelier 2", level: "critical", seconds: 90, camera: "CAM-1" },
    { id: "r2", domain: "quality", type: "dirt", zone: "Conditionnement", level: "warn", seconds: 400, camera: "CAM-2" },
  ],
  resolved: [{ domain: "hse", type: "no_ppe", zone: "Quai", seconds: 240, responder: "Samir" }],
  events: [{ type: "detected", domain: "hse" }, { type: "detected", domain: "quality" }],
};

function fakeFetch(routes) {
  const calls = [];
  const f = async (url, opt = {}) => {
    calls.push({ url: String(url), opt });
    for (const [needle, reply] of routes) {
      if (String(url).includes(needle)) {
        const [status, body] = typeof reply === "function" ? reply(url, opt) : reply;
        return { ok: status < 300, status, json: async () => body, text: async () => (body == null ? "" : JSON.stringify(body)) };
      }
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
  };
  f.calls = calls;
  return f;
}
const mkRes = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } });
async function call(handler, { method = "GET", url, body, cookie } = {}) {
  const res = mkRes();
  await handler({ method, url, headers: { cookie: cookie || "", "x-forwarded-for": "1.2.3.4" }, body }, res);
  let json = null;
  try { json = JSON.parse(res.body); } catch {}
  return { status: res.statusCode, json, text: res.body, headers: res.headers };
}
const ENV = { ACCESS_CODE: "s3cret", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_KEY: "sb_secret_k", GEMINI_API_KEY: "G" };

test("group overview adds up risks by domain, weights the handling time and counts due equipment", () => {
  const a = summary("A", { kpi: { ...KPI, resolved: 10, avg_response: 100 }, online: true, due: { soon: 1, expired: 0 } });
  const b = summary("B", { kpi: { ...KPI, resolved: 30, avg_response: 200 }, online: true, due: { soon: 0, expired: 2 } });
  const g = groupOverview([a, b, { id: "C", name: "C", online: false, starting: true }], true);
  assert.equal(g.group.count, 3); assert.equal(g.group.online, 2);
  assert.equal(g.group.open, 6); assert.equal(g.group.hse_open, 4); assert.equal(g.group.quality_open, 2); assert.equal(g.group.critical, 2);
  assert.equal(g.group.avg_response, 175); assert.equal(g.group.due_soon, 1); assert.equal(g.group.due_expired, 2); assert.equal(g.ai, true);
});

test("context sent to the AI has risks, zones and due equipment but no coordinates", () => {
  const due = [{ domain: "hse", category: "extinguisher", name: "Ext. 12", location: "Dépôt", days: -3, state: "expired" }];
  const c = buildContext([["Usine Oran", STATE, due]]);
  assert.match(c, /"site":"Usine Oran"/); assert.doesNotMatch(c, /polygon|center/);
  const j = JSON.parse(c)[0];
  assert.equal(j.kpi.avg_handling_min, 3); assert.equal(j.open_risks.length, 2);
  assert.equal(j.open_risks[0].type, "fire"); assert.equal(j.equipment_due[0].status, "expired");
});

const EV = [
  { type: "detected", domain: "hse", risk_type: "fire", level: "critical", table_name: "Atelier 2", ts: "2026-11-03T09:10:00Z" },
  { type: "detected", domain: "hse", risk_type: "no_ppe", level: "warn", table_name: "Atelier 2", ts: "2026-11-03T09:40:00Z" },
  { type: "detected", domain: "quality", risk_type: "dirt", level: "warn", table_name: "Conditionnement", ts: "2026-11-04T07:00:00Z" },
  { type: "resolved", domain: "hse", risk_type: "fire", table_name: "Atelier 2", staff: "Samir", seconds: 120, ts: "2026-11-03T09:12:00Z" },
  { type: "resolved", domain: "quality", risk_type: "dirt", table_name: "Conditionnement", staff: "Lina", seconds: 600, ts: "2026-11-04T07:10:00Z" },
  { type: "escalated", domain: "quality", risk_type: "dirt", table_name: "Conditionnement", ts: "2026-11-04T07:05:00Z" },
  { type: "ack", domain: "hse", ref: "r1", ts: "2026-11-03T09:11:00Z" },
];

test("daily and monthly reports", () => {
  const due = [{ name: "Ext. 12", location: "Dépôt", expires_on: "2026-11-01", state: "expired", days: -2 }, { name: "Sonde S1", expires_on: "2026-11-20", state: "soon", days: 17 }];
  const r = buildReport(EV, STATE, "en", { period: "month", due, tz: "Africa/Algiers" });
  assert.match(r, /Monthly HSE & Quality report/); assert.match(r, /Risks detected: 3/); assert.match(r, /of which HSE: 2/); assert.match(r, /of which Quality: 1/);
  assert.match(r, /of which critical: 1/); assert.match(r, /Risks resolved: 2/); assert.match(r, /Average handling time: 6\.0 min/); assert.match(r, /Longest handling time: 10\.0 min \(Conditionnement\)/);
  assert.match(r, /Escalations to administration: 1/); assert.match(r, /Most exposed zone: Atelier 2 \(2\)/); assert.match(r, /Busiest day: 2026-11-03 \(2\)/);
  assert.match(r, /1 expired · 1 due soon/); assert.match(r, /Ext\. 12 — Dépôt/);
  const d = buildReport([], null, "fr");
  assert.match(d, /Rapport HSE & Qualité du jour/); assert.match(d, /Risques détectés: 0/); assert.match(d, /Temps moyen de traitement: aucune donnée/);
});

test("risk analytics: domains, critical, hours, zones, who resolved", () => {
  const r = buildRiskReport(EV, ["Atelier 2", "Conditionnement", "Quai"], "Africa/Algiers");
  assert.deepEqual([r.kpi.detected, r.kpi.hse, r.kpi.quality, r.kpi.critical, r.kpi.resolved, r.kpi.escalated], [3, 2, 1, 1, 2, 1]);
  assert.equal(r.kpi.avg_resolution, 360); assert.deepEqual(r.quiet, ["Quai"]); assert.equal(r.zones[0].name, "Atelier 2");
  assert.equal(r.days.length, 2); assert.equal(r.peak_hour, 10);   // 09:10 UTC = 10:10 in Algiers
  assert.equal(r.types[0].count, 1); assert.equal(r.responders[0].resolved, 1);
});

test("midnight and month start are computed in the site timezone", () => {
  const now = new Date("2026-11-03T12:30:15.250Z");           // 13:30:15 in Algiers (UTC+1)
  assert.equal(midnightISO("Africa/Algiers", now), "2026-11-02T23:00:00.000Z");
  assert.equal(monthStartISO("Africa/Algiers", now), "2026-10-31T23:00:00.000Z");
  assert.equal(monthStartISO("Africa/Algiers", new Date("2026-11-01T00:30:00.000Z")), "2026-10-31T23:00:00.000Z");
});

test("register: validation and expiry status (expired / soon / ok) in the site timezone", () => {
  assert.equal(cleanAsset({ domain: "hse", name: "x", expires_on: "2026-12-01" }), null);                       // name too short
  assert.equal(cleanAsset({ domain: "food", name: "Ext 1", expires_on: "2026-12-01" }), null);                   // unknown domain
  assert.equal(cleanAsset({ domain: "hse", name: "Ext 1", expires_on: "2026-13-45" }), null);                    // not a date
  const a = cleanAsset({ domain: "hse", category: "Extinguisher<>", name: "  Ext   12 ", expires_on: "2026-12-01", remind_days: "45", last_check: "bad", location: "Dépôt" });
  assert.equal(a.name, "Ext 12"); assert.equal(a.category, "xtinguisher"); assert.equal(a.remind_days, 45); assert.equal(a.last_check, null);
  assert.equal(cleanAsset({ domain: "quality", name: "Lot A", expires_on: "2026-12-01", remind_days: 9999 }).remind_days, 30);
  const rows = [
    { name: "past", domain: "hse", expires_on: "2026-11-01", remind_days: 30 }, { name: "edge", domain: "quality", expires_on: "2026-12-03", remind_days: 30 },
    { name: "later", domain: "hse", expires_on: "2027-03-01", remind_days: 30 }, { name: "today", domain: "hse", expires_on: "2026-11-03", remind_days: 0 },
  ];
  const due = dueOnly(rows, "2026-11-03");
  assert.deepEqual(due.map((x) => [x.name, x.state, x.days]), [["past", "expired", -2], ["today", "soon", 0], ["edge", "soon", 30]]);
  assert.deepEqual(dueCounts(rows, "2026-11-03"), { soon: 2, expired: 1, hse: 2, quality: 1 });
  assert.equal(HSE.ymd(new Date("2026-11-03T23:30:00Z"), "Africa/Algiers"), "2026-11-04");
});

test("catalog: every risk and register type has a domain and labels in 3 languages", () => {
  for (const [k, v] of Object.entries(HSE.RISKS)) { assert.ok(HSE.DOMAINS.includes(v[0]), k); assert.ok(v[1] && v[2] && v[3], k); }
  for (const [k, v] of Object.entries(HSE.ASSETS)) { assert.ok(HSE.DOMAINS.includes(v[0]), k); assert.ok(v[1] && v[2] && v[3] && v[4] > 0, k); }
  assert.equal(HSE.riskDomain("dirt"), "quality"); assert.equal(HSE.riskDomain("fire"), "hse");
  assert.equal(HSE.assetLabel("extinguisher", "fr"), "Extincteur"); assert.equal(HSE.riskLabel("unknown", "en"), "unknown");
});

test("fails closed without ACCESS_CODE and never touches the database", async () => {
  const f = fakeFetch([]);
  const h = createHandler({ env: { ...ENV, ACCESS_CODE: "" }, fetch: f });
  assert.deepEqual((await call(h, { url: "/api?op=auth" })).json, { required: true, ok: false, configured: false });
  assert.equal((await call(h, { url: "/api?op=overview" })).status, 503);
  assert.equal(f.calls.length, 0);
});

test("login, cookie, rate limit and protected ops", async () => {
  const h = createHandler({ env: ENV, fetch: fakeFetch([]) });
  assert.equal((await call(h, { url: "/api?op=overview" })).status, 401);
  const bad = await call(h, { method: "POST", url: "/api?op=login", body: { code: "nope" } });
  assert.equal(bad.status, 401);
  const ok = await call(h, { method: "POST", url: "/api?op=login", body: { code: "s3cret" } });
  assert.equal(ok.status, 200);
  const cookie = ok.headers["Set-Cookie"].split(";")[0];
  assert.match(ok.headers["Set-Cookie"], /HttpOnly/);
  assert.deepEqual((await call(h, { url: "/api?op=auth", cookie })).json, { required: true, ok: true, configured: true });
  assert.equal((await call(h, { url: "/api?op=auth", cookie: "nsess=forged" })).json.ok, false);
  for (let i = 0; i < 4; i++) await call(h, { method: "POST", url: "/api?op=login", body: { code: "x" } });
  assert.equal((await call(h, { method: "POST", url: "/api?op=login", body: { code: "x" } })).status, 429);
});

async function loggedIn(routes, env = ENV) {
  const f = fakeFetch(routes);
  const h = createHandler({ env, fetch: f });
  const r = await call(h, { method: "POST", url: "/api?op=login", body: { code: "s3cret" } });
  return { h, f, cookie: r.headers["Set-Cookie"].split(";")[0] };
}

test("overview reads small summaries, marks old rows offline, uses apikey only for sb_secret keys", async () => {
  const fresh = new Date().toISOString(), old = new Date(Date.now() - 120000).toISOString();
  const { h, f, cookie } = await loggedIn([
    ["nj_restaurants", [200, [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }]]],
    ["nj_state", [200, [{ restaurant_id: "a", updated_at: fresh, summary: summary("zzz") }, { restaurant_id: "b", updated_at: old, summary: summary("b") }]]],
  ]);
  const r = await call(h, { url: "/api?op=overview", cookie });
  assert.equal(r.status, 200);
  const [a, b, c] = r.json.restaurants;
  assert.equal(a.name, "A"); assert.equal(a.online, true);       // name comes from nj_restaurants
  assert.equal(b.online, false); assert.equal(c.starting, true);
  assert.equal(r.json.ai, true);
  const sbCall = f.calls.find((c) => c.url.includes("nj_state"));
  assert.ok(sbCall.url.includes("summary") && !sbCall.url.includes("select=*"));
  assert.equal(sbCall.opt.headers.apikey, "sb_secret_k"); assert.equal(sbCall.opt.headers.Authorization, undefined);
});

test("state: validates id, returns waiting when nothing pushed yet", async () => {
  const { h, cookie } = await loggedIn([["nj_state", (u) => [200, u.includes("restaurant_id=eq.a") ? [{ state: STATE }] : []]]]);
  assert.equal((await call(h, { url: "/api?op=state&id=a", cookie })).json.kpi.open, 3);
  assert.deepEqual((await call(h, { url: "/api?op=state&id=b", cookie })).json, { waiting: true });
  assert.equal((await call(h, { url: "/api?op=state&id=" + encodeURIComponent("a&select=*"), cookie })).status, 404);
});

test("database errors become a clean 502, not a crash", async () => {
  const { h, cookie } = await loggedIn([["nj_", [500, {}]]]);
  assert.equal((await call(h, { url: "/api?op=overview", cookie })).status, 502);
});

test("ask: sends restaurant data + question to Gemini, key in header only; falls back across models", async () => {
  const seen = [];
  const { h, cookie } = await loggedIn([
    ["nj_state", [200, [{ restaurant_id: "a", state: STATE }]]],
    ["nj_restaurants", [200, [{ id: "a", name: "Oran Centre" }]]],
    ["gemini-2.5-flash:", [404, {}]],
    ["gemini-2.5-flash-lite:", (u, o) => { seen.push([u, o]); return [200, { candidates: [{ content: { parts: [{ text: "Table T1 attend le plus." }] } }] }]; }],
  ]);
  const r = await call(h, { method: "POST", url: "/api?op=ask", cookie, body: { question: "Quelle table attend ?", restaurant: "a", lang: "fr" } });
  assert.equal(r.status, 200); assert.equal(r.json.answer, "Table T1 attend le plus.");
  const [url, opt] = seen[0];
  assert.ok(!url.includes("key=") && !url.includes("G"));
  assert.equal(opt.headers["x-goog-api-key"], "G");
  const sent = JSON.parse(opt.body).contents[0].parts[0].text;
  assert.match(sent, /Oran Centre/); assert.match(sent, /French/); assert.match(sent, /Quelle table attend/);
});

test("ask: errors are mapped (no key, quota, empty question)", async () => {
  const noKey = await loggedIn([["nj_state", [200, [{ restaurant_id: "a", state: STATE }]]], ["nj_restaurants", [200, []]]], { ...ENV, GEMINI_API_KEY: "" });
  assert.deepEqual((await call(noKey.h, { method: "POST", url: "/api?op=insights", cookie: noKey.cookie, body: { restaurant: "all" } })).json, { error: "no_key" });
  const quota = await loggedIn([["nj_state", [200, [{ restaurant_id: "a", state: STATE }]]], ["nj_restaurants", [200, []]], ["generativelanguage", [429, {}]]]);
  const q = await call(quota.h, { method: "POST", url: "/api?op=ask", cookie: quota.cookie, body: { question: "x", restaurant: "all" } });
  assert.equal(q.status, 429); assert.equal(q.json.error, "quota");
  assert.equal((await call(quota.h, { method: "POST", url: "/api?op=ask", cookie: quota.cookie, body: { question: "  " } })).status, 400);
});

test("report is plain text built from today's (or this month's) events, with the register's deadlines", async () => {
  const { h, f, cookie } = await loggedIn([
    ["nj_events", [200, [{ type: "detected", domain: "hse", risk_type: "fire", level: "critical", table_name: "A2", ts: "2026-11-03T09:00:00Z" }]]],
    ["nj_state", [200, [{ state: STATE }]]],
    ["nj_assets", [200, [{ name: "Ext. 1", location: "Dépôt", domain: "hse", expires_on: "2000-01-01", remind_days: 30 }]]],
  ]);
  const r = await call(h, { url: "/api?op=report&id=a&lang=en", cookie });
  assert.equal(r.status, 200); assert.match(r.text, /Daily HSE & Quality report/); assert.match(r.text, /Risks detected: 1/); assert.match(r.text, /1 expired/);
  assert.match(r.headers["Content-Type"], /text\/plain/);
  assert.ok(f.calls.some((c) => c.url.includes("nj_events") && c.url.includes("ts=gte.")));
  const m = await call(h, { url: "/api?op=report&id=a&lang=fr&period=month", cookie });
  assert.match(m.text, /Rapport HSE & Qualité du mois/);
});

test("gemini(): bad key reports no_key", async () => {
  const f = fakeFetch([["generativelanguage", [400, { error: { message: "API key not valid" } }]]]);
  await assert.rejects(gemini(f, "bad", ["m"], "p"), (e) => e.code === "no_key");
});

/* ---------- pairing: the Windows app writes through the server, never with the Supabase key ---------- */
const crypto = require("node:crypto");
const PENV = { ...ENV, SESSION_SECRET: "sess-secret" };
const mCookie = (rid) => {
  const b = Buffer.from(JSON.stringify({ aid: 7, rid, exp: Date.now() + 1e6 })).toString("base64url");
  return "msess=" + b + "." + crypto.createHmac("sha256", "sess-secret").update(b).digest("base64url");
};
function pairHandler() {
  const f = fakeFetch([
    ["nj_restaurants", () => [200, [{ id: "cafe-1a2b", name: "Café", pair_ver: 1 }]]],
    ["nj_state", [201, null]], ["nj_events", [201, null]],
  ]);
  return { f, h: createHandler({ env: PENV, fetch: f }) };
}

test("pairing: manager sees a code; the app can push with it and only for that restaurant", async () => {
  const { f, h } = pairHandler();
  const code = (await call(h, { url: "/api?op=m_pair", cookie: mCookie("cafe-1a2b") })).json.code;
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const reg = await call(h, { method: "POST", url: "/api?op=d_register", body: { id: "cafe-1a2b", code: code.toLowerCase().replace(/-/g, " ") } });
  assert.equal(reg.status, 200); assert.equal(reg.json.name, "Café");
  const push = await call(h, { method: "POST", url: "/api?op=d_push", body: { id: "cafe-1a2b", code, state: STATE, summary: { x: 1 },
    events: [{ type: "detected", domain: "hse", risk_type: "fire", level: "critical", zone: "A2", ref: "r1", restaurant_id: "someone-else" }, { type: "served" }, { nope: 1 }] } });
  assert.equal(push.status, 200);
  const st = f.calls.find((c) => c.url.includes("nj_state?on_conflict=restaurant_id"));
  assert.equal(JSON.parse(st.opt.body)[0].restaurant_id, "cafe-1a2b");
  const ev = JSON.parse(f.calls.find((c) => c.url.endsWith("/nj_events")).opt.body);
  assert.equal(ev.length, 1); assert.equal(ev[0].restaurant_id, "cafe-1a2b");   // spoofed restaurant_id is ignored, unknown event types dropped
  assert.deepEqual([ev[0].type, ev[0].domain, ev[0].level, ev[0].table_name, ev[0].ref], ["detected", "hse", "critical", "A2", "r1"]);
});

test("pairing: wrong or missing code is refused, nothing is written, and guessing is rate limited", async () => {
  const { f, h } = pairHandler();
  for (const body of [{ id: "cafe-1a2b", code: "AAAA-AAAA-AAAA", state: STATE }, { id: "cafe-1a2b", state: STATE }, { id: "../x", code: "x" }]) {
    const r = await call(h, { method: "POST", url: "/api?op=d_push", body });
    assert.equal(r.status, 401);
  }
  assert.equal(f.calls.some((c) => /nj_state|nj_events/.test(c.url) && c.opt.method === "POST"), false);
  assert.equal((await call(h, { url: "/api?op=d_push" })).status, 405);
  let last; for (let i = 0; i < 12; i++) last = await call(h, { method: "POST", url: "/api?op=d_register", body: { id: "cafe-1a2b", code: "BAD" + i } });
  assert.equal(last.status, 429);
});

test("pairing: a manager cannot read another restaurant's code, and renewing invalidates the old one", async () => {
  let ver = 1;
  const f = fakeFetch([["nj_restaurants", (u, o) => (o.method === "PATCH" ? (ver = JSON.parse(o.body).pair_ver, [204, null]) : [200, [{ id: "cafe-1a2b", name: "Café", pair_ver: ver }]])]]);
  const h = createHandler({ env: PENV, fetch: f });
  assert.equal((await call(h, { url: "/api?op=m_pair" })).status, 401);
  const old = (await call(h, { url: "/api?op=m_pair", cookie: mCookie("cafe-1a2b") })).json.code;
  const fresh = (await call(h, { method: "POST", url: "/api?op=m_pair_reset", cookie: mCookie("cafe-1a2b") })).json.code;
  assert.notEqual(old, fresh);
  assert.equal((await call(h, { method: "POST", url: "/api?op=d_register", body: { id: "cafe-1a2b", code: old } })).status, 401);
  assert.equal((await call(h, { method: "POST", url: "/api?op=d_register", body: { id: "cafe-1a2b", code: fresh } })).status, 200);
});

/* ---------- the two managers (HSE, quality), acknowledgements and the manual register ---------- */
const sCookie = (name, payload) => {
  const b = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 1e6 })).toString("base64url");
  return name + "=" + b + "." + crypto.createHmac("sha256", "sess-secret").update(b).digest("base64url");
};
const eCookie = (eid = "11111111-1111-1111-1111-111111111111") => sCookie("esess", { eid, rid: "usine-1" });
const FRESH = () => new Date().toISOString();

test("manager page: each manager only receives the risks of his own domain, plus his own deadlines", async () => {
  const f = fakeFetch([
    ["nj_employees", [200, [{ name: "Lina", role: "quality", active: true }]]], ["nj_restaurants", [200, [{ name: "Usine Oran" }]]],
    ["nj_state", [200, [{ state: JSON.parse(JSON.stringify(STATE)), updated_at: FRESH() }]]],
    ["type=eq.ack", [200, [{ ref: "r2" }]]],
    ["nj_assets", [200, [{ name: "Sonde S1", domain: "quality", expires_on: "2000-01-01", remind_days: 30 }]]],
  ]);
  const h = createHandler({ env: PENV, fetch: f });
  const r = await call(h, { url: "/api?op=e_state", cookie: eCookie() });
  assert.equal(r.status, 200); assert.equal(r.json.role, "quality"); assert.equal(r.json.online, true);
  assert.deepEqual(r.json.risks.map((x) => [x.id, x.type, x.ack]), [["r2", "dirt", true]]);       // the fire (hse) is not sent to the quality manager
  assert.equal(r.json.due[0].state, "expired");
  assert.ok(f.calls.some((c) => c.url.includes("nj_assets") && c.url.includes("domain=eq.quality")));
  assert.equal((await call(h, { url: "/api?op=e_state" })).status, 401);
});

test("manager page: an old restaurant role (waiter) is refused; a deactivated manager is signed out", async () => {
  const old = createHandler({ env: PENV, fetch: fakeFetch([["nj_employees", [200, [{ name: "X", role: "waiter", active: true }]]]]) });
  assert.equal((await call(old, { url: "/api?op=e_state", cookie: eCookie() })).status, 403);
  const off = createHandler({ env: PENV, fetch: fakeFetch([["nj_employees", [200, [{ name: "X", role: "hse", active: false }]]]]) });
  assert.equal((await call(off, { url: "/api?op=e_state", cookie: eCookie() })).status, 401);
});

test("acknowledge: the domain comes from the database, not from the request", async () => {
  const f = fakeFetch([["nj_employees", [200, [{ name: "Samir", role: "hse", active: true }]]], ["nj_events", [201, null]]]);
  const h = createHandler({ env: PENV, fetch: f });
  assert.equal((await call(h, { method: "POST", url: "/api?op=e_ack", body: { id: "r1" } })).status, 401);
  assert.equal((await call(h, { method: "POST", url: "/api?op=e_ack", cookie: eCookie(), body: {} })).status, 400);
  const r = await call(h, { method: "POST", url: "/api?op=e_ack", cookie: eCookie(), body: { id: "r1", zone: "Atelier 2", type: "fire", domain: "quality", restaurant_id: "other" } });
  assert.equal(r.status, 200);
  const ev = JSON.parse(f.calls.find((c) => c.url.endsWith("/nj_events")).opt.body)[0];
  assert.deepEqual([ev.restaurant_id, ev.type, ev.domain, ev.ref, ev.staff], ["usine-1", "ack", "hse", "r1", "Samir"]);
});

test("administration: only two managers per site, one HSE and one quality", async () => {
  let existing = [];
  const f = fakeFetch([["nj_employees", (u, o) => (o.method === "POST" ? [201, [{ id: "x", emp_code: "USI-1234", name: "N", role: "hse", active: true }]] : [200, existing])]]);
  const h = createHandler({ env: PENV, fetch: f }), cookie = mCookie("usine-1");
  const add = (body) => call(h, { method: "POST", url: "/api?op=m_staff_add", cookie, body });
  assert.equal((await add({ name: "Nadia", role: "waiter" })).status, 400);          // restaurant roles are gone
  assert.equal((await add({ name: "N", role: "hse" })).status, 400);                 // name too short
  const ok = await add({ name: "Nadia", role: "hse" });
  assert.equal(ok.status, 200); assert.match(ok.json.pin, /^\d{6}$/);
  existing = [{ id: "x" }];
  assert.equal((await add({ name: "Karim", role: "hse" })).status, 409);              // that domain already has its manager
  const ed = await call(h, { method: "POST", url: "/api?op=m_staff_edit", cookie, body: { id: "22222222-2222-2222-2222-222222222222", role: "quality" } });
  assert.equal(ed.status, 409);
});

test("register (administration): validated, scoped to its own site, and a missing table gives a clear hint", async () => {
  const f = fakeFetch([["nj_assets", (u, o) => (o.method === "POST" ? [404, {}] : o.method === "PATCH" ? [204, null] : [200, [{ id: "a1", name: "Ext. 1", domain: "hse", expires_on: "2099-01-01", remind_days: 30 }]])]]);
  const h = createHandler({ env: PENV, fetch: f }), cookie = mCookie("usine-1");
  assert.equal((await call(h, { url: "/api?op=m_assets" })).status, 401);
  const list = await call(h, { url: "/api?op=m_assets", cookie });
  assert.equal(list.json[0].state, "ok"); assert.ok(f.calls[0].url.includes("restaurant_id=eq.usine-1"));
  assert.equal((await call(h, { method: "POST", url: "/api?op=m_asset_save", cookie, body: { domain: "hse", name: "", expires_on: "2026-01-01" } })).status, 400);
  const miss = await call(h, { method: "POST", url: "/api?op=m_asset_save", cookie, body: { domain: "hse", name: "Ext. 2", expires_on: "2026-12-01" } });
  assert.deepEqual([miss.status, miss.json.error], [503, "migration"]);
  const id = "33333333-3333-3333-3333-333333333333";
  const ed = await call(h, { method: "POST", url: "/api?op=m_asset_save", cookie, body: { id, domain: "hse", name: "Ext. 2", expires_on: "2026-12-01", restaurant_id: "other-site" } });
  assert.equal(ed.status, 200);
  const patch = f.calls.find((c) => c.opt.method === "PATCH");
  assert.ok(patch.url.includes("restaurant_id=eq.usine-1") && patch.url.includes(id)); assert.equal(JSON.parse(patch.opt.body).restaurant_id, undefined);
  assert.equal((await call(h, { method: "POST", url: "/api?op=m_asset_del", cookie, body: { id: "x' or 1=1" } })).status, 404);
});

test("register (platform admin): needs the access code, a known site, and the engine can read what is due", async () => {
  const { h, f, cookie } = await loggedIn([
    ["nj_restaurants", (u) => [200, u.includes("id=eq.nope") ? [] : [{ id: "usine-1", name: "Usine Oran", pair_ver: 1 }]]],
    ["nj_assets", (u, o) => (o.method === "POST" ? [201, null] : [200, [{ id: "a1", restaurant_id: "usine-1", name: "Ext. 1", domain: "hse", expires_on: "2000-01-01", remind_days: 30 }]])],
  ]);
  const list = await call(h, { url: "/api?op=assets", cookie });
  assert.equal(list.json[0].site_name, "Usine Oran"); assert.equal(list.json[0].state, "expired");
  assert.equal((await call(h, { method: "POST", url: "/api?op=asset_save", cookie, body: { site: "nope", domain: "hse", name: "Ext. 3", expires_on: "2026-12-01" } })).status, 400);
  assert.equal((await call(h, { method: "POST", url: "/api?op=asset_save", cookie, body: { site: "usine-1", domain: "quality", name: "Lot 7", expires_on: "2026-12-01" } })).status, 200);
  assert.equal((await call(h, { url: "/api?op=assets" })).status, 401);
  const dev = pairHandler();
  const code = (await call(dev.h, { url: "/api?op=m_pair", cookie: mCookie("cafe-1a2b") })).json.code;
  const due = await call(dev.h, { method: "POST", url: "/api?op=d_due", body: { id: "cafe-1a2b", code } });
  assert.equal(due.status, 200); assert.deepEqual(due.json.due, []);
});

test("d_push answers with the acknowledgements so the engine knows who took a risk in charge", async () => {
  const f = fakeFetch([
    ["nj_restaurants", () => [200, [{ id: "cafe-1a2b", name: "Café", pair_ver: 1 }]]],
    ["type=eq.ack", [200, [{ ref: "r1", staff: "Samir" }, { ref: null, staff: "x" }]]],
    ["nj_state", [201, null]], ["nj_events", [201, null]],
  ]);
  const h = createHandler({ env: PENV, fetch: f });
  const code = (await call(h, { url: "/api?op=m_pair", cookie: mCookie("cafe-1a2b") })).json.code;
  const push = (state) => call(h, { method: "POST", url: "/api?op=d_push", body: { id: "cafe-1a2b", code, state, summary: {} } });
  const withRisk = await push({ risks: [{ id: "r1", domain: "hse", type: "fire", zone: "A", level: "critical", seconds: 5 }] });
  assert.deepEqual(withRisk.json, { ok: true, acks: [{ ref: "r1", by: "Samir" }] });
  assert.ok(f.calls.some((c) => c.url.includes("type=eq.ack") && c.url.includes("restaurant_id=eq.cafe-1a2b")));
  const n = f.calls.length;
  assert.deepEqual((await push({ risks: [] })).json, { ok: true, acks: [] });        // nothing open: no extra query
  assert.equal(f.calls.slice(n).filter((c) => c.url.includes("type=eq.ack")).length, 0);
});
