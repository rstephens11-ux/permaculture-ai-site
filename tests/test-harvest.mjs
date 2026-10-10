// tests/test-harvest.mjs — the hinge: crops in, windows out, and an honest label when we don't know.
import test from "node:test";
import assert from "node:assert/strict";
import { windowFor, windowsFor, glutWindow, lastFrostFromZip, crops, FROST_UNKNOWN } from "../api/harvest.mjs";

test("every crop row is sourced and carries the fields the plan needs", () => {
  const rows = crops();
  assert.ok(rows.length >= 15, "the table has real breadth");
  for (const c of rows) {
    assert.ok(c.id && c.name && c.label, `${c.id} has identity`);
    assert.ok(Array.isArray(c.days_to_maturity) && c.days_to_maturity.length === 2, `${c.id} has a range`);
    assert.ok(c.days_to_maturity[0] < c.days_to_maturity[1], `${c.id} range is ordered`);
    assert.ok(typeof c.source === "string" && c.source.length > 20, `${c.id} cites a source`);
    assert.ok(c.method_notes && c.method_notes.length > 20, `${c.id} explains its method`);
    assert.ok(!/\b\d+\s*(minutes|psi|°|degrees)/i.test(c.method_notes),
      `${c.id} must not carry a processing time — those live in the USDA/NCHFP guide`);
  }
});

test("a known crop in a known zip yields a dated window with a confidence label", () => {
  const w = windowFor("tomato", { zip: "04578", year: 2027 });
  assert.equal(w.known, true);
  assert.match(w.window_open, /^2027-\d\d-\d\d$/);
  assert.ok(w.window_open < w.window_close, "the window has width — a glut is a window, not a day");
  assert.equal(w.confidence, "estimate");
  assert.ok(w.source, "and it still carries its source");
});

test("garlic, which is planted in the fall for next summer, lands later than the tomatoes", () => {
  const t = windowFor("tomato", { zip: "04578", year: 2027 });
  const g = windowFor("garlic", { zip: "04578", year: 2027 });
  assert.ok(g.window_open > t.window_open, "garlic comes off after the tomatoes");
});

test("a season that has already passed rolls the whole plan forward, not into the past", () => {
  const thisYear = new Date().getUTCFullYear();
  const w = windowFor("tomato", { zip: "04578" });
  const closed = windowFor("tomato", { zip: "04578", year: thisYear });
  if (closed.window_close < new Date().toISOString().slice(0, 10)) {
    assert.equal(w.year, thisYear + 1, "the window has closed, so the plan is for next year");
  }
  assert.ok(w.window_close >= new Date().toISOString().slice(0, 10), "never hands back a past date");
});

test("the headline glut window excludes the overwinter crop, which gets its own line", () => {
  const g = glutWindow(["tomato", "bush-bean", "garlic"], { zip: "04578", year: 2027 });
  assert.equal(g.crops, 2, "tomato and beans are the season; garlic is not");
  assert.equal(g.next_season.length, 1);
  assert.equal(g.next_season[0].name, "Garlic");
  assert.ok(g.next_season[0].window_open > g.close, "and it lands after the season has ended");
});

test("the glut window is the earliest opening to the latest closing", () => {
  const g = glutWindow(["tomato", "bush-bean", "zucchini"], { zip: "04578", year: 2027 });
  assert.ok(g.open && g.close, "a real window");
  assert.ok(g.open <= g.close);
  assert.equal(g.crops, 3);
});

test("an unknown crop is labelled unknown, never guessed", () => {
  const w = windowFor("rutabaga-we-never-heard-of", { zip: "04578" });
  assert.equal(w.known, false);
  assert.equal(w.window_open, null);
  assert.equal(w.confidence, "unknown");
});

test("an unknown zip refuses to invent a frost date", () => {
  const f = lastFrostFromZip("90210");
  assert.equal(f.month_day, null);
  assert.match(f.note, /confirm your own frost dates/i);
  const w = windowFor("tomato", { zip: "90210" });
  assert.equal(w.known, false);
  assert.equal(w.note, FROST_UNKNOWN);
});

test("a supplied frost date works without a zip at all", () => {
  const ws = windowsFor(["pea", "tomato"], { lastFrostMonthDay: "05-20", year: 2027 });
  assert.equal(ws.length, 2);
  assert.ok(ws.every((w) => w.known), "both resolve from the frost date alone");
});
