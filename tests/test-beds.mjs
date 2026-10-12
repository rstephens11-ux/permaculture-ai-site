// tests/test-beds.mjs — geometry, counts and rotation.
//
// These are the numbers someone acts on, so they get their own tests: how many tomato plants actually
// fit a 30-inch Coleman bed versus a 4x8 box, that a crop with no bed30 entry (raspberries) doesn't
// silently report a fake count, and that five plan slots can't be spent on two members of one family.
import test from "node:test";
import assert from "node:assert/strict";
import { GEOMETRIES, bedLine, countInBed, familyOf, rotationCheck } from "../api/beds.mjs";
import { cropById } from "../api/harvest.mjs";

test("there are two real geometries plus rows and containers, and each explains itself", () => {
  for (const id of ["coleman_30", "box_4x8", "ground", "containers"]) {
    const g = GEOMETRIES[id];
    assert.ok(g, `${id} exists`);
    assert.ok(g.label && g.why, `${id} has a label and a reason`);
  }
  assert.equal(GEOMETRIES.coleman_30.width_in, 30, "Coleman's bed is 30 inches wide");
  assert.equal(GEOMETRIES.coleman_30.path_in, 12, "with 12-inch paths");
  assert.equal(GEOMETRIES.box_4x8.width_in, 48, "and a 4x8 box is 48 across");
});

test("a 30-inch bed holds fewer tomatoes than a 4x8 box, and the arithmetic is ours to check", () => {
  const tomato = cropById("tomato");
  const coleman = countInBed(tomato, "coleman_30");
  const box = countInBed(tomato, "box_4x8");
  // 30in bed, 12 ft long, one row, 24 in in-row => 6 plant positions
  assert.equal(coleman.plants, 6, "one row of 6 down a 12 ft bed at 24 in spacing");
  assert.equal(box.plants, 4, "the 4x8 box count comes straight from the crop table");
  // and a spaced crop must never be reported as row-feet
  assert.match(bedLine(tomato, "coleman_30", 1).print, /^6 plants$/, "tomatoes are counted as plants, not feet");
});

test("drilled crops report row-feet, and say how many plants that is", () => {
  const carrot = cropById("carrot");
  const line = bedLine(carrot, "coleman_30", 1);
  assert.match(line.print, /row-feet/);
  assert.ok(line.detail && /plants/.test(line.detail), "with the plant count alongside: " + line.detail);
});

test("two beds double everything", () => {
  const pea = cropById("pea");
  const one = bedLine(pea, "coleman_30", 1);
  const two = bedLine(pea, "coleman_30", 2);
  const num = (s) => Number(String(s.print).split(" ")[0]);
  assert.equal(num(two), num(one) * 2);
});

test("a crop that isn't a bed crop does not get a fake count", () => {
  const raspberry = cropById("raspberry");
  const r = countInBed(raspberry, "coleman_30");
  assert.equal(r.skip, true, "raspberries say 'not a bed crop' rather than inventing a number");
  assert.match(r.note, /own 2 ft row|not a bed crop/i);
});

test("containers only offer crops that actually work in pots", () => {
  const line = bedLine(cropById("lettuce"), "containers", 1);
  assert.match(line.print, /plants?/);
  assert.match(line.note, /pot/i);
});

test("families are botanical facts, not advice", () => {
  assert.equal(familyOf(cropById("tomato")), "Solanaceae");
  assert.equal(familyOf(cropById("potato")), "Solanaceae", "same family — that is the point of rotation");
  assert.equal(familyOf(cropById("bush-bean")), "Fabaceae");
  assert.equal(familyOf(cropById("carrot")), "Apiaceae");
  assert.equal(familyOf(cropById("kale")), "Brassicaceae");
});

test("rotation catches two of a family in one plan", () => {
  const clash = rotationCheck([cropById("tomato"), cropById("potato"), cropById("carrot")]);
  assert.equal(clash.clean, false);
  assert.equal(clash.clashes[0].family, "Solanaceae");
  assert.deepEqual(clash.clashes[0].names, ["Tomato", "Potato"]);

  const clean = rotationCheck([cropById("tomato"), cropById("carrot"), cropById("bush-bean"), cropById("kale")]);
  assert.equal(clean.clean, true);
  assert.equal(clean.families.length, 4);
});
