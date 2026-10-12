// api/handler.mjs — the whole API, transport-agnostic.
//
// The signature is deliberately socket-free: handle(req) -> {status, headers, json}. The local server
// (server/dev.mjs) adapts Node's http objects to it, and the same function could be lifted into a
// Cloudflare Worker with a three-line adapter. Nothing in here knows about ports.
//
// Privacy rules enforced here rather than promised:
//   * image bytes are measured and forwarded, never logged, never written to disk, never echoed back
//   * the only thing kept about a visitor is a random cookie token, which renders they've used, and the
//     email they chose to give. No fingerprinting, no third-party anything.

import { makeEngine } from "./engine/index.mjs";
import { MASK_PROMPT } from "./engine/forge.mjs";
import { makeQueue } from "./queue.mjs";
import { makeLimiter } from "./ratelimit.mjs";
import { makeLeadStore, validEmail } from "./leads.mjs";
import { makeGate } from "./gate.mjs";
import { buildPlan } from "./plan-spec.mjs";
import { crops, windowsFor, frostFor } from "./harvest.mjs";

const CONCEPT_DISCLAIMER =
  "Concept sketch only — not construction drawings, not a survey, and not a guarantee of what will grow.";

const MAX_IMAGES = Number(process.env.MAX_IMAGES || 3);
export const MAX_BODY_BYTES = 26 * 1024 * 1024; // up to 3 photos at 6 MB, base64, plus JSON overhead

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl.trim());
  if (!m) return null;
  return { mime: m[1], b64: m[2], bytes: Math.floor((m[2].length * 3) / 4) };
}

function readImages(body) {
  const raw = Array.isArray(body.images) && body.images.length
    ? body.images
    : [body.image_data_url || body.image_b64];
  return raw.slice(0, MAX_IMAGES).map(parseDataUrl).filter(Boolean);
}

