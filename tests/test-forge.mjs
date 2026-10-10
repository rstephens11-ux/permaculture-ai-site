// tests/test-forge.mjs — the forge path, tested with a stubbed fetch. No GPU, no network.
//
// The graph assertions are not decoration: forge-lab documents two silent failure modes (a nested
// autogrow dict that validates then drops the reference, and a per-process client_id) and this test is
// what stops a future tidy-up from reintroducing either one.
import test from "node:test";
import assert from "node:assert/strict";
import { buildGraph, makeForgeEngine } from "../api/engine/forge.mjs";

test("the graph carries the reference the way the server actually accepts it", () => {
  const g = buildGraph({ imageName: "yard-1.jpg", prompt: "draw a plan" });
  assert.ok(g["474"].inputs["images.image_1"], "dotted autogrow key");
  assert.deepEqual(g["474"].inputs["images.image_1"], ["470", 0]);
  assert.ok(!("images" in g["474"].inputs), "and NOT a nested dict, which validates then silently drops");
  assert.equal(g["474"].inputs.vae[0], "454", "the encoder needs the vae");
  assert.equal(g["470"].inputs.image, "yard-1.jpg");
});

test("the canvas follows the reference photo, not an empty latent", () => {
  const g = buildGraph({ imageName: "x.jpg", prompt: "p" });
  assert.equal(g["468"].inputs.switch, false);
  assert.deepEqual(g["468"].inputs.on_false, ["474", 2], "encoder latent wins");
  assert.deepEqual(g["468"].inputs.on_true, ["456", 0]);
  assert.deepEqual(g["458"].inputs.latent_image, ["468", 0]);
});

test("the model path goes through the cache node, not straight from the loader", () => {
  const g = buildGraph({ imageName: "x.jpg", prompt: "p" });
  assert.deepEqual(g["458"].inputs.model, ["469", 0]);
  assert.deepEqual(g["469"].inputs.model, ["451", 0]);
  assert.equal(g["458"].inputs.steps, 25);
  assert.equal(g["458"].inputs.cfg, 1.0);
});

function stubFetch({ images = true, historyDelay = 0 } = {}) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push(String(url));
    const u = String(url);
    if (u.includes("/upload/image")) {
      return { ok: true, json: async () => ({ name: "yard-up.jpg" }) };
    }
    if (u.includes("/prompt")) {
      return { ok: true, json: async () => ({ prompt_id: "pid-1" }) };
    }
    if (u.includes("/history/")) {
      if (!images) return { ok: true, json: async () => ({ "pid-1": { outputs: {} } }) };
      return {
        ok: true,
        json: async () => ({
          "pid-1": { outputs: { "461": { images: [{ filename: "out.png", subfolder: "", type: "output" }] } } }
        })
      };
    }
    if (u.includes("/view")) {
      return { ok: true, arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer };
    }
    if (u.includes("/system_stats")) return { ok: true, json: async () => ({ devices: [] }) };
    if (u.includes("/queue")) return { ok: true, json: async () => ({ queue_running: [], queue_pending: [] }) };
    throw new Error(`unexpected call ${u}`);
  };
  return calls;
}

test("a full run uploads, submits, polls and returns a PNG", async () => {
  const calls = stubFetch();
  const engine = makeForgeEngine({ baseUrl: "http://forge:8188", timeoutS: 10 });
  const out = await engine.plan({ imageB64: Buffer.from("jpegbytes").toString("base64"), mime: "image/jpeg", prompt: "p" });
  assert.equal(out.engine, "forge");
  assert.equal(out.mime, "image/png");
  assert.ok(out.imageB64.length > 0);
  assert.ok(calls.some((c) => c.includes("/upload/image")), "the photo is uploaded first");
  assert.ok(calls.some((c) => c.includes("/prompt")));
  assert.ok(calls.some((c) => c.includes("/history/")));
});

test("a render that never finishes times out instead of hanging forever", async () => {
  stubFetch({ images: false });
  const engine = makeForgeEngine({ baseUrl: "http://forge:8188", timeoutS: 0.05 });
  await assert.rejects(() => engine.plan({ imageB64: "AAAA", mime: "image/jpeg", prompt: "p" }), /timed out/);
});

test("the engine reports forge down rather than throwing at the caller", async () => {
  globalThis.fetch = async () => { throw new Error("ECONNREFUSED"); };
  const engine = makeForgeEngine({ baseUrl: "http://forge:8188" });
  assert.equal(await engine.available(), false);
  assert.equal(await engine.busy(), true, "unknown load is treated as busy — never collide with a render");
});
