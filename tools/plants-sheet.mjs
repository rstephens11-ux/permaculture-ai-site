// tools/plants-sheet.mjs — generate the plant sprites the overlay is built from. ONCE.
//
// The plan overlay has to show *what goes where*, which a diffusion model cannot be trusted to place
// (measured, three ways — see BLOCKERS.md and the forge-lab reference). So the model's job shrinks to
// the one thing it is genuinely good at: drawing a single plant, beautifully and consistently. The
// PLACEMENT is ours, from the same layout maths that draws the to-scale plan.
//
// The consistency rules, in order of how much they matter:
//   1. ONE fixed seed for the whole batch — the single biggest lever on "same illustrator" feel.
//   2. ONE style clause, repeated verbatim in every prompt. No per-plant art direction.
//   3. NO style anchor. This was tried and it is a trap: feeding sprite 1 back as the reference image
//      does lock the style perfectly — and drags the CONTENT with it. Measured 2026-10-12: anchored,
//      "carrot" came out as a tomato plant growing out of a carrot root and "lettuce" as a tomato.
//      The seed plus the style clause is enough, and the content stays correct. (PLANTS_ANCHOR=on
//      re-enables the mistake.)
//   4. Magenta background, keyed out to alpha afterwards. Green is the obvious choice and the wrong one
//      — every plant here is green, so green spill would eat the leaves.
//   5. Key with chromakey's SOFT matte, not colorkey. Measured on the same sprites: colorkey gives a
//      binary mask (jagged edges, and a pink halo on red fruit); colorkey + a pixel of erosion removes
//      the halo and leaves the edges nibbled. `chromakey` with a blend value produces partial alpha and
//      the edges come out clean.
//
// Cost gate, same as the smoke test: this spends real GPU seconds, so it refuses to run by accident.
//
//   PLANTS=yes node tools/plants-sheet.mjs tomato carrot lettuce      # a few
//   PLANTS=yes node tools/plants-sheet.mjs --all                      # all 21
//
// Writes out/plants/<id>-raw.png (the render) and assets/plants/<id>.png (256px, keyed to alpha).

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { makeForgeEngine } from "../api/engine/forge.mjs";
import { crops } from "../api/harvest.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DIR = join(ROOT, "out/plants");
const OUT_DIR = join(ROOT, "assets/plants");

const SEED = Number(process.env.PLANTS_SEED || 424242);
const USE_ANCHOR = (process.env.PLANTS_ANCHOR || "off") === "on";
const KEY_COLOR = process.env.PLANTS_KEY || "0xFF00FF";
// sprite size kept in the repo: 512 so the overlay can draw a plant at its true plan size without
// upscaling. ~200 KB each × 21 crops.
const SPRITE_PX = Number(process.env.PLANTS_PX || 512);

// One style clause. Touch this and the whole sheet has to be regenerated, because consistency is the
// only reason it exists — so it is deliberately one string, not a template with knobs.
const STYLE = [
  "A flat botanical illustration of {PLANT}.",
  "Drawn in a consistent hand-illustrated seed-catalogue style: thick dark green outline, muted vintage",
  "garden palette, soft paper texture, gentle hand-drawn wobble, three-quarter top-down view.",
  "The whole plant is centred and complete, with a little space around it.",
  "Isolated on a solid flat uniform magenta background, colour #FF00FF.",
  "The magenta fills the entire background edge to edge.",
  "No shadow, no ground, no soil, no pot, no planter, no other objects, no people, no text, no border,",
  "no frame, no watermark, no grid, no labels."
].join(" ");

/** What each plant looks like, in one clause. Visual only — no horticulture, the model isn't reading it. */
const LOOKS = {
  "tomato": "a tomato plant with a staked main stem, clusters of ripe red tomatoes and green foliage",
  "cherry-tomato": "a cherry tomato plant with many small red tomatoes on trailing stems",
  "bush-bean": "a bush bean plant with several long green pods and broad leaves",
  "zucchini": "a zucchini plant with large lobed leaves and one dark green courgette",
  "cucumber": "a cucumber vine with curling tendrils, a yellow flower and one green cucumber",
  "pepper": "a sweet pepper plant with one glossy red bell pepper and dark green leaves",
  "sweet-corn": "a sweet corn stalk with a tassel on top and one ear in its husk",
  "beet": "a beetroot with red-stemmed green leaves and the round red root just showing",
  "carrot": "a carrot with feathery green tops and the orange root showing",
  "kale": "a curly kale plant with ruffled blue-green leaves",
  "lettuce": "a butterhead lettuce with soft rounded light green leaves",
  "swiss-chard": "a swiss chard plant with broad green leaves and crimson stems",
  "spinach": "a spinach plant with smooth dark green leaves",
  "mache": "a low rosette of small mâche corn-salad leaves",
  "leek": "a leek with long flat blue-green leaves and a white shank",
  "garlic": "a garlic plant with long green leaves and the bulb just showing",
  "onion": "an onion with hollow blue-green leaves and the bulb showing",
  "potato": "a potato plant with leafy green growth and small white flowers",
  "pea": "a pea plant climbing a short support with tendrils, white flowers and pods",
  "winter-squash": "a winter squash vine with large leaves and one pale ribbed squash",
  "raspberry": "a raspberry cane with pinnate leaves and a few red berries"
};

