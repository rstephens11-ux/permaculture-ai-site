// api/engine/forge.mjs — the real engine: ComfyUI on the forge box, Qwen-Image 2.1 "edit".
//
// This is a PORT, not an invention. The graph below is forge-lab's verified `qwen_edit` graph
// (forge_lab.py:99, header comment "edit image qwen_edit (verified: prompt 47774a56)"): the unet goes
// through QwenImage21Cache, the reference image is spliced in by the text encoder as a latent, and
// ComfySwitchNode picks the encoder's latent so the output canvas follows the reference photo.
//
// Two documented traps carried over from forge-lab, both of which fail SILENTLY:
//   1. Autogrow inputs need DOTTED keys. `"images.image_1"`, not a nested {"images": {...}} dict.
//      A nested dict validates and runs, and the reference is quietly ignored — you get plain t2i.
//   2. ComfyUI streams progress only to the websocket that submitted the prompt, so client_id is
//      generated per process.
//
// And one rule of our own (AGENTS.md): the public job YIELDS. If Forge Lab has work in the ComfyUI
// queue, we do not submit. A stranger's garden sketch never interrupts a render.

import { randomUUID } from "node:crypto";

const UNET = "qwen_image_2.1_int8_convrot.safetensors";
const CLIP = "qwen3vl_8b_int8_convrot.safetensors";
const VAE = "qwen_image_2.1_vae_bf16.safetensors";
const CLIENT_ID = "permaculture-ai-" + randomUUID().slice(0, 8);

// MEASURED, 2026-10-12 — read this before changing the number.
//
// The theory was that forge-lab's denoise 1.0 was the reason a "plan overlay" came back as a redraw of the
// scene (empty beds sprouting tomatoes, a neighbour's house appearing). It isn't the reason. Three real
// renders of the same photograph, 1K/25 steps on a 3090:
//
//   denoise 1.0, original prompt  -> a redrawn scene with invented crops; labels drifted      24.3s
//   denoise 0.55, harder prompt   -> mushy abstract texture. Useless.                         20.4s
//   denoise 1.0, harder prompt    -> still a redraw; still invented plants; labels still drift 24.2s
//
// Why low denoise fails here: in this graph the reference photo is CONDITIONING fed to the text encoder
// (images.image_1 -> latent), not an initial latent for the sampler. Qwen-Image 2.1 expects to run at
// full denoise with the reference as conditioning; starve it and you get mush. The img2img intuition
// ("lower denoise preserves more of the input") does not apply to this graph.
//
// So: 1.0 stands, and the drawing's accuracy has to be fixed properly — see BLOCKERS.md. The short
// version: stop asking the image model to draw the numbered beds (it will not obey "add nothing"), let it
// do what it is good at, and draw the numbered markers ourselves where we control every position.
const OVERLAY_DENOISE = Number(process.env.FORGE_DENOISE || 1.0);

/**
 * THE MASK PROMPT — the one thing this model is asked to do for a visitor now.
 *
 * Measured 2026-10-12, same photo, 1K/25 steps: asked to PAINT the plan onto the photo, it redraws 44% of
 * the background (26.1 mean pixel change outside the beds) — a convincing lie, not our photograph. Asked
 * for a two-colour SEGMENTATION MAP instead, it returns a clean black-and-white mask whose white regions
 * are exactly the raised beds. So it locates, and we draw. See tools/overlay experiments and BLOCKERS.md.
 */
export const MASK_PROMPT = [
  "A flat two-colour segmentation map of this photograph.",
  "The wooden raised garden beds are pure white.",
  "Everything else — the fence, the trees, the ground, the sky, the gravel and any animal or person —",
  "is pure black. Hard edges, no grey, no shading, no outlines, no gradients, no text."
].join(" ");

export function buildGraph({ imageName, imageNames, prompt, seed = 0, steps = 25, resolution = 1024, denoise = OVERLAY_DENOISE }) {
  const refs = (imageNames && imageNames.length ? imageNames : [imageName]).filter(Boolean);
  const graph = {
    "451": { class_type: "UNETLoader", inputs: { unet_name: UNET, weight_dtype: "default" } },
    "453": { class_type: "CLIPLoader", inputs: { clip_name: CLIP, type: "qwen_image" } },
    "454": { class_type: "VAELoader", inputs: { vae_name: VAE } },
    "469": { class_type: "QwenImage21Cache", inputs: { model: ["451", 0], device: "auto", dtype: "default" } },
    "474": {
      class_type: "TextEncodeQwenImage21",
      inputs: {
        clip: ["453", 0],
        prompt,
        negative_prompt: "",
        resolution,
        vae: ["454", 0]
      }
    },
    "456": { class_type: "EmptyLatentImage", inputs: { width: resolution, height: resolution, batch_size: 1 } },
    // switch False -> on_false -> the encoder's latent (canvas follows image_1)
    "468": { class_type: "ComfySwitchNode", inputs: { switch: false, on_false: ["474", 2], on_true: ["456", 0] } },
    "458": {
      class_type: "KSampler",
      inputs: {
        model: ["469", 0], positive: ["474", 0], negative: ["474", 1],
        latent_image: ["468", 0], seed, steps, cfg: 1.0,
        sampler_name: "euler", scheduler: "simple", denoise
      }
    },
    "457": { class_type: "VAEDecode", inputs: { samples: ["458", 0], vae: ["454", 0] } },
    "461": { class_type: "SaveImage", inputs: { images: ["457", 0], filename_prefix: "permaculture_ai" } }
  };

  // One LoadImage per photo. The first is the canvas; the rest are extra context, which is worth having
  // because a yard is not one photograph. Keys stay DOTTED (see trap 1 above) — a nested dict validates,
  // runs, and silently ignores every reference.
  refs.forEach((name, i) => {
    const node = `load${i + 1}`;
    graph[node] = { class_type: "LoadImage", inputs: { image: name } };
    graph["474"].inputs[`images.image_${i + 1}`] = [node, 0];
  });

  return graph;
}