export function createApi({
  engineName = process.env.ENGINE || "mock",
  engineOpts = {},
  leadStorePath = process.env.LEAD_STORE || "./leads.csv",
  gateStorePath = process.env.GATE_STORE || "./gate.json",
  limiter = makeLimiter({
    // The gate (api/gate.mjs) is now the per-person limit — one free render, then five a week for an
    // email. This per-IP number is only an abuse floor: it catches someone clearing cookies to mint
    // fresh free renders, without punishing a household that shares one address.
    perIpPerDay: Number(process.env.PER_IP_PER_DAY || 3),
    globalDailyCap: Number(process.env.GLOBAL_DAILY_CAP || 25),
    maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 6)
  }),
  gate = makeGate({ path: gateStorePath, log: () => {} }),
  maxDepth = Number(process.env.QUEUE_MAX || 6),
  log = () => {}
} = {}) {
  // The engine's one job for a visitor is finding the BEDS: a segmentation mask, which the overlay then
  // fills and plants. It is optional by design — the queue delivers the plan without a mask if the GPU is
  // asleep, and the overlay falls back to laying the plan over the open ground.
  const engine = makeEngine(engineName, { log, ...engineOpts });
  const queue = makeQueue({ engine, maxDepth, log });
  const leads = makeLeadStore(leadStorePath);
  const counters = { plans_total: 0, plans_with_email: 0, product_views: 0, email_unlocks: 0, started: new Date().toISOString() };
  const startedAt = Date.now();

  function cookieToken(req) {
    return (req.cookies && req.cookies.pa_id) || null;
  }

  /** Ensure a visitor has a token; if not, mint one and ask the transport to set it. */
  function ensureToken(req) {
    const existing = cookieToken(req);
    if (existing) return { token: existing, setCookie: null };
    const token = gate.newToken();
    return {
      token,
      setCookie: `pa_id=${token}; Path=/; Max-Age=31536000; SameSite=Lax` + (process.env.SECURE_COOKIES === "yes" ? "; Secure" : "")
    };
  }

  async function health() {
    const up = await engine.available();
    return {
      ok: true,
      engine: engine.name,
      denoise: engine.denoise,
      forge: up ? "up" : "down",
      uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
      queue: queue.snapshot(),
      ...limiter.snapshot(),
      gate: gate.snapshot(),
      counters: { ...counters },
      leads: leads.count(),
      frost_data: (await import("./frost/lookup.mjs")).stationsSource()
    };
  }

  function me(req) {
    const { token, setCookie } = ensureToken(req);
    const status = gate.status(token);
    return { status: 200, setCookie, json: { ...status, ...gate.snapshot() } };
  }

  async function plan(body, ip, req) {
    const { token, setCookie } = ensureToken(req);
    const callStatus = gate.status(token);

    // --- zip is required now, because everything below depends on it -----------------------------
    const zip = String(body.zip || "").replace(/\D/g, "").slice(0, 5);
    if (zip.length !== 5) {
      return {
        status: 400,
        setCookie,
        json: {
          error: "zip_required",
          message: "We need the zip code — it's what gives you real frost dates and crops that will actually ripen where you live.",
          status: callStatus
        }
      };
    }

    // --- gate: one render free, then an email buys five a week -----------------------------------
    if (!callStatus.allowed) {
      const message = callStatus.needs_email
        ? "That was your free plan. Pop your email in and you'll get five a week from here."
        : "You've used all five for this week. They come back in a few days — nothing else to do.";
      return {
        status: 403,
        setCookie,
        json: { error: callStatus.needs_email ? "email_required" : "week_used", message, status: callStatus }
      };
    }

    const images = readImages(body);
    if (!images.length) {
      return {
        status: 400, setCookie,
        json: { error: "no_image", message: "That didn't come through as a photo. Try picking the file again." }
      };
    }
    for (const img of images) {
      const check = limiter.checkUpload({ bytes: img.bytes, mime: img.mime });
      if (!check.ok) return { status: check.status, setCookie, json: { error: check.error, message: check.message } };
    }
    log(`plan: ${images.length} photo(s), ${images.reduce((n, i) => n + i.bytes, 0)} bytes total (contents never logged)`);

    const tent = limiter.take(ip);
    if (!tent.ok) return { status: tent.status, setCookie, json: { error: tent.error, message: tent.message } };

    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (email && !validEmail(email)) {
      return { status: 400, setCookie, json: { error: "bad_email", message: "That email address looks off — check it?" } };
    }

    // The plan text is fixed BEFORE the render, so label (1) on the drawing and step (1) in the list
    // always describe the same thing.
    const spec = buildPlan({
      zip,
      sun: body.sun || "full",
      beds: body.beds || undefined,
      existing: body.existing || "unsure"
    });

    const enq = queue.enqueue({
      images: images.map((i) => ({ b64: i.b64, mime: i.mime })),
      imageB64: images[0].b64,
      mime: images[0].mime,
      prompt: MASK_PROMPT,      // find the beds; the drawing of the plan is ours
      optional: true,           // a plan without a mask still beats no plan
      spec
    });
    if (!enq.accepted) {
      return {
        status: 429, setCookie,
        json: {
          error: "queue_full",
          message: "The line is full right now. Leave your email and you'll get your plan when it clears.",
          status: callStatus
        }
      };
    }

    const after = gate.take({ token, ip });
    counters.plans_total += 1;
    if (email) {
      counters.plans_with_email += 1;
      try {
        leads.add({ email, source: "plan", zip, note: "submitted a photo" });
        if (!callStatus.email_on_file) {
          gate.registerEmail({ token, ip, email });
          counters.email_unlocks += 1;
        }
      } catch (err) {
        log(`lead store refused: ${err.message}`);
      }
    }
    if (after.status && after.status.email_on_file) {
      // Nothing further: the email is already recorded via registerEmail below (or on a previous call).
    }

    return {
      status: 202, setCookie,
      json: {
        ...enq.view,
        remaining_today: tent.remaining_today,
        status: after.status,
        place: spec.frost.known ? spec.frost.place : null,
        frost: spec.frost,
        notes: spec.notes
      }
    };
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
          // The mask the overlay draws the beds from. Null when the machine was asleep or the render
          // failed — the page then lays the plan over the open ground instead.
          mask_data_url: v.result.imageB64 ? `data:${v.result.mime};base64,${v.result.imageB64}` : null,
          mask_note: v.result.note || null,
          plan_image_data_url: null,      // the per-photo illustration is retired
          phases: spec ? spec.phases : [],
          bed_plan: spec ? spec.bed_plan : [],
          layout: spec ? spec.layout : null,
          diagram_svg: spec ? spec.diagram_svg : null,
          rotation: spec ? spec.rotation : null,
          geometry: spec ? spec.geometry : null,
          geometry_label: spec ? spec.geometry_label : null,
          geometry_dims: spec ? spec.geometry_dims : null,
          crop_list: spec ? spec.crop_list : [],
          beds: spec ? spec.beds : null,
          existing: spec ? spec.existing : null,
          sun: spec ? spec.sun : null,
          frost: spec ? spec.frost : null,
          season: spec ? spec.season : null,
          notes: spec ? spec.notes : [],
          harvest_window: spec ? spec.harvest_window : [],
          glut: spec ? spec.glut : null,
          concept_disclaimer: CONCEPT_DISCLAIMER
        }
      };
    }
    const { result, ...rest } = v;
    return { status: 202, json: rest };
  }

  function unlockEmail(body, ip, req) {
    const { token, setCookie } = ensureToken(req);
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!validEmail(email)) {
      return { status: 400, setCookie, json: { error: "bad_email", message: "That email address looks off — check it?" } };
    }
    const status = gate.registerEmail({ token, ip, email });
    counters.email_unlocks += 1;
    try {
      leads.add({ email, source: body.source || "gate", zip: body.zip || "", note: "unlocked the weekly allowance" });
    } catch (err) {
      log(`lead store refused: ${err.message}`);
    }
    return { status: 200, setCookie, json: { ok: true, status } };
  }

  function lead(body) {
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!validEmail(email)) {
      return { status: 400, json: { error: "bad_email", message: "That email address looks off — check it?" } };
    }
    const res = leads.add({
      email, source: body.source || "unknown", zip: body.zip || "", note: body.note || ""
    });
    return { status: 200, json: { ok: true, duplicate: res.duplicate } };
  }

  function harvest(body) {
    const ids = Array.isArray(body.crops) && body.crops.length ? body.crops : crops().map((c) => c.id);
    const frost = frostFor(body.zip || "");
    return {
      status: 200,
      json: { windows: windowsFor(ids, { zip: body.zip || "", frost }), frost }
    };
  }

  function track(body) {
    const event = String(body.event || "").slice(0, 40);
    if (event === "product_view") counters.product_views += 1;
    else if (event === "plan_result") counters.plan_results = (counters.plan_results || 0) + 1;
    return { status: 200, json: { ok: true } };
  }

  return {
    engine,
    queue,
    leads,
    limiter,
    gate,
    counters,
    async handle(req) {
      const method = (req.method || "GET").toUpperCase();
      const path = (req.path || "/").replace(/\/$/, "") || "/";
      const body = req.json || {};
      const ip = req.ip || "unknown";

      try {
        if (method === "GET" && path === "/api/health") return { status: 200, json: await health() };
        if (method === "GET" && path === "/api/me") return me(req);
        if (method === "POST" && path === "/api/plan") return await plan(body, ip, req);
        if (method === "GET" && path.startsWith("/api/plan/")) return jobResult(path.slice("/api/plan/".length));
        if (method === "POST" && path === "/api/email") return unlockEmail(body, ip, req);
        if (method === "POST" && path === "/api/lead") return lead(body);
        if (method === "POST" && path === "/api/harvest") return harvest(body);
        if (method === "POST" && path === "/api/track") return track(body);
        return { status: 404, json: { error: "not_found", message: `No route for ${method} ${path}.` } };
      } catch (err) {
        log(`handler error on ${method} ${path}: ${err && err.stack ? err.stack.split("\n")[0] : err}`);
        return { status: 500, json: { error: "server_error", message: "Something broke on our end. Nothing was kept." } };
      }
    }
  };
}
