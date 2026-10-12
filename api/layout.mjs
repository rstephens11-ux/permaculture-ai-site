// api/layout.mjs — where everything actually goes, and the plan drawn to scale.
//
// The first version of this site asked the image model to draw the plan and label the beds. It never did
// it reliably — three measured renders, see BLOCKERS.md — and then the correction went too far the other
// way: the numbers were dropped, and the drawing became a cartoon of the yard with no plan in it. Ryan's
// note: "the point was to kinda show how to layout their garden."
//
// He's right, and the fix is architectural rather than a better prompt: WE know the layout. Bed widths,
// path widths, which crop goes where, how many plants fit. So we draw it ourselves, to scale, as SVG.
// It is deterministic, it is always right, it prints, and it needs no GPU.
//
// The allocation model is how intensive beds actually work: a bed is a strip, and crops take lengths of
// it rather than each demanding a whole bed.

import { GEOMETRIES, countInBed, familyOf } from "./beds.mjs";

const FT = 1;

/** Colour by botanical family, so the rotation is visible in the picture rather than only in the text. */
const FAMILY_INK = {
  Solanaceae: { fill: "#f6d5cb", ink: "#8a3a22" },
  Fabaceae: { fill: "#d8e7c6", ink: "#3d6b2a" },
  Brassicaceae: { fill: "#cfe3d3", ink: "#255f3f" },
  Amaranthaceae: { fill: "#e8d3e0", ink: "#7a2f5c" },
  Apiaceae: { fill: "#f7e3c2", ink: "#8a5a12" },
  Allium: { fill: "#e3dcf2", ink: "#4b3a80" },
  Cucurbitaceae: { fill: "#fbe8b8", ink: "#8a6512" },
  Poaceae: { fill: "#efe6c8", ink: "#6d5a1e" },
  Asteraceae: { fill: "#d9e7ef", ink: "#2c5c74" },
  Caprifoliaceae: { fill: "#e0efe6", ink: "#2f6752" },
  Rosaceae: { fill: "#f6d9dd", ink: "#8a2f42" },
  unknown: { fill: "#eceae4", ink: "#555" }
};

const TALL = new Set(["tomato", "cherry-tomato", "cucumber", "pea", "sweet-corn"]);

/**
 * Assign crops to beds, as lengths of each bed strip.
 *
 * Ordering rules, and they are Coleman's rather than mine: tall and trellised things go at the north end
 * of the block so they never shade what is beside them; the trap crop and any insectary go on the outside
 * edge; and each bed gets a mix of families where possible so one bed isn't four brassicas in a row.
 *
 * @returns {{beds: object[], segmentsByBed: object, notes: string[]}}
 */
