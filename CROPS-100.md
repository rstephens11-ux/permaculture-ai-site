# The crop list — 100, for review

Ryan's call: 100 crops, "a variety and not to be limited". This is the roster. Nothing gets generated
and nothing gets researched until it's agreed, because the sprite sheet and the crop table are both
expensive to redo.

**Marked ✓ = already in the table and already drawn** (21 crops, sprites done).

## 1. Salad and leafy greens (13)
lettuce ✓ · spinach ✓ · kale ✓ · swiss chard ✓ · mâche ✓ · arugula · mustard greens · collards ·
bok choy · tatsoi · endive · radicchio · sorrel

## 2. Cole crops (7)
broccoli · cauliflower · cabbage · brussels sprouts · kohlrabi · rapini · napa cabbage

## 3. Roots and tubers (9)
carrot ✓ · beet ✓ · potato ✓ · radish · turnip · rutabaga · parsnip · celeriac · sweet potato

## 4. Alliums (7)
garlic ✓ · onion ✓ · leek ✓ · shallot · scallion · chives · walking onion (perennial)

## 5. Fruiting vegetables (13)
tomato ✓ · cherry tomato ✓ · pepper ✓ · hot pepper · eggplant · tomatillo · cucumber ✓ · zucchini ✓ ·
summer squash · winter squash ✓ · pumpkin · melon · watermelon

## 6. Legumes (6)
bush bean ✓ · pole bean · pea ✓ · snow pea · fava bean · edamame

## 7. Corn and seed crops (3)
sweet corn ✓ · popcorn · sunflower

## 8. Culinary herbs (14)
basil · dill · parsley · cilantro · thyme · oregano · sage · rosemary · mint · tarragon ·
summer savory · bulb fennel · marjoram · chervil

## 9. Medicinal and pollinator (7)
calendula · chamomile · borage · nasturtium · echinacea · yarrow · bee balm

## 10. Cover crops and green manure (5)
buckwheat · crimson clover · winter rye · hairy vetch · field peas and oats

## 11. Perennial vegetables (4)
asparagus · rhubarb · Jerusalem artichoke · sea kale

## 12. Berries and small fruit (10)
raspberry ✓ · strawberry · blackberry · highbush blueberry · lowbush blueberry · red currant ·
black currant · gooseberry · elderberry · honeyberry

## 13. Tree fruit and nuts (8)
apple · pear · plum · sweet cherry · tart cherry · peach · quince · hazelnut

**Total: 106 slots, 100 after the cuts below.** Cut unless you want them: watercress, daikon,
lavender, mulberry, flour corn, good king henry — all either marginal in zone 5b, awkward in a bed
plan, or duplicative. Say the word and any come back.

---

# What we do NOT have for the other 79: the facts

A sprite is a picture. A crop entry is a table of facts, and every one of these has to be sourced —
I won't invent a spacing or a days-to-maturity, because those are the numbers someone acts on with a
seed packet in their hand:

| field | example | source type |
|---|---|---|
| `family` | Solanaceae | botanical, unambiguous |
| `bed30.rows`, `in_row_in` | 1 row, 24 in | Coleman's bed system + extension spacing charts |
| `planting.method` | transplant / direct / either | extension |
| `start_inside_weeks` | 7 | extension, adjusted to our frost date |
| `days_to_maturity` | 75 | seed catalogue / extension |
| `succession_days` | 14 | extension |
| `season` | cool / warm / overwinter | extension |
| `min_frost_free_days` | 90 | derived from the above |
| `pest_role`, `watch_for` | trap crop, late blight | extension, graded proven/supported/folklore |
| `stands_into_cold` | true/false | Coleman, extension |

**Sources, in order of preference:** UMaine Cooperative Extension (this is *their* climate), UNH and
Cornell extension, Eliot Coleman's *The New Organic Grower* / *Four Season Harvest*, Fedco and Johnny's
for variety-level days-to-maturity. Preservation numbers stay out unless they come from USDA/NCHFP —
the same rule the rest of the site already follows.

**Plan for gathering it:** eight parallel research tasks, one per category group, each returning a JSON
table with a source for every row. I then merge, validate against the schema, and hand-check a sample
against the sources before anything is generated — a wrong spacing is worse than a missing crop.

---

# What runs after that

1. **79 new sprites** — one batch, same fixed seed, so they match the 21 already drawn. ~30 minutes of
   GPU, one time.
2. **The overlay rebuild** (the real work): mask render → bed polygons → dirt texture in perspective →
   sprites at real spacing, scaled by depth → numbered labels tied to the plan's phases.
3. **The plan engine learns permanent plantings** — the 22 perennials and trees (berries, asparagus,
   rhubarb, orchard) don't take a bed slot, they take a position and a year, so they need their own
   section rather than being listed beside the lettuce.
