# The plan engine — design

**Status: BUILT, 2026-10-12.** Ryan's calls: geometry is a choice (both offered, Coleman's as the
default), tilling is handled contextually (see `TILLING_STANCE` in `api/phases.mjs` — the one-pass
exception survives, flip it to drop the paragraph), trap crops are in but graded so he can judge them,
and the drawing is demoted to an unlabelled illustration. Implemented across `api/crops.json`
(knowledge base), `api/beds.mjs` (geometry + rotation), `api/phases.mjs` (the eight phases) and
`api/plan-spec.mjs` (assembly). Tests: `tests/test-beds.mjs` plus the phase assertions in
`tests/test-plan.mjs`.
**Why:** the current output is five generic steps. It says *"sheet-mulch the paths"* without knowing
whether there are paths, and it names companions without saying what they're for. That is elementary, and
it is the easy thing to fix — the hard half of this product is the plan, not the drawing.

**The spine: Eliot Coleman.** Four Season Farm, Harborside — zone 5, two hours up the coast from Wiscasset,
same climate, same problems, and fifty years of documented practice. Where Coleman and a permaculture blog
disagree, Coleman wins, and where the evidence is thin we say so instead of padding the plan.

---

## 1. What changes in the shape of the plan

Today: `PLANT · SOIL · WATER · BUILD · HARVEST`, five steps, written before we know anything about the
site. That ordering is wrong for anyone who doesn't have beds yet — which is most people.

New: **a dated season plan, phased, branched on the site.** Each phase has a date, a reason, and a skip
condition ("already have beds? skip to 3").

| # | Phase | When | Branches on |
|---|---|---|---|
| 0 | Where this is going | now | everything |
| 1 | **Site prep — build the beds** | 4–8 weeks before planting | existing beds / bare ground / lawn / containers |
| 2 | Soil & fertility | with 1, top-dressed later | new build / established / poor |
| 3 | Layout & spacing | at planting | bed geometry (Coleman 30" or existing 4×8) |
| 4 | Planting & succession | frost-dated | transplant vs direct sow, per crop |
| 5 | Pest & beneficial strategy | as crops go in | crop mix, site history |
| 6 | Water | after planting | bed type, soil |
| 7 | Season extension | Aug–Sep | zone, crops that stand |
| 8 | Harvest & the preservation window | through the season | → the paid product |

## 2. Phase 1 — build the beds (this is the missing step)

Coleman's geometry, because it is the one that works by hand: **30-inch-wide beds with 12-inch paths**,
worked from the path, never walked on. That is narrower than a 4×8 box and it is deliberate — you can
reach the middle from either side, so you never compact the soil you're growing in.

The plan now asks the site question first and then gives ONE build path, not a menu:

- **You already have beds** → skip the build; go straight to feeding them (compost top-dress, no dig).
- **Bare ground** → mark 30" beds + 12" paths, then **sheet mulch**: cardboard (overlapping, wet),
  then an inch of compost, then whatever mulch the town or the woods gives you. No tillage. Plant into
  holes in the mulch this season; the bed improves under you.
- **Lawn or compacted ground** → this is the one case where the plan offers a **broadfork or a single
  pass of a tiller** to break the pan, and says why: sheet mulch over a hard lawn is a two-year
  proposition and most people quit before the payoff. One pass, then never again. Tilling is a tool,
  not a sin — what ruins soil is doing it every year.
- **Building boxes, and want the hugelkultur version** (sticks at the bottom, as Ryan asked):
  1. cardboard flat on the ground, overlapping, soaked
  2. **woody material — branches, rotten logs, sticks, brush — no more than the bottom third**, thicker
     pieces at the very bottom, gaps filled with smaller stuff. Water it as you go.
  3. a sprinkle of native soil or old compost over the wood (inoculum)
  4. leaves, straw, grass clippings, garden waste
  5. 2–3 inches of finished compost on top
  6. topsoil or a compost/soil mix to fill the last few inches
  *Honest caveats the plan must carry:* it sinks as the wood rots — plant perennials at the edges, not
  the middle; fresh wood ties up nitrogen for a season, so give heavy feeders a top-dress; softwoods
  (especially cedar) take longer; and don't use it for carrots or anything that wants a fine, even seedbed.
- **Containers** → mix, drainage, and the two things that actually limit patio growing: water and volume.

## 3. Pest & beneficial strategy — with the evidence graded honestly

**Ryan's example needs correcting, and the correction is more useful than the folklore.** Marigolds
(French and African, *Tagetes*) do suppress root-knot and lesion nematodes — but essentially **as a
solid cover crop or rotation, tilled into the soil, not as a plant set beside the tomatoes.** Intercropping
a few marigolds in a tomato bed does not do it; the trial data needs two months of solid *Tagetes* before
the crop. And in Maine, root-knot nematode is a much smaller problem than it is in the South, so the real
value of marigolds here is insectary — habitat for hoverflies and parasitic wasps — not nematode control.

So every recommendation in the plan carries a grade, and the grades are the whole point:

| Grade | What it means | The plan's examples |
|---|---|---|
| **Proven** | reproducible in trials or extension practice | **trap cropping** (a Blue Hubbard squash at the edge took 60–80% of the squash-bug pressure in trial data); **push-pull** habitat management (>100% yield gains in maize systems); **insectary strips** (an alyssum strip ≈10% of the field was enough to hold aphids down); **row cover** as a physical barrier; **marigold rotations** for nematodes where they're actually a problem |
| **Supported** | some controlled evidence, mixed | basil + marigold beside tomatoes reduced thrips in several trials; marigold + nasturtium + onion reduced cabbage looper and imported cabbageworm on cabbage; legumes undersown to cut nitrogen need; alternating early and late crops in one bed to keep the soil covered and weeds down |
| **Folklore** | no controlled support — we do not print it | "repels everything", "improves flavour", most of the neighbourhood charts |

The phase plan therefore says things like: *"Put one Blue Hubbard at the south end, away from your
zucchini, and check it twice a week — it's a trap crop, it will get bugs, and that's it doing its job."*
That is a technique. *"Plant marigolds near tomatoes"* is a superstition with a nice picture.

## 4. Succession, properly

Coleman's discipline: never let a bed be empty, and never let a crop arrive all at once. The plan gives a
**dated sowing calendar** with real intervals per crop (beans and lettuce every 14 days, beets and carrots
every 21, corn in short blocks 10 days apart) and then names the **gap** — the fortnight in your own season
where nothing is ready. That gap is the thing the current version completely ignores, and it's the
difference between a garden and a supply.

## 5. Rotation

Every crop gets its botanical family, and the plan refuses to put the same family where it was last year:
Solanaceae (tomato, pepper, potato), Fabaceae (bean, pea), Brassicaceae (kale, cabbage, radish),
Amaranthaceae (beet, chard), Apiaceae (carrot), Allium (garlic, onion), Cucurbitaceae (zucchini,
cucumber, squash), Poaceae (corn). Needs one new field, `family`, plus a place to remember what they grew
where — which is a small "your beds" note, not a database.

## 6. Season extension — Coleman's actual specialty, and it's free here

Zone 5b with a coastal influence is exactly the Four Season Farm problem. The plan should offer:
a **cold frame** (hinged south, storm window reused), **quick hoops** over a bed with row cover, and the
**winter-harvest list** — the crops that stand and sweeten: kale, carrots left in the ground under mulch,
leeks, spinach, mâche, claytonia. That's a genuinely expert answer to *"what do I do after the tomatoes
finish"* that no generic app gives.

## 7. What the crop table needs added

Per crop, one row each, all sourced to *crops.json*'s rule (cite it or leave it out):

- `family` — rotation (botanical, so reliable)
- `bed_spacing` — in-row and between-row for a **30-inch bed** at Coleman's intensive spacing (this
  replaces the 4×8 counts, or sits alongside them for people who already own boxes)
