// api/plan-spec.mjs — assembles the plan: which crops, how many of each in what geometry, the phased
// season plan, and the prompt the image model gets.
//
// Division of labour, and it matters:
//   * the PLAN TEXT is ours — deterministic, sourced from api/crops.json, built by api/phases.mjs. It
//     cannot invent a canning time or a frost date, and every count comes from the crop table.
//   * the DRAWING is the model's — and it is now an ILLUSTRATION, not the plan. It used to be asked to
//     place the numbered labels, which it never did reliably (three measured renders, see BLOCKERS.md),
//     so the numbers live in the text where we control them and the image just shows the ground.
//
// What decides the crop list: the local frost-free season from NOAA (zip), the sun they have, the
// geometry they'll plant in, and ROTATION — five slots do not get spent on two members of one family.

import { crops, cropById, windowsFor, glutWindow, frostFor } from "./harvest.mjs";
import { GEOMETRIES, bedLine, familyOf, rotationCheck } from "./beds.mjs";
import { assignBeds, planDiagram } from "./layout.mjs";
import { permanentPlan } from "./permanent.mjs";
import { buildPhases } from "./phases.mjs";

const CONTAINER_OK = new Set(["cherry-tomato", "pepper", "lettuce", "kale", "swiss-chard", "spinach", "bush-bean"]);

function sunAllows(crop, sun, geometry) {
  if (geometry === "containers" && !CONTAINER_OK.has(crop.id)) return false;
  if (sun === "shade") return crop.shade === "part";
  return true;
}

function sunPenalty(crop, sun) {
  if (sun === "part" && crop.shade !== "part") return "wants full sun — expect less fruit and slower growth";
  return null;
}

/**
 * The year the whole plan is for — decided ONCE, not per crop.
 * Per-crop roll-forward was a real bug: in October, crops whose window had closed rolled to next year
 * while a late crop stayed in this one, and the headline read "everything lands between October 2026 and
 * August 2027". A plan is one season.
 */
export function planYearFor(frost) {
  const year = new Date().getUTCFullYear();
  if (!frost || !frost.known) return year;
  const [fm, fd] = frost.last_spring_freeze.split("/").map(Number);
  const seasonStart = Date.UTC(year, fm - 1, fd);
  return Date.now() > seasonStart + 120 * 86400000 ? year + 1 : year;
}

/** "unsure" is a real answer and is handled rather than punished. */
function resolveGeometry(beds, notes) {
  const asked = beds.geometry || beds.type;
  if (asked && GEOMETRIES[asked]) return asked;
  notes.push(`Beds: assuming ${GEOMETRIES.coleman_30.short} with 12-inch paths between them, which is Coleman's system and the one this plan is built around. If you already have 4×8 boxes, every count below changes — say so and it will be redone.`);
  return "coleman_30";
}

/**
 * @param {{zip?: string, sun?: string, beds?: object, existing?: string, frost?: object, year?: number}} opts
 */
