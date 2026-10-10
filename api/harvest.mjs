// api/harvest.mjs — turns "what you planted" into "when it lands".
//
// This is the hinge the whole site hangs on: the free tool knows the crops, so it can say when the
// glut arrives, and that window is what The Preservation Run sells a plan for.
//
// Sourcing rule (AGENTS.md): days-to-maturity come from api/crops.json, which carries a source per
// row. This file does no guessing — an unknown crop comes back labelled `unknown`, and a frost date
// we cannot look up comes back as an explicit estimate string.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

let TABLE = null;
export function crops() {
  if (!TABLE) TABLE = JSON.parse(readFileSync(join(HERE, "crops.json"), "utf8")).crops;
  return TABLE;
}

export function cropById(id) {
  return crops().find((c) => c.id === id) || null;
}

// A deliberately small, documented lookup. It covers the Northeast, which is where this site starts,
// and returns null everywhere else rather than inventing a date for a place we don't know.
// Figures are the usual last-frost windows for those zones as published by extension services.
const ZIP_PREFIX_FROST = {
  // Maine
  "039": "05-20", "040": "05-20", "041": "05-20", "042": "05-25", "043": "05-25",
  "044": "05-25", "045": "05-25", "046": "05-30", "047": "05-30", "048": "05-30",
  "049": "05-30",
  // New Hampshire / Vermont
  "030": "05-20", "031": "05-20", "032": "05-20", "033": "05-20",
  "050": "05-20", "051": "05-20", "052": "05-25", "053": "05-25", "054": "05-25",
  "056": "05-20", "057": "05-25", "058": "05-25", "059": "05-25",
  // Massachusetts / Rhode Island / Connecticut
  "010": "05-10", "011": "05-10", "012": "05-15", "013": "05-15", "014": "05-15",
  "015": "05-15", "016": "05-15", "017": "05-15", "018": "05-15", "019": "05-15",
  "020": "05-10", "021": "05-10", "022": "05-10", "023": "05-15", "024": "05-10",
  "025": "05-10", "026": "05-10", "027": "05-10",
  "028": "05-15", "029": "05-15", "060": "05-15", "061": "05-15", "062": "05-15",
  "063": "05-15", "064": "05-15", "065": "05-15", "066": "05-15", "067": "05-15",
  "068": "05-15", "069": "05-15"
};

export const FROST_UNKNOWN = "estimate — confirm your own frost dates";

/**
 * @returns {{date: string|null, month_day: string, note: string, source: string}}
 */
export function lastFrostFromZip(zip) {
  const z = String(zip || "").replace(/\D/g, "").slice(0, 5);
  if (z.length < 5) return { date: null, month_day: null, note: FROST_UNKNOWN, source: "none" };
  const md = ZIP_PREFIX_FROST[z.slice(0, 3)];
  if (!md) {
    return {
      date: null, month_day: null,
      note: "we don't have a frost estimate for that zip — confirm your own frost dates",
      source: "none"
    };
  }
  return {
    date: null, month_day: md,
    note: "typical last-frost window for this area; confirm your own",
    source: "extension-service last-frost guidance for the Northeast"
  };
}

function ymd(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Where in the season a crop gets planted, relative to last frost (days, negative = before). */
const PLANT_OFFSET = {
  spring: 0,
  cool: 7,
  summer: 14,
  fall: 90,
  overwinter: 150 // garlic: planted in October for next July
};

/**
 * @param {string} cropId
 * @param {{zip?: string, lastFrostMonthDay?: string, year?: number}} opts
 * @returns {object} one window, always with an explicit confidence label
 */
export function windowFor(cropId, opts = {}) {
  const crop = cropById(cropId);
  if (!crop) {
    return { crop: cropId, known: false, window_open: null, window_close: null, confidence: "unknown" };
  }
  const md = opts.lastFrostMonthDay || lastFrostFromZip(opts.zip).month_day;
  if (!md) {
    return {
      crop: crop.id, name: crop.name, known: false,
      window_open: null, window_close: null,
      confidence: "unknown", note: FROST_UNKNOWN
    };
  }
  const [fm, fd] = md.split("-").map(Number);

  const compute = (year) => {
    const frost = new Date(Date.UTC(year, fm - 1, fd));
    const offset = PLANT_OFFSET[crop.season] ?? 14;
    const planted = new Date(frost.getTime() + offset * 86400000);
    return {
      planted,
      open: new Date(planted.getTime() + crop.days_to_maturity[0] * 86400000),
      close: new Date(planted.getTime() + crop.days_to_maturity[1] * 86400000)
    };
  };

  // An explicit year is an explicit instruction — never roll it. Otherwise: if this season's window
  // has already closed, the plan is for next year, because there is no point telling someone in
  // October to harvest tomatoes in August.
  let year = opts.year || new Date().getUTCFullYear();
  let w = compute(year);
  if (!opts.year && w.close.getTime() < Date.now()) {
    year += 1;
    w = compute(year);
  }

  return {
    crop: crop.id,
    name: crop.name,
    known: true,
    season: crop.season,
    year,
    plant_estimate: ymd(w.planted),
    window_open: ymd(w.open),
    window_close: ymd(w.close),
    confidence: "estimate",
    note: `${crop.days_to_maturity[0]}–${crop.days_to_maturity[1]} days from planting; variety and season move it`,
    source: crop.source
  };
}

export function windowsFor(cropIds, opts = {}) {
  const frost = opts.lastFrostMonthDay || lastFrostFromZip(opts.zip).month_day;
  return cropIds.map((id) => windowFor(id, { ...opts, lastFrostMonthDay: frost }));
}

/**
 * The headline window: what lands in the coming growing season.
 * Overwinter crops (garlic) are deliberately excluded from it — they come off almost a year later,
 * and folding them in would turn "your glut is July to October" into a nonsense sentence. They get
 * their own line, because they are their own kind of planning.
 */
export function glutWindow(cropIds, opts = {}) {
  const all = windowsFor(cropIds, opts).filter((w) => w.known);
  const inSeason = all.filter((w) => w.season !== "overwinter");
  const nextSeason = all.filter((w) => w.season === "overwinter");
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