const args = process.argv.slice(2);
const all = args.includes("--all");
const wanted = (all ? crops().map((c) => c.id) : args.filter((a) => !a.startsWith("--")));

if ((process.env.PLANTS || "no") !== "yes") {
  console.log("Refusing to spend GPU time: set PLANTS=yes to run this.");
  console.log(`would generate: ${wanted.length ? wanted.join(", ") : "(nothing — pass crop ids or --all)"}`);
  console.log(`seed ${SEED}, anchor ${USE_ANCHOR ? "on" : "off"}, key ${KEY_COLOR}`);
  process.exit(0);
}
if (!wanted.length) {
  console.log("No crops named. Pass crop ids, or --all.");
  process.exit(1);
}

mkdirSync(RAW_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

// A plain white 1024 square as the seed input. The graph needs *a* reference image; white gives it
// nothing to preserve, which is what we want — the prompt draws the plant.
const WHITE = join(RAW_DIR, "white.png");
if (!existsSync(WHITE)) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
    "color=c=white:s=1024x1024", "-frames:v", "1", "-y", WHITE]);
}

const promptFor = (id) => STYLE.replace("{PLANT}", LOOKS[id] || `a ${id.replace(/-/g, " ")} plant`);

/**
 * Chroma-key the magenta out to a SOFT alpha and shrink to sprite size. See note 5 at the top: the
 * blend value in chromakey is what buys an anti-aliased edge, which colorkey cannot do.
 */
function key(src, dest) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", src, "-vf",
    `chromakey=${KEY_COLOR}:0.26:0.22,format=rgba,scale=${SPRITE_PX}:${SPRITE_PX}:flags=lanczos`,
    "-frames:v", "1", "-y", dest]);
}

const engine = makeForgeEngine({ log: (m) => console.log(`  [forge] ${m}`) });

console.log(`engine: forge at ${process.env.FORGE_BASE_URL || "http://forge:8188"}`);
console.log(`seed ${SEED} · anchor ${USE_ANCHOR ? "on" : "off"} · key ${KEY_COLOR}`);
if (!(await engine.available())) {
  console.log("VERDICT: FAIL — forge is not answering. Nothing was rendered.");
  process.exit(1);
}
if (await engine.busy()) {
  console.log("VERDICT: NOT RUN — forge has work queued; refusing to collide with it.");
  process.exit(2);
}

let anchorB64 = null;
let ok = 0;
const t0 = Date.now();

for (const id of wanted) {
  if (!LOOKS[id]) console.log(`  ? ${id} — no LOOKS entry, using a generic description`);
  const prompt = promptFor(id);
  const useAnchor = USE_ANCHOR && anchorB64;
  process.stdout.write(`${id}: submitting${useAnchor ? " (style anchor)" : ""}… `);
  const t = Date.now();
  try {
    const out = await engine.plan({
      imageB64: useAnchor ? anchorB64 : readFileSync(WHITE).toString("base64"),
      mime: "image/png",
      prompt, seed: SEED, resolution: 1024
    });
    const raw = join(RAW_DIR, `${id}-raw.png`);
    writeFileSync(raw, Buffer.from(out.imageB64, "base64"));
    key(raw, join(OUT_DIR, `${id}.png`));
    if (!anchorB64) anchorB64 = out.imageB64;
    ok++;
    console.log(`${((Date.now() - t) / 1000).toFixed(1)}s → assets/plants/${id}.png`);
  } catch (err) {
    console.log(`FAILED — ${err.message}`);
  }
}

console.log(`\nVERDICT: ${ok === wanted.length ? "PASS" : "PARTIAL"} — ${ok}/${wanted.length} sprites in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log(`gpu-seconds: ${((Date.now() - t0) / 1000).toFixed(0)}`);
console.log(`raw renders in out/plants/ — check the alpha before trusting the key.`);
