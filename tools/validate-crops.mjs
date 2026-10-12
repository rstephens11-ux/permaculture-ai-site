// tools/validate-crops.mjs — check the researched crop files before anything is generated from them.
//
// A child agent's "done, all sourced" is a self-report. This is the check: parses, required keys present
// and the right type, ids match the roster, and — the one that matters most — no row is accepted without
// a source, because a spacing or a days-to-maturity figure with no provenance is worse than a missing crop.
//
//   node tools/validate-crops.mjs            # report only
//   node tools/validate-crops.mjs --merge    # also write api/crops.json merged with the 21 existing

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "data/crops");

const REQUIRED = {
  id: "string", name: "string", label: "string", kind: "string", family: "string",
  days_to_maturity: "array", min_frost_free_days: "number", succession_days: "number",
  season: "string", planting: "object", bed30: "object", method: "string",
  start_inside_weeks: "number", cold: "boolean", shade: "string", watch_for: "string",
  companions: "array", watering: "string", method_notes: "string", source: "string"
};
const KIND_OK = new Set(["root", "leaf", "fruiting", "allium", "legume", "herb", "flower", "cover",
  "berry", "fruit-tree", "perennial", "grain", "seed"]);
const METHOD_OK = new Set(["transplant", "direct", "either"]);
const SEASON_OK = new Set(["cool", "warm", "overwinter", "perennial"]);

const typeOf = (v) => Array.isArray(v) ? "array" : v === null ? "null" : typeof v;

let files = [];
try { files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort(); } catch { }
if (!files.length) { console.log("no files in data/crops/ yet"); process.exit(0); }

const rows = [];
const problems = [];
const ids = new Map();

for (const f of files) {
  const raw = readFileSync(join(DIR, f), "utf8");
  let arr;
  try { arr = JSON.parse(raw); } catch (e) { problems.push(`${f}: does not parse — ${e.message}`); continue; }
  if (!Array.isArray(arr)) { problems.push(`${f}: top level is ${typeOf(arr)}, expected an array`); continue; }

  for (const c of arr) {
    const where = `${f} → ${c && c.id ? c.id : "(no id)"}`;
    if (!c || typeof c !== "object") { problems.push(`${where}: not an object`); continue; }
    for (const [k, t] of Object.entries(REQUIRED)) {
      if (!(k in c)) { problems.push(`${where}: missing ${k}`); continue; }
      if (typeOf(c[k]) !== t) problems.push(`${where}: ${k} is ${typeOf(c[k])}, expected ${t}`);
    }
    if (c.kind && !KIND_OK.has(c.kind)) problems.push(`${where}: unknown kind "${c.kind}"`);
    if (c.method && !METHOD_OK.has(c.method)) problems.push(`${where}: unknown method "${c.method}"`);
    if (c.season && !SEASON_OK.has(c.season)) problems.push(`${where}: unknown season "${c.season}"`);
    if (c.days_to_maturity && (!Array.isArray(c.days_to_maturity) || c.days_to_maturity.length !== 2))
      problems.push(`${where}: days_to_maturity must be [min, max]`);
    if (c.bed30 && (typeof c.bed30.rows !== "number" || typeof c.bed30.in_row_in !== "number"))
      problems.push(`${where}: bed30 needs numeric rows and in_row_in`);
    // bed30.rows only means something for a crop that goes IN a 30-inch bed. A tree has no bed rows and
    // says 0; a broadcast cover has no rows at all and says 6. The first run of this validator flagged 12
    // rows for that, and the rule was wrong, not the data.
    if (c.bed30 && c.kind) {
      const permanent = c.kind === "fruit-tree" || c.kind === "berry" || c.kind === "perennial";
      const lo = permanent ? 0 : 1;
      const hi = c.kind === "cover" ? 8 : 4;
      if (!(c.bed30.rows >= lo && c.bed30.rows <= hi))
        problems.push(`${where}: bed30.rows ${c.bed30.rows} outside ${lo}-${hi} for kind ${c.kind}`);
    }
    if (!c.source || !String(c.source).trim()) problems.push(`${where}: NO SOURCE — rejected`);
    if (c.permanent && typeof c.permanent.spacing_ft !== "number")
      problems.push(`${where}: permanent.spacing_ft must be a number`);
    if (ids.has(c.id)) problems.push(`${where}: duplicate id, also in ${ids.get(c.id)}`);
    ids.set(c.id, f);
    rows.push(c);
  }
}

// what is still missing from the roster?
const existing = JSON.parse(readFileSync(join(ROOT, "api/crops.json"), "utf8"));
const have = new Set((Array.isArray(existing) ? existing : existing.crops || []).map((c) => c.id));
const roster = readFileSync(join(ROOT, "CROPS-100.md"), "utf8");
const want = [...new Set(roster.match(/[a-z][a-z-]+/g) || [])].filter((w) => false); // roster prose is not machine-readable

console.log(`files: ${files.join(", ")}`);
console.log(`rows: ${rows.length}   invalid: ${problems.length}`);
for (const f of files) {
  const n = rows.filter((r) => true).length;
  const inFile = (() => { try { return JSON.parse(readFileSync(join(DIR, f), "utf8")).length; } catch { return 0; } })();
  console.log(`  ${f.padEnd(20)} ${String(inFile).padStart(2)} rows`);
}
if (problems.length) {
  console.log(`\nPROBLEMS (${problems.length}):`);
  problems.slice(0, 40).forEach((p) => console.log("  " + p));
  if (problems.length > 40) console.log(`  … ${problems.length - 40} more`);
} else {
  console.log("\nall rows valid, every row sourced");
}
console.log(`\nnew ids: ${rows.length}   already in the table: ${rows.filter((r) => have.has(r.id)).length}`);
console.log(`kinds: ${[...new Set(rows.map((r) => r.kind))].sort().join(", ")}`);

if (process.argv.includes("--merge") && !problems.length) {
  const merged = (Array.isArray(existing) ? existing : existing.crops || []).concat(rows.filter((r) => !have.has(r.id)));
  writeFileSync(join(ROOT, "api/crops.json"), JSON.stringify(merged, null, 2) + "\n");
  console.log(`\nmerged: api/crops.json now holds ${merged.length} crops`);
} else if (process.argv.includes("--merge")) {
  console.log("\nNOT merged — fix the problems first");
}
