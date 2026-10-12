// tools/textures.mjs — the surface textures the bed overlay is built from. Generated ONCE, like the
// plant sprites, and for the same reason: art made once is art that never drifts.
//
// The bed overlay fills each bed polygon with one of these, scaled so the texel density matches the
// bed's real size on the ground. That is why they are flat, evenly lit, edge-to-edge and seamless-ish —
// anything with a strong lighting direction would fight the photo's own light.
//
//   TEXTURES=yes node tools/textures.mjs            # all variants
//   TEXTURES=yes node tools/textures.mjs soil-dark  # one
//
// Writes assets/textures/<name>.png (512, tiled-ready) and out/textures/<name>-raw.png.

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { makeForgeEngine } from "../api/engine/forge.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(ROOT, "out/textures");
const OUT = join(ROOT, "assets/textures");

const SEED = Number(process.env.TEXTURE_SEED || 90210);
const PX = Number(process.env.TEXTURE_PX || 512);

// One style clause, same discipline as the sprite sheet: touch it and every texture is regenerated.
const STYLE = [
  "A flat illustrated texture swatch of {MATERIAL}.",
  "Drawn in a hand-illustrated garden-diagram style: muted natural colours, soft even lighting from",
  "directly above, no strong shadows, no highlights, no vignette.",
  "The texture fills the entire frame edge to edge with even density and a consistent scale.",
  "Top-down view. No plants, no tools, no worms, no text, no border, no frame, no watermark."
].join(" ");

const TEXTURES = {
  // dark, rich, freshly-worked loam — the default fill
  "soil-dark": "rich dark brown garden loam, small crumbs and clods, a scattering of tiny pebbles, a few lighter flecks of grit",
  // lighter and drier, for beds that read as dusty in a bright photo
  "soil-warm": "warm mid-brown garden soil, dry and crumbly, small stones and fine grit",
  // compost with visible woody bits — sits under shrubs and perennials
  "compost": "dark compost with visible small twigs, bark flecks and leaf fragments mixed through it",
  // straw mulch, for paths and around established plants
  "mulch-straw": "loose golden straw mulch, short clean straws lying flat and layered in all directions",
  // wood chip, for the paths between beds
  "mulch-chip": "wood chip mulch, irregular pale brown and grey chips lying flat, packed together"
};

const want = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const names = want.length ? want : Object.keys(TEXTURES);
const promptFor = (n) => STYLE.replace("{MATERIAL}", TEXTURES[n]);

if ((process.env.TEXTURES || "no") !== "yes") {
  console.log("Refusing to spend GPU time: set TEXTURES=yes to run this.");
  console.log(`would generate: ${names.join(", ")}`);
  process.exit(0);
}

mkdirSync(RAW, { recursive: true });
mkdirSync(OUT, { recursive: true });

// a mid-grey square as the seed input: no structure for the model to preserve, and mid-tone so it
// doesn't bias the render bright or dark
const GREY = join(RAW, "grey.png");
if (!existsSync(GREY)) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
    "color=c=0x808080:s=1024x1024", "-frames:v", "1", "-y", GREY]);
}

const engine = makeForgeEngine({ log: (m) => console.log(`  [forge] ${m}`) });
console.log(`seed ${SEED} · ${names.length} texture${names.length === 1 ? "" : "s"}`);
if (!(await engine.available())) { console.log("forge not answering"); process.exit(1); }
if (await engine.busy()) { console.log("forge busy — not colliding"); process.exit(2); }

let ok = 0;
const t0 = Date.now();
for (const name of names) {
  if (!TEXTURES[name]) { console.log(`${name}: no such texture`); continue; }
  process.stdout.write(`${name}: `);
  const t = Date.now();
  try {
    const out = await engine.plan({
      imageB64: readFileSync(GREY).toString("base64"),
      mime: "image/png",
      prompt: promptFor(name), seed: SEED, resolution: 1024
    });
    writeFileSync(join(RAW, `${name}-raw.png`), Buffer.from(out.imageB64, "base64"));
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", join(RAW, `${name}-raw.png`),
      "-vf", `scale=${PX}:${PX}:flags=lanczos`, "-frames:v", "1", "-y", join(OUT, `${name}.png`)]);
    ok++;
    console.log(`${((Date.now() - t) / 1000).toFixed(1)}s -> assets/textures/${name}.png`);
  } catch (e) {
    console.log(`FAILED: ${e.message}`);
  }
}
console.log(`\nVERDICT: ${ok === names.length ? "PASS" : "PARTIAL"} — ${ok}/${names.length} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
