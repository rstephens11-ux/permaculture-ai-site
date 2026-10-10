// api/handler.mjs — the whole API, transport-agnostic.
//
// The signature is deliberately socket-free: handle(req) -> {status, headers, json}. The local server
// (server/dev.mjs) adapts Node's http objects to it, and the same function could be lifted into a
// Cloudflare Worker later with a three-line adapter. Nothing in here knows about ports.
//
// Privacy rule enforced here rather than promised: image bytes are measured and forwarded, never logged,
// never written to disk, never echoed back in an error.

import { makeEngine } from "./engine/index.mjs";
import { makeQueue } from "./queue.mjs";
import { makeLimiter } from "./ratelimit.mjs";
import { makeLeadStore, validEmail } from "./leads.mjs";
import { buildPlan } from "./plan-spec.mjs";
import { crops, windowsFor, lastFrostFromZip } from "./harvest.mjs";

const CONCEPT_DISCLAIMER =
  "Concept sketch only — not construction drawings, not a survey, and not a guarantee of what will grow.";

export const MAX_BODY_BYTES = 10 * 1024 * 1024; // base64 of a 6 MB photo plus JSON overhead

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl.trim());
  if (!m) return null;
  return { mime: m[1], b64: m[2], bytes: Math.floor((m[2].length * 3) / 4) };
}

export function createApi({
  engineName = process.env.ENGINE || "mock",
  engineOpts = {},
  leadStorePath = process.env.LEAD_STORE || "./leads.csv",
  limiter = makeLimiter({
    perIpPerDay: Number(process.env.PER_IP_PER_DAY || 1),
    globalDailyCap: Number(process.env.GLOBAL_DAILY_CAP || 25),
    maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 6)
  }),
  maxDepth = Number(process.env.QUEUE_MAX || 6),
  log = () => {}
} = {}) {
  const engine = makeEngine(engineName, { log, ...engineOpts });
  const queue = makeQueue({ engine, maxDepth, log });
  const leads = makeLeadStore(leadStorePath);
  const startedAt = Date.now();

  async function health() {
    const up = await engine.available();
    return {
      ok: true,
      engine: engine.name,
      forge: up ? "up" : "down",
      uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
      queue: queue.snapshot(),
      ...limiter.snapshot(),
      leads: leads.count()
    };
  }

  async function plan(body, ip) {
    const img = parseDataUrl(body.image_data_url || body.image_b64);
    if (!img) {
      return {
        status: 400,
        json: { error: "no_image", message: "That didn't come through as a photo. Try picking the file again." }
      };
    }
    const gate = limiter.checkUpload({ bytes: img.bytes, mime: img.mime });
    if (!gate.ok) return { status: gate.status, json: { error: gate.error, message: gate.message } };
    log(`plan: ${img.bytes} bytes ${img.mime} (contents never logged)`);

    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (email && !validEmail(email)) {
      return { status: 400, json: { error: "bad_email", message: "That email address looks off — check it?" } };
    }

    const tent = limiter.take(ip);
    if (!tent.ok) return { status: tent.status, json: { error: tent.error, message: tent.message } };

    // The plan text is fixed BEFORE the render, so label (1) on the image and step (1) in the list
    // always describe the same thing.
    const spec = buildPlan({ zip: body.zip || "", lastFrostMonthDay: body.last_frost_month_day || "" });

    const enq = queue.enqueue({
      imageB64: img.b64,
      mime: img.mime,
      prompt: spec.prompt,
      spec
    });
    if (!enq.accepted) {
      return {
        status: 429,
        json: {
          error: "queue_full",
          message: "The line is full right now. Leave your email and you'll get your plan when it clears."
        }
      };
    }

    if (email) {
      try {
        leads.add({ email, source: "plan", zip: body.zip || "", note: "submitted a photo" });
      } catch (err) {
        log(`lead store refused: ${err.message}`);
      }
    }

    return { status: 202, json: { ...enq.view, remaining_today: tent.remaining_today } };
  }

  function jobResult(id) {
    const v = queue.get(id);
    if (!v) return { status: 404, json: { error: "unknown_job", message: "That plan isn't here any more." } };
    if (v.state === "done" && v.result) {
      const spec = v.result.spec || null;
      return {
        status: 200,
        json: {
          state: "done",
          engine: v.result.engine,
          plan_image_data_url: `data:${v.result.mime};base64,${v.result.imageB64}`,
          steps: spec ? spec.steps : [],
          harvest_window: spec ? spec.harvest_window : [],
          glut: spec ? spec.glut : null,
          concept_disclaimer: CONCEPT_DISCLAIMER
        }
      };
    }
    const { result, ...rest } = v;
    return { status: 202, json: rest };
  }

  function lead(body) {
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!validEmail(email)) {
      return { status: 400, json: { error: "bad_email", message: "That email address looks off — check it?" } };
    }
    const res = leads.add({
      email,
      source: body.source || "unknown",
      zip: body.zip || "",
      note: body.note || ""
    });
    return { status: 200, json: { ok: true, duplicate: res.duplicate } };
  }

  function harvest(body) {
    const ids = Array.isArray(body.crops) && body.crops.length ? body.crops : crops().map((c) => c.id);
    return {
      status: 200,
      json: {
        windows: windowsFor(ids, { zip: body.zip || "", lastFrostMonthDay: body.last_frost_month_day || "" }),
        frost: lastFrostFromZip(body.zip || "")
      }
    };
  }

  return {
    engine,
    queue,
    leads,
    limiter,
    async handle(req) {
      const method = (req.method || "GET").toUpperCase();
      const path = (req.path || "/").replace(/\/$/, "") || "/";
      const body = req.json || {};
      const ip = req.ip || "unknown";

      try {
        if (method === "GET" && path === "/api/health") return { status: 200, json: await health() };
        if (method === "POST" && path === "/api/plan") return await plan(body, ip);
        if (method === "GET" && path.startsWith("/api/plan/")) return jobResult(path.slice("/api/plan/".length));
        if (method === "POST" && path === "/api/lead") return lead(body);
        if (method === "POST" && path === "/api/harvest") return harvest(body);
        return { status: 404, json: { error: "not_found", message: `No route for ${method} ${path}.` } };
      } catch (err) {
        log(`handler error on ${method} ${path}: ${err && err.stack ? err.stack.split("\n")[0] : err}`);
        return { status: 500, json: { error: "server_error", message: "Something broke on our end. Nothing was kept." } };
      }
    }
  };
}
