// api/phases.mjs — the season plan, phase by phase.
//
// This is the product. The drawing is decoration; someone acts on these dates and these counts.
//
// The spine is Eliot Coleman (Four Season Farm, Harborside, Maine — zone 5, same climate as Wiscasset):
// 30-inch beds with 12-inch paths worked from the path, transplant-first, succession so a bed is never
// empty and never arrives all at once, rotation by family, half the ground in green manure, and a winter
// harvest out of unheated structures. Where the evidence for a pest technique is thin, it says so —
// see the grades in phase 5, which is the phase most garden advice gets wrong.

import { GEOMETRIES, bedLine, familyOf, rotationCheck } from "./beds.mjs";

/**
 * Ryan said "not sure" on tilling, so the call is made here rather than avoided, and it is made
 * contextually rather than as a philosophy:
 *
 *   no-dig is the default and the goal. A single pass of broadfork or tiller is offered in exactly one
 *   situation — turning lawn or hard-packed ground into beds — because sheet mulch over a hard lawn takes
 *   two years and most people quit before the payoff. What ruins soil is doing it every year, not once.
 *
 * Flip this to "strict_no_dig" to drop the tillage paragraph entirely.
 */
const TILLING_STANCE = process.env.TILLING_STANCE || "one_pass_exception";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86400000;

function userWay(md, year) {
  const [m, d] = String(md).split("/").map(Number);
  return Date.UTC(year, m - 1, d);
}

