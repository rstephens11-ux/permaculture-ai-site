// tests/test-plan.mjs — the contract of POST /api/plan, the gate, and GET /api/plan/:id, on the mock engine.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createApi } from "../api/handler.mjs";
import { makeLimiter } from "../api/ratelimit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PHOTO = readFileSync(join(HERE, "fixtures/garden-sample.jpg"));
const DATA_URL = `data:image/jpeg;base64,${PHOTO.toString("base64")}`;
const PHASE_KEYS = ["beds", "soil", "layout", "planting", "pests", "water", "extension", "harvest"];

// Deterministic location data. The real tables are 40,000 ZIPs and 4,000 stations; these tests need two
// stations and three ZIPs, and they must not depend on the data-fetch tools having been run in this
// checkout. Set before any test body runs, and api/frost/lookup.mjs reads it lazily.
process.env.PA_FROST_DIR = join(HERE, "fixtures/frost");

/** A fresh API with its own gate file, a permissive IP limiter, and the mock engine. */
function mkApi(logs = []) {
  return createApi({
    engineName: "mock",
    leadStorePath: join(HERE, "fixtures/.test-leads.csv"),
    gateStorePath: join(tmpdir(), `pa-plan-gate-${Math.random().toString(36).slice(2)}.json`),
    limiter: makeLimiter({ perIpPerDay: 50, globalDailyCap: 100, maxUploadMb: 6 }),
    log: (m) => logs.push(m)
  });
}

const tokenFrom = (res) => {
  const m = /pa_id=([^;]+)/.exec(res.setCookie || "");
  if (!m) throw new Error("no token cookie was set");
  return m[1];
};

async function settle(api, id, ms = 4000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const r = await api.handle({ method: "GET", path: `/api/plan/${id}` });
    if (r.json.state === "done" || r.json.state === "error") return r;
    if (Date.now() > deadline) throw new Error(`job never settled: ${JSON.stringify(r.json)}`);
    await new Promise((r2) => setTimeout(r2, 25));
  }
}

const render = (api, token, extra = {}) => api.handle({
  method: "POST", path: "/api/plan", ip: "10.0.0.1",
  cookies: token ? { pa_id: token } : {},
  json: { image_data_url: DATA_URL, zip: "04578", ...extra }
});

test("the zip code is required, with a sentence that explains why", async () => {
  const api = mkApi();
  const r = await render(api, null, { zip: "" });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, "zip_required");
  assert.match(r.json.message, /frost dates/i);
});

test("the first render is free, and mints the visitor a token", async () => {
  const api = mkApi();
  const r = await render(api, null);
  assert.equal(r.status, 202, JSON.stringify(r.json).slice(0, 200));
  assert.ok(r.json.job_id);
  const token = tokenFrom(r);
  assert.ok(token.length > 8, "a real token");
  assert.equal(r.json.status.free_left, 0, "and the free one is now spent");
});

test("the second render asks for an email instead of refusing flatly", async () => {
  const api = mkApi();
  const token = tokenFrom(await render(api, null));
  const second = await render(api, token);
  assert.equal(second.status, 403);
  assert.equal(second.json.error, "email_required");
  assert.match(second.json.message, /five a week/i);
  assert.equal(second.json.status.needs_email, true);
});

test("an email buys five renders, and the sixth says come back next week", async () => {
  const api = mkApi();
  const token = tokenFrom(await render(api, null));
  const unlock = await api.handle({
    method: "POST", path: "/api/email", ip: "10.0.0.1",
    cookies: { pa_id: token }, json: { email: "Gardener@Example.com" }
  });
  assert.equal(unlock.status, 200);
  assert.equal(unlock.json.status.week_left, 5);

  let last;
  for (let i = 0; i < 5; i++) {
    last = await render(api, token);
    assert.equal(last.status, 202, `weekly render ${i + 1}`);
  }
  assert.equal(last.json.status.week_left, 0);

  const over = await render(api, token);
  assert.equal(over.status, 403);
  assert.equal(over.json.error, "week_used");
});

test("the finished job carries the phased season plan, the counts, the local frost and the disclaimer", async () => {
  const api = mkApi();
  const post = await render(api, null, { sun: "part", existing: "no", beds: { geometry: "coleman_30", count: 2 } });
  const done = await settle(api, post.json.job_id);
  assert.equal(done.status, 200, JSON.stringify(done.json).slice(0, 200));
  const j = done.json;

  // The plan is now phases, in order, and phase 1 is the bed-building step that was missing.
  assert.deepEqual((j.phases || []).map((p) => p.key), PHASE_KEYS);
  for (const p of j.phases) {
    assert.ok(p.title && p.when && p.why, `phase ${p.key} has a heading, a date and a reason`);
    assert.ok(p.steps.length >= 1, `phase ${p.key} has something in it`);
  }
  assert.match(j.phases[0].title, /build the beds/i);

  assert.ok(j.bed_plan.length >= 3, "a bed plan with counts");
  assert.ok(j.bed_plan.every((b) => b.print && b.unit), "every bed line has a printable quantity");
  assert.ok(j.bed_plan.every((b) => /\d/.test(b.print)), "with a number in it");
  assert.ok(j.bed_plan.every((b) => b.family), "and carries its botanical family for rotation");
  assert.equal(j.beds.count, 2, "and it remembers two beds were asked for");
  assert.equal(j.geometry, "coleman_30");
  assert.equal(j.sun, "part");
  assert.ok(j.harvest_window.length >= 1, "a harvest window");
  assert.ok(j.glut && j.glut.open, "the glut window is the point of the whole thing");
  assert.match(j.concept_disclaimer, /Concept sketch only/);
  assert.equal(j.engine, "mock");
  assert.ok(j.plan_image_data_url.startsWith("data:image/"), "the drawing comes back inline");
  assert.ok(Array.isArray(j.notes), "and the honest notes ride along");
});

