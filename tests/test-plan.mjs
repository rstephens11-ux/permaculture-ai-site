// tests/test-plan.mjs — the contract of POST /api/plan and GET /api/plan/:id, on the mock engine.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createApi } from "../api/handler.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PHOTO = readFileSync(join(HERE, "fixtures/garden-sample.jpg"));
const DATA_URL = `data:image/jpeg;base64,${PHOTO.toString("base64")}`;
const CATEGORIES = ["PLANT", "WATER", "SOIL", "BUILD", "HARVEST"];

function mkApi(logs = []) {
  return createApi({
    engineName: "mock",
    leadStorePath: join(HERE, "fixtures/.test-leads.csv"),
    log: (m) => logs.push(m)
  });
}

async function settle(api, id, ms = 4000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const r = await api.handle({ method: "GET", path: `/api/plan/${id}` });
    if (r.json.state === "done" || r.json.state === "error") return r;
    if (Date.now() > deadline) throw new Error(`job never settled: ${JSON.stringify(r.json)}`);
    await new Promise((r2) => setTimeout(r2, 25));
  }
}

test("POST /api/plan accepts a photo and returns a job, not a blocking render", async () => {
  const api = mkApi();
  const r = await api.handle({
    method: "POST", path: "/api/plan", ip: "10.0.0.1",
    json: { image_data_url: DATA_URL, email: "", zip: "04578" }
  });
  assert.equal(r.status, 202, JSON.stringify(r.json));
  assert.ok(r.json.job_id, "a job id comes back immediately");
  assert.equal(r.json.state, "queued");
});

test("the finished job carries steps, a harvest window and the concept disclaimer", async () => {
  const api = mkApi();
  const post = await api.handle({
    method: "POST", path: "/api/plan", ip: "10.0.0.2",
    json: { image_data_url: DATA_URL, zip: "04578" }
  });
  const done = await settle(api, post.json.job_id);
  assert.equal(done.status, 200, JSON.stringify(done.json).slice(0, 300));

  const j = done.json;
  assert.ok(Array.isArray(j.steps) && j.steps.length >= 3, "at least three steps");
  for (const s of j.steps) assert.ok(CATEGORIES.includes(s.category), `bad category ${s.category}`);
  assert.ok(j.harvest_window.length >= 1, "a harvest window");
  assert.ok(j.glut && j.glut.open, "the glut window is the point of the whole thing");
  assert.match(j.concept_disclaimer, /Concept sketch only/);
  assert.equal(j.engine, "mock");
  assert.ok(j.plan_image_data_url.startsWith("data:image/"), "the overlay comes back inline");
});

test("image bytes are never logged", async () => {
  const logs = [];
  const api = mkApi(logs);
  const post = await api.handle({
    method: "POST", path: "/api/plan", ip: "10.0.0.3", json: { image_data_url: DATA_URL }
  });
  await settle(api, post.json.job_id);
  const joined = logs.join("\n");
  const frag = PHOTO.toString("base64").slice(0, 40);
  assert.ok(!joined.includes(frag), "no base64 fragment of the photo in the logs");
  assert.ok(!joined.includes("data:image"), "no data url in the logs");
  assert.match(joined, /bytes/, "but the byte count is logged, which is the useful part");
});

test("the greasy inputs are refused with a sentence a person can read", async () => {
  const api = mkApi();
  const bad = await api.handle({ method: "POST", path: "/api/plan", ip: "10.0.0.4", json: {} });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, "no_image");

  const wrongType = await api.handle({
    method: "POST", path: "/api/plan", ip: "10.0.0.5",
    json: { image_data_url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" }
  });
  assert.equal(wrongType.status, 415);

  const bigJunk = "A".repeat(9 * 1024 * 1024);
  const huge = await api.handle({
    method: "POST", path: "/api/plan", ip: "10.0.0.6",
    json: { image_data_url: `data:image/jpeg;base64,${bigJunk}` }
  });
  assert.equal(huge.status, 413, "over the 6 MB cap");
});

test("one plan per person per day", async () => {
  const api = mkApi();
  const first = await api.handle({
    method: "POST", path: "/api/plan", ip: "10.0.0.7", json: { image_data_url: DATA_URL }
  });
  assert.equal(first.status, 202);
  const second = await api.handle({
    method: "POST", path: "/api/plan", ip: "10.0.0.7", json: { image_data_url: DATA_URL }
  });
  assert.equal(second.status, 429);
  assert.equal(second.json.error, "per_ip_cap");
  const other = await api.handle({
    method: "POST", path: "/api/plan", ip: "10.0.0.8", json: { image_data_url: DATA_URL }
  });
  assert.equal(other.status, 202, "a different person is unaffected");
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

test("health reports the machine's real state", async () => {
  const api = mkApi();
  const r = await api.handle({ method: "GET", path: "/api/health" });
  assert.equal(r.status, 200);
  assert.equal(r.json.engine, "mock");
  assert.equal(r.json.forge, "up");
  assert.equal(typeof r.json.queue.depth, "number");
  assert.equal(typeof r.json.plans_today, "number");
});

test("an unknown job is a clean 404, not a crash", async () => {
  const api = mkApi();
  const r = await api.handle({ method: "GET", path: "/api/plan/nope" });
  assert.equal(r.status, 404);
});
