// tools/build-location.mjs — build the ZIP -> location + hardiness zone table.
//
//   node tools/build-location.mjs
//
// Inputs (cached in out/frost-cache/, downloaded if missing):
//   phzm-all.csv   PRISM's USDA plant-hardiness-zone bulk file, via phzmapi.org (zip, zone, temp range, lat, lon)
//   zipll.csv      ZIP -> city/state/lat/lon (the frostline dataset, itself built from public ZIP location data)
//
// Output: api/frost/zip-locations.csv  ->  zip,lat,lon,zone,city,state
//
// Note on the zone: it is the PRISM-derived plant hardiness zone, which is NOT the official USDA map and
// is one revision behind it in places. It is used as a friendly label only. Every date in this site comes
// from the NOAA normals in stations.json — the zone never decides a frost date, because a hardiness zone
// is about how cold winter gets, not when spring frosts stop.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, "out/frost-cache");
mkdirSync(CACHE, { recursive: true });

const SOURCES = [
  ["phzm-all.csv", "https://phzmapi.org/all.csv"],
  ["zipll.csv", "https://raw.githubusercontent.com/waldoj/frostline/master/us-zip-code-latitude-and-longitude.csv"]
];

async function cached(name, url) {
  const path = join(CACHE, name);
  if (!existsSync(path)) {
    console.log(`downloading ${name}…`);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    writeFileSync(path, Buffer.from(await r.arrayBuffer()));
  }
  return readFileSync(path, "utf8");
}

function parseCsv(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  const head = lines[0].split(",");
  return { head, rows: lines.slice(1).map((l) => l.split(",")) };
}

async function main() {
  const zones = parseCsv(await cached(...SOURCES[0]));
  const iZip = zones.head.indexOf("zipcode");
  const iZone = zones.head.indexOf("zone");
  const iLat = zones.head.indexOf("latitude");
  const iLon = zones.head.indexOf("longitude");

  // places: zip -> "City, ST"
  const places = new Map();
  const zipll = await cached(...SOURCES[1]);
  for (const line of zipll.replace(/\r/g, "").split("\n").slice(1)) {
    const c = line.split(";");
    if (c.length < 5) continue;
    const zip = c[0].trim();
    const city = c[1].trim();
    const state = c[2].trim();
    if (zip && city && state) places.set(zip, `${city.replace(/"/g, "")}, ${state}`);
  }

  const out = ["zip,lat,lon,zone,place"];
  let kept = 0;
  for (const row of zones.rows) {
    const zip = (row[iZip] || "").trim();
    const lat = Number(row[iLat]);
    const lon = Number(row[iLon]);
    const zone = (row[iZone] || "").trim();
    if (!/^\d{5}$/.test(zip) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const place = (places.get(zip) || "").replace(/"/g, "");
    out.push(`${zip},${lat.toFixed(3)},${lon.toFixed(3)},${zone},"${place}"`);
    kept++;
  }

  mkdirSync(join(ROOT, "api/frost"), { recursive: true });
  writeFileSync(join(ROOT, "api/frost/zip-locations.csv"), out.join("\n") + "\n");
  console.log(`wrote api/frost/zip-locations.csv — ${kept} ZIP codes`);
  console.log(`places resolved for ${places.size} ZIPs; gaps fall back to "your area"`);
  const sample = ["04578", "04901", "10001", "80202", "33101"].map((z) => out.find((l) => l.startsWith(z + ",")) || `${z},(missing)`);
  sample.forEach((s) => console.log(`  ${s}`));
}

main().catch((err) => { console.error("FAILED:", err.message); process.exit(1); });