test("with no beds yet, the plan tells you how to build them — sticks and all", async () => {
  const api = mkApi();
  const post = await render(api, null, { existing: "no", zip: "04578" });
  const done = await settle(api, post.json.job_id);
  const build = done.json.phases[0];
  const text = JSON.stringify(build);
  assert.match(text, /cardboard/i, "sheet mulch is offered");
  assert.match(text, /bottom third/i, "and the hugelkultur layering, with the wood at the bottom");
  assert.match(text, /branch|log|stick/i, "specifically the sticks and branches");
  assert.match(text, /broadfork|tiller/i, "and the one honest case for breaking hard ground");
  assert.match(text, /compost/i, "and what goes on top");
});

test("pest advice is graded, and the marigold claim is the honest one", async () => {
  const api = mkApi();
  const post = await render(api, null, { beds: { geometry: "coleman_30", count: 1 } });
  const done = await settle(api, post.json.job_id);
  const pests = done.json.phases.find((p) => p.key === "pests");
  const text = JSON.stringify(pests);
  assert.match(text, /trap crop/i, "trap cropping is in there");
  assert.match(text, /Blue Hubbard/i);
  assert.match(text, /60–80%|trial data/i, "with the evidence behind it");
  assert.match(text, /not as a plant set beside the tomatoes/i, "and the marigold correction, not the folklore");
  assert.ok(pests.steps.some((s) => s.tag === "proven"), "claims carry a grade");
});

test("up to three photos are accepted", async () => {
  const api = mkApi();
  const many = await render(api, null, { images: [DATA_URL, DATA_URL, DATA_URL, DATA_URL] });
  assert.equal(many.status, 202, "three is fine, the fourth is ignored");
  const job = await settle(api, many.json.job_id);
  assert.equal(job.status, 200);
});

test("image bytes are never logged", async () => {
  const logs = [];
  const api = mkApi(logs);
  const post = await render(api, null);
  await settle(api, post.json.job_id);
  const joined = logs.join("\n");
  assert.ok(!joined.includes(PHOTO.toString("base64").slice(0, 40)), "no base64 fragment of the photo");
  assert.ok(!joined.includes("data:image"), "no data url in the logs");
  assert.match(joined, /bytes/, "but the byte count is logged, which is the useful part");
});

test("the greasy inputs are refused with a sentence a person can read", async () => {
  const api = mkApi();
  const noImage = await render(api, null, { image_data_url: "", images: [] });
  assert.equal(noImage.status, 400);
  assert.equal(noImage.json.error, "no_image");

  const wrongType = await render(api, null, { image_data_url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" });
  assert.equal(wrongType.status, 415);

  const bigJunk = "A".repeat(9 * 1024 * 1024);
  const huge = await render(api, null, { image_data_url: `data:image/jpeg;base64,${bigJunk}` });
  assert.equal(huge.status, 413, "over the 6 MB cap");
});

test("a submitted email lands in the lead store, and a bad one is refused", async () => {
  const api = mkApi();
  const ok = await api.handle({
    method: "POST", path: "/api/lead",
    json: { email: "  Gardener@Example.com ", source: "product" }
  });
  assert.equal(ok.status, 200);
  assert.equal(api.leads.has("gardener@example.com"), true);

  const dup = await api.handle({ method: "POST", path: "/api/lead", json: { email: "gardener@example.com" } });
  assert.equal(dup.json.duplicate, true, "the same address twice is not two leads");

  const bad = await api.handle({ method: "POST", path: "/api/lead", json: { email: "not-an-email" } });
  assert.equal(bad.status, 400);
});

test("the funnel counter counts, with nothing about the person attached", async () => {
  const api = mkApi();
  await api.handle({ method: "POST", path: "/api/track", json: { event: "product_view" } });
  await api.handle({ method: "POST", path: "/api/track", json: { event: "product_view" } });
  await api.handle({ method: "POST", path: "/api/track", json: { event: "something_else" } });
  assert.equal(api.counters.product_views, 2);
});

test("health reports the machine's real state and the gate's numbers", async () => {
  const api = mkApi();
  const r = await api.handle({ method: "GET", path: "/api/health" });
  assert.equal(r.status, 200);
  assert.equal(r.json.engine, "mock");
  assert.equal(r.json.forge, "up");
  assert.equal(typeof r.json.queue.depth, "number");
  assert.equal(typeof r.json.plans_today, "number");
  assert.equal(r.json.gate.free_renders, 1);
  assert.equal(r.json.gate.renders_after_email, 5);
  assert.ok("product_views" in r.json.counters);
});

test("an unknown job is a clean 404, not a crash", async () => {
  const api = mkApi();
  const r = await api.handle({ method: "GET", path: "/api/plan/nope" });
  assert.equal(r.status, 404);
});
