// api/ratelimit.mjs — the whole safety story for a free GPU tool.
//
// Nothing here costs money, so the caps exist to protect two things: the GPU's minutes and Ryan's
// evenings. One plan per person per day, a global daily ceiling, a hard upload size, a mime whitelist.
// In-memory on purpose: a restart forgives everyone, which is the right failure direction.

export function makeLimiter({
  perIpPerDay = 1,
  globalDailyCap = 25,
  maxUploadMb = 6,
  maxUploadBytes = null,
  allowedMime = ["image/jpeg", "image/png", "image/webp"]
} = {}) {
  const cap = maxUploadBytes ?? maxUploadMb * 1024 * 1024;
  const byIp = new Map(); // ip -> {day, count}
  let day = today();
  let total = 0;

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function roll() {
    const d = today();
    if (d !== day) {
      day = d;
      total = 0;
      byIp.clear();
    }
  }

  return {
    /** @returns {{ok: true} | {ok: false, status: number, error: string, message: string}} */
    checkUpload({ bytes, mime }) {
      if (typeof bytes !== "number" || bytes <= 0) {
        return { ok: false, status: 400, error: "empty_image", message: "That file came through empty." };
      }
      if (bytes > cap) {
        return {
          ok: false, status: 413, error: "too_large",
          message: `That photo is bigger than ${(cap / 1024 / 1024).toFixed(0)} MB. Most phones can shrink it when they send it.`
        };
      }
      if (!allowedMime.includes(mime)) {
        return {
          ok: false, status: 415, error: "bad_type",
          message: "That isn't a JPEG, PNG or WebP. A plain photo straight off the phone is perfect."
        };
      }
      return { ok: true };
    },

    /** @returns {{ok: true, remaining_today: number} | {ok: false, status: number, error: string, message: string}} */
    take(ip) {
      roll();
      const key = ip || "unknown";
      if (total >= globalDailyCap) {
        return {
          ok: false, status: 429, error: "daily_cap",
          message: `That's all the plans this machine makes in a day (${globalDailyCap}). Leave your email and you'll get one tomorrow.`
        };
      }
      const rec = byIp.get(key) || { day, count: 0 };
      if (rec.count >= perIpPerDay) {
        return {
          ok: false, status: 429, error: "per_ip_cap",
          message: "One free plan per person per day — the machine only has so many hours."
        };
      }
      rec.count += 1;
      byIp.set(key, rec);
      total += 1;
      return { ok: true, remaining_today: Math.max(0, globalDailyCap - total) };
    },

    snapshot() {
      roll();
      return { plans_today: total, daily_cap: globalDailyCap, visitors_today: byIp.size };
    }
  };
}
