// tests/test-layout.mjs — where things go, and the layout drawing.
//
// The drawing used to be delegated to the image model and it never carried the information (BLOCKERS.md).
// Now we draw it from our own numbers, which means it can be tested like any other output.
import test from "node:test";
import assert from "node:assert/strict";
import { assignBeds, planDiagram } from "../api/layout.mjs";
import { familyOf } from "../api/beds.mjs";
import { cropById } from "../api/harvest.mjs";

const SIX = ["tomato", "lettuce", "carrot", "bush-bean", "kale", "beet"].map(cropById);

test("every crop is placed, in a real bed, exactly once", () => {
  const { beds } = assignBeds(SIX, { geometry: "coleman_30", bedCount: 2 });
  const placed = beds.flatMap((b) => b.segments.map((s) => s.crop));
  assert.equal(placed.length, SIX.length, "nothing dropped, nothing duplicated");
  assert.deepEqual([...placed].sort(), SIX.map((c) => c.id).sort());
  for (const b of beds) {
    assert.ok(b.segments.length >= 1, `bed ${b.n} has something in it`);
    for (const s of b.segments) {
      assert.ok(s.length_ft > 0, "every segment has a length of bed");
      assert.ok(s.plants >= 1, `${s.name} has at least one plant`);
      assert.ok(s.family, "and a family, so the picture can colour it");
    }
  }
});

test("the segments of a bed add up to the bed, not past it", () => {
  const { beds } = assignBeds(SIX, { geometry: "coleman_30", bedCount: 2 });
  for (const b of beds) {
    const sum = b.segments.reduce((t, s) => t + s.length_ft, 0);
    assert.ok(sum <= b.length_ft + 0.001, `bed ${b.n} overflows: ${sum} ft in ${b.length_ft} ft`);
    assert.ok(sum > b.length_ft * 0.5, `bed ${b.n} mostly empty: ${sum} ft of ${b.length_ft} ft`);
  }
});

test("families are spread across beds, not stacked into one", () => {
  const members = [cropById("tomato"), cropById("potato")];   // both Solanaceae
  const { beds } = assignBeds(members, { geometry: "coleman_30", bedCount: 2 });
  const bedOf = {};
  beds.forEach((b) => b.segments.forEach((s) => { bedOf[s.crop] = b.n; }));
  assert.notEqual(bedOf.tomato, bedOf.potato, "the two nightshades do not share a bed");
});

test("tall crops are placed first so they sit at the north end", () => {
  const { beds } = assignBeds([cropById("carrot"), cropById("tomato")], { geometry: "coleman_30", bedCount: 1 });
  assert.equal(beds[0].segments[0].crop, "tomato", "the tomato leads the bed");
  assert.equal(beds[0].segments[0].tall, true);
});

test("the drawing is a real to-scale SVG with a shape per bed and no remote anything", () => {
  const layout = assignBeds(SIX, { geometry: "coleman_30", bedCount: 2 });
  const svg = planDiagram(layout, {
    geometry: "coleman_30", place: "Wiscasset", year: 2027,
    frost: { known: true, last_spring_freeze: "04/27", first_fall_freeze: "10/18", frost_free_days: 174 },
    glut: { open: "2027-07-20", close: "2027-08-31" }, cropList: SIX
  });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, "a namespaced SVG");
  assert.match(svg, /viewBox="0 0 [\d.]+ [\d.]+"/, "with a viewBox so it scales");
  assert.match(svg, /Wiscasset — the 2027 season/);
  assert.match(svg, /drawn to scale/, "and it says so");
  assert.match(svg, /174 frost-free days/);
  assert.match(svg, /peak week/, "the glut is on the drawing");
  assert.match(svg, /Bed 1<\/text>/, "bed 1 is labelled");
  assert.match(svg, /Bed 2<\/text>/);
  assert.match(svg, /12in path/, "the paths are dimensioned");
  // every crop name appears somewhere on the drawing
  for (const c of SIX) assert.ok(svg.includes(c.name), `${c.name} is on the drawing`);
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(svg), "no remote references — it must render offline");
  assert.ok(!/<script/i.test(svg), "no script in an image");
  assert.ok(!/&(?!amp;|lt;|gt;|#)/.test(svg), "ampersands are escaped");
});

