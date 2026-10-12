// api/frost/lookup.mjs — ZIP code in, real local frost dates out.
//
// Two datasets, both shipped in api/frost/ and both real:
//   zip-locations.csv  zip -> lat/lon/zone/"City, ST"      (see tools/build-location.mjs)
//   stations.json      NOAA/NCEI 1991-2020 normals: the 50%-probability last spring freeze and first
//                      autumn freeze, per weather station      (see tools/fetch-frost.mjs)
//
// A ZIP resolves to its NEAREST station, by great-circle distance. That is the standard approach and it
// is honest about its limits: the result carries the distance to the station, and the UI says it is an
// estimate, because a valley two miles from a hilltop station can differ by two weeks.
//
// What we deliberately do NOT use here: the hardiness zone, for dates. A hardiness zone describes how
// cold winter gets; a frost date describes when spring frosts stop. They correlate and are not the same
// number. The zone is passed through as a friendly label and nothing else.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// The directory the two data files live in. Overridable so tests can point at a small deterministic
// fixture instead of the real 40,000-ZIP tables — read lazily, so setting it after import still applies.
function dataDir() {
  return process.env.PA_FROST_DIR || HERE;
}

const EARTH_MI = 3958.8;

// Past this distance a "nearest station" is not your weather. Say so rather than guess — this is what
// stopped Fairbanks, Alaska from being handed a season invented from a station 1,400 miles away.
const MAX_STATION_MILES = Number(process.env.MAX_STATION_MILES || 120);

function haversineMi(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_MI * Math.asin(Math.sqrt(a));
}

let locations = null;
let stations = null;
let stationsMeta = null;
const zipCache = new Map();

export function loadLocations() {
  if (locations) return locations;
  locations = new Map();
  const path = join(dataDir(), "zip-locations.csv");
  if (!existsSync(path)) return locations;
  const lines = readFileSync(path, "utf8").split("\n");
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    // zip,lat,lon,zone,"City, ST"
    const m = /^(\d{5}),(-?[\d.]+),(-?[\d.]+),([^,]*),"(.*)"$/.exec(line);
    if (!m) continue;
    locations.set(m[1], {
      lat: Number(m[2]), lon: Number(m[3]), zone: m[4], place: m[5]
    });
  }
  return locations;
}

export function loadStations() {
  if (stations) return stations;
  const path = join(dataDir(), "stations.json");
  stations = [];
  if (!existsSync(path)) return stations;
  const raw = JSON.parse(readFileSync(path, "utf8"));
  stationsMeta = { source: raw._source, meaning: raw._meaning, count: raw._count };
  stations = raw.stations;
  return stations;
}

export function stationsSource() {
  loadStations();
  return stationsMeta;
}

function mdToDayOfYear(md) {
  const [m, d] = md.split("/").map(Number);
  const days = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return days[m - 1] + d;
}

/**
 * @param {string} zip
 * @returns {{
 *   known: boolean, zip: string, place: string, zone: string|null,
 *   last_spring_freeze: string|null, first_fall_freeze: string|null,
 *   frost_free_days: number|null, station: string|null, station_miles: number|null,
 *   confidence: string, source: string
 * }}
 */
export function frostFor(zipRaw) {
  const zip = String(zipRaw || "").replace(/\D/g, "").slice(0, 5);
  const unknown = {
    known: false, zip, place: "", zone: null,
    last_spring_freeze: null, first_fall_freeze: null, frost_free_days: null,
    station: null, station_miles: null,
    confidence: "unknown",
    source: "NOAA/NCEI 1991-2020 U.S. Climate Normals (nearest station)"
  };
  if (zip.length !== 5) return unknown;
  if (zipCache.has(zip)) return zipCache.get(zip);

  const loc = loadLocations().get(zip);
  const st = loadStations();
  if (!loc || !st.length) return unknown;

  let best = null;
  let bestD = Infinity;
  for (const s of st) {
    const d = haversineMi(loc.lat, loc.lon, s.lat, s.lon);
    if (d < bestD) { bestD = d; best = s; }
  }
  if (!best) return unknown;

  const spring = mdToDayOfYear(best.spring_freeze);
  const autumn = mdToDayOfYear(best.autumn_freeze);
  // In warm-winter places the freeze season wraps the new year (Miami: last spring freeze Jan 18, first
  // fall freeze Jan 13 — i.e. the FOLLOWING January). A plain subtraction goes negative there, so the
  // season is measured across the year boundary instead.
  const frostFree = autumn > spring ? autumn - spring : 365 - spring + autumn;

  // A station a long way off is worse than no station: Fairbanks once matched a station 1,400 miles away
  // and confidently invented a 218-day season. Past this distance we say we don't know.
  if (bestD > MAX_STATION_MILES) {
    const far = {
      known: false, zip, place: loc.place || "", zone: loc.zone || null,
      last_spring_freeze: null, first_fall_freeze: null, frost_free_days: null,
      station: best.id, station_miles: Math.round(bestD),
      confidence: "unknown",
      source: "NOAA/NCEI 1991-2020 U.S. Climate Normals",
      note: `the nearest station in our records is ${Math.round(bestD)} miles away, which is too far to be your weather`,
      caveat: "confirm your own last-frost date before planting anything tender"
    };
    zipCache.set(zip, far);
    return far;
  }

  const result = {
    known: true,
    zip,
    place: loc.place || "your area",
    zone: loc.zone || null,
    last_spring_freeze: best.spring_freeze,
    first_fall_freeze: best.autumn_freeze,
    frost_free_days: frostFree,
    station: best.id,
    station_miles: Math.round(bestD * 10) / 10,
    confidence: "estimate",
    source: "NOAA/NCEI 1991-2020 U.S. Climate Normals, nearest station (" + best.id + ")",
    caveat: "measured at the nearest weather station, "
      + (bestD < 1 ? "essentially on top of you" : `about ${Math.round(bestD)} miles away`)
      + " — a cold hollow or a hilltop can differ by a week or two"
  };
  zipCache.set(zip, result);
  return result;
}

export function isNortheast(zipRaw) {
  const zip = String(zipRaw || "").replace(/\D/g, "").slice(0, 5);
  return /^(0[1-5]|03|04|05|06)/.test(zip);
}
