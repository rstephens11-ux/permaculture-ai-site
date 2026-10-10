// api/plan-spec.mjs — builds the plan: which crops, which numbered labels, which steps, which prompt.
//
// Why this exists instead of an LLM: the numbered labels on the image and the written steps must agree.
// If a text model wrote the steps and an image model drew the labels, they would drift apart. Here the
// label list is fixed first and handed to the image model, so step (1) is always what (1) points at.
// The text is deterministic, sourced from api/crops.json, and cannot invent a canning time.

import { cropById, windowsFor, glutWindow } from "./harvest.mjs";

// A default household plan for the Northeast. Two crops that carry the season, one that overflows,
// one that stands into winter, one that is planted for next year.
const DEFAULT_SET = ["tomato", "bush-bean", "zucchini", "kale", "garlic"];

export function chooseCrops({ set = DEFAULT_SET } = {}) {
  return set.filter((id) => cropById(id));
}

/**
 * @returns {{crops, labels, steps, harvest_window, glut, prompt}}
 */
export function buildPlan(opts = {}) {
  const ids = chooseCrops(opts);
  const wins = windowsFor(ids, opts);
  const byWin = Object.fromEntries(wins.map((w) => [w.crop, w]));

  // Numbered labels, in the order the steps are described.
  const labels = [
    { n: 1, crop: "tomato", text: "tomato bed" },
    { n: 2, crop: "bush-bean", text: "bean rows" },
    { n: 3, crop: "zucchini", text: "zucchini hills" },
    { n: 4, crop: "kale", text: "kale and the cold frame" },
    { n: 5, crop: "garlic", text: "garlic bed" }
  ].filter((l) => ids.includes(l.crop));

  const tomato = cropById("tomato");
  const bean = cropById("bush-bean");
  const zucchini = cropById("zucchini");
  const kale = cropById("kale");
  const garlic = cropById("garlic");

  const steps = [
    {
      category: "PLANT",
      description: `Mark the beds. (${labels[0]?.n}) ${labels[0]?.text}: ${tomato.name} on 3 ft centers, ${tomato.companions.slice(0, 2).join(" and ")} between.`,
      plantVarieties: ["'Sungold' or 'Juliet' tomato (a cherry and a paste type together)", "Basil", "Marigold"],
      companionPlants: tomato.companions,
      wateringNeeds: tomato.watering
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
      description: `One soaker line down the middle of the ${tomato.label}. Deep and infrequent beats a daily sprinkle. ${zucchini.watering}`,
      plantVarieties: [],
      companionPlants: [],
      wateringNeeds: zucchini.watering
    },
    {
      category: "BUILD",
      description: `Cold frame at the west end for the ${kale.name.toLowerCase()} — hinge it south, reuse a storm window. ${garlic.method_notes.split(".")[0]}.`,
      plantVarieties: ["Winterbor kale"],
      companionPlants: kale.companions,
      wateringNeeds: kale.watering
    },
    {
      category: "HARVEST",
      description: `Sow the ${bean.name.toLowerCase()} every ${bean.succession_days} days from a week after last frost — that ${bean.succession_days}-day stagger is what keeps August from becoming one impossible week.`,
      plantVarieties: ["Provider bush bean"],
      companionPlants: bean.companions,
      wateringNeeds: bean.watering
    }
  ];

  const prompt = [
    "Turn this photograph of a yard into a clear, friendly, hand-drawn permaculture plan overlay.",
    "Keep the actual photograph underneath: beds, fence, paths and buildings must stay exactly where they are.",
    "Draw the beds, paths and water lines on top, and put white circular numbered labels on the image,",
    "each with a leader line pointing at the thing it marks:",
    labels.map((l) => `(${l.n}) ${l.text}`).join(", ") + ".",
    "Style: flat cartoon illustration, thick friendly outlines, muted garden colours — greens, terracotta, cream.",
    "No text other than the numbers. Do not move the horizon, the fence or the trees."
  ].join(" ");

  return {
    crops: ids,
    labels,
    steps,
    harvest_window: wins,
    glut: glutWindow(ids, opts),
    prompt
  };
}