function fmtDate(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

function minusDays(ms, days) {
  const d = new Date(ms - days * DAY);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function each(ids, fn) {
  return ids.map(fn).filter(Boolean);
}

/**
 * The largest stretch of the season with nothing ready to eat.
 * This is the thing a grocery-list garden never notices and a real one always does.
 */
export function findGap(windows) {
  const spans = windows
    .filter((w) => w.known && w.season !== "overwinter" && w.season !== "perennial")
    .map((w) => [w.window_open, w.window_close])
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (spans.length < 2) return null;
  let gap = null;
  let reach = spans[0][1];
  for (let i = 1; i < spans.length; i++) {
    const [open, close] = spans[i];
    if (open > reach) {
      const days = Math.round((Date.parse(open) - Date.parse(reach)) / DAY);
      if (!gap || days > gap.days) gap = { from: reach, to: open, days };
    }
    if (close > reach) reach = close;
  }
  return gap && gap.days >= 7 ? gap : null;
}

/**
 * @param {{
 *   cropList: object[], geometry: string, bedCount: number, existing: string,
 *   frost: object, year: number, windows: object[], glut: object, sun: string
 * }} opts
 */
export function buildPhases(opts) {
  const {
    cropList = [], geometry = "coleman_30", bedCount = 1, existing = "unsure",
    frost = {}, year = new Date().getUTCFullYear(), windows = [], glut = null, sun = "full",
    layout = null
  } = opts;

  const g = GEOMETRIES[geometry] || GEOMETRIES.coleman_30;
  const lastFrostMs = frost.known ? userWay(frost.last_spring_freeze, year) : null;
  const lastFrost = frost.known ? fmtDate(`${year}-${frost.last_spring_freeze.replace("/", "-")}`) : null;
  const frostLine = lastFrost ? `${lastFrost}` : "your last-frost date";
  // NB: no whole-bed count lines any more. `bedLine` answers "how many if this crop had a bed to
  // itself", and the layout allocates crops *lengths* of a shared bed, so printing both gave two
  // different answers for the same crop. The layout is the authority; its numbers are the ones shown.
  const rotation = rotationCheck(cropList);
  const gap = findGap(windows);
  const byId = Object.fromEntries(cropList.map((c) => [c.id, c]));

  const transplant = cropList.filter((c) => c.method === "transplant" || c.method === "either");
  const directOnly = cropList.filter((c) => c.method === "direct");
  const succession = cropList.filter((c) => c.succession_days > 0);
  const cold = cropList.filter((c) => c.cold);
  const feeders = cropList.filter((c) => ["tomato", "cherry-tomato", "sweet-corn", "winter-squash", "zucchini", "pepper"].includes(c.id));
  const cucurbits = cropList.filter((c) => familyOf(c) === "Cucurbitaceae");

  const phases = [];

  /* ---------------------------------------------------------------- 1. build the beds */
  const buildSteps = [];
  if (g.id === "containers") {
    buildSteps.push({
      text: "Fill the pots with a potting mix, not garden soil — garden soil in a pot sets like concrete and drains badly. Biggest pots you can stand; volume is what buys you a day of missed watering."
    });
    buildSteps.push({ text: "A tray under each pot, and a saucer of gravel under that if the surface stains." });
  } else if (existing === "have") {
    buildSteps.push({
      text: `Your beds are in, so this phase is short: 1–2 inches of compost on top, no digging, no tilling. ${g.why}`
    });
    buildSteps.push({
      text: "Walk the paths, never the beds. If the soil is wet enough to hold your boot print, stay off it entirely — that is the one rule that matters more than any amendment."
    });
  } else {
    if (existing === "unsure") {
      buildSteps.push({
        text: "If your beds are already in the ground, skip straight past this phase — just top-dress with compost and walk the paths, never the beds. Everything below is for ground that isn't broken in yet.",
        tag: "read this first"
      });
    }
    buildSteps.push({
      text: `Mark it out before you dig anything: ${g.short}, ${g.width_in}-inch beds with ${g.path_in}-inch paths between them. ${g.why}`
    });
    buildSteps.push({
      text: "Cheapest and quickest — sheet mulch. Flat cardboard, overlapped generously and soaked, then an inch of compost, then whatever mulch the town or the woods will give you. Plant straight into holes cut in it this season; the bed improves underneath you while you use it.",
      tag: "no dig"
    });
    buildSteps.push({
      text: "If what you have is lawn or hard-packed ground — and only then — one pass with a broadfork, or a single pass of a tiller, to break the pan. Sheet mulch over a hard lawn is a two-year proposition, and most people quit before the payoff. Tilling once to open ground up is a tool. Tilling it every year is what ruins it.",
      tag: "the exception",
      hidden: TILLING_STANCE === "strict_no_dig"
    });
    buildSteps.push({
      text: "If you want to build the bed out of what is already on the property, this is the hugelkultur version, bottom to top:",
      tag: "from the land",
      sub: [
        "Cardboard flat on the ground, overlapped, soaked.",
        "Woody material — branches, rotten logs, sticks, brush — filling the BOTTOM THIRD only. Thickest pieces lowest, gaps packed with smaller stuff. Water each layer as you go.",
        "A sprinkle of native soil or old compost over the wood, as inoculum.",
        "Leaves, straw, grass clippings, garden waste.",
        "2–3 inches of finished compost.",
        "Topsoil or a compost-mix to fill the last few inches."
      ]
    });
    buildSteps.push({
      text: "Two honest caveats on hugelkultur: it sinks as the wood rots, so put anything perennial at the edges and not in the middle; and fresh wood ties up nitrogen for a season, so give the heavy feeders a mid-season top-dress. Do not sow carrots or anything with fine seed into a fresh one — it will not be an even seedbed yet."
    });
  }
  phases.push({
    n: 1,
    key: "beds",
    title: "Build the beds",
    when: existing === "have" ? "now — 10 minutes" : "now, 4–8 weeks before you plant",
    why: "Everything in this plan assumes ground that is ready to take roots.",
    steps: buildSteps
  });

  /* ---------------------------------------------------------------- 2. soil and fertility */
  phases.push({
    n: 2,
    key: "soil",
    title: "Feed the soil, not the plant",
    when: "the same weekend as the beds",
    why: "Fertility you build is fertility you don't buy again next year.",
    steps: [
      { text: "Compost on top, 1–2 inches, once in spring. Do not dig it in — the worms and the frost will take it down for you." },
      {
        text: "Coleman's fertility trick is a rotation, not a bag: at Four Season Farm roughly half the ground is in deep-rooted green manure at any time — clover, vetch, field peas — grown to be cut down and left on the surface. It feeds the soil, smothers weeds and takes the place of bought nitrogen.",
        tag: "Coleman"
      },
      { text: "Free amendments worth having here: seaweed and leaf mould. Rinse the seaweed if it is fresh, and stockpile leaves in a wire ring — two years later they are the best mulch you own." },
      feeders.length
        ? { text: `Heavy feeders in this plan — ${feeders.map((c) => c.name.toLowerCase()).join(", ")} — get a mid-season top-dress of compost at flowering. That single handful is most of the difference between a crop and a glut.` }
        : null,
      byId.potato ? { text: "Do not lime the bed the potatoes are going into — scab likes sweet soil." } : null
    ].filter(Boolean)
  });

  /* ---------------------------------------------------------------- 3. layout and spacing */
  phases.push({
    n: 3,
    key: "layout",
    title: "Layout and spacing",
    when: "the day you plant",
    why: "The counts below are what fits at proper spacing. Crowding is the mistake that costs the most yield for the least regret.",
    steps: [
      {
        text: `Bed geometry: ${g.label}. ${g.why}`
      },
      // Bed by bed, because that is what you carry to the garden — and because the drawing beside this
      // is built from the same numbers, so the picture and the text cannot drift apart.
      ...((layout && layout.beds) || []).map((b) => ({
        tag: `bed ${b.n}`,
        text: `Bed ${b.n}${b.length_ft ? ` (${b.length_ft} ft long)` : ""}: ${(b.segments || [])
          .map((s) => `${s.name} ${s.print}${s.tall ? " (tall — north end)" : ""}`)
          .join(" · then ")}.`
      })),

      {
        text: rotation.clashes.length
          ? `Rotation flag: this plan has two of the same family — ${rotation.clashes.map((c) => `${c.names.join(" and ")} (${c.family})`).join(", ")}. Put them in different beds at minimum, and do not follow last year's same family with them.`
          : `Families in this plan: ${rotation.families.join(", ")} — all different, which is what you want. Next year, keep each family moving to a different bed.`,
        tag: "rotation"
      },
      { text: "And tell the plan what was in each bed last year — that is the one input a rotation cannot invent, and it is worth more than any fertiliser." }
    ]
  });

  /* ---------------------------------------------------------------- 4. planting and succession */
  const plantSteps = [];
  if (lastFrostMs) {
    each(transplant, (c) => {
      const start = minusDays(lastFrostMs, (c.start_inside_weeks || 4) * 7);
      return {
        text: `${c.name}: start inside the week of ${fmtDate(start)} — ${c.start_inside_weeks} weeks before your ${frostLine} frost — and set them out after it. Transplant-first is the discipline here: it buys weeks and it beats the weeds.`,
        crop: c.id
      };
    }).forEach((s) => plantSteps.push(s));
  } else {
    plantSteps.push({ text: `Start the ${transplant.map((c) => c.name.toLowerCase()).join(", ")} inside, several weeks before your own last-frost date — we don't have a frost record for that zip, so you'll need to set that date yourself.` });
  }
  if (directOnly.length) {
    plantSteps.push({
      text: `Sown straight into the bed, once the ground is workable: ${directOnly.map((c) => c.name.toLowerCase()).join(", ")}.`
    });
  }
  if (succession.length) {
    plantSteps.push({
      text: `Succession — this is the one that decides whether you eat well all summer or drown in one week: ${succession.map((c) => `${c.name.toLowerCase()} every ${c.succession_days} days`).join(", ")}. Sow a short row, not a long one, and keep it up until late July.`,
      tag: "succession"
    });
  }
  plantSteps.push({
    text: gap
      ? `The gap in your own season: nothing is ready from about ${fmtDate(gap.from)} to ${fmtDate(gap.to)} — roughly ${gap.days} days. That is the fortnight to close with a short sowing of ${succession.length ? succession[0].name.toLowerCase() : "lettuce or radish"} a few weeks before it opens.`
      : "No obvious gap in the season as planted — the succession sowings above are what keeps it that way.",
    tag: "your gap"
  });
  phases.push({
    n: 4,
    key: "planting",
    title: "Planting and succession",
    when: "from now until late July",
    why: "A bed should always be doing something, and it should never all arrive at once.",
    steps: plantSteps
  });

  /* ---------------------------------------------------------------- 5. pests, graded */
  const grade = (claim, strength, evidence) => ({ claim, strength, evidence });
  phases.push({
    n: 5,
    key: "pests",
    title: "Pests and beneficials — the short version that works",
    when: "as the crops go in",
    why: "Most companion-planting advice is folklore. These four things have evidence behind them; the rest of the chart does not.",
    steps: [
      cucurbits.length
        ? {
            text: "Trap crop. Put one Blue Hubbard squash at the far end of the bed, well away from your zucchini, and check it twice a week. Squash bugs and vine borers prefer it — in trial data 60–80% of the pressure went to the trap instead of the crop. It will get infested. That is it working. Crush the egg clusters you find underneath the leaves.",
            tag: "proven"
          }
        : null,
      {
        text: "Insectary strip. Sow sweet alyssum — or dill, cilantro, phacelia — along one path edge and let it flower. In field trials roughly 10% of the area in alyssum was enough to hold aphids down, by feeding hoverflies and tiny parasitic wasps that eat them. This is the highest-value square foot in most gardens.",
        tag: "proven"
      },
      {
        text: "Row cover as a barrier. Over cucumbers and anything brassica from planting until they flower — it beats every spray because the pest never lands. You must lift it for pollination, and you must not leave it on in a heatwave.",
        tag: "proven"
      },
      {
        text: "On marigolds, since they come up every year: French and African marigolds do suppress root-knot nematodes — but only as a solid crop grown for a couple of months and then tilled in, not as a plant set beside the tomatoes. In Maine the nematodes are rarely the problem anyway, so grow them for the hoverflies and the colour, not for the myth.",
        tag: "the honest version"
      },
      {
        text: schoolLine(cropList),
        tag: "scouting"
      },
      {
        text: "Alternate an early crop and a late crop in the same bed — extension guidance, and Coleman's whole spring-to-fall sequence runs on it. Soil that is never bare does not grow weeds, and cover is the cheapest pest control there is.",
        tag: "supported"
      }
    ].filter(Boolean)
  });

  /* ---------------------------------------------------------------- 6. water */
  phases.push({
    n: 6,
    key: "water",
    title: "Water",
    when: "the week after planting",
    why: "Deep and infrequent beats a daily sprinkle — it drives roots down instead of teaching them to stay shallow.",
    steps: [
      { text: `One soaker line down the middle of each ${g.id === "containers" ? "pot group" : g.short.replace(/s$/, "")}, under the mulch. Ten minutes of drip twice a week does more than an hour with a hose.` },
      { text: "Water at the base in the morning. Wet leaves at night is how you grow blight instead of tomatoes." },
      { text: "Mulch 2–3 inches: straw, leaves, grass clippings. It halves the watering and it is where the slugs live — so keep it back an inch from the stems." },
      ...each(cropList.slice(0, 3), (c) => ({ text: `${c.name}: ${c.watering}`, crop: c.id }))
    ]
  });

  /* ---------------------------------------------------------------- 7. season extension */
  phases.push({
    n: 7,
    key: "extension",
    title: "Stretch the season",
    when: "late August, and again in October",
    why: "This is Coleman's actual specialty, and it is why zone 5 does not have to mean six months off.",
    steps: [
      { text: "A cold frame at one end of a bed, hinged on the south side, glazed with the storm window already in your basement. Open it on sunny days or you will cook what you are protecting." },
      { text: "Quick hoops — bent wire or conduit over a bed, with row cover or clear plastic clipped on. Cheapest protected growing there is, and it moves to next year's bed in ten minutes." },
      cold.length
        ? {
            text: `Standing into the cold, from this plan: ${cold.map((c) => c.name.toLowerCase()).join(", ")}. Sow the greens in late summer, not spring — they come through the winter and they are the first thing you eat in March.`,
            tag: "winter list"
          }
        : { text: "None of the crops in this plan are winter standers. If you want a winter harvest, add spinach, mâche and leeks — sown in late summer they stand under cover through the cold." },
      { text: "Leave carrots in the ground under a foot of mulch and dig them as you need them, all winter. They get sweeter for it." }
    ]
  });

  /* ---------------------------------------------------------------- 8. harvest */
  phases.push({
    n: 8,
    key: "harvest",
    title: "Harvest, and the week it all lands",
    when: "from early July through frost",
    why: gap ? "Because the plan is built to close the gap, and then to survive the peak." : "Because the peak is the part that decides whether you eat well or compost it.",
    steps: [
      glut
        ? { text: `Everything in the main season lands between ${fmtDate(glut.open)} and ${fmtDate(glut.close)}. That peak is the week that breaks people.`, tag: "your window" }
        : { text: "The harvest windows are in the list below — with no frost record for your zip they are general rather than local." },
      { text: "Pick every second day once the glut starts, and pick into the house, not into a bucket on the porch. A day on the porch is a day off the shelf life." },
      { text: "The glut itself is what The Preservation Run is for — what to can, freeze, cellar and ferment, in the order the harvest arrives." }
    ]
  });

  return phases;
}

/** The scouting line: what to actually look for on these crops, in this climate. */
function schoolLine(cropList) {
  const watch = cropList.filter((c) => c.watch_for).slice(0, 5);
  if (!watch.length) return "Walk the beds twice a week with a coffee. Most problems are obvious a fortnight before they are a problem.";
  const list = watch.map((c) => `${c.name} — ${c.watch_for}`).join("; ");
  return `Scout twice a week, and know what you're looking for: ${list}. Twice a week with a coffee beats any spray, because you catch it while it's still squashable.`;
}
