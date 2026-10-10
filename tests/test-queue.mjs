// tests/test-queue.mjs — one GPU, and the states that make waiting honest.
import test from "node:test";
import assert from "node:assert/strict";
import { makeQueue } from "../api/queue.mjs";

const slowEngine = (ms, { available = true, busy = false } = {}) => ({
  name: "slow",
  calls: 0,
  async available() { return available; },
  async busy() { return busy; },
  async plan({ imageB64, spec }) {
    this.calls++;
    await new Promise((r) => setTimeout(r, ms));
    return { imageB64, mime: "image/jpeg", engine: "slow", spec };
  }
});

async function until(fn, ms = 3000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error("condition never became true");
    await new Promise((r) => setTimeout(r, 15));
  }
}

test("jobs run one at a time and in order", async () => {
  const engine = slowEngine(40);
  const q = makeQueue({ engine });
  const a = q.enqueue({ imageB64: "a", spec: { tag: "a" } });
  const b = q.enqueue({ imageB64: "b", spec: { tag: "b" } });
  assert.equal(a.view.position, 1);
  assert.equal(b.view.position, 2, "the second job knows it is second");

  const aDone = await until(() => {
    const v = q.get(a.view.job_id);
    return v.state === "done" ? v : null;
  });
  assert.equal(aDone.result.spec.tag, "a", "the first job's result is its own");
  const bView = q.get(b.view.job_id);
  assert.ok(["queued", "running", "done"].includes(bView.state));
  const bDone = await until(() => {
    const v = q.get(b.view.job_id);
    return v.state === "done" ? v : null;
  });
  assert.equal(bDone.result.spec.tag, "b");
});

test("forge asleep is a held place and a sentence, not an error", async () => {
  const engine = slowEngine(5, { available: false });
  const q = makeQueue({ engine, pollMs: 10 });
  const j = q.enqueue({ imageB64: "a", spec: {} });
  const v = await until(() => {
    const s = q.get(j.view.job_id);
    return s.reason === "forge_down" ? s : null;
  });
  assert.equal(v.state, "queued", "still in line");
  assert.match(v.message, /greenhouse is closed/i, "and the user is told why in plain words");
  assert.equal(engine.calls, 0, "nothing was rendered");
});

test("a busy machine is yielded to, not queued behind aggressively", async () => {
  const engine = slowEngine(5, { busy: true });
  const q = makeQueue({ engine, pollMs: 10 });
  const j = q.enqueue({ imageB64: "a", spec: {} });
  const v = await until(() => {
    const s = q.get(j.view.job_id);
    return s.reason === "busy" ? s : null;
  });
  assert.equal(v.state, "queued");
  assert.match(v.message, /mid-render/i);
});

test("the line has a bottom, and says so", async () => {
  const engine = slowEngine(50);
  const q = makeQueue({ engine, maxDepth: 2 });
  assert.equal(q.enqueue({}).accepted, true);
  assert.equal(q.enqueue({}).accepted, true);
  const third = q.enqueue({});
  assert.equal(third.accepted, false);
  assert.equal(third.full, true);
});

test("a job that never gets the GPU eventually gives up honestly", async () => {
  const engine = slowEngine(5, { available: false });
  const q = makeQueue({ engine, pollMs: 5 });
  const j = q.enqueue({ imageB64: "a", spec: {} });
  // reach into the job's clock rather than waiting 45 minutes
  const real = Date.now;
  Date.now = () => real() + 46 * 60 * 1000;
  try {
    const v = await until(() => {
      const s = q.get(j.view.job_id);
      return s.state === "error" ? s : null;
    });
    assert.equal(v.reason, "expired");
    assert.match(v.message, /send the photo again/i);
  } finally {
    Date.now = real;
  }
});
