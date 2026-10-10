# Permaculture AI — build report

**Date:** 2026-10-10 · **Scope:** the whole site, built and verified locally. **Nothing was pushed,
deployed, bought or registered.**

## Verdict

**It runs.** The full site, the API, the queue, the caps, the lead store and the real forge engine are
built, tested and green — and the GPU path is **proven**, not assumed: one real render through the ported
Qwen-Image 2.1 edit graph came back in **24.3 s**. The one thing that isn't finished is the *drawing's
accuracy*: the model redraws the scene instead of drawing on top of it, so its numbered labels drift and
it invents plants. That is a prompt/parameter job, not a build job — details in BLOCKERS.md, and the
exact fix is named.

## Ran, with real output

### Tests — 28 passing, 0 failing

```
$ node --test tests/*.mjs
ℹ tests 28   ℹ pass 28   ℹ fail 0   ℹ duration_ms 4061
```

What they actually pin down (the tests exist because these are the things that break quietly):

- the response contract: a job id immediately, steps/window/disclaimer on completion — not a blocking render
- **image bytes are never logged** (asserted against a real base64 fragment of the fixture photo)
- 6 MB cap, mime whitelist, 1-per-person-per-day, global daily cap, queue-full
- **the ported graph is pinned**: dotted autogrow key `images.image_1`, `ComfySwitchNode` following the
  reference photo's latent, model path through `QwenImage21Cache` — the two silent failure modes
  forge-lab documented can't be reintroduced by a tidy-up
- a render that never finishes times out instead of hanging; forge down is treated as *busy*, never collided with
- the queue: FIFO, single-flight, `forge_down` and `busy` are held places with a human sentence,
  a job that never gets the GPU expires honestly after 45 minutes
- harvest windows: sourced rows only, unknown crop = `unknown` (never guessed), unknown zip refuses to
  invent a frost date, a passed season rolls forward instead of handing back a past date, the overwinter
  crop (garlic) is excluded from the headline glut and given its own line
- the lead store: append-only, dedupes, refuses malformed addresses, has no delete path

### The server, answering for real

```
$ node server/dev.mjs
$ curl -s localhost:8099/api/health
{"ok":true,"engine":"mock","forge":"up","uptime_seconds":10,
 "queue":{"depth":0,"served":0,"avg_seconds":45},
 "plans_today":0,"daily_cap":25,"visitors_today":0,"leads":0}
```

`forge: "up"` is a live probe of forge:8188. With `ENGINE=forge` the same endpoint is what drives the
status line on the public page.

### End to end over HTTP, with a real 1 MB photo

```
$ curl -s -X POST localhost:8097/api/plan -H 'content-type: application/json' -d @out/req.json
{"job_id":"926ac596-ef5","state":"queued","position":1,"eta_seconds":45,"remaining_today":24}

$ curl -s localhost:8097/api/plan/926ac596-ef5
state: done   engine: mock
steps: PLANT,SOIL,WATER,BUILD,HARVEST
windows: Tomato 2027-08-06 | Bush bean 2027-07-27 | Zucchini Jul 22 | Kale Jul 20 | Garlic 2027-05-19
glut: 2027-07-20 -> 2027-08-31 | next season: Garlic, planted 2026-10-21, off 2027-05-19
image: 1029 KB data url returned inline
disclaimer: Concept sketch only — not construction drawings, not a sur...

$ cat out/e2e-leads.csv
email,source,zip,created_at,note
ryan@example.com,plan,04578,2026-10-10T06:20:58Z,submitted a photo

$ (same photo again, same IP)
HTTP 429  {"error":"per_ip_cap","message":"One free plan per person per day — the
           machine only has so many hours."}
```

Note the dates: **2027**, not 2026 — October is past tomato season, so the plan correctly rolls to next
year rather than handing a visitor harvest dates in the past.

### The forge smoke test — **PASS**

```
$ FORGE_SMOKE=yes node tools/forge-smoke.mjs
VERDICT: PASS — 2394 KB in 24.3s
wrote   out/forge-smoke.png
```

One GPU job for the whole night, at 1K / 25 steps, submitted only after checking ComfyUI's queue was
empty so nothing collided with a Forge Lab render. Wall time **24.3 s** per plan is the number the ETA
estimate should be built on (the queue currently guesses 45 s, which is conservative — worth tuning).

### Screenshots — `out/shots/`

