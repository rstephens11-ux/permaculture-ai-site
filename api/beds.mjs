// api/beds.mjs — bed geometry, plant counts, and rotation.
//
// Two geometries, because people come with one or the other:
//
//   coleman_30 — Eliot Coleman's system at Four Season Farm: 30-inch-wide beds with 12-inch paths,
//                worked entirely from the path. Narrow on purpose: you can reach the middle from either
//                side, so you never stand on the soil you are growing in. This is the default here.
//   box_4x8    — the four-by-eight raised box, which is what most people already own or can buy.
//
// A crop's count in each geometry comes from the crop table: `planting.per_4x8` for boxes, and
// `bed30.rows` + `bed30.in_row_in` for 30-inch beds. Rotations are by botanical family, which is a fact
// rather than advice — and the planner refuses to spend two of five slots on the same family.

export const GEOMETRIES = {
  coleman_30: {
    id: "coleman_30",
    label: "30-inch beds, 12-inch paths (Coleman's system)",
    short: "30 in beds",
    width_in: 30,
    path_in: 12,
    default_length_ft: 12,
    why: "Worked from the path, never stood on. Narrow enough to reach the middle from either side, which is the whole point — compaction is what costs you yield."
  },
  box_4x8: {
    id: "box_4x8",
    label: "Four-by-eight raised boxes",
    short: "4 × 8 boxes",
    width_in: 48,
    path_in: 24,
    default_length_ft: 8,
    why: "The box most people already own. Wide enough that you will want to kneel on a board rather than step into it."
  },
  ground: {
    id: "ground",
    label: "Rows in an in-ground plot",
    short: "open rows",
    width_in: 30,
    path_in: 18,
    default_length_ft: 25,
    why: "Open rows, in the ground. Same intensive spacing, longer runs, and the paths are what you walk."
  },
  containers: {
    id: "containers",
    label: "Containers on a patio",
    short: "containers",
    width_in: 0,
    path_in: 0,
    default_length_ft: 0,
    why: "Volume and water are the two limits. Big pots, heavy feeding, and never let them dry out."
  }
};

export function familyOf(crop) {
  return crop && crop.family ? crop.family : "unknown";
}

/**
 * How much of this crop one bed holds, in the geometry asked for.
 * Returns BOTH numbers where they exist — plants and row-feet — and the caller reports whichever the
 * crop's own `planting.unit` says is meaningful. (Reporting "12 row-feet of tomato" was a real bug.)
 */
export function countInBed(crop, geometry) {
  const g = GEOMETRIES[geometry] || GEOMETRIES.coleman_30;
  if (g.id === "containers") {
    return { plants: 2, note: "one or two per pot — pots look generous and aren't" };
  }
  if (g.id === "box_4x8") {
    return crop.planting.unit === "plants"
      ? { plants: crop.planting.per_4x8, note: crop.planting.note }
      : { row_feet: crop.planting.per_4x8, note: crop.planting.note };
  }
  // 30-inch beds and open rows share the arithmetic: rows across the width, plants along the length.
  const b = crop.bed30;
  if (!b || !b.rows) {
    return { plants: 0, row_feet: 0, note: crop.planting.note, skip: true };
  }
  const perRow = Math.floor((g.default_length_ft * 12) / b.in_row_in);
  return {
    plants: b.rows * perRow,
    row_feet: b.rows * g.default_length_ft,
    note: b.note
  };
}

/** One printable line: plants for spaced crops, row-feet for drilled ones, with the other as detail. */
export function bedLine(crop, geometry, bedCount = 1) {
  const per = countInBed(crop, geometry);
  const beds = Math.max(1, Number(bedCount) || 1);
  const plants = per.plants != null ? per.plants * beds : null;
  const feet = per.row_feet != null ? per.row_feet * beds : null;
  const spaced = crop.planting.unit === "plants";

  if (spaced && plants != null) {
    return { crop: crop.id, name: crop.name, print: `${plants} plant${plants === 1 ? "" : "s"}`, note: per.note, unit: "plants" };
  }
  if (feet != null) {
    return {
      crop: crop.id,
      name: crop.name,
      print: `${feet} row-feet`,
      detail: plants ? `about ${plants} plants once thinned` : null,
      note: per.note,
      unit: "row_feet"
    };
  }
  return { crop: crop.id, name: crop.name, print: `${plants} plant${plants === 1 ? "" : "s"}`, note: per.note, unit: "plants" };
}

/**
 * Rotation: no family twice in one plan, and a reminder about last year.
 * We cannot know what someone grew last year, so the plan asks rather than assumes.
 */
export function rotationCheck(cropList) {
  const byFamily = new Map();
  for (const c of cropList) {
    const f = familyOf(c);
    if (!byFamily.has(f)) byFamily.set(f, []);
    byFamily.get(f).push(c.name);
  }
  const clashes = [...byFamily.entries()].filter(([, names]) => names.length > 1);
  return {
    families: [...byFamily.keys()],
    clashes: clashes.map(([family, names]) => ({ family, names })),
    clean: clashes.length === 0
  };
}