- `method` — transplant or direct sow, and roughly when to start it inside
- `succession_days` — already there
- `stands_into_cold` — feeds the winter-harvest list
- `pest_role` — trap crop / insectary / none, with the grade
- `watch_for` — the two or three pests and diseases that actually matter for that crop here

## 8. What this does to the drawing

Nothing structural. The drawing is already known to be unreliable about labels — the fix for that is in
`BLOCKERS.md` (draw the markers ourselves). This design makes the *text* the product and the drawing the
illustration, which is the right order anyway: someone will act on the sowing dates, not the cartoon.

## Sources

- Mississippi State University Extension, *Companion Planting: Myth or Truth?* — marigold/nematode
  mechanism (tilled-in, not intercropped), basil+marigold/thrips, marigold+nasturtium+onion/cabbageworm,
  early+late crops in one bed for weed cover, legumes undersown, and the blunt statement that many
  charted pairings rest on anecdote.
- *Crop Protection* (2010) review, via a research summary — marigold rotations cutting nematode populations
  by more than 50% in frequent trials.
- Eliot Coleman, *The New Organic Grower* — 30-inch beds, 12-inch paths, working from the path; intensive
  spacing; transplants over direct sowing; crop rotation by family; ley farming (half the ground in
  deep-rooted green manure at Four Season Farm); fertility from compost, seaweed and shells rather than
  purchased inputs.
- Eliot Coleman, *Four-Season Harvest* / *The Winter Harvest Handbook* — unheated winter production in
  zone 5, cold frames, quick hoops, the crops that stand into cold.
- University of Maine Cooperative Extension — variety and season guidance for this state specifically.

## Open questions for Ryan

1. **Bed geometry default** — Coleman's 30" beds with 12" paths as the default (with an "I already have
   4×8 boxes" toggle), or keep 4×8 boxes as the default and offer 30" as the pro option?
2. **Tilling** — happy with the honest version ("one pass over hard ground, then never again"), or do you
   want the plan to hold a stricter no-dig line?
3. **Trap crops** — the plan will tell people a trap crop *will* get infested on purpose. That's correct
   but it will generate "why are there bugs on my squash" questions. Keep it, or soften to insectary-only?
4. Do you want the drawing-at-all in v1, or should this release be the written plan plus a photo of their
   own yard as the header, with the illustrated overlay once the markers are ours?
