// tests/test-harvest.mjs — the hinge: crops in, windows out, honest labels throughout.
//
// These inject a frost object rather than depending on api/frost/stations.json, so they are deterministic
// and still run before the NOAA data has been fetched. One test at the end uses the real data and skips
// politely if it isn't built yet.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { windowFor, windowsFor, glutWindow, crops, frostFor } from "../api/harvest.mjs";
import { buildPlan } from "../api/plan-spec.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// Wiscasset, from the real NOAA numbers: 50%-chance last spring freeze May 6, first fall freeze Oct 5.
const FROST = {
  known: true, zip: "04578", place: "Wiscasset, ME", zone: "5b",
  last_spring_freeze: "05/06", first_fall_freeze: "10/05",
  frost_free_days: 152, confidence: "estimate"
};
const SHORT = { ...FROST, last_spring_freeze: "06/10", first_fall_freeze: "09/10", frost_free_days: 92 };

test("every crop row is sourced, sized and free of processing times", () => {
  const rows = crops();
  assert.ok(rows.length >= 15, "the table has real breadth");
  for (const c of rows) {
    assert.ok(c.id && c.name && c.label, `${c.id} has identity`);
    assert.ok(Array.isArray(c.days_to_maturity) && c.days_to_maturity[0] < c.days_to_maturity[1], `${c.id} range ordered`);
    assert.ok(typeof c.source === "string" && c.source.length > 20, `${c.id} cites a source`);
    assert.ok(c.planting && ["plants", "row_feet"].includes(c.planting.unit), `${c.id} has a planting unit`);
    assert.ok(Number.isInteger(c.planting.per_4x8) && c.planting.per_4x8 >= 0, `${c.id} has a 4x8 count`);
    assert.ok(typeof c.min_frost_free_days === "number", `${c.id} knows its shortest season`);
    assert.ok(["no", "part"].includes(c.shade), `${c.id} declares its shade tolerance`);
    assert.ok(!/\b\d+\s*(minutes|psi|°|degrees)/i.test(c.method_notes),
      `${c.id} must not carry a processing time — those live in the USDA/NCHFP guide`);
  }
});

test("a real local frost date produces a dated window", () => {
  const w = windowFor("tomato", { frost: FROST, year: 2027 });
  assert.equal(w.known, true);
  assert.match(w.window_open, /^2027-\d\d-\d\d$/);
  assert.ok(w.window_open < w.window_close, "a glut is a window, not a day");
  assert.equal(w.fit, "good", "152 days is enough for tomatoes");
});

test("a season that is too short calls the crop a stretch, and says why", () => {
  const w = windowFor("tomato", { frost: SHORT, year: 2027 });
  assert.equal(w.fit, "stretch");
  assert.match(w.note, /wants about 100 frost-free days and your season runs about 92/i);
  assert.equal(w.needs_frost_free_days, 100);
  assert.equal(w.local_frost_free_days, 92);
});

test("garlic, planted in the fall, lands after the season and stays out of the headline window", () => {
  const t = windowFor("tomato", { frost: FROST, year: 2027 });
  const g = windowFor("garlic", { frost: FROST, year: 2027 });
  assert.ok(g.window_open > t.window_open, "garlic comes off the following summer");
  const glut = glutWindow(["tomato", "bush-bean", "garlic"], { frost: FROST, year: 2027 });
  assert.equal(glut.crops, 2, "the headline window is the season's crops");
  assert.equal(glut.next_season[0].name, "Garlic");
});

test("the glut window is the earliest opening to the latest closing", () => {
  const g = glutWindow(["tomato", "bush-bean", "zucchini"], { frost: FROST, year: 2027 });
  assert.ok(g.open && g.close);
  assert.ok(g.open <= g.close);
  assert.equal(g.crops, 3);
});

test("a season that has already passed rolls forward instead of handing back the past", () => {
  const w = windowFor("tomato", { frost: FROST });
  assert.ok(w.window_close >= new Date().toISOString().slice(0, 10), "never a past date");
});

test("an unknown crop is labelled unknown, never guessed", () => {
  const w = windowFor("rutabaga-we-never-heard-of", { frost: FROST });
  assert.equal(w.known, false);
  assert.equal(w.window_open, null);
  assert.equal(w.confidence, "unknown");
});

test("no frost record is an honest no, not an invented date", () => {
  const w = windowFor("tomato", { zip: "00000" });
  if (!w.known) {
    assert.equal(w.confidence, "unknown");
    assert.match(w.note, /confirm your own last-frost date/i);
  }
});

test("the real NOAA table, once built, resolves real zips sensibly", () => {
  const built = existsSync(join(HERE, "../api/frost/stations.json"))
    && existsSync(join(HERE, "../api/frost/zip-locations.csv"));
  if (!built) {
    console.log("    (skipped: run tools/fetch-frost.mjs and tools/build-location.mjs first)");
    return;
  }
  const f = frostFor("04578");
  assert.equal(f.known, true, "Wiscasset, ME resolves");
  assert.match(f.last_spring_freeze, /^\d\d\/\d\d$/);
  assert.ok(f.frost_free_days > 100 && f.frost_free_days < 220, `plausible season: ${f.frost_free_days}`);
  const miami = frostFor("33101");
  const fairbanks = frostFor("99701");
  assert.ok(miami.frost_free_days > fairbanks.frost_free_days, "Miami's season beats Fairbanks'");
  assert.ok(f.station_miles < 60, `nearest station within 60 miles (was ${f.station_miles})`);
});

test("windowsFor returns one window per crop, in the order asked", () => {
  const ws = windowsFor(["pea", "tomato", "kale"], { frost: FROST, year: 2027 });
  assert.deepEqual(ws.map((w) => w.crop), ["pea", "tomato", "kale"]);
});

test("the whole plan lands in one season, never spanning two", () => {
  // October is past Wiscasset's mid-season, so the plan is for next year — every crop, not just the
  // ones whose window happens to have closed.
  const spec = buildPlan({ zip: "04578", frost: FROST, beds: { type: "raised", count: 1 } });
  const years = new Set(spec.harvest_window.filter((w) => w.known && w.season !== "overwinter").map((w) => w.year));
  assert.equal(years.size, 1, `one season only, got ${[...years].join(", ")}`);
  assert.equal(spec.year, spec.glut ? Number(spec.glut.open.slice(0, 4)) : spec.year, "and the glut agrees with it");
});
