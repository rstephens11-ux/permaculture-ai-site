# Blockers and known gaps

Honest list, newest state first. Each one names what would clear it. Anything resolved is moved to
`RESOLVED.md`-style notes below it rather than deleted, because the measurement that killed a wrong idea is
worth more than the idea was.

## 1. The tool cannot be reached from the published domain — **the real one now**

**What happens.** `assets/js/config.js` has `apiBase: ""`, so the live site posts to its own origin. On
GitHub Pages that origin has no API: the demo works because it is a static file, and a real "Plan my yard"
would fail. Nothing is tunnelled right now (no cloudflared, no ngrok).

**Why it is built this way.** The planner runs on this Mac and the bed-finding runs on forge, so there is no
server to point at — the site is published, the tool is at home.

**What clears it.** Pick one, in order of cost:

1. **Cloudflare tunnel** to the local server, then `apiBase` = the tunnel hostname. Free; the tool is up
   while the Mac is awake (the `com.ryan.forgelab-keepawake` agent already holds AC power on).
2. **Tailscale Funnel** — Tailscale is already running, and Funnel gives a public HTTPS name without a new
   account. Same always-on caveat.
3. **Host the API somewhere always-on** — the honest fix if this ever has real traffic, and the only one
   with a real cost.

None of it is my call, and the site degrades honestly until it is done: the plan page says the machine that
draws these isn't reachable from this address yet, rather than spinning.

## 2. Nothing can send email yet

The list is collected in `leads.csv` and is inert. This matters more than it reads: the site **asks for an
email at the gate** ("that was your free plan"), which implies something will be sent. It won't, until an ESP
is wired. One Buttondown (or beehiiv/Kit) signup plus an API key clears it. Stated plainly on
`/privacy.html`.

Also honest about the gate itself: with no confirmation email there is no verification, so it is an honour
system with teeth against casual scraping and none against someone typing `a@a.com`. Fine for a free tool,
not fine for anything paid.

## 3. The public path is documented but not exercised

`deploy/README.md` has the steps (GitHub Pages for the pages, one tunnel hostname for the API). None of it
has been run, because none of it is my call. Two things to know before you do:

- GitHub Pages records must stay **DNS-only (grey cloud)** — a proxied record plus Pages' HTTPS-everywhere
  produces a redirect loop.
- The tool is only up while **this Mac is awake and forge is up**. There's a LaunchAgent recipe in §4 of the
  deploy README; without it the server dies on restart and the free tool goes quiet while still looking
  alive.

## 4. The demo photo is your property

`assets/img/sample-before.jpg` and `sample-overlay.jpg` are your garden, with your dog at the end of the
beds. You own it, so it's clean — but it is a public before/after of your yard on the marketing page. Say the
word and I'll swap in a neutral photo.

## 5. Small things, recorded so they don't get lost

- **The photo has to travel for the beds to be found.** The segmentation runs on forge, so the photo leaves
  the browser — read in memory, never written to disk, never to a cloud service (`/privacy.html` says
  exactly this and nothing stronger). Making it *never leave the device* is possible but costs the beds:
  the fallback sheet drawing is all a local-only mode could produce. Offered as a checkbox, not done,
  because it changes what the product is.
- **The sprite set is 35 MB of PNGs.** Fine at this size and served per-need; it should move to WebP if the
  crop list ever doubles.
- `forge.mjs` polls every 2 s; with a real ~24 s render that's fine, but the first poll always waits the
  full interval. Worth a shorter first interval if the tool ever feels slow.
- The queue is in memory: a restart drops lines. Accepted (the page tells people to resend), documented in
  `AGENTS.md`.
- `api/crops.json` days-to-maturity are typical catalog ranges, labelled as estimates in every row. If this
  ever becomes a paid claim, source them properly per variety.
- The zip→frost table only covers the Northeast on purpose. Everywhere else gets "confirm your own frost
  dates" rather than a made-up date — intended behaviour, not a gap to paper over.
- Hawaii and Puerto Rico resolve to *"the nearest station in our records is 2,297 miles away, which is too
  far to be your weather."* The NOAA 1991-2020 freeze normals those places need are not published; better
  than a confident wrong date.

---

# Resolved, with the measurement that resolved it

## R1. The drawing redrew the scene instead of drawing on top of it — **solved by giving up on one model doing both jobs**

**Was.** The render looked like a plan but did not preserve the photo: beds re-imagined with invented
plants, a neighbour's brick house appeared, the dog came back as a cat, and the numbered labels drifted
(one duplicated, two pointing at a fence post).

**Measured, 2026-10-12.** Same photo, three real renders:

| Attempt | Result | Time |
|---|---|---|
| `denoise 1.0`, original prompt | redrawn scene, invented crops, labels drifted | 24.3 s |
| `denoise 0.55`, hardened prompt | **mush — an abstract texture. Unusable.** | 20.4 s |
| `denoise 1.0`, hardened prompt ("add nothing") | still a redraw, numbers still wrong (1,2,3,5 — no 4) | 24.2 s |

So denoise was not the lever and no prompt could force "add nothing": in this graph the photo is
**conditioning fed to the text encoder**, not an initial latent, so low denoise starves it. The img2img
intuition does not transfer. `denoise 1.0` stands, with this table above the constant so nobody re-tries it.

**Second measurement, and the one that settled it.** Asked to *paint over* the beds, the model redrew **44%
of the background** (26.1 mean pixel change outside the bed areas). Asked for a **two-colour segmentation
map** instead, it returned a clean, correct bed mask.

**Decision, and the architecture that came out of it:** the model **locates**, we **draw**.

- Qwen returns a bed mask — the only per-visit GPU job, and it is **optional**: if forge is down or the
  render fails, the queue hands back the plan after a 15 s grace and the client falls back to laying the
  plan sheet over the most open ground. (Proved under load: forge was busy for an hour and every plan would
  still have been served.)
- Everything visible is ours: beds found in the mask, filled with dirt, plants drawn from a fixed sprite
  set at the spacing in the crop table, and the numbers drawn by us — so a number cannot point at the wrong
  thing.
- The original photo is **kept as the base**, which was the actual ask.