test("in-bed labels fit the bed they are written in", () => {
  // "Mâche (corn salad)" at 10.5px is ~110px wide and ran over the edge of an 85px bed.
  const svg = planDiagram(assignBeds(SIX, { geometry: "coleman_30", bedCount: 2 }), {
    geometry: "coleman_30", place: "Wiscasset", cropList: SIX
  });
  const bedW = (30 / 12) * 34;
  for (const label of svg.matchAll(/<text[^>]*font-weight="700"[^>]*>([^<]+)<\/text>/g)) {
    const t = label[1].replace(" ↑", "");
    if (/^(Bed|\d)/.test(t)) continue;
    assert.ok(t.length * 10.5 * 0.55 <= bedW - 10, `"${t}" is too wide for a ${bedW.toFixed(0)}px bed`);
  }
  // a crop whose name carries a parenthetical: short form inside the bed, full form in the legend
  const glossed = [{ ...cropById("lettuce"), name: "Mâche (corn salad)" }, cropById("tomato")];
  const withGloss = planDiagram(assignBeds(glossed, { geometry: "coleman_30", bedCount: 1 }), {
    geometry: "coleman_30", place: "Wiscasset", cropList: glossed
  });
  assert.match(withGloss, /<text[^>]*font-weight="700"[^>]*>Mâche(<\/text>|)/, "the short name is used in the bed");
  assert.ok(!/<text[^>]*font-weight="700"[^>]*>Mâche \(corn salad\)/.test(withGloss), "not the full gloss");
  assert.match(withGloss, /Mâche \(corn salad\)<\/text>/, "and the full name survives in the legend");
});

test("nothing is drawn outside the canvas — the clipping regression", () => {
  const svg = planDiagram(assignBeds(SIX, { geometry: "coleman_30", bedCount: 2 }), {
    geometry: "coleman_30", place: "Wiscasset", year: 2027,
    frost: { known: true, last_spring_freeze: "04/27", first_fall_freeze: "10/18", frost_free_days: 174 },
    glut: { open: "2027-07-20", close: "2027-08-31" }, cropList: SIX
  });
  const w = Number(svg.match(/viewBox="0 0 ([\d.]+)/)[1]);
  const h = Number(svg.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)[1]);
  // A two-bed plan is 248px of geometry at 26px/ft. Sizing the canvas to that clipped the title, the
  // glut line and the legend, so it is floored.
  assert.ok(w >= 820, `the canvas must be floored, got ${w}`);
  for (const m of svg.matchAll(/\s(x|y|x1|x2|y1|y2)="([\d.]+)"/g)) {
    const v = Number(m[2]);
    if (m[1].startsWith("x")) assert.ok(v <= w, `${m[1]}=${v} is past the ${w}px width`);
    else assert.ok(v <= h, `${m[1]}=${v} is past the ${h}px height`);
  }
  // the header text (21px) has to fit the canvas, or it is cut off on the right
  const title = "Wiscasset — the 2027 season";
  assert.ok(title.length * 21 * 0.55 < w - 46, "the title fits inside the canvas");
});

test("a crop name with an ampersand cannot break the drawing", () => {
  const fake = [{ ...cropById("kale"), name: "Kale & Chard <b>" }];
  const svg = planDiagram(assignBeds(fake, { geometry: "coleman_30", bedCount: 1 }), { cropList: fake });
  assert.ok(svg.includes("Kale &amp; Chard &lt;b&gt;"));
  assert.ok(!svg.includes("<b>"));
});

test("containers get a pot row, not a pretend map", () => {
  const pots = [cropById("cherry-tomato"), cropById("lettuce"), cropById("spinach")];
  const layout = assignBeds(pots, { geometry: "containers", bedCount: 1 });
  assert.ok(layout.notes.some((n) => /no layout to draw/i.test(n)));
  const svg = planDiagram(layout, { geometry: "containers", place: "Wiscasset", cropList: pots });
  assert.match(svg, /containers/);
  assert.ok(!/Bed 1/.test(svg), "no beds in a container plan");
});

test("box geometry draws boxes at the box dimensions", () => {
  const svg = planDiagram(assignBeds(SIX, { geometry: "box_4x8", bedCount: 2 }), {
    geometry: "box_4x8", place: "Wiscasset", cropList: SIX
  });
  assert.match(svg, /4 × 8 boxes, 24-inch paths/);
  assert.match(svg, /48-in beds, 24-in paths/);
});
