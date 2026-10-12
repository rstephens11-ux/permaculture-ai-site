// api/queue.mjs — one GPU, one job at a time, and a place in line that survives being busy.
//
// The design decision that matters: a queued job is NOT an error. With a single home GPU, "wait"
// is the normal case, so the job keeps its position, the page shows the position, and forge being
// asleep is a state we can say out loud ("the greenhouse is closed") instead of a stack trace.

import { randomUUID } from "node:crypto";

const EXPIRE_MS = 45 * 60 * 1000;

export function makeQueue({ engine, maxDepth = 6, log = () => {}, pollMs = 1500 } = {}) {
  const jobs = new Map();
  const order = [];
  let pumping = false;
  let lastJobSeconds = 30; // first estimate before we have a measurement (real renders: 20-24s at 1K)

  function positionOf(id) {
    const q = order.filter((j) => jobs.get(j)?.state === "queued");
    const i = q.indexOf(id);
    return i < 0 ? 0 : i + 1;
  }

  function view(job) {
    const waiting = order.filter((j) => {
      const s = jobs.get(j)?.state;
      return s === "queued" || s === "running";
    });
    const ahead = waiting.indexOf(job.id);
    return {
      job_id: job.id,
      state: job.state,
      reason: job.reason || null,
      position: job.state === "queued" ? positionOf(job.id) : job.state === "running" ? 1 : 0,
      eta_seconds: job.state === "done" ? 0 : Math.max(5, Math.round((Math.max(ahead, 0) + 1) * lastJobSeconds)),
      result: job.state === "done" ? job.result : null,
      message: job.message || null
    };
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        const id = order.find((j) => jobs.get(j).state === "queued");
        if (!id) break;
        const job = jobs.get(id);

        if (Date.now() - job.created > EXPIRE_MS) {
          job.state = "error";
          job.reason = "expired";
          job.message = "This one sat too long — the machine never freed up. Send the photo again.";
          continue;
        }

        if (!(await engine.available())) {
          job.reason = "forge_down";
          job.message = "The greenhouse is closed — the machine that draws these is offline. Your place is held.";
          await new Promise((r) => setTimeout(r, pollMs));
          continue;
        }

        if (await engine.busy()) {
          job.reason = "busy";
          job.message = "The machine is mid-render. Your place is held.";
          await new Promise((r) => setTimeout(r, pollMs));
          continue;
        }

        job.state = "running";
        job.reason = null;
        job.message = null;
        job.started = Date.now();
        try {
          const result = await engine.plan(job.input);
          // The engine returns pixels; the plan text is ours and travels with the job.
          job.result = { ...result, spec: job.input.spec };
          job.state = "done";
          job.finished = Date.now();
          const secs = (job.finished - job.started) / 1000;
          if (secs > 2) lastJobSeconds = secs; // don't let a mock run poison the estimate
          log(`job ${job.id} done in ${secs.toFixed(1)}s`);
        } catch (err) {
          job.state = "error";
          job.reason = "engine_error";
          job.message = "The render failed on the machine. Nothing was kept. Try again?";
          log(`job ${job.id} failed: ${err && err.message}`);
        }
      }
    } finally {
      pumping = false;
    }
  }

  return {
    get(id) {
      const job = jobs.get(id);
      return job ? view(job) : null;
    },
    enqueue(input) {
      if (order.filter((j) => ["queued", "running"].includes(jobs.get(j).state)).length >= maxDepth) {
        return { accepted: false, full: true };
      }
      const job = { id: randomUUID().slice(0, 12), state: "queued", created: Date.now(), input };
      jobs.set(job.id, job);
      order.push(job.id);
      pump();
      return { accepted: true, view: view(job) };
    },
    depth() {
      return order.filter((j) => ["queued", "running"].includes(jobs.get(j).state)).length;
    },
    snapshot() {
      const done = order.filter((j) => jobs.get(j).state === "done").length;
      return { depth: this.depth(), served: done, avg_seconds: Math.round(lastJobSeconds) };
    }
  };
}
