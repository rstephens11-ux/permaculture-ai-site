// tools/fetch-frost.mjs — build the real frost-date table from NOAA's 1991-2020 Climate Normals.
//
//   node tools/fetch-frost.mjs
//
// Why this exists: the first version of this site guessed frost dates from a hand-written table of
// Northeastern zip prefixes. That is fine for Maine and useless everywhere else, and Ryan's call is
// that a zip code should actually mean something.
//
// What this does, all of it real data:
//   1. GHCN-Daily inventory -> the stations that actually have TMIN records spanning 1991-2020
//   2. NCEI 1991-2020 normals, 100 stations per request (the API's hard limit), asking for two fields:
//        ANN-TMIN-PRBLST-T32FP50  = the date the chance of a 32F freeze drops below 50% in SPRING
//                                   (this is "the last frost date" everyone quotes)
//        ANN-TMIN-PRBFST-T32FP50  = the same threshold in AUTUMN ("first fall freeze")
//      Those two dates also give the frost-free season length, which is what decides whether a crop
//      will actually ripen somewhere — a better basis for advice than the hardiness zone, which is
//      about winter cold, not season length.
//   3. Writes api/frost/stations.json
//
// Sanity check baked in: Boulder, CO (USC00050848) must come back as 05/06 — the date NOAA itself
// publishes as Boulder's 50%-probability last spring freeze. If it doesn't, the field names have
// changed and the run fails loudly rather than shipping wrong dates.
//
// Then run: node tools/build-zip-frost.mjs   (nearest station per ZIP code)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, "out/frost-cache");
mkdirSync(CACHE, { recursive: true });

const INVENTORY_URL = "https://www.ncei.noaa.gov/pub/data/ghcn/daily/ghcnd-inventory.txt";
const STATIONS_OUT = join(ROOT, "api/frost/stations.json");
// --only-missing: fetch just the stations not already in api/frost/stations.json and merge the result.
// Used to add regions (Alaska, Hawaii, the Caribbean) without re-hitting NOAA for 3,700 stations.
const ONLY_MISSING = process.argv.includes("--only-missing");
const NORMALS = "https://www.ncei.noaa.gov/access/services/data/v1"
  + "?dataset=normals-annualseasonal-1991-2020&format=csv&startDate=2010-01-01&endDate=2010-12-31"
  + "&units=standard&stations=";
const SPRING = "ANN-TMIN-PRBLST-T32FP50";
const AUTUMN = "ANN-TMIN-PRBFST-T32FP50";
const BATCH = 100; // the API's documented maximum

async function inventory() {
  const path = join(CACHE, "ghcnd-inventory.txt");
  if (!existsSync(path)) {
    console.log("downloading the GHCN-Daily inventory (~36 MB, once)…");
    const r = await fetch(INVENTORY_URL);
    if (!r.ok) throw new Error(`inventory: HTTP ${r.status}`);
    writeFileSync(path, Buffer.from(await r.arrayBuffer()));
  }
  const already = new Set();
  if (ONLY_MISSING && existsSync(STATIONS_OUT)) {
    try {
      const prior = JSON.parse(readFileSync(STATIONS_OUT, "utf8"));
      (prior.stations || []).forEach((s) => already.add(s.id));
      console.log(`skipping ${already.size} stations already fetched`);
    } catch { /* start over */ }
  }
  const candidates = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const sid = line.slice(0, 11).trim();
    if (!sid.startsWith("USC") && !sid.startsWith("USW")) continue;
    const lat = Number(line.slice(12, 20));
    const lon = Number(line.slice(21, 30));
    const element = line.slice(31, 35).trim();
    const first = Number(line.slice(36, 40));
    const last = Number(line.slice(41, 45));
    if (element !== "TMIN") continue;
    // Regions covered: the lower 48, plus Alaska, Hawaii, Puerto Rico and the US Virgin Islands. Each is
    // a real box, so a Hawaii ZIP cannot end up matched to a station in Oregon.
    const inLower48 = lat > 24 && lat < 50 && lon > -125 && lon < -66;
    const inAlaska = lat >= 51 && lat < 72 && lon > -180 && lon < -129;
    const inHawaii = lat > 18 && lat < 23 && lon > -161 && lon < -154;
    const inCaribbean = lat > 17 && lat < 19 && lon > -68 && lon < -64;
    if (!(inLower48 || inAlaska || inHawaii || inCaribbean)) continue;
    if (!(first <= 1991 && last >= 2020)) continue;
    if (already.has(sid)) continue;
    candidates.push({ id: sid, lat, lon });
  }
  return candidates;
}

