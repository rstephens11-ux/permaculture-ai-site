// api/engine/index.mjs — engine selection. One place decides, so no route ever guesses.

import { makeMockEngine } from "./mock.mjs";
import { makeForgeEngine } from "./forge.mjs";

export function makeEngine(name = process.env.ENGINE || "mock", opts = {}) {
  if (name === "forge") return makeForgeEngine(opts);
  return makeMockEngine();
}
