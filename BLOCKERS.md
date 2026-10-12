# Blockers and known gaps

Honest list. Each one names what would clear it.

## 1. The drawing redraws the scene instead of drawing on top of it — **the real one**

**What happens.** The render is good-looking and unmistakably a plan, but it does not preserve the photo
as an underlay: the beds are re-imagined with plants in them (tomatoes, garlic bulbs), a neighbour's brick
house appears, and the dog comes back as a cat. The numbered labels are placed, but they drift — one
number is duplicated and two of them point at the wrong thing (a fence post, a bed frame).

**Why.** The ported graph runs `denoise: 1.0`. That's the correct setting for forge-lab's *edit* mode
(turn a photo into something else) and the wrong setting for an *overlay* mode (change a little, keep
everything else). At 1.0 the sampler is free to rebuild the whole frame, and it does.

**MEASURED, 2026-10-12 — three real renders of the same photo, and the theory was wrong.**

| Attempt | Result | Time |
|---|---|---|
| `denoise 1.0`, original prompt | redrawn scene, invented crops, labels drifted | 24.3 s |
| `denoise 0.55`, hardened prompt | **mush — an abstract texture. Unusable.** | 20.4 s |
| `denoise 1.0`, hardened prompt (the "add nothing" negative) | still a redraw, still invented plants, numbers still wrong (1,2,3,5 — no 4) | 24.2 s |

So denoise is **not** the lever, and the prompt cannot force "add nothing" either. The reason low denoise
fails: in this graph the photo is **conditioning fed to the text encoder** (`images.image_1` → latent), not
an initial latent for the sampler. Qwen-Image 2.1 expects full denoise with the reference as conditioning;
starve it and you get mush. The img2img intuition does not transfer. The engine is therefore back on
`denoise 1.0` with the measurement recorded above the constant so nobody re-tries it.

**What will actually fix the drawing — and it is a design change, not a parameter:**

1. **Stop asking the image model to place the numbers.** It will not obey, and every wrong label is a
   promise the plan can't keep. Instead: let the model do the thing it is genuinely good at — a clean
   illustrated *redraw of the same yard* (the current output proves it can hold the fence, the path, the
   beds and the tree line) — and **draw the numbered markers ourselves** on a canvas, where we know the
   crop order and control every position. Numbers then cannot drift, and step (1) is guaranteed to point
   at (1).
2. If the photo must stay photograph-like underneath, that is a **different graph shape**: encode the photo
   with `VAEEncode`, feed *that* as `KSampler.latent_image` with a moderate denoise (~0.5), and skip the
   text-encoder-latent path entirely. That is real img2img and is the honest way to "draw on my photo".
   It is a new graph, ~30 lines, and needs one test render per setting.
3. **Free either way:** the invented plants matter far less once the numbers are ours — a redrawn yard with
   correct labels is a legitimate concept sketch, and the disclaimer already covers the rest.

**Recommendation:** do (1) first — it is cheap, it makes the numbers correct by construction, and it
removes the single worst failure. Do (2) only if a photograph-underneath is worth the extra work.

**Also worth measuring while you're in there:** 20–24 s per render at 1K is the real number; the queue's
default estimate of 45 s is conservative and should be tuned to ~30 s with headroom.

## 1b. Hawaii and Puerto Rico resolve to "we don't know", on purpose

The NOAA normals fetch covers the lower 48, Alaska, Hawaii and the Caribbean. Hawaii and Puerto Rico came
back with no usable nearby station, so those ZIPs hit the honest guard: *"the nearest station in our
records is 2,297 miles away, which is too far to be your weather."* That is the intended behaviour, not a
bug — better than a confident wrong date. If those markets ever matter, the fetch filter is already
written for them; the stations simply don't publish the 1991-2020 freeze normals we need.

## 2. Nothing can send email yet

The list is collected in `leads.csv` and is inert. This now matters more than it did: the site **asks for an
email at the gate** ("that was your free plan"), which implies something will be sent. It won't, until an ESP
is wired. One Buttondown (or beehiiv/Kit) signup plus an API key clears it, and the copy should stay honest
until then. Stated plainly on `/privacy.html`.

Also honest about the gate itself: with no confirmation email there is no verification, so it is an honour
system with teeth against casual scraping and none against someone typing `a@a.com`. Fine for a free toy,
not fine for anything paid.

## 3. The public path is documented but not exercised

`deploy/README.md` has the steps (GitHub Pages for the pages, an `api.<domain>` hostname on the existing
Cloudflare tunnel, or just serve everything from this Mac through one tunnel hostname). None of it has been
run, because none of it is my call. Two things to know before you do:

- GitHub Pages records must stay **DNS-only (grey cloud)** — a proxied record plus Pages' HTTPS-everywhere
  produces a redirect loop.
- The tool is only up while **this Mac is awake** (the `com.ryan.forgelab-keepawake` agent already handles
  AC power) **and forge is up**. There's a LaunchAgent recipe in §4 of the deploy README; without it, the
  server dies when the Mac restarts and the free tool goes quiet while still looking alive.

## 4. The demo photo is your property

`assets/img/sample-before.jpg` / `sample-plan.jpg` are your garden, with your dog at the end of the beds.
You own it, so it's clean — but it's a public before/after of your yard. Say the word and I'll swap in a
neutral photo.

## 5. Small things, recorded so they don't get lost

- `forge.mjs` polls every 2 s; with a real 24 s render that's fine, but the first poll always waits the
  full 2 s. Worth a shorter first interval if the tool ever feels slow.
- The queue is in memory: a restart drops lines. Accepted (the page tells people to resend), documented in
  `AGENTS.md`.
- `api/crops.json` days-to-maturity are typical catalog ranges, labelled as estimates in every row. If this
  ever becomes a paid claim, source them properly per variety.
- The zip→frost table only covers the Northeast on purpose. Everywhere else gets "confirm your own frost
  dates" rather than a made-up date — that's the intended behaviour, not a gap to paper over.
