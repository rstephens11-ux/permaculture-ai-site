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
  // drawing 1: the illustration over the visitor's photo
  assert.match(html, /id="overlay-canvas"/, "the overlay canvas is on the page");
  assert.match(html, /id="overlay-mix"/, "with the photo/illustration slider");
  assert.match(html, /id="download-sketch"/, "and a download for it");
  // drawing 2: our to-scale layout
  assert.match(html, /id="result-diagram"/, "the to-scale layout is on the page");
  assert.match(html, /id="download-plan-svg"/, "downloadable as SVG");
  assert.match(html, /id="download-plan-png"/, "and as PNG");
  // and they read as two things, not one plus a footnote
  assert.match(html, /1 · your yard, illustrated/);
  assert.match(html, /2 · your beds, to scale/);
  assert.ok(!/id="result-shot"/.test(html), "the old single-image slot is gone");
  assert.ok(!/id="sketch-block"/.test(html), "and the collapsed-afterthought block with it");
});

test("the drawing code composites the photo underneath the illustration", () => {
  const src = js();
  assert.match(src, /function paintOverlay/, "there is an overlay painter");
  assert.match(src, /overlayState\.photo/, "which draws the visitor's photo first");
  assert.match(src, /globalAlpha = mix/, "then the illustration at the slider's value");
  assert.match(src, /dataset\.demoPhoto/, "and the demo has a photo to sit under the sample sketch");
  assert.match(src, /function svgToPng/, "and the layout rasterises for download");
  assert.match(src, /function svgToPng[\s\S]*?toDataURL\("image\/png"\)/, "via a canvas, not a server");
});

test("the home page shows the photo, the illustration and the plan", () => {
  const html = page("index.html");
  assert.match(html, /assets\/img\/sample-before\.jpg/);
  assert.match(html, /assets\/img\/sample-plan\.jpg/);
  assert.match(html, /assets\/img\/sample-diagram\.png/);
});

test("no page still calls it a numbered plan or promises five steps", () => {
  for (const f of ["index.html", "plan.html", "terms.html", "privacy.html"]) {
    const html = page(f);
    assert.ok(!/numbered planting plan/i.test(html), `${f} still says "numbered planting plan"`);
    assert.ok(!/five steps/i.test(html), `${f} still promises "five steps"`);
  }
});
