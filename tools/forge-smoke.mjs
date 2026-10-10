// tools/forge-smoke.mjs — ONE real GPU render, to prove the ported graph works end to end.
//
// This is the single fact the whole free tool rests on. It costs one 1K image on the workshop GPU and
// it refuses to run unless FORGE_SMOKE=yes, so nobody triggers it by accident.
//
//   FORGE_SMOKE=yes node tools/forge-smoke.mjs
//
// Writes out/forge-smoke.png and prints the wall time.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeForgeEngine } from "../api/engine/forge.mjs";
import { buildPlan } from "../api/plan-spec.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

if ((process.env.FORGE_SMOKE || "no") !== "yes") {
  console.log("Refusing to spend GPU time: set FORGE_SMOKE=yes to run this.");
  process.exit(0);
}

const photo = readFileSync(join(ROOT, "tests/fixtures/garden-sample.jpg"));
const spec = buildPlan({ zip: "04578" });
const engine = makeForgeEngine({ log: (m) => console.log(`[forge] ${m}`) });

console.log(`engine: forge at ${process.env.FORGE_BASE_URL || "http://forge:8188"}`);
console.log(`photo:  ${(photo.length / 1024).toFixed(0)} KB`);
console.log(`labels: ${spec.labels.map((l) => `(${l.n}) ${l.text}`).join(", ")}`);
console.log("prompt:", spec.prompt);
console.log("submitting…");

if (!(await engine.available())) {
  console.log("VERDICT: FAIL — forge is not answering. Nothing was rendered.");
  process.exit(1);
}
if (await engine.busy()) {
  console.log("VERDICT: NOT RUN — forge has work queued; refusing to collide with a render.");
  process.exit(2);
}

const t0 = Date.now();
try {
  const out = await engine.plan({
    imageB64: photo.toString("base64"),
    mime: "image/jpeg",
    prompt: spec.prompt
  });
  const secs = (Date.now() - t0) / 1000;
  mkdirSync(join(ROOT, "out"), { recursive: true });
  const buf = Buffer.from(out.imageB64, "base64");
  writeFileSync(join(ROOT, "out/forge-smoke.png"), buf);
  console.log(`VERDICT: PASS — ${(buf.length / 1024).toFixed(0)} KB in ${secs.toFixed(1)}s`);
  console.log(`wrote   out/forge-smoke.png`);
  console.log(`gpu-seconds: ${secs.toFixed(1)}`);
} catch (err) {
  const secs = (Date.now() - t0) / 1000;
  console.log(`VERDICT: FAIL — ${err.message} (after ${secs.toFixed(1)}s)`);
  console.log("The free tool's forge path is NOT proven. Say so in the morning report.");
  process.exit(1);
}