export function assignBeds(cropList, { geometry = "coleman_30", bedCount = 1 } = {}) {
  const g = GEOMETRIES[geometry] || GEOMETRIES.coleman_30;
  const notes = [];
  const beds = [];
  const bedList = [];
  const bedLengthFt = g.id === "box_4x8" ? 8 : g.default_length_ft;
  const count = Math.max(1, Number(bedCount) || 1);

  // Tall crops first, so they land at the start (north end) of the block.
  const ordered = cropList.slice().sort((a, b) => (TALL.has(b.id) ? 1 : 0) - (TALL.has(a.id) ? 1 : 0));

  for (let i = 0; i < count; i++) bedList.push({ n: i + 1, length_ft: bedLengthFt, segments: [] });

  if (g.id === "containers") {
    ordered.forEach((c, i) => {
      bedList[0].segments.push({ crop: c.id, name: c.name, family: familyOf(c), plants: 2, note: c.planting.note });
    });
    notes.push("Containers have no layout to draw — the plan is a list of what goes in the pots, not a map.");
    return { beds: bedList, notes };
  }

  // Round-robin placement, keeping families apart where there is a choice.
  const familySeen = bedList.map(() => new Set());
  for (const crop of ordered) {
    const fam = familyOf(crop);
    let target = bedList.findIndex((b) => !familySeen[b.n - 1].has(fam) && b.segments.length === 0)
      ?? 0;
    if (target < 0) {
      target = bedList
        .map((b, i) => ({ i, n: b.segments.length, clash: familySeen[i].has(fam) ? 1 : 0 }))
        .sort((a, b) => (a.clash - b.clash) || (a.n - b.n))[0].i;
    }
    familySeen[target].add(fam);
    bedList[target].segments.push({ crop: crop.id, name: crop.name, family: fam });
  }

  // Split each bed's length between its crops, in half-foot steps, minimum 2 ft.
  for (const bed of bedList) {
    const n = bed.segments.length || 1;
    const share = Math.max(2, Math.floor((bed.length_ft / n) * 2) / 2);
    let used = 0;
    bed.segments.forEach((seg, i) => {
      const len = i === bed.segments.length - 1 ? Math.max(1, bed.length_ft - used) : share;
      seg.length_ft = Math.max(1, Math.min(len, bed.length_ft - used));
      used += seg.length_ft;
      const crop = cropList.find((c) => c.id === seg.crop);
      const rows = crop?.bed30?.rows || 1;
      const inRow = crop?.bed30?.in_row_in || 12;
      const plants = rows * Math.max(1, Math.floor((seg.length_ft * 12) / inRow));
      seg.rows = rows;
      seg.plants = plants;
      seg.spacing_in = inRow;
      seg.print = seg.print || `${plants} plant${plants === 1 ? "" : "s"} in ${seg.length_ft} ft`;
      seg.note = crop?.bed30?.note || crop?.planting?.note || "";
      seg.tall = TALL.has(seg.crop);
    });
    bed.used_ft = used;
    beds.push(bed);
  }

  notes.push("Tall crops are placed at the north end of the block so they don't shade the beds beside them.");
  return { beds: bedList, notes };
}

/* ------------------------------------------------------------------ the drawing, to scale */

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Rough rendered width of a string at 9.5px in a UI sans — enough to lay a legend out without a canvas. */
const estWidth = (s, size = 9.5) => String(s).length * size * 0.55;

/**
 * The name as it goes *inside* a 30-inch bed. "Mâche (corn salad)" is 110px of text in an 85px bed —
 * it ran over the bed edge. The parenthetical is a gloss, so the drawing drops it and the legend and
 * the bed-by-bed list below keep the full name.
 */
const shortName = (name) => String(name).replace(/\s*\(.*?\)\s*$/, "").trim();

/**
 * Render the layout as a top-down plan, to scale, as SVG.
 * One foot = `pxPerFt` pixels, so the picture is dimensionally honest and prints.
 */
