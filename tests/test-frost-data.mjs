// tests/test-frost-data.mjs — the parser's guards, and the shape of the shipped dataset.
//
// These matter more than they look. The NOAA endpoint is fussy in three ways that each fail SILENTLY:
//   * every CSV cell is quoted AND padded, so an un-normalised column lookup finds nothing at all
//   * a station with no normals returns an empty string, not an error
//   * a missing value comes back as -9999.0 — which, taken at face value, is a last-frost date of
//     "negative nine thousand", and would sail into a harvest window looking like data
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBatch } from "../tools/fetch-frost.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIONS = join(HERE, "../api/frost/stations.json");
const LOCATIONS = join(HERE, "../api/frost/zip-locations.csv");

const STATION = [{ id: "USC00050848", lat: 40.0, lon: -105.3 }];

test("quoted and padded cells still resolve to their columns", () => {
  const csv = [
    '"STATION","ANN-CLDD-BASE40","ANN-TMIN-PRBLST-T32FP50","ANN-TMIN-PRBFST-T32FP50"',
    '"USC00050848","  1423","   05/06","   10/05"'
  ].join("\n");
  const rows = parseBatch(csv, STATION);
  assert.equal(rows.length, 1, "one station parsed");
  assert.equal(rows[0].spring_freeze, "05/06", "unquoted, unpadded");
  assert.equal(rows[0].autumn_freeze, "10/05");
  assert.equal(rows[0].id, "USC00050848");
  assert.equal(rows[0].lat, 40.0, "coordinates come from the candidate list, not the CSV");
});

test("the -9999 missing-value sentinel is rejected, never treated as a date", () => {
  const csv = [
    '"STATION","ANN-TMIN-PRBLST-T32FP50","ANN-TMIN-PRBFST-T32FP50"',
    '"USC00050848","  -9999.0","   10/05"'
  ].join("\n");
  assert.equal(parseBatch(csv, STATION).length, 0, "a sentinel is not a date");
});

test("an empty value (a station with no normals) is skipped, not zero-filled", () => {
  const csv = [
    '"STATION","ANN-TMIN-PRBLST-T32FP50","ANN-TMIN-PRBFST-T32FP50"',
    '"USC00050848","",""'
  ].join("\n");
  assert.equal(parseBatch(csv, STATION).length, 0);
});

test("a station we did not ask for cannot sneak in", () => {
  const csv = [
    '"STATION","ANN-TMIN-PRBLST-T32FP50","ANN-TMIN-PRBFST-T32FP50"',
    '"USW00099999","05/06","10/05"'
  ].join("\n");
  assert.equal(parseBatch(csv, STATION).length, 0, "only candidates we requested are kept");
});

test("changed field names fail loudly rather than shipping empty data", () => {
  const csv = '"STATION","SOMETHING-ELSE","AND-ANOTHER"\n"USC00050848","1","2"';
  assert.throws(() => parseBatch(csv, STATION), /missing expected columns/);
});

test("the shipped dataset is sane: every date is MM/DD, every station has coordinates", () => {
  if (!existsSync(STATIONS)) {
    console.log("    (skipped: run tools/fetch-frost.mjs first)");
    return;
  }
  const raw = JSON.parse(readFileSync(STATIONS, "utf8"));
  assert.ok(raw._source.includes("1991-2020"), "provenance is recorded in the file itself");
  assert.ok(raw.stations.length > 3000, `real coverage (${raw.stations.length} stations)`);
  for (const s of raw.stations) {
    assert.match(s.spring_freeze, /^\d\d\/\d\d$/, `${s.id} spring date`);
    assert.match(s.autumn_freeze, /^\d\d\/\d\d$/, `${s.id} autumn date`);
    assert.ok(Math.abs(s.lat) <= 72 && Math.abs(s.lon) <= 180, `${s.id} has real coordinates`);
    const [, sm, sd] = /(\d\d)\/(\d\d)/.exec(s.spring_freeze);
    assert.ok(Number(sm) >= 1 && Number(sm) <= 12 && Number(sd) >= 1 && Number(sd) <= 31, `${s.id} plausible month/day`);
  }
  assert.ok(!raw.stations.some((s) => s.spring_freeze.startsWith("99")), "no sentinel values survived");
});

test("the ZIP table covers the whole country and names places", () => {
  if (!existsSync(LOCATIONS)) {
    console.log("    (skipped: run tools/build-location.mjs first)");
    return;
  }
  const lines = readFileSync(LOCATIONS, "utf8").split("\n").filter((l) => l.trim());
  assert.ok(lines.length > 35000, `broad coverage (${lines.length - 1} ZIPs)`);
  const byZip = new Map(lines.slice(1).map((l) => [l.slice(0, 5), l]));
  for (const [zip, expect] of [["04578", "Wiscasset, ME"], ["80202", "Denver, CO"], ["33101", "Miami, FL"]]) {
    assert.ok(byZip.get(zip), `${zip} present`);
    assert.ok(byZip.get(zip).includes(expect), `${zip} is ${expect}`);
  }
});
