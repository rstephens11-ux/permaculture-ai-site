// api/leads.mjs — append-only lead store.
//
// Deliberately the dumbest thing that works: one CSV line per email, owned by Ryan, no third party.
// There is no delete path in the API, on purpose — a lead list you can silently lose is worse than none.
// NOTE: nothing sends mail. Until an ESP (Buttondown is the fit) is wired, this list is collected and
// inert. That is a known, stated gap, not a bug.

import { appendFileSync, existsSync, readFileSync } from "node:fs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validEmail(email) {
  return typeof email === "string" && email.length <= 254 && EMAIL_RE.test(email.trim());
}

function csvCell(v) {
  const s = String(v ?? "").replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

export function makeLeadStore(path) {
  const file = path || "./leads.csv";
  return {
    path: file,
    has(email) {
      if (!existsSync(file)) return false;
      const target = email.trim().toLowerCase();
      return readFileSync(file, "utf8")
        .split("\n").slice(1)
        .some((line) => line.split(",")[0].trim().toLowerCase() === target);
    },
    add({ email, source = "unknown", zip = "", note = "" }) {
      if (!validEmail(email)) throw new Error("invalid_email");
      const clean = email.trim().toLowerCase();
      if (this.has(clean)) return { added: false, duplicate: true };
      if (!existsSync(file)) appendFileSync(file, "email,source,zip,created_at,note\n");
      appendFileSync(file, [clean, source, zip, new Date().toISOString(), note]
        .map(csvCell).join(",") + "\n");
      return { added: true, duplicate: false };
    },
    count() {
      if (!existsSync(file)) return 0;
      return readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).length - 1;
    }
  };
}