export function planDiagram(layout, meta = {}) {
  const {
    geometry = "coleman_30", place = "your patch", year = new Date().getUTCFullYear(),
    frost = {}, glut = null, cropList = []
  } = meta;
  const g = GEOMETRIES[geometry] || GEOMETRIES.coleman_30;

  if (g.id === "containers") return containerDiagram(layout, meta);

  // pxPerFt is set so a 30-inch bed is ~85px wide — enough for its crop labels at the sizes below.
  const pxPerFt = g.id === "box_4x8" ? 30 : 34;
  const bedW = (g.width_in / 12) * pxPerFt;
  const pathW = (g.path_in / 12) * pxPerFt;
  const pad = 46;
  const beds = layout.beds || [];
  const bedH = Math.max(...beds.map((b) => (b.length_ft || 12) * pxPerFt), 100);

  // The canvas is driven by the geometry and then FLOORED, so a two-bed plan still has room for its own
  // title, its glut line and its legend. Sizing it to the beds alone clipped all three — which the
  // screenshot caught immediately and the tests did not, because they only looked for substrings.
  const geomW = beds.length * bedW + Math.max(0, beds.length - 1) * pathW;
  const width = Math.max(geomW + pad * 2, 820);
  const headerH = glut ? 118 : 98;
  const legendRows = Math.max(1, Math.ceil(((cropList || []).length || 1) / 3));
  const legendH = legendRows * 20;
  const footerH = 52 + legendH;
  const height = headerH + bedH + footerH;
  const top = headerH;
  const bedLeft = pad + (width - pad * 2 - geomW) / 2;

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="-apple-system,Helvetica,Arial,sans-serif">`);
  out.push(`<rect width="${width}" height="${height}" fill="#fffdf6"/>`);

  // title block
  const frostLine = frost && frost.known
    ? `last frost ${frost.last_spring_freeze} · first fall freeze ${frost.first_fall_freeze} · ${frost.frost_free_days} frost-free days`
    : "no local frost record — dates are general";
  out.push(`<text x="${pad}" y="34" font-size="21" font-weight="800" fill="#20301c">${esc(place)} — the ${year} season</text>`);
  out.push(`<text x="${pad}" y="56" font-size="12.5" fill="#5b6a53">${esc(frostLine)}</text>`);
  out.push(`<text x="${pad}" y="76" font-size="12.5" fill="#2f7a3f">${esc(g.short)}, ${g.path_in}-inch paths · drawn to scale, one foot = ${pxPerFt}px · north at the top</text>`);
  if (glut) {
    out.push(`<text x="${pad}" y="${headerH - 34}" font-size="12" fill="#c2455e">peak week: everything lands ${esc(glut.open)} to ${esc(glut.close)}</text>`);
  }

  // north arrow
  out.push(`<g transform="translate(${width - pad - 14}, ${headerH - 22})">`);
  out.push(`<path d="M0 22 L0 0 M-6 8 L0 0 L6 8" fill="none" stroke="#20301c" stroke-width="2"/>`);
  out.push(`<text x="0" y="34" font-size="10" fill="#5b6a53" text-anchor="middle">N</text></g>`);

  beds.forEach((bed, bi) => {
    const x = bedLeft + bi * (bedW + pathW);

    // the path to the left of this bed (except the first)
    if (bi > 0) {
      out.push(`<rect x="${x - pathW}" y="${top}" width="${pathW}" height="${bedH}" fill="#f2ede0"/>`);
      if (pathW >= 18) {
        out.push(`<text x="${x - pathW / 2}" y="${top + bedH / 2}" font-size="9" fill="#a89b7d" text-anchor="middle" transform="rotate(-90 ${x - pathW / 2} ${top + bedH / 2})">${g.path_in}in path</text>`);
      }
    }

    // the bed
    out.push(`<rect x="${x}" y="${top}" width="${bedW}" height="${bedH}" fill="#fff" stroke="#20301c" stroke-width="2.5" rx="3"/>`);
    out.push(`<text x="${x + bedW / 2}" y="${top - 8}" font-size="11" font-weight="700" fill="#20301c" text-anchor="middle">Bed ${bed.n}</text>`);

    // water line down the middle
    out.push(`<line x1="${x + bedW / 2}" y1="${top + 6}" x2="${x + bedW / 2}" y2="${top + bedH - 6}" stroke="#4a86b8" stroke-width="1.6" stroke-dasharray="7 5"/>`);

    // segments down the length
    let y = top;
    for (const seg of bed.segments || []) {
      const h = (seg.length_ft || 2) * pxPerFt;
      const ink = FAMILY_INK[seg.family] || FAMILY_INK.unknown;
      out.push(`<rect x="${x + 1.5}" y="${y + 1.5}" width="${bedW - 3}" height="${h - 3}" fill="${ink.fill}" fill-opacity="0.55" stroke="${ink.ink}" stroke-width="1.2" rx="2"/>`);

      // rows as ticks across the bed
      const rows = seg.rows || 1;
      for (let r = 1; r < rows; r++) {
        const rx = x + (bedW / rows) * r;
        out.push(`<line x1="${rx}" y1="${y + 4}" x2="${rx}" y2="${y + h - 4}" stroke="${ink.ink}" stroke-width="0.6" stroke-dasharray="2 4" opacity="0.7"/>`);
      }

      // label: short crop name + quantity, sized to the segment and to the bed's width
      const name = shortName(seg.name);
      const fit = estWidth(name, 10.5) <= bedW - 10 ? name : name.split(" ")[0];
      const label = seg.tall ? `${fit} ↑` : fit;
      out.push(`<text x="${x + bedW / 2}" y="${y + h / 2 - 3}" font-size="${h > 54 ? 10.5 : 9}" font-weight="700" fill="${ink.ink}" text-anchor="middle">${esc(label)}</text>`);
      if (h > 40) {
        out.push(`<text x="${x + bedW / 2}" y="${y + h / 2 + 9}" font-size="9" fill="${ink.ink}" text-anchor="middle" opacity="0.85">${esc(seg.print || "")}</text>`);
      }
      if (h > 62) {
        out.push(`<text x="${x + bedW / 2}" y="${y + h / 2 + 20}" font-size="8" fill="${ink.ink}" text-anchor="middle" opacity="0.7">${esc(String(seg.length_ft) + " ft · " + (seg.spacing_in || "") + " in")}</text>`);
      }
      y += h;
    }
  });

  // overall dimension line, short enough to fit whatever width we settled on
  const totalFt = (geomW / pxPerFt).toFixed(1);
  const dimLine = beds.length + " bed" + (beds.length === 1 ? "" : "s")
    + " · " + g.width_in + "-in beds, " + g.path_in + "-in paths"
    + (beds.length > 1 ? " · about " + totalFt + " ft across" : "");
  out.push(`<text x="${width / 2}" y="${top + bedH + 24}" font-size="10.5" fill="#5b6a53" text-anchor="middle">${esc(dimLine)}</text>`);

  // legend
  const legend = [...new Set((cropList || []).map((c) => familyOf(c)))]
    .map((f) => {
      const ink = FAMILY_INK[f] || FAMILY_INK.unknown;
      const crops = cropList.filter((c) => familyOf(c) === f).map((c) => c.name).join(", ");
      return { f, ink, crops };
    });
  if (legend.length) {
    // Wrapped, and measured: a long family list used to run off the right edge and get clipped.
    let lx = pad;
    let ly = top + bedH + 50;
    out.push(`<g font-size="9.5">`);
    out.push(`<text x="${pad}" y="${ly - 18}" font-size="10" font-weight="700" fill="#20301c">families</text>`);
    for (const l of legend) {
      const wpt = 22 + estWidth(l.crops);
      if (lx + wpt > width - pad) { lx = pad; ly += 20; }
      out.push(`<rect x="${lx}" y="${ly - 8}" width="10" height="10" fill="${l.ink.fill}" stroke="${l.ink.ink}" stroke-width="1"/>`);
      out.push(`<text x="${lx + 14}" y="${ly}" fill="#20301c">${esc(l.crops)}</text>`);
      lx += wpt;
    }
    out.push(`</g>`);
  }

  out.push(`</svg>`);
  return out.join("");
}

/** Containers get a simple row of pots rather than a map. */
function containerDiagram(layout, meta) {
  const segs = (layout.beds[0] && layout.beds[0].segments) || [];
  const w = Math.max(560, 130 * segs.length + 80);
  const h = 300;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="-apple-system,Helvetica,Arial,sans-serif">`);
  out.push(`<rect width="${w}" height="${h}" fill="#fffdf6"/>`);
  out.push(`<text x="40" y="40" font-size="19" font-weight="800" fill="#20301c">${esc(meta.place || "your patch")} — containers</text>`);
  out.push(`<text x="40" y="60" font-size="12.5" fill="#5b6a53">Big pots, heavy feeding, and never let them dry out. Volume is what buys you a missed watering.</text>`);
  segs.forEach((seg, i) => {
    const ink = FAMILY_INK[seg.family] || FAMILY_INK.unknown;
    const x = 50 + i * 120;
    out.push(`<rect x="${x}" y="100" width="86" height="86" fill="${ink.fill}" stroke="${ink.ink}" stroke-width="2" rx="34"/>`);
    out.push(`<text x="${x + 43}" y="146" font-size="10.5" font-weight="700" fill="${ink.ink}" text-anchor="middle">${esc(seg.name.split(" ")[0])}</text>`);
    out.push(`<text x="${x + 43}" y="206" font-size="9" fill="#5b6a53" text-anchor="middle">${esc(seg.note || "")}</text>`);
  });
  out.push(`</svg>`);
  return out.join("");
}
