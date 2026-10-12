// api/permanent.mjs — the plantings that don't take a bed slot.
//
// Twenty-two of the hundred crops are not season crops: asparagus and rhubarb crowns, strawberry and cane
// rows, blueberry bushes, currants, elderberry, and the fruit and nut trees. They are planted once, they
// occupy a position for fifteen years, and they come back whether or not anyone plans for them. Putting
// them in a bed-rotation list would be wrong twice over: they don't rotate, and a tree has no rows.
//
// So they get their own section with their own facts — spacing, years to first crop, the site they need,
// and the year-one discipline that most people skip (strip the flowers the first year, or you get a
// handful of fruit and a stunted plant).
//
// Two rules borrowed from the rest of the engine:
//   * the legal one. Maine prohibits Ribes in the white-pine-blister-rust counties. Same exclusion as
//     plan-spec, applied here so the two can't disagree.
//   * nothing is offered without saying when it is a gamble. Peach, sweet cherry and quince are zone-5b
//     edge crops; they are reported, not recommended.

import { crops } from "./harvest.mjs";

const RIBES = new Set(["red-currant", "black-currant", "gooseberry"]);
const PERMANENT_KINDS = new Set(["berry", "fruit-tree", "perennial"]);

/** Crops whose entry carries the permanent block — the machine-readable half of "not a bed crop". */
function permanentCandidates() {
  return crops().filter((c) => PERMANENT_KINDS.has(c.kind) && c.permanent);
}

const ROLE = {
  "perennial-veg": "the crops that come up before you can work the ground",
  "berry": "the fruit you pick standing up, mostly in year two and three",
  "tree-fruit": "the long game — four to six years before the first real crop",
  "nut": "the longest game, and the most reliable once it starts"
};

function roleOf(c) {
  if (c.kind === "perennial") return "perennial-veg";
  if (c.kind === "berry") return "berry";
  if (c.kind === "fruit-tree") return c.id === "hazelnut" ? "nut" : "tree-fruit";
  return "other";
}

/** The ones that carry a yard on their own. Everything else is offered as an alternative. */
const DEFAULT_PICKS = {
  "perennial-veg": ["asparagus", "rhubarb"],
  "berry": ["strawberry", "raspberry", "highbush-blueberry"],
  "tree-fruit": ["apple", "pear"],
  "nut": ["hazelnut"]
};

/** Zone 5b edge crops: reported with the reason, never picked by default. */
const MARGINAL = new Set(["peach", "sweet-cherry", "quince", "blackberry", "elderberry"]);

/**
 * @param {{known?: boolean, place?: string, frost_free_days?: number}} frost
 * @param {{include?: string[]}} opts  explicit ids to include whatever the defaults say
 */
export function permanentPlan(frost = {}, opts = {}) {
  const inMaine = /,\s*ME\b/i.test(frost.place || "");
  const wanted = new Set(DEFAULT_PICKS["perennial-veg"].concat(DEFAULT_PICKS.berry, DEFAULT_PICKS["tree-fruit"], DEFAULT_PICKS.nut));
  (opts.include || []).forEach((id) => wanted.add(id));

  const all = permanentCandidates();
  const legal = all.filter((c) => !(inMaine && RIBES.has(c.id)));
  const blocked = all.filter((c) => inMaine && RIBES.has(c.id));

  const pick = (c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    role: roleOf(c),
    why: ROLE[roleOf(c)] || "permanent",
    spacing_ft: c.permanent.spacing_ft,
    years_to_crop: c.permanent.years_to_crop,
    height_ft: c.permanent.height_ft,
    life_years: c.permanent.life_years,
    sun: c.permanent.sun,
    ph: c.permanent.ph,
    site: c.permanent.note,
    year_one: /flower|fruit/i.test(c.method_notes || "") ? c.method_notes : null,
    watch_for: c.watch_for,
    source: c.source
  });

  const chosen = legal.filter((c) => wanted.has(c.id)).map(pick);
  const alternatives = legal
    .filter((c) => !wanted.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, role: roleOf(c), marginal: MARGINAL.has(c.id), why: c.permanent.note }));

  const notes = [];
  if (inMaine && blocked.length) {
    notes.push(`${blocked.map((c) => c.name.toLowerCase()).join(", ")} — Maine prohibits growing these in the counties with white pine blister rust, and a zip can't tell us your county. Left out on purpose.`);
  }
  if (!frost.known) {
    notes.push("No local frost record, so nothing here is checked against your season. Perennials live through your winters, not your summers — ask a neighbour or your extension office what survives in your particular spot.");
  }
  const marginal = alternatives.filter((a) => a.marginal);
  if (marginal.length) {
    notes.push(`Possible but a gamble this far north: ${marginal.map((m) => m.name.toLowerCase()).join(", ")}. Hardiest varieties only, and the most sheltered spot you have.`);
  }

  return {
    plantings: chosen,
    alternatives,
    roles: ROLE,
    notes,
    count: chosen.length,
    // the discipline nobody does, and the reason year two disappoints
    year_one_rule: "Nothing fruits in year one. Strip the flowers and the first fruit off, and put that year into roots and canes instead — it is the difference between a plant that crops for fifteen years and one that limps for five."
  };
}
