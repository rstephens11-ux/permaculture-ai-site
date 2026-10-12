// api/plan-spec.mjs — builds the plan: which crops, how many, in what beds, which labels, which steps,
// and the prompt the image model gets.
//
// Why this exists instead of an LLM: the numbered labels on the drawing and the written steps must agree.
// If a text model wrote the steps and an image model drew the labels they would drift apart. Here the
// label list is fixed first and handed to the image model, so step (1) is always what (1) points at. The
// text is deterministic, sourced from api/crops.json, and cannot invent a canning time.
//
// What decides the crop list now (this is what the zip code buys):
//   * the local frost-free season, from NOAA normals via frost/lookup.mjs — a 115-day season in the
//     Rockies does not get the same plan as a 180-day season in Virginia
//   * how much sun they say they have
//   * what they're growing in — raised beds get counts per 4x8 bed, a plot gets row feet
// Favourites are chosen to SPREAD the harvest, not to cluster it: a plan whose crops all land in the same
// fortnight is exactly the problem this site exists to solve.

import { crops, cropById, windowsFor, glutWindow, frostFor } from "./harvest.mjs";

const STANDARD_BED = { type: "raised", count: 1, width_ft: 4, length_ft: 8 };
const CONTAINER_OK = new Set(["cherry-tomato", "pepper", "lettuce", "kale", "swiss-chard", "bush-bean"]);

/** How the selection behaves for each answer to "how much sun?". */
function sunAllows(crop, sun) {
  if (sun === "shade") return crop.shade === "part";
  return true; // full and part sun can both take any of these crops
}

function sunPenalty(crop, sun) {
  if (sun === "part" && crop.shade !== "part") return "wants full sun — expect less fruit and slower growth";
  return null;
}

/**
 * The year the whole plan is for — decided ONCE, not per crop.
 *
 * Per-crop roll-forward was a real bug: in October, crops whose window had already closed rolled into next
 * year while a late crop stayed in this one, so the headline read "everything you planted lands between
 * October 2026 and August 2027". A plan is one season. If this season is essentially over, the plan is for
 * the next one — for every crop in it.
 */
export function planYearFor(frost) {
  const year = new Date().getUTCFullYear();
  if (!frost || !frost.known) return year;
  const [fm, fd] = frost.last_spring_freeze.split("/").map(Number);
  const seasonStart = Date.UTC(year, fm - 1, fd);
  const midSeason = seasonStart + 120 * 86400000;
  return Date.now() > midSeason ? year + 1 : year;
}

/**
 * @param {{zip?: string, sun?: string, beds?: object, frost?: object, year?: number}} opts
 */