function clean(cell) {
  // The NCEI CSV export quotes every cell AND pads the values: '"ANN-CLDD-BASE40"', '"   05/06"'.
  // Match on the unquoted, trimmed form or every column lookup silently misses.
  return String(cell || "").replace(/^"|"$/g, "").trim();
}

function parseBatch(csv, stations) {
  const lines = csv.split("\n").filter((l) => l.trim());
  if (!lines.length) return [];
  const head = lines[0].split(",").map(clean);
  const iId = head.indexOf("STATION");
  const iSpring = head.indexOf(SPRING);
  const iAutumn = head.indexOf(AUTUMN);
  if (iId < 0 || iSpring < 0 || iAutumn < 0) {
    throw new Error(`normals response is missing expected columns (got ${head.length}, looked for ${SPRING}); API fields changed`);
  }
  const byId = new Map(stations.map((s) => [s.id, s]));
  const out = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map(clean);
    const id = cells[iId] || "";
    const spring = cells[iSpring] || "";
    const autumn = cells[iAutumn] || "";
    if (!id || !spring || !autumn) continue;          // no normals for this station
    if (!/^\d\d\/\d\d$/.test(spring)) continue;
    const s = byId.get(id);
    if (!s) continue;
    out.push({ id, lat: s.lat, lon: s.lon, spring_freeze: spring, autumn_freeze: autumn });
  }
  return out;
}

/** Fetch one batch; on a failure, halve it and retry, so one bad station id can't silently cost 100 rows. */
async function fetchBatch(batch, depth = 0) {
  try {
    const r = await fetch(NORMALS + batch.map((s) => s.id).join(","));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return parseBatch(await r.text(), batch);
  } catch (err) {
    if (depth >= 3 || batch.length === 1) {
      console.log(`    station ${batch[0].id} could not be fetched (${err.message})`);
      return [];
    }
    const mid = Math.ceil(batch.length / 2);
    const left = await fetchBatch(batch.slice(0, mid), depth + 1);
    const right = await fetchBatch(batch.slice(mid), depth + 1);
    return [...left, ...right];
  }
}

async function main() {
  const prior = ONLY_MISSING && existsSync(STATIONS_OUT)
    ? (JSON.parse(readFileSync(STATIONS_OUT, "utf8")).stations || [])
    : [];

  const candidates = await inventory();
  console.log(`stations to fetch: ${candidates.length}${prior.length ? ` (keeping ${prior.length} already held)` : ""}`);
  console.log(`requests: ${Math.ceil(candidates.length / BATCH)} at ${BATCH}/request`);

  const fetched = [];
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const got = await fetchBatch(batch);
    fetched.push(...got);
    process.stdout.write(`  batch ${String(i / BATCH + 1).padStart(2)}/${Math.ceil(candidates.length / BATCH)}: +${got.length} (new total ${fetched.length})\n`);
    await new Promise((r) => setTimeout(r, 400)); // be a good citizen
  }

  const stations = [...prior, ...fetched];

  const boulder = stations.find((s) => s.id === "USC00050848");
  if (!boulder || boulder.spring_freeze !== "05/06") {
    throw new Error(`sanity check failed: Boulder should read 05/06, got ${boulder ? boulder.spring_freeze : "nothing"}`);
  }

  mkdirSync(join(ROOT, "api/frost"), { recursive: true });
  writeFileSync(STATIONS_OUT, JSON.stringify({
    _source: "NOAA/NCEI U.S. Climate Normals 1991-2020, fields " + SPRING + " and " + AUTUMN
      + " (NOAA National Centers for Environmental Information, retrieved " + new Date().toISOString().slice(0, 10) + ")",
    _meaning: "spring_freeze = date the chance of a 32F freeze drops below 50% (the 'last frost date');"
      + " autumn_freeze = the same threshold in autumn; both MM/DD.",
    _count: stations.length,
    stations
  }, null, 0));

  const lengths = stations.map((s) => {
    const [sm, sd] = s.spring_freeze.split("/").map(Number);
    const [am, ad] = s.autumn_freeze.split("/").map(Number);
    const spring = sm * 30.4 + sd;
    let autumn = am * 30.4 + ad;
    if (autumn <= spring) autumn += 365;      // warm-winter stations wrap the new year
    return autumn - spring;
  }).sort((a, b) => a - b);
  console.log(`\nwrote ${STATIONS_OUT} — ${stations.length} stations`);
  console.log(`frost-free season length: ${Math.round(lengths[0])} to ${Math.round(lengths[lengths.length - 1])} days (median ${Math.round(lengths[Math.floor(lengths.length / 2)])})`);
  console.log("Boulder sanity check: 05/06 ✓");
}

main().catch((err) => { console.error("FAILED:", err.message); process.exit(1); });
