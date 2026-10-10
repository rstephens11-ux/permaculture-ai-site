# AGENTS.md — rules for anything working in this repo

Read `README.md` first. This is a small, dependency-free Node service + static site. Keep it that way.

## Ground rules

1. **No npm dependencies.** Node 26 stdlib only (`node:http`, `node:fs`, `node:crypto`, `node:test`).
   If you think you need a package, you almost certainly don't.
2. **No secret ever reaches the browser.** `assets/` is inert. Only `api/` and `server/` may talk to forge.
3. **Never store an uploaded photo.** Base64 in memory → engine → dropped. Log byte counts and timings,
   never image data. This is a privacy promise printed on the site; keep it true.
4. **No unsourced advice.** `api/crops.json` rows must carry a `source`. Do not add a processing time,
   a frost date, or a hardiness claim from memory. Preserving times are *referenced*, never copied in.
5. **The output is a concept overlay.** The disclaimer string stays in the API response and on the page.
6. **Forge Lab comes first.** The public queue yields when ComfyUI already has work. Never kill or
   preempt a Forge Lab render.
7. **Tests use the mock engine.** `node --test tests/` must never touch the network or the GPU.

## Where things live

- `api/handler.mjs` — transport-agnostic request router. Everything enters here. Returns
  `{status, headers, json|body}`; the caller owns sockets. Keep it that way so it can be lifted into a
  Cloudflare Worker unchanged.
- `api/engine/index.mjs` — engine selection by `ENGINE`. `mock` for tests, `forge` for real.
- `api/queue.mjs` — single-flight FIFO with ETA. Jobs live in memory; a restart drops the queue
  (acceptable: the site tells the user to resubmit).
- `api/crops.json` — the crop table. Data only, no logic.
- `server/dev.mjs` — static files + `/api/*` on one port.

## Style

- ESM `.mjs`, no TypeScript, 2-space indent, `camelCase` functions, `SCREAMING_SNAKE` env keys.
- Errors from the API are `{error: "code", message: "human sentence"}` with a status that means it.
- Comments explain *why*, never *what*. No emoji in code.
