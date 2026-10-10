# Permaculture AI — the site

Photograph your yard, get a planting plan. Free, self-hosted: the image model runs on the
forge box's own GPU (ComfyUI, Qwen-Image 2.1 *edit*), not a cloud API.

The paid product on the site — **The Preservation Run** — is not built yet; `product.html` is a
waitlist.

Plan this was built from: `~/.hermes/plans/2026-10-10_014911-permaculture-ai-site-v2.md`

## Run it locally

```bash
cp .env.example .env          # ENGINE=forge by default; use ENGINE=mock to test with no GPU
node server/dev.mjs           # -> http://localhost:8099
```

`/api/health` reports whether forge is reachable, the queue depth, and how many plans have been
made today.

## Test

```bash
node --test tests/            # all tests use the mock engine — no network, no GPU
```

## Layout

```
index.html  plan.html  product.html  thanks.html  terms.html  privacy.html
assets/      site.css, tool.js, leads.js
api/         handler.mjs (routes), crops.json (sourced crop table), harvest.mjs,
             queue.mjs (single-flight + FIFO), ratelimit.mjs, leads.mjs (append-only CSV)
api/engine/  index.mjs (pick by env), mock.mjs (tests), forge.mjs (ComfyUI on forge)
server/      dev.mjs — serves the site and mounts the API on one port
tests/       node --test, fixtures/garden-sample.jpg
deploy/      README.md (exact publish steps), preflight.sh, publish.sh
content/     site-copy.md — every string on the site, in one file, for editing
sketches/    the three design directions considered (001-garden-gate-playful won)
out/         screenshots + smoke-test output (gitignored)
```

## The two things that make this work

1. **The harvest window.** The tool already knows what you're planting, so it says when each crop
   lands (from `api/crops.json`, every row sourced). That window is what The Preservation Run sells
   the plan for.
2. **The queue.** There is one GPU. A job that can't run yet keeps the user's place in line instead
   of failing, and when forge is down the page says so and takes the email rather than losing the
   visitor.

## Rules for this repo

- **No secret in the browser.** Only the server talks to forge. Nothing in `assets/` ever holds a key.
- **Never store an uploaded photo.** Base64 in memory, forwarded, dropped. Log counters, not images.
- **No unsourced advice.** `api/crops.json` rows carry a `source`. No processing time, frost date or
  hardiness claim is ever written from memory.
- **Concept, not construction.** The output is a concept overlay. The disclaimer stays on the page.
- **Forge Lab comes first.** The public job waits if ComfyUI already has work. Never preempt a render.