export function buildPlan(opts = {}) {
  const sun = opts.sun || "full";
  const beds = { ...STANDARD_BED, ...(opts.beds || {}) };
  const frost = opts.frost || frostFor(opts.zip);
  const season = frost.known ? frost.frost_free_days : null;
  const year = opts.year || planYearFor(frost);          // one season for the whole plan
  const scope = { ...opts, frost, year };

  // --- candidates -------------------------------------------------------------------------------
  const all = crops().filter((c) => sunAllows(c, sun));
  const withWindows = windowsFor(all.map((c) => c.id), scope);
  const info = Object.fromEntries(withWindows.map((w) => [w.crop, w]));

  const fitRank = (c) => (info[c.id]?.fit === "good" ? 0 : info[c.id]?.fit === "stretch" ? 1 : 2);
  const ordered = all.slice().sort((a, b) => {
    const f = fitRank(a) - fitRank(b);
    if (f !== 0) return f;
    return (info[a.id]?.window_open || "").localeCompare(info[b.id]?.window_open || "");
  });

  // --- selection --------------------------------------------------------------------------------
  const chosen = [];
  const notes = [];

  // The glut crop earns its place if it fits: tomatoes are why the preservation plan exists.
  const tomato = info["tomato"]?.fit === "good" ? cropById("tomato") : null;
  if (tomato) chosen.push(tomato);

  const inSeason = ordered.filter((c) => c.season !== "overwinter" && c.season !== "perennial"
    && !chosen.includes(c));
  const good = inSeason.filter((c) => info[c.id]?.fit === "good");

  // Spread across the season: pick from across the ordered list rather than the first five.
  const target = 5;
  const pool = good.length >= 3 ? good : inSeason;
  const stride = Math.max(1, Math.floor(pool.length / Math.max(1, target - chosen.length)));
  for (let i = 0; i < pool.length && chosen.length < target; i += stride) {
    if (!chosen.includes(pool[i])) chosen.push(pool[i]);
  }
  for (const c of pool) { // backfill if the stride left gaps
    if (chosen.length >= target) break;
    if (!chosen.includes(c)) chosen.push(c);
  }

  const stretchCount = chosen.filter((c) => info[c.id]?.fit === "stretch").length;
  if (stretchCount) {
    notes.push(`${stretchCount} of these are a stretch in your season (about ${season} frost-free days) — start those inside, or use a shorter-season variety.`);
  }
  const sunNote = chosen.map((c) => sunPenalty(c, sun)).filter(Boolean);
  if (sunNote.length) notes.push(`With part-day sun: ${sunNote.length} of these would prefer more — you'll still get a crop, just less of it.`);
  if (sun === "shade") {
    notes.push("Deep shade grows leaves and not much else. Nothing here claims to fruit in shade, so the list is short and leafy on purpose.");
  }
  if (!frost.known) {
    notes.push("We don't have a frost record for that zip, so nothing here is filtered by your season — check your own last-frost date.");
  }

  // Garlic is the calendar anchor and gets its own line, planted in the fall for next July.
  const garlic = cropById("garlic");
  const includeGarlic = beds.type !== "containers";
  const ids = chosen.map((c) => c.id).concat(includeGarlic ? ["garlic"] : []);

  // --- bed plan ---------------------------------------------------------------------------------
  const bedPlan = chosen.map((c) => {
    let count = c.planting.per_4x8;
    let unit = c.planting.unit;
    if (beds.type === "containers") {
      count = unit === "plants" ? Math.max(1, Math.min(count, 2)) : 2;
      unit = "plants";
    } else if (beds.type === "ground") {
      count = Math.round(count * 1.5);           // a plot takes more of the same crop than one bed
    }
    if (beds.type !== "containers" && beds.count > 1) count = count * beds.count;
    return {
      crop: c.id, name: c.name, count, unit,
      spacing: c.planting.note,
      print: unit === "row_feet" ? `${count} row-feet` : `${count} plant${count === 1 ? "" : "s"}`
    };
  });

  const bedWord = beds.type === "containers" ? "containers" : beds.type === "ground" ? "plot" : "bed";
  const bedPhrase = beds.type === "containers"
    ? "in containers"
    : beds.count > 1 ? `across ${beds.count} four-by-eight beds` : `in one four-by-eight ${bedWord}`;

  // --- labels + steps ---------------------------------------------------------------------------
  const labels = chosen.map((c, i) => ({ n: i + 1, crop: c.id, text: c.label }));
  const byId = Object.fromEntries(chosen.map((c) => [c.id, c]));

  const plantLines = bedPlan
    .map((b, i) => `(${i + 1}) ${b.name}: ${b.print} — ${b.spacing}`)
    .join(". ");

  const needsBuild = chosen.filter((c) => ["tomato", "cherry-tomato", "cucumber", "pea"].includes(c.id));
  const succession = chosen.filter((c) => c.succession_days > 0);
  const glutCrop = chosen.find((c) => c.id === "tomato" || c.id === "zucchini") || chosen[chosen.length - 1];
  const thirstiest = chosen.slice().sort((a, b) => b.days_to_maturity[1] - a.days_to_maturity[1])[0];
  const leafy = chosen.find((c) => c.kind === "leaf");

  const steps = [
    {
      category: "PLANT",
      description: `Mark it out ${bedPhrase}. ${plantLines}.`,
      plantVarieties: chosen.map((c) => c.name),
      companionPlants: [...new Set(chosen.flatMap((c) => c.companions.slice(0, 2)))],
      wateringNeeds: thirstiest.watering
    },
    {
      category: "SOIL",
      description: "Sheet-mulch the paths and any new ground this fall — cardboard, then compost, then whatever the town will give you. Skip the tiller; the worms do the work.",
      plantVarieties: [],
      companionPlants: [],
      wateringNeeds: ""
    },
    {
      category: "WATER",
      description: `One soaker line down the middle of the ${byId[chosen[0].id].label}. Deep and infrequent beats a daily sprinkle. ${thirstiest.watering}`,
      plantVarieties: [],
      companionPlants: [],
      wateringNeeds: thirstiest.watering
    },
    {
      category: "BUILD",
      description: needsBuild.length
        ? `Support before you plant, not after: ${needsBuild.map((c) => c.name.toLowerCase()).join(" and ")} need stakes, cages or a trellis on day one.${leafy ? ` Then a cold frame at one end for the ${leafy.name.toLowerCase()} — hinge it south, reuse a storm window.` : ""}`
        : `A cold frame at one end${leafy ? ` for the ${leafy.name.toLowerCase()}` : ""} — hinge it south, reuse a storm window.`,
      plantVarieties: [],
      companionPlants: [],
      wateringNeeds: ""
    },
    {
      category: "HARVEST",
      description: succession.length
        ? `Sow the ${succession[0].name.toLowerCase()} every ${succession[0].succession_days} days from a week after last frost — that stagger is what keeps one impossible week from eating the whole harvest.`
        : `Pick ${glutCrop.name.toLowerCase()} every second day once it starts. The glut is a window, not a day, and it arrives faster than it looks.`,
      plantVarieties: [],
      companionPlants: [],
      wateringNeeds: byId[chosen[0].id].watering
    }
  ];

  // --- the prompt -------------------------------------------------------------------------------
  // Hardened after the first real render came back as a redraw: empty beds sprouted tomatoes, a
  // neighbour's house appeared and the labels drifted. The instruction to ADD NOTHING is the important
  // one, and it is paired with a lower denoise in the engine.
  const prompt = [
    "Draw a plan on top of this photograph of a garden.",
    "The beds and ground in the photograph are EMPTY. They stay empty.",
    "Add nothing that is not already in the photograph: no new plants, no vegetables, no animals, no people, no houses, no sheds, no fences.",
    "Keep the fence, the trees, the buildings, the paths and the horizon exactly where they are, in the same light and the same colours.",
    "On top of that, draw simple flat shapes with thick friendly outlines in muted garden colours — greens, terracotta, cream — showing where each bed will go and the path and water line between them.",
    "Put white circular numbered labels on the drawing, with a thin leader line from each number to the bed it names:",
    labels.map((l) => `(${l.n}) ${l.text}`).join(", ") + ".",
    "No words anywhere in the image, only the numbers. Do not put plants in the beds."
  ].join(" ");

  return {
    crops: ids,
    labels,
    steps,
    bed_plan: bedPlan,
    beds,
    sun,
    frost,
    year,
    harvest_window: windowsFor(ids, scope),
    glut: glutWindow(ids, scope),
    notes,
    prompt
  };
}
