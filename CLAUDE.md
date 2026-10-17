# CLAUDE.md — Permaculture AI

**Read `AGENTS.md` first — it is the rules file, and it applies to you.** This file only adds what Claude
Code needs on top of it: the commands, the measured facts that are expensive to rediscover, and the things
you must not do.

## What this is

A free tool: one photo of a yard in, one permaculture planting plan out. Static site + a dependency-free
Node service that runs on this Mac, with the GPU work (finding the beds) done on `forge`.

## Commands

```bash
node --test tests/*.mjs        # 78 tests, mock engine, never touches the network or the GPU
bash deploy/preflight.sh       # must print PREFLIGHT GREEN before anything is published
node server/dev.mjs            # the site + API on :8099 (starts nothing else)
node tools/forge-smoke.mjs     # one real render through forge — only when you mean to use the GPU
PLANTS=yes node tools/plants-sheet.mjs <crop-id>   # regenerate ONE sprite by id
```

## Never

- **Never publish, deploy, buy, or sign up for anything.** Publishing is Ryan's call: no DNS changes, no
  accounts, no spends, no emails. `deploy/publish.sh` exists for him to run.
- **Never preempt a forge job.** The public queue yields when ComfyUI is busy; if a render says `NOT RUN —
  forge has work queued`, that is the system working, not a failure to retry harder.
- **Never commit a secret.** Only env var *names* may appear in code. `.env` is ignored — keep it that way.
- **Never store an uploaded photo**, and never log image bytes.

## Measured facts — do not re-litigate these

- **Denoise stays 1.0** for every forge render. 0.55 returns mush; the photo is conditioning fed to the
  text encoder, not an initial latent, so the img2img intuition does not transfer. The measurements are in
  `BLOCKERS.md` under R1.
- **The image model locates, we draw.** Asking Qwen to paint over the beds redrew 44% of the background.
  Asking for a two-colour segmentation map returns a clean bed mask. So the model finds the beds; the
  overlay, the plants, the numbers and the layout are all drawn by our own code.
- **Sprites: seed 424242, anchor OFF, key 0xFF00FF, one fixed style clause.** Anchor ON destroyed content
  (a carrot came back as a tomato plant on a carrot root). Two of a "mix" is unreliable — a
  peas-and-oats cover crop rendered as oats alone twice until the description led with the peas.
- **The layout is the single source of numbers.** `api/plan-spec.mjs` numbers crop runs in bed order and
  the drawing, the bed list, the crop list and the phase steps all read from it. Anything that recomputes
  a count instead of reading the layout will drift.

## Copy discipline

- Cite or leave out. No preserving time, pressure, temperature or frost date from memory — point at
  USDA/NCHFP and NOAA.
- "Drawn to scale", never "numbered plan". "Concept layout", never "concept sketch".
- Pest advice is graded *proven / supported / folklore*, and the folklore does not get printed.

## Where the state lives

- `BLOCKERS.md` — the live list of what is broken and what would clear it. Newest first, resolved items
  kept with the measurement that resolved them.
- `FINISH-STEPS.md` — what is done and the four things that are Ryan's to do.
- `assets/demo-plan.json` — the payload the home page and the demo use. It is **generated**: run a plan
  through `api/handler.mjs` with the mock engine, then keep the existing `mask_data_url`. Don't hand-edit it.
