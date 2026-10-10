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

**The fix to test** (one GPU job, ~30 s):

1. `denoise` 0.5–0.6 in the KSampler, keeping `switch: false` so the canvas still follows the photo.
2. Harden the prompt with an explicit negative: *"The beds are empty — do not add plants, animals or
   buildings that are not in the photograph. Do not change the fence, the trees or the horizon."*
3. If numbers still drift, drop the labels from the image entirely and keep them in the step list
   (labelled *the* drawing is nice-to-have; *the* numbers being right is not negotiable — a plan that
   points at the wrong bed is worse than a plain redraw).

**Also worth measuring while you're in there:** 24.3 s per render at 1K is the real number; the queue's
default estimate of 45 s is conservative and should be tuned to ~35 s with headroom.

## 2. Nothing can send email yet

The list is collected in `leads.csv` and is inert. One Buttondown (or beehiiv/Kit) signup plus an API key
clears it. Deliberately out of scope tonight; stated plainly on `/privacy.html`.

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
