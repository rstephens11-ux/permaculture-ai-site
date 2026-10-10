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

export function buildGraph({ imageName, prompt, seed = 0, steps = 25, resolution = 1024 }) {
  return {
    "451": { class_type: "UNETLoader", inputs: { unet_name: UNET, weight_dtype: "default" } },
    "453": { class_type: "CLIPLoader", inputs: { clip_name: CLIP, type: "qwen_image" } },
    "454": { class_type: "VAELoader", inputs: { vae_name: VAE } },
    "469": { class_type: "QwenImage21Cache", inputs: { model: ["451", 0], device: "auto", dtype: "default" } },
    "470": { class_type: "LoadImage", inputs: { image: imageName } },
    "474": {
      class_type: "TextEncodeQwenImage21",
      inputs: {
        clip: ["453", 0],
        prompt,
        negative_prompt: "",
        resolution,
        // dotted autogrow key — see trap 1 above. Do not "tidy" this into a dict.
        "images.image_1": ["470", 0],
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
        sampler_name: "euler", scheduler: "simple", denoise: 1.0
      }
    },
    "457": { class_type: "VAEDecode", inputs: { samples: ["458", 0], vae: ["454", 0] } },
    "461": { class_type: "SaveImage", inputs: { images: ["457", 0], filename_prefix: "permaculture_ai" } }
  };
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

    async plan({ imageB64, mime, prompt }) {
      const bytes = Buffer.from(imageB64, "base64");

      // 1. upload the photo into ComfyUI's input dir under a unique name
      const name = `yard-${Date.now()}-${randomUUID().slice(0, 6)}.${mime === "image/png" ? "png" : "jpg"}`;
      const form = new FormData();
      form.append("image", new Blob([bytes], { type: mime }), name);
      form.append("type", "input");
      form.append("overwrite", "true");
      const up = await fetch(`${base}/upload/image`, { method: "POST", body: form });
      if (!up.ok) throw new Error(`upload failed: HTTP ${up.status}`);
      const upJson = await up.json().catch(() => ({}));
      const imageName = upJson.name || name;

      // 2. submit
      const graph = buildGraph({ imageName, prompt, seed: Math.floor(Math.random() * 1e9) });
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