| File | What it shows |
|---|---|
| `index-desktop.png`, `index-phone.png`, `index-full.png` | landing page, 1500 wide and 390 wide |
| `plan-desktop.png`, `plan-phone.png` | the tool: drop zone, email, zip, the queue panel |
| `plan-result-full.png` | **a filled-in result** — the real render, five steps, the preservation window |
| `product-desktop.png`, `product-phone.png`, `product-full.png` | The Preservation Run page + waitlist |
| `terms-desktop.png`, `privacy-desktop.png`, `thanks-desktop.png` | the rest |

The result page is real: `plan.html#demo` loads `assets/demo-plan.json`, which is a captured API
response (same steps, same windows) paired with the actual render from the smoke test. Every date in it
came out of `api/crops.json` — tomato Aug 6, bush bean Jul 27, zucchini Jul 22, kale Jul 20, garlic
May 19, headline glut **Jul 20 – Aug 31**.

### Preflight

```
$ bash deploy/preflight.sh
1. tests ................ ok (28 pass)
2. pages present ........ ok (7 files, no unresolved tokens)
3. no secrets tracked ... ok
4. leads.csv ignored .... ok
5. server answers ....... ok (health + index.html 200)
6. forge reachable ...... ok
PREFLIGHT GREEN — safe to publish.
```

## What's built

`~/permaculture-ai-site` — no dependencies, Node 26 stdlib only.

- `api/handler.mjs` — socket-free router (`handle(req) -> {status, json}`); liftable into a Worker
- `api/engine/forge.mjs` — the ported, verified Qwen-Image 2.1 edit graph + upload/submit/poll
- `api/engine/mock.mjs` — what all 28 tests run against (no GPU, no network)
- `api/queue.mjs` — single-flight FIFO, positions, ETA, `forge_down` / `busy` / `expired` as
  first-class states, yields to any existing ComfyUI work
- `api/crops.json` — 15 crops, every row with a `source`, and **no preserving times anywhere** (the
  methods are named and the USDA/NCHFP guide is pointed at instead)
- `api/harvest.mjs` — the hinge: crops → dated windows, with honest uncertainty
- `api/ratelimit.mjs`, `api/leads.mjs` — caps and an append-only CSV list Ryan owns
- `server/dev.mjs` — pages + API on one port, no Cloudflare account needed
- 7 pages in the garden-gate direction you picked, `deploy/README.md` with the exact publish steps,
  `deploy/preflight.sh` and `deploy/publish.sh`
- `content/site-copy.md` — every string on the site, in one file, for your edit

## Decisions I made on your behalf (all reversible, all one-liners)

1. **Email is optional at submit, not a toll.** Making people pay an address to use a free toy costs more
   plans than it earns addresses; the queue gives an honest reason to leave one. Copy encourages it.
2. **The step list is deterministic, not generated.** The labelled list is fixed *before* the render and
   handed to the image model, so step (1) and label (1) can't drift apart. No LLM is in the loop at all.
3. **A season that has closed rolls forward.** In October, the plan is for next year — otherwise the tool
   would hand a visitor harvest dates in the past.
4. **Garlic is excluded from the headline glut window.** It's planted in the fall and comes off the
   following May/June; folding it in turned "your glut is July to August" into nonsense.
5. **`deploy/preflight.sh` refuses to publish on a red check** — including a check that `leads.csv` is
   genuinely gitignored.

## Not run / needs Ryan

- **Prompt/parameter pass on the drawing** — see BLOCKERS.md #1. Needs one more GPU render, which I did
  not spend without you.
- **No email is sent by anything.** The list is collected and inert until an ESP is wired (Buttondown is
  the fit: one signup, one API key). This is stated on `/privacy.html` rather than hidden.
- **No repo created, nothing pushed.** Repo name must be `permaculture-ai-site` — GitHub repo names are
  case-insensitive and `Permaculture-AI` already exists as your old sketch.
- **No domain, no tunnel hostname.** `deploy/README.md` §2–3 has the exact steps and the DNS-only trap.
- **The demo photo is your own yard** (and your dog, who declined to be drawn). Fine as-is because you own
  it; if you'd rather the public before/after wasn't your property, say so and I'll swap it.

## Next 3 decisions

1. **Do the drawing pass?** One render at `denoise` 0.5–0.6 with a hardened prompt ("the beds are empty;
   do not add plants that are not listed") — likely fixes both the invented crops and the drifting
   numbers. One GPU job, ~30 s.
2. **Publish or keep it local?** It's push-ready now: `bash deploy/publish.sh`, or keep serving it on the
   LAN/phone until you've looked at it properly.
3. **ESP before or after the first publish?** The list only becomes an asset the moment something can
   send mail.
