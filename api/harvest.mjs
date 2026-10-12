// api/harvest.mjs — turns "what you planted" into "when it lands", using the real local season.
//
// This is the hinge the whole site hangs on: the free tool knows the crops, so it can say when the glut
// arrives, and that window is what The Preservation Run sells a plan for.
//
// Frost dates now come from api/frost/lookup.mjs — NOAA's 1991-2020 Climate Normals, nearest station to
// the visitor's zip. The earlier version of this file carried a hand-written table of Northeastern zip
// prefixes; that is gone. A zip code now means something anywhere in the country.
//
// Two things this file will not do: invent a date for a place it cannot look up (it says so), or judge a
// crop's chances from the hardiness zone (a zone is about winter cold, not season length — the frost-free
// day count is the honest measure, and it comes from the same two NOAA fields).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { frostFor } from "./frost/lookup.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

let TABLE = null;
export function crops() {
  if (!TABLE) TABLE = JSON.parse(readFileSync(join(HERE, "crops.json"), "utf8")).crops;
  return TABLE;
}

export function cropById(id) {
  return crops().find((c) => c.id === id) || null;
}

export { frostFor };

/** Crops that are not grown in the season being planned for; they get their own line. */
const OUT_OF_SEASON = new Set(["overwinter", "perennial"]);

function ymd(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Where in the season a crop gets planted, in days relative to the last spring frost. */
const PLANT_OFFSET = {
  spring: 0,
  cool: 7,
  warm: 14,        // the researched rows say warm where the original 21 said summer; same window
  summer: 14,
  fall: 90,
  overwinter: 150, // garlic: planted in October for next July
  perennial: 0
};

function mdToDate(md, year) {
  const [m, d] = md.split("/").map(Number);
  return new Date(Date.UTC(year, m - 1, d));
}

/**
 * One crop's window, with an explicit confidence label and an honest stretch flag.
 *
 * @param {string} cropId
 * @param {{zip?: string, year?: number, frost?: object}} opts
 */
export function windowFor(cropId, opts = {}) {
  const crop = cropById(cropId);
  if (!crop) {
    return { crop: cropId, known: false, window_open: null, window_close: null, confidence: "unknown" };
  }
  const frost = opts.frost || frostFor(opts.zip);
  if (!frost.known) {
    return {
      crop: crop.id, name: crop.name, known: false,
      window_open: null, window_close: null,
      confidence: "unknown",
      note: "we don't have a frost record for that zip — confirm your own last-frost date"
    };
  }

  const compute = (year) => {
    const lastFrost = mdToDate(frost.last_spring_freeze, year);
    const offset = PLANT_OFFSET[crop.season] ?? 14;
    const planted = new Date(lastFrost.getTime() + offset * 86400000);
    return {
      planted,
      open: new Date(planted.getTime() + crop.days_to_maturity[0] * 86400000),
      close: new Date(planted.getTime() + crop.days_to_maturity[1] * 86400000)
    };
  };

  // An explicit year is an explicit instruction — never roll it. Otherwise: if this season's window has
  // already closed, the plan is for next year. Nobody wants to be told in October to harvest in August.
  let year = opts.year || new Date().getUTCFullYear();
  let w = compute(year);
  if (!opts.year && w.close.getTime() < Date.now()) {
    year += 1;
    w = compute(year);
  }

  // Does this crop actually have time to finish where they live? min_frost_free_days is the crop's
  // shortest expected season; frost.frost_free_days is theirs, from NOAA. A long-season tomato in a
  // 110-day season is not impossible — it is a stretch, and it says so.
  const needs = crop.min_frost_free_days || 0;
  const has = frost.frost_free_days || 0;
  const stretch = needs > 0 && has > 0 && needs > has;

  return {
    crop: crop.id,
    name: crop.name,
    known: true,
    season: crop.season,
    year,
    plant_estimate: ymd(w.planted),
    window_open: ymd(w.open),
    window_close: ymd(w.close),
    fit: needs === 0 ? "unknown" : stretch ? "stretch" : "good",
    needs_frost_free_days: needs || null,
    local_frost_free_days: frost.frost_free_days,
    confidence: "estimate",
    note: stretch
      ? `${crop.name} wants about ${needs} frost-free days and your season runs about ${has} — start it inside, or pick a shorter-season variety`
      : `${crop.days_to_maturity[0]}–${crop.days_to_maturity[1]} days from planting; variety and season move it`,
    source: crop.source
  };
}

export function windowsFor(cropIds, opts = {}) {
  const frost = opts.frost || frostFor(opts.zip);
  return cropIds.map((id) => windowFor(id, { ...opts, frost }));
}

/**
 * The headline window: what lands in the coming growing season.
 *
 * Overwinter and perennial crops are deliberately excluded — garlic comes off almost a year later and
 * raspberries do not stop, so folding them in turns "your glut is July to August" into nonsense. They
 * get their own line, because they are their own kind of planning.
 */
export function glutWindow(cropIds, opts = {}) {
  const all = windowsFor(cropIds, opts).filter((w) => w.known);
  const inSeason = all.filter((w) => !OUT_OF_SEASON.has(w.season));
  const nextSeason = all.filter((w) => OUT_OF_SEASON.has(w.season));
  if (!inSeason.length) return null;
  const opens = inSeason.map((w) => w.window_open).sort();
  const closes = inSeason.map((w) => w.window_close).sort();
  return {
    open: opens[0],
    close: closes[closes.length - 1],
    crops: inSeason.length,
    next_season: nextSeason.map((w) => ({
      name: w.name, planted: w.plant_estimate, window_open: w.window_open
    }))
  };
}
