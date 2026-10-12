// tests/test-pages.mjs — the shape of what a visitor actually gets.
//
// The plan page is the product, and it changed shape twice in one day: first the informative drawing was
// demoted to a cartoon, then the cartoon was hidden, then the request came back for both. String tests
// won't tell you a page is good, but they will tell you a picture quietly disappeared.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const js = () => page("assets/js/tool.js");

test("the plan page offers both drawings, and both are wired", () => {
  const html = page("plan.html");
  // drawing 1: the plan, laid over the visitor's own photo
  assert.match(html, /id="overlay-canvas"/, "the overlay canvas is on the page");
  assert.match(html, /assets\/js\/overlay\.js/, "and the overlay renderer is loaded");
  assert.match(html, /id="download-sketch"/, "with a download for it");
  assert.ok(!/id="overlay-mix"/.test(html), "no photo/illustration slider — the illustration is retired");
  // drawing 2: our to-scale layout
  assert.match(html, /id="result-diagram"/, "the to-scale layout is on the page");
  assert.match(html, /id="download-plan-svg"/, "downloadable as SVG");
  assert.match(html, /id="download-plan-png"/, "and as PNG");
  // and they read as two things, not one plus a footnote
  assert.match(html, /1 · your plan, on your photo/);
  assert.match(html, /2 · your beds, to scale/);
  assert.ok(!/id="result-shot"/.test(html), "the old single-image slot is gone");
  assert.ok(!/id="sketch-block"/.test(html), "and the collapsed-afterthought block with it");
});

test("the overlay renderer places plants by real spacing and finds its own position", () => {
  const src = readFileSync(new URL("../assets/js/overlay.js", import.meta.url), "utf8");
  assert.match(src, /function findGround/, "it locates the plantable ground in the photo");
  assert.match(src, /groundScore/, "with an explicit ground heuristic");
  assert.match(src, /Biggest rectangle of plantable ground/, "and squares off the biggest usable region");
  assert.match(src, /function bedPolysFromMask/, "and finds the beds the mask says are there");
  assert.match(src, /function plantSegment/, "planting each crop run at its real spacing");
  assert.match(src, /function fillBed/, "filling the bed with the generated texture");
  assert.match(src, /function numberBadge/, "and numbering the crop runs");
  // sprite paths are derived from the script's own URL, not the page's — a page loaded from /out/ or a
  // moved page silently fell back to placeholder markers before this
  assert.match(src, /SITE_BASE = SCRIPT_SRC\.replace\(/, "it draws the generated sprite sheet");
  assert.match(src, /SPRITE_DIR = SITE_BASE \+ "assets\/plants\/"/, "addressed relative to the script");
  assert.match(src, /function clipText/, "and text is measured, so nothing runs off the sheet");
  assert.match(src, /spacing_in/, "sizing each plant from the crop's real spacing");
  assert.match(src, /MAX_PER_SEGMENT/, "capped, so a bed of mâche doesn't become mush");
  assert.match(src, /contact shadow/, "with a shadow, or the plants read as floating stickers");
  assert.match(src, /window\.PAOverlay = \{/, "and it exposes itself to tool.js");
});

test("the drawing code rasterises the layout for download, client-side", () => {
  const src = js();
  assert.match(src, /function svgToPng/, "the layout rasterises for download");
  assert.match(src, /function svgToPng[\s\S]*?toDataURL\("image\/png"\)/, "via a canvas, not a server");
  assert.match(src, /PAOverlay\.render\(/, "and drawing 1 is the overlay renderer");
  assert.match(src, /dataset\.demoPhoto/, "the demo has a photo for the overlay to sit on");
});

test("the home page shows the photo, the illustration and the plan", () => {
  const html = page("index.html");
  assert.match(html, /assets\/img\/sample-before\.jpg/);
  assert.match(html, /assets\/img\/sample-overlay\.png/, "the plan-over-photo drawing");
  assert.match(html, /assets\/img\/sample-diagram\.png/, "and the to-scale layout");
});

test("no page still calls it a numbered plan or promises five steps", () => {
  for (const f of ["index.html", "plan.html", "terms.html", "privacy.html"]) {
    const html = page(f);
    assert.ok(!/numbered planting plan/i.test(html), `${f} still says "numbered planting plan"`);
    assert.ok(!/five steps/i.test(html), `${f} still promises "five steps"`);
  }
});