export function makeForgeEngine({
  baseUrl = process.env.FORGE_BASE_URL || "http://forge:8188",
  timeoutS = Number(process.env.FORGE_TIMEOUT_S || 300),
  log = () => {}
} = {}) {
  const base = baseUrl.replace(/\/$/, "");
  const pollMs = 2000;

  async function jget(path, ms = 8000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(base + path, { signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  return {
    name: "forge",
    denoise: OVERLAY_DENOISE,

    /** Is the ComfyUI box answering at all? */
    async available() {
      try {
        await jget("/system_stats", 4000);
        return true;
      } catch {
        return false;
      }
    },

    /** Does Forge Lab (or anyone else) already have work queued? If so, we wait. */
    async busy() {
      try {
        const q = await jget("/queue", 6000);
        const running = (q.queue_running || []).length;
        const pending = (q.queue_pending || []).length;
        if (running || pending) log(`forge busy: ${running} running, ${pending} pending — yielding`);
        return running > 0 || pending > 0;
      } catch {
        // Can't tell — treat as unavailable rather than risk colliding.
        return true;
      }
    },

    /**
     * @param {{imageB64?: string, images?: object[], mime?: string, prompt: string,
     *          seed?: number, resolution?: number}} opts
     * `seed` and `resolution` exist for the plant sprite sheet: a batch of 21 assets that has to look
     * like one illustrator drew them, which needs a fixed seed rather than a fresh dice roll per call.
     * The per-visit render leaves both undefined, so nothing about it changes.
     */
    async plan({ imageB64, images, mime, prompt, seed, resolution }) {
      const photos = (images && images.length ? images : [{ b64: imageB64, mime }]).filter((p) => p && p.b64);

      // 1. upload each photo into ComfyUI's input dir under a unique name
      const names = [];
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        const ext = p.mime === "image/png" ? "png" : p.mime === "image/webp" ? "webp" : "jpg";
        const name = `yard-${Date.now()}-${i}-${randomUUID().slice(0, 6)}.${ext}`;
        const form = new FormData();
        form.append("image", new Blob([Buffer.from(p.b64, "base64")], { type: p.mime }), name);
        form.append("type", "input");
        form.append("overwrite", "true");
        const up = await fetch(`${base}/upload/image`, { method: "POST", body: form });
        if (!up.ok) throw new Error(`upload failed: HTTP ${up.status}`);
        const upJson = await up.json().catch(() => ({}));
        names.push(upJson.name || name);
      }

      // 2. submit
      const graph = buildGraph({
        imageNames: names, prompt,
        seed: seed == null ? Math.floor(Math.random() * 1e9) : seed,
        resolution: resolution || 1024,
        denoise: this.denoise
      });
      const sub = await fetch(`${base}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: graph, client_id: CLIENT_ID })
      });
      if (!sub.ok) throw new Error(`submit failed: HTTP ${sub.status} ${await sub.text().catch(() => "")}`.slice(0, 300));
      const { prompt_id: pid } = await sub.json();
      if (!pid) throw new Error("submit returned no prompt_id");

      // 3. poll for the result
      const deadline = Date.now() + timeoutS * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, pollMs));
        let hist;
        try {
          hist = await jget(`/history/${pid}`, 25000);
        } catch {
          continue; // a dropped poll is not a failed render — keep waiting
        }
        const entry = hist && hist[pid];
        if (!entry) continue;
        const out = entry.outputs && entry.outputs["461"];
        const img = out && out.images && out.images[0];
        if (img) {
          const q = new URLSearchParams({
            filename: img.filename,
            subfolder: img.subfolder || "",
            type: img.type || "output"
          });
          const r = await fetch(`${base}/view?${q}`);
          if (!r.ok) throw new Error(`view failed: HTTP ${r.status}`);
          const buf = Buffer.from(await r.arrayBuffer());
          return { imageB64: buf.toString("base64"), mime: "image/png", engine: "forge", gpu_seconds: null };
        }
        const status = entry.status && entry.status.status_str;
        if (status === "error") throw new Error("comfy reported an error for this prompt");
      }
      throw new Error(`forge timed out after ${timeoutS}s`);
    }
  };
}