export function buildPlan(opts = {}) {
  const notes = [];
  const sun = opts.sun && opts.sun !== "unsure" ? opts.sun : "full";
  if (!opts.sun || opts.sun === "unsure") notes.push("Sun: assuming a full-sun site (six hours or more). Anything less and the fruiting crops below will give you less — say so and the list changes.");

  const beds = opts.beds || {};
  const geometry = resolveGeometry(beds, notes);
  const bedCount = Number(beds.count) > 0 ? Number(beds.count) : 1;
  if (!(Number(beds.count) > 0)) notes.push("Bed count: planning for a single bed. Cloudy on how many you have? Say a number and every quantity scales with it.");

  const existing = opts.existing === "have" ? "have" : opts.existing === "no" ? "no" : "unsure";
  const frost = opts.frost || frostFor(opts.zip);
  const season = frost.known ? frost.frost_free_days : null;
  const year = opts.year || planYearFor(frost);
  const scope = { ...opts, frost, year };

  // --- candidates -------------------------------------------------------------------------------
  // Legal rather than horticultural, and it belongs here rather than in a data file's notes: Maine
  // prohibits currants and gooseberries in the counties with white pine blister rust (Lincoln County,
  // where this was built, is one). We have no county lookup, so the whole state is excluded and the plan
  // says why. Over-broad is the safe side of a legal restriction.
  const RIBES = new Set(["red-currant", "black-currant", "gooseberry"]);
  const inMaine = /,\s*ME\b/i.test((frost && frost.place) || "");
  const blocked = (c) => inMaine && RIBES.has(c.id);
  const all = crops().filter((c) => sunAllows(c, sun, geometry) && !blocked(c));
  if (inMaine && crops().some((c) => RIBES.has(c.id))) {
    notes.push("Currants and gooseberries are left out on purpose: Maine prohibits growing them in counties with white pine blister rust, and we can't tell which county you're in from a zip alone. Check with your extension office if you're elsewhere in the state.");
  }
  const withWindows = windowsFor(all.map((c) => c.id), scope);
  const info = Object.fromEntries(withWindows.map((w) => [w.crop, w]));
  const fitRank = (c) => (info[c.id]?.fit === "good" ? 0 : info[c.id]?.fit === "stretch" ? 1 : 2);
  const ordered = all.slice().sort((a, b) => {
    const f = fitRank(a) - fitRank(b);
    if (f !== 0) return f;
    return (info[a.id]?.window_open || "").localeCompare(info[b.id]?.window_open || "");
  });

  // --- what to grow, in order of what a household actually eats ------------------------------------
  // With 21 crops "take what fits the season" was fine. With 106 in the table it produced an arbitrary
  // five — whatever happened to sort first. So the list is ranked by what fills a plate and a pantry in
  // this climate, and the season filter then decides which of those are actually possible. Ranking is
  // horticultural and culinary, not statistical, and it is meant to be argued with.
  // Garlic leads because the single Allium slot is contested — onion, leek, shallot, scallion and chives
  // all want it — and garlic is the crop the calendar is built around (planted in October, harvested the
  // following July). Everything after it is ranked by what fills a plate.
  const STAPLES = [
    "garlic", "tomato", "potato", "onion", "carrot", "bush-bean", "pea", "lettuce",
    "kale", "zucchini", "winter-squash", "cucumber", "beet", "pepper", "spinach",
    "swiss-chard", "sweet-corn", "pole-bean", "broccoli", "cabbage", "leek", "radish",
    "cherry-tomato", "arugula", "summer-squash", "pumpkin", "turnip", "parsnip", "chard", "mustard-greens"
  ];
  const stapleRank = new Map(STAPLES.map((id, i) => [id, i]));

  // How a SHARED bed is divided. Equal shares is how tomato ended up with 4 ft and 2 plants while the
  // plan called it the glut crop — so the crops people want volume of get a bigger share, and tomato
  // most of all, because it is the one the preservation half of this product exists for.
  const SHARE = new Map([["tomato", 1.8], ["potato", 1.6], ["winter-squash", 1.45], ["sweet-corn", 1.45], ["zucchini", 1.3]]);
  const weightOf = (id) => SHARE.get(id) || (stapleRank.has(id) ? 1.15 : 1);

  // --- selection, with rotation held back from spending two slots on one family -------------------
  const chosen = [];
  const families = new Set();
  const push = (c) => { chosen.push(c); families.add(familyOf(c)); };

  // more beds, more variety — a four-bed garden shouldn't be five crops wide
  const target = Math.max(4, Math.min(8, Math.round(bedCount * 2.5)));
  const available = new Map(ordered.map((c) => [c.id, c]));
  const inSeason = ordered.filter((c) => !["overwinter", "perennial"].includes(c.season));

  const take = (c) => {
    if (!c || chosen.length >= target) return false;
    if (chosen.includes(c) || families.has(familyOf(c))) return false;
    push(c);
    return true;
  };

  // pass 1: the staples, in rank order, as many as the season allows and the family rule permits
  for (const id of STAPLES) take(available.get(id));
  // pass 2: fill the rest with the best seasonal fits, spread across the season so it doesn't all land
  // at once — stride through the list rather than take the first few
  const rest = inSeason.filter((c) => !chosen.includes(c));
  const good = rest.filter((c) => info[c.id]?.fit === "good");
  const pool = good.length >= 3 ? good : rest;
  const stride = Math.max(1, Math.floor(pool.length / Math.max(1, target - chosen.length)));
  pool.filter((_, i) => i % stride === 0).forEach(take);
  pool.forEach(take);

  const stretchCount = chosen.filter((c) => info[c.id]?.fit === "stretch").length;
  if (stretchCount) notes.push(`${stretchCount} of these are a stretch in your season (about ${season} frost-free days) — start those inside, or use a shorter-season variety.`);
  if (sun === "shade") notes.push("Deep shade grows leaves and not much else. Nothing here claims to fruit in shade, so the list is short and leafy on purpose.");
  if (!frost.known) notes.push("We don't have a frost record for that zip, so nothing here is filtered by your season — check your own last-frost date before planting anything tender.");

  // Garlic is the calendar anchor: planted in the fall, harvested the following July, so its planting and
  // harvest both fall outside the season window. It is added here only if the staples pass didn't already
  // pick it — it can now arrive by either path, and adding it blind put TWO garlics in every plan (real
  // bug, caught by reading the bed list rather than by a test).
  const includeGarlic = geometry !== "containers" && !chosen.some((c) => c.id === "garlic");
  const cropList = includeGarlic ? chosen.concat([cropById("garlic")]) : chosen;
  // ids is derived from the same list, so the plan can't quote a crop it doesn't plant
  const ids = cropList.map((c) => c.id);

  // --- counts and layout ------------------------------------------------------------------------
  // The layout is the single source of the numbers: the drawing, the bed-by-bed text and the summary
  // list all read from it, so the picture and the words cannot disagree.
  const rotation = rotationCheck(cropList);
  const layout = assignBeds(cropList, { geometry, bedCount, weightOf });
  // Every crop run gets a NUMBER, in bed order, and that number is what goes on the drawing, in the bed
  // list and in the phase steps. Ryan's ask: "they should label accordingly to the step plans". One
  // running number, assigned here, is the only way the three can't disagree.
  let runNo = 0;
  const bedPlan = layout.beds.map((b) => {
    const numbered = b.segments.map((s) => Object.assign({}, s, { no: ++runNo }));
    return {
      bed: b.n,
      length_ft: b.length_ft,
      text: `Bed ${b.n}: ` + numbered
        .map((s) => `${s.no}. ${s.name} ${s.print}${s.tall ? " (tall — north end)" : ""}`)
        .join(" · then ") + ".",
      segments: numbered.map((s) => ({
        no: s.no, crop: s.crop, name: s.name, family: s.family, print: s.print,
        length_ft: s.length_ft, spacing_in: s.spacing_in, note: s.note, tall: !!s.tall
      }))
    };
  });
  // The crop list is read off the LAYOUT, in bed order, carrying the same numbers as the drawing and the
  // steps. Built from the selection list instead, it silently missed garlic (added after selection as the
  // calendar anchor) and disagreed with the numbering whenever the two orders differed.
  const crop_list = bedPlan.flatMap((b) => b.segments.map((s) => s.crop)).map((id, i) => {
    const c = cropById(id);
    return { no: i + 1, id: c.id, name: c.name, family: familyOf(c), method: c.method, cold: !!c.cold };
  });

  const windows = windowsFor(ids, scope);
  const glut = glutWindow(ids, scope);

  // The plan drawn to scale, from our own numbers. This is the layout picture — the illustration the
  // image model produces is decoration beside it, and is never asked to carry information again.
  const diagram = planDiagram(layout, {
    geometry, place: frost.known ? frost.place : (opts.zip ? "your patch" : "your patch"),
    year, frost, glut, cropList
  });

  // --- the plantings that never enter a bed -----------------------------------------------------
  const permanent = permanentPlan(frost);

  // --- the season plan --------------------------------------------------------------------------
  const phases = buildPhases({
    cropList, geometry, bedCount, existing, frost, year, windows, glut, sun, layout, bedPlan, permanent
  });

  // --- the drawing: an illustration of the ground, with no numbers to get wrong ------------------
  const prompt = [
    "This is a photograph of a real garden. Keep everything in it exactly where it is — the beds, the boxes, the fence, the paths, the trees, the buildings, the horizon, the light and the colours.",
    "Draw over it to show the layout of a planting plan: clean flat shapes marking the bed areas and the paths between them, and a line for the water.",
    "Style: flat illustration, thick friendly outlines, muted garden colours — greens, terracotta, cream.",
    "Do not add plants, vegetables, animals, people, houses, sheds or fences that are not already in the photograph.",
    "Do not put any words or numbers anywhere in the image. No labels, no text."
  ].join(" ");

  return {
    crops: ids,
    crop_list,
    phases,
    bed_plan: bedPlan,
    layout,
    permanent_plantings: permanent,
    diagram_svg: diagram,
    rotation,
    geometry,
    geometry_label: GEOMETRIES[geometry].label,
    geometry_dims: GEOMETRIES[geometry],
    beds: { ...beds, geometry, count: bedCount },
    existing,
    sun,
    frost,
    year,
    season,
    harvest_window: windows,
    glut,
    notes,
    prompt
  };
}
