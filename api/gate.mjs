// api/gate.mjs — the free-tier gate: one render free, then an email buys five more a week.
//
// Ryan's call, and the reasoning is his: don't give everything away, and don't let one person rack up
// GPU time. Five per WEEK rather than per day, because nobody needs to render a garden plan five times
// in a day — which means, in practice, the weekly cap is mostly a way of not being a free render farm.
//
// What this honestly is NOT: verified accounts. There is no confirmation email (nothing sends mail yet),
// so the gate is an honour system with teeth against casual scraping and no defence against someone who
// types a junk address. That is acceptable for a free toy; it would not be acceptable for anything paid.
//
// Identity = a random token in a cookie, plus the caller's IP as a secondary signal, so deleting the
// cookie doesn't mint an unlimited free tier. State is written to a small JSON file so a restart doesn't
// hand everyone a fresh allowance.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function makeGate({
  path = process.env.GATE_STORE || "./gate.json",
  freeRenders = Number(process.env.FREE_RENDERS || 1),
  rendersAfterEmail = Number(process.env.RENDERS_AFTER_EMAIL || 5),
  log = () => {}
} = {}) {
  let state = { tokens: {}, ips: {}, updated: null };

  function load() {
    try {
      if (existsSync(path)) state = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      log(`gate store unreadable, starting fresh: ${err.message}`);
    }
  }

  function save() {
    try {
      mkdirSync(dirname(path), { recursive: true });
      state.updated = new Date().toISOString();
      writeFileSync(path, JSON.stringify(state));
    } catch (err) {
      log(`gate store not writable: ${err.message}`);
    }
  }

  load();

  function freshRec(now) {
    return { free_used: 0, email: null, used_since_email: 0, window_start: null, first_seen: now };
  }

  function tokenFor(token) {
    if (!token) return null;
    if (!state.tokens[token]) {
      state.tokens[token] = freshRec(Date.now());
      save();
    }
    return state.tokens[token];
  }

  function ipRec(ip) {
    if (!state.ips[ip]) state.ips[ip] = { free_used: 0, emails: [] };
    return state.ips[ip];
  }

  function status(token) {
    const rec = tokenFor(token);
    if (!rec) {
      return { allowed: false, reason: "no_token", free_left: freeRenders, week_left: 0, needs_email: false };
    }
    const now = Date.now();
    const windowExpired = rec.window_start && now - rec.window_start > WEEK_MS;
    const used = windowExpired ? 0 : rec.used_since_email;
    const weekLeft = rec.email ? Math.max(0, rendersAfterEmail - used) : 0;
    const freeLeft = Math.max(0, freeRenders - rec.free_used);
    return {
      allowed: freeLeft > 0 || weekLeft > 0,
      reason: freeLeft > 0 ? "free" : weekLeft > 0 ? "email_window" : rec.email ? "week_used" : "email_required",
      free_left: freeLeft,
      week_left: weekLeft,
      needs_email: freeLeft === 0 && !rec.email,
      email_on_file: !!rec.email,
      renders_after_email: rendersAfterEmail,
      week_resets_in_days: windowExpired || !rec.window_start
        ? 0
        : Math.max(1, Math.ceil((WEEK_MS - (now - rec.window_start)) / 86400000))
    };
  }

  return {
    path,
    /** Is this person allowed to render right now? */
    status,

    /** Record a render. Call only after status().allowed was true. */
    take({ token, ip }) {
      const rec = tokenFor(token);
      if (!rec) return { taken: false };
      if (rec.free_used < freeRenders) {
        rec.free_used += 1;
        ipRec(ip).free_used += 1;
      } else {
        if (!rec.window_start || Date.now() - rec.window_start > WEEK_MS) {
          rec.window_start = Date.now();
          rec.used_since_email = 0;
        }
        rec.used_since_email += 1;
      }
      save();
      return { taken: true, status: status(token) };
    },

    /** The email that unlocks the weekly allowance. No verification exists — see the note above. */
    registerEmail({ token, ip, email }) {
      const rec = tokenFor(token);
      if (!rec) return null;
      rec.email = String(email).trim().toLowerCase();
      rec.window_start = Date.now();
      rec.used_since_email = 0;
      const ipr = ipRec(ip);
      if (!ipr.emails.includes(rec.email)) ipr.emails.push(rec.email);
      save();
      return status(token);
    },

    newToken() {
      const token = randomBytes(9).toString("base64url");
      state.tokens[token] = freshRec(Date.now());
      save();
      return token;
    },

    /** Cheap abuse floor: one address per IP per week is not enforced, but an IP can't mint tokens forever. */
    ipAllowsNewFree(ip) {
      const rec = ipRec(ip);
      return rec.free_used < freeRenders * 3;
    },

    snapshot() {
      const tokens = Object.keys(state.tokens);
      return {
        people_seen: tokens.length,
        emails_collected: tokens.filter((t) => state.tokens[t].email).length,
        free_renders: freeRenders,
        renders_after_email: rendersAfterEmail
      };
    }
  };
}
